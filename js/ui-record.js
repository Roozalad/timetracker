'use strict';
/* Ansicht Aufnahme: Kopfzeile, Button, Bestaetigung, wartende Eintraege, Liste der heutigen Eintraege.
   Ergebniskarte, Korrekturblatt und manueller Block ergaenzt Paket C (siehe renderEintrag). */
import { createRecorder } from './recorder.js?v=0.1.0';
import * as pipeline from './pipeline.js?v=0.1.0';
import * as db from './db.js?v=0.1.0';
import { log } from './log.js?v=0.1.0';
import { maskiere } from './key.js?v=0.1.0';
import { uhrzeit, vorZeitText, dauerText, gleicherTag } from './zeit.js?v=0.1.0';

const STATUS_TEXT = {
  wartet_transkription: 'Wartet auf Transkription',
  wartet_zuordnung: 'Transkript gespeichert',
  fertig: 'Fertig',
  fehler: 'Fehler',
};
const BESTAETIGUNG_MS = 1500;

/** ctx: { zeigeAnsicht(name), dbFehler: Error|null } */
export function initRecord(root, ctx) {
  const q = (s) => root.querySelector(s);
  const el = { last: q('#last'), status: q('#status'), detail: q('#detail'), hinweis: q('#hinweis'), rec: q('#rec'),
               pending: q('#pending'), results: q('#results'), leer: q('#leer') };

  let recState = 'bereit', startedAt = 0, tick = null, pointerDown = false;
  let outcome = { kind: 'ready', text: 'Bereit', detail: '' };
  let flash = null;               // kurze Bestaetigung "Gesendet": { text, bis }
  let pipeBusy = false;
  let letzter = null, toepfe = [];
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
      if (a && a.text) {
        const topf = toepfe.find((x) => x.id === a.topfId);
        t = `Läuft seit ${uhrzeit(letzter.zeit)}: ${topf ? `${topf.name} – ` : ''}${a.text}`;
      }
    }
    el.last.textContent = t;
  }

  // Paket C ersetzt diese Funktion durch die Ergebniskarte (Segmente, Ab jetzt, Stimmung, Korrektur).
  function renderEintrag(e) {
    const li = document.createElement('li');
    li.className = `st-${e.status}`;
    const kopf = document.createElement('div'); kopf.className = 'kopf';
    const z = document.createElement('span'); z.className = 'zeit'; z.textContent = uhrzeit(e.zeit);
    const s = document.createElement('span'); s.className = 'badge'; s.textContent = STATUS_TEXT[e.status] || e.status;
    kopf.append(z, s);
    const t = document.createElement('div'); t.className = 'text';
    if (e.transkript) t.textContent = e.transkript;
    else if (e.status === 'fertig') t.textContent = 'Nichts erkannt';
    else if (e.status === 'wartet_transkription') t.textContent = 'Aufnahme gespeichert, noch nicht transkribiert.';
    li.append(kopf, t);
    if (e.fehler && e.status !== 'fertig') {
      const m = document.createElement('div'); m.className = 'meta'; m.textContent = e.fehler; li.append(m);
    }
    return li;
  }

  async function aktualisiere() {
    const ticket = ++aktTicket;
    let eintraege = [], n = 0;
    try { eintraege = await db.listEintraege(); toepfe = await db.listToepfe(); n = await pipeline.wartendeAnzahl(); } catch (_) {}
    if (ticket !== aktTicket) return; // neuere Aktualisierung laeuft
    letzter = eintraege.length ? eintraege[eintraege.length - 1] : null;
    renderKopf();

    // wartende Eintraege
    el.pending.textContent = '';
    el.pending.hidden = n === 0;
    if (n > 0) {
      const warten = eintraege.filter((e) => e.status === 'wartet_transkription' || e.status === 'wartet_zuordnung');
      const t = document.createElement('div');
      t.textContent = n === 1 ? '1 Aufnahme wartet' : `${n} Aufnahmen warten`;
      el.pending.append(t);
      const mitFehler = warten.find((e) => e.fehler);
      if (mitFehler) { const g = document.createElement('div'); g.className = 'grund'; g.textContent = mitFehler.fehler; el.pending.append(g); }
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
    for (const e of heute) el.results.append(renderEintrag(e));
    el.leer.hidden = heute.length > 0 || direktListe.length > 0;
    renderHinweis();
    render();
  }

  // ------------------------------------------------------------ Aufnahme
  const recorder = createRecorder({
    zustand(z, info) {
      recState = z;
      clearInterval(tick); tick = null;
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
    hinweis(text) { outcome = { ...outcome, detail: text }; render(); },
  });

  pipeline.abonniere((ev) => {
    if (ev.typ === 'lauf_start') { pipeBusy = true; render(); aktualisiere(); }
    else if (ev.typ === 'lauf_ende') {
      pipeBusy = false;
      if (ev.fehler) {
        const f = ev.fehler;
        setOutcome('error', 'Wartet', f.art === 'netz' ? `${f.meldung} – Aufnahme wartet und wird erneut gesendet` : f.meldung);
      } else if (ev.verarbeitet > 0) setOutcome('done', 'Fertig', 'Transkript gespeichert');
      else render();
      aktualisiere();
    } else aktualisiere();
  });

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
