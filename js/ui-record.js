'use strict';
/* Ansicht Aufnahme (8.1): Kopfzeile, Button, Bestaetigung, wartende Eintraege, Ergebniskarten der heutigen Eintraege
   mit Korrekturblatt, Block von Hand, "Neu zuordnen" und "Eintrag loeschen". */
import { createRecorder } from './recorder.js?v=0.4.2';
import * as pipeline from './pipeline.js?v=0.4.2';
import * as db from './db.js?v=0.4.2';
import * as aktionen from './aktionen.js?v=0.4.2';
import { log } from './log.js?v=0.4.2';
import { maskiere } from './key.js?v=0.4.2';
import { uhrzeit, vorZeitText, dauerText, gleicherTag } from './zeit.js?v=0.4.2';
import { UNKLAR, UNKLAR_FARBE, blockVorgabe } from './segments.js?v=0.4.2';
import { zeigeKorrektur, frage } from './ui-korrektur.js?v=0.4.2';
import { LETZTER_EXPORT } from './ui-settings.js?v=0.4.2';
import { sicherungText, exportZeitAusText } from './sicherung.js?v=0.4.2';

const STATUS_TEXT = {
  wartet_transkription: 'Wartet auf Transkription',
  wartet_zuordnung: 'Wartet auf Zuordnung',
  fertig: 'Fertig',
  fehler: 'Fehler',
};
const BESTAETIGUNG_MS = 1500;
const STIMMUNG_ZEICHEN = { '-2': '−−', '-1': '−', '0': '±0', '1': '+', '2': '++' };

/** ctx: { zeigeAnsicht(name), dbFehler: Error|null } */
export function initRecord(root, ctx) {
  const q = (s) => root.querySelector(s);
  const el = { last: q('#last'), status: q('#status'), detail: q('#detail'), hinweis: q('#hinweis'), rec: q('#rec'),
               dauer: q('#dauerhinweis'), sicherung: q('#sicherung'), pending: q('#pending'), results: q('#results'), leer: q('#leer'), hand: q('#handblock') };

  let recState = 'bereit', startedAt = 0, tick = null, pointerDown = false;
  let outcome = { kind: 'ready', text: 'Bereit', detail: '' };
  let flash = null;               // kurze Bestaetigung "Gesendet": { text, bis }
  let pipeBusy = false;
  let pipeFehlerSichtbar = false; // Fehlertext des letzten Laufs steht im Status (nicht noch einmal in der Wartebox)
  let laufMitFehlerEintrag = false;
  let letzter = null, toepfe = [], segmente = [];
  let dauerHinweis = '';          // "Hoechstdauer erreicht", bleibt bis zur naechsten Aufnahme sichtbar
  const offeneTranskripte = new Set();
  let direktListe = [];           // nur Sitzung: ohne Speicher direkt gesendete Aufnahmen
  let aktTicket = 0;

  function setOutcome(kind, text, detail = '') { outcome = { kind, text, detail }; render(); }

  // ------------------------------------------------------------ Anzeige
  function render() {
    let o;
    const jetzt = performance.now();
    if (recState === 'beende') o = { kind: 'processing', text: 'Beende Aufnahme …', detail: '' };
    else if (recState === 'startet') o = { kind: 'starting', text: 'Mikrofon startet …', detail: outcome.detail };
    else if (recState === 'nimmt_auf') o = { kind: 'recording', text: 'Nimmt auf …', detail: outcome.detail };
    else if (flash && jetzt < flash.bis) o = { kind: 'done', text: flash.text, detail: '' };
    else if (pipeBusy) o = { kind: 'processing', text: 'Verarbeitet …', detail: '' };
    else o = outcome;
    el.status.className = `status s-${o.kind}`;
    el.status.textContent = o.text;
    el.detail.textContent = o.detail || '';
    el.dauer.hidden = !dauerHinweis; el.dauer.textContent = dauerHinweis;

    const aktiv = pointerDown && (recState === 'startet' || recState === 'nimmt_auf');
    el.rec.classList.toggle('active', aktiv);
    el.rec.classList.toggle('verarbeitet', !aktiv && o.kind === 'processing');
    el.rec.classList.toggle('fertig', !aktiv && o.kind === 'done');
    el.rec.classList.toggle('fehler', !aktiv && o.kind === 'error');
    if (recState === 'nimmt_auf') {
      el.rec.textContent = 'Aufnahme';
      const sek = document.createElement('span'); sek.className = 'sek'; sek.id = 'sek';
      sek.textContent = dauerText((performance.now() - startedAt) / 1000);
      el.rec.append(sek);
    } else if (recState === 'startet') el.rec.textContent = 'Mikrofon startet …';
    else el.rec.textContent = 'Halten & sprechen';
    renderHinweis();
  }

  function renderHinweis() {
    const b = pipeline.zustand().blockiert;
    let text = '';
    if (ctx.dbFehler) text = 'Speicher nicht verfügbar. Aufnahmen werden direkt gesendet und nicht gespeichert.';
    else if (b && b.art === 'kein_key') text = 'Kein API-Key eingetragen. Aufnahmen sind möglich und warten.';
    else if (b) text = `${b.meldung.replace(/[.\s]+$/, '')}. Der Eintrag wartet. Key prüfen oder Guthaben aufladen, dann „Jetzt senden“.`;
    el.hinweis.hidden = !text;
    el.hinweis.textContent = text;
    if (text && !ctx.dbFehler) {
      const k = document.createElement('button'); k.type = 'button'; k.textContent = 'Zu den Einstellungen';
      k.addEventListener('click', () => ctx.zeigeAnsicht('settings'));
      el.hinweis.append(document.createElement('br'), k);
    }
  }

  function renderKopf() {
    let t = 'Noch kein Eintrag';
    if (letzter) {
      t = `Letzter Eintrag ${vorZeitText(letzter.zeit)}`;
      const a = letzter.angekuendigt;
      if (a && a.text && gleicherTag(letzter.zeit, Date.now())) {
        const topf = toepfe.find((x) => x.id === a.topfId);
        t = `Läuft seit ${uhrzeit(letzter.zeit)}: ${topf ? `${topf.name} – ` : ''}${a.text}`;
      }
    }
    el.last.textContent = t;
  }

  /** Dezente Erinnerung an den Export (8.3), fuehrt zu Einstellungen > Daten. Liest nur, schreibt nichts. */
  function renderSicherung(eintraege) {
    let ex = null;
    try { ex = exportZeitAusText(localStorage.getItem(LETZTER_EXPORT)); } catch (_) {}
    const alt = eintraege.length ? Math.min(...eintraege.map((e) => e.zeit)) : null;
    const text = sicherungText({ letzterExport: ex, aeltesterEintrag: alt, jetzt: Date.now() });
    el.sicherung.textContent = '';
    el.sicherung.hidden = !text;
    if (!text) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sicherung-link';
    b.textContent = `${text} Jetzt sichern`;
    b.addEventListener('click', () => ctx.zeigeAnsicht('settings', 'daten'));
    el.sicherung.append(b);
  }

  // ------------------------------------------------------------ Ergebniskarte (8.1)
  const E = (tag, klasse, text) => { const x = document.createElement(tag); if (klasse) x.className = klasse; if (text != null) x.textContent = text; return x; };
  function topfInfo(id) {
    if (id === UNKLAR) return { name: 'Unklar', farbe: UNKLAR_FARBE, unter: [] };
    const t = toepfe.find((x) => x.id === id);
    return t ? { name: t.name, farbe: t.farbe, unter: t.unter || [] } : { name: String(id), farbe: '#777', unter: [] };
  }
  const unterName = (info, id) => { const u = info.unter.find((x) => x.id === id); return u ? u.name : ''; };
  function punkt(farbe) { const p = E('span', 'punkt'); p.style.background = farbe; return p; }

  /** "10:00–10:30 · Startup · Mails": eine Zeile, antippbar fuer die Korrektur. */
  function segmentZeile(s) {
    const info = topfInfo(s.topfId), u = s.unterId ? unterName(info, s.unterId) : '';
    const b = E('button', `seg${s.topfId === UNKLAR ? ' unklar' : ''}`);
    b.type = 'button'; b.dataset.segment = s.id;
    const teile = [`${uhrzeit(s.start)}–${uhrzeit(s.ende)}`, u ? `${info.name} › ${u}` : info.name];
    if (s.text) teile.push(s.text);
    b.append(punkt(info.farbe), E('span', 'seg-text', teile.join(' · ')));
    b.addEventListener('click', () => oeffneKorrektur(s));
    return b;
  }

  function oeffneKorrektur(s) {
    zeigeKorrektur({
      toepfe, segment: s, vorgabe: { start: s.start, ende: s.ende },
      onSpeichern: async (a) => { await aktionen.segmentKorrigieren(s.id, a); await aktualisiere(); },
      onLoeschen: async () => { await aktionen.segmentLoeschen(s.id); await aktualisiere(); },
    });
  }
  /** Block von Hand: eintrag gesetzt = Block gehoert zu dieser Karte, Vorgabe ist deren Fenster; sonst das aktuelle Fenster. */
  function oeffneHandblock(eintrag) {
    const jetzt = Date.now();
    const vorgabe = eintrag
      ? blockVorgabe(eintrag.zeit, eintrag.fensterStart)
      : blockVorgabe(jetzt, letzter && gleicherTag(letzter.zeit, jetzt) ? letzter.zeit : null);
    zeigeKorrektur({
      toepfe, segment: null, vorgabe,
      onSpeichern: async (a) => { await aktionen.blockAnlegen({ ...a, eintragId: eintrag ? eintrag.id : null }); await aktualisiere(); },
    });
  }
  async function neuZuordnen(e) {
    if (!(await aktionen.neuZuordnen(e.id))) return;
    await aktualisiere();
    pipeline.starte('Neu zuordnen', { manuell: true });
  }
  async function eintragLoeschen(e) {
    const ok = await frage({ titel: 'Eintrag löschen?', text: `Der Eintrag von ${uhrzeit(e.zeit)} und alle seine Blöcke werden gelöscht. Das lässt sich nicht rückgängig machen.`, ja: 'Löschen', gefahr: true });
    if (!ok) return;
    try { await aktionen.eintragLoeschen(e.id); } catch (err) { log(`Löschen fehlgeschlagen: ${maskiere(err && err.message)}`); }
    await aktualisiere();
  }
  const aktion = (text, fn, klasse = 'knopf') => { const b = E('button', klasse, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

  function renderEintrag(e) {
    const li = E('li', `karte st-${e.status}`);
    li.dataset.eintrag = e.id;
    const kopf = E('div', 'kopf');
    kopf.append(E('span', 'zeit', uhrzeit(e.zeit)), E('span', 'badge', STATUS_TEXT[e.status] || e.status));
    li.append(kopf);

    const segs = segmente.filter((s) => s.eintragId === e.id).sort((a, b) => a.start - b.start);
    const warten = e.status === 'wartet_transkription' || e.status === 'wartet_zuordnung';
    if (e.status === 'wartet_transkription') li.append(E('div', 'text', 'Aufnahme gespeichert, noch nicht transkribiert.'));
    if (e.status === 'wartet_zuordnung') li.append(E('div', 'text', 'Transkript gespeichert, wartet auf die Zuordnung.'));
    if (e.status === 'fehler') {
      li.append(E('div', 'text fehlertext', e.fehler || 'Die Zuordnung ist fehlgeschlagen.'),
        E('div', 'meta', 'Mit „Neu zuordnen“ nochmal versuchen oder einen Block von Hand anlegen.'));
    }
    const lis = E('div', 'segs'); for (const s of segs) lis.append(segmentZeile(s));
    if (segs.length) li.append(lis);

    const a = e.angekuendigt;
    const nichts = e.status === 'fertig' && !segs.length && !(a && a.text);
    if (nichts) li.append(E('div', 'text nichts', 'Nichts erkannt'));
    if (a && a.text) {
      const info = topfInfo(a.topfId), u = a.unterId ? unterName(info, a.unterId) : '';
      const z = E('div', 'abjetzt'); z.append(punkt(info.farbe), E('span', null, `Ab jetzt: ${u ? `${info.name} › ${u}` : info.name} – ${a.text}`));
      li.append(z);
    }
    if (e.stimmung) {
      li.append(E('div', 'stimmung', `Stimmung: ${e.stimmung.stichwort || '–'} (${STIMMUNG_ZEICHEN[String(e.stimmung.wert)] || e.stimmung.wert})`));
    }
    if (e.unklar && e.status !== 'wartet_zuordnung') li.append(E('div', 'meta unklar-hinweis', `Unklar: ${e.unklar}`));

    if (e.transkript) {
      const d = E('details', 'transkript'); d.append(E('summary', null, 'Transkript'), E('p', null, e.transkript));
      d.open = offeneTranskripte.has(e.id); // bleibt beim Neuzeichnen aufgeklappt
      d.addEventListener('toggle', () => { if (d.open) offeneTranskripte.add(e.id); else offeneTranskripte.delete(e.id); });
      li.append(d);
    }

    const akt = E('div', 'karten-aktionen');
    if (e.transkript && !warten) akt.append(aktion('Neu zuordnen', () => neuZuordnen(e)));
    if (nichts || e.status === 'fehler') akt.append(aktion('Block von Hand', () => oeffneHandblock(e)));
    akt.append(aktion('Eintrag löschen', () => eintragLoeschen(e), 'knopf gefahr-text'));
    li.append(akt);
    return li;
  }

  /** Von Hand angelegter Block ohne Eintrag: eigene schmale Karte. */
  function renderHandblock(s) {
    const li = E('li', 'karte handblock');
    const kopf = E('div', 'kopf'); kopf.append(E('span', 'zeit', uhrzeit(s.ende)), E('span', 'badge', 'Von Hand'));
    li.append(kopf);
    const lis = E('div', 'segs'); lis.append(segmentZeile(s)); li.append(lis);
    return li;
  }

  async function aktualisiere() {
    const ticket = ++aktTicket;
    let eintraege = [], n = 0;
    try { eintraege = await db.listEintraege(); toepfe = await db.listToepfe(); segmente = await db.listSegmente(); n = await pipeline.wartendeAnzahl(); } catch (_) {}
    if (ticket !== aktTicket) return; // neuere Aktualisierung laeuft
    letzter = eintraege.length ? eintraege[eintraege.length - 1] : null;
    renderKopf();
    renderSicherung(eintraege);

    // wartende Eintraege
    el.pending.textContent = '';
    el.pending.hidden = n === 0;
    if (n > 0) {
      const warten = eintraege.filter((e) => e.status === 'wartet_transkription' || e.status === 'wartet_zuordnung');
      const t = document.createElement('div');
      t.textContent = n === 1 ? '1 Aufnahme wartet' : `${n} Aufnahmen warten`;
      el.pending.append(t);
      // Fehlertext nur hier, wenn er nicht schon im Hinweis (Key) oder im Status (letzter Lauf) steht
      const mitFehler = warten.find((e) => e.fehler);
      if (mitFehler && !pipeline.zustand().blockiert && !pipeFehlerSichtbar) { const g = document.createElement('div'); g.className = 'grund'; g.textContent = mitFehler.fehler; el.pending.append(g); }
      const b = document.createElement('button'); b.type = 'button';
      b.textContent = pipeBusy ? 'Sendet …' : 'Jetzt senden'; b.disabled = pipeBusy;
      b.addEventListener('click', () => pipeline.starte('Knopfdruck', { manuell: true }));
      el.pending.append(b);
    }

    // heutige Eintraege, neueste oben
    const jetzt = Date.now();
    const heute = eintraege.filter((e) => gleicherTag(e.zeit, jetzt)).reverse();
    el.results.textContent = '';
    for (const d of direktListe) {
      const li = document.createElement('li');
      const kopf = document.createElement('div'); kopf.className = 'kopf';
      const z = document.createElement('span'); z.className = 'zeit'; z.textContent = uhrzeit(d.zeit);
      const s = document.createElement('span'); s.className = 'badge'; s.textContent = 'Nicht gespeichert';
      kopf.append(z, s);
      const t = document.createElement('div'); t.className = 'text'; t.textContent = d.text || 'Nichts erkannt';
      li.append(kopf, t); el.results.append(li);
    }
    // Karten der Eintraege und von Hand angelegte Bloecke ohne Eintrag, neueste oben
    const hand = segmente.filter((s) => s.eintragId == null && gleicherTag(s.start, jetzt));
    const karten = [...heute.map((e) => ({ t: e.zeit, e })), ...hand.map((s) => ({ t: s.ende, s }))].sort((a, b) => b.t - a.t);
    for (const k of karten) el.results.append(k.e ? renderEintrag(k.e) : renderHandblock(k.s));
    el.leer.hidden = karten.length > 0 || direktListe.length > 0;
    renderHinweis();
    render();
  }

  // ------------------------------------------------------------ Aufnahme
  const recorder = createRecorder({
    zustand(z, info) {
      recState = z;
      clearInterval(tick); tick = null;
      if (z === 'startet') dauerHinweis = ''; // neue Aufnahme: alter Hinweis weg
      if (z === 'nimmt_auf') {
        startedAt = info.startedAt;
        tick = setInterval(() => { const s = el.rec.querySelector('#sek'); if (s) s.textContent = dauerText((performance.now() - startedAt) / 1000); }, 250);
        setOutcome('ready', 'Bereit', ''); // alte Meldungen weg; render() zeigt "Nimmt auf"
      } else render();
    },
    async fertig(erg) {
      // Bestaetigung sofort, noch vor dem Speichern
      flash = { text: 'Gesendet', bis: performance.now() + BESTAETIGUNG_MS };
      try { if (navigator.vibrate) navigator.vibrate(30); } catch (_) {}
      outcome = { kind: 'done', text: 'Gesendet', detail: '' };
      render();
      setTimeout(render, BESTAETIGUNG_MS + 50);
      const r = await pipeline.aufnahmeAbgeben(erg);
      if (!r.ok) {
        flash = null;
        setOutcome('error', 'Nicht gespeichert', `${r.fehler}. Wird direkt gesendet.`);
        r.direkt.then((text) => {
          direktListe.unshift({ text, zeit: erg.zeit });
          setOutcome('done', 'Fertig', 'Direkt gesendet, nicht gespeichert');
          aktualisiere();
        }).catch((err) => setOutcome('error', 'Fehler', `${maskiere(err && err.message)} – Aufnahme verloren (kein Speicher)`));
      }
      aktualisiere();
    },
    verworfen(info) {
      flash = null;
      if (info.grund === 'keine_daten') setOutcome('error', 'Keine Audiodaten erhalten', info.details);
      else setOutcome('error', info.grund === 'zu_kurz' ? 'Zu kurz' : 'Zu kurz – verworfen', info.details);
    },
    fehler(info) {
      flash = null;
      setOutcome('error', info.art === 'mikrofon_verweigert' ? 'Mikrofon nicht erlaubt' : 'Fehler', info.meldung);
    },
    // z. B. "Hoechstdauer von 5 min erreicht": steht ausserhalb des Status, damit es das Beenden der Aufnahme ueberlebt
    hinweis(text) { dauerHinweis = text; render(); },
  });

  pipeline.abonniere((ev) => {
    if (ev.typ === 'lauf_start') { pipeBusy = true; laufMitFehlerEintrag = false; render(); aktualisiere(); }
    else if (ev.typ === 'lauf_ende') {
      pipeBusy = false;
      pipeFehlerSichtbar = false;
      if (ev.fehler) {
        const f = ev.fehler;
        if (f.art === 'auth' || f.art === 'kein_key') setOutcome('error', 'Wartet', ''); // Meldung steht nur im Hinweis
        else { pipeFehlerSichtbar = true; setOutcome('error', 'Wartet', f.art === 'netz' ? `${f.meldung} – Aufnahme wartet und wird erneut gesendet` : f.meldung); }
      } else if (laufMitFehlerEintrag) setOutcome('error', 'Zuordnung fehlgeschlagen', 'Auf der Karte: „Neu zuordnen“ oder „Block von Hand“');
      else if (ev.verarbeitet > 0) setOutcome('done', 'Fertig', '');
      else render();
      aktualisiere();
    } else {
      if (ev.typ === 'eintrag' && ev.eintrag && ev.eintrag.status === 'fehler') laufMitFehlerEintrag = true;
      aktualisiere();
    }
  });

  el.hand.addEventListener('click', () => oeffneHandblock(null));

  // ------------------------------------------------------------ Eingabe-Handling (iOS-fest, aus dem Spike)
  const btn = el.rec;
  const losgelassen = () => { pointerDown = false; recorder.release(); render(); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    pointerDown = true; recorder.press();
  });
  btn.addEventListener('pointerup', (e) => { e.preventDefault(); losgelassen(); });
  btn.addEventListener('pointercancel', losgelassen);
  btn.addEventListener('lostpointercapture', losgelassen);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('selectstart', (e) => e.preventDefault());
  btn.addEventListener('dragstart', (e) => e.preventDefault());
  btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  btn.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  // Doppeltipp-Zoom unterbinden
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouchEnd < 350 && e.target === btn) e.preventDefault(); lastTouchEnd = n; }, { passive: false });
  // Seite selbst nicht scrollen lassen (nur .scroll-Bereiche scrollen)
  document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });

  setInterval(renderKopf, 30000);
  render();
  return { zeige: aktualisiere };
}
