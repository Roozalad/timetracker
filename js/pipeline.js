'use strict';
/* Warteschlange (Abschnitt 7.1).
     1. Loslassen: Eintrag mit zeit und Status wartet_transkription anlegen, Audio speichern (atomar).
     2. Transkribieren. Erfolg: Transkript speichern, Audio loeschen, Status wartet_zuordnung (atomar).
     3. Zuordnung: registriereZuordnung(); main.js haengt zuordnen.js ein. Eintrag und Segmente atomar speichern.
   Regeln: Eintraege strikt in der Reihenfolge ihrer zeit, nie zwei gleichzeitig. Ein Fehler laesst den
   Eintrag im jeweiligen Wartezustand. Schritt 3 wiederholt nie Schritt 2 (der Status entscheidet).
   Wiederholung: beim Oeffnen, bei Rueckkehr in den Vordergrund, bei wiederkehrendem Netz, auf Knopfdruck.
   Key ungueltig/Guthaben leer oder kein Key: keine automatische Wiederholung, bis der Key geaendert
   wird oder die Nutzerin "Jetzt senden" drueckt. */
import { log } from './log.js?v=0.4.1';
import { getKey, maskiere } from './key.js?v=0.4.1';
import { fensterStartFuer } from './zeit.js?v=0.4.1';
import { transcribe, TranscribeError } from './transcribe.js?v=0.4.1';
import * as db from './db.js?v=0.4.1';
import * as aktionen from './aktionen.js?v=0.4.1';

const abonnenten = new Set();
let laeuft = false;
let nochmal = false, nochmalErzwungen = false;
let blockiert = null;       // null | { art: 'kein_key'|'auth', meldung, key }  (key nur im Speicher, zum Vergleich)
let zuordnenFn = null;

function melde(ereignis) {
  for (const f of abonnenten) { try { f(ereignis); } catch (e) { log(`Abonnent: ${e && e.message}`); } }
}
/** Ereignisse: {typ:'lauf_start'} {typ:'eintrag', eintrag} {typ:'lauf_ende', ok, verarbeitet, fehler:{art,meldung}|null}
    {typ:'blockiert', blockiert}  {typ:'entsperrt'}. Liefert eine Funktion zum Abmelden. */
export function abonniere(fn) { abonnenten.add(fn); return () => abonnenten.delete(fn); }

export function zustand() {
  return { laeuft, blockiert: blockiert ? { art: blockiert.art, meldung: blockiert.meldung } : null };
}

// ---------------------------------------------------------------- Einhaengestelle fuer Paket C
/** ZUORDNUNG (Schritt 3). main.js ruft einmal beim Start auf:
      registriereZuordnung(async (eintrag, kontext) => { ... })
    eintrag:  der Eintrag mit Status 'wartet_zuordnung' (transkript, zeit, fensterStart, id, ...).
    kontext:  { vorgaenger } = der Eintrag mit der naechstkleineren zeit oder null (fuer 'angekuendigt').
    Rueckgabe: ein Objekt mit Feldern, die in den Eintrag gemischt werden (z. B. angekuendigt, stimmung,
      unklar, promptVersion). Enthaelt es 'status', gilt dieser (z. B. 'fehler' mit 'fehler'-Text nach
      zwei erfolglosen Versuchen), sonst wird der Status 'fertig'. Das Feld 'segmente' (Liste neuer ki-Segmente,
      auch leer) kommt nicht in den Eintrag: die Pipeline ersetzt damit atomar die ki-Segmente dieses Eintrags.
      Fehlt 'segmente', bleiben die Segmente unberuehrt.
    Fehler: wirft die Funktion, bleibt der Eintrag 'wartet_zuordnung'. Hat der Fehler .art === 'auth'
      oder 'kein_key', sperrt die Schlange bis zur Key-Aenderung bzw. zum Knopfdruck; jeder andere
      Fehler gilt als voruebergehend (Netz, Server) und beendet nur diesen Lauf.
    Ohne registrierte Funktion bleiben Eintraege in 'wartet_zuordnung' und werden nicht als wartend gezaehlt. */
export function registriereZuordnung(fn) { zuordnenFn = fn; }

// ---------------------------------------------------------------- Schritt 1
/** Eine fertige Aufnahme annehmen. erg = { blob, dauerMs, weg, zeit } vom Recorder.
    Liefert { ok: true, eintrag } oder, wenn die Datenbank nicht nutzbar ist, { ok: false, direkt: Promise<string> }:
    dann wird die Aufnahme direkt gesendet statt gespeichert (Abschnitt 9). */
export async function aufnahmeAbgeben(erg) {
  const { blob, zeit } = erg;
  try {
    const buf = await blob.arrayBuffer(); // ArrayBuffer statt Blob speichern: robuster in iOS-IndexedDB
    const alle = await db.listEintraege();
    let vorher = null;
    for (const e of alle) if (e.zeit < zeit) vorher = e.zeit; // sortiert aufsteigend
    const eintrag = await db.eintragMitAudioAnlegen({ zeit, fensterStart: fensterStartFuer(zeit, vorher) }, { buf, type: blob.type });
    log(`Eintrag ${eintrag.id} angelegt (${(erg.dauerMs / 1000).toFixed(1)} s, ${blob.size} B, Weg ${erg.weg})`);
    melde({ typ: 'eintrag', eintrag });
    starte('neue Aufnahme');
    return { ok: true, eintrag };
  } catch (e) {
    log(`Speichern fehlgeschlagen: ${e && e.name}: ${maskiere(e && e.message)}`);
    return { ok: false, fehler: 'Speichern nicht möglich (Speicher voll oder gesperrt)', direkt: transcribe(blob) };
  }
}

// ---------------------------------------------------------------- Schritte 2 und 3
function blockiere(art, meldung) {
  blockiert = { art, meldung, key: getKey() };
  log(`Schlange gesperrt (${art}): ${meldung}`);
  melde({ typ: 'blockiert', blockiert: { art, meldung } });
}
function entsperre() {
  if (!blockiert) return;
  blockiert = null; melde({ typ: 'entsperrt' });
}

async function fehlerMerken(id, meldung) {
  try { const e = await db.updateEintrag(id, { fehler: meldung }); if (e) melde({ typ: 'eintrag', eintrag: e }); } catch (_) {}
}

/** Bearbeitet einen Eintrag. Wirft nur bei voruebergehenden/blockierenden Fehlern (Lauf endet dann). */
async function bearbeite(e, alle) {
  if (e.status === 'wartet_transkription') {
    const audio = e.audioId != null ? await db.getAudio(e.audioId) : null;
    // e stammt vom Beginn des Laufs: geschrieben wird nur, wenn der Eintrag noch so wartet (zweiter Tab, Import)
    const nochSo = (x) => x.status === 'wartet_transkription' && x.audioId === e.audioId;
    if (!audio) {
      const neu = await db.updateEintrag(e.id, { status: 'fehler', fehler: 'Audio nicht mehr vorhanden', audioId: null }, nochSo);
      if (!neu) { log(`Eintrag ${e.id}: inzwischen geändert oder gelöscht`); return; }
      log(`Eintrag ${e.id}: Audio fehlt`); melde({ typ: 'eintrag', eintrag: neu });
      return;
    }
    const text = await transcribe(new Blob([audio.buf], { type: audio.type }));
    const gespeichert = await db.transkriptSpeichern(e.id, text, e.audioId);
    if (!gespeichert) { log(`Eintrag ${e.id}: inzwischen geändert oder gelöscht, Transkript verworfen`); return; }
    e = gespeichert;
    log(`Eintrag ${e.id}: Transkript gespeichert (${text.length} Zeichen), Audio gelöscht, Status ${e.status}`);
    melde({ typ: 'eintrag', eintrag: e });
  }
  if (e.status === 'wartet_zuordnung' && zuordnenFn) {
    let vorgaenger = null;
    for (const x of alle) if (x.id !== e.id && x.zeit <= e.zeit && (!vorgaenger || x.zeit >= vorgaenger.zeit)) vorgaenger = x;
    // Vorgaenger frisch lesen: sein 'angekuendigt' entsteht erst in diesem Lauf
    if (vorgaenger) vorgaenger = (await db.getEintrag(vorgaenger.id)) || vorgaenger;
    const teil = (await zuordnenFn(e, { vorgaenger })) || {};
    // 'segmente' (neue ki-Segmente) gehoert nicht in den Eintrag; Eintrag und Segmente gehen atomar in die Datenbank
    const { segmente, ...felder } = teil;
    // nur speichern, wenn der Eintrag noch auf genau diese Zuordnung wartet (nicht geloescht, ersetzt oder anderswo fertig)
    const nochSo = (x) => x.status === 'wartet_zuordnung' && x.zeit === e.zeit && x.transkript === e.transkript;
    const r = await aktionen.zuordnungSpeichern(e.id, { status: 'fertig', fehler: null, ...felder }, segmente, nochSo);
    if (!r.gefunden) { log(`Eintrag ${e.id}: inzwischen geändert oder gelöscht, Ergebnis verworfen`); return; }
    log(`Eintrag ${e.id}: Zuordnung abgeschlossen, Status ${r.eintrag.status}${segmente ? `, ${segmente.length} Segmente` : ''}`);
    melde({ typ: 'eintrag', eintrag: r.eintrag });
  }
}

const bearbeitbar = (e) => e.status === 'wartet_transkription' || (e.status === 'wartet_zuordnung' && zuordnenFn);

/** Arbeitet die Schlange ab. opt.manuell: Knopfdruck, hebt eine Sperre auf und ignoriert navigator.onLine.
    Mehrfachaufrufe waehrend eines Laufs fuehren hoechstens zu einem weiteren Durchgang. */
export async function starte(grund, opt = {}) {
  const manuell = !!opt.manuell;
  if (laeuft) {
    nochmal = true;
    if (manuell || grund === 'sichtbar' || grund === 'online') nochmalErzwungen = true;
    return;
  }
  if (manuell) entsperre();
  if (!manuell && blockiert && blockiert.key === getKey() && blockiert.art === 'auth') { log(`Lauf übersprungen (${grund}): gesperrt bis Key-Änderung oder Knopfdruck`); return; }
  if (!manuell && typeof navigator !== 'undefined' && navigator.onLine === false) { log(`Lauf übersprungen (${grund}): offline`); return; }
  laeuft = true; melde({ typ: 'lauf_start' });
  log(`Lauf (${grund})`);
  let fehler = null, verarbeitet = 0;
  try {
    do {
      nochmal = false;
      const alle = await db.listEintraege();
      const todo = alle.filter(bearbeitbar);
      if (todo.length && !getKey() && todo.some((e) => e.status === 'wartet_transkription' || zuordnenFn)) {
        // Ohne Key keine Netzaufrufe: Eintraege warten, Hinweis fuehrt zu den Einstellungen
        if (!blockiert) blockiere('kein_key', 'Kein API-Key eingetragen. Die Aufnahmen warten, bis ein Key in den Einstellungen steht.');
        fehler = { art: 'kein_key', meldung: blockiert.meldung };
        break;
      }
      if (blockiert && blockiert.art === 'kein_key') entsperre();
      for (const e of todo) {
        try {
          await bearbeite(e, alle);
          verarbeitet++;
        } catch (err) {
          const art = (err && err.art) || 'netz';
          const meldung = maskiere((err && err.message) || 'Unbekannter Fehler');
          log(`Eintrag ${e.id}: Fehler (${art}) ${meldung}`);
          await fehlerMerken(e.id, meldung);
          if (art === 'ungueltig') { fehler = fehler || { art, meldung }; continue; } // dieser Eintrag ist das Problem, die naechsten duerfen
          fehler = { art, meldung };
          if (art === 'auth' || art === 'kein_key') blockiere(art === 'kein_key' ? 'kein_key' : 'auth', meldung);
          break; // Reihenfolge wahren: spaetere Eintraege haengen vom Fenster dieses Eintrags ab
        }
      }
      if (fehler && fehler.art !== 'ungueltig' && !nochmalErzwungen) nochmal = false;
    } while (nochmal);
  } catch (e) {
    fehler = { art: 'intern', meldung: maskiere((e && e.message) || String(e)) };
    log(`Lauf-Fehler: ${fehler.meldung}`);
  } finally {
    laeuft = false; nochmal = false; nochmalErzwungen = false;
    melde({ typ: 'lauf_ende', ok: !fehler, verarbeitet, fehler });
  }
}

/** Anzahl der Eintraege, die auf einen Versand warten (fuer "2 Aufnahmen warten"). */
export async function wartendeAnzahl() {
  try { return (await db.listEintraege()).filter(bearbeitbar).length; } catch (_) { return 0; }
}

/** Nach Aenderung oder Entfernen des Keys aufrufen (Einstellungen). */
export function schluesselGeaendert() {
  if (blockiert) entsperre();
  starte('Key geändert', { manuell: true }); // ohne Key setzt der Lauf den Hinweis "Kein API-Key", falls etwas wartet
}

/** Nur fuer Tests: Zustand zuruecksetzen. */
export function _testReset() { blockiert = null; zuordnenFn = null; laeuft = false; nochmal = false; nochmalErzwungen = false; }
