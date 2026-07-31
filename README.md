# A/B Vergleich

Web-App zum lautstärke-fairen A/B-Vergleich von zwei Audio-Dateien
(z.B. eigener Mix vs. Referenztrack). Lautstärke wird automatisch per
vereinfachter LUFS-Schätzung (ITU-R BS.1770-Prinzip) angeglichen.

## Setup

```bash
npm install
npm run dev
```

Öffnet auf `http://localhost:5173`.

## Projektstruktur

```
ab-compare/
├── index.html              Vite-Einstiegspunkt
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx             React-Root, rendert <App />
    ├── App.jsx               Hauptkomponente, setzt alles zusammen
    ├── index.css             Globales Styling (Design-Tokens als CSS-Variablen)
    │
    ├── hooks/
    │   └── useABCompare.js   Kompletter Audio-Zustand: AudioContext,
    │                         GainNodes, Wiedergabe, Gain-Matching.
    │                         Die UI-Komponenten wissen nichts von
    │                         Web Audio — sie rufen nur z.B.
    │                         togglePlay() oder seek() auf.
    │
    ├── lib/
    │   ├── audio.js          Reine Funktionen: LUFS-Messung, Waveform-Peaks.
    │   │                     Kein React, keine Seiteneffekte — gut testbar.
    │   └── format.js         formatTime() Hilfsfunktion
    │
    └── components/
        ├── Dropzone.jsx       Datei-Upload per Klick oder Drag & Drop
        ├── LufsRow.jsx        Zeigt LUFS-Werte + Gain-Anpassung an
        ├── ABSwitch.jsx       Der A/B-Umschalter (Klick oder Leertaste)
        ├── Waveform.jsx       Canvas-Waveform mit Playhead, klickbar zum Seeken
        └── Transport.jsx      Play/Pause-Button + Zeitanzeige + Seek-Leiste
```

## Architektur-Hinweis: Playhead-Updates

Die Wiedergabeposition ändert sich ~60x pro Sekunde. Würde man das als
React State abbilden, würde die ganze Komponente 60x/Sekunde neu
rendern. Stattdessen gibt `useABCompare` eine `subscribeFrame(fn)`
Funktion zurück: `Waveform` und `Transport` melden sich unabhängig
voneinander an und aktualisieren nur ihr eigenes DOM-Element direkt
(Canvas neu zeichnen bzw. Textinhalt setzen), ganz ohne React-Rerender.

## Bekannte Einschränkungen

- LUFS-Berechnung ist ungegated (kein volles BS.1770 Gating) —
  ausreichend für den Vergleichszweck, aber kein zertifizierter
  Broadcast-Loudness-Wert.
- Es gibt Login und Registrierung, aber noch keine Persistenz von
  Vergleichen: der Account schaltet bisher keine Funktion frei.
- Kein Loop-Bereich (z.B. nur den Chorus vergleichen) — möglicher
  nächster Ausbauschritt.

## Roadmap

Die leitende Frage: **was bringt der Account?** Aktuell kann man sich
einloggen, und danach passiert dasselbe wie vorher. Die Punkte unter
„Konto nutzbar machen" beantworten genau das und haben deshalb Vorrang.

### Konto nutzbar machen

- [ ] **Referenz-Bibliothek** — beim Mixen vergleicht man immer wieder
      gegen dieselben drei, vier Tracks. Die jedes Mal neu reinzuziehen
      ist die Reibung, die die App wegnehmen kann. Datei-Upload und
      -Auslieferung ist außerdem die Grundlage, auf der die folgenden
      Punkte aufbauen — danach sind sie klein.
  - [ ] Upload (`FileInterceptor` + Multer), Größenlimit, erlaubte Formate prüfen
  - [ ] Datei auf Platte, Pfad + Metadaten in die DB
  - [ ] `GET /tracks` (eigene Bibliothek), `GET /tracks/:id/audio` mit Ownership-Check
  - [ ] Analysewerte (LUFS, Peaks, Dauer) beim Upload einmal speichern,
        damit die Anzeige beim nächsten Mal sofort da ist
  - [ ] Frontend: Dropzone B bekommt „oder aus deiner Bibliothek wählen"
- [ ] **Vergleiche speichern** — Panel-Reihenfolge, EQ-Bänder, Loop-Punkte,
      beide Tracks. „Weitermachen, wo du aufgehört hast."
      Ohne die Bibliothek nur halb sinnvoll, weil die Audiodaten fehlen
      und man nur Zahlen ohne Ton zurückbekommt.
- [ ] **Mix-Versionen** — `v1, v2, v3` desselben Songs, LUFS-Verlauf über
      die Zeit. Wenig Code, sobald Tracks existieren.
- [ ] **Teilbarer Link** — Vergleich read-only für Kunden oder Bandkollegen
      freigeben, per Token statt Login. Die Funktion, die so ein Tool von
      „nettes Spielzeug" zu „benutze ich beruflich" macht.

### Backend-Härtung

- [ ] **`GET /users/all` absichern** — gibt aktuell jedem eingeloggten
      Nutzer alle E-Mail-Adressen. Admin-Rolle mit `@Roles()`-Guard oder
      die Route entfernen. *Zeitnah erledigen.*
- [ ] **Rate-Limit auf `/auth/login`** (`@nestjs/throttler`) — zwei Zeilen,
      verhindert Brute-Force. *Zeitnah erledigen.*
- [ ] **Echte Tests** — die vier `.spec.ts` sind noch die generierten Stubs
      („should be defined"). Unit-Tests für `AuthService` (Login richtig/falsch,
      Passwortwechsel) plus ein e2e-Durchlauf Register → Login → `/users/me`
      mit SQLite in-memory.
- [ ] **Migrations statt `synchronize: true`** — solange noch keine Daten
      drin sind, die weh tun.
- [ ] **Refresh-Token** — Tokens laufen nach 1 h ab, ohne Refresh fliegt man
      kommentarlos raus.
- [ ] **Token aus dem `localStorage` in ein httpOnly-Cookie** — anfällig für
      XSS. Der richtige Zeitpunkt dafür ist zusammen mit dem Refresh-Token;
      dann braucht das CORS-Setup zusätzlich `credentials: true`.
- [ ] **`@CurrentUser()`-Decorator** statt überall `@Request() req` mit
      untypisiertem `req.user.sub`.
- [ ] **Helmet + strukturiertes Logging** mit Request-ID.

### Reines Frontend, ohne Backend

- [ ] **Notizen auf der Zeitachse** — „2:14 Höhen zu hart" direkt an der
      Waveform. Braucht erst mal nur `localStorage`.
- [ ] **Mono-Kompatibilität** — Korrelationswarnung, wenn Bässe in Mono
      verschwinden. Passt zum Stereo-Panel und ist ein echter Mix-Fehler,
      den man leicht übersieht.
- [ ] **Analyse exportieren** — PNG/PDF der Panels für Notizen an sich
      selbst oder an Kunden.
