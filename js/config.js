'use strict';
/* Version, Modellnamen, Grenzwerte. Reine Konstanten, keine Logik, kein Key.
   Versionierung: CONFIG.version, das ?v= in index.html (style.css, js/main.js) und
   das ?v= in JEDEM import-Pfad der Module muessen gemeinsam hochgezaehlt werden
   (Suchen und Ersetzen ueber app/). Ein einheitlicher Zusatz ist wichtig: sonst
   entstehen zwei Instanzen desselben Moduls. */
export const CONFIG = {
  version: '0.2.0',

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
  // Quelle (13.11.2026): developers.openai.com/api/docs/models ("GPT-6 Luna for cost-sensitive,
  // high-volume workloads"), .../models/gpt-6-luna, .../guides/structured-outputs, Responses-API-Referenz.
  // CORS am 13.11.2026 geprueft: Preflight und 401-Antwort tragen Access-Control-Allow-Origin: *.
  zuordnenEndpoint: 'https://api.openai.com/v1/responses',   // Responses API, Structured Outputs ueber text.format
  zuordnenModell: 'gpt-6-luna',
  zuordnenReasoning: 'low',        // gpt-6-luna: none|low|medium|high|xhigh|max, Vorgabe der API waere medium
  zuordnenMaxTokens: 6000,         // max_output_tokens: Begrenzung inkl. Reasoning-Token
  zuordnenTimeoutMs: 60000,
  zuordnenWiederholungen: 2,       // unbrauchbare Antwort (Abschnitt 9): so oft nochmal, dann Status 'fehler'
  // USD je 1 Mio. Token laut Modellseite gpt-6-luna (13.11.2026); nur fuer die Kostenanzeige der Testseite
  zuordnenPreise: { eingabe: 0.10, eingabeCache: 0.01, eingabeCacheSchreiben: 0.125, ausgabe: 0.50 },

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
