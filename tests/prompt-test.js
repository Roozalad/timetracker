'use strict';
/* prompt-test.html: fuehrt alle Zuordnungs-Testfaelle gegen die echte API aus (oder mit ?attrappe=1 gegen
   eine Attrappe), jeden Fall mehrmals, und zeigt Soll, Ist und Abweichung. Der Rueckmelde-Text enthaelt
   weder Key noch Transkripte, nur Fall-IDs, Erwartungen, Kurzform der Antworten, Fehler und Verbrauch. */
import { CONFIG } from '../js/config.js?v=0.4.0';
import * as key from '../js/key.js?v=0.4.0';
import { categorize, PROMPT_VERSION, SYSTEMPROMPT } from '../js/categorize.js?v=0.4.0';
import { FAELLE } from './zuordnung-faelle.js?v=0.4.0';
import { pruefeFall, kurzAntwort, kurzErwartung } from './zuordnung-auswertung.js?v=0.4.0';
import { attrappeFetch } from './zuordnung-attrappe.js?v=0.4.0';

const $ = (id) => document.getElementById(id);
const ATTRAPPE = new URLSearchParams(location.search).has('attrappe');
const PREISE = CONFIG.zuordnenPreise;

// ---------------------------------------------------------------- Kopf, Key
$('info').textContent = `App ${CONFIG.version} · Prompt ${PROMPT_VERSION} · Endpunkt ${CONFIG.zuordnenEndpoint} · ${FAELLE.length} Fälle`;
$('pv').textContent = `(${PROMPT_VERSION}, ${SYSTEMPROMPT.length} Zeichen)`;
$('prompt').textContent = SYSTEMPROMPT;
$('modell').value = CONFIG.zuordnenModell;
$('reasoning').value = CONFIG.zuordnenReasoning;

if (ATTRAPPE) {
  $('attrappe').hidden = false;
  key._keySpeicherName('zeiterfassung.attrappeKey');   // nie der echte Key
  key.setKey('sk-attrappe-0000');
  globalThis.fetch = attrappeFetch(FAELLE).fetch;
}
function zeigeKey() {
  const k = key.getKey();
  $('key-da').hidden = !k; $('key-fehlt').hidden = !!k;
  $('key-ende').textContent = k ? key.keyEnde() : '';
}
$('key-speichern').addEventListener('click', () => {
  const v = $('key-feld').value.trim();
  if (!v) return;
  key.setKey(v); $('key-feld').value = ''; zeigeKey();
});
$('key-weg').addEventListener('click', () => { key.removeKey(); zeigeKey(); });
zeigeKey();

// ---------------------------------------------------------------- Ergebniszustand
let ergebnis = null;   // { start, einstellungen, faelle: [{fall, laeufe: [lauf|null]}], abgebrochen, abbruchGrund }
let abbrechen = false;

const sym = (l) => (!l ? '·' : l.laeuft ? '…' : l.fehler ? '!' : l.ok ? '✓' : '✗');
const klasse = (l) => (!l ? 'l-wartet' : l.laeuft ? 'l-laeuft' : l.fehler ? 'l-fehler' : l.ok ? 'l-ok' : 'l-falsch');
const fallOk = (f) => f.laeufe.every((l) => l && !l.laeuft && !l.fehler && l.ok);
const fertig = (f) => f.laeufe.every((l) => l && !l.laeuft);

function kosten(n) {
  if (!n) return 0;
  const d = n.input_tokens_details || {};
  const cached = d.cached_tokens || 0, schreib = d.cache_write_tokens || 0;
  const normal = Math.max(0, (n.input_tokens || 0) - cached - schreib);
  return (normal * PREISE.eingabe + cached * PREISE.eingabeCache + schreib * PREISE.eingabeCacheSchreiben + (n.output_tokens || 0) * PREISE.ausgabe) / 1e6;
}
function summen() {
  const s = { faelle: 0, faelleOk: 0, laeufe: 0, laeufeOk: 0, falsch: 0, fehler: 0, ein: 0, cached: 0, aus: 0, reasoning: 0, kosten: 0, aufrufe: 0, dauer: [], antwortModelle: new Set() };
  for (const f of ergebnis.faelle) {
    if (fertig(f)) { s.faelle++; if (fallOk(f)) s.faelleOk++; }
    for (const l of f.laeufe) {
      if (!l || l.laeuft) continue;
      s.laeufe++;
      if (l.fehler) s.fehler++; else if (l.ok) s.laeufeOk++; else s.falsch++;
      for (const m of l.metas) {
        if (m.antwortModell) s.antwortModelle.add(m.antwortModell);
        if (typeof m.dauerMs === 'number') s.dauer.push(m.dauerMs);
        const n = m.nutzung; if (!n) continue;
        s.aufrufe++;
        s.ein += n.input_tokens || 0; s.aus += n.output_tokens || 0;
        s.cached += (n.input_tokens_details && n.input_tokens_details.cached_tokens) || 0;
        s.reasoning += (n.output_tokens_details && n.output_tokens_details.reasoning_tokens) || 0;
        s.kosten += kosten(n);
      }
    }
  }
  return s;
}
const usd = (x) => `${x.toFixed(x < 0.01 ? 5 : 4)} USD`;
const sek = (ms) => `${(ms / 1000).toFixed(1)} s`;

function gesamtText(s) {
  const e = ergebnis.einstellungen;
  const avg = s.dauer.length ? s.dauer.reduce((a, b) => a + b, 0) / s.dauer.length : 0;
  const zeilen = [
    `Ergebnis: ${s.faelleOk}/${ergebnis.faelle.length} Fälle bestanden (alle ${e.laeufe} Läufe) · Läufe ${s.laeufeOk}/${s.laeufe} bestanden, ${s.falsch} falsch, ${s.fehler} API-/Formatfehler`
      + (ergebnis.abgebrochen ? ` · ABGEBROCHEN: ${ergebnis.abbruchGrund}` : ''),
    `Modell ${e.modell}${s.antwortModelle.size ? ` (Antwort: ${[...s.antwortModelle].join(', ')})` : ''} · reasoning ${e.reasoning} · Prompt ${PROMPT_VERSION}`,
    `Token: ein ${s.ein} (davon cached ${s.cached}), aus ${s.aus} (davon reasoning ${s.reasoning}) · Kosten ${usd(s.kosten)}`
      + (s.aufrufe ? `, je Aufruf ${usd(s.kosten / s.aufrufe)}, je Aufruf Ø ${Math.round(s.ein / s.aufrufe)} ein / ${Math.round(s.aus / s.aufrufe)} aus` : '')
      + ` · Dauer Ø ${sek(avg)}, max ${sek(s.dauer.length ? Math.max(...s.dauer) : 0)}`,
  ];
  if (e.modell !== CONFIG.zuordnenModell) zeilen.push(`Hinweis: Preise laut config.js gelten für ${CONFIG.zuordnenModell}.`);
  return zeilen;
}

// ---------------------------------------------------------------- Anzeige
function zeileFuer(f, i) {
  const tr = document.createElement('tr'); tr.id = `z-${i}`;
  tr.innerHTML = '<td class="id"></td><td class="laeufe"></td><td class="erg"></td>';
  tr.querySelector('.id').innerHTML = `<b></b><div class="titel"></div>`;
  tr.querySelector('.id b').textContent = f.fall.id;
  tr.querySelector('.id .titel').textContent = `${f.fall.titel} · ${f.fall.thema}`;
  return tr;
}
function div(klasse, text) { const d = document.createElement('div'); d.className = `zeile ${klasse}`; d.textContent = text; return d; }

function laufZeilen(l, nr) {
  const out = [];
  if (l.fehler) {
    out.push(div('err', `L${nr} Fehler ${l.fehler.art}${l.fehler.grund ? '/' + l.fehler.grund : ''}${l.fehler.status ? ' HTTP ' + l.fehler.status : ''}: ${l.fehler.meldung}`));
    if (l.fehler.roh) out.push(div('err', `L${nr} roh: ${l.fehler.roh}`));
  } else {
    out.push(div('ist', `L${nr} Ist: ${l.ist}`));
    for (const a of l.abweichungen) out.push(div('ab', `L${nr} Abweichung: ${a}`));
  }
  if (l.versuche > 1) out.push(div('klein', `L${nr}: ${l.versuche} Versuche (vorher: ${l.vorherFehler.join('; ')})`));
  return out;
}

function aktualisiereZeile(i) {
  const f = ergebnis.faelle[i];
  const tr = $(`z-${i}`);
  const td = tr.querySelector('.laeufe'); td.textContent = '';
  for (const l of f.laeufe) { const s = document.createElement('span'); s.className = `lauf ${klasse(l)}`; s.textContent = sym(l); td.append(s); }
  const erg = tr.querySelector('.erg'); erg.textContent = '';
  if (!fertig(f) && !ergebnis.ende) { erg.textContent = f.laeufe.some((l) => l) ? 'läuft …' : ''; return; }
  const ok = fallOk(f);
  const det = document.createElement('details'); det.className = 'fall'; det.open = !ok;
  const sum = document.createElement('summary');
  sum.innerHTML = `<span class="${ok ? 'ok' : 'nok'}">${ok ? 'bestanden' : fertig(f) ? 'nicht bestanden' : 'nicht vollständig ausgeführt'}</span>`;
  det.append(sum, div('soll', `Soll: ${kurzErwartung(f.fall.soll)}`));
  f.laeufe.forEach((l, k) => { if (l && !l.laeuft) det.append(...laufZeilen(l, k + 1)); });
  erg.append(det);
}

function aktualisiereGesamt() {
  const s = summen();
  const g = $('gesamt');
  const laeuft = ergebnis.faelle.some((f) => !fertig(f)) && !ergebnis.ende;
  g.className = `gesamt ${laeuft ? 'lauf' : s.faelleOk === ergebnis.faelle.length && !ergebnis.abgebrochen ? 'gruen' : 'rot'}`;
  g.textContent = '';
  for (const z of gesamtText(s)) { const d = document.createElement('div'); d.textContent = z; g.append(d); }
}

// ---------------------------------------------------------------- Rueckmelde-Text
function rueckmeldung() {
  const s = summen();
  const e = ergebnis.einstellungen;
  const z = [];
  z.push(`Prompt-Test Zuordnung · ${ergebnis.start} · App ${CONFIG.version} · Prompt ${PROMPT_VERSION}${ATTRAPPE ? ' · ATTRAPPE (kein echter Lauf)' : ''}`);
  z.push(`Einstellungen: Modell ${e.modell}, reasoning ${e.reasoning}, Läufe ${e.laeufe}, Fälle ${e.filter || 'alle'}`);
  z.push(...gesamtText(s));
  const nicht = ergebnis.faelle.filter((f) => !fallOk(f));
  const gut = ergebnis.faelle.filter((f) => fallOk(f));
  z.push('', `--- nicht bestanden (${nicht.length})`);
  for (const f of nicht) {
    z.push(`${f.fall.id} ${f.fall.titel} [${f.laeufe.map(sym).join('')}]`);
    z.push(`  Soll: ${kurzErwartung(f.fall.soll)}`);
    f.laeufe.forEach((l, k) => {
      if (!l) { z.push(`  L${k + 1} nicht ausgeführt`); return; }
      for (const d of laufZeilen(l, k + 1)) z.push(`  ${d.textContent}`);
    });
  }
  z.push('', `--- bestanden (${gut.length})`);
  z.push(gut.map((f) => f.fall.id).join(' ') || '-');
  return key.maskiere(z.join('\n'));
}

$('kopieren').addEventListener('click', async () => {
  const t = rueckmeldung();
  const ta = $('text'); ta.hidden = false; ta.value = t;
  try { await navigator.clipboard.writeText(t); $('kopiert').textContent = `kopiert (${t.length} Zeichen)`; }
  catch (_) {
    ta.focus(); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (__) {}
    $('kopiert').textContent = ok ? `kopiert (${t.length} Zeichen)` : 'Bitte den Text unten markieren und kopieren.';
  }
});

// ---------------------------------------------------------------- Lauf
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kuerze = (t, n = 400) => (t && t.length > n ? `${t.slice(0, n)}…` : t);

async function einLauf(fall, e) {
  const l = { metas: [], versuche: 0, vorherFehler: [] };
  for (;;) {
    l.versuche++;
    const meta = {};
    l.metas.push(meta);
    try {
      const antwort = await categorize(fall.eingabe, { modell: e.modell, reasoning: e.reasoning, meta });
      const r = pruefeFall(fall, antwort);
      l.ok = r.ok; l.abweichungen = r.abweichungen; l.ist = kurzAntwort(antwort);
      return l;
    } catch (err) {
      const f = { art: err.art || 'intern', grund: err.grund || '', status: err.status || 0, meldung: key.maskiere(err.message || String(err)), roh: kuerze(err.roh) };
      if (f.art === 'auth' || f.art === 'kein_key') { l.fehler = f; l.abbruch = true; return l; }
      if ((f.art === 'server' || f.art === 'netz') && l.versuche < 3) {   // voruebergehend: bis zu zwei Wiederholungen
        l.vorherFehler.push(`${f.art}${f.status ? ' ' + f.status : ''}`);
        await warte(1500 * l.versuche);
        continue;
      }
      l.fehler = f; return l;
    }
  }
}

async function starte() {
  if (!key.getKey()) { $('gesamt').textContent = 'Bitte zuerst einen API-Key eintragen.'; $('gesamt').className = 'gesamt rot'; return; }
  const filter = $('filter').value.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const auswahl = filter.length ? FAELLE.filter((f) => filter.includes(f.id)) : FAELLE;
  if (!auswahl.length) { $('gesamt').textContent = 'Kein Fall passt zum Filter.'; return; }
  const e = {
    modell: $('modell').value.trim() || CONFIG.zuordnenModell,
    reasoning: $('reasoning').value,
    laeufe: Math.max(1, Math.min(10, Number($('laeufe').value) || 3)),
    parallel: Math.max(1, Math.min(8, Number($('parallel').value) || 4)),
    filter: filter.join(','),
  };
  const d = new Date();
  ergebnis = {
    start: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    einstellungen: e, faelle: auswahl.map((fall) => ({ fall, laeufe: Array(e.laeufe).fill(null) })), abgebrochen: false, abbruchGrund: '', ende: false,
  };
  abbrechen = false;
  $('start').disabled = true; $('stopp').disabled = false; $('kopieren').disabled = true; $('text').hidden = true; $('kopiert').textContent = '';
  const tbody = $('zeilen'); tbody.textContent = '';
  ergebnis.faelle.forEach((f, i) => tbody.append(zeileFuer(f, i)));
  ergebnis.faelle.forEach((_, i) => aktualisiereZeile(i));
  aktualisiereGesamt();

  // Lauf k aller Faelle vor Lauf k+1, damit ein Abbruch moeglichst gleichmaessige Ergebnisse hinterlaesst
  const jobs = [];
  for (let k = 0; k < e.laeufe; k++) ergebnis.faelle.forEach((_, i) => jobs.push([i, k]));
  let naechster = 0;
  const arbeiter = async () => {
    while (!abbrechen && naechster < jobs.length) {
      const [i, k] = jobs[naechster++];
      const f = ergebnis.faelle[i];
      f.laeufe[k] = { laeuft: true };
      aktualisiereZeile(i);
      const l = await einLauf(f.fall, e);
      f.laeufe[k] = l;
      if (l.abbruch && !abbrechen) { abbrechen = true; ergebnis.abgebrochen = true; ergebnis.abbruchGrund = `${l.fehler.art}: ${l.fehler.meldung}`; }
      aktualisiereZeile(i); aktualisiereGesamt();
    }
  };
  await Promise.all(Array.from({ length: e.parallel }, arbeiter));
  if (abbrechen && !ergebnis.abgebrochen) { ergebnis.abgebrochen = true; ergebnis.abbruchGrund = 'von Hand'; }
  ergebnis.ende = true;
  ergebnis.faelle.forEach((_, i) => aktualisiereZeile(i));
  aktualisiereGesamt();
  $('start').disabled = false; $('stopp').disabled = true; $('kopieren').disabled = false;
  document.title = `${ergebnis.faelle.every(fallOk) ? 'GRÜN' : 'ROT'} · Prompt-Test`;
}

$('start').addEventListener('click', () => { starte().catch((err) => { $('gesamt').textContent = `Interner Fehler: ${key.maskiere(err && err.message)}`; $('start').disabled = false; }); });
$('stopp').addEventListener('click', () => { abbrechen = true; $('stopp').disabled = true; });
