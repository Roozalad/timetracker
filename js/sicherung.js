'use strict';
/* Erinnerung an den Export (8.3), reine Logik ohne Seite, Speicher oder Uhr: alles kommt als Parameter.
   Nach mehr als 14 Tagen ohne Export erinnert die Ansicht Aufnahme. Gab es noch nie einen Export, zaehlt der
   aelteste Eintrag. */
import { vorZeitText } from './zeit.js?v=0.4.1';

export const ERINNERUNG_TAGE = 14;
const TAG_MS = 24 * 60 * 60 * 1000;

const zeitwert = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);

/** Aus localStorage-Text (Millisekunden) eine Zahl oder null. */
export function exportZeitAusText(text) { return zeitwert(Number(text)); }

/** { faellig, grund: 'export' | 'eintrag' | null, seit }
    letzterExport: Millisekunden oder null; aeltesterEintrag: kleinste `zeit` aller Eintraege oder null.
    Ein Zeitpunkt in der Zukunft (Uhr verstellt) loest nichts aus. */
export function sicherungFaellig({ letzterExport = null, aeltesterEintrag = null, jetzt = Date.now() } = {}) {
  const grenze = ERINNERUNG_TAGE * TAG_MS;
  const ex = zeitwert(letzterExport), alt = zeitwert(aeltesterEintrag);
  if (ex != null) return jetzt - ex > grenze ? { faellig: true, grund: 'export', seit: ex } : { faellig: false, grund: null, seit: ex };
  if (alt != null && jetzt - alt > grenze) return { faellig: true, grund: 'eintrag', seit: alt };
  return { faellig: false, grund: null, seit: alt };
}

/** Text der Zeile oder '' wenn nichts faellig ist. */
export function sicherungText(eingabe) {
  const r = sicherungFaellig(eingabe);
  if (!r.faellig) return '';
  const jetzt = eingabe.jetzt == null ? Date.now() : eingabe.jetzt;
  return r.grund === 'export'
    ? `Letzte Sicherung ${vorZeitText(r.seit, jetzt)}.`
    : `Noch nie gesichert. Der älteste Eintrag ist ${Math.floor((jetzt - r.seit) / TAG_MS)} Tage alt.`;
}
