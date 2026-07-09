import React, { useRef, useEffect } from "react";
import { formatTime } from "../lib/format.js";

export default function Transport({ isPlaying, duration, onToggle, onSeek, getCurrentOffset, subscribeFrame }) {
  const seekTrackRef = useRef(null);
  const fillRef = useRef(null);
  const labelRef = useRef(null);

  useEffect(() => {
    const updateDom = (offset) => {
      const pct = duration > 0 ? (offset / duration) * 100 : 0;
      if (fillRef.current) fillRef.current.style.width = pct + "%";
      if (labelRef.current) labelRef.current.textContent = `${formatTime(offset)} / ${formatTime(duration)}`;
    };
    updateDom(getCurrentOffset());
    return subscribeFrame(updateDom);
  }, [duration, subscribeFrame, getCurrentOffset]);

  const handleSeekClick = (e) => {
    const rect = seekTrackRef.current.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  };

  return (
    <div className="abc-transport">
      <button className="abc-play-btn" onClick={onToggle} aria-label="Play/Pause">
        <svg viewBox="0 0 24 24" fill="currentColor">
          {isPlaying
            ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            : <path d="M8 5v14l11-7z" />}
        </svg>
      </button>
      <div className="abc-time" ref={labelRef}>0:00 / {formatTime(duration)}</div>
      <div className="abc-seek" ref={seekTrackRef} onClick={handleSeekClick}>
        <div className="abc-seek-fill" ref={fillRef} />
      </div>
    </div>
  );
}
