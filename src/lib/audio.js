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

/**
 * Liest Sample-Rate und Bit-Tiefe aus dem Datei-Header. Nötig, weil
 * decodeAudioData alles auf die Rate des AudioContexts (= Audiogerät,
 * oft 48 kHz) resampelt — buffer.sampleRate ist also NICHT die Rate
 * der Datei. Unterstützt WAV, FLAC, OGG (Vorbis/Opus) und MP3.
 * bitDepth gibt es nur bei PCM-Formaten (WAV/FLAC); verlustbehaftete
 * Codecs haben keine feste Bit-Tiefe → null.
 */
export function sniffFormatInfo(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const tag = (off, s) => {
    if (off + s.length > dv.byteLength) return false;
    for (let i = 0; i < s.length; i++) {
      if (dv.getUint8(off + i) !== s.charCodeAt(i)) return false;
    }
    return true;
  };
  const none = { sampleRate: null, bitDepth: null };
  try {
    // WAV: RIFF….WAVE, dann Chunk-Liste bis "fmt "
    if (tag(0, "RIFF") && tag(8, "WAVE")) {
      let off = 12;
      while (off + 8 <= dv.byteLength) {
        const size = dv.getUint32(off + 4, true);
        if (tag(off, "fmt ")) {
          return {
            sampleRate: dv.getUint32(off + 12, true),
            bitDepth: dv.getUint16(off + 22, true), // bitsPerSample
          };
        }
        off += 8 + size + (size & 1);
      }
      return none;
    }
    // FLAC: "fLaC", STREAMINFO-Block (Typ 0): Sample-Rate 20 Bit ab Byte 10,
    // danach 3 Bit Kanäle−1 und 5 Bit Bit-Tiefe−1
    if (tag(0, "fLaC")) {
      let off = 4;
      while (off + 4 <= dv.byteLength) {
        const header = dv.getUint32(off);
        const type = (header >>> 24) & 0x7f;
        const size = header & 0xffffff;
        if (type === 0) {
          const b = off + 4 + 10;
          return {
            sampleRate: (dv.getUint8(b) << 12) | (dv.getUint8(b + 1) << 4) | (dv.getUint8(b + 2) >> 4),
            bitDepth: (((dv.getUint8(b + 2) & 1) << 4) | (dv.getUint8(b + 3) >> 4)) + 1,
          };
        }
        if (header >>> 31) break; // letzter Metadaten-Block
        off += 4 + size;
      }
      return none;
    }
    // OGG: Identification-Header (Vorbis bzw. Opus) in der ersten Page.
    // Bei Opus ist es die ursprüngliche Input-Rate — dekodiert wird immer 48k.
    if (tag(0, "OggS")) {
      const lim = Math.min(dv.byteLength - 16, 300);
      for (let i = 0; i < lim; i++) {
        if (tag(i, "\x01vorbis")) return { sampleRate: dv.getUint32(i + 12, true), bitDepth: null };
        if (tag(i, "OpusHead")) return { sampleRate: dv.getUint32(i + 12, true), bitDepth: null };
      }
      return none;
    }
    // MP4/M4A: Box-Struktur bis zum mdhd der (Audio-)Spur durchlaufen —
    // dessen timescale ist die Sample-Rate
    if (tag(4, "ftyp")) {
      const boxType = (off) => String.fromCharCode(
        dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6), dv.getUint8(off + 7)
      );
      const CONTAINERS = new Set(["moov", "trak", "mdia"]);
      const walk = (start, end) => {
        let off = start;
        while (off + 8 <= end) {
          let size = dv.getUint32(off);
          let hdr = 8;
          if (size === 1) { // 64-bit-Größe; high-Word ignoriert (Dateien < 4 GB)
            size = dv.getUint32(off + 12);
            hdr = 16;
          }
          if (size === 0) size = end - off;
          if (size < hdr || off + size > end) return null;
          const type = boxType(off);
          if (type === "mdhd") {
            const version = dv.getUint8(off + hdr);
            return dv.getUint32(off + hdr + (version === 1 ? 20 : 12));
          }
          if (CONTAINERS.has(type)) {
            const found = walk(off + hdr, off + size);
            if (found) return found;
          }
          off += size;
        }
        return null;
      };
      return { sampleRate: walk(0, dv.byteLength), bitDepth: null };
    }
    // MP3: optionalen ID3v2-Tag überspringen, dann ersten VALIDEN Frame
    // suchen. Ein Sync-Treffer zählt nur, wenn am berechneten Frame-Ende
    // direkt der nächste Frame mit gleicher Rate beginnt — sonst liefern
    // zufällige 0xFF-Bytes (Cover-Art, Fremdformate) falsche Raten.
    let off = 0;
    if (tag(0, "ID3")) {
      const size = (dv.getUint8(6) << 21) | (dv.getUint8(7) << 14) | (dv.getUint8(8) << 7) | dv.getUint8(9);
      off = 10 + size;
    }
    // Sample-Raten je MPEG-Version (Index = Bits 3-2 in Byte 2 des Headers)
    const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
    // Bitraten-Tabellen in kbps: [Layer][Index]; MPEG1 und MPEG2/2.5 getrennt
    const KBPS = {
      mpeg1: {
        1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
      },
      mpeg2: {
        1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
        3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
      },
    };
    const parseFrame = (pos) => {
      if (pos + 4 > dv.byteLength) return null;
      if (dv.getUint8(pos) !== 0xff || (dv.getUint8(pos + 1) & 0xe0) !== 0xe0) return null;
      const b1 = dv.getUint8(pos + 1), b2 = dv.getUint8(pos + 2);
      const version = (b1 >> 3) & 3; // 0=MPEG2.5, 2=MPEG2, 3=MPEG1
      const layerBits = (b1 >> 1) & 3; // 3=I, 2=II, 1=III
      const bitrateIdx = b2 >> 4;
      const rateBits = (b2 >> 2) & 3;
      if (version === 1 || layerBits === 0 || bitrateIdx === 0 || bitrateIdx === 15 || rateBits === 3) return null;
      const sampleRate = RATES[version][rateBits];
      const layer = 4 - layerBits;
      const bitrate = (version === 3 ? KBPS.mpeg1 : KBPS.mpeg2)[layer][bitrateIdx] * 1000;
      const padding = (b2 >> 1) & 1;
      let frameLen;
      if (layer === 1) frameLen = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
      else if (layer === 2 || version === 3) frameLen = Math.floor((144 * bitrate) / sampleRate) + padding;
      else frameLen = Math.floor((72 * bitrate) / sampleRate) + padding; // MPEG2/2.5 Layer III
      return { sampleRate, frameLen };
    };
    const lim = Math.min(dv.byteLength - 4, off + 65536);
    for (; off < lim; off++) {
      const f = parseFrame(off);
      if (!f || f.frameLen < 24) continue;
      const next = parseFrame(off + f.frameLen);
      if (next && next.sampleRate === f.sampleRate) {
        return { sampleRate: f.sampleRate, bitDepth: null };
      }
    }
  } catch {
    // defekter/abgeschnittener Header — Fallback greift
  }
  return none;
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
