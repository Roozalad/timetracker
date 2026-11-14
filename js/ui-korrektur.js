'use strict';
/* Korrekturblatt (8.1): ein Blatt von unten fuer einen Block. Auch fuer "Block von Hand" (leerer Block, Vorgabe aus dem
   Aufrufer) und von der Auswertung (Paket D) nutzbar. Ausserdem eine kleine Rueckfrage.
     zeigeKorrektur({ toepfe, segment | null, vorgabe: {start, ende}, onSpeichern(aenderung), onLoeschen() })
       segment gesetzt: ein Tipp auf einen Topf wechselt ihn, uebernimmt Zeiten und Unterpunkt und schliesst das Blatt.
       segment null (neuer Block): Topf waehlen, Zeiten einstellen, "Speichern".
       aenderung = { topfId, unterId, start, ende }. onSpeichern/onLoeschen duerfen werfen: die Meldung erscheint im Blatt.
     frage({ titel, text, ja, nein }) -> Promise<boolean> */
import { uhrzeit, tagesBeginn, tagesEnde } from './zeit.js?v=0.3.0';
import { UNKLAR, UNKLAR_FARBE, MIN_MS } from './segments.js?v=0.3.0';

const SCHRITT = 5 * MIN_MS;

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

function blatt(titel, schliesse) {
  const hintergrund = el('div', 'blatt-hintergrund');
  const b = el('div', 'blatt'); b.setAttribute('role', 'dialog'); b.setAttribute('aria-modal', 'true'); b.setAttribute('aria-label', titel);
  const inhalt = el('div', 'blatt-inhalt scroll');
  b.append(el('div', 'blatt-griff'), el('h2', 'blatt-titel', titel), inhalt);
  hintergrund.append(b);
  hintergrund.addEventListener('click', (e) => { if (e.target === hintergrund) schliesse(); });
  const taste = (e) => { if (e.key === 'Escape') schliesse(); };
  document.addEventListener('keydown', taste);
  document.body.append(hintergrund);
  return { inhalt, entfernen() { document.removeEventListener('keydown', taste); hintergrund.remove(); } };
}

export function zeigeKorrektur({ toepfe, segment = null, vorgabe, onSpeichern, onLoeschen }) {
  const neu = !segment;
  const st = segment
    ? { topfId: segment.topfId, unterId: segment.unterId, start: segment.start, ende: segment.ende }
    : { topfId: null, unterId: null, start: vorgabe.start, ende: vorgabe.ende };
  const grenzeUnten = tagesBeginn(st.start), grenzeOben = Math.min(tagesEnde(st.start), Math.max(st.ende, Date.now()));
  let loeschenBestaetigen = false, arbeitet = false;

  const b = blatt(neu ? 'Block von Hand' : 'Block korrigieren', schliessen);
  function schliessen() { b.entfernen(); }
  const root = b.inhalt;
  const meldung = el('div', 'blatt-meldung'); meldung.hidden = true;

  const aktive = toepfe.filter((t) => !t.archiviert || t.id === st.topfId);
  const kacheln = el('div', 'kacheln');
  const unterZeile = el('div', 'chips');
  const zeiten = el('div', 'zeiten');
  const aktionen = el('div', 'blatt-aktionen');
  root.append(kacheln, unterZeile, zeiten, meldung, aktionen);

  async function ausfuehren(fn) {
    if (arbeitet) return;
    arbeitet = true; meldung.hidden = true;
    try { await fn(); schliessen(); }
    catch (e) { arbeitet = false; meldung.hidden = false; meldung.textContent = (e && e.message) || 'Das hat nicht geklappt.'; }
  }
  const speichern = () => ausfuehren(() => onSpeichern({ topfId: st.topfId, unterId: st.unterId, start: st.start, ende: st.ende }));

  function kachel(id, name, farbe, dunkel) {
    const k = knopf(name, 'kachel', () => {
      if (!neu) {
        if (id !== st.topfId) st.unterId = null;
        st.topfId = id; speichern();
      } else {
        if (id !== st.topfId) st.unterId = null;
        st.topfId = id; zeichne();
      }
    });
    k.style.background = farbe; if (dunkel) k.style.color = '#111';
    k.dataset.topf = id;
    k.setAttribute('aria-pressed', String(id === st.topfId));
    if (id === st.topfId) k.classList.add('gewaehlt');
    return k;
  }

  function schrittKnopf(text, ok, aendere) {
    const k = knopf(text, 'schritt', () => { aendere(); zeichne(); });
    k.disabled = !ok;
    return k;
  }
  function zeitZeile(titel, wert, minus, plus) {
    const z = el('div', 'zeit-zeile');
    z.append(el('span', 'zeit-titel', titel), minus, el('span', 'zeit-wert', uhrzeit(wert)), plus);
    return z;
  }

  function zeichne() {
    kacheln.textContent = '';
    for (const t of aktive) kacheln.append(kachel(t.id, t.name, t.farbe, false));
    kacheln.append(kachel(UNKLAR, 'Unklar', UNKLAR_FARBE, true));

    unterZeile.textContent = '';
    const topf = aktive.find((t) => t.id === st.topfId);
    // Archivierte Unterpunkte nur zeigen, wenn dieser Block sie schon traegt
    const unter = topf && topf.unter ? topf.unter.filter((u) => !u.archiviert || u.id === st.unterId) : [];
    unterZeile.hidden = !unter.length;
    if (!unterZeile.hidden) {
      unterZeile.append(el('div', 'chips-titel', 'Unterpunkt'));
      for (const u of unter) {
        const c = knopf(u.name, 'chip', () => { st.unterId = st.unterId === u.id ? null : u.id; zeichne(); });
        c.setAttribute('aria-pressed', String(st.unterId === u.id));
        if (st.unterId === u.id) c.classList.add('gewaehlt');
        unterZeile.append(c);
      }
    }

    zeiten.textContent = '';
    zeiten.append(
      zeitZeile('Start', st.start,
        schrittKnopf('−5', st.start - SCHRITT >= grenzeUnten, () => { st.start -= SCHRITT; }),
        schrittKnopf('+5', st.start + SCHRITT <= st.ende - MIN_MS, () => { st.start += SCHRITT; })),
      zeitZeile('Ende', st.ende,
        schrittKnopf('−5', st.ende - SCHRITT >= st.start + MIN_MS, () => { st.ende -= SCHRITT; }),
        schrittKnopf('+5', st.ende + SCHRITT <= grenzeOben, () => { st.ende += SCHRITT; })),
    );
    const dauer = Math.round((st.ende - st.start) / MIN_MS);
    zeiten.append(el('div', 'zeit-dauer', dauer >= 60 ? `${Math.floor(dauer / 60)} h ${dauer % 60} min` : `${dauer} min`));

    aktionen.textContent = '';
    if (!neu) {
      aktionen.append(knopf(loeschenBestaetigen ? 'Wirklich löschen?' : 'Löschen', loeschenBestaetigen ? 'knopf gefahr bestaetigt' : 'knopf gefahr', () => {
        if (!loeschenBestaetigen) { loeschenBestaetigen = true; zeichne(); return; }
        ausfuehren(() => onLoeschen());
      }));
    }
    aktionen.append(knopf('Abbrechen', 'knopf', schliessen));
    const ok = knopf(neu ? 'Speichern' : 'Übernehmen', 'knopf primaer', speichern);
    ok.disabled = neu && !st.topfId;
    aktionen.append(ok);
  }
  zeichne();
  return { schliessen };
}

/** Kleine Rueckfrage als Blatt. Schliessen ohne Antwort zaehlt als Nein. */
export function frage({ titel, text, ja = 'Ja', nein = 'Abbrechen', gefahr = false }) {
  return new Promise((resolve) => {
    let fertig = false;
    const ende = (antwort) => { if (fertig) return; fertig = true; b.entfernen(); resolve(antwort); };
    const b = blatt(titel, () => ende(false));
    b.inhalt.append(el('p', 'blatt-text', text));
    const a = el('div', 'blatt-aktionen');
    a.append(knopf(nein, 'knopf', () => ende(false)), knopf(ja, gefahr ? 'knopf gefahr bestaetigt' : 'knopf primaer', () => ende(true)));
    b.inhalt.append(a);
  });
}
