import React, { useRef, useEffect, useCallback, useState } from "react";

const PLOT_H = 170;

/**
 * Short-Term-Loudness (3-s-Fenster) beider Tracks über die Zeit,
 * zeitlich an der Waveform ausgerichtet. Beide Kurven sind um das
 * LUFS-Matching korrigiert — so sieht man, wo die Referenz dichter
 * arbeitet als der Mix, nicht bloß den Gesamtpegel-Unterschied.
 */
export default function LoudnessGraph({ loudA, loudB, lufsA, lufsB, duration, active, subscribeFrame, getCurrentOffset, onSeek }) {
  const canvasRef = useRef(null);
  const [open, setOpen] = useState(true);

  const draw = useCallback((offset) => {
    const canvas = canvasRef.current;
    if (!canvas || !loudA || !loudB || duration <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = PLOT_H;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Gleiche Lautstärke-Korrektur wie bei der Wiedergabe
    const target = Math.min(lufsA, lufsB);
    const offA = target - lufsA;
    const offB = target - lufsB;

    // Y-Bereich aus beiden (korrigierten) Serien bestimmen, auf max. 30 LU begrenzt
    let lo = Infinity, hi = -Infinity;
    const scan = (loud, off) => {
      for (const v of loud.shortTerm) {
        const c = v + off;
        if (c < -70) continue;
        if (c < lo) lo = c;
        if (c > hi) hi = c;
      }
    };
    scan(loudA, offA);
    scan(loudB, offB);
    if (!isFinite(lo) || !isFinite(hi)) return;
    hi = Math.ceil((hi + 1) / 5) * 5;
    lo = Math.floor((lo - 1) / 5) * 5;
    if (hi - lo > 30) lo = hi - 30;
    const yForLufs = (v) => h - ((Math.max(v, lo) - lo) / (hi - lo)) * (h - 8) - 4;

    // Horizontales LU-Raster
    ctx.font = "9px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    for (let v = lo; v <= hi; v += 5) {
      const y = yForLufs(v);
      ctx.fillStyle = "rgba(141,138,147,0.14)";
      ctx.fillRect(0, y, w, 1);
      ctx.fillStyle = "rgba(141,138,147,0.55)";
      ctx.fillText(`${v}`, 4, y - 3);
    }

    const drawCurve = (loud, off, color, isActive) => {
      const { shortTerm, hopSec, windowSec } = loud;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < shortTerm.length; i++) {
        const t = windowSec / 2 + i * hopSec;
        if (t > duration) break;
        const x = (t / duration) * w;
        const y = yForLufs(shortTerm[i] + off);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = isActive ? 0.95 : 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // Inaktiven Track zuerst zeichnen, aktiver liegt obenauf
    if (active === "A") {
      drawCurve(loudB, offB, "#5fbfb3", false);
      drawCurve(loudA, offA, "#f2a93b", true);
    } else {
      drawCurve(loudA, offA, "#f2a93b", false);
      drawCurve(loudB, offB, "#5fbfb3", true);
    }

    // Playhead
    ctx.fillStyle = "#edeae3";
    ctx.fillRect((offset / duration) * w - 1, 0, 2, h);
  }, [loudA, loudB, lufsA, lufsB, duration, active]);

  useEffect(() => {
    draw(getCurrentOffset());
    return subscribeFrame(draw);
    // `open` als Dependency: nach dem Aufklappen wird der neu
    // eingehängte Canvas sofort einmal gezeichnet.
  }, [draw, subscribeFrame, getCurrentOffset, open]);

  useEffect(() => {
    const handleResize = () => draw(getCurrentOffset());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw, getCurrentOffset]);

  const handleClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  };

  return (
    <div className={`abc-spectrum-box ${open ? "" : "collapsed"}`}>
      <div className="abc-spectrum-head">
        <button type="button" className="abc-box-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`abc-meta-chevron ${open ? "open" : ""}`}>▸</span>
          Loudness Over Time
        </button>
        {open ? (
          <div className="abc-spectrum-legend">
            <span style={{ opacity: active === "A" ? 1 : 0.45 }}>
              <span className="dot" style={{ background: "#f2a93b" }} />A · Mix
            </span>
            <span style={{ opacity: active === "B" ? 1 : 0.45 }}>
              <span className="dot" style={{ background: "#5fbfb3" }} />B · Reference
            </span>
            <span>Short-term (3 s), matched</span>
          </div>
        ) : (
          <div className="abc-meta-hint">Click to expand</div>
        )}
      </div>
      {open && (
        <canvas ref={canvasRef} height={PLOT_H} onClick={handleClick} style={{ cursor: "pointer" }} />
      )}
    </div>
  );
}
