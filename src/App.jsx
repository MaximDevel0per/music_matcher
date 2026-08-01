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
import AuthBar from "./components/AuthBar.jsx";
import AuthModal from "./components/AuthModal.jsx";
import Landing from "./components/Landing.jsx";
import Library from "./components/Library.jsx";
import { useAuth } from "./hooks/useAuth.js";
import { useLibrary } from "./hooks/useLibrary.js";

const PANEL_IDS = ["lufs", "meta", "loudness", "spectrum", "stereo"];
const ORDER_STORAGE_KEY = "abc-panel-order";
/**
 * Merkt sich, dass jemand die Startseite übersprungen hat — sonst nervt sie
 * bei jedem Reload. Bewusst sessionStorage statt localStorage: das Überspringen
 * gilt nur für die laufende Sitzung. Wer wiederkommt, sieht wieder, worum es
 * geht; eingeloggte Nutzer bekommen die Seite ohnehin nie zu sehen.
 */
const LANDING_STORAGE_KEY = "abc-landing-done";

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
  const auth = useAuth();
  const library = useLibrary(!!auth.user);
  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);
  const [panelOrder, setPanelOrder] = useState(loadPanelOrder);
  const [dragId, setDragId] = useState(null);
  /** "login", "register" oder null (Modal zu). */
  const [authMode, setAuthMode] = useState(null);
  /** true, sobald die Startseite übersprungen wurde (oder schon einmal wurde). */
  const [enteredApp, setEnteredApp] = useState(
    () => sessionStorage.getItem(LANDING_STORAGE_KEY) === "1",
  );

  const skipLanding = () => {
    sessionStorage.setItem(LANDING_STORAGE_KEY, "1");
    setEnteredApp(true);
  };

  // Startseite nur für Besucher ohne Konto, und erst wenn die gespeicherte
  // Sitzung geprüft ist — sonst blitzt sie bei Eingeloggten kurz auf.
  const showLanding = auth.ready && !auth.user && !enteredApp;
  /** "A" | "B", solange der Upload dieses Slots läuft. */
  const [savingSlot, setSavingSlot] = useState(null);
  /** Vorgeschlagener Bibliotheksname je Slot, vom Nutzer änderbar. */
  const [titleA, setTitleA] = useState("");
  const [titleB, setTitleB] = useState("");

  const setFile = (which) => (which === "A" ? setFileA : setFileB);
  const setTitle = (which) => (which === "A" ? setTitleA : setTitleB);

  /** Neue Datei im Slot: Titelvorschlag = Dateiname ohne Endung. */
  const acceptFile = (file, which) => {
    setFile(which)(file);
    setTitle(which)(file.name.replace(/\.[^.]+$/, ""));
    engine.loadFile(file, which);
  };

  /** true, während die Beispiel-Tracks von der Landing Page geladen werden. */
  const [demoLoading, setDemoLoading] = useState(false);

  /**
   * Lädt die mitgelieferten Beispiel-Tracks in beide Slots: derselbe Loop,
   * einmal sauber (Referenz), einmal mit typischen Mix-Fehlern. Statische
   * Dateien aus public/ — funktioniert ohne Konto und ohne Backend.
   */
  const loadDemo = async () => {
    setDemoLoading(true);
    try {
      const fetchDemo = async (path, name) => {
        const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
        if (!res.ok) throw new Error(`Demo track missing: ${path}`);
        return new File([await res.blob()], name, { type: "audio/mpeg" });
      };
      const [mix, ref] = await Promise.all([
        fetchDemo("demo/demo-mix.mp3", "Demo Mix.mp3"),
        fetchDemo("demo/demo-reference.mp3", "Demo Reference.mp3"),
      ]);
      // Erst wenn beide Dateien da sind, die Startseite verlassen —
      // scheitert der Download, bleibt sie einfach stehen.
      skipLanding();
      acceptFile(mix, "A");
      acceptFile(ref, "B");
    } catch (err) {
      console.error(err);
    } finally {
      setDemoLoading(false);
    }
  };

  /** Speichert die im Slot geladene Datei in der Bibliothek. */
  const saveToLibrary = async (which) => {
    const file = which === "A" ? fileA : fileB;
    if (!file) return;
    setSavingSlot(which);
    try {
      // Leer gelassen? Dann setzt das Backend den Dateinamen ohne Endung ein.
      const title = (which === "A" ? titleA : titleB).trim();
      await library.upload(file, title || undefined);
    } catch {
      // Fehlermeldung steht in library.error und wird in <Library> angezeigt
    } finally {
      setSavingSlot(null);
    }
  };

  /** Lädt einen gespeicherten Track in Slot A oder B. */
  const loadFromLibrary = async (track, which) => {
    try {
      const file = await library.download(track);
      setFile(which)(file);
      setTitle(which)(track.title);
      engine.loadFile(file, which);
    } catch {
      // dito
    }
  };

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

  // Leertaste schaltet global zwischen Mix und Referenz um —
  // außer beim Tippen in einem Eingabefeld, sonst käme dort nie ein
  // Leerzeichen an (z.B. im Passwortfeld des Auth-Modals).
  useEffect(() => {
    const handleKey = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
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

  if (showLanding) {
    return (
      <div className="abc-root">
        <div className="abc-wrap">
          <Landing
            onLogin={() => setAuthMode("login")}
            onRegister={() => setAuthMode("register")}
            onSkip={skipLanding}
            onDemo={loadDemo}
            demoLoading={demoLoading}
          />
        </div>

        {authMode && (
          <AuthModal
            mode={authMode}
            onModeChange={setAuthMode}
            onClose={() => setAuthMode(null)}
            onSubmit={authMode === "register" ? auth.register : auth.login}
          />
        )}
      </div>
    );
  }

  return (
    <div className="abc-root">
      <div className="abc-wrap">
        {/* 0. Konto */}
        <AuthBar
          user={auth.user}
          ready={auth.ready}
          onLogin={() => setAuthMode("login")}
          onRegister={() => setAuthMode("register")}
          onLogout={auth.logout}
        />

        {/* 1. Kopf & Einleitung */}
        <div className="abc-header">
          <div className="abc-eyebrow">Mix ⇄ Reference</div>
          <h1>
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="abc-logo" />
            A/B Comparison
          </h1>
          <p>Load your mix and a reference track. Loudness is matched automatically so you can compare fairly.</p>
        </div>

        {/* 2. Dateien laden */}
        <div className="abc-upload-grid">
          <div className="abc-upload-slot">
            <Dropzone
              label="Track A · Your Mix"
              file={fileA}
              buffer={engine.bufferA}
              sampleRate={engine.metaA?.sampleRate}
              variant="a"
              onFile={(f) => acceptFile(f, "A")}
            />
            {auth.user && fileA && (
              <div className="abc-save-row">
                <input
                  className="abc-save-title"
                  value={titleA}
                  onChange={(e) => setTitleA(e.target.value)}
                  placeholder="Name in library"
                  maxLength={200}
                  aria-label="Name for track A in your library"
                />
                <button
                  className="abc-save-btn"
                  disabled={library.busy}
                  onClick={() => saveToLibrary("A")}
                >
                  {savingSlot === "A" ? "Saving…" : "Save to library"}
                </button>
              </div>
            )}
          </div>
          <div className="abc-upload-slot">
            <Dropzone
              label="Track B · Reference"
              file={fileB}
              buffer={engine.bufferB}
              sampleRate={engine.metaB?.sampleRate}
              variant="b"
              onFile={(f) => acceptFile(f, "B")}
            />
            {auth.user && fileB && (
              <div className="abc-save-row">
                <input
                  className="abc-save-title"
                  value={titleB}
                  onChange={(e) => setTitleB(e.target.value)}
                  placeholder="Name in library"
                  maxLength={200}
                  aria-label="Name for track B in your library"
                />
                <button
                  className="abc-save-btn"
                  disabled={library.busy}
                  onClick={() => saveToLibrary("B")}
                >
                  {savingSlot === "B" ? "Saving…" : "Save to library"}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="abc-status">{engine.status}</div>

        {/* Bibliothek nur für eingeloggte Nutzer — die Endpunkte sind geschützt */}
        {auth.user && (
          <Library
            tracks={library.tracks}
            loading={library.loading}
            busy={library.busy}
            error={library.error}
            onLoad={loadFromLibrary}
            onRemove={library.remove}
            onRename={library.rename}
          />
        )}

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

      {authMode && (
        <AuthModal
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={() => setAuthMode(null)}
          onSubmit={authMode === "register" ? auth.register : auth.login}
        />
      )}
    </div>
  );
}
