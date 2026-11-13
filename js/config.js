'use strict';
/* Version, Modellnamen, Grenzwerte. Reine Konstanten, keine Logik, kein Key.
   Versionierung: CONFIG.version, das ?v= in index.html (style.css, js/main.js) und
   das ?v= in JEDEM import-Pfad der Module muessen gemeinsam hochgezaehlt werden
   (Suchen und Ersetzen ueber app/). Ein einheitlicher Zusatz ist wichtig: sonst
   entstehen zwei Instanzen desselben Moduls. */
export const CONFIG = {
  version: '0.1.0',

  // --- Speicher
  dbName: 'zeiterfassung',
  dbVersion: 1,
  keyStorage: 'zeiterfassung.openaiKey',   // nur localStorage dieses Browsers
  logStorage: 'zeiterfassung.log',

  // --- Tag (Abschnitt 7.1): ein Tag laeuft von tagesStart Uhr bis tagesStart Uhr des Folgetags
  tagesStart: 4,

  // --- Transkription (aus dem Spike)
  transkribierEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
  transkribierModell: 'gpt-transcribe',
  sprachen: ['de'],                // gpt-transcribe: "languages[]" statt "language"
  requestTimeoutMs: 60000,

  // --- Zuordnung: Modellname und Schnittstelle traegt Paket B hier ein.

  // --- Aufnahme (aus dem Spike, unveraendert in der Sache)
  timesliceMs: 1000,               // WebKit liefert bei <=100 ms leere Blobs; 1000 ms ist sicher
  finishGraceMs: 1200,             // Schonfrist ohne Daten nach onstop
  finishGraceWithDataMs: 300,      // Schonfrist mit Daten nach onstop
  stopTimeoutMs: 3000,             // falls onstop nie kommt
  pcmFallback: true,               // paralleler WAV-Mitschnitt, nur genutzt wenn MediaRecorder 0 Bytes liefert
  pcmRate: 16000,
  minRecordingMs: 700,             // kuerzer = versehentliches Antippen -> verwerfen
  maxRecordingMs: 5 * 60 * 1000,   // laenger = automatisch beenden und normal verarbeiten
  streamIdleMs: 30000,             // Mikrofon nach Loslassen so lange offen halten

  // --- Anzeige
  logMaxZeilen: 200,
};
