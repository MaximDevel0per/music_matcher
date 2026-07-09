import { useState, useRef, useEffect, useCallback } from "react";
import { measureLoudness, computePeaks } from "../lib/audio.js";
import { analyzeTrack } from "../lib/analysis.js";

/**
 * Kapselt den kompletten Audio-Zustand (AudioContext, Buffer, GainNodes,
 * Wiedergabe) hinter einer sauberen API. Die UI-Komponenten müssen nichts
 * über Web Audio wissen — sie rufen nur z.B. togglePlay() oder seek() auf.
 */
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
  const [loopRegion, setLoopRegionState] = useState(null);
  // Frequenz-Fokus: null = volles Spektrum, sonst { low, high } in Hz
  const [filterBand, setFilterBandState] = useState(null);

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
  // Loop-Region auch als Ref, damit rAF-Loop und Offset-Berechnung
  // ohne Re-Render darauf zugreifen können.
  const loopRef = useRef(null);
  const playStateRef = useRef({ startCtxTime: 0, startOffset: 0, pausedOffset: 0 });
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
    // Bandpass-Kette: Hoch- + Tiefpass, jeweils zweifach kaskadiert
    // (24 dB/Okt), in Bypass-Stellung (Grenzfrequenzen an den Rändern
    // des Hörbereichs). setFilterBand fährt alle Ketten synchron nach.
    const mkBandChain = (out) => {
      const mk = (type, freq) => {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = Math.SQRT1_2;
        return f;
      };
      const hp1 = mk("highpass", 10), hp2 = mk("highpass", 10);
      const lp1 = mk("lowpass", 20000), lp2 = mk("lowpass", 20000);
      hp1.connect(hp2); hp2.connect(lp1); lp1.connect(lp2);
      lp2.connect(out);
      return { input: hp1, hp: [hp1, hp2], lp: [lp1, lp2] };
    };
    // Gemeinsame Kette hinter beiden Gains: filtert nur die Wiedergabe.
    // Sitzt NACH dem Haupt-Analyser, damit das Frequenzspektrum weiterhin
    // das volle Signal zeigt (der Fokus wird dort nur optisch maskiert).
    if (!filterChainRef.current) {
      filterChainRef.current = mkBandChain(ctx.destination);
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
      an.fftSize = 4096;
      an.smoothingTimeConstant = 0.85;
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
      // Eigene Bandpass-Kette vor dem Splitter: das Stereobild zeigt so
      // denselben Frequenz-Fokus, den man auch hört.
      const band = mkBandChain(splitter);
      return { input: band.input, hp: band.hp, lp: band.lp, splitter, l, r };
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
      const meta = analyzeTrack(buffer, file);

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

  const getCurrentOffset = useCallback(() => {
    if (!isPlaying) return playStateRef.current.pausedOffset;
    const ctx = getCtx();
    const raw = playStateRef.current.startOffset + (ctx.currentTime - playStateRef.current.startCtxTime);
    // Bei aktivem Loop springt die BufferSource nativ von loopEnd auf
    // loopStart zurück — die lineare Zeitrechnung muss das nachvollziehen.
    const loop = loopRef.current;
    if (loop && raw > loop.end) {
      return loop.start + ((raw - loop.end) % (loop.end - loop.start));
    }
    return raw;
  }, [isPlaying, getCtx]);

  const loopFrame = useCallback(() => {
    const offset = getCurrentOffset();
    if (offset >= duration) {
      stopSources();
      playStateRef.current.pausedOffset = 0;
      setIsPlaying(false);
      notifyFrame(0);
      return;
    }
    notifyFrame(offset);
    rafRef.current = requestAnimationFrame(loopFrame);
  }, [duration, getCurrentOffset, stopSources, notifyFrame]);

  const play = useCallback((offset) => {
    if (!bufferA || !bufferB) return;
    stopSources();
    const ctx = getCtx();
    const srcA = ctx.createBufferSource();
    srcA.buffer = bufferA;
    srcA.connect(analyserARef.current);
    srcA.connect(stereoARef.current.input);
    const srcB = ctx.createBufferSource();
    srcB.buffer = bufferB;
    srcB.connect(analyserBRef.current);
    srcB.connect(stereoBRef.current.input);

    // Natives Looping der BufferSources: sample-genau und ohne Lücke.
    const loop = loopRef.current;
    if (loop) {
      if (offset < loop.start || offset >= loop.end) offset = loop.start;
      [srcA, srcB].forEach((s) => {
        s.loop = true;
        s.loopStart = loop.start;
        s.loopEnd = loop.end;
      });
    }

    const when = ctx.currentTime + 0.06;
    srcA.start(when, offset);
    srcB.start(when, offset);
    srcARef.current = srcA;
    srcBRef.current = srcB;
    playStateRef.current.startCtxTime = when;
    playStateRef.current.startOffset = offset;
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(loopFrame);
  }, [bufferA, bufferB, getCtx, stopSources, loopFrame]);

  const pause = useCallback(() => {
    playStateRef.current.pausedOffset = getCurrentOffset();
    stopSources();
    setIsPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, [getCurrentOffset, stopSources]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play(playStateRef.current.pausedOffset >= duration ? 0 : playStateRef.current.pausedOffset);
  }, [isPlaying, pause, play, duration]);

  const seek = useCallback((offset) => {
    // Bei aktivem Loop bleibt der Playhead innerhalb der Region
    const loop = loopRef.current;
    if (loop) offset = Math.min(Math.max(offset, loop.start), Math.max(loop.start, loop.end - 0.01));
    if (isPlaying) play(offset);
    else {
      playStateRef.current.pausedOffset = offset;
      notifyFrame(offset);
    }
  }, [isPlaying, play, notifyFrame]);

  const setLoopRegion = useCallback((region) => {
    // Offset VOR dem Umschalten berechnen — die Formel hängt von der alten Loop ab
    const current = getCurrentOffset();
    loopRef.current = region;
    setLoopRegionState(region);
    if (isPlaying) {
      // Quellen mit neuer Loop-Konfiguration neu starten
      if (region) {
        play(current >= region.start && current < region.end ? current : region.start);
      } else {
        play(current);
      }
    } else if (region && (current < region.start || current >= region.end)) {
      playStateRef.current.pausedOffset = region.start;
      notifyFrame(region.start);
    }
  }, [isPlaying, getCurrentOffset, play, notifyFrame]);

  const setFilterBand = useCallback((band) => {
    ensureGainNodes();
    const ctx = getCtx();
    const now = ctx.currentTime;
    const nyquist = ctx.sampleRate / 2;
    const low = band ? Math.max(10, Math.min(band.low, nyquist - 100)) : 10;
    const high = band ? Math.max(low, Math.min(band.high, 20000, nyquist - 100)) : Math.min(20000, nyquist - 100);
    // Wiedergabe-Kette und beide Stereo-Abgriffe synchron nachfahren —
    // weich statt hart springen, das vermeidet Zipper-Geräusche
    [filterChainRef.current, stereoARef.current, stereoBRef.current].forEach((chain) => {
      chain.hp.forEach((f) => {
        f.frequency.cancelScheduledValues(now);
        f.frequency.setTargetAtTime(low, now, 0.03);
      });
      chain.lp.forEach((f) => {
        f.frequency.cancelScheduledValues(now);
        f.frequency.setTargetAtTime(high, now, 0.03);
      });
    });
    setFilterBandState(band);
  }, [ensureGainNodes, getCtx]);

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
    active, isPlaying, duration, status, loopRegion, filterBand,
    loadFile, togglePlay, seek, setActive, setLoopRegion, setFilterBand,
    getCurrentOffset, subscribeFrame, getAnalysers, getStereoTaps,
  };
}
