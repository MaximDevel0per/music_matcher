import React, { useRef, useEffect, useCallback } from "react";

const MIN_LOOP_SEC = 0.1; // kürzere Auswahl gilt als Klick (= Seek)
const DRAG_THRESHOLD_PX = 4;

export default function Waveform({ peaksA, peaksB, active, duration, subscribeFrame, getCurrentOffset, onSeek, loopRegion, onLoopChange }) {
  const canvasRef = useRef(null);
  // Laufende Drag-Auswahl lebt in Refs, nicht im State — sie ändert sich
  // bei jeder Mausbewegung und soll keine Re-Renders auslösen.
  const dragRef = useRef(null);
  const dragSelRef = useRef(null);

  const draw = useCallback((offset) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;

    // Loop-Region (bzw. laufende Drag-Auswahl) hinter der Waveform
    const region = dragSelRef.current || loopRegion;
    if (region && duration > 0) {
      const x1 = (region.start / duration) * w;
      const x2 = (region.end / duration) * w;
      ctx.fillStyle = "rgba(237,234,227,0.09)";
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.fillStyle = "rgba(237,234,227,0.5)";
      ctx.fillRect(x1, 0, 1.5, h);
      ctx.fillRect(x2 - 1.5, 0, 1.5, h);
    }

    const drawSet = (peaks, color, alpha) => {
      if (!peaks) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      const bw = w / peaks.length;
      for (let i = 0; i < peaks.length; i++) {
        const [min, max] = peaks[i];
        const y1 = mid - max * (mid - 6);
        const y2 = mid - min * (mid - 6);
        ctx.fillRect(i * bw, y1, Math.max(bw, 1), Math.max(y2 - y1, 1));
      }
      ctx.globalAlpha = 1;
    };

    drawSet(peaksA, "#f2a93b", active === "A" ? 0.9 : 0.25);
    drawSet(peaksB, "#5fbfb3", active === "B" ? 0.9 : 0.25);

    if (duration > 0) {
      const pos = offset / duration;
      ctx.fillStyle = "#edeae3";
      ctx.fillRect(pos * w - 1, 0, 2, h);
    }
  }, [peaksA, peaksB, active, duration, loopRegion]);

  // Meldet sich beim Hook an, um bei jedem Wiedergabe-Frame neu zu zeichnen.
  // subscribeFrame gibt eine Unsubscribe-Funktion zurück, die wir direkt
  // als Cleanup verwenden — ein gängiges React-Pattern.
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

  const handlePointerDown = (e) => {
    canvasRef.current.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startPct: pctFromEvent(e), moved: false };
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const pct = pctFromEvent(e);
    const t1 = drag.startPct * duration;
    const t2 = pct * duration;
    dragSelRef.current = { start: Math.min(t1, t2), end: Math.max(t1, t2) };
    draw(getCurrentOffset());
  };

  const handlePointerUp = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const sel = dragSelRef.current;
    dragSelRef.current = null;
    if (drag.moved && sel && sel.end - sel.start >= MIN_LOOP_SEC) {
      onLoopChange(sel);
    } else {
      onSeek(pctFromEvent(e) * duration);
      draw(getCurrentOffset());
    }
  };

  return (
    <div className="abc-wave-box">
      <canvas
        ref={canvasRef}
        height={120}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => onLoopChange(null)}
      />
      <div className="abc-wave-hint">
        Click: seek · Drag: set loop region · Double-click: clear loop
        {loopRegion && (
          <span className="abc-loop-badge">
            Loop {formatTime(loopRegion.start)}–{formatTime(loopRegion.end)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
