import React, { useEffect, useState } from "react";

// Nur die Panel-Titel dienen als Drag-Griff — so bleiben Canvas-Interaktionen
// (Filter-Drag im Spektrum, Seeking in der Waveform) unangetastet.
const HANDLE_SELECTOR = ".abc-box-toggle, .abc-meta-toggle";

/**
 * Macht ein Panel per Drag & Drop verschiebbar. `draggable` wird erst
 * scharfgeschaltet, wenn der Nutzer auf einem Titel-Element drückt;
 * ein einfacher Klick (Auf-/Zuklappen) funktioniert weiterhin normal.
 * Beim Ziehen über ein anderes Panel wird die Reihenfolge sofort
 * getauscht (Live-Reorder), der Drop bestätigt nur noch.
 */
export default function DraggablePanel({ id, dragId, onDragStart, onDragEnd, onHover, children }) {
  const [armed, setArmed] = useState(false);

  // Griff losgelassen ohne zu ziehen → wieder entschärfen
  useEffect(() => {
    if (!armed) return;
    const disarm = () => setArmed(false);
    window.addEventListener("pointerup", disarm);
    return () => window.removeEventListener("pointerup", disarm);
  }, [armed]);

  return (
    <div
      className={`abc-drag-panel${dragId === id ? " dragging" : ""}`}
      draggable={armed}
      onPointerDown={(e) => setArmed(Boolean(e.target.closest(HANDLE_SELECTOR)))}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        onDragStart(id);
      }}
      onDragEnd={() => {
        setArmed(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        if (dragId === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onHover(id);
      }}
      onDrop={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}
