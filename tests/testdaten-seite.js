'use strict';
/* Testdaten-Seite (Paket F): spielt Testdaten in die ECHTE App-Datenbank dieses Browsers ein oder entfernt sie.
   Entfernt wird nur, was mit testdaten: true markiert ist. Keine Netzaufrufe, kein Key. */
import { erzeugeTestdaten, zufallsgenerator } from './testdaten.js?v=0.4.0';
import { ABLAGEN, transaktion, listToepfe, listEintraege, listSegmente } from '../js/db.js?v=0.4.0';

const SAATGUT = 20261114; // fester Startwert: gleiche Testdaten bei jedem Einspielen (bis auf die Uhrzeiten, die vom Jetzt abhaengen)
const $ = (id) => document.getElementById(id);

function meldung(text, fehler = false) {
  const m = $('meldung');
  m.textContent = text;
  m.className = fehler ? 'hinweis' : ''; // vorhandene Klasse, sieht aus wie die Hinweise der App
}

function knoepfeAn(an) {
  $('einspielen').disabled = !an;
  $('entfernen').disabled = !an;
}

/** Zaehlt die Testdaten und alles im Speicher; schaltet "Entfernen" aus, wenn nichts da ist. */
async function zaehle() {
  const eintraege = await listEintraege();
  const segmente = await listSegmente();
  const te = eintraege.filter((e) => e.testdaten === true).length;
  const ts = segmente.filter((s) => s.testdaten === true).length;
  $('stand').textContent = `Im Speicher dieses Browsers: ${te} Testeinträge und ${ts} Testblöcke. Insgesamt ${eintraege.length} Einträge und ${segmente.length} Blöcke.`;
  $('entfernen').disabled = te + ts === 0;
}

/** Schreibt Einträge und Blöcke in EINER Transaktion; die Blöcke bekommen die neue Id ihres Eintrags. */
async function schreibeTestdaten({ eintraege, segmente }) {
  const blockeZuEintrag = new Map();
  for (const s of segmente) {
    if (!blockeZuEintrag.has(s.eintragId)) blockeZuEintrag.set(s.eintragId, []);
    blockeZuEintrag.get(s.eintragId).push(s);
  }
  await transaktion([ABLAGEN.eintraege, ABLAGEN.segmente], 'readwrite', (s) => {
    for (const e of eintraege) {
      const { id, ...ohneId } = e;
      const r = s.eintraege.add(ohneId);
      r.onsuccess = () => {
        for (const seg of blockeZuEintrag.get(id) || []) {
          const { id: _alt, eintragId: _x, ...rest } = seg;
          s.segmente.add({ ...rest, eintragId: r.result });
        }
      };
    }
  });
}

async function einspielen() {
  if (!confirm('ACHTUNG: Das schreibt in die ECHTE App-Datenbank dieses Browsers. Testdaten für 14 Tage werden hinzugefügt. Fortfahren?')) return;
  knoepfeAn(false);
  try {
    const bestand = await listSegmente();
    if (bestand.some((s) => s.testdaten === true)) {
      meldung('Es sind schon Testdaten da. Bitte zuerst „Testdaten entfernen“ drücken.', true);
      return;
    }
    const toepfe = await listToepfe();
    const daten = erzeugeTestdaten({ ende: Date.now(), tage: 14, toepfe, zufall: zufallsgenerator(SAATGUT) });
    // Grundregel: keine Überlappung mit echten Blöcken. Im Zweifel nichts schreiben.
    const kollisionen = daten.segmente.filter((n) => bestand.some((v) => v.start < n.ende && n.start < v.ende)).length;
    if (kollisionen > 0) {
      meldung(`${kollisionen} neue Testblöcke würden echte Blöcke überschneiden. Nichts eingespielt.`, true);
      return;
    }
    await schreibeTestdaten(daten);
    meldung(`${daten.eintraege.length} Einträge und ${daten.segmente.length} Blöcke eingespielt.`);
  } catch (e) {
    meldung(`Fehler beim Einspielen: ${(e && e.message) || e}`, true);
  } finally {
    knoepfeAn(true);
    await zaehleSicher();
  }
}

async function entfernen() {
  if (!confirm('Alle Testdaten entfernen? Nur Einträge und Blöcke mit der Markierung „testdaten“ werden gelöscht. Echte Daten bleiben.')) return;
  knoepfeAn(false);
  const n = { eintraege: 0, segmente: 0 };
  try {
    await transaktion([ABLAGEN.eintraege, ABLAGEN.segmente], 'readwrite', (s) => {
      const re = s.eintraege.getAll();
      re.onsuccess = () => {
        for (const e of re.result) if (e.testdaten === true) { s.eintraege.delete(e.id); n.eintraege++; }
      };
      const rs = s.segmente.getAll();
      rs.onsuccess = () => {
        for (const x of rs.result) if (x.testdaten === true) { s.segmente.delete(x.id); n.segmente++; }
      };
    });
    meldung(`${n.eintraege} Einträge und ${n.segmente} Blöcke entfernt.`);
  } catch (e) {
    meldung(`Fehler beim Entfernen: ${(e && e.message) || e}`, true);
  } finally {
    knoepfeAn(true);
    await zaehleSicher();
  }
}

async function zaehleSicher() {
  try { await zaehle(); } catch (e) { $('stand').textContent = `Speicher nicht lesbar: ${(e && e.message) || e}`; }
}

$('einspielen').addEventListener('click', einspielen);
$('entfernen').addEventListener('click', entfernen);
zaehleSicher();
