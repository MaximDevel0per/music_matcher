import React, { useEffect, useState } from "react";
import { useABCompare } from "./hooks/useABCompare.js";
import Dropzone from "./components/Dropzone.jsx";
import LufsRow from "./components/LufsRow.jsx";
import MetaRow from "./components/MetaRow.jsx";
import SpectrumAnalyzer from "./components/SpectrumAnalyzer.jsx";
import StereoAnalyzer from "./components/StereoAnalyzer.jsx";
import ABSwitch from "./components/ABSwitch.jsx";
import Waveform from "./components/Waveform.jsx";
import LoudnessGraph from "./components/LoudnessGraph.jsx";
import Transport from "./components/Transport.jsx";

export default function App() {
  const engine = useABCompare();
  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);

  // Leertaste schaltet global zwischen Mix und Referenz um
  useEffect(() => {
    const handleKey = (e) => {
      if (e.code === "Space" && engine.bufferA && engine.bufferB) {
        e.preventDefault();
        engine.setActive(engine.active === "A" ? "B" : "A");
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [engine]);

  const hasAudio = engine.bufferA || engine.bufferB;
  const showCompare = engine.bufferA && engine.bufferB;

  return (
    <div className="abc-root">
      <div className="abc-wrap">
        {/* 1. Kopf & Einleitung */}
        <div className="abc-header">
          <div className="abc-eyebrow">Mix ⇄ Reference</div>
          <h1>A/B Comparison</h1>
          <p>Load your mix and a reference track. Loudness is matched automatically so you can compare fairly.</p>
        </div>

        {/* 2. Dateien laden */}
        <div className="abc-upload-grid">
          <Dropzone
            label="Track A · Your Mix"
            file={fileA}
            buffer={engine.bufferA}
            variant="a"
            onFile={(f) => { setFileA(f); engine.loadFile(f, "A"); }}
          />
          <Dropzone
            label="Track B · Reference"
            file={fileB}
            buffer={engine.bufferB}
            variant="b"
            onFile={(f) => { setFileB(f); engine.loadFile(f, "B"); }}
          />
        </div>
        <div className="abc-status">{engine.status}</div>

        {/* 3. Wiedergabe: A/B-Umschalter, Transport, Wellenform */}
        {hasAudio && (
          <>
            {showCompare && (
              <ABSwitch active={engine.active} onToggle={engine.setActive} />
            )}
            <Transport
              isPlaying={engine.isPlaying}
              duration={engine.duration}
              onToggle={engine.togglePlay}
              onSeek={engine.seek}
              getCurrentOffset={engine.getCurrentOffset}
              subscribeFrame={engine.subscribeFrame}
            />
            <Waveform
              peaksA={engine.peaksA}
              peaksB={engine.peaksB}
              active={engine.active}
              duration={engine.duration}
              subscribeFrame={engine.subscribeFrame}
              getPositions={engine.getPositions}
              onLaneSeek={engine.seekTrack}
              trackLoops={engine.trackLoops}
              onLoopChange={engine.setTrackLoop}
            />
          </>
        )}

        {/* 4. Analyse: Lautheit, Metadaten, Spektrum, Stereo */}
        {showCompare && (
          <>
            <LufsRow lufsA={engine.lufsA} lufsB={engine.lufsB} />
            <MetaRow
              metaA={engine.metaA}
              metaB={engine.metaB}
              lufsA={engine.lufsA}
              lufsB={engine.lufsB}
            />
            <LoudnessGraph
              loudA={engine.loudA}
              loudB={engine.loudB}
              lufsA={engine.lufsA}
              lufsB={engine.lufsB}
              duration={engine.duration}
              active={engine.active}
              subscribeFrame={engine.subscribeFrame}
              getCurrentOffset={engine.getCurrentOffset}
              onSeek={engine.seek}
            />
            <SpectrumAnalyzer
              getAnalysers={engine.getAnalysers}
              active={engine.active}
              isPlaying={engine.isPlaying}
              avgA={engine.metaA?.avgSpectrum}
              avgB={engine.metaB?.avgSpectrum}
              lufsA={engine.lufsA}
              lufsB={engine.lufsB}
              filterBand={engine.filterBand}
              onFilterChange={engine.setFilterBand}
            />
            <StereoAnalyzer
              getStereoTaps={engine.getStereoTaps}
              active={engine.active}
              isPlaying={engine.isPlaying}
              filterBand={engine.filterBand}
            />

            {/* 5. Zurücksetzen */}
            <div className="abc-reset-row">
              <button className="abc-reset-btn" onClick={() => window.location.reload()}>
                Load new files
              </button>
            </div>
          </>
        )}

        <div className="abc-note">
          Simplified, ungated LUFS estimate based on the ITU-R BS.1770 principle (K-weighting + mean square).<br />
          Not a certified broadcast loudness measurement — but precise enough for A/B comparison.
        </div>
      </div>
    </div>
  );
}
