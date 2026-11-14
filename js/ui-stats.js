'use strict';
/* Ansicht Auswertung (8.2): Umschalter Tag/Woche/Monat, Pfeile, Tagesspalte oder Wochenspalten, Torte, Tabelle.
   Rechnen tut stats.js; hier wird nur gelesen (db.js) und gezeichnet. Ein Tipp auf einen Block im Tag oeffnet das
   Korrekturblatt (ui-korrektur.js), danach wird neu gezeichnet. */
import * as db from './db.js?v=0.3.0';
import * as aktionen from './aktionen.js?v=0.3.0';
import { uhrzeit } from './zeit.js?v=0.3.0';
import { UNKLAR_FARBE } from './segments.js?v=0.3.0';
import * as stats from './stats.js?v=0.3.0';
import { zeigeKorrektur } from './ui-korrektur.js?v=0.3.0';

const ART_NAME = { tag: 'Tag', woche: 'Woche', monat: 'Monat' };
const VON_H = 7, BIS_H = 23, STUNDEN = BIS_H - VON_H;
const H = 3600000;
const PX_TAG = 48;      // Hoehe einer Stunde in der Tagesspalte
const PX_WOCHE = 20;    // ... in den Wochenspalten
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text != null) e.textContent = text;
  return e;
}
function knopf(text, klasse, onClick) {
  const b = el('button', klasse, text); b.type = 'button';
  b.addEventListener('click', onClick); return b;
}
function svgEl(tag, attr) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attr || {})) e.setAttribute(k, String(v));
  return e;
}
/** Schriftfarbe auf einer Topffarbe: dunkel auf hellem Grund */
function textfarbe(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const y = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return y > 165 ? '#111' : '#fff';
}
const hText = (ms) => `${stats.stundenText(ms)} h`;

/** root: Container #stats-body. Liefert { zeige() }, das main.js bei jedem Oeffnen der Ansicht aufruft. */
export function initStats(root) {
  let zr = stats.zeitraum('tag', Date.now());
  let zaehler = 0;   // nur die jeweils letzte Zeichnung gilt

  function wechsleZeitraum(neu) { zr = neu; return zeichne(false); }

  // ------------------------------------------------------------ Kopf: Umschalter und Pfeile
  function kopf() {
    const k = el('div', 'st-kopf');
    const umschalter = el('div', 'st-umschalter'); umschalter.setAttribute('role', 'group'); umschalter.setAttribute('aria-label', 'Zeitraum');
    for (const art of stats.ARTEN) {
      const b = knopf(ART_NAME[art], 'st-art', () => { if (zr.art !== art) wechsleZeitraum(stats.zeitraum(art, aktuellerBezug())); });
      b.setAttribute('aria-pressed', String(zr.art === art));
      umschalter.append(b);
    }
    const nav = el('div', 'st-nav');
    const zurueck = knopf('‹', 'st-pfeil', () => wechsleZeitraum(stats.blaettern(zr, -1)));
    zurueck.setAttribute('aria-label', 'Zurück');
    const vor = knopf('›', 'st-pfeil', () => wechsleZeitraum(stats.blaettern(zr, 1)));
    vor.setAttribute('aria-label', 'Weiter');
    const titel = el('div', 'st-titel', stats.titel(zr)); titel.setAttribute('aria-live', 'polite');
    nav.append(zurueck, titel, vor);
    k.append(umschalter, nav);
    if (!stats.enthaelt(zr, Date.now())) {
      k.append(knopf(`Zu heute (${ART_NAME[zr.art]})`, 'knopf st-heute', () => wechsleZeitraum(stats.zeitraum(zr.art, Date.now()))));
    }
    return k;
  }
  /** Beim Wechsel der Art: heute, wenn der Zeitraum heute enthaelt, sonst sein Anfang */
  function aktuellerBezug() { return stats.enthaelt(zr, Date.now()) ? Date.now() : zr.start; }

  // ------------------------------------------------------------ Tag
  function blockText(s, topf) {
    return `${uhrzeit(s.start)}–${uhrzeit(s.ende)} · ${topf ? topf.name : 'Unklar'}${s.text ? ' · ' + s.text : ''}`;
  }
  function randHinweis(text, klasse) { return el('div', `st-rand ${klasse}`, text); }

  function tagAnsicht(segmente, toepfe, info) {
    const sk = stats.skala(zr.start, VON_H, BIS_H);
    const rand = stats.ausserhalb(segmente, zr.start, zr.ende, sk);
    const box = el('div', 'st-tag');
    if (rand.davor > 0) box.append(randHinweis(`▲ Vor ${VON_H} Uhr: ${hText(rand.davor)}`, 'oben'));
    const spalte = el('div', 'st-spalte'); spalte.style.height = `${STUNDEN * PX_TAG}px`;
    for (let h = VON_H; h <= BIS_H; h++) {
      const linie = el('div', 'st-stunde'); linie.style.top = `${(h - VON_H) * PX_TAG}px`;
      linie.append(el('span', 'st-stunde-zahl', `${String(h).padStart(2, '0')}`));
      spalte.append(linie);
    }
    const flaeche = el('div', 'st-flaeche');
    for (const s of stats.zuschneiden(segmente, sk.von, sk.bis)) {
      const topf = info.get(s.topfId) || null;
      const farbe = topf ? topf.farbe : UNKLAR_FARBE;
      const hoehe = (s.ende - s.start) / H * PX_TAG;
      const b = knopf(s.text || (topf ? topf.name : 'Unklar'), 'st-block', () => oeffneKorrektur(s.id));
      b.style.top = `${(s.start - sk.von) / H * PX_TAG}px`;
      b.style.height = `${Math.max(2, hoehe)}px`;
      b.style.background = farbe; b.style.color = textfarbe(farbe);
      if (hoehe < 20) b.classList.add('flach');
      else if (hoehe >= 40) b.classList.add('hoch');
      b.setAttribute('aria-label', blockText(s, topf)); b.title = blockText(s, topf);
      flaeche.append(b);
    }
    spalte.append(flaeche);
    box.append(spalte);
    if (rand.danach > 0) box.append(randHinweis(`▼ Nach ${BIS_H} Uhr: ${hText(rand.danach)}`, 'unten'));
    return box;
  }

  function oeffneKorrektur(id) {
    const s = zuletzt.segmente.find((x) => x.id === id);
    if (!s) return;
    zeigeKorrektur({
      toepfe: zuletzt.toepfe, segment: s, vorgabe: { start: s.start, ende: s.ende },
      onSpeichern: async (a) => { await aktionen.segmentKorrigieren(s.id, a); await zeichne(true); },
      onLoeschen: async () => { await aktionen.segmentLoeschen(s.id); await zeichne(true); },
    });
  }

  // ------------------------------------------------------------ Woche
  function wochenAnsicht(segmente, toepfe, info) {
    const box = el('div', 'st-woche-box');
    const reihe = el('div', 'st-woche');
    let ausserSumme = 0;
    const heute = stats.zeitraum('tag', Date.now()).start;
    for (const tagStart of zr.tage) {
      const tag = stats.zeitraum('tag', tagStart);
      const sk = stats.skala(tagStart, VON_H, BIS_H);
      const rand = stats.ausserhalb(segmente, tag.start, tag.ende, sk);
      ausserSumme += rand.davor + rand.danach;
      const d = new Date(tagStart);
      const spalte = knopf('', 'st-wtag', () => wechsleZeitraum(tag));
      spalte.setAttribute('aria-label', `${stats.titel(tag)} öffnen`);
      if (tagStart === heute) spalte.classList.add('heute');
      spalte.append(el('span', 'st-wtag-name', stats.wochentagKurz(tagStart)), el('span', 'st-wtag-nr', String(d.getDate())));
      const flaeche = el('span', 'st-wflaeche'); flaeche.style.height = `${STUNDEN * PX_WOCHE}px`;
      if (rand.davor > 0) { const m = el('span', 'st-wrand oben'); m.title = `Vor ${VON_H} Uhr: ${hText(rand.davor)}`; flaeche.append(m); }
      if (rand.danach > 0) { const m = el('span', 'st-wrand unten'); m.title = `Nach ${BIS_H} Uhr: ${hText(rand.danach)}`; flaeche.append(m); }
      for (const s of stats.zuschneiden(segmente, sk.von, sk.bis)) {
        const topf = info.get(s.topfId) || null;
        const b = el('span', 'st-wblock');
        b.style.top = `${(s.start - sk.von) / H * PX_WOCHE}px`;
        b.style.height = `${Math.max(1, (s.ende - s.start) / H * PX_WOCHE)}px`;
        b.style.background = topf ? topf.farbe : UNKLAR_FARBE;
        flaeche.append(b);
      }
      spalte.append(flaeche);
      reihe.append(spalte);
    }
    box.append(reihe);
    if (ausserSumme > 0) box.append(el('div', 'st-fussnote', `Außerhalb ${VON_H}–${BIS_H} Uhr (am Rand markiert): ${hText(ausserSumme)}`));
    return box;
  }

  // ------------------------------------------------------------ Torte und Tabelle
  function torte(zeilen) {
    const svg = svgEl('svg', { viewBox: '0 0 200 200', class: 'st-torte', role: 'img' });
    svg.setAttribute('aria-label', 'Anteile der Töpfe an der erfassten Zeit: ' + zeilen.map((z) => `${z.name} ${stats.prozentText(z.anteil)}`).join(', '));
    const M = 100, R = 92;
    if (zeilen.length === 1) {
      svg.append(svgEl('circle', { cx: M, cy: M, r: R, fill: zeilen[0].farbe, stroke: '#111', 'stroke-width': 2 }));
      return svg;
    }
    let winkel = -Math.PI / 2;
    for (const z of zeilen) {
      const w = z.anteil * 2 * Math.PI, ende = winkel + w;
      const p = (a) => `${(M + R * Math.cos(a)).toFixed(2)},${(M + R * Math.sin(a)).toFixed(2)}`;
      const d = `M${M},${M} L${p(winkel)} A${R},${R} 0 ${w > Math.PI ? 1 : 0} 1 ${p(ende)} Z`;
      svg.append(svgEl('path', { d, fill: z.farbe, stroke: '#111', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      winkel = ende;
    }
    return svg;
  }

  function zelle(tag, text, klasse) { return el(tag, klasse || null, text); }
  function tabelle(erg) {
    const t = el('table', 'st-tabelle');
    const kopfZeile = el('tr');
    kopfZeile.append(zelle('th', 'Topf'), zelle('th', 'Stunden', 'zahl'), zelle('th', 'Anteil', 'zahl'));
    const thead = el('thead'); thead.append(kopfZeile); t.append(thead);
    const body = el('tbody');
    for (const z of erg.zeilen) {
      const r = el('tr');
      const name = el('td', 'name');
      const punkt = el('span', 'punkt'); punkt.style.background = z.farbe;
      name.append(punkt, el('span', null, z.name));
      if (z.archiviert) name.append(el('span', 'st-archiv', 'archiviert'));
      r.append(name, zelle('td', stats.stundenText(z.ms), 'zahl'), zelle('td', stats.prozentText(z.anteil), 'zahl'));
      body.append(r);
    }
    t.append(body);
    const fuss = el('tbody', 'st-summen');
    const summe = (text, ms, klasse, mitAnteil = true) => {
      const r = el('tr', klasse);
      r.append(zelle('td', text), zelle('td', stats.stundenText(ms), 'zahl'),
        zelle('td', mitAnteil && erg.gesamt ? stats.prozentText(ms / erg.gesamt) : '', 'zahl'));
      fuss.append(r);
    };
    summe('Bezahlt', erg.bezahlt, 'bezahlt');
    summe('Unbezahlt', erg.unbezahlt, 'unbezahlt');
    summe('Erfasst gesamt', erg.gesamt, 'gesamt');
    summe('Nicht erfasst', erg.nichtErfasst, 'nicht', false);
    t.append(fuss);
    return t;
  }

  // ------------------------------------------------------------ Zeichnen
  let zuletzt = { segmente: [], toepfe: [] };

  /** behalteScroll: nach einer Korrektur an derselben Stelle bleiben, sonst nach oben. */
  async function zeichne(behalteScroll) {
    const mein = ++zaehler;
    let toepfe, alle;
    try { [toepfe, alle] = await Promise.all([db.listToepfe(), db.listSegmente()]); }
    catch (e) {
      if (mein !== zaehler) return;
      const f = el('div', 'st-leer', `Die Daten lassen sich nicht lesen: ${(e && e.message) || e}`);
      root.replaceChildren(kopf(), f);
      return;
    }
    if (mein !== zaehler) return; // inzwischen wurde weitergeblaettert
    zuletzt = { segmente: alle, toepfe };
    const info = new Map(toepfe.map((t) => [t.id, t]));
    const erg = stats.auswerten(alle, toepfe, zr, Date.now());

    const teile = [kopf()];
    if (erg.leer) {
      teile.push(el('div', 'st-leer', `Für ${zr.art === 'tag' ? 'diesen Tag' : zr.art === 'woche' ? 'diese Woche' : 'diesen Monat'} sind keine Einträge erfasst.`));
    } else {
      if (zr.art === 'tag') teile.push(tagAnsicht(alle, toepfe, info));
      else if (zr.art === 'woche') teile.push(wochenAnsicht(alle, toepfe, info));
      const torteBox = el('div', 'st-torte-box'); torteBox.append(torte(erg.zeilen));
      teile.push(torteBox, tabelle(erg));
    }
    const alt = root.scrollTop;
    root.replaceChildren(...teile);
    root.scrollTop = behalteScroll ? alt : 0;
  }

  return {
    /** Bei jedem Oeffnen: heutiger Tag. */
    zeige() { zr = stats.zeitraum('tag', Date.now()); return zeichne(false); },
  };
}
