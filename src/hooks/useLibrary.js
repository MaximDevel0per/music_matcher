import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiFetchBlob } from "../lib/api.js";

/**
 * Die gespeicherte Track-Bibliothek eines Nutzers.
 *
 * Alle Endpunkte sind geschützt, deshalb hängt der Hook am Login-Zustand:
 * ohne `enabled` wird nichts geladen und die Liste bleibt leer.
 */
export function useLibrary(enabled) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false); // Upload oder Löschen läuft
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setTracks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setTracks(await apiFetch("/track"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  // Beim Ein- und Ausloggen neu laden bzw. leeren
  useEffect(() => {
    reload();
  }, [reload]);

  /** Lädt eine Datei hoch und hängt den neuen Track vorne an die Liste. */
  const upload = useCallback(
    async (file, title) => {
      setBusy(true);
      setError(null);
      try {
        const form = new FormData();
        // Der Feldname muss "file" heißen — so steht es im FileInterceptor.
        form.append("file", file);
        if (title) form.append("title", title);

        const created = await apiFetch("/track", { method: "POST", body: form });
        setTracks((prev) => [created, ...prev]);
        return created;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const remove = useCallback(async (id) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/track/${id}`, { method: "DELETE" });
      setTracks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Benennt einen Track um. Übernommen wird der Track, den der Server
   * zurückgibt — nicht der eingetippte Text: der Server trimmt, und dann
   * würden Anzeige und gespeicherter Wert auseinanderlaufen.
   */
  const rename = useCallback(async (id, newTitle) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await apiFetch(`/track/${id}`, { method: "PATCH", body: { newTitle } });
      setTracks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Holt die Audiodaten und verpackt sie wieder als File — damit kann
   * `engine.loadFile` sie genauso verarbeiten wie eine per Drag & Drop
   * eingeworfene Datei. Die Analyse passiert dann wie gewohnt im Browser.
   *
   * Der Dateiname wird aus dem Bibliothekstitel gebaut, damit die Dropzone
   * nach dem Umbenennen den neuen Namen zeigt. Die Endung muss dabei erhalten
   * bleiben: analyzeTrack() liest daraus das Format (WAV, FLAC, …).
   */
  const download = useCallback(async (track) => {
    const blob = await apiFetchBlob(`/track/${track.id}/audio`);

    const dot = track.originalName.lastIndexOf(".");
    const ext = dot > 0 ? track.originalName.slice(dot) : "";
    const name = ext && !track.title.toLowerCase().endsWith(ext.toLowerCase())
      ? `${track.title}${ext}`
      : track.title;

    return new File([blob], name, { type: track.mimeType });
  }, []);

  return { tracks, loading, busy, error, reload, upload, remove, rename, download };
}
