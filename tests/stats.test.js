'use strict';
import { test, gruppe, ok, eq, app } from './framework.js';

const st = await app('stats');
const { UNKLAR } = await app('segments');

// Lokale Zeitpunkte: unabhaengig von der Zeitzone des Rechners
const t = (tag, h = 0, m = 0, monat = 11, jahr = 2026) => new Date(jahr, monat - 1, tag, h, m, 0, 0).getTime();
const H = 3600000, MIN = 60000;
const seg = (id, topfId, start, ende) => ({ id, eintragId: null, topfId, unterId: null, start, ende, text: '', quelle: 'ki', zeitQuelle: 'genannt' });
const toepfe = () => [
  { id: 't1', name: 'Privat', farbe: '#4C9F70', bezahlt: null, unter: [], archiviert: false, reihenfolge: 1 },
  { id: 't2', name: 'Startup', farbe: '#3B82C4', bezahlt: true, unter: [], archiviert: false, reihenfolge: 2 },
  { id: 't3', name: 'Töpferstudio', farbe: '#D97B29', bezahlt: true, unter: [], archiviert: false, reihenfolge: 3 },
  { id: 't4', name: 'Wohnungsbauprojekte', farbe: '#8E5BB5', bezahlt: false, unter: [], archiviert: false, reihenfolge: 4 },
];

// Ein Tag des Jahres 2026 mit Sommerzeitwechsel suchen (Zeitzone des Rechners); ohne Wechsel entfallen diese Tests.
function wechselTage() {
  const r = { kurz: null, lang: null };
  for (let d = 1; d <= 366; d++) {
    const s = new Date(2026, 0, d, 4).getTime();
    const l = st.zeitraum('tag', s).ende - s;
    if (l === 23 * H && !r.kurz) r.kurz = s;
    if (l === 25 * H && !r.lang) r.lang = s;
  }
  return r;
}
const wechsel = wechselTage();

gruppe('Zeitraum Tag');
test('Tag: 04:00 bis 04:00 des Folgetags', () => {
  const z = st.zeitraum('tag', t(14, 10));
  eq([z.start, z.ende, z.tage], [t(14, 4), t(15, 4), [t(14, 4)]]);
});
test('Tag: 03:59 gehört noch zum Vortag', () => eq(st.zeitraum('tag', t(14, 3, 59)).start, t(13, 4)));
test('Tag: 04:00 beginnt den neuen Tag, 00:30 gehört zum alten', () => {
  eq(st.zeitraum('tag', t(14, 4)).start, t(14, 4));
  eq(st.zeitraum('tag', t(15, 0, 30)).start, t(14, 4));
});
test('Tag: Art unbekannt wirft', () => { let w = false; try { st.zeitraum('jahr', t(1, 5)); } catch (_) { w = true; } ok(w); });

gruppe('Zeitraum Woche');
test('Woche: Samstag 14.11.2026 gehört zu Mo 09.11. bis So 15.11.', () => {
  const z = st.zeitraum('woche', t(14, 10));
  eq([z.start, z.ende, z.tage.length], [t(9, 4), t(16, 4), 7]);
  eq(z.tage, [9, 10, 11, 12, 13, 14, 15].map((d) => t(d, 4)));
});
test('Woche: Montag 05:00 ist der Wochenanfang', () => eq(st.zeitraum('woche', t(9, 5)).start, t(9, 4)));
test('Woche: Montag 02:00 gehört noch zum Sonntag der Vorwoche', () => {
  const z = st.zeitraum('woche', t(16, 2));
  eq([z.start, z.ende], [t(9, 4), t(16, 4)]);
});
test('Woche: Sonntag 23:30 und Montag 03:59 sind dieselbe Woche', () => eq(st.zeitraum('woche', t(15, 23, 30)).start, st.zeitraum('woche', t(16, 3, 59)).start));
test('Woche über den Jahreswechsel', () => {
  const z = st.zeitraum('woche', t(1, 10, 0, 1, 2027)); // Freitag 01.01.2027
  eq([z.start, z.ende], [t(28, 4, 0, 12, 2026), t(4, 4, 0, 1, 2027)]);
});
test('Woche: Sonntag 04:00 bis Montag 04:00 ist noch dieselbe Woche (Sonntag)', () => eq(st.zeitraum('woche', t(15, 4)).start, t(9, 4)));

gruppe('Zeitraum Monat');
test('Monat: November 2026 hat 30 Tage', () => {
  const z = st.zeitraum('monat', t(14, 10));
  eq([z.start, z.ende, z.tage.length], [t(1, 4), t(1, 4, 0, 12), 30]);
});
test('Monat: 1. um 02:00 gehört noch zum Vormonat', () => {
  const z = st.zeitraum('monat', t(1, 2));
  eq([z.start, z.ende], [t(1, 4, 0, 10), t(1, 4, 0, 11)]);
});
test('Monat: Dezember endet am 1. Januar 04:00', () => eq(st.zeitraum('monat', t(24, 12, 0, 12)).ende, t(1, 4, 0, 1, 2027)));
test('Monat: Februar 2028 hat 29 Tage (Schaltjahr)', () => eq(st.zeitraum('monat', t(10, 12, 0, 2, 2028)).tage.length, 29));

gruppe('Blättern');
test('Tag vor und zurück über Monatsgrenze', () => {
  const z = st.zeitraum('tag', t(1, 10, 0, 12));
  eq(st.blaettern(z, -1).start, t(30, 4));
  eq(st.blaettern(st.blaettern(z, -1), 1).start, z.start);
});
test('Woche vor und zurück', () => {
  const z = st.zeitraum('woche', t(14, 10));
  eq([st.blaettern(z, 1).start, st.blaettern(z, -1).start], [t(16, 4), t(2, 4)]);
});
test('Monat vor und zurück über den Jahreswechsel', () => {
  const dez = st.zeitraum('monat', t(5, 10, 0, 12));
  eq(st.blaettern(dez, 1).start, t(1, 4, 0, 1, 2027));
  eq(st.blaettern(st.zeitraum('monat', t(5, 10, 0, 1, 2027)), -1).start, dez.start);
});
test('Monat: Vorwärts von Januar (31 Tage) landet im Februar, nicht im März', () => eq(st.blaettern(st.zeitraum('monat', t(31, 10, 0, 1)), 1).start, t(1, 4, 0, 2)));
test('Blättern behält Art', () => eq(st.blaettern(st.zeitraum('woche', t(14, 10)), 1).art, 'woche'));
test('enthaelt: halboffen', () => {
  const z = st.zeitraum('tag', t(14, 10));
  ok(st.enthaelt(z, t(14, 4)) && st.enthaelt(z, t(15, 3, 59)) && !st.enthaelt(z, t(15, 4)) && !st.enthaelt(z, t(14, 3, 59)));
});

gruppe('Zuschnitt');
test('Segment innerhalb bleibt unverändert', () => {
  const s = seg(1, 't2', t(14, 10), t(14, 11));
  eq(st.zuschneiden([s], t(14, 4), t(15, 4)), [s]);
});
test('Zuschnitt über die 04:00-Grenze teilt auf beide Tage', () => {
  const s = seg(1, 't2', t(15, 3), t(15, 5));
  const tag1 = st.zuschneiden([s], t(14, 4), t(15, 4)), tag2 = st.zuschneiden([s], t(15, 4), t(16, 4));
  eq([tag1[0].start, tag1[0].ende], [t(15, 3), t(15, 4)]);
  eq([tag2[0].start, tag2[0].ende], [t(15, 4), t(15, 5)]);
});
test('Zuschnitt über Mitternacht: beides gehört zum selben Tag', () => {
  const s = seg(1, 't1', t(14, 23), t(15, 1));
  const r = st.zuschneiden([s], t(14, 4), t(15, 4));
  eq(r[0].ende - r[0].start, 2 * H);
});
test('Zuschnitt über Wochen- und Monatsgrenze', () => {
  const s = seg(1, 't1', t(16, 3), t(16, 6)); // Montag 03:00 bis 06:00
  eq(st.zuschneiden([s], t(9, 4), t(16, 4))[0].ende - t(16, 3), H);
  eq(t(16, 6) - st.zuschneiden([s], t(16, 4), t(23, 4))[0].start, 2 * H);
  const m = seg(2, 't1', t(1, 2, 0, 12), t(1, 6, 0, 12)); // 01.12. 02:00-06:00: die Monatsgrenze 04:00 trennt
  const r1 = st.zuschneiden([m], t(1, 4), t(1, 4, 0, 12)), r2 = st.zuschneiden([m], t(1, 4, 0, 12), t(1, 4, 0, 1, 2027));
  eq([r1[0].ende - r1[0].start, r2[0].ende - r2[0].start], [2 * H, 2 * H]);
});
test('Segment, das genau am Rand endet oder beginnt, entfällt', () => {
  eq(st.zuschneiden([seg(1, 't1', t(14, 3), t(14, 4))], t(14, 4), t(15, 4)), []);
  eq(st.zuschneiden([seg(1, 't1', t(15, 4), t(15, 5))], t(14, 4), t(15, 4)), []);
});
test('Zuschnitt verändert die Eingabe nicht und behält id und Felder', () => {
  const s = seg(7, 't3', t(14, 3), t(14, 6));
  const r = st.zuschneiden([s], t(14, 4), t(15, 4));
  eq([s.start, r[0].id, r[0].topfId, r[0].quelle], [t(14, 3), 7, 't3', 'ki']);
});

gruppe('Summen');
test('Summen je Topf, Anteile, Bezahlt, Unbezahlt, Gesamt', () => {
  const segs = [
    seg(1, 't2', t(14, 9), t(14, 11)),       // Startup 2 h (bezahlt)
    seg(2, 't3', t(14, 11), t(14, 12)),      // Studio 1 h (bezahlt)
    seg(3, 't4', t(14, 13), t(14, 14, 30)),  // Wohnungsbau 1,5 h (unbezahlt)
    seg(4, 't1', t(14, 15), t(14, 16)),      // Privat 1 h (null)
  ];
  const r = st.auswerten(segs, toepfe(), st.zeitraum('tag', t(14, 10)));
  eq(r.zeilen.map((z) => [z.topfId, z.ms / MIN]), [['t1', 60], ['t2', 120], ['t3', 60], ['t4', 90]]);
  eq([r.gesamt, r.bezahlt, r.unbezahlt], [330 * MIN, 180 * MIN, 90 * MIN]);
  ok(Math.abs(r.zeilen.reduce((a, z) => a + z.anteil, 0) - 1) < 1e-9);
  ok(Math.abs(r.zeilen.find((z) => z.topfId === 't2').anteil - 120 / 330) < 1e-9);
});
test('Privat (bezahlt null) zählt weder zu Bezahlt noch zu Unbezahlt, aber zu Gesamt', () => {
  const r = st.auswerten([seg(1, 't1', t(14, 9), t(14, 10))], toepfe(), st.zeitraum('tag', t(14, 10)));
  eq([r.gesamt, r.bezahlt, r.unbezahlt], [H, 0, 0]);
});
test('Zeilen nach reihenfolge, nur Töpfe mit Zeit', () => {
  const r = st.auswerten([seg(1, 't4', t(14, 9), t(14, 10)), seg(2, 't2', t(14, 10), t(14, 11))], toepfe(), st.zeitraum('tag', t(14, 10)));
  eq(r.zeilen.map((z) => z.topfId), ['t2', 't4']);
});
test('unklar ist ein eigener Anteil, zuletzt, grau, und zählt zu Gesamt', () => {
  const r = st.auswerten([seg(1, UNKLAR, t(14, 9), t(14, 10)), seg(2, 't2', t(14, 10), t(14, 13))], toepfe(), st.zeitraum('tag', t(14, 10)));
  eq(r.zeilen.map((z) => z.topfId), ['t2', UNKLAR]);
  const u = r.zeilen[1];
  eq([u.name, u.farbe, u.bezahlt, u.ms, u.anteil], ['Unklar', '#B0B0B0', null, H, 0.25]);
  eq([r.gesamt, r.bezahlt, r.unbezahlt], [4 * H, 3 * H, 0]);
});
test('unbekannte topfId zählt als unklar', () => {
  const r = st.auswerten([seg(1, 'tX', t(14, 9), t(14, 10))], toepfe(), st.zeitraum('tag', t(14, 10)));
  eq(r.zeilen.map((z) => z.topfId), [UNKLAR]);
});
test('archivierter Topf erscheint mit seinen alten Daten und Zeit', () => {
  const tp = toepfe(); tp[1].archiviert = true;
  const r = st.auswerten([seg(1, 't2', t(14, 9), t(14, 10))], tp, st.zeitraum('tag', t(14, 10)));
  eq([r.zeilen[0].topfId, r.zeilen[0].archiviert, r.zeilen[0].name, r.zeilen[0].farbe, r.bezahlt], ['t2', true, 'Startup', '#3B82C4', H]);
});
test('archivierter Topf ohne Zeit erscheint nicht', () => {
  const tp = toepfe(); tp[1].archiviert = true;
  eq(st.auswerten([], tp, st.zeitraum('tag', t(14, 10))).zeilen, []);
});
test('Segment über die Tagesgrenze zählt in jedem Tag nur den eigenen Teil', () => {
  const s = [seg(1, 't2', t(15, 3), t(15, 6))];
  eq(st.auswerten(s, toepfe(), st.zeitraum('tag', t(14, 10))).gesamt, H);
  eq(st.auswerten(s, toepfe(), st.zeitraum('tag', t(15, 10))).gesamt, 2 * H);
});
test('Segmente anderer Tage bleiben außen vor', () => {
  const s = [seg(1, 't2', t(13, 9), t(13, 10)), seg(2, 't2', t(15, 9), t(15, 10))];
  ok(st.auswerten(s, toepfe(), st.zeitraum('tag', t(14, 10))).leer);
});
test('Woche und Monat: Summe der Tage ergibt die Summe des Zeitraums', () => {
  const s = [seg(1, 't2', t(9, 3), t(9, 6)), seg(2, 't3', t(11, 9), t(11, 12)), seg(3, 't1', t(15, 23), t(16, 3, 30)), seg(4, 't4', t(30, 10), t(30, 11))];
  const w = st.zeitraum('woche', t(12, 10));
  const proTag = w.tage.map((d) => st.auswerten(s, toepfe(), st.zeitraum('tag', d)).gesamt).reduce((a, b) => a + b, 0);
  eq(st.auswerten(s, toepfe(), w).gesamt, proTag);
  // Mo 03:00-04:00 gehört zur Vorwoche; 03:00-06:00 am Mo 09.11. gehört: 1 h Vorwoche, 2 h diese Woche
  eq(st.auswerten(s, toepfe(), w).zeilen.find((z) => z.topfId === 't2').ms, 2 * H);
  const m = st.zeitraum('monat', t(12, 10));
  eq(st.auswerten(s, toepfe(), m).gesamt, 3 * H + 3 * H + (t(16, 3, 30) - t(15, 23)) + H);
});
test('Leerer Zeitraum: nichts erfasst, keine Zeilen, Nicht erfasst = ganzer Zeitraum', () => {
  const r = st.auswerten([], toepfe(), st.zeitraum('tag', t(14, 10)));
  eq([r.leer, r.zeilen, r.gesamt, r.bezahlt, r.unbezahlt, r.nichtErfasst], [true, [], 0, 0, 0, 24 * H]);
});

gruppe('Nicht erfasst');
test('vergangener Zeitraum: Dauer minus erfasst', () => {
  const r = st.auswerten([seg(1, 't2', t(14, 9), t(14, 11))], toepfe(), st.zeitraum('tag', t(14, 10)));
  eq([r.dauer, r.nichtErfasst], [24 * H, 22 * H]);
});
test('laufender Tag: nur die Zeit bis jetzt zählt', () => {
  const r = st.auswerten([seg(1, 't2', t(14, 9), t(14, 11))], toepfe(), st.zeitraum('tag', t(14, 12)), t(14, 12));
  eq([r.dauer, r.nichtErfasst], [8 * H, 6 * H]);
});
test('jetzt vor dem Zeitraum: 0; nach dem Zeitraum: ganzer Zeitraum', () => {
  const z = st.zeitraum('tag', t(14, 10));
  eq(st.auswerten([], toepfe(), z, t(13, 12)).nichtErfasst, 0);
  eq(st.auswerten([], toepfe(), z, t(20, 12)).nichtErfasst, 24 * H);
});
test('Nicht erfasst wird nie negativ', () => {
  eq(st.auswerten([seg(1, 't2', t(14, 4), t(14, 12))], toepfe(), st.zeitraum('tag', t(14, 10)), t(14, 6)).nichtErfasst, 0);
});

gruppe('Sommerzeit');
test('Wechseltag mit 23 Stunden: Dauer und volle Abdeckung', () => {
  if (!wechsel.kurz) return; // Zeitzone ohne Sommerzeit
  const z = st.zeitraum('tag', wechsel.kurz + H);
  eq(z.ende - z.start, 23 * H);
  const r = st.auswerten([seg(1, 't2', z.start, z.ende)], toepfe(), z);
  eq([r.gesamt, r.nichtErfasst, r.dauer], [23 * H, 0, 23 * H]);
});
test('Wechseltag mit 25 Stunden: Dauer und volle Abdeckung', () => {
  if (!wechsel.lang) return;
  const z = st.zeitraum('tag', wechsel.lang + H);
  eq(z.ende - z.start, 25 * H);
  const r = st.auswerten([seg(1, 't2', z.start, z.ende)], toepfe(), z);
  eq([r.gesamt, r.nichtErfasst], [25 * H, 0]);
});
test('Skala 7 bis 23 Uhr bleibt 16 Stunden, auch am Wechseltag', () => {
  for (const s of [wechsel.kurz, wechsel.lang].filter(Boolean)) {
    const k = st.skala(s);
    eq(k.bis - k.von, 16 * H);
  }
});
test('Woche und Monat mit Wechseltag haben ihre echte Länge, Tage bleiben je 04:00', () => {
  for (const s of [wechsel.kurz, wechsel.lang].filter(Boolean)) {
    const w = st.zeitraum('woche', s + H), m = st.zeitraum('monat', s + H);
    eq(w.tage.length, 7);
    ok(w.tage.every((d) => new Date(d).getHours() === 4), 'Tage beginnen um 04:00');
    ok(m.tage.every((d) => new Date(d).getHours() === 4));
    eq(w.ende - w.start, 7 * 24 * H + (s === wechsel.kurz ? -H : H));
    const volle = st.auswerten([seg(1, 't2', m.start, m.ende)], toepfe(), m);
    eq([volle.gesamt, volle.nichtErfasst], [m.ende - m.start, 0]);
  }
});
test('Blättern über den Wechseltag trifft den Tagesbeginn 04:00', () => {
  for (const s of [wechsel.kurz, wechsel.lang].filter(Boolean)) {
    const z = st.zeitraum('tag', s);
    eq(st.blaettern(z, 1).start, z.ende);
    eq(st.blaettern(st.blaettern(z, 1), -1).start, z.start);
    eq(st.blaettern(st.zeitraum('woche', s), 1).start, st.zeitraum('woche', s).ende);
  }
});

gruppe('Tagesspalte');
test('skala: 07:00 bis 23:00 am Kalendertag des Tages', () => {
  const k = st.skala(t(14, 4));
  eq([k.von, k.bis], [t(14, 7), t(14, 23)]);
});
test('ausserhalb: vor 07:00 und nach 23:00, auch nach Mitternacht', () => {
  const sk = st.skala(t(14, 4));
  const segs = [seg(1, 't1', t(14, 5), t(14, 8)), seg(2, 't1', t(14, 22), t(15, 1)), seg(3, 't2', t(14, 10), t(14, 11))];
  eq(st.ausserhalb(segs, t(14, 4), t(15, 4), sk), { davor: 2 * H, danach: 2 * H, anzahl: 2 });
});
test('ausserhalb: Segment ganz in der Spalte zählt nicht', () => {
  eq(st.ausserhalb([seg(1, 't1', t(14, 7), t(14, 23))], t(14, 4), t(15, 4), st.skala(t(14, 4))), { davor: 0, danach: 0, anzahl: 0 });
});
test('ausserhalb: Segment aus anderem Tag zählt nicht, Segment über Tagesgrenze nur mit seinem Teil', () => {
  const sk = st.skala(t(14, 4));
  const segs = [seg(1, 't1', t(15, 3), t(15, 6)), seg(2, 't1', t(13, 22), t(13, 23))];
  eq(st.ausserhalb(segs, t(14, 4), t(15, 4), sk), { davor: 0, danach: H, anzahl: 1 });
});

gruppe('Texte');
test('stundenText', () => {
  eq(st.stundenText(0), '0:00');
  eq(st.stundenText(80 * MIN), '1:20');
  eq(st.stundenText(25 * H + 5 * MIN), '25:05');
  eq(st.stundenText(59 * MIN + 40000), '1:00');
});
test('prozentText', () => {
  eq(st.prozentText(1 / 3), '33,3 %');
  eq(st.prozentText(0.5), '50,0 %');
  eq(st.prozentText(1), '100,0 %');
  eq(st.prozentText(0), '0,0 %');
});
test('titel Tag, Woche, Monat', () => {
  eq(st.titel(st.zeitraum('tag', t(14, 10))), 'Samstag, 14.11.2026');
  eq(st.titel(st.zeitraum('woche', t(14, 10))), 'KW 46 · 09.11.–15.11.2026');
  eq(st.titel(st.zeitraum('monat', t(14, 10))), 'November 2026');
});
test('titel Woche über den Jahreswechsel: KW 53 / KW 1 und beide Jahre', () => {
  eq(st.titel(st.zeitraum('woche', t(30, 10, 0, 12))), 'KW 53 · 28.12.2026–03.01.2027');
  eq(st.titel(st.zeitraum('woche', t(5, 10, 0, 1, 2027))), 'KW 1 · 04.01.–10.01.2027');
});
test('wochentagKurz', () => eq(st.wochentagKurz(t(9, 4)), 'Mo'));
