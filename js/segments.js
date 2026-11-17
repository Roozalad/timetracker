'use strict';
/* Reine Logik fuer Zeitbloecke (Abschnitte 7.3 und 7.4): kein Zugriff auf Datenbank, Netz oder Seite.
   Daten rein, Daten raus. Zeiten sind Millisekunden seit 1970 in Ortszeit des Geraets.
     segmenteAusAntwort(antwort, ctx)  Modellantwort -> Segmente (7.3), noch ohne id
     einfuegen(bestand, neue, opt)     Einfuegen ohne Ueberlappung (7.4), fuer Zuordnung, Korrektur, Handbloecke
     blockVorgabe(ende, fensterStart)  Vorgabe fuer "Block von Hand"
   Gerechnet wird auf volle Minuten genau: zeit und fensterStart werden fuer die Begrenzung auf die Minute
   abgerundet, damit ein Block "bis eben" genau dort endet, wo die Uhr auf der Karte steht. */
import { CONFIG } from './config.js?v=0.5.0';
import { tagesBeginn } from './zeit.js?v=0.5.0';

export const MIN_MS = 60000;
export const UNKLAR = 'unklar';
export const UNKLAR_FARBE = '#B0B0B0';
const MAX_WOERTER = 6;

const minute = (ms) => Math.floor(ms / MIN_MS) * MIN_MS;

// ---------------------------------------------------------------- 7.3 Pruefung der Antwort

/** Legt "HH:MM" auf den Tag von zeit (Regel 1). Liefert { ms } oder { ms: null } (nach zeit, nicht im selben Tag
    darstellbar) oder null (kein HH:MM). Die Uhrzeit liegt nie nach zeit: Was spaeter waere, gilt als Vortag, aber
    nur, wenn der Vortag noch im selben (04:00-)Tag liegt, also nach Mitternacht aufgenommen. Eine Uhrzeit vor dem
    Tagesbeginn wird nicht abgewiesen, sondern beim Aufrufer auf den Tagesbeginn begrenzt (Regel 3). */
export function uhrzeitAufTag(hhmm, zeit, tagesStart = CONFIG.tagesStart) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm == null ? '' : hhmm).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const zm = minute(zeit), d = new Date(zeit);
  const heute = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2], 0, 0).getTime();
  if (heute <= zm) return { ms: heute };
  const vortag = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, +m[1], +m[2], 0, 0).getTime();
  if (vortag >= tagesBeginn(zeit, tagesStart)) return { ms: vortag };
  return { ms: null };
}

const woerter = (t) => String(t == null ? '' : t).trim().split(/\s+/).filter(Boolean).slice(0, MAX_WOERTER).join(' ');

function kennungsIndex(toepfe) {
  const ix = new Map();
  for (const t of Array.isArray(toepfe) ? toepfe : []) {
    if (!t || t.id == null || t.archiviert || t.id === UNKLAR) continue;
    ix.set(t.id, new Set((Array.isArray(t.unter) ? t.unter : []).filter((u) => u && !u.archiviert).map((u) => u.id)));
  }
  return ix;
}
/** Regel 6 und 7: unbekannter oder archivierter Topf wird "unklar", fremder oder unbekannter Unterpunkt null. */
function kennungen(topfId, unterId, ix) {
  const unter = ix.get(topfId);
  if (topfId === UNKLAR || !unter) return { topfId: UNKLAR, unterId: null };
  return { topfId, unterId: unterId != null && unter.has(unterId) ? unterId : null };
}

/** Wandelt die Modellantwort (Form wie in 7.2) in Segmente um, Regeln 1 bis 7 aus 7.3.
    ctx = { zeit, fensterStart|null, toepfe: [{id, unter, archiviert}], eintragId, tagesStart? }
    Liefert { segmente, angekuendigt, stimmung, unklar }. Segmente: { eintragId, topfId, unterId, start, ende, text,
    quelle: 'ki', zeitQuelle } ohne id, nach Start sortiert, ohne Ueberlappung untereinander. */
export function segmenteAusAntwort(antwort, ctx) {
  const { zeit, fensterStart = null, toepfe = [], eintragId = null, tagesStart = CONFIG.tagesStart } = ctx;
  const a = antwort || {};
  const ix = kennungsIndex(toepfe);
  const zm = minute(zeit), tb = tagesBeginn(zeit, tagesStart);
  const fs = fensterStart == null ? null : minute(fensterStart);

  const roh = [];
  (Array.isArray(a.taetigkeiten) ? a.taetigkeiten : []).forEach((t, i) => {
    if (!t) return;
    const s = uhrzeitAufTag(t.start, zeit, tagesStart);
    const e = uhrzeitAufTag(t.ende, zeit, tagesStart);
    if (!s || s.ms == null || !e) return;                 // Regel 1: Start nicht darstellbar -> ungueltig
    let start = s.ms;
    let ende = Math.min(e.ms == null ? zm : e.ms, zm);    // Regel 2: ende nie nach zeit
    start = Math.max(start, tb);                          // Regel 3: nicht vor dem Tagesbeginn
    if (t.zeit_quelle === 'geschaetzt') {                 // Regel 4: geschaetzt nur im Fenster
      if (fs == null) return;
      start = Math.max(start, fs);
    }
    if (ende - start < MIN_MS) return;                    // Regel 2: start >= ende oder unter einer Minute
    roh.push({ i, start, ende, t });
  });

  roh.sort((x, y) => x.start - y.start || x.i - y.i);     // Regel 5
  const segmente = [];
  let belegtBis = -Infinity;
  for (const r of roh) {
    const start = Math.max(r.start, belegtBis);
    if (r.ende - start < MIN_MS) continue;
    belegtBis = Math.max(belegtBis, r.ende);
    const k = kennungen(r.t.topf_id, r.t.unter_id, ix);   // Regel 6
    segmente.push({
      eintragId, topfId: k.topfId, unterId: k.unterId, start, ende: r.ende, text: woerter(r.t.text),
      quelle: 'ki', zeitQuelle: r.t.zeit_quelle === 'geschaetzt' ? 'geschaetzt' : 'genannt',
    });
  }

  let angekuendigt = null;                                 // Regel 7
  if (a.ab_jetzt && typeof a.ab_jetzt === 'object') {
    const k = kennungen(a.ab_jetzt.topf_id, a.ab_jetzt.unter_id, ix);
    angekuendigt = { topfId: k.topfId, unterId: k.unterId, text: woerter(a.ab_jetzt.text) };
  }
  const stimmung = a.stimmung && typeof a.stimmung === 'object'
    ? { wert: a.stimmung.wert, stichwort: String(a.stimmung.stichwort == null ? '' : a.stimmung.stichwort) } : null;
  return { segmente, angekuendigt, stimmung, unklar: typeof a.unklar === 'string' && a.unklar ? a.unklar : null };
}

// ---------------------------------------------------------------- 7.4 Einfuegen ohne Ueberlappung

/** Zieht den Zeitraum [x, y) von einer Liste von Stuecken [von, bis) ab. */
function abziehen(stuecke, x, y) {
  const out = [];
  for (const [v, b] of stuecke) {
    if (y <= v || x >= b) { out.push([v, b]); continue; }
    if (x > v) out.push([v, x]);
    if (y < b) out.push([y, b]);
  }
  return out;
}

/** Fuegt neue Segmente in den Bestand ein und haelt die Grundregel ein: nie zwei Segmente ueberlappen.
    - Ein neues Segment verdraengt Bestehende im selben Zeitraum: sie werden gekuerzt, geteilt oder geloescht.
    - Ausser bei opt.manuell (Aenderung der Nutzerin: verdraengt alles) werden Segmente mit quelle 'manuell' nie
      verdraengt; dann wird das neue Segment gekuerzt oder geteilt.
    - Reste unter einer Minute entfallen, auch Stuecke eines neuen Segments.
    Die Eingaben bleiben unveraendert. Eine Korrektur gibt dem neuen Segment die id des alten und entfernt das alte
    vorher aus dem Bestand. Abgetrennte Reste und weitere Stuecke eines geteilten neuen Segments haben keine id.
    Liefert { segmente: neuer Gesamtbestand nach Start sortiert,
              loeschen: ids, die aus dem Speicher zu entfernen sind,
              schreiben: Segmente, die zu speichern sind (geaenderte, abgetrennte, neue; ohne id = neu anlegen) }. */
export function einfuegen(bestand, neue, opt = {}) {
  const manuell = !!opt.manuell;
  const arbeit = (bestand || []).map((s) => ({ s: { ...s }, alt: s, neu: false }));
  const sortiert = [...(neue || [])].sort((x, y) => x.start - y.start || x.ende - y.ende);

  const verdraenge = (x, y) => {
    for (const a of [...arbeit]) {
      const { start, ende } = a.s;
      if (start >= y || ende <= x) continue;
      const links = x - start >= MIN_MS, rechts = ende - y >= MIN_MS;
      if (links && rechts) {
        const rest = { ...a.s, start: y }; delete rest.id;
        a.s.ende = x;
        arbeit.push({ s: rest, alt: null, neu: true });
      } else if (links) a.s.ende = x;
      else if (rechts) a.s.start = y;
      else arbeit.splice(arbeit.indexOf(a), 1);
    }
  };

  for (const n of sortiert) {
    let stuecke = [[n.start, n.ende]];
    if (!manuell) for (const a of arbeit) if (a.s.quelle === 'manuell') stuecke = abziehen(stuecke, a.s.start, a.s.ende);
    stuecke = stuecke.filter(([v, b]) => b - v >= MIN_MS);
    stuecke.forEach(([v, b], k) => {
      verdraenge(v, b);
      const s = { ...n, start: v, ende: b };
      if (k > 0) delete s.id;
      arbeit.push({ s, alt: null, neu: true });
    });
  }

  const segmente = arbeit.map((a) => a.s).sort((x, y) => x.start - y.start || x.ende - y.ende);
  const bleibt = new Set(segmente.filter((s) => s.id != null).map((s) => s.id));
  const loeschen = (bestand || []).filter((s) => !bleibt.has(s.id)).map((s) => s.id);
  const schreiben = arbeit
    .filter((a) => a.neu || a.s.start !== a.alt.start || a.s.ende !== a.alt.ende)
    .map((a) => a.s).sort((x, y) => x.start - y.start);
  return { segmente, loeschen, schreiben };
}

/** Welche bestehenden Bloecke ein Ergebnis von einfuegen() verdraengt: [{ segment, art: 'geloescht'|'gekuerzt' }],
    nach Start sortiert. 'gekuerzt' umfasst auch geteilte Bloecke. ohne: id, die nicht zaehlt (der korrigierte Block). */
export function verdraengt(bestand, ergebnis, ohne = null) {
  const weg = new Set(ergebnis.loeschen || []);
  const neu = new Map((ergebnis.segmente || []).filter((s) => s.id != null).map((s) => [s.id, s]));
  const out = [];
  for (const s of bestand || []) {
    if (s.id == null || s.id === ohne) continue;
    if (weg.has(s.id)) out.push({ segment: s, art: 'geloescht' });
    else { const n = neu.get(s.id); if (n && (n.start !== s.start || n.ende !== s.ende)) out.push({ segment: s, art: 'gekuerzt' }); }
  }
  return out.sort((x, y) => x.segment.start - y.segment.start);
}

/** Paare ueberlappender Segmente (leer, wenn die Grundregel gilt). Fuer Tests und Pruefungen. */
export function ueberlappungen(liste) {
  const l = [...liste].sort((x, y) => x.start - y.start || x.ende - y.ende);
  const out = [];
  for (let i = 1; i < l.length; i++) for (let j = 0; j < i; j++) if (l[j].ende > l[i].start) out.push([l[j], l[i]]);
  return out;
}

// ---------------------------------------------------------------- Hilfen fuer Handbloecke

/** Vorgabe fuer "Block von Hand": das aktuelle Fenster. ende = Moment (auf die Minute abgerundet), start =
    fensterStart, sonst eine halbe Stunde davor, nie vor dem Tagesbeginn und mindestens 5 Minuten lang. */
export function blockVorgabe(ende, fensterStart = null, tagesStart = CONFIG.tagesStart) {
  const e = minute(ende), tb = tagesBeginn(ende, tagesStart);
  let s = fensterStart == null ? e - 30 * MIN_MS : minute(fensterStart);
  if (e - s < 5 * MIN_MS) s = e - 5 * MIN_MS;
  return { start: Math.max(s, tb), ende: e };
}

/** Vorgabe fuer "Block von Hand" in der Auswertung, fuer den (04:00-)Tag ab tagStart. Heute: bis jetzt, ab dem Ende
    des letzten Blocks davor (sonst eine halbe Stunde). Vergangener Tag: eine halbe Stunde ab dem Ende des letzten
    Blocks dieses Tags, ohne Block ab 09:00; nie ueber das Tagesende. Zukuenftiger Tag: null. */
export function blockVorgabeFuerTag(tagStart, segmente, jetzt = Date.now(), tagesStart = CONFIG.tagesStart) {
  const tb = tagesBeginn(tagStart, tagesStart);
  const te = new Date(tb); te.setDate(te.getDate() + 1);
  const tagEnde = te.getTime();
  if (tb > jetzt) return null;
  const imTag = (segmente || []).filter((s) => s.start < tagEnde && s.ende > tb);
  if (jetzt < tagEnde) {
    const davor = imTag.filter((s) => s.ende <= jetzt).reduce((m, s) => Math.max(m, s.ende), -Infinity);
    return blockVorgabe(jetzt, davor === -Infinity ? null : davor, tagesStart);
  }
  const d = new Date(tb);
  const neun = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0, 0).getTime();
  const letztes = imTag.reduce((m, s) => Math.max(m, s.ende), -Infinity);
  let start = letztes === -Infinity ? Math.max(neun, tb) : minute(Math.min(letztes, tagEnde));
  let ende = start + 30 * MIN_MS;
  if (ende > tagEnde) { ende = tagEnde; start = ende - 30 * MIN_MS; }
  return { start, ende };
}
