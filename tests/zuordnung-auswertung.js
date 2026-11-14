'use strict';
/* Auswertung der Zuordnungs-Testfaelle: vergleicht eine (strukturell gepruefte) Antwort mit den Erwartungen
   eines Falls aus zuordnung-faelle.js. Reine Logik, kein DOM, kein Netz.

   Erwartungen (fall.soll), jedes Feld optional; undefined heisst "egal":
     taetigkeiten: Liste, Anzahl muss stimmen. Je Eintrag:
       topf:  'tX' | ['tX','unklar']          erlaubte Toepfe
       unter: null | 'uX' | ['uX', null]      undefined = egal
       start, ende: 'HH:MM'                   mit Toleranz tol (Minuten)
       dauer: Minuten                         mit Toleranz tolDauer
       quelle: 'genannt' | 'geschaetzt'
     reihenfolgeEgal: true                    Zuordnung Soll/Ist ueber alle Permutationen
     spanne: ['HH:MM','HH:MM']                erster start / letztes ende, mit Toleranz
     lueckenlos: true                         zwischen aufeinanderfolgenden Taetigkeiten keine Luecke > tol
     abJetzt: null | { topf, unter? }
     stimmung: null | { min, max, stichwort?: ['…'] }   stichwort: eine Alternative als Teilstring
     unklar: true (Text gesetzt) | false (null)
     tol (Standard 5), tolDauer (Standard 10)
   Allgemeine Regeln (immer): Reihenfolge, keine Ueberlappung, start < ende, kein ende nach jetzt,
     text 1 bis 6 Woerter, unter_id gehoert zum Topf, geschaetzt nur innerhalb des Fensters (und nur mit Fenster),
     Topf "unklar" verlangt einen unklar-Text. */

export const TOL = 5, TOL_DAUER = 10;

export function hhmm(s) {
  const m = /(\d{1,2}):(\d{2})\s*$/.exec(String(s || ''));
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}
/** Minuten relativ zum Tag von jetzt: Uhrzeiten nach der Uhrzeit von jetzt gehoeren zum Vortag (wie 7.3 Regel 1). */
export function relativ(s, jetztMin) { const m = hhmm(s); return m > jetztMin ? m - 1440 : m; }
export function zeitText(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const liste = (v) => (Array.isArray(v) ? v : [v]);
const woerter = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const diff = (ist, soll) => { const d = Math.round(ist - soll); return d === 0 ? '±0' : (d > 0 ? `+${d}` : `${d}`); };

/** Kurzform einer Taetigkeit fuer Anzeige und Rueckmeldung. */
export function kurzIst(t) {
  return `${t.topf_id}${t.unter_id ? '/' + t.unter_id : ''} ${t.start}-${t.ende} ${t.zeit_quelle === 'genannt' ? 'gen' : 'ges'} "${t.text}"`;
}
export function kurzSoll(s) {
  const topf = liste(s.topf).join('|');
  const unter = s.unter === undefined ? '' : '/' + liste(s.unter).map((u) => (u === null ? '-' : u)).join('|');
  const zeit = `${s.start || '…'}-${s.ende || '…'}`;
  return `${topf}${unter} ${zeit}${s.dauer ? ` (${s.dauer} min)` : ''}${s.quelle ? ' ' + (s.quelle === 'genannt' ? 'gen' : 'ges') : ''}`;
}
export function kurzAntwort(a) {
  const teile = [];
  teile.push(a.taetigkeiten.length ? a.taetigkeiten.map(kurzIst).join('; ') : '(keine Tätigkeiten)');
  teile.push(`ab_jetzt=${a.ab_jetzt ? `${a.ab_jetzt.topf_id}${a.ab_jetzt.unter_id ? '/' + a.ab_jetzt.unter_id : ''} "${a.ab_jetzt.text}"` : 'null'}`);
  teile.push(`stimmung=${a.stimmung ? `${a.stimmung.wert} "${a.stimmung.stichwort}"` : 'null'}`);
  teile.push(`unklar=${a.unklar === null ? 'null' : JSON.stringify(a.unklar)}`);
  return teile.join(' | ');
}
export function kurzErwartung(soll) {
  const t = [];
  if (soll.taetigkeiten) t.push(soll.taetigkeiten.length ? soll.taetigkeiten.map(kurzSoll).join('; ') : '(keine Tätigkeiten)');
  if (soll.spanne) t.push(`Spanne ${soll.spanne[0]}-${soll.spanne[1]}`);
  if (soll.lueckenlos) t.push('lückenlos');
  if (soll.reihenfolgeEgal) t.push('Reihenfolge egal');
  if (soll.abJetzt !== undefined) t.push(`ab_jetzt=${soll.abJetzt ? liste(soll.abJetzt.topf).join('|') + (soll.abJetzt.unter !== undefined ? '/' + liste(soll.abJetzt.unter).map((u) => u || '-').join('|') : '') : 'null'}`);
  if (soll.stimmung !== undefined) t.push(`stimmung=${soll.stimmung ? `${soll.stimmung.min}..${soll.stimmung.max}${soll.stimmung.stichwort ? ' ~' + soll.stimmung.stichwort.join('|') : ''}` : 'null'}`);
  if (soll.unklar !== undefined) t.push(`unklar=${soll.unklar ? 'gesetzt' : 'null'}`);
  return t.join(' | ');
}

function unterPasst(sollUnter, ist) {
  if (sollUnter === undefined) return true;
  return liste(sollUnter).includes(ist);
}

/** Vergleicht eine Ist-Taetigkeit mit einer Soll-Taetigkeit. Liefert Liste von Abweichungen (leer = passt). */
function vergleichePaar(s, t, nr, jetztMin, tol, tolDauer) {
  const ab = [];
  const p = `T${nr}`;
  if (!liste(s.topf).includes(t.topf_id)) ab.push(`${p}.topf: soll ${liste(s.topf).join('|')}, ist ${t.topf_id}`);
  if (!unterPasst(s.unter, t.unter_id)) ab.push(`${p}.unter: soll ${liste(s.unter).map((u) => u || 'null').join('|')}, ist ${t.unter_id || 'null'}`);
  const st = relativ(t.start, jetztMin), en = relativ(t.ende, jetztMin);
  if (s.start) { const sv = relativ(s.start, jetztMin); if (Math.abs(st - sv) > tol) ab.push(`${p}.start: soll ${s.start}±${tol}, ist ${t.start} (${diff(st, sv)} min)`); }
  if (s.ende) { const sv = relativ(s.ende, jetztMin); if (Math.abs(en - sv) > tol) ab.push(`${p}.ende: soll ${s.ende}±${tol}, ist ${t.ende} (${diff(en, sv)} min)`); }
  if (s.dauer) { const d = en - st; if (Math.abs(d - s.dauer) > tolDauer) ab.push(`${p}.dauer: soll ${s.dauer}±${tolDauer} min, ist ${d} min`); }
  if (s.quelle && t.zeit_quelle !== s.quelle) ab.push(`${p}.zeit_quelle: soll ${s.quelle}, ist ${t.zeit_quelle}`);
  return ab;
}

function* permutationen(n) {
  const a = [...Array(n).keys()];
  function* rek(k) {
    if (k === n) { yield a.slice(); return; }
    for (let i = k; i < n; i++) { [a[k], a[i]] = [a[i], a[k]]; yield* rek(k + 1); [a[k], a[i]] = [a[i], a[k]]; }
  }
  yield* rek(0);
}

/** Allgemeine Regeln, unabhaengig vom Fall. */
export function allgemeineRegeln(eingabe, antwort) {
  const ab = [];
  const jetztMin = hhmm(eingabe.jetzt);
  const fs = eingabe.fenster_start == null ? null : relativ(eingabe.fenster_start, jetztMin);
  const unterVon = new Map((eingabe.toepfe || []).filter((t) => !t.archiviert).map((t) => [t.id, new Set((t.unter || []).map((u) => u.id))]));
  let vorEnde = null;
  antwort.taetigkeiten.forEach((t, i) => {
    const p = `T${i + 1}`;
    const st = relativ(t.start, jetztMin), en = relativ(t.ende, jetztMin);
    if (!(st < en)) ab.push(`${p}: start ${t.start} nicht vor ende ${t.ende}`);
    if (en > jetztMin) ab.push(`${p}: ende ${t.ende} nach jetzt`);
    if (vorEnde !== null && st < vorEnde - 1) ab.push(`${p}: beginnt ${t.start} vor Ende der vorigen Tätigkeit (${zeitText(vorEnde)}), Reihenfolge/Überlappung`);
    vorEnde = Math.max(vorEnde === null ? -Infinity : vorEnde, en);
    const w = woerter(t.text);
    if (w < 1 || w > 6) ab.push(`${p}: text hat ${w} Wörter ("${t.text}")`);
    if (t.unter_id !== null && !(unterVon.get(t.topf_id) || new Set()).has(t.unter_id)) ab.push(`${p}: unter_id ${t.unter_id} gehört nicht zu ${t.topf_id}`);
    if (t.zeit_quelle === 'geschaetzt') {
      if (fs === null) ab.push(`${p}: geschaetzt ohne Fenster (würde verworfen)`);
      else if (st < fs - 1 || en > jetztMin + 1) ab.push(`${p}: geschaetzt außerhalb des Fensters`);
    }
    if (t.topf_id === 'unklar' && !antwort.unklar) ab.push(`${p}: Topf unklar ohne unklar-Text`);
  });
  if (antwort.ab_jetzt) {
    const a = antwort.ab_jetzt;
    if (a.unter_id !== null && !(unterVon.get(a.topf_id) || new Set()).has(a.unter_id)) ab.push(`ab_jetzt: unter_id ${a.unter_id} gehört nicht zu ${a.topf_id}`);
    const w = woerter(a.text);
    if (w < 1 || w > 6) ab.push(`ab_jetzt: text hat ${w} Wörter ("${a.text}")`);
  }
  return ab;
}

/** Prueft eine Antwort gegen einen Fall. Liefert { ok, abweichungen: [String] }. */
export function pruefeFall(fall, antwort) {
  const soll = fall.soll || {};
  const eingabe = fall.eingabe;
  const jetztMin = hhmm(eingabe.jetzt);
  const tol = soll.tol ?? TOL, tolDauer = soll.tolDauer ?? TOL_DAUER;
  const ab = allgemeineRegeln(eingabe, antwort);
  const ist = antwort.taetigkeiten;

  if (soll.taetigkeiten) {
    const s = soll.taetigkeiten;
    if (s.length !== ist.length) {
      ab.push(`Anzahl Tätigkeiten: soll ${s.length}, ist ${ist.length}`);
    } else if (s.length) {
      if (soll.reihenfolgeEgal) {
        let beste = null;
        for (const perm of permutationen(s.length)) {
          const a = perm.flatMap((j, i) => vergleichePaar(s[j], ist[i], i + 1, jetztMin, tol, tolDauer));
          if (!beste || a.length < beste.length) beste = a;
          if (!a.length) break;
        }
        ab.push(...beste);
      } else {
        s.forEach((x, i) => ab.push(...vergleichePaar(x, ist[i], i + 1, jetztMin, tol, tolDauer)));
      }
    }
  }
  if (soll.spanne && ist.length) {
    const st = Math.min(...ist.map((t) => relativ(t.start, jetztMin)));
    const en = Math.max(...ist.map((t) => relativ(t.ende, jetztMin)));
    const ss = relativ(soll.spanne[0], jetztMin), se = relativ(soll.spanne[1], jetztMin);
    if (Math.abs(st - ss) > tol) ab.push(`Spanne.start: soll ${soll.spanne[0]}±${tol}, ist ${zeitText(st)} (${diff(st, ss)} min)`);
    if (Math.abs(en - se) > tol) ab.push(`Spanne.ende: soll ${soll.spanne[1]}±${tol}, ist ${zeitText(en)} (${diff(en, se)} min)`);
  } else if (soll.spanne && !ist.length) ab.push('Spanne: keine Tätigkeiten');
  if (soll.lueckenlos) {
    for (let i = 1; i < ist.length; i++) {
      const luecke = relativ(ist[i].start, jetztMin) - relativ(ist[i - 1].ende, jetztMin);
      if (luecke > tol) ab.push(`Lücke ${luecke} min zwischen T${i} und T${i + 1} (${ist[i - 1].ende}-${ist[i].start})`);
    }
  }
  if (soll.abJetzt !== undefined) {
    const a = antwort.ab_jetzt;
    if (soll.abJetzt === null) { if (a) ab.push(`ab_jetzt: soll null, ist ${a.topf_id} "${a.text}"`); }
    else if (!a) ab.push(`ab_jetzt: soll ${liste(soll.abJetzt.topf).join('|')}, ist null`);
    else {
      if (!liste(soll.abJetzt.topf).includes(a.topf_id)) ab.push(`ab_jetzt.topf: soll ${liste(soll.abJetzt.topf).join('|')}, ist ${a.topf_id}`);
      if (!unterPasst(soll.abJetzt.unter, a.unter_id)) ab.push(`ab_jetzt.unter: soll ${liste(soll.abJetzt.unter).map((u) => u || 'null').join('|')}, ist ${a.unter_id || 'null'}`);
    }
  }
  if (soll.stimmung !== undefined) {
    const m = antwort.stimmung;
    if (soll.stimmung === null) { if (m) ab.push(`stimmung: soll null, ist ${m.wert} "${m.stichwort}"`); }
    else if (!m) ab.push(`stimmung: soll ${soll.stimmung.min}..${soll.stimmung.max}, ist null`);
    else {
      if (m.wert < soll.stimmung.min || m.wert > soll.stimmung.max) ab.push(`stimmung.wert: soll ${soll.stimmung.min}..${soll.stimmung.max}, ist ${m.wert}`);
      if (soll.stimmung.stichwort && !soll.stimmung.stichwort.some((w) => m.stichwort.toLowerCase().includes(w.toLowerCase())))
        ab.push(`stimmung.stichwort: soll enthält ${soll.stimmung.stichwort.join('|')}, ist "${m.stichwort}"`);
    }
  }
  if (soll.unklar === true && !(antwort.unklar && antwort.unklar.trim())) ab.push('unklar: soll gesetzt, ist null');
  if (soll.unklar === false && antwort.unklar !== null) ab.push(`unklar: soll null, ist ${JSON.stringify(antwort.unklar)}`);
  return { ok: ab.length === 0, abweichungen: ab };
}
