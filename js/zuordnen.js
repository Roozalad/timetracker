'use strict';
/* Anbindung der Zuordnung an die Pipeline (Schritt 3 aus 7.1). main.js haengt zuordnen() ueber
   pipeline.registriereZuordnung() ein. Die Funktion ruft categorize(), prueft die Antwort ueber segments.js und
   liefert den Teil des Eintrags (angekuendigt, stimmung, unklar, promptVersion) plus die neuen Segmente.
   Gespeichert wird in der Pipeline, atomar (aktionen.zuordnungSpeichern).
   Fehler (Abschnitt 9):
     kein_key, auth, netz, server  -> wird weitergeworfen, die Pipeline sperrt bzw. laesst den Eintrag warten.
     antwort, unvollstaendig, verweigert -> bis zu zweimal sofort wiederholt, dann Status 'fehler'.
     abgelehnt (4xx), eingabe      -> Status 'fehler' ohne Wiederholung (gleiche Anfrage ginge wieder schief).
   Schritt 3 wiederholt nie Schritt 2: hier wird nur das gespeicherte Transkript benutzt. */
import { CONFIG } from './config.js?v=0.4.2';
import { log } from './log.js?v=0.4.2';
import { maskiere } from './key.js?v=0.4.2';
import { uhrzeit, wochentagUhrzeit } from './zeit.js?v=0.4.2';
import * as db from './db.js?v=0.4.2';
import { categorize as categorizeEcht, PROMPT_VERSION } from './categorize.js?v=0.4.2';
import { segmenteAusAntwort } from './segments.js?v=0.4.2';

let categorizeFn = categorizeEcht;
/** Nur fuer Tests: Ersatz fuer categorize(). Ohne Argument wieder das echte. */
export function _categorizeErsetzen(fn) { categorizeFn = fn || categorizeEcht; }

const WIEDERHOLBAR = ['antwort', 'unvollstaendig', 'verweigert'];

/** Eingabe nach 7.2. Von jedem Topf gehen nur id, hinweise und unter (id, name) hinaus, archivierte gar nicht
    (Datenschutz Regel 5); die Ankuendigung des Vorgaengers geht mit Kennung statt Anzeigename. */
export function baueEingabe(eintrag, vorgaenger, toepfe) {
  const a = eintrag.fensterStart != null && vorgaenger ? vorgaenger.angekuendigt : null;
  return {
    jetzt: wochentagUhrzeit(eintrag.zeit),
    fenster_start: eintrag.fensterStart == null ? null : uhrzeit(eintrag.fensterStart),
    angekuendigt: a && a.topfId ? `${a.topfId}: ${a.text || ''}`.trim() : null,
    toepfe: toepfe.filter((t) => !t.archiviert).map((t) => ({
      id: t.id,
      hinweise: t.hinweise == null ? '' : t.hinweise,
      unter: (t.unter || []).map((u) => ({ id: u.id, name: u.name })),
    })),
    transkript: String(eintrag.transkript || '').trim(),
  };
}

export async function zuordnen(eintrag, kontext = {}) {
  if (!String(eintrag.transkript || '').trim()) {
    // Leeres Transkript: fertig, "Nichts erkannt" (Abschnitt 9)
    return { segmente: [], angekuendigt: null, stimmung: null, unklar: null };
  }
  const toepfe = (await db.listToepfe()).filter((t) => !t.archiviert);
  const eingabe = baueEingabe(eintrag, kontext.vorgaenger || null, toepfe);
  const versuche = 1 + (CONFIG.zuordnenWiederholungen || 0);
  let letzter = null;
  for (let v = 1; v <= versuche; v++) {
    let antwort;
    try {
      antwort = await categorizeFn(eingabe);
    } catch (e) {
      if (!e || e.name !== 'CategorizeError' || e.art !== 'ungueltig') throw e; // kein_key, auth, netz, server: Pipeline entscheidet
      letzter = e;
      log(`Eintrag ${eintrag.id}: Zuordnung abgelehnt/unbrauchbar (${e.grund || 'ungueltig'}), Versuch ${v} von ${versuche}`);
      if (!WIEDERHOLBAR.includes(e.grund)) break;
      continue;
    }
    try {
      const erg = segmenteAusAntwort(antwort, { zeit: eintrag.zeit, fensterStart: eintrag.fensterStart, toepfe, eintragId: eintrag.id });
      return { segmente: erg.segmente, angekuendigt: erg.angekuendigt, stimmung: erg.stimmung, unklar: erg.unklar, promptVersion: PROMPT_VERSION };
    } catch (e) {
      letzter = new Error(`Antwort nicht auswertbar: ${e && e.message}`); letzter.grund = 'antwort';
      log(`Eintrag ${eintrag.id}: ${letzter.message}, Versuch ${v} von ${versuche}`);
    }
  }
  const meldung = maskiere(`Zuordnung fehlgeschlagen: ${letzter && letzter.message}`);
  return { status: 'fehler', fehler: meldung, promptVersion: PROMPT_VERSION };
}
