import React, { useRef, useState } from "react";
import { formatTime } from "../lib/format.js";

export default function Dropzone({ label, file, buffer, sampleRate, onFile, variant }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  };

  const loaded = !!buffer;

  return (
    <div
      className={`abc-dropzone abc-dz-${variant} ${loaded ? "loaded" : ""} ${dragOver ? "dragover" : ""}`}
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); }}
      />
      {!loaded ? (
        <>
          <div className="abc-slot-label">{label}</div>
          <div className="abc-slot-hint">Drag a file here or click</div>
        </>
      ) : (
        <>
          <div className="abc-track-name">{file.name}</div>
          <div className="abc-track-meta">
            {/* sampleRate aus dem Datei-Header — buffer.sampleRate ist auf die Geräte-Rate resampelt */}
            {formatTime(buffer.duration)} · {sampleRate || buffer.sampleRate} Hz · {buffer.numberOfChannels === 2 ? "Stereo" : "Mono"}
          </div>
        </>
      )}
    </div>
  );
}
