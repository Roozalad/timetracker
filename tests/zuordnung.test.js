'use strict';
/* Selbsttest der Auswertung: Jede Beispielantwort besteht ihren Fall; gezielt verfaelschte Antworten fallen
   durch; Verschiebungen innerhalb der Toleranz und eine andere Aufteilung geschaetzter Zeiten bestehen. */
import { test, gruppe, ok, eq } from './framework.js';
import { FAELLE } from './zuordnung-faelle.js?v=0.4.2';
import { pruefeFall, relativ, hhmm, zeitText } from './zuordnung-auswertung.js?v=0.4.2';
import { falscheAntwort } from './zuordnung-attrappe.js?v=0.4.2';

const kopie = (o) => JSON.parse(JSON.stringify(o));
const besteht = (f, a, was) => { const r = pruefeFall(f, a); ok(r.ok, `${f.id} ${was}: sollte bestehen, Abweichungen: ${r.abweichungen.join('; ')}`); };
const faellt = (f, a, was) => { const r = pruefeFall(f, a); ok(!r.ok, `${f.id} ${was}: sollte durchfallen, tut es aber nicht`); return r; };
const plus = (s, min, jetzt) => zeitText(relativ(s, hhmm(jetzt)) + min);

gruppe('Zuordnung: Testfälle');

test('mindestens 25 Fälle, eindeutige IDs, Transkripte verschieden', () => {
  ok(FAELLE.length >= 25, `nur ${FAELLE.length} Fälle`);
  eq(new Set(FAELLE.map((f) => f.id)).size, FAELLE.length, 'IDs eindeutig');
  eq(new Set(FAELLE.map((f) => f.eingabe.transkript)).size, FAELLE.length, 'Transkripte eindeutig (Attrappe erkennt Fälle daran)');
});

test('Spezifikationsfälle 1 bis 12 sind enthalten', () => {
  for (let i = 1; i <= 12; i++) ok(FAELLE.some((f) => f.id === `F${String(i).padStart(2, '0')}`), `F${i} fehlt`);
});

test('jede Beispielantwort besteht ihren Fall', () => { for (const f of FAELLE) besteht(f, f.beispiel, 'Beispiel'); });

test('Attrappe: falsche Antwort fällt bei jedem Fall durch', () => { for (const f of FAELLE) faellt(f, falscheAntwort(f), 'falscheAntwort'); });

gruppe('Zuordnung: verfälschte Antworten werden erkannt');

test('falscher Topf', () => {
  for (const f of FAELLE) {
    const s = f.soll.taetigkeiten; if (!s || !s.length || f.soll.reihenfolgeEgal) continue;
    const a = kopie(f.beispiel);
    const erlaubt = [].concat(s[0].topf);
    a.taetigkeiten[0].topf_id = ['t1', 't2', 't3', 't4', 'unklar'].find((t) => !erlaubt.includes(t));
    a.taetigkeiten[0].unter_id = null;
    a.unklar = a.unklar || 'x';
    faellt(f, a, 'falscher Topf');
  }
});

test('Tätigkeit fehlt / Tätigkeit zu viel', () => {
  for (const f of FAELLE) {
    if (!f.soll.taetigkeiten) continue;
    if (f.beispiel.taetigkeiten.length) { const a = kopie(f.beispiel); a.taetigkeiten.pop(); faellt(f, a, 'eine weniger'); }
    const b = kopie(f.beispiel);
    const j = f.eingabe.jetzt.slice(-5);
    b.taetigkeiten = b.taetigkeiten.filter((t) => relativ(t.ende, hhmm(j)) <= relativ(j, hhmm(j)) - 2);
    if (b.taetigkeiten.length !== f.beispiel.taetigkeiten.length) continue;
    b.taetigkeiten.push({ topf_id: 't2', unter_id: null, text: 'zusätzlich', start: plus(j, -1, j), ende: j, zeit_quelle: 'genannt' });
    faellt(f, b, 'eine mehr');
  }
});

test('genannte Grenze 15 Minuten daneben fällt durch, 3 Minuten bestehen', () => {
  let geprueft = 0;
  for (const f of FAELLE) {
    const s = f.soll.taetigkeiten; if (!s || f.soll.reihenfolgeEgal) continue;
    s.forEach((x, i) => {
      if (!x.start) return;
      const t = f.beispiel.taetigkeiten[i];
      const dauer = relativ(t.ende, hhmm(f.eingabe.jetzt)) - relativ(t.start, hhmm(f.eingabe.jetzt));
      if (dauer <= 20) return;
      const vorher = f.beispiel.taetigkeiten[i - 1];
      // Start nach hinten verschieben (bleibt im Fenster, erzeugt keine Ueberlappung)
      const a = kopie(f.beispiel); a.taetigkeiten[i].start = plus(t.start, 15, f.eingabe.jetzt);
      if (vorher && vorher.ende === t.start) a.taetigkeiten[i - 1].ende = a.taetigkeiten[i].start;
      faellt(f, a, `T${i + 1}.start +15`);
      const b = kopie(f.beispiel); b.taetigkeiten[i].start = plus(t.start, 3, f.eingabe.jetzt);
      if (vorher && vorher.ende === t.start) b.taetigkeiten[i - 1].ende = b.taetigkeiten[i].start;
      besteht(f, b, `T${i + 1}.start +3`);
      geprueft++;
    });
  }
  ok(geprueft >= 20, `nur ${geprueft} Grenzen geprüft`);
});

test('andere Aufteilung geschätzter Zeiten besteht, Spanne daneben fällt durch', () => {
  let geprueft = 0;
  for (const f of FAELLE) {
    const s = f.soll.taetigkeiten; if (!s || !f.soll.spanne || f.soll.reihenfolgeEgal) continue;
    const jm = hhmm(f.eingabe.jetzt);
    for (let i = 0; i + 1 < s.length; i++) {
      if (s[i].ende || s[i + 1].start || s[i].dauer || s[i + 1].dauer) continue;
      const a = kopie(f.beispiel);
      const t = a.taetigkeiten[i], n = a.taetigkeiten[i + 1];
      if (t.ende !== n.start) continue;
      const neu = relativ(t.start, jm) + Math.round((relativ(n.ende, jm) - relativ(t.start, jm)) / 4);
      t.ende = n.start = zeitText(neu);
      besteht(f, a, `Grenze T${i + 1}/T${i + 2} verschoben`);
      geprueft++;
    }
    const b = kopie(f.beispiel);
    b.taetigkeiten[0].start = plus(b.taetigkeiten[0].start, 15, f.eingabe.jetzt);
    faellt(f, b, 'Spanne beginnt 15 min später');
  }
  ok(geprueft >= 5, `nur ${geprueft} Aufteilungen geprüft`);
});

test('Reihenfolge vertauscht fällt durch', () => {
  let geprueft = 0;
  for (const f of FAELLE) {
    const s = f.soll.taetigkeiten; if (!s || s.length < 2 || f.soll.reihenfolgeEgal) continue;
    const a = kopie(f.beispiel);
    const [x, y] = a.taetigkeiten;
    if (x.topf_id === y.topf_id && x.unter_id === y.unter_id) continue;
    const ohneZeit = ({ topf, unter }) => JSON.stringify({ topf, unter });
    if (ohneZeit(s[0]) === ohneZeit(s[1])) continue;   // z. B. F10: beide Bloecke erlauben dieselben Unterpunkte
    [x.topf_id, y.topf_id] = [y.topf_id, x.topf_id]; [x.unter_id, y.unter_id] = [y.unter_id, x.unter_id];
    faellt(f, a, 'vertauscht'); geprueft++;
  }
  ok(geprueft >= 8, `nur ${geprueft} geprüft`);
});

test('ab_jetzt, stimmung, unklar, zeit_quelle falsch', () => {
  for (const f of FAELLE) {
    const s = f.soll;
    if (s.abJetzt === null) { const a = kopie(f.beispiel); a.ab_jetzt = { topf_id: 't2', unter_id: null, text: 'Etwas' }; faellt(f, a, 'ab_jetzt gesetzt'); }
    if (s.abJetzt) {
      const a = kopie(f.beispiel); a.ab_jetzt = null; faellt(f, a, 'ab_jetzt fehlt');
      const b = kopie(f.beispiel); b.ab_jetzt.topf_id = [].concat(s.abJetzt.topf).includes('t2') ? 't3' : 't2'; b.ab_jetzt.unter_id = null; faellt(f, b, 'ab_jetzt falscher Topf');
    }
    if (s.stimmung === null) { const a = kopie(f.beispiel); a.stimmung = { wert: 1, stichwort: 'gut' }; faellt(f, a, 'Stimmung erfunden'); }
    if (s.stimmung) {
      const a = kopie(f.beispiel); a.stimmung = null; faellt(f, a, 'Stimmung fehlt');
      const b = kopie(f.beispiel); b.stimmung.wert = -b.stimmung.wert; faellt(f, b, 'Stimmung Vorzeichen');
      const c = kopie(f.beispiel); c.stimmung.stichwort = 'neutral'; faellt(f, c, 'Stichwort fremd');
    }
    if (s.unklar === true) { const a = kopie(f.beispiel); a.unklar = null; faellt(f, a, 'unklar fehlt'); }
    if (s.unklar === false) { const a = kopie(f.beispiel); a.unklar = 'Bin nicht sicher.'; faellt(f, a, 'unklar überflüssig'); }
    (s.taetigkeiten || []).forEach((x, i) => {
      if (!x.quelle || s.reihenfolgeEgal) return;
      const a = kopie(f.beispiel); a.taetigkeiten[i].zeit_quelle = x.quelle === 'genannt' ? 'geschaetzt' : 'genannt';
      faellt(f, a, `T${i + 1} zeit_quelle`);
    });
  }
});

gruppe('Zuordnung: allgemeine Regeln');

const F = (id) => FAELLE.find((f) => f.id === id);
test('ende nach jetzt, start nach ende, Überlappung', () => {
  const f = F('F02');
  const a = kopie(f.beispiel); a.taetigkeiten[1].ende = '11:10'; faellt(f, a, 'ende nach jetzt');
  const b = kopie(f.beispiel); b.taetigkeiten[0].start = '10:40'; faellt(f, b, 'start nach ende');
  const c = kopie(f.beispiel); c.taetigkeiten[1].start = '10:20'; faellt(f, c, 'Überlappung');
});
test('mehr als sechs Wörter, Unterpunkt eines fremden Topfs, unklar ohne Text', () => {
  const f = F('F03');
  const a = kopie(f.beispiel); a.taetigkeiten[0].text = 'Mittag gegessen mit Kollegen in der Kantine'; const r = faellt(f, a, '7 Wörter');
  ok(r.abweichungen.some((x) => x.includes('Wörter')), 'Wortzahl als Ursache genannt');
  const b = kopie(f.beispiel); b.taetigkeiten[1].unter_id = 'u2'; faellt(f, b, 'fremder Unterpunkt');
  const g = F('F12'); const c = kopie(g.beispiel); c.unklar = null; faellt(g, c, 'unklar fehlt');
});
test('geschätzt ohne Fenster fällt durch, über Mitternacht wird richtig gerechnet', () => {
  const f = F('F04');
  const a = kopie(f.beispiel); a.taetigkeiten[1].zeit_quelle = 'geschaetzt'; faellt(f, a, 'geschätzt ohne Fenster');
  const m = F('F19');
  const b = kopie(m.beispiel); [b.taetigkeiten[0].start, b.taetigkeiten[0].ende] = ['01:30', '23:00']; faellt(m, b, 'vertauscht über Mitternacht');
  eq(relativ('23:00', hhmm('01:30')), -60, 'relativ 23:00 bei jetzt 01:30');
});
test('Abweichung nennt Soll, Ist und Differenz', () => {
  const f = F('F08');
  const a = kopie(f.beispiel); a.taetigkeiten[0].start = '16:00';
  const r = pruefeFall(f, a);
  ok(r.abweichungen.some((x) => x.includes('soll 16:30') && x.includes('ist 16:00') && x.includes('-30 min')), r.abweichungen.join('; '));
});
test('Reihenfolge egal (F07): beide Reihenfolgen bestehen, falsche Dauer nicht', () => {
  const f = F('F07');
  const a = kopie(f.beispiel);
  a.taetigkeiten = [
    { ...a.taetigkeiten[1], start: '14:00', ende: '14:40' },
    { ...a.taetigkeiten[0], start: '14:40', ende: '15:00' }];
  besteht(f, a, 'Angebot zuerst');
  const b = kopie(f.beispiel); b.taetigkeiten[0].ende = '14:30'; b.taetigkeiten[1].start = '14:30'; faellt(f, b, 'Instagram 30 min');
});
