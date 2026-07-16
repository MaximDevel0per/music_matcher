import React from "react";

/**
 * Nur Play/Pause: Eine gemeinsame Zeitanzeige/Fortschrittsleiste ergibt
 * keinen Sinn, weil beide Tracks durch unabhängige Loops an verschiedenen
 * Stellen spielen können — die Position zeigt jede Waveform-Spur selbst.
 */
export default function Transport({ isPlaying, onToggle }) {
  return (
    <div className="abc-transport">
      <button className="abc-play-btn" onClick={onToggle} aria-label="Play/Pause">
        <svg viewBox="0 0 24 24" fill="currentColor">
          {isPlaying
            ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            : <path d="M8 5v14l11-7z" />}
        </svg>
      </button>
      <div className="abc-transport-hint">{isPlaying ? "Pause" : "Play"} both tracks</div>
    </div>
  );
}
 