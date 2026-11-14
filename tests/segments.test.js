'use strict';
/* segments.js: Pruefung der Modellantwort (7.3) und Einfuegen ohne Ueberlappung (7.4). Reine Logik, keine Datenbank. */
import { test, gruppe, ok, eq, app } from './framework.js';

const seg = await app('segments');
const dbm = await app('db');
const { segmenteAusAntwort, einfuegen, ueberlappungen, blockVorgabe, uhrzeitAufTag, MIN_MS } = seg;
const TOEPFE = dbm.startbestandToepfe();

// 2026-11-13 ist ein Freitag. T(h, m, tag, sek) in Ortszeit.
const T = (h, m = 0, tag = 13, s = 0) => new Date(2026, 10, tag, h, m, s).getTime();
const uhr = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const kurz = (l) => l.map((s) => `${uhr(s.start)}-${uhr(s.ende)} ${s.topfId}${s.quelle === 'manuell' ? '*' : ''}`);
const taet = (topf_id, start, ende, extra = {}) => ({ topf_id, unter_id: null, text: 'Text', start, ende, zeit_quelle: 'genannt', ...extra });
const antwort = (taetigkeiten, rest = {}) => ({ taetigkeiten, ab_jetzt: null, stimmung: null, unklar: null, ...rest });
const aus = (a, ctx) => segmenteAusAntwort(a, { toepfe: TOEPFE, eintragId: 7, ...ctx });

gruppe('segments.js: Uhrzeit auf den Tag legen (Regel 1)');
test('Uhrzeit vor zeit liegt am selben Kalendertag', () => {
  eq(uhrzeitAufTag('10:00', T(10, 20)).ms, T(10, 0));
  eq(uhrzeitAufTag('10:20', T(10, 20, 13, 37)).ms, T(10, 20), 'auf die Minute');
});
test('Uhrzeit nach zeit: Vortag nur nach Mitternacht (selber 04:00-Tag), sonst nicht darstellbar', () => {
  eq(uhrzeitAufTag('23:10', T(0, 40, 14)).ms, T(23, 10, 13), 'Vortag, noch im selben Tag');
  eq(uhrzeitAufTag('04:00', T(0, 40, 14)).ms, T(4, 0, 13), 'genau Tagesbeginn');
  eq(uhrzeitAufTag('23:10', T(10, 20)).ms, null, 'Vortag waere ein anderer Tag');
  eq(uhrzeitAufTag('10:30', T(10, 20)).ms, null);
  eq(uhrzeitAufTag('03:45', T(3, 30, 14)).ms, null, 'Vortag 03:45 liegt vor dem Tagesbeginn');
});
test('kein HH:MM: null', () => { eq(uhrzeitAufTag('abc', T(10)), null); eq(uhrzeitAufTag('25:00', T(10)), null); eq(uhrzeitAufTag(null, T(10)), null); });

gruppe('segments.js: Antwort in Segmente (7.3)');
test('Fall 2: zwei genannte Blöcke im Fenster, quelle ki, zeitQuelle, eintragId', () => {
  const r = aus(antwort([taet('t2', '10:00', '10:30', { text: 'Mails' }), taet('t3', '10:30', '11:00', { text: 'Glasuren mischen' })]), { zeit: T(11), fensterStart: T(10) });
  eq(kurz(r.segmente), ['10:00-10:30 t2', '10:30-11:00 t3']);
  ok(r.segmente.every((s) => s.quelle === 'ki' && s.zeitQuelle === 'genannt' && s.eintragId === 7 && s.unterId === null && !('id' in s)));
  eq(r.segmente[0].text, 'Mails');
});
test('ende nach zeit wird auf zeit begrenzt, start nach zeit macht die Tätigkeit ungültig', () => {
  const r = aus(antwort([taet('t2', '10:00', '10:25'), taet('t3', '10:30', '10:40')]), { zeit: T(10, 20), fensterStart: T(10) });
  eq(kurz(r.segmente), ['10:00-10:20 t2']);
});
test('Sekunden von zeit: Block "bis eben" endet auf der Minute', () => {
  const r = aus(antwort([taet('t2', '10:00', '10:20')]), { zeit: T(10, 20, 13, 37), fensterStart: T(10, 0, 13, 12) });
  eq(r.segmente[0].start, T(10)); eq(r.segmente[0].ende, T(10, 20));
});
test('Mitternacht: 23:10 bis 00:40 liegt auf Vortag und Folgetag', () => {
  const r = aus(antwort([taet('t2', '23:10', '00:40')]), { zeit: T(0, 40, 14), fensterStart: T(23, 0, 13) });
  eq(r.segmente.length, 1); eq(r.segmente[0].start, T(23, 10, 13)); eq(r.segmente[0].ende, T(0, 40, 14));
});
test('Mitternacht: Block ganz vor Mitternacht, aufgenommen nach Mitternacht', () => {
  const r = aus(antwort([taet('t1', '22:00', '23:30')]), { zeit: T(1, 5, 14), fensterStart: null });
  eq(r.segmente[0].start, T(22, 0, 13)); eq(r.segmente[0].ende, T(23, 30, 13));
});
test('Tagesgrenze 04:00: Beginn vor dem Tagesbeginn wird auf 04:00 gesetzt, Block davor entfällt', () => {
  const z = T(5, 0);
  eq(kurz(aus(antwort([taet('t1', '03:00', '04:30')]), { zeit: z }).segmente), ['04:00-04:30 t1']);
  eq(aus(antwort([taet('t1', '02:00', '03:30')]), { zeit: z }).segmente.length, 0, 'ganz vor dem Tagesbeginn');
  eq(aus(antwort([taet('t1', '03:00', '04:00')]), { zeit: z }).segmente.length, 0, 'endet genau am Tagesbeginn');
});
test('Tagesgrenze 04:00: nach Mitternacht aufgenommen gilt der Tag ab 04:00 des Vortags', () => {
  const z = T(3, 30, 14);
  eq(kurz(aus(antwort([taet('t1', '04:30', '05:30')]), { zeit: z }).segmente), ['04:30-05:30 t1']);
  eq(aus(antwort([taet('t1', '03:45', '03:50')]), { zeit: z }).segmente.length, 0, '03:45 wäre der Vortag vor 04:00');
  // um 04:00 beginnt ein neuer Tag: eine Uhrzeit von 23:00 gehört dann nicht mehr dazu
  eq(aus(antwort([taet('t1', '23:00', '23:30')]), { zeit: T(4, 10, 14) }).segmente.length, 0);
});
test('geschätzte Zeiten werden aufs Fenster begrenzt, ohne Fenster entfallen sie', () => {
  const a = antwort([taet('t2', '09:30', '10:30', { zeit_quelle: 'geschaetzt' })]);
  eq(kurz(aus(a, { zeit: T(11), fensterStart: T(10) }).segmente), ['10:00-10:30 t2']);
  eq(aus(a, { zeit: T(11), fensterStart: null }).segmente.length, 0, 'Fenster null');
});
test('genannte Zeiten dürfen vor dem Fenster liegen und gelten ohne Fenster', () => {
  eq(kurz(aus(antwort([taet('t1', '07:00', '08:00'), taet('t1', '08:00', '08:40')]), { zeit: T(8, 40), fensterStart: null }).segmente), ['07:00-08:00 t1', '08:00-08:40 t1']);
  eq(kurz(aus(antwort([taet('t4', '10:00', '12:00')]), { zeit: T(12), fensterStart: T(11) }).segmente), ['10:00-12:00 t4']);
});
test('Fenster null: nur Ab jetzt (Fall 5) ergibt keine Segmente, aber angekuendigt', () => {
  const r = aus(antwort([], { ab_jetzt: { topf_id: 't3', unter_id: null, text: 'Rechnungen' } }), { zeit: T(9, 15), fensterStart: null });
  eq(r.segmente, []); eq(r.angekuendigt, { topfId: 't3', unterId: null, text: 'Rechnungen' });
});
test('unter einer Minute und start >= ende entfallen', () => {
  const r = aus(antwort([taet('t2', '10:00', '10:00'), taet('t2', '10:10', '10:05'), taet('t3', '10:15', '10:20')]), { zeit: T(11), fensterStart: T(10) });
  eq(kurz(r.segmente), ['10:15-10:20 t3']);
  // durch die Begrenzung auf zeit auf Länge null geschrumpft
  eq(aus(antwort([taet('t2', '10:20', '10:30')]), { zeit: T(10, 20, 13, 30) }).segmente.length, 0);
});
test('Reihenfolge nach Start, Überlappung aus derselben Antwort beginnt am Ende des vorherigen', () => {
  const r = aus(antwort([taet('t3', '10:20', '11:00'), taet('t2', '10:00', '10:30')]), { zeit: T(11), fensterStart: T(10) });
  eq(kurz(r.segmente), ['10:00-10:30 t2', '10:30-11:00 t3']);
});
test('Überlappung: ganz verschluckte Tätigkeit entfällt, enthaltene Reste unter einer Minute auch', () => {
  const r = aus(antwort([taet('t2', '10:00', '11:00'), taet('t3', '10:10', '10:20'), taet('t1', '10:30', '11:00')]), { zeit: T(11), fensterStart: T(10) });
  eq(kurz(r.segmente), ['10:00-11:00 t2']);
});
test('Kennungen: unbekannter und archivierter Topf wird unklar, Unterpunkt nur wenn er zum Topf gehört', () => {
  const toepfe = JSON.parse(JSON.stringify(TOEPFE)); toepfe[2].archiviert = true; // t3
  const r = segmenteAusAntwort(antwort([
    taet('t1', '10:00', '10:10', { unter_id: 'u2' }),       // gültig
    taet('t2', '10:10', '10:20', { unter_id: 'u2' }),       // Unterpunkt fremder Topf
    taet('t3', '10:20', '10:30'),                           // archiviert
    taet('t99', '10:30', '10:40', { unter_id: 'u1' }),      // unbekannt
    taet('unklar', '10:40', '10:50', { unter_id: 'u1' }),   // unklar bleibt, ohne Unterpunkt
    taet('t1', '10:50', '11:00', { unter_id: 'u99' }),      // unbekannter Unterpunkt
  ], { ab_jetzt: { topf_id: 't3', unter_id: null, text: 'x' } }), { zeit: T(11), fensterStart: T(10), toepfe, eintragId: 1 });
  eq(r.segmente.map((s) => [s.topfId, s.unterId]), [['t1', 'u2'], ['t2', null], ['unklar', null], ['unklar', null], ['unklar', null], ['t1', null]]);
  eq(r.angekuendigt.topfId, 'unklar', 'ab_jetzt mit archiviertem Topf');
});
test('Unterpunkt eines archivierten Unterpunkts gilt als unbekannt', () => {
  const toepfe = JSON.parse(JSON.stringify(TOEPFE)); toepfe[0].unter[1].archiviert = true; // u2
  const r = segmenteAusAntwort(antwort([taet('t1', '10:00', '10:30', { unter_id: 'u2' })]), { zeit: T(11), toepfe, fensterStart: T(10) });
  eq(r.segmente[0].unterId, null);
});
test('ab_jetzt, Stimmung, unklar werden durchgereicht; Text höchstens sechs Wörter', () => {
  const r = aus(antwort([taet('t2', '10:00', '10:30', { text: 'eins zwei drei vier fünf sechs sieben acht' })], {
    ab_jetzt: { topf_id: 't1', unter_id: 'u2', text: 'Mittag essen' }, stimmung: { wert: -1, stichwort: 'genervt' }, unklar: 'Name unklar' }),
  { zeit: T(11), fensterStart: T(10) });
  eq(r.segmente[0].text, 'eins zwei drei vier fünf sechs');
  eq(r.angekuendigt, { topfId: 't1', unterId: 'u2', text: 'Mittag essen' });
  eq(r.stimmung, { wert: -1, stichwort: 'genervt' }); eq(r.unklar, 'Name unklar');
});
test('ohne ab_jetzt, Stimmung, unklar: alles null; leere Antwort bricht nichts', () => {
  const r = aus(antwort([]), { zeit: T(11), fensterStart: T(10) });
  eq([r.segmente, r.angekuendigt, r.stimmung, r.unklar], [[], null, null, null]);
  eq(aus({}, { zeit: T(11) }).segmente, []);
});
test('Fall 12: ein unklar-Block über das ganze Fenster', () => {
  const r = aus(antwort([taet('unklar', '10:00', '11:00', { text: 'Gespräch mit Jonas' })], { unklar: 'Projekt von Jonas passt zu keinem Topf' }), { zeit: T(11), fensterStart: T(10) });
  eq(kurz(r.segmente), ['10:00-11:00 unklar']);
});

gruppe('segments.js: Einfügen ohne Überlappung (7.4)');
let nextId = 100;
const S = (id, von, bis, topf = 't2', quelle = 'ki', extra = {}) => ({ id, eintragId: 1, topfId: topf, unterId: null, start: T(...von), ende: T(...bis), text: '', quelle, zeitQuelle: 'genannt', ...extra });
const N = (von, bis, topf = 't3', extra = {}) => ({ eintragId: 2, topfId: topf, unterId: null, start: T(...von), ende: T(...bis), text: '', quelle: 'ki', zeitQuelle: 'genannt', ...extra });
const frei = (r) => r.segmente.map((s) => ({ ...s, id: undefined }));

test('in leeren Bestand einfügen', () => {
  const r = einfuegen([], [N([10], [11])]);
  eq(kurz(r.segmente), ['10:00-11:00 t3']); eq(r.loeschen, []); eq(r.schreiben.length, 1);
});
test('Teilen: ein neuer Block mitten in einem bestehenden teilt ihn', () => {
  const r = einfuegen([S(1, [10], [12])], [N([10, 30], [11])]);
  eq(kurz(r.segmente), ['10:00-10:30 t2', '10:30-11:00 t3', '11:00-12:00 t2']);
  const links = r.segmente[0], rechts = r.segmente[2];
  eq(links.id, 1, 'linker Teil behält die id'); ok(!('id' in rechts), 'Rest ohne id (wird neu angelegt)');
  eq(rechts.topfId, 't2'); eq(rechts.eintragId, 1);
  eq(r.loeschen, []); eq(r.schreiben.length, 3, 'gekürzt, neu, Rest');
});
test('Kürzen links und rechts', () => {
  const b = [S(1, [10], [11]), S(2, [11], [12], 't4')];
  const r = einfuegen(b, [N([10, 30], [11, 30])]);
  eq(kurz(r.segmente), ['10:00-10:30 t2', '10:30-11:30 t3', '11:30-12:00 t4']);
  eq(r.loeschen, []); eq(r.schreiben.map((s) => s.id), [1, undefined, 2]);
});
test('Löschen: vollständig überdeckte Bestehende fallen weg', () => {
  const r = einfuegen([S(1, [10], [10, 20]), S(2, [10, 20], [10, 40]), S(3, [10, 40], [11])], [N([10], [10, 45])]);
  eq(kurz(r.segmente), ['10:00-10:45 t3', '10:45-11:00 t2']);
  eq(r.loeschen.sort(), [1, 2]);
});
test('Reste unter einer Minute werden gelöscht', () => {
  const r = einfuegen([S(1, [10], [10, 30])], [N([10, 0, 13, 30], [11])]);
  eq(kurz(r.segmente), ['10:00-11:00 t3']); eq(r.loeschen, [1], 'Rest von 30 s weg');
  const r2 = einfuegen([S(1, [10], [11])], [N([10, 0, 13, 0], [10, 59, 13, 30])]);
  eq(r2.segmente.length, 1, 'rechter Rest von 30 s weg, nur das neue Segment bleibt'); eq(r2.loeschen, [1]);
  const r3 = einfuegen([S(1, [10], [11])], [N([10, 20], [10, 40])]);
  eq(r3.segmente.length, 3, 'Reste von 20 min bleiben');
});
test('Stück eines neuen Segments unter einer Minute entfällt', () => {
  const r = einfuegen([S(1, [10], [10, 30], 't2', 'manuell')], [N([10], [10, 30, 13, 20])]);
  eq(kurz(r.segmente), ['10:00-10:30 t2*']); eq(r.schreiben, []);
});
test('manuell wird nie von ki verdrängt: das neue Segment wird gekürzt', () => {
  const b = [S(1, [10], [11], 't2', 'manuell')];
  eq(kurz(einfuegen(b, [N([10, 30], [11, 30])]).segmente), ['10:00-11:00 t2*', '11:00-11:30 t3']);
  eq(kurz(einfuegen(b, [N([9, 30], [10, 30])]).segmente), ['09:30-10:00 t3', '10:00-11:00 t2*']);
  const ganz = einfuegen(b, [N([10, 10], [10, 50])]);
  eq(kurz(ganz.segmente), ['10:00-11:00 t2*']); eq(ganz.schreiben, []); eq(ganz.loeschen, []);
});
test('ki wird um manuell herum geteilt; das erste Stück behält die id, das zweite ist neu', () => {
  const b = [S(1, [10], [11], 't2', 'manuell')];
  const r = einfuegen(b, [N([9], [12], 't3', { id: 55 })]);
  eq(kurz(r.segmente), ['09:00-10:00 t3', '10:00-11:00 t2*', '11:00-12:00 t3']);
  eq(r.segmente[0].id, 55); ok(!('id' in r.segmente[2]));
  eq(r.segmente[1], b[0], 'manuell unverändert');
});
test('ki verdrängt ki, auch aus einem anderen Eintrag', () => {
  const r = einfuegen([S(1, [10], [11], 't2', 'ki', { eintragId: 9 })], [N([10, 15], [10, 45])]);
  eq(kurz(r.segmente), ['10:00-10:15 t2', '10:15-10:45 t3', '10:45-11:00 t2']);
});
test('Manuelle Änderung verdrängt alles, auch manuell', () => {
  const b = [S(1, [10], [11], 't2', 'manuell'), S(2, [11], [12], 't4', 'ki')];
  const r = einfuegen(b, [N([10, 30], [11, 30], 't1', { quelle: 'manuell' })], { manuell: true });
  eq(kurz(r.segmente), ['10:00-10:30 t2*', '10:30-11:30 t1*', '11:30-12:00 t4']);
});
test('mehrere neue Segmente in einem Aufruf, mit manuellem Block dazwischen', () => {
  const b = [S(1, [9], [10, 30], 't4'), S(2, [10, 30], [11], 't1', 'manuell'), S(3, [11], [13], 't4')];
  const r = einfuegen(b, [N([11], [12], 't3'), N([10], [11], 't2')]);
  eq(kurz(r.segmente), ['09:00-10:00 t4', '10:00-10:30 t2', '10:30-11:00 t1*', '11:00-12:00 t3', '12:00-13:00 t4']);
});
test('Korrektur: neues Segment mit alter id, altes vorher aus dem Bestand genommen', () => {
  const b = [S(1, [10], [11]), S(2, [11], [12], 't4')];
  const neu = { ...b[0], topfId: 't3', quelle: 'manuell', ende: T(11, 30) };
  const r = einfuegen(b.filter((s) => s.id !== 1), [neu], { manuell: true });
  eq(kurz(r.segmente), ['10:00-11:30 t3*', '11:30-12:00 t4']);
  eq(r.segmente[0].id, 1); eq(r.loeschen, []); eq(r.schreiben.map((s) => s.id), [1, 2]);
});
test('Eingaben bleiben unverändert', () => {
  const b = [S(1, [10], [12]), S(2, [13], [14], 't1', 'manuell')], n = [N([11], [13, 30])];
  const vorher = JSON.stringify([b, n]);
  einfuegen(b, n); einfuegen(b, n, { manuell: true });
  eq(JSON.stringify([b, n]), vorher);
});
test('ueberlappungen erkennt Überlappung, nicht bloßes Anstoßen', () => {
  eq(ueberlappungen([S(1, [10], [11]), S(2, [11], [12])]).length, 0);
  eq(ueberlappungen([S(1, [10], [12]), S(2, [11], [11, 10]), S(3, [11, 5], [13])]).length, 3);
});
test('Zufallsprobe: nie Überlappung, Reste >= 1 min, manuell bleibt bei ki, schreiben/loeschen ergeben den Gesamtbestand', () => {
  let z = 12345; const rnd = (n) => { z = (z * 1103515245 + 12345) & 0x7fffffff; return z % n; };
  let bestand = [];
  const anwenden = (b, r) => {
    const m = new Map(b.filter((s) => !r.loeschen.includes(s.id)).map((s) => [s.id, s]));
    for (const s of r.schreiben) { const id = s.id != null ? s.id : nextId++; m.set(id, { ...s, id }); }
    return [...m.values()];
  };
  for (let i = 0; i < 400; i++) {
    const von = 9 * 60 + rnd(300), len = 1 + rnd(120), manuell = rnd(3) === 0;
    const n = { id: nextId++, eintragId: i, topfId: 't' + (1 + rnd(4)), unterId: null, start: T(0, von, 13, rnd(60)), ende: T(0, von + len, 13, rnd(60)), text: '', quelle: manuell ? 'manuell' : 'ki', zeitQuelle: 'genannt' };
    if (n.ende <= n.start) continue;
    const vorherManuell = bestand.filter((s) => s.quelle === 'manuell');
    const r = einfuegen(bestand, [n], { manuell });
    eq(ueberlappungen(r.segmente), [], `Überlappung nach Schritt ${i}`);
    ok(r.segmente.every((s) => s.ende - s.start >= MIN_MS), `Rest unter einer Minute nach Schritt ${i}`);
    if (!manuell) for (const m of vorherManuell) ok(r.segmente.some((s) => s.id === m.id && s.start === m.start && s.ende === m.ende), `manuell verdrängt in Schritt ${i}`);
    // schreiben/loeschen auf den Bestand angewendet ergibt dieselben Zeiträume wie r.segmente
    const angew = anwenden(bestand, r).map((s) => [s.start, s.ende, s.topfId]).sort((a, b) => a[0] - b[0]);
    eq(angew, r.segmente.map((s) => [s.start, s.ende, s.topfId]), `Diff passt nicht in Schritt ${i}`);
    bestand = anwenden(bestand, r);
  }
  ok(bestand.length > 5, 'Probe hat etwas aufgebaut');
});

gruppe('segments.js: Vorgabe für Block von Hand');
test('Vorgabe ist das Fenster, sonst eine halbe Stunde, nie vor Tagesbeginn, mindestens 5 min', () => {
  let v = blockVorgabe(T(10, 20, 13, 40), T(9, 15));
  eq([uhr(v.start), uhr(v.ende)], ['09:15', '10:20']);
  v = blockVorgabe(T(10, 20), null); eq([uhr(v.start), uhr(v.ende)], ['09:50', '10:20']);
  v = blockVorgabe(T(4, 10), null); eq([uhr(v.start), uhr(v.ende)], ['04:00', '04:10'], 'nicht vor Tagesbeginn');
  v = blockVorgabe(T(10, 20), T(10, 19)); eq([uhr(v.start), uhr(v.ende)], ['10:15', '10:20'], 'mindestens 5 min');
});
