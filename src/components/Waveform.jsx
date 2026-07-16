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
 * Beide Tracks als eigene Spuren untereinander, jede mit eigenem Playhead —
 * beide Tracks laufen ja immer gleichzeitig. Ziehen in einer Spur loopt
 * diesen Track auf die Auswahl (typisch: die beste Stelle der Referenz),
 * Klick in eine Spur positioniert nur diesen Track. So loopt die Referenz
 * dauerhaft, während man im eigenen Mix frei navigiert und umschaltet.
 */
export default function Waveform({ peaksA, peaksB, active, duration, subscribeFrame, getPositions, onLaneSeek, trackLoops, onLoopChange }) {
  const canvasRef = useRef(null);
  // Laufende Drag-Auswahl lebt in Refs, nicht im State — sie ändert sich
  // bei jeder Mausbewegung und soll keine Re-Renders auslösen.
  const dragRef = useRef(null);
  const dragSelRef = useRef(null);

  const draw = useCallback(() => {
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
    const positions = getPositions();

    const drawLane = (lane, peaks, isActive) => {
      const { top, rgb, label, hex } = LANES[lane];
      const mid = top + LANE_H / 2;

      // Spur-Hintergrund
      ctx.fillStyle = "rgba(141,138,147,0.06)";
      ctx.fillRect(0, top, w, LANE_H);

      // Loop-Region dieses Tracks (laufende Auswahl hat Vorrang)
      const region = sel?.lane === lane ? sel : trackLoops?.[lane];
      if (region && duration > 0) {
        const x1 = (region.start / duration) * w;
        const x2 = (region.end / duration) * w;
        ctx.fillStyle = `rgba(${rgb},0.15)`;
        ctx.fillRect(x1, top, x2 - x1, LANE_H);
        ctx.fillStyle = `rgba(${rgb},0.85)`;
        ctx.fillRect(x1, top, 1.5, LANE_H);
        ctx.fillRect(x2 - 1.5, top, 1.5, LANE_H);
        ctx.font = "9px 'IBM Plex Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("LOOP", x1 + 5, top + LANE_H - 6);
      }

      // Peaks
      if (peaks) {
        ctx.globalAlpha = isActive ? 0.9 : 0.35;
        ctx.fillStyle = hex;
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

      // Eigener Playhead pro Spur — beide Tracks laufen immer parallel,
      // der aktive (hörbare) bekommt die kräftigere Linie.
      const pos = positions[lane];
      if (duration > 0 && pos >= 0 && pos <= duration) {
        const x = (pos / duration) * w;
        ctx.fillStyle = isActive ? "#edeae3" : "rgba(237,234,227,0.4)";
        ctx.fillRect(x - 1, top, 2, LANE_H);
      }
    };

    drawLane("a", peaksA, active === "A");
    drawLane("b", peaksB, active === "B");
  }, [peaksA, peaksB, active, duration, trackLoops, getPositions]);

  // Meldet sich beim Hook an, um bei jedem Wiedergabe-Frame neu zu zeichnen.
  useEffect(() => {
    draw();
    return subscribeFrame(draw);
  }, [draw, subscribeFrame]);

  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

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
    const anchor = drag.startPct * duration;
    const t = pctFromEvent(e) * duration;
    // Loopt die andere Spur bereits, bekommt die Auswahl exakt deren Länge —
    // gleich lange Loops kreisen synchron. Die Auswahl wird dann zum Fenster
    // fester Breite, dessen vordere Kante dem Zeiger folgt.
    const otherLoop = trackLoops?.[drag.lane === "a" ? "b" : "a"];
    if (otherLoop) {
      const len = otherLoop.end - otherLoop.start;
      let start = t >= anchor ? Math.max(anchor, t - len) : Math.min(anchor - len, t);
      start = Math.min(Math.max(0, start), Math.max(0, duration - len));
      dragSelRef.current = { start, end: start + len, lane: drag.lane };
    } else {
      dragSelRef.current = { start: Math.min(anchor, t), end: Math.max(anchor, t), lane: drag.lane };
    }
    draw();
  };

  const handlePointerUp = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const sel = dragSelRef.current;
    dragSelRef.current = null;
    if (drag.moved && sel && sel.end - sel.start >= MIN_REGION_SEC) {
      onLoopChange(sel.lane, { start: sel.start, end: sel.end });
    } else {
      onLaneSeek(drag.lane, pctFromEvent(e) * duration);
      draw();
    }
  };

  const clearLoops = () => {
    if (trackLoops?.a) onLoopChange("a", null);
    if (trackLoops?.b) onLoopChange("b", null);
  };

  return (
    <div className="abc-wave-box">
      <canvas
        ref={canvasRef}
        height={TOTAL_H}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={clearLoops}
      />
      <div className="abc-wave-hint">
        <span>
          Drag on a track: loop that section (a second loop locks to the first one's length and runs in sync) · Click: jump there · Double-click: clear loops
        </span>
        <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {trackLoops?.a && (
            <span className="abc-loop-badge" style={{ color: LANES.a.hex }}>
              Mix loop {formatTime(trackLoops.a.start)}–{formatTime(trackLoops.a.end)}
            </span>
          )}
          {trackLoops?.b && (
            <span className="abc-loop-badge" style={{ color: LANES.b.hex }}>
              Ref loop {formatTime(trackLoops.b.start)}–{formatTime(trackLoops.b.end)}
            </span>
          )}
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
