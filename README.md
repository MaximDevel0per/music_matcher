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
- Kein Backend, keine Persistenz — reiner Frontend-Prototyp.
- Kein Loop-Bereich (z.B. nur den Chorus vergleichen) — möglicher
  nächster Ausbauschritt.
