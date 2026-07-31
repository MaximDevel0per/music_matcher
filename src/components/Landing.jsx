import React from "react";

const FEATURES = [
  {
    title: "Fair by default",
    text: "Loudness is matched automatically, so the louder track doesn’t win. What you hear is the mix, not the level.",
  },
  {
    title: "See what differs",
    text: "Spectrum, stereo width, loudness over time and waveforms — side by side, in panels you can rearrange.",
  },
  {
    title: "Your reference shelf",
    text: "Keep the tracks you always compare against in one place. Sign in once, then pick them from a list.",
  },
];

/**
 * Erste Seite für Besucher ohne Konto. Bewusst keine Sperre: der Vergleich
 * funktioniert auch ohne Anmeldung, ein Konto schaltet nur die Bibliothek frei.
 */
export default function Landing({ onLogin, onRegister, onSkip }) {
  return (
    <div className="abc-landing">
      <div className="abc-eyebrow">Mix ⇄ Reference</div>

      <h1 className="abc-landing-title">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="abc-logo" />
        A/B Comparison
      </h1>

      <p className="abc-landing-lead">
        Compare your mix against a reference track — level-matched, so you judge the balance
        instead of the loudness.
      </p>

      <div className="abc-landing-cta">
        <button className="abc-auth-btn primary abc-cta-main" onClick={onRegister}>
          Create free account
        </button>
        <button className="abc-auth-btn abc-cta-main" onClick={onLogin}>
          Log in
        </button>
      </div>

      <button className="abc-link-btn abc-landing-skip" onClick={onSkip}>
        or try it without an account →
      </button>

      <div className="abc-landing-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="abc-landing-card">
            <div className="abc-landing-card-title">{f.title}</div>
            <p>{f.text}</p>
          </div>
        ))}
      </div>

      <div className="abc-landing-note">
        Your audio is analysed in the browser and never leaves your machine —
        unless you choose to save a track to your library.
      </div>
    </div>
  );
}
