import React, { useRef, useEffect, useCallback, useState } from "react";
import { formatHz } from "../lib/format.js";

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
// Feinheitsgrad: Glättung über die Frequenzachse in Oktavbruchteilen
// (0 = ungefiltert). Standard bei RTA-Analyzern: 1/6 bzw. 1/3 Oktave.
const SMOOTHING_LEVELS = [
  { label: "Fine", octaves: 0 },
  { label: "1/6 oct", octaves: 1 / 6 },
  { label: "1/3 oct", octaves: 1 / 3 },
];

// Gleitender Mittelwert mit Radius r über ein dB-Array (Pixelraster).
// Im Log-Maßstab entspricht ein fester Pixelradius einem konstanten
// Oktavbruchteil — die Glättung wirkt also über alle Lagen gleich.
function smoothArray(arr, r) {
  if (r <= 0) return arr;
  const n = arr.length;
  const out = new Float32Array(n);
  let sum = 0, count = 0;
  for (let i = 0; i < Math.min(n, r + 1); i++) { sum += arr[i]; count++; }
  for (let x = 0; x < n; x++) {
    out[x] = sum / count;
    const add = x + r + 1;
    if (add < n) { sum += arr[add]; count++; }
    const drop = x - r;
    if (drop >= 0) { sum -= arr[drop]; count--; }
  }
  return out;
}
const GRID_FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const GRID_LABELS = { 100: "100", 1000: "1k", 10000: "10k" };
const PLOT_H = 240;
const LABEL_H = 16;
const DIFF_RANGE_DB = 15; // Y-Achse der Differenzansicht: ±15 dB

export default function SpectrumAnalyzer({ getAnalysers, active, isPlaying, avgA, avgB, lufsA, lufsB, filterBand, onFilterChange }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [mode, setMode] = useState("live");
  const [smoothing, setSmoothing] = useState(0);
  const [open, setOpen] = useState(true);
  // Letzte FFT-Daten bleiben erhalten, damit das Bild bei Pause,
  // Resize oder A/B-Umschalten nicht auf Null zurückfällt.
  const dataRef = useRef({ a: null, b: null });
  const dragRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = PLOT_H;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const plotH = h - LABEL_H;
    const xForFreq = (f) => (Math.log(f / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN)) * w;
    const freqForX = (x) => FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, x / w);
    // Glättungsradius in Pixeln aus dem gewählten Oktavbruchteil
    const pxPerOct = w / Math.log2(FREQ_MAX / FREQ_MIN);
    const smoothR = Math.round((pxPerOct * smoothing) / 2);

    // Frequenz-Raster
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    for (const f of GRID_FREQS) {
      const x = xForFreq(f);
      ctx.fillStyle = "rgba(141,138,147,0.14)";
      ctx.fillRect(x, 0, 1, plotH);
      if (GRID_LABELS[f]) {
        ctx.fillStyle = "rgba(141,138,147,0.7)";
        ctx.fillText(GRID_LABELS[f], x, h - 4);
      }
    }

    if (mode === "diff") {
      drawDiff(ctx, w, plotH, freqForX);
    } else {
      drawLive(ctx, w, plotH, freqForX);
    }
    drawBandMask(ctx, w, plotH);

    // Aktiver Frequenz-Fokus: Bereiche außerhalb des Bandes abdunkeln,
    // damit man nur das sieht, was auch zu hören ist.
    function drawBandMask(ctx, w, plotH) {
      if (!filterBand) return;
      const x0 = Math.max(0, xForFreq(filterBand.low));
      const x1 = Math.min(w, xForFreq(filterBand.high));
      ctx.fillStyle = "rgba(23,23,27,0.82)";
      if (x0 > 0) ctx.fillRect(0, 0, x0, plotH);
      if (x1 < w) ctx.fillRect(x1, 0, w - x1, plotH);
      // Bandgrenzen mit Frequenzbeschriftung
      ctx.fillStyle = "rgba(237,234,227,0.45)";
      ctx.fillRect(x0, 0, 1, plotH);
      ctx.fillRect(x1 - 1, 0, 1, plotH);
      ctx.fillStyle = "rgba(237,234,227,0.7)";
      ctx.textAlign = "left";
      ctx.fillText(formatHz(filterBand.low), x0 + 5, 12);
      ctx.textAlign = "right";
      ctx.fillText(formatHz(filterBand.high), x1 - 5, 12);
    }

    function drawLive(ctx, w, plotH, freqForX) {
      const { a, b } = getAnalysers();
      const refAnalyser = a || b;
      const dbMin = refAnalyser ? refAnalyser.minDecibels : -90;
      const dbMax = refAnalyser ? refAnalyser.maxDecibels : -10;
      const yForDb = (db) => {
        const t = Math.min(1, Math.max(0, (db - dbMin) / (dbMax - dbMin)));
        return plotH - t * (plotH - 4);
      };

      // Pegel-Raster (Y-Achse): Linien alle 10 dB, Beschriftung alle 20 dB
      ctx.textAlign = "left";
      for (let db = Math.ceil(dbMin / 10) * 10; db <= dbMax; db += 10) {
        const y = yForDb(db);
        ctx.fillStyle = "rgba(141,138,147,0.10)";
        ctx.fillRect(0, y, w, 1);
        if (db % 20 === 0) {
          ctx.fillStyle = "rgba(141,138,147,0.55)";
          ctx.fillText(`${db}`, 4, y - 3);
        }
      }
      ctx.fillStyle = "rgba(141,138,147,0.7)";
      ctx.fillText("dBFS", 4, 12);

      const readData = (analyser, key) => {
        if (!analyser) return null;
        if (isPlaying) {
          if (!dataRef.current[key] || dataRef.current[key].length !== analyser.frequencyBinCount) {
            dataRef.current[key] = new Float32Array(analyser.frequencyBinCount);
          }
          analyser.getFloatFrequencyData(dataRef.current[key]);
        }
        return dataRef.current[key];
      };

      const drawSpectrum = (analyser, key, color, isActive) => {
        const data = readData(analyser, key);
        if (!data) return;
        const sampleRate = analyser.context.sampleRate;
        const binHz = sampleRate / 2 / data.length;

        // Pro Pixel den lautesten Bin im abgedeckten Frequenzbereich nehmen —
        // im Log-Maßstab decken hohe Pixel viele Bins ab, tiefe weniger als einen.
        // Kurve erst als Pixel-Array berechnen, damit der gewählte
        // Feinheitsgrad (Glättung) darauf angewendet werden kann
        const curve = new Float32Array(w + 1);
        for (let x = 0; x <= w; x++) {
          const f0 = freqForX(x);
          const f1 = freqForX(x + 1);
          const b0 = f0 / binHz;
          let i0 = Math.floor(b0);
          let i1 = Math.ceil(f1 / binHz);
          let db;
          if (i1 - i0 <= 1) {
            // Pixel liegt innerhalb eines Bins: linear interpolieren,
            // sonst entstehen im Bass sichtbare Treppenstufen
            const i = Math.min(Math.max(i0, 0), data.length - 2);
            const frac = Math.min(1, Math.max(0, b0 - i));
            db = data[i] * (1 - frac) + data[i + 1] * frac;
          } else {
            i0 = Math.min(Math.max(i0, 0), data.length - 1);
            i1 = Math.min(i1, data.length);
            db = -Infinity;
            for (let i = i0; i < i1; i++) if (data[i] > db) db = data[i];
          }
          // -Infinity (leere Bins) würde die Glättung vergiften
          curve[x] = Number.isFinite(db) ? db : dbMin;
        }
        const smoothed = smoothArray(curve, smoothR);

        ctx.beginPath();
        ctx.moveTo(0, plotH);
        for (let x = 0; x <= w; x++) ctx.lineTo(x, yForDb(smoothed[x]));
        ctx.lineTo(w, plotH);
        ctx.closePath();
        ctx.globalAlpha = isActive ? 0.22 : 0.08;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = isActive ? 0.95 : 0.35;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      };

      // Inaktiven Track zuerst zeichnen, aktiver liegt obenauf
      if (active === "A") {
        drawSpectrum(b, "b", "#5fbfb3", false);
        drawSpectrum(a, "a", "#f2a93b", true);
      } else {
        drawSpectrum(a, "a", "#f2a93b", false);
        drawSpectrum(b, "b", "#5fbfb3", true);
      }
    }

    function drawDiff(ctx, w, plotH, freqForX) {
      if (!avgA || !avgB) return;
      const midY = plotH / 2;

      // dB-Raster um die Nulllinie
      ctx.textAlign = "left";
      for (const d of [-10, -5, 0, 5, 10]) {
        const y = midY - (d / DIFF_RANGE_DB) * (midY - 4);
        ctx.fillStyle = d === 0 ? "rgba(237,234,227,0.35)" : "rgba(141,138,147,0.14)";
        ctx.fillRect(0, y, w, 1);
        if (d !== 0) {
          ctx.fillStyle = "rgba(141,138,147,0.55)";
          ctx.fillText(`${d > 0 ? "+" : ""}${d}`, 4, y - 3);
        }
      }
      ctx.fillStyle = "rgba(242,169,59,0.7)";
      ctx.fillText("A louder", 4, 12);
      ctx.fillStyle = "rgba(95,191,179,0.7)";
      ctx.fillText("B louder", 4, plotH - 6);

      // Mittelt die dB-Werte der Bins, die ein Pixel im Log-Maßstab abdeckt
      const sampleAvgDb = (spec, f0, f1) => {
        const { db, binHz } = spec;
        const b0 = f0 / binHz;
        const i0 = Math.max(0, Math.floor(b0));
        const i1 = Math.min(db.length, Math.max(i0 + 1, Math.ceil(f1 / binHz)));
        if (i1 - i0 <= 1) {
          const i = Math.min(db.length - 2, i0);
          const frac = Math.min(1, Math.max(0, b0 - i));
          return db[i] * (1 - frac) + db[i + 1] * frac;
        }
        let s = 0;
        for (let i = i0; i < i1; i++) s += db[i];
        return s / (i1 - i0);
      };

      // Beide Tracks werden beim Abspielen auf gleiche LUFS gebracht —
      // dieselbe Korrektur hier, sonst zeigt die Differenz nur den Pegelunterschied.
      const loudnessOffset = lufsB - lufsA;
      const raw = new Float32Array(w + 1);
      for (let x = 0; x <= w; x++) {
        raw[x] = sampleAvgDb(avgA, freqForX(x), freqForX(x + 1))
               - sampleAvgDb(avgB, freqForX(x), freqForX(x + 1))
               + loudnessOffset;
      }
      // Glättung über die Frequenzachse: mindestens leicht (gegen
      // FFT-Zappeln), sonst nach gewähltem Feinheitsgrad
      const smooth = smoothArray(raw, Math.max(2, smoothR));

      const yForDiff = (d) => {
        const c = Math.min(DIFF_RANGE_DB, Math.max(-DIFF_RANGE_DB, d));
        return midY - (c / DIFF_RANGE_DB) * (midY - 4);
      };

      // Fläche zwischen Kurve und Nulllinie, per Clipping zweifarbig gefüllt:
      // oberhalb amber (A lauter), unterhalb teal (B lauter)
      const areaPath = () => {
        ctx.beginPath();
        ctx.moveTo(0, midY);
        for (let x = 0; x <= w; x++) ctx.lineTo(x, yForDiff(smooth[x]));
        ctx.lineTo(w, midY);
        ctx.closePath();
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, midY);
      ctx.clip();
      areaPath();
      ctx.fillStyle = "rgba(242,169,59,0.3)";
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, midY, w, plotH - midY);
      ctx.clip();
      areaPath();
      ctx.fillStyle = "rgba(95,191,179,0.3)";
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        const y = yForDiff(smooth[x]);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(237,234,227,0.85)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [getAnalysers, active, isPlaying, mode, smoothing, avgA, avgB, lufsA, lufsB, filterBand]);

  // Animations-Loop nur im Live-Modus während der Wiedergabe; bei Pause
  // bleibt der letzte Frame stehen. Die Differenzansicht ist statisch.
  useEffect(() => {
    draw();
    if (!isPlaying || mode !== "live") return;
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // `open` als Dependency: nach dem Aufklappen wird der neu
    // eingehängte Canvas sofort einmal gezeichnet.
  }, [draw, isPlaying, mode, open]);

  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  // Band-Auswahl durch Ziehen direkt auf dem Spektrum; einfacher Klick
  // (ohne Ziehen) setzt den Frequenz-Fokus zurück.
  const freqAtEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
  };

  const handlePointerDown = (e) => {
    if (!onFilterChange) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startFreq: freqAtEvent(e), moved: false };
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(e.clientX - drag.startX) > 4) drag.moved = true;
    if (!drag.moved) return;
    const f = freqAtEvent(e);
    let low = Math.min(drag.startFreq, f);
    let high = Math.max(drag.startFreq, f);
    // Mindestbreite ~1/6 Oktave, damit das Band hörbar bleibt
    if (high < low * 1.12) high = low * 1.12;
    onFilterChange({ low: Math.round(low), high: Math.round(Math.min(FREQ_MAX, high)) });
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) onFilterChange(null);
  };

  return (
    <div className={`abc-spectrum-box ${open ? "" : "collapsed"}`}>
      <div className="abc-spectrum-head">
        <button type="button" className="abc-box-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title="Drag to reorder">
          <span className={`abc-meta-chevron ${open ? "open" : ""}`}>▸</span>
          Frequency Spectrum
        </button>
        {open ? (
          <div className="abc-spectrum-tools">
            <div className="abc-spec-toggle">
              <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>Live</button>
              <button className={mode === "diff" ? "on" : ""} onClick={() => setMode("diff")}>Difference A−B</button>
            </div>
            <div className="abc-spec-toggle" title="Smoothing — how much detail the curve shows">
              {SMOOTHING_LEVELS.map((lvl) => (
                <button
                  key={lvl.label}
                  className={smoothing === lvl.octaves ? "on" : ""}
                  onClick={() => setSmoothing(lvl.octaves)}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
            {mode === "live" ? (
              <div className="abc-spectrum-legend">
                <span style={{ opacity: active === "A" ? 1 : 0.45 }}>
                  <span className="dot" style={{ background: "#f2a93b" }} />A · Mix
                </span>
                <span style={{ opacity: active === "B" ? 1 : 0.45 }}>
                  <span className="dot" style={{ background: "#5fbfb3" }} />B · Reference
                </span>
              </div>
            ) : (
              <div className="abc-spectrum-legend">
                <span>Avg. spectrum, loudness-matched</span>
              </div>
            )}
          </div>
        ) : (
          <div className="abc-meta-hint">Click to expand</div>
        )}
      </div>
      {open && (
        <>
          <canvas
            ref={canvasRef}
            height={PLOT_H}
            className="abc-spec-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <div className="abc-eq-hint">
            {filterBand
              ? `Frequency focus ${formatHz(filterBand.low)} – ${formatHz(filterBand.high)}: only this range is audible. Click the spectrum to reset.`
              : "Drag across the spectrum to hear only a frequency range of both tracks."}
          </div>
        </>
      )}
    </div>
  );
}
