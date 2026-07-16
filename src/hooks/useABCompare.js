import { useState, useRef, useEffect, useCallback } from "react";
import { measureLoudness, computePeaks, sniffFormatInfo } from "../lib/audio.js";
import { analyzeTrack } from "../lib/analysis.js";

/**
 * Kapselt den kompletten Audio-Zustand (AudioContext, Buffer, GainNodes,
 * Wiedergabe) hinter einer sauberen API. Die UI-Komponenten müssen nichts
 * über Web Audio wissen — sie rufen nur z.B. togglePlay() oder seek() auf.
 *
 * Wiedergabemodell: Beide Tracks laufen immer gleichzeitig (der inaktive ist
 * stummgeschaltet). Jeder Track kann unabhängig einen Loop haben — typisch:
 * die Referenz loopt ihre beste Stelle, der eigene Mix läuft frei und wird
 * per Klick beliebig positioniert. Positionen ergeben sich aus einer
 * gemeinsamen Clock plus einer Basis pro Track (Phase bei Loop, sonst
 * absolute Position).
 */
// Drei frei definierbare Frequenzbänder; hörbar ist die Summe der aktiven.
// Sind alle inaktiv, läuft das volle Spektrum.
const DEFAULT_BANDS = [
  { low: 20, high: 250, active: false },
  { low: 250, high: 4000, active: false },
  { low: 4000, high: 20000, active: false },
];

export function useABCompare() {
  const [bufferA, setBufferA] = useState(null);
  const [bufferB, setBufferB] = useState(null);
  const [lufsA, setLufsA] = useState(null);
  const [lufsB, setLufsB] = useState(null);
  const [peaksA, setPeaksA] = useState(null);
  const [peaksB, setPeaksB] = useState(null);
  const [metaA, setMetaA] = useState(null);
  const [metaB, setMetaB] = useState(null);
  const [loudA, setLoudA] = useState(null);
  const [loudB, setLoudB] = useState(null);
  const [active, setActiveState] = useState("A");
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("");
  const [bands, setBandsState] = useState(DEFAULT_BANDS);
  const bandsRef = useRef(DEFAULT_BANDS);
  // Loop pro Track (null = läuft frei). Typischer Einsatz: Referenz (b)
  // loopt eine markierte Stelle, der Mix (a) bleibt frei navigierbar.
  const [trackLoops, setTrackLoopsState] = useState({ a: null, b: null });

  // Alles, was sich pro Audio-Frame ändern würde (Playhead-Position),
  // geht NICHT durch React State — das wären 60 Re-Renders/Sekunde.
  // Stattdessen halten wir es in Refs und benachrichtigen Listener direkt.
  const audioCtxRef = useRef(null);
  const gainARef = useRef(null);
  const gainBRef = useRef(null);
  const analyserARef = useRef(null);
  const analyserBRef = useRef(null);
  const stereoARef = useRef(null);
  const stereoBRef = useRef(null);
  const filterChainRef = useRef(null);
  const srcARef = useRef(null);
  const srcBRef = useRef(null);
  const matchGainRef = useRef({ a: 1, b: 1 });
  const loopsRef = useRef({ a: null, b: null });
  // base = Basis pro Track: Phase (Sekunden seit Regionsstart) bei Loop,
  // sonst absolute Song-Position. Position = Basis + verstrichene Zeit.
  const playStateRef = useRef({ startCtxTime: 0, base: { a: 0, b: 0 } });
  const rafRef = useRef(null);

  // Mehrere UI-Teile (Waveform, Transport) wollen bei jedem Frame
  // informiert werden. Ein Set von Listenern statt eines einzelnen Refs
  // verhindert, dass sich Komponenten gegenseitig überschreiben.
  const frameListenersRef = useRef(new Set());
  const subscribeFrame = useCallback((fn) => {
    frameListenersRef.current.add(fn);
    return () => frameListenersRef.current.delete(fn);
  }, []);
  const notifyFrame = useCallback((offset) => {
    frameListenersRef.current.forEach((fn) => fn(offset));
  }, []);

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  const ensureGainNodes = useCallback(() => {
    const ctx = getCtx();
    // Drei parallele Bandpass-Ketten (Hoch- + Tiefpass, jeweils zweifach
    // kaskadiert = 24 dB/Okt), jede mit eigenem Gate-Gain dahinter.
    // Aktive Bänder werden auf die Ketten verteilt und summiert; ohne
    // aktives Band steht Kette 0 in Bypass-Stellung (volles Spektrum).
    const mkMultiBand = (out) => {
      const mk = (type, freq) => {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = Math.SQRT1_2;
        return f;
      };
      const input = ctx.createGain();
      const chains = [];
      for (let i = 0; i < 3; i++) {
        const hp1 = mk("highpass", 10), hp2 = mk("highpass", 10);
        const lp1 = mk("lowpass", 20000), lp2 = mk("lowpass", 20000);
        const gate = ctx.createGain();
        gate.gain.value = i === 0 ? 1 : 0;
        input.connect(hp1);
        hp1.connect(hp2); hp2.connect(lp1); lp1.connect(lp2);
        lp2.connect(gate); gate.connect(out);
        chains.push({ hp: [hp1, hp2], lp: [lp1, lp2], gate });
      }
      return { input, chains };
    };
    // Gemeinsame Kette hinter beiden Gains: filtert nur die Wiedergabe.
    // Sitzt NACH dem Haupt-Analyser, damit das Frequenzspektrum weiterhin
    // das volle Signal zeigt (der Fokus wird dort nur optisch maskiert).
    if (!filterChainRef.current) {
      filterChainRef.current = mkMultiBand(ctx.destination);
    }
    if (!gainARef.current) {
      gainARef.current = ctx.createGain();
      gainARef.current.connect(filterChainRef.current.input);
    }
    if (!gainBRef.current) {
      gainBRef.current = ctx.createGain();
      gainBRef.current.connect(filterChainRef.current.input);
    }
    // Analyser sitzt VOR dem Gain: so liefert er auch für den gerade
    // stummgeschalteten Track das volle Spektrum.
    const makeAnalyser = () => {
      const an = ctx.createAnalyser();
      // 16k-FFT: ~2,7 Hz pro Bin (bei 44,1 kHz) — löst auch den Bassbereich
      // der logarithmischen Anzeige sauber auf
      an.fftSize = 16384;
      an.smoothingTimeConstant = 0.8;
      an.minDecibels = -90;
      an.maxDecibels = -10;
      return an;
    };
    if (!analyserARef.current) {
      analyserARef.current = makeAnalyser();
      analyserARef.current.connect(gainARef.current);
    }
    if (!analyserBRef.current) {
      analyserBRef.current = makeAnalyser();
      analyserBRef.current.connect(gainBRef.current);
    }
    // Reiner Abgriff für das Goniometer: Splitter + je ein Analyser für
    // L und R (der Haupt-Analyser summiert die Kanäle mono). Geht nicht
    // Richtung Destination, beeinflusst die Wiedergabe also nicht.
    // Mono-Quellen werden vom Splitter automatisch auf L=R hochgemischt.
    const makeStereoTap = () => {
      const splitter = ctx.createChannelSplitter(2);
      const mk = () => {
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        return an;
      };
      const l = mk(), r = mk();
      splitter.connect(l, 0);
      splitter.connect(r, 1);
      // Eigene Filterketten vor dem Splitter: das Stereobild zeigt so
      // dieselben aktiven Bänder, die man auch hört.
      const multiband = mkMultiBand(splitter);
      return { input: multiband.input, multiband, splitter, l, r };
    };
    if (!stereoARef.current) stereoARef.current = makeStereoTap();
    if (!stereoBRef.current) stereoBRef.current = makeStereoTap();
  }, [getCtx]);

  const getAnalysers = useCallback(() => ({
    a: analyserARef.current,
    b: analyserBRef.current,
  }), []);

  const getStereoTaps = useCallback(() => ({
    a: stereoARef.current,
    b: stereoBRef.current,
  }), []);

  const loadFile = useCallback(async (file, which) => {
    setStatus(`Analyzing ${file.name} …`);
    try {
      const ctx = getCtx();
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const loudness = await measureLoudness(buffer);
      const peaks = computePeaks(buffer, 600);
      // Echte Rate/Bit-Tiefe aus dem Datei-Header — der dekodierte
      // Buffer ist bereits auf die Geräte-Rate resampelt
      const meta = analyzeTrack(buffer, file, sniffFormatInfo(arrayBuffer));

      if (which === "A") {
        setBufferA(buffer);
        setLufsA(loudness.integrated);
        setLoudA(loudness);
        setPeaksA(peaks);
        setMetaA(meta);
      } else {
        setBufferB(buffer);
        setLufsB(loudness.integrated);
        setLoudB(loudness);
        setPeaksB(peaks);
        setMetaB(meta);
      }
      setStatus("");
    } catch (err) {
      setStatus("Error reading file: " + err.message);
    }
  }, [getCtx]);

  // Sobald beide Buffer da sind: Dauer + Gain-Matching berechnen
  useEffect(() => {
    if (bufferA && bufferB && lufsA !== null && lufsB !== null) {
      setDuration(Math.min(bufferA.duration, bufferB.duration));
      const target = Math.min(lufsA, lufsB);
      matchGainRef.current = {
        a: Math.pow(10, (target - lufsA) / 20),
        b: Math.pow(10, (target - lufsB) / 20),
      };
      ensureGainNodes();
      gainARef.current.gain.value = active === "A" ? matchGainRef.current.a : 0;
      gainBRef.current.gain.value = active === "B" ? matchGainRef.current.b : 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferA, bufferB, lufsA, lufsB]);

  const stopSources = useCallback(() => {
    [srcARef.current, srcBRef.current].forEach((s) => {
      if (s) {
        try { s.stop(); } catch (e) {}
        try { s.disconnect(); } catch (e) {}
      }
    });
    srcARef.current = null;
    srcBRef.current = null;
  }, []);

  const elapsed = useCallback(() => {
    if (!isPlaying) return 0;
    return getCtx().currentTime - playStateRef.current.startCtxTime;
  }, [isPlaying, getCtx]);

  // Aktuelle Song-Position eines Tracks: geloopte Tracks kreisen in ihrer
  // Region, freie laufen linear.
  const positionOf = useCallback((which) => {
    const e = elapsed();
    const base = playStateRef.current.base[which];
    const r = loopsRef.current[which];
    if (r) return r.start + ((base + e) % (r.end - r.start));
    return base + e;
  }, [elapsed]);

  const getPositions = useCallback(() => ({
    a: positionOf("a"),
    b: positionOf("b"),
  }), [positionOf]);

  // Transport und Loudness-Graph folgen der Mix-Timeline (Track A)
  const getCurrentOffset = useCallback(() => positionOf("a"), [positionOf]);

  // Friert die aktuellen Positionen als neue Basen ein und setzt die Clock
  // zurück — nötig vor jedem Eingriff, der Basen ändert oder Quellen neu startet.
  const freezeBases = useCallback(() => {
    const next = {};
    for (const which of ["a", "b"]) {
      const r = loopsRef.current[which];
      const pos = positionOf(which);
      next[which] = r ? pos - r.start : pos;
    }
    playStateRef.current.base = next;
    playStateRef.current.startCtxTime = getCtx().currentTime;
  }, [positionOf, getCtx]);

  const loopFrame = useCallback(() => {
    const posA = positionOf("a");
    // Nur ein frei laufender Mix beendet die Wiedergabe; geloopte Tracks
    // laufen endlos weiter.
    if (!loopsRef.current.a && posA >= duration) {
      freezeBases();
      playStateRef.current.base.a = 0;
      stopSources();
      setIsPlaying(false);
      notifyFrame(0);
      return;
    }
    notifyFrame(posA);
    rafRef.current = requestAnimationFrame(loopFrame);
  }, [duration, positionOf, freezeBases, stopSources, notifyFrame]);

  // Startet beide Quellen ab den aktuellen Basen in playStateRef.
  const startPlayback = useCallback(() => {
    if (!bufferA || !bufferB) return;
    stopSources();
    const ctx = getCtx();
    const mkSrc = (buffer, analyser, tap) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(analyser);
      src.connect(tap.input);
      return src;
    };
    const srcA = mkSrc(bufferA, analyserARef.current, stereoARef.current);
    const srcB = mkSrc(bufferB, analyserBRef.current, stereoBRef.current);

    const when = ctx.currentTime + 0.06;
    const base = playStateRef.current.base;
    [["a", srcA], ["b", srcB]].forEach(([which, src]) => {
      const r = loopsRef.current[which];
      if (r) {
        // Natives Looping der BufferSource: sample-genau und ohne Lücke
        const len = r.end - r.start;
        src.loop = true;
        src.loopStart = r.start;
        src.loopEnd = r.end;
        base[which] = ((base[which] % len) + len) % len;
        src.start(when, r.start + base[which]);
      } else {
        base[which] = Math.max(0, base[which]);
        src.start(when, base[which]);
      }
    });
    playStateRef.current.startCtxTime = when;
    srcARef.current = srcA;
    srcBRef.current = srcB;
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(loopFrame);
  }, [bufferA, bufferB, getCtx, stopSources, loopFrame]);

  const pause = useCallback(() => {
    freezeBases();
    stopSources();
    setIsPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, [freezeBases, stopSources]);

  const togglePlay = useCallback(() => {
    if (isPlaying) { pause(); return; }
    const base = playStateRef.current.base;
    // Frei laufender Mix am Ende: von vorn (synchron, wenn auch B frei ist)
    if (!loopsRef.current.a && base.a >= duration) {
      base.a = 0;
      if (!loopsRef.current.b) base.b = 0;
    }
    startPlayback();
  }, [isPlaying, pause, startPlayback, duration]);

  // Positioniert EINEN Track. Der andere behält seine Position/Phase —
  // außer beide laufen frei, dann bleiben sie synchron (klassischer Seek).
  const seekTrack = useCallback((which, t) => {
    freezeBases();
    const base = playStateRef.current.base;
    const r = loopsRef.current[which];
    if (r) {
      // Klick in die Region setzt die Phase, außerhalb startet sie von vorn
      base[which] = t >= r.start && t < r.end ? t - r.start : 0;
    } else {
      base[which] = Math.min(Math.max(0, t), duration);
      const other = which === "a" ? "b" : "a";
      if (!loopsRef.current[other]) base[other] = base[which];
    }
    if (isPlaying) startPlayback();
    else notifyFrame(positionOf("a"));
  }, [freezeBases, duration, isPlaying, startPlayback, notifyFrame, positionOf]);

  // Transport/Loudness-Graph steuern die Mix-Timeline
  const seek = useCallback((t) => seekTrack("a", t), [seekTrack]);

  const setTrackLoop = useCallback((which, region) => {
    // Position VOR der Änderung sichern — die Basis-Abbildung ändert sich
    const absPos = positionOf(which);
    freezeBases();
    loopsRef.current = { ...loopsRef.current, [which]: region };
    setTrackLoopsState({ ...loopsRef.current });
    const base = playStateRef.current.base;
    if (region) {
      const other = which === "a" ? "b" : "a";
      const otherLoop = loopsRef.current[other];
      const len = region.end - region.start;
      if (otherLoop && Math.abs(otherLoop.end - otherLoop.start - len) < 0.01) {
        // Gleich lange Loops: Phase des anderen Tracks übernehmen —
        // beide Regionen starten im selben Moment und bleiben synchron
        base[which] = base[other];
      } else if (absPos >= region.start && absPos < region.end) {
        // Liegt die aktuelle Position in der Region, dort weiterlaufen
        base[which] = absPos - region.start;
      } else {
        // sonst am Regionsstart beginnen
        base[which] = 0;
      }
    } else {
      // Loop aufgehoben: ab der aktuellen Stelle frei weiterlaufen
      base[which] = Math.min(Math.max(0, absPos), duration);
    }
    if (isPlaying) startPlayback();
    else notifyFrame(positionOf("a"));
  }, [positionOf, freezeBases, duration, isPlaying, startPlayback, notifyFrame]);

  // Verteilt die aktiven Bänder auf die parallelen Filterketten aller
  // gefilterten Pfade (Wiedergabe + beide Stereo-Abgriffe). Weich statt
  // hart springen, das vermeidet Zipper-Geräusche und Klicks.
  const applyBands = useCallback((nextBands) => {
    ensureGainNodes();
    const ctx = getCtx();
    const now = ctx.currentTime;
    const nyquist = ctx.sampleRate / 2;
    const activeBands = nextBands.filter((b) => b.active);
    const units = [
      filterChainRef.current,
      stereoARef.current.multiband,
      stereoBRef.current.multiband,
    ];
    units.forEach((unit) => {
      unit.chains.forEach((chain, i) => {
        // Ohne aktives Band: Kette 0 als Bypass, Rest stumm
        const band = activeBands.length === 0
          ? (i === 0 ? { low: 10, high: 20000 } : null)
          : activeBands[i] || null;
        const low = band ? Math.max(10, Math.min(band.low, nyquist - 100)) : 10;
        const high = band ? Math.max(low, Math.min(band.high, 20000, nyquist - 100)) : Math.min(20000, nyquist - 100);
        chain.hp.forEach((f) => {
          f.frequency.cancelScheduledValues(now);
          f.frequency.setTargetAtTime(low, now, 0.03);
        });
        chain.lp.forEach((f) => {
          f.frequency.cancelScheduledValues(now);
          f.frequency.setTargetAtTime(high, now, 0.03);
        });
        chain.gate.gain.cancelScheduledValues(now);
        chain.gate.gain.setTargetAtTime(band ? 1 : 0, now, 0.03);
      });
    });
  }, [ensureGainNodes, getCtx]);

  const updateBands = useCallback((mutate) => {
    const next = mutate(bandsRef.current);
    bandsRef.current = next;
    setBandsState(next);
    applyBands(next);
  }, [applyBands]);

  // Bereich eines Bandes neu definieren — das Band wird dabei aktiviert
  const setBand = useCallback((index, range) => {
    updateBands((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...range, active: true } : b))
    );
  }, [updateBands]);

  const toggleBand = useCallback((index) => {
    updateBands((prev) =>
      prev.map((b, i) => (i === index ? { ...b, active: !b.active } : b))
    );
  }, [updateBands]);

  const clearBands = useCallback(() => {
    updateBands((prev) => prev.map((b) => ({ ...b, active: false })));
  }, [updateBands]);

  const setActive = useCallback((track) => {
    if (track === active) return;
    ensureGainNodes();
    const ctx = getCtx();
    const now = ctx.currentTime;
    const targetA = track === "A" ? matchGainRef.current.a : 0;
    const targetB = track === "B" ? matchGainRef.current.b : 0;

    gainARef.current.gain.cancelScheduledValues(now);
    gainARef.current.gain.setValueAtTime(gainARef.current.gain.value, now);
    gainARef.current.gain.linearRampToValueAtTime(targetA, now + 0.008);

    gainBRef.current.gain.cancelScheduledValues(now);
    gainBRef.current.gain.setValueAtTime(gainBRef.current.gain.value, now);
    gainBRef.current.gain.linearRampToValueAtTime(targetB, now + 0.008);

    setActiveState(track);
  }, [active, ensureGainNodes, getCtx]);

  // Aufräumen, wenn die Komponente verschwindet
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopSources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    bufferA, bufferB, lufsA, lufsB, peaksA, peaksB, metaA, metaB, loudA, loudB,
    active, isPlaying, duration, status, bands, trackLoops,
    loadFile, togglePlay, seek, seekTrack, setActive, setTrackLoop,
    setBand, toggleBand, clearBands,
    getCurrentOffset, getPositions, subscribeFrame, getAnalysers, getStereoTaps,
  };
}
