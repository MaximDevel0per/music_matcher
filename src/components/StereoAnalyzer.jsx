import React, { useRef, useEffect, useCallback, useState } from "react";
import { formatHz } from "../lib/format.js";

const PLOT_H = 220;
const COLORS = { a: "#f2a93b", b: "#5fbfb3" };

/**
 * Stereobild-Analyse mit wählbarer Darstellung:
 *  - "gonio":    Goniometer-Punktwolke (45° gedreht — Vertikale = Mono, Horizontale = Seite)
 *  - "lissajous": gleiche Projektion als durchgezogene Lissajous-Spur
 *  - "ms":       Mitte/Seite-Pegelbalken mit Stereobreite in Prozent
 * Rechts daneben in allen Modi das Live-Korrelationsmeter für beide Tracks.
 */
export default function StereoAnalyzer({ getStereoTaps, active, isPlaying, filterBand }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const [mode, setMode] = useState("gonio");
  // Letzte Sample-Blöcke und geglättete Werte überleben Pause/Umschalten
  const blocksRef = useRef({ a: null, b: null });
  const corrRef = useRef({ a: null, b: null });
  const msRef = useRef({ a: null, b: null });

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

    // Visualisierung im Quadrat links, Korrelationsbalken rechts daneben
    const size = h - 16;
    const cx = 8 + size / 2;
    const cy = h / 2;
    const radius = size / 2;

    ctx.font = "9px 'IBM Plex Mono', monospace";

    const taps = getStereoTaps();
    const readBlock = (tap, key) => {
      if (!tap) return null;
      if (isPlaying) {
        const n = tap.l.fftSize;
        if (!blocksRef.current[key] || blocksRef.current[key].l.length !== n) {
          blocksRef.current[key] = { l: new Float32Array(n), r: new Float32Array(n) };
        }
        tap.l.getFloatTimeDomainData(blocksRef.current[key].l);
        tap.r.getFloatTimeDomainData(blocksRef.current[key].r);
      }
      return blocksRef.current[key];
    };

    const drawScopeGrid = () => {
      // Raster: Kreis, Mono-Achse (vertikal), Seiten-Achse (horizontal), L/R-Diagonalen
      ctx.strokeStyle = "rgba(141,138,147,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.strokeStyle = "rgba(141,138,147,0.14)";
      const d = radius * Math.SQRT1_2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
      ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
      ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
      ctx.stroke();
      ctx.fillStyle = "rgba(141,138,147,0.7)";
      ctx.textAlign = "center";
      ctx.fillText("M", cx, cy - radius + 10);
      ctx.fillText("L", cx - d - 8, cy - d);
      ctx.fillText("R", cx + d + 8, cy - d);
    };

    const drawCloud = (block, color, isActive) => {
      if (!block) return;
      ctx.fillStyle = color;
      ctx.globalAlpha = isActive ? 0.3 : 0.09;
      const { l, r } = block;
      for (let i = 0; i < l.length; i += 2) {
        // 45° gedreht: x = Seite, y = Mitte
        const x = (l[i] - r[i]) * Math.SQRT1_2;
        const y = (l[i] + r[i]) * Math.SQRT1_2;
        const px = cx + x * radius;
        const py = cy - y * radius;
        if (Math.abs(px - cx) <= radius && Math.abs(py - cy) <= radius) {
          ctx.fillRect(px, py, 1.4, 1.4);
        }
      }
      ctx.globalAlpha = 1;
    };

    const drawTrace = (block, color, isActive) => {
      if (!block) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = isActive ? 0.55 : 0.14;
      const { l, r } = block;
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      ctx.beginPath();
      for (let i = 0; i < l.length; i++) {
        const x = clamp((l[i] - r[i]) * Math.SQRT1_2);
        const y = clamp((l[i] + r[i]) * Math.SQRT1_2);
        const px = cx + x * radius;
        const py = cy - y * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // Mitte/Seite-RMS eines Blocks, träge geglättet wie die Korrelation
    const midSide = (block, key) => {
      if (!block) return null;
      if (isPlaying) {
        const { l, r } = block;
        let mm = 0, ss = 0;
        for (let i = 0; i < l.length; i++) {
          const m = (l[i] + r[i]) * Math.SQRT1_2;
          const s = (l[i] - r[i]) * Math.SQRT1_2;
          mm += m * m;
          ss += s * s;
        }
        const cur = { mid: Math.sqrt(mm / l.length), side: Math.sqrt(ss / l.length) };
        const prev = msRef.current[key];
        msRef.current[key] = prev === null ? cur : {
          mid: prev.mid * 0.85 + cur.mid * 0.15,
          side: prev.side * 0.85 + cur.side * 0.15,
        };
      }
      return msRef.current[key];
    };

    const drawMidSide = (blockA, blockB) => {
      const x0 = 12;
      const x1 = cx + radius;
      const barW = x1 - x0 - 70; // Platz für dB-Beschriftung rechts
      const toDb = (v) => Math.max(-60, 20 * Math.log10(v + 1e-9));
      const dbToW = (db) => ((db + 60) / 60) * (barW - 38);

      const drawTrack = (key, label, yTop) => {
        const ms = midSide(key === "a" ? blockA : blockB, key);
        const isActive = (key === "a") === (active === "A");
        ctx.globalAlpha = isActive ? 1 : 0.45;

        ctx.fillStyle = COLORS[key];
        ctx.textAlign = "left";
        if (ms) {
          const width = (ms.side / (ms.mid + ms.side + 1e-9)) * 100;
          ctx.fillText(`${label} · Width ${width.toFixed(0)} %`, x0, yTop);
        } else {
          ctx.fillText(label, x0, yTop);
        }

        const rows = [
          { name: "Mid", val: ms ? ms.mid : null },
          { name: "Side", val: ms ? ms.side : null },
        ];
        rows.forEach((row, i) => {
          const y = yTop + 12 + i * 24;
          ctx.fillStyle = "rgba(141,138,147,0.7)";
          ctx.textAlign = "left";
          ctx.fillText(row.name, x0, y + 9);
          ctx.fillStyle = "rgba(141,138,147,0.18)";
          ctx.fillRect(x0 + 38, y, barW - 38, 10);
          if (row.val !== null) {
            const db = toDb(row.val);
            ctx.fillStyle = COLORS[key];
            ctx.fillRect(x0 + 38, y, Math.max(0, dbToW(db)), 10);
            ctx.fillStyle = "rgba(141,138,147,0.85)";
            ctx.textAlign = "left";
            ctx.fillText(`${db.toFixed(1)} dB`, x0 + barW + 8, y + 9);
          }
        });
        ctx.globalAlpha = 1;
      };

      drawTrack("a", "A · Mix", 22);
      drawTrack("b", "B · Reference", h / 2 + 14);
    };

    const correlation = (block, key) => {
      if (!block) return null;
      if (isPlaying) {
        const { l, r } = block;
        let lr = 0, ll = 0, rr = 0;
        for (let i = 0; i < l.length; i++) {
          lr += l[i] * r[i];
          ll += l[i] * l[i];
          rr += r[i] * r[i];
        }
        if (ll > 1e-8 && rr > 1e-8) {
          const c = lr / Math.sqrt(ll * rr);
          const prev = corrRef.current[key];
          // träge glätten, damit die Anzeige nicht flattert
          corrRef.current[key] = prev === null ? c : prev * 0.85 + c * 0.15;
        }
      }
      return corrRef.current[key];
    };

    const blockA = readBlock(taps.a, "a");
    const blockB = readBlock(taps.b, "b");

    if (mode === "ms") {
      drawMidSide(blockA, blockB);
    } else {
      drawScopeGrid();
      const render = mode === "lissajous" ? drawTrace : drawCloud;
      if (active === "A") {
        render(blockB, COLORS.b, false);
        render(blockA, COLORS.a, true);
      } else {
        render(blockA, COLORS.a, false);
        render(blockB, COLORS.b, true);
      }
    }

    // Korrelationsbalken rechts von der Visualisierung
    const barX = cx + radius + 36;
    const barW = w - barX - 16;
    if (barW < 60) return; // zu schmal — nur Visualisierung zeigen

    const drawBar = (key, label, y) => {
      const corr = correlation(key === "a" ? blockA : blockB, key);
      const isActive = (key === "a") === (active === "A");
      ctx.globalAlpha = isActive ? 1 : 0.45;

      ctx.fillStyle = "rgba(141,138,147,0.3)";
      ctx.fillRect(barX, y, barW, 2);
      // Ticks bei −1 / 0 / +1
      ctx.fillRect(barX, y - 4, 1, 10);
      ctx.fillRect(barX + barW / 2, y - 4, 1, 10);
      ctx.fillRect(barX + barW - 1, y - 4, 1, 10);

      ctx.textAlign = "left";
      ctx.fillStyle = COLORS[key];
      ctx.fillText(`${label} · Correlation`, barX, y - 12);
      if (corr !== null) {
        const pos = barX + ((corr + 1) / 2) * barW;
        ctx.fillRect(pos - 1.5, y - 6, 3, 14);
        ctx.textAlign = "right";
        ctx.fillText(`${corr >= 0 ? "+" : ""}${corr.toFixed(2)}`, barX + barW, y - 12);
      }
      ctx.fillStyle = "rgba(141,138,147,0.7)";
      ctx.textAlign = "left";
      ctx.fillText("−1", barX, y + 16);
      ctx.textAlign = "center";
      ctx.fillText("0", barX + barW / 2, y + 16);
      ctx.textAlign = "right";
      ctx.fillText("+1", barX + barW, y + 16);
      ctx.globalAlpha = 1;
    };

    drawBar("a", "A", h * 0.32);
    drawBar("b", "B", h * 0.75);
  }, [getStereoTaps, active, isPlaying, mode]);

  useEffect(() => {
    draw();
    if (!isPlaying) return;
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, isPlaying]);

  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  return (
    <div className="abc-spectrum-box">
      <div className="abc-spectrum-head">
        <div className="abc-spectrum-title">
          Stereo Image{filterBand ? ` · ${formatHz(filterBand.low)} – ${formatHz(filterBand.high)}` : ""}
        </div>
        <div className="abc-spectrum-tools">
          <div className="abc-spec-toggle">
            <button className={mode === "gonio" ? "on" : ""} onClick={() => setMode("gonio")}>Dots</button>
            <button className={mode === "lissajous" ? "on" : ""} onClick={() => setMode("lissajous")}>Lines</button>
            <button className={mode === "ms" ? "on" : ""} onClick={() => setMode("ms")}>Width</button>
          </div>
          <div className="abc-spectrum-legend">
            <span style={{ opacity: active === "A" ? 1 : 0.45 }}>
              <span className="dot" style={{ background: COLORS.a }} />A · Mix
            </span>
            <span style={{ opacity: active === "B" ? 1 : 0.45 }}>
              <span className="dot" style={{ background: COLORS.b }} />B · Reference
            </span>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} height={PLOT_H} />
    </div>
  );
}
