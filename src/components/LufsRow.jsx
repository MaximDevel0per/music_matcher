import React from "react";

export default function LufsRow({ lufsA, lufsB }) {
  if (lufsA === null || lufsB === null) return null;
  const target = Math.min(lufsA, lufsB);
  const diffA = target - lufsA;
  const diffB = target - lufsB;

  return (
    <div className="abc-lufs-row">
      <div className="abc-lufs-side a">
        <div className="name">A · Mix</div>
        <div className="value">{lufsA.toFixed(1)}</div>
        <div className="adj">{Math.abs(diffA) < 0.05 ? "unchanged" : `adjusted ${diffA.toFixed(1)} dB`}</div>
      </div>
      <div className="abc-lufs-divider">LUFS (approx.)</div>
      <div className="abc-lufs-side b">
        <div className="name">B · Reference</div>
        <div className="value">{lufsB.toFixed(1)}</div>
        <div className="adj">{Math.abs(diffB) < 0.05 ? "unchanged" : `adjusted ${diffB.toFixed(1)} dB`}</div>
      </div>
    </div>
  );
}
