'use strict';
/* Reine Logik der Auswertung (Abschnitt 8.2): kein Zugriff auf Datenbank, Netz oder Seite. Daten rein, Daten raus.
   Zeiten sind Millisekunden seit 1970 in Ortszeit des Geraets. Ein Tag laeuft von 04:00 bis 04:00 (7.1).
     zeitraum(art, bezug)        Tag, Woche (Mo-So) oder Monat, zu dem bezug gehoert
     blaettern(zr, schritt)      voriger (-1) oder naechster (+1) Zeitraum
     zuschneiden(segmente, von, bis)  Segmente auf ein Fenster kuerzen
     auswerten(segmente, toepfe, zr, jetzt)  Summen je Topf, Anteile, Bezahlt/Unbezahlt/Gesamt, Nicht erfasst
     skala / ausserhalb          Tagesspalte 7-23 Uhr und die Zeit ausserhalb davon
   Tage werden immer ueber Kalenderdaten gebildet (nie "+ 24 h"), damit Tage mit 23 oder 25 Stunden stimmen. */
import { CONFIG } from './config.js?v=0.4.2';
import { tagesBeginn } from './zeit.js?v=0.4.2';
import { UNKLAR, UNKLAR_FARBE } from './segments.js?v=0.4.2';

export const ARTEN = ['tag', 'woche', 'monat'];
const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const zwei = (n) => String(n).padStart(2, '0');

/** Tagesbeginn (04:00) des Kalendertags y-m-t, auch mit ueberlaufenden Werten (t = 0, m = 12 ...). */
const tagMs = (y, m, t, ts) => new Date(y, m, t, ts, 0, 0, 0).getTime();
/** Kalenderdatum (ohne Uhrzeit) des Tages, zu dem ms gehoert. */
function tagDatum(ms, ts) {
  const d = new Date(tagesBeginn(ms, ts));
  return { y: d.getFullYear(), m: d.getMonth(), t: d.getDate() };
}

/** Zeitraum zu bezug. art: 'tag' | 'woche' | 'monat'. Ergebnis { art, start, ende, tage: [Tagesbeginne], tagesStart },
    ende ist der Beginn des Folgezeitraums (halboffen). Ein Moment vor 04:00 zaehlt zum Vortag (Sonntag 02:00 gehoert
    also noch zum Samstag, Montag 02:00 noch zur alten Woche). */
export function zeitraum(art, bezug = Date.now(), tagesStart = CONFIG.tagesStart) {
  if (!ARTEN.includes(art)) throw new Error(`Unbekannte Zeitraumart: ${art}`);
  const { y, m, t } = tagDatum(bezug, tagesStart);
  let start, ende;
  if (art === 'tag') { start = tagMs(y, m, t, tagesStart); ende = tagMs(y, m, t + 1, tagesStart); }
  else if (art === 'woche') {
    const montag = t - ((new Date(y, m, t).getDay() + 6) % 7);
    start = tagMs(y, m, montag, tagesStart); ende = tagMs(y, m, montag + 7, tagesStart);
  } else { start = tagMs(y, m, 1, tagesStart); ende = tagMs(y, m + 1, 1, tagesStart); }
  const tage = [];
  for (let d = new Date(start); d.getTime() < ende; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, tagesStart)) tage.push(d.getTime());
  return { art, start, ende, tage, tagesStart };
}

/** schritt -1 = zurueck, +1 = vor (auch mehrere). Gleiche Art, gleiche tagesStart. */
export function blaettern(zr, schritt) {
  const { y, m, t } = tagDatum(zr.start, zr.tagesStart);
  const bezug = zr.art === 'tag' ? tagMs(y, m, t + schritt, zr.tagesStart)
    : zr.art === 'woche' ? tagMs(y, m, t + 7 * schritt, zr.tagesStart)
    : tagMs(y, m + schritt, 1, zr.tagesStart);
  return zeitraum(zr.art, bezug, zr.tagesStart);
}

/** Liegt jetzt im Zeitraum? */
export const enthaelt = (zr, ms) => ms >= zr.start && ms < zr.ende;

/** Kopien der Segmente, auf [von, bis) gekuerzt. Was nichts im Fenster liegt, entfaellt. Die Eingabe bleibt unveraendert;
    id und alle anderen Felder bleiben erhalten. */
export function zuschneiden(segmente, von, bis) {
  const aus = [];
  for (const s of segmente) {
    const start = Math.max(s.start, von), ende = Math.min(s.ende, bis);
    if (ende > start) aus.push({ ...s, start, ende });
  }
  return aus;
}

/** Summen fuer einen Zeitraum.
    Ergebnis {
      zeilen: [{ topfId, name, farbe, bezahlt, archiviert, ms, anteil }]  nur Toepfe mit Zeit, nach reihenfolge, 'unklar' zuletzt
      gesamt (Erfasst gesamt), bezahlt, unbezahlt   in ms; bezahlt:null (Privat) und unklar zaehlen nur zu gesamt
      nichtErfasst  Dauer des Zeitraums minus gesamt; bei jetzt (laufender Zeitraum) zaehlt nur die Zeit bis jetzt
      dauer         Laenge des Zeitraums (bis jetzt) in ms, echte Millisekunden, also 23 oder 25 h an Wechseltagen
      leer          nichts erfasst
    }
    Segmente mit unbekannter topfId zaehlen als 'unklar'. Archivierte Toepfe erscheinen mit ihren Daten. */
export function auswerten(segmente, toepfe, zr, jetzt = null) {
  const bekannt = new Map(toepfe.map((t) => [t.id, t]));
  const summe = new Map();
  for (const s of zuschneiden(segmente, zr.start, zr.ende)) {
    const id = bekannt.has(s.topfId) ? s.topfId : UNKLAR;
    summe.set(id, (summe.get(id) || 0) + (s.ende - s.start));
  }
  const zeilen = [];
  [...toepfe].sort((a, b) => (a.reihenfolge || 0) - (b.reihenfolge || 0)).forEach((t) => {
    const ms = summe.get(t.id) || 0;
    if (ms > 0) zeilen.push({ topfId: t.id, name: t.name, farbe: t.farbe, bezahlt: t.bezahlt === undefined ? null : t.bezahlt, archiviert: !!t.archiviert, ms, anteil: 0 });
  });
  const unklar = summe.get(UNKLAR) || 0;
  if (unklar > 0) zeilen.push({ topfId: UNKLAR, name: 'Unklar', farbe: UNKLAR_FARBE, bezahlt: null, archiviert: false, ms: unklar, anteil: 0 });

  const gesamt = zeilen.reduce((a, z) => a + z.ms, 0);
  for (const z of zeilen) z.anteil = gesamt ? z.ms / gesamt : 0;
  const bis = jetzt == null ? zr.ende : Math.min(zr.ende, Math.max(jetzt, zr.start));
  const dauer = bis - zr.start;
  return {
    zeilen, gesamt,
    bezahlt: zeilen.filter((z) => z.bezahlt === true).reduce((a, z) => a + z.ms, 0),
    unbezahlt: zeilen.filter((z) => z.bezahlt === false).reduce((a, z) => a + z.ms, 0),
    nichtErfasst: Math.max(0, dauer - gesamt), dauer, leer: gesamt === 0,
  };
}

/** Tagesspalte der Ansicht: von vonStunde bis bisStunde Uhr am Kalendertag des (04:00-)Tages tagStart. */
export function skala(tagStart, vonStunde = 7, bisStunde = 23) {
  const d = new Date(tagStart);
  return {
    von: new Date(d.getFullYear(), d.getMonth(), d.getDate(), vonStunde, 0, 0, 0).getTime(),
    bis: new Date(d.getFullYear(), d.getMonth(), d.getDate(), bisStunde, 0, 0, 0).getTime(),
  };
}

/** Zeit eines Tages ausserhalb der Skala: davor (ab Tagesbeginn), danach (bis Tagesende), Zahl der betroffenen Segmente. */
export function ausserhalb(segmente, tagStart, tagEnde, sk) {
  const tag = zuschneiden(segmente, tagStart, tagEnde);
  const summe = (l) => l.reduce((a, s) => a + (s.ende - s.start), 0);
  const davor = zuschneiden(tag, tagStart, sk.von), danach = zuschneiden(tag, sk.bis, tagEnde);
  const ids = new Set([...davor, ...danach].map((s) => s.id != null ? s.id : s));
  return { davor: summe(davor), danach: summe(danach), anzahl: ids.size };
}

// ---------------------------------------------------------------- Texte

/** ms als h:mm, auf Minuten gerundet: "1:20" */
export function stundenText(ms) {
  const min = Math.round(Math.max(0, ms) / 60000);
  return `${Math.floor(min / 60)}:${zwei(min % 60)}`;
}
/** Anteil 0..1 als "33,3 %" (immer eine Nachkommastelle, damit die Spalte buendig bleibt) */
export function prozentText(anteil) {
  const p = (Math.round(anteil * 1000) / 10).toFixed(1);
  return `${p.replace('.', ',')} %`;
}
const datum = (ms, mitJahr) => { const d = new Date(ms); return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${mitJahr ? d.getFullYear() : ''}`; };
/** Kopfzeile des Zeitraums: "Samstag, 14.11.2026" / "KW 46 · 09.11.–15.11.2026" / "November 2026" */
export function titel(zr) {
  const d = new Date(zr.start);
  if (zr.art === 'tag') return `${WOCHENTAGE[d.getDay()]}, ${datum(zr.start, true)}`;
  if (zr.art === 'monat') return `${MONATE[d.getMonth()]} ${d.getFullYear()}`;
  const letzter = zr.tage[zr.tage.length - 1];
  const donnerstag = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 3);
  const kwJahr = new Date(donnerstag).getUTCFullYear();
  const kw = Math.floor((donnerstag - Date.UTC(kwJahr, 0, 1)) / 86400000 / 7) + 1;
  const jahrGleich = d.getFullYear() === new Date(letzter).getFullYear();
  return `KW ${kw} · ${datum(zr.start, !jahrGleich)}–${datum(letzter, true)}`;
}
/** Kurzname des Wochentags eines Tagesbeginns: "Mo" */
export function wochentagKurz(tagStart) { return WOCHENTAGE[new Date(tagStart).getDay()].slice(0, 2); }
