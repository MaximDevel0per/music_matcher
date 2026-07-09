import React from "react";

export default function ABSwitch({ active, onToggle }) {
  return (
    <div className="abc-switch-zone">
      <div
        className={`abc-switch ${active === "B" ? "on-b" : ""}`}
        onClick={() => onToggle(active === "A" ? "B" : "A")}
      >
        <div className="abc-labels">
          <span className={`a ${active === "A" ? "on" : ""}`}>MIX</span>
          <span className={`b ${active === "B" ? "on" : ""}`}>REF</span>
        </div>
        <div className="abc-knob" />
      </div>
      <div className="abc-hotkey">Toggle with <kbd>Space</kbd></div>
    </div>
  );
}
