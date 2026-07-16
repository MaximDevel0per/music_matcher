/**
 * Vereinfachte, ungegatete LUFS-Schätzung nach ITU-R BS.1770-Prinzip.
 * Kein zertifizierter Broadcast-Loudness-Messwert, aber für einen
 * A/B-Vergleich ausreichend präzise.
 *
 * Ablauf: Audio läuft durch zwei IIR-Filter (K-Weighting), danach wird
 * der mittlere quadratische Pegel gemessen und in LUFS umgerechnet.
 *
 * Liefert neben dem integrierten Wert auch einen Short-Term-Verlauf
 * (3-s-Fenster, 0,5-s-Schritt) für die Loudness-Grafik.
 */
export async function measureLoudness(buffer) {
  const targetRate = 48000;
  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    Math.ceil(buffer.duration * targetRate),
    targetRate
  );
  const src = offlineCtx.createBufferSource();
  src.buffer = buffer;

  // Stage 1: Pre-Filter (High-Shelf, simuliert Kopf-/Ohrmuschel-Effekt)
  const stage1 = offlineCtx.createIIRFilter(
    [1.53512485958697, -2.69169618940638, 1.19839281085285],
    [1, -1.69065929318241, 0.73248077421585]
  );
  // Stage 2: RLB-Filter (High-Pass)
  const stage2 = offlineCtx.createIIRFilter(
    [1.0, -2.0, 1.0],
    [1, -1.99004745483398, 0.99007225036621]
  );

  src.connect(stage1);
  stage1.connect(stage2);
  stage2.connect(offlineCtx.destination);
  src.start(0);

  const rendered = await offlineCtx.startRendering();
  const len = rendered.length;
  const channels = rendered.numberOfChannels;

  // Präfixsummen der quadrierten Samples (über alle Kanäle summiert) —
  // damit sind integrierter Wert und beliebige Zeitfenster O(1) ablesbar.
  const cum = new Float64Array(len + 1);
  for (let ch = 0; ch < channels; ch++) {
    const data = rendered.getChannelData(ch);
    for (let i = 0; i < len; i++) cum[i + 1] += data[i] * data[i];
  }
  for (let i = 0; i < len; i++) cum[i + 1] += cum[i];

  const toLufs = (sumSquares, count) => {
    const meanSquare = sumSquares / count;
    return meanSquare <= 0 ? -70 : -0.691 + 10 * Math.log10(meanSquare);
  };

  const integrated = toLufs(cum[len], len * channels);

  // Verlauf über gleitendes Fenster — dank Präfixsummen O(1) pro Schritt
  const series = (windowSec, hopSec) => {
    const windowLen = Math.min(len, Math.round(windowSec * targetRate));
    const hopLen = Math.max(1, Math.round(hopSec * targetRate));
    const out = [];
    for (let start = 0; start + windowLen <= len; start += hopLen) {
      out.push(toLufs(cum[start + windowLen] - cum[start], windowLen * channels));
    }
    if (out.length === 0) out.push(integrated);
    return {
      values: Float32Array.from(out),
      hopSec: hopLen / targetRate,
      windowSec: windowLen / targetRate,
    };
  };

  const st = series(3, 0.5); // Short-term: 3-s-Fenster
  const mom = series(0.4, 0.1); // Momentary: 400-ms-Fenster

  return {
    integrated,
    shortTerm: st.values,
    hopSec: st.hopSec,
    windowSec: st.windowSec,
    momentary: mom.values,
    momHopSec: mom.hopSec,
    momWindowSec: mom.windowSec,
  };
}

export function mixToMono(buffer) {
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

/**
 * Reduziert die Audiodaten auf `numBuckets` Min/Max-Paare, damit die
 * Waveform performant als Canvas-Balken gezeichnet werden kann, ohne
 * jedes einzelne Sample zu rendern.
 */
export function computePeaks(buffer, numBuckets) {
  const data = buffer.numberOfChannels > 1 ? mixToMono(buffer) : buffer.getChannelData(0);
  const bucketSize = Math.max(1, Math.floor(data.length / numBuckets));
  const peaks = [];
  for (let i = 0; i < numBuckets; i++) {
    let min = 1, max = -1;
    const start = i * bucketSize;
    const end = Math.min(start + bucketSize, data.length);
    for (let j = start; j < end; j++) {
      const v = data[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks.push([min === 1 ? 0 : min, max === -1 ? 0 : max]);
  }
  return peaks;
}
