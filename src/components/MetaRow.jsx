import React, { useState } from "react";

function fmtKey(key) {
  if (!key) return "—";
  return `${key.name} ${key.mode} · ${key.camelot}`;
}

function fmtBpm(bpm) {
  return bpm ? bpm.toFixed(1) : "—";
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function fmtSampleRate(sr) {
  const khz = sr / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

function fmtChannels(n) {
  if (n === 1) return "Mono";
  if (n === 2) return "Stereo";
  return `${n} channels`;
}

function fmtFormat(meta) {
  // Bit-Tiefe nur bei PCM-Formaten (WAV/FLAC) bekannt
  const bits = meta.bitDepth ? ` · ${meta.bitDepth}-bit` : "";
  const rate = meta.bitrateKbps ? ` · ${Math.round(meta.bitrateKbps)} kbps` : "";
  return `${meta.format}${bits}${rate}`;
}

function fmtCorrelation(stereo) {
  if (!stereo) return "Mono";
  const c = stereo.correlation;
  return `${c >= 0 ? "+" : ""}${c.toFixed(2)}`;
}

function fmtWidth(stereo) {
  if (!stereo) return "Mono";
  return `${Math.round(stereo.width * 100)} % (S/M)`;
}

export default function MetaRow({ metaA, metaB, lufsA, lufsB }) {
  const [open, setOpen] = useState(true);
  if (!metaA || !metaB) return null;

  const rows = [
    { label: "Key", a: fmtKey(metaA.key), b: fmtKey(metaB.key) },
    { label: "BPM", a: fmtBpm(metaA.bpm), b: fmtBpm(metaB.bpm) },
    { label: "Peak", a: `${metaA.peakDb.toFixed(1)} dBFS`, b: `${metaB.peakDb.toFixed(1)} dBFS` },
    // PLR (Peak minus LUFS): grob, wie viel Dynamik-Headroom der Track hat
    { label: "PLR · Dynamics", a: `${(metaA.peakDb - lufsA).toFixed(1)} dB`, b: `${(metaB.peakDb - lufsB).toFixed(1)} dB` },
    // Korrelation: +1 = mono-kompatibel, um 0 = sehr breit, negativ = Phasenprobleme
    { label: "Correlation", a: fmtCorrelation(metaA.stereo), b: fmtCorrelation(metaB.stereo) },
    { label: "Stereo Width", a: fmtWidth(metaA.stereo), b: fmtWidth(metaB.stereo) },
    { label: "Duration", a: fmtDuration(metaA.duration), b: fmtDuration(metaB.duration) },
    { label: "Sample Rate", a: fmtSampleRate(metaA.sampleRate), b: fmtSampleRate(metaB.sampleRate) },
    { label: "Channels", a: fmtChannels(metaA.channels), b: fmtChannels(metaB.channels) },
    { label: "Format", a: fmtFormat(metaA), b: fmtFormat(metaB) },
  ];

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
          Track Details
        </div>
        <div className="abc-meta-hint">
          {open ? "Key & BPM detected automatically (estimate)" : "Click to expand"}
        </div>
      </button>
      {open && rows.map((row) => (
        <div className="abc-meta-line" key={row.label}>
          <div className="val a">{row.a}</div>
          <div className="label">{row.label}</div>
          <div className="val b">{row.b}</div>
        </div>
      ))}
    </div>
  );
}
