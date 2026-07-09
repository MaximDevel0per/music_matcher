import React, { useRef, useEffect, useCallback } from "react";

const MIN_REGION_SEC = 0.1; // kürzere Auswahl gilt als Klick (= Seek)
const DRAG_THRESHOLD_PX = 4;
const LANE_H = 104;
const LANE_GAP = 18;
const TOTAL_H = LANE_H * 2 + LANE_GAP;
const LANES = {
  a: { top: 0, rgb: "242,169,59", hex: "#f2a93b", label: "A · MIX" },
  b: { top: LANE_H + LANE_GAP, rgb: "95,191,179", hex: "#5fbfb3", label: "B · REFERENCE" },
};

/**
 * Beide Tracks als eigene Spuren untereinander. Ziehen in einer Spur
 * markiert die Drop-Region DIESES Tracks; sind beide markiert, loopt
 * jeder Track seine eigene Region (Drop-Vergleichsmodus der Engine).
 */
export default function Waveform({ peaksA, peaksB, active, duration, subscribeFrame, getCurrentOffset, onSeek, dropRegions, onDropChange }) {
  const canvasRef = useRef(null);
  // Laufende Drag-Auswahl lebt in Refs, nicht im State — sie ändert sich
  // bei jeder Mausbewegung und soll keine Re-Renders auslösen.
  const dragRef = useRef(null);
  const dragSelRef = useRef(null);

  const dropMode = dropRegions?.a && dropRegions?.b;

  const draw = useCallback((offset) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    canvas.width = w * dpr;
    canvas.height = TOTAL_H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, TOTAL_H);

    const sel = dragSelRef.current;

    const drawLane = (lane, peaks, isActive) => {
      const { top, rgb, label } = LANES[lane];
      const mid = top + LANE_H / 2;

      // Spur-Hintergrund
      ctx.fillStyle = "rgba(141,138,147,0.06)";
      ctx.fillRect(0, top, w, LANE_H);

      // Drop-Region dieses Tracks (laufende Auswahl hat Vorrang)
      const region = sel?.lane === lane ? sel : dropRegions?.[lane];
      if (region && duration > 0) {
        const x1 = (region.start / duration) * w;
        const x2 = (region.end / duration) * w;
        ctx.fillStyle = `rgba(${rgb},0.15)`;
        ctx.fillRect(x1, top, x2 - x1, LANE_H);
        ctx.fillStyle = `rgba(${rgb},0.85)`;
        ctx.fillRect(x1, top, 1.5, LANE_H);
        ctx.fillRect(x2 - 1.5, top, 1.5, LANE_H);
      }

      // Peaks
      if (peaks) {
        ctx.globalAlpha = isActive ? 0.9 : 0.35;
        ctx.fillStyle = LANES[lane].hex;
        const bw = w / peaks.length;
        for (let i = 0; i < peaks.length; i++) {
          const [min, max] = peaks[i];
          const y1 = mid - max * (LANE_H / 2 - 5);
          const y2 = mid - min * (LANE_H / 2 - 5);
          ctx.fillRect(i * bw, y1, Math.max(bw, 1), Math.max(y2 - y1, 1));
        }
        ctx.globalAlpha = 1;
      }

      // Spur-Label
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = isActive ? `rgba(${rgb},0.95)` : "rgba(141,138,147,0.7)";
      ctx.fillText(label, 5, top + 12);
    };

    drawLane("a", peaksA, active === "A");
    drawLane("b", peaksB, active === "B");

    // Playhead: im Drop-Modus nur in der aktiven Spur (die Positionen der
    // Tracks sind dort unabhängig), sonst über beide Spuren durchgezogen.
    if (duration > 0 && offset >= 0) {
      const x = (offset / duration) * w;
      ctx.fillStyle = "#edeae3";
      if (dropMode) {
        const { top } = LANES[active === "A" ? "a" : "b"];
        ctx.fillRect(x - 1, top, 2, LANE_H);
      } else {
        ctx.fillRect(x - 1, 0, 2, TOTAL_H);
      }
    }
  }, [peaksA, peaksB, active, duration, dropRegions, dropMode]);

  // Meldet sich beim Hook an, um bei jedem Wiedergabe-Frame neu zu zeichnen.
  useEffect(() => {
    draw(getCurrentOffset());
    return subscribeFrame(draw);
  }, [draw, subscribeFrame, getCurrentOffset]);

  useEffect(() => {
    const handleResize = () => draw(getCurrentOffset());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw, getCurrentOffset]);

  const pctFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const laneFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    return y < LANE_H + LANE_GAP / 2 ? "a" : "b";
  };

  const handlePointerDown = (e) => {
    canvasRef.current.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startPct: pctFromEvent(e), lane: laneFromEvent(e), moved: false };
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const pct = pctFromEvent(e);
    const t1 = drag.startPct * duration;
    const t2 = pct * duration;
    dragSelRef.current = { start: Math.min(t1, t2), end: Math.max(t1, t2), lane: drag.lane };
    draw(getCurrentOffset());
  };

  const handlePointerUp = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const sel = dragSelRef.current;
    dragSelRef.current = null;
    if (drag.moved && sel && sel.end - sel.start >= MIN_REGION_SEC) {
      onDropChange(sel.lane, { start: sel.start, end: sel.end });
    } else {
      onSeek(pctFromEvent(e) * duration);
      draw(getCurrentOffset());
    }
  };

  const clearDrops = () => {
    onDropChange("a", null);
    onDropChange("b", null);
  };

  return (
    <div className="abc-wave-box">
      <canvas
        ref={canvasRef}
        height={TOTAL_H}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={clearDrops}
      />
      <div className="abc-wave-hint">
        <span>
          Click: seek · Drag on a track: mark its section · Double-click: clear
        </span>
        <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {dropRegions?.a && (
            <span className="abc-loop-badge" style={{ color: LANES.a.hex }}>
              A {formatTime(dropRegions.a.start)}–{formatTime(dropRegions.a.end)}
            </span>
          )}
          {dropRegions?.b && (
            <span className="abc-loop-badge" style={{ color: LANES.b.hex }}>
              B {formatTime(dropRegions.b.start)}–{formatTime(dropRegions.b.end)}
            </span>
          )}
          {dropMode && <span className="abc-loop-badge">Comparing sections</span>}
        </span>
      </div>
    </div>
  );
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
