import React, { useEffect, useRef, useState } from "react";

// Wert eines vorberechneten Loudness-Verlaufs an Position t.
// Wie bei einem echten Meter zählt das Fenster, das bei t ENDET
// (die letzten 400 ms bzw. 3 s vor der aktuellen Position).
function valueAt(series, hopSec, windowSec, t) {
  if (!series || !series.length) return null;
  const idx = Math.round((t - windowSec) / hopSec);
  return series[Math.min(series.length - 1, Math.max(0, idx))];
}

export default function LufsRow({ lufsA, lufsB, loudA, loudB, getPositions, subscribeFrame }) {
  const [open, setOpen] = useState(true);
  // Live-Werte gehen direkt in die DOM-Knoten statt durch React-State —
  // das wären sonst Re-Renders bei jedem Wiedergabe-Frame.
  const liveRefs = useRef({});

  useEffect(() => {
    if (!loudA || !loudB) return;
    let last = 0;
    const update = (force) => {
      // Text nicht 60×/s wechseln lassen — ~7 Updates/s reichen zum Ablesen
      const now = performance.now();
      if (!force && now - last < 150) return;
      last = now;
      const pos = getPositions();
      const set = (key, v) => {
        const el = liveRefs.current[key];
        if (el) el.textContent = v === null ? "—" : v.toFixed(1);
      };
      set("mA", valueAt(loudA.momentary, loudA.momHopSec, loudA.momWindowSec, pos.a));
      set("sA", valueAt(loudA.shortTerm, loudA.hopSec, loudA.windowSec, pos.a));
      set("mB", valueAt(loudB.momentary, loudB.momHopSec, loudB.momWindowSec, pos.b));
      set("sB", valueAt(loudB.shortTerm, loudB.hopSec, loudB.windowSec, pos.b));
    };
    update(true);
    return subscribeFrame(() => update(false));
    // `open` als Dependency: nach dem Aufklappen werden die neu
    // eingehängten Wert-Knoten sofort einmal befüllt.
  }, [loudA, loudB, getPositions, subscribeFrame, open]);

  if (lufsA === null || lufsB === null) return null;
  const target = Math.min(lufsA, lufsB);
  const adjText = (diff) =>
    Math.abs(diff) < 0.05 ? "unchanged" : `adjusted ${diff.toFixed(1)} dB`;

  // Gleiche Zeilen-Darstellung wie "Track Details":
  // Wert A links, Label mittig, Wert B rechts
  const liveRow = (label, keyA, keyB, hint) => (
    <div className="abc-meta-line" title={hint}>
      <div className="val a" ref={(el) => (liveRefs.current[keyA] = el)}>—</div>
      <div className="label">{label}</div>
      <div className="val b" ref={(el) => (liveRefs.current[keyB] = el)}>—</div>
    </div>
  );

  return (
    <div className={`abc-meta-box ${open ? "" : "collapsed"}`}>
      <button
        type="button"
        className="abc-meta-head abc-meta-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Drag to reorder"
      >
        <div className="abc-spectrum-title">
          <span className={`abc-meta-chevron ${open ? "open" : ""}`}>▸</span>
          Loudness (LUFS)
        </div>
        <div className="abc-meta-hint">
          {open ? "Momentary & short-term follow playback (approx.)" : "Click to expand"}
        </div>
      </button>
      {open && (
        <>
          {liveRow("Momentary", "mA", "mB", "Loudness of the last 400 ms")}
          {liveRow("Short-term", "sA", "sB", "Loudness of the last 3 s")}
          <div className="abc-meta-line" title="Average loudness of the whole track">
            <div className="val a">{lufsA.toFixed(1)}</div>
            <div className="label">Integrated</div>
            <div className="val b">{lufsB.toFixed(1)}</div>
          </div>
          <div className="abc-meta-line" title="Gain applied so both tracks play equally loud">
            <div className="val a">{adjText(target - lufsA)}</div>
            <div className="label">Matching</div>
            <div className="val b">{adjText(target - lufsB)}</div>
          </div>
        </>
      )}
    </div>
  );
}
