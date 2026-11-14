'use strict';
/* Aenderungen an Segmenten und Eintraegen, jeweils in EINER Datenbank-Transaktion (db.segmenteAendern),
   gerechnet mit der reinen Logik aus segments.js. Genutzt von Pipeline (Zuordnung), Karte und Korrekturblatt.
   Jede Korrektur der Nutzerin setzt quelle 'manuell' und verdraengt alles (7.4). */
import * as db from './db.js?v=0.4.1';
import { einfuegen, MIN_MS } from './segments.js?v=0.4.1';

/** Schritt 3 der Pipeline: Eintrag aktualisieren und, falls neue Segmente uebergeben werden (auch eine leere Liste),
    die ki-Segmente dieses Eintrags durch sie ersetzen. Manuelle Segmente bleiben, die neuen werden um sie herum
    gekuerzt. neue === undefined/null: Segmente unberuehrt (z. B. Status 'fehler'). wenn(eintrag) optional: nur speichern,
    wenn der aktuelle Stand sie erfuellt, sonst gefunden: false. Liefert { gefunden, eintrag }. */
export function zuordnungSpeichern(eintragId, patch, neue, wenn = null) {
  const berechne = Array.isArray(neue) ? (bestand) => {
    const alt = bestand.filter((s) => s.eintragId === eintragId && s.quelle === 'ki');
    const rest = bestand.filter((s) => !(s.eintragId === eintragId && s.quelle === 'ki'));
    const r = einfuegen(rest, neue);
    return { loeschen: [...alt.map((s) => s.id), ...r.loeschen], schreiben: r.schreiben };
  } : null;
  return db.segmenteAendern(berechne, { id: eintragId, patch, wenn });
}

function pruefe(b) {
  if (!(b.ende - b.start >= MIN_MS)) throw new Error('Der Block muss mindestens eine Minute lang sein');
  if (!b.topfId) throw new Error('Kein Topf gewählt');
}

/** Korrektur eines Blocks: aenderung = { topfId, unterId, start, ende, text? }. Der Block behaelt seine id und seine
    Herkunft (eintragId), wird 'manuell' und verdraengt Nachbarn im neuen Zeitraum. Gibt es den Block nicht mehr (z. B.
    inzwischen neu zugeordnet), wirft sie: das Korrekturblatt zeigt die Meldung, statt die Korrektur still zu verlieren. */
export async function segmentKorrigieren(id, aenderung) {
  pruefe(aenderung);
  let gefunden = false;
  await db.segmenteAendern((bestand) => {
    const alt = bestand.find((s) => s.id === id);
    if (!alt) return null;
    gefunden = true;
    const zeitGeaendert = alt.start !== aenderung.start || alt.ende !== aenderung.ende;
    const neu = { ...alt, ...aenderung, id, quelle: 'manuell', zeitQuelle: zeitGeaendert ? 'genannt' : alt.zeitQuelle };
    return einfuegen(bestand.filter((s) => s.id !== id), [neu], { manuell: true });
  });
  if (!gefunden) throw new Error('Der Block wurde inzwischen geändert oder gelöscht. Bitte das Blatt schließen und neu öffnen.');
  return true;
}

/** Block von Hand: b = { topfId, unterId, start, ende, text?, eintragId? }. */
export async function blockAnlegen(b) {
  pruefe(b);
  await db.segmenteAendern((bestand) => einfuegen(bestand, [{
    eintragId: b.eintragId == null ? null : b.eintragId, topfId: b.topfId, unterId: b.unterId == null ? null : b.unterId,
    start: b.start, ende: b.ende, text: b.text || '', quelle: 'manuell', zeitQuelle: 'genannt',
  }], { manuell: true }));
}

export async function segmentLoeschen(id) {
  await db.segmenteAendern((bestand) => bestand.some((s) => s.id === id) ? { loeschen: [id], schreiben: [] } : null);
}

/** Eintrag samt Audio und allen Segmenten, die zu ihm gehoeren (auch den korrigierten). Von Hand angelegte Bloecke
    ohne Eintrag bleiben. */
export async function eintragLoeschen(id) {
  await db.segmenteAendern((bestand) => ({ loeschen: bestand.filter((s) => s.eintragId === id).map((s) => s.id), schreiben: [] }),
    { id, loeschen: true });
}

/** "Neu zuordnen": der Eintrag wartet wieder auf Schritt 3 (Transkript bleibt, Audio gibt es nicht mehr). Die Pipeline
    ersetzt dann nur die ki-Segmente dieses Eintrags. false, wenn es kein Transkript gibt. */
export async function neuZuordnen(id) {
  const e = await db.getEintrag(id);
  if (!e || !e.transkript || !e.transkript.trim()) return false;
  await db.updateEintrag(id, { status: 'wartet_zuordnung', fehler: null });
  return true;
}
