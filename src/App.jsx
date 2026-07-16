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
import DraggablePanel from "./components/DraggablePanel.jsx";

const PANEL_IDS = ["lufs", "meta", "loudness", "spectrum", "stereo"];
const ORDER_STORAGE_KEY = "abc-panel-order";

// Gespeicherte Reihenfolge laden; unbekannte IDs verwerfen,
// neue (noch nicht gespeicherte) Panels hinten anhängen.
function loadPanelOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) ?? "[]");
    if (Array.isArray(saved)) {
      const valid = saved.filter((id) => PANEL_IDS.includes(id));
      if (valid.length) return [...valid, ...PANEL_IDS.filter((id) => !valid.includes(id))];
    }
  } catch {
    // defekter Eintrag — Standardreihenfolge verwenden
  }
  return PANEL_IDS;
}

export default function App() {
  const engine = useABCompare();
  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);
  const [panelOrder, setPanelOrder] = useState(loadPanelOrder);
  const [dragId, setDragId] = useState(null);

  useEffect(() => {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(panelOrder));
  }, [panelOrder]);

  // Beim Ziehen über ein anderes Panel rückt das gezogene an dessen Position
  const movePanel = (targetId) => {
    setPanelOrder((order) => {
      const from = order.indexOf(dragId);
      const to = order.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return order;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      return next;
    });
  };

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

  const panels = {
    lufs: (
      <LufsRow
        lufsA={engine.lufsA}
        lufsB={engine.lufsB}
        loudA={engine.loudA}
        loudB={engine.loudB}
        getPositions={engine.getPositions}
        subscribeFrame={engine.subscribeFrame}
      />
    ),
    meta: (
      <MetaRow
        metaA={engine.metaA}
        metaB={engine.metaB}
        lufsA={engine.lufsA}
        lufsB={engine.lufsB}
      />
    ),
    loudness: (
      <LoudnessGraph
        loudA={engine.loudA}
        loudB={engine.loudB}
        lufsA={engine.lufsA}
        lufsB={engine.lufsB}
        duration={engine.duration}
        active={engine.active}
        subscribeFrame={engine.subscribeFrame}
        getPositions={engine.getPositions}
        onSeek={engine.seek}
      />
    ),
    spectrum: (
      <SpectrumAnalyzer
        getAnalysers={engine.getAnalysers}
        active={engine.active}
        isPlaying={engine.isPlaying}
        bands={engine.bands}
        onBandChange={engine.setBand}
        onBandToggle={engine.toggleBand}
        onBandsClear={engine.clearBands}
      />
    ),
    stereo: (
      <StereoAnalyzer
        getStereoTaps={engine.getStereoTaps}
        active={engine.active}
        isPlaying={engine.isPlaying}
        filterBands={engine.bands.filter((b) => b.active)}
      />
    ),
  };

  return (
    <div className="abc-root">
      <div className="abc-wrap">
        {/* 1. Kopf & Einleitung */}
        <div className="abc-header">
          <div className="abc-eyebrow">Mix ⇄ Reference</div>
          <h1>
            <img src="/favicon.svg" alt="" className="abc-logo" />
            A/B Comparison
          </h1>
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
            <Transport isPlaying={engine.isPlaying} onToggle={engine.togglePlay} />
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

        {/* 4. Analyse: Lautheit, Metadaten, Spektrum, Stereo —
               per Drag & Drop am Panel-Titel frei anordenbar */}
        {showCompare && (
          <>
            {panelOrder.map((id) => (
              <DraggablePanel
                key={id}
                id={id}
                dragId={dragId}
                onDragStart={setDragId}
                onDragEnd={() => setDragId(null)}
                onHover={movePanel}
              >
                {panels[id]}
              </DraggablePanel>
            ))}

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
