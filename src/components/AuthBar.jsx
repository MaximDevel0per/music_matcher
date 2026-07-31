import React from "react";

/** Leiste oben rechts: eingeloggt zeigt sie die E-Mail, sonst die beiden Buttons. */
export default function AuthBar({ user, ready, onLogin, onRegister, onLogout }) {
  // Solange die gespeicherte Sitzung geprüft wird, den Platz freihalten,
  // statt kurz "Log in" zu zeigen und dann auf die E-Mail umzuspringen.
  if (!ready) return <div className="abc-authbar" />;

  if (user) {
    return (
      <div className="abc-authbar">
        <span className="abc-auth-user" title={user.email}>{user.email}</span>
        <button className="abc-auth-btn" onClick={onLogout}>Log out</button>
      </div>
    );
  }

  return (
    <div className="abc-authbar">
      <button className="abc-auth-btn" onClick={onLogin}>Log in</button>
      <button className="abc-auth-btn primary" onClick={onRegister}>Sign up</button>
    </div>
  );
}
