import React, { useEffect, useRef, useState } from "react";

/** Backend: @MinLength(8) @MaxLength(72) — 72 wegen der bcrypt-Grenze. */
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

/**
 * Login und Registrierung teilen sich ein Formular — die Felder sind
 * identisch, nur Beschriftung und Endpunkt unterscheiden sich.
 */
export default function AuthModal({ mode, onModeChange, onClose, onSubmit }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);

  const isRegister = mode === "register";
  const title = isRegister ? "Sign up" : "Log in";

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Beim Wechsel Login ⇄ Registrierung bleibt die Eingabe stehen,
  // aber die Fehlermeldung des anderen Modus wäre irreführend.
  const switchMode = () => {
    setError(null);
    onModeChange(isRegister ? "login" : "register");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit(email, password);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="abc-modal-backdrop" onMouseDown={onClose}>
      <div
        className="abc-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="abc-modal-head">
          <span className="abc-modal-title">{title}</span>
          <button className="abc-modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" />
            </svg>
          </button>
        </div>

        <form className="abc-modal-body" onSubmit={handleSubmit}>
          <label className="abc-field">
            <span>Email</span>
            <input
              ref={emailRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="abc-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={isRegister ? MIN_PASSWORD : undefined}
              maxLength={MAX_PASSWORD}
              required
            />
          </label>

          {isRegister && (
            <div className="abc-field-hint">At least {MIN_PASSWORD} characters.</div>
          )}

          {error && <div className="abc-form-error">{error}</div>}

          <button className="abc-auth-btn primary abc-submit" type="submit" disabled={busy}>
            {busy ? "Please wait…" : title}
          </button>
        </form>

        <div className="abc-modal-foot">
          {isRegister ? "Already have an account?" : "No account yet?"}{" "}
          <button className="abc-link-btn" type="button" onClick={switchMode}>
            {isRegister ? "Log in" : "Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
}
