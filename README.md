# Zeiterfassung per Sprache

Kleine Web-App für eine Freiberuflerin: Button halten, frei erzählen, was seit dem letzten Eintrag passiert ist, loslassen. Die App transkribiert, ordnet die Tätigkeiten vordefinierten Töpfen (Kunden, Privat …) zu, legt sie als Zeitblöcke auf den Tag und zeigt sie zur Korrektur. Eine Auswertung zeigt Tagesverlauf und Anteile. Gedacht als Homescreen-App auf dem iPhone, live unter <https://roozalad.github.io/timetracker/>.

Reines HTML, CSS und JavaScript mit ES-Modulen. Kein Framework, kein Build, keine Bibliotheken.

## Datenschutz

Alle Daten (Töpfe, Einträge, Zeitblöcke) liegen nur auf dem Gerät in IndexedDB; der OpenAI-API-Key steht nur im lokalen Speicher des Browsers, nie im Code oder Export. Das Gerät verlassen nur die Audioaufnahme (an die Transkription) und das Transkript mit den Stichworten der Töpfe (an die Zuordnung), beides direkt an `api.openai.com`; die Audiodatei wird nach der Transkription gelöscht. Eine Content-Security-Policy erlaubt Inhalte nur von der eigenen Adresse und Verbindungen nur zu `https://api.openai.com`.

## Testen

- `tests.html`: alle Tests, rein lokal, ohne Netz und ohne Key. Muss grün sein. Lokal starten, z. B. `py -m http.server 8781 --bind 127.0.0.1` im Ordner dieser Datei, dann <http://127.0.0.1:8781/tests.html>.
- `prompt-test.html`: prüft den Zuordnungs-Prompt gegen die echte API. Braucht einen eigenen OpenAI-Key, der nur im Browser bleibt und Kosten verursacht.
- `testdaten.html`: spielt 14 Tage Beispieldaten ein. **Warnung:** arbeitet auf der echten Datenbank des Browsers für diese Adresse. Nur auf einem Testgerät oder mit eigenem Port benutzen.
- Der Service Worker hält Dateien je Version vor. Beim Entwickeln ohne Versionssprung also in den Entwicklerwerkzeugen den Service Worker abmelden und den Speicher löschen, sonst sieht man alte Dateien.

## Version heben

Eine Zahl, überall gleich: `CONFIG.version` in `js/config.js`, `?v=` in `index.html` und in jedem Import, `VERSION` in `sw.js` (auch `prompt-test.html`, `testdaten.html` und die Tests). Am einfachsten Suchen und Ersetzen über den ganzen Ordner, z. B. `0.4.0` → `0.4.1`, danach `tests.html` laufen lassen (`tests/offline.test.js` prüft, dass alle Versionen gleich sind und die Dateiliste in `sw.js` vollständig ist). Neue Datei der App: auch in die Liste in `sw.js` eintragen.

Veröffentlichen: Ordner ins Repository, GitHub Pages aus dem Hauptzweig. `.nojekyll` verhindert, dass Pages etwas umbaut. Eine neue Version kommt beim nächsten Start mit Netz an; offline läuft die zuletzt vorgehaltene Fassung.
