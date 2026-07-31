import React, { useEffect, useRef, useState } from "react";
import { formatBytes } from "../lib/format.js";

/** Wie lange die „Sure?"-Rückfrage stehen bleibt, bevor sie sich zurücksetzt. */
const CONFIRM_TIMEOUT_MS = 4000;

/**
 * Die gespeicherten Referenztracks. Ein Klick auf A oder B lädt den Track
 * in den jeweiligen Slot — von dort an verhält er sich wie eine lokal
 * eingeworfene Datei. Doppelklick auf den Namen benennt um.
 */
export default function Library({ tracks, loading, busy, error, onLoad, onRemove, onRename }) {
  /** ID des Tracks, für den gerade nachgefragt wird — oder null. */
  const [confirmId, setConfirmId] = useState(null);
  /** ID des Tracks, dessen Name gerade bearbeitet wird — oder null. */
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  // Rückfrage nicht ewig stehen lassen: wer weiterscrollt, hat es sich anders
  // überlegt, und ein scharfgeschalteter Löschknopf ist eine Falle.
  useEffect(() => {
    if (confirmId === null) return;
    const timer = setTimeout(() => setConfirmId(null), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirmId]);

  // Ohne das müsste man nach dem Doppelklick erst noch ins Feld klicken.
  useEffect(() => {
    if (editingId !== null) inputRef.current?.select();
  }, [editingId]);

  const startEdit = (track) => {
    setEditingId(track.id);
    setDraft(track.title);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const commitEdit = async () => {
    const id = editingId;
    // Unverändert oder leer? Dann gar nicht erst zum Server.
    if (!draft.trim() || draft === tracks.find((t) => t.id === id)?.title) {
      cancelEdit();
      return;
    }
    try {
      await onRename(id, draft);
      cancelEdit();
    } catch {
      // Feld offen lassen, damit der Text nicht verloren geht.
      // Die Meldung steht oben in der Fehlerzeile.
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div className="abc-library">
      <div className="abc-library-head">
        <span className="abc-library-title">Your library</span>
        <span className="abc-library-count">
          {loading ? "loading…" : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {error && <div className="abc-form-error">{error}</div>}

      {!loading && tracks.length === 0 && !error && (
        <div className="abc-library-empty">
          No saved tracks yet. Load a file above and click “Save to library”.
        </div>
      )}

      <ul className="abc-library-list">
        {tracks.map((track) => (
          <li key={track.id} className="abc-library-row">
            <div className="abc-library-info">
              {editingId === track.id ? (
                <input
                  ref={inputRef}
                  className="abc-library-edit"
                  value={draft}
                  disabled={busy}
                  maxLength={200}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKey}
                  // Klick daneben verwirft — so richtet ein Fehlklick nichts an.
                  onBlur={cancelEdit}
                  aria-label="Track name"
                />
              ) : (
                <div
                  className="abc-library-name"
                  title="Double-click to rename"
                  onDoubleClick={() => startEdit(track)}
                >
                  {track.title}
                </div>
              )}
              <div className="abc-library-meta">
                {formatBytes(track.sizeBytes)} · {new Date(track.createdAt).toLocaleDateString()}
              </div>
            </div>

            <div className="abc-library-actions">
              <button
                className="abc-lib-btn a"
                disabled={busy}
                onClick={() => onLoad(track, "A")}
                title="Load as Track A"
              >
                → A
              </button>
              <button
                className="abc-lib-btn b"
                disabled={busy}
                onClick={() => onLoad(track, "B")}
                title="Load as Track B"
              >
                → B
              </button>

              {/* Eigener Button statt nur Doppelklick: der wäre unsichtbar und
                  per Tastatur gar nicht erreichbar. */}
              <button
                className="abc-lib-btn edit"
                disabled={busy || editingId === track.id}
                onClick={() => startEdit(track)}
                aria-label={`Rename ${track.title}`}
                title="Rename"
              >
                ✎
              </button>

              {/* Zweistufig statt window.confirm: Löschen ist endgültig — der
                  Track verschwindet auch aus dem Bucket. */}
              {confirmId === track.id ? (
                <button
                  className="abc-lib-btn danger"
                  disabled={busy}
                  onClick={() => { setConfirmId(null); onRemove(track.id); }}
                  title="Click again to delete permanently"
                >
                  Sure?
                </button>
              ) : (
                <button
                  className="abc-lib-btn del"
                  disabled={busy}
                  onClick={() => setConfirmId(track.id)}
                  aria-label={`Delete ${track.title}`}
                  title="Delete"
                >
                  ×
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
