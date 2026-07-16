import { mixToMono } from "./audio.js";

/**
 * Automatische Track-Analyse: BPM, Tonart (Key) und Pegel-Metriken.
 * Alles Schätzungen auf Basis des dekodierten Audios — für den
 * A/B-Vergleich gedacht, nicht als Referenzmesswerte.
 */

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
// Camelot-Wheel-Codes je Pitch-Class (Index 0 = C), wie sie DJs/Producer nutzen
const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

// Krumhansl-Schmuckler Tonarten-Profile (empirische Tonhöhen-Gewichtung)
const PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Iterative Radix-2-FFT, in-place auf re/im (Länge muss Zweierpotenz sein) */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const bRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const bIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j + half] = re[i + j] - bRe;
        im[i + j + half] = im[i + j] - bIm;
        re[i + j] += bRe;
        im[i + j] += bIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/**
 * BPM-Schätzung über Autokorrelation der Onset-Stärke (Energiezuwächse).
 * Mehrdeutigkeiten (halbes/doppeltes Tempo) werden über eine sanfte
 * Log-Gauss-Gewichtung um 120 BPM aufgelöst.
 */
export function detectBPM(mono, sampleRate) {
  const hop = 256;
  const envRate = sampleRate / hop;
  const nFrames = Math.floor(mono.length / hop);
  if (nFrames < envRate * 15) return null; // unter ~15 s zu unsicher

  const env = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let sum = 0;
    const start = i * hop;
    for (let j = 0; j < hop; j++) {
      const v = mono[start + j];
      sum += v * v;
    }
    env[i] = Math.sqrt(sum / hop);
  }
  const onset = new Float32Array(nFrames);
  for (let i = 1; i < nFrames; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);

  const minLag = Math.max(1, Math.floor((envRate * 60) / 200));
  const maxLag = Math.min(nFrames - 1, Math.ceil((envRate * 60) / 60));
  const ac = new Float32Array(maxLag + 1);
  let bestLag = 0, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < nFrames; i++) s += onset[i] * onset[i - lag];
    ac[lag] = s / (nFrames - lag);
    const bpm = (60 * envRate) / lag;
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
    const score = ac[lag] * weight;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (bestLag === 0 || ac[bestLag] <= 0) return null;

  // Parabolische Interpolation für Sub-Lag-Genauigkeit
  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = ac[bestLag - 1], y1 = ac[bestLag], y2 = ac[bestLag + 1];
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) lag = bestLag + (0.5 * (y0 - y2)) / denom;
  }
  return (60 * envRate) / lag;
}

/**
 * Tonart-Schätzung: Chromagramm über die Tracklänge aufsummieren und mit
 * rotierten Krumhansl-Dur/Moll-Profilen korrelieren.
 */
export function detectKey(mono, sampleRate) {
  const N = 8192;
  if (mono.length < N * 2) return null;
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  const maxFrames = 120;
  const step = Math.max(N, Math.floor((mono.length - N) / maxFrames));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const chroma = new Float32Array(12);

  for (let pos = 0; pos + N <= mono.length; pos += step) {
    for (let i = 0; i < N; i++) {
      re[i] = mono[pos + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sampleRate) / N;
      if (f < 55) continue;
      if (f > 1760) break;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
  }

  let best = null;
  for (let root = 0; root < 12; root++) {
    const rotated = (profile) => profile.map((_, i) => chroma[(root + i) % 12]);
    const scoreMajor = pearson(rotated(PROFILE_MAJOR), PROFILE_MAJOR);
    const scoreMinor = pearson(rotated(PROFILE_MINOR), PROFILE_MINOR);
    if (!best || scoreMajor > best.score) best = { score: scoreMajor, root, mode: "major" };
    if (scoreMinor > best.score) best = { score: scoreMinor, root, mode: "minor" };
  }
  if (!best) return null;
  return {
    name: NOTE_NAMES[best.root],
    mode: best.mode === "major" ? "Major" : "Minor",
    camelot: best.mode === "major" ? CAMELOT_MAJOR[best.root] : CAMELOT_MINOR[best.root],
  };
}

/** Korrelation (+1 mono … −1 gegenphasig) und Breite (Seiten-/Mitten-RMS) */
export function analyzeStereo(buffer) {
  if (buffer.numberOfChannels < 2) return null;
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  let sumLR = 0, sumLL = 0, sumRR = 0, sumMid = 0, sumSide = 0;
  for (let i = 0; i < L.length; i++) {
    const l = L[i], r = R[i];
    sumLR += l * r;
    sumLL += l * l;
    sumRR += r * r;
    const m = (l + r) / 2, s = (l - r) / 2;
    sumMid += m * m;
    sumSide += s * s;
  }
  return {
    correlation: sumLL > 0 && sumRR > 0 ? sumLR / Math.sqrt(sumLL * sumRR) : 1,
    width: sumMid > 0 ? Math.sqrt(sumSide / sumMid) : 0,
  };
}

/** Bündelt alle Metadaten eines Tracks für die Anzeige */
export function analyzeTrack(buffer, file) {
  const mono = mixToMono(buffer);

  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }

  const ext = file.name.includes(".") ? file.name.split(".").pop().toUpperCase() : (file.type || "?");
  return {
    bpm: detectBPM(mono, buffer.sampleRate),
    key: detectKey(mono, buffer.sampleRate),
    stereo: analyzeStereo(buffer),
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    duration: buffer.duration,
    format: ext,
    bitrateKbps: buffer.duration > 0 ? (file.size * 8) / (buffer.duration * 1000) : null,
  };
}
