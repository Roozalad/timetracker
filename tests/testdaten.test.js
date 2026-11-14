'use strict';
/* Tests fuer den Testdaten-Erzeuger (Paket F). Laeuft ueber tests/framework.js; nicht in main.js eingetragen. */
import { test, gruppe, ok, eq, app } from './framework.js';
import { erzeugeTestdaten, zufallsgenerator } from './testdaten.js?v=0.4.2';

const z = await app('zeit');
const db = await app('db');
const toepfe = db.startbestandToepfe();
const ENDE = new Date(2026, 10, 14, 15, 0, 0, 0).getTime(); // 14.11.2026 15:00
const daten = erzeugeTestdaten({ ende: ENDE, tage: 14, toepfe, zufall: zufallsgenerator(7) });
const segs = [...daten.segmente].sort((a, b) => a.start - b.start);
const eintr = daten.eintraege;

gruppe('Testdaten: Form und Überlappung');
test('keine Überlappungen', () => {
  for (let i = 1; i < segs.length; i++) ok(segs[i].start >= segs[i - 1].ende, `Block ${segs[i - 1].start}-${segs[i - 1].ende} überlappt ${segs[i].start}`);
});
test('start < ende bei jedem Block', () => { for (const s of segs) ok(s.start < s.ende, `Block ohne Dauer: ${s.start}`); });
test('keine Blöcke nach dem Jetzt-Zeitpunkt', () => { for (const s of segs) ok(s.ende <= ENDE, 'Block endet nach dem Jetzt'); });
test('jeder Block endet vor dem nächsten 04:00', () => { for (const s of segs) ok(s.ende <= z.tagesEnde(s.start), 'Block reicht über 04:00 hinaus'); });
test('alle topfId gültig oder unklar', () => {
  for (const s of segs) ok(s.topfId === 'unklar' || toepfe.some((t) => t.id === s.topfId), `unbekannter Topf ${s.topfId}`);
});
test('unterId gehört zum Topf oder ist null', () => {
  for (const s of segs) {
    if (s.unterId == null) continue;
    const t = toepfe.find((x) => x.id === s.topfId);
    ok(t && (t.unter || []).some((u) => u.id === s.unterId), `Unterpunkt ${s.unterId} passt nicht zu ${s.topfId}`);
  }
});
test('Blocktexte höchstens sechs Wörter', () => { for (const s of segs) ok(s.text.split(/\s+/).length <= 6, s.text); });
test('alles als Testdaten markiert', () => {
  ok(segs.every((s) => s.testdaten === true), 'Block ohne Markierung');
  ok(eintr.every((e) => e.testdaten === true), 'Eintrag ohne Markierung');
});
test('jeder Block gehört zu einem vorhandenen Eintrag', () => {
  const ids = new Set(eintr.map((e) => e.id));
  for (const s of segs) ok(ids.has(s.eintragId), `eintragId ${s.eintragId} fehlt`);
});
test('Blöcke liegen im Zeitfenster ihres Eintrags', () => {
  for (const e of eintr) {
    const untergrenze = e.fensterStart != null ? e.fensterStart : z.tagesBeginn(e.zeit);
    for (const s of segs.filter((x) => x.eintragId === e.id)) {
      ok(s.start >= untergrenze, `Block vor dem Fenster von Eintrag ${e.id}`);
      ok(s.ende <= e.zeit, `Block nach dem Eintrag ${e.id}`);
    }
  }
});
test('fensterStart folgt der Regel aus 7.1', () => {
  const sortiert = [...eintr].sort((a, b) => a.zeit - b.zeit);
  sortiert.forEach((e, i) => eq(e.fensterStart, z.fensterStartFuer(e.zeit, i > 0 ? sortiert[i - 1].zeit : null), `Eintrag ${e.id}`));
});

gruppe('Testdaten: Umfang und Muster');
test('14 Tage sind abgedeckt', () => {
  const tage = new Set(segs.map((s) => z.tagesBeginn(s.start)));
  eq(tage.size, 14, 'Anzahl belegter Tage');
});
test('mindestens ein Block geht über Mitternacht', () => {
  ok(segs.some((s) => new Date(s.start).getDate() !== new Date(s.ende - 1).getDate()), 'kein Block über Mitternacht');
});
test('es gibt nicht erfasste Lücken', () => {
  ok(segs.some((s, i) => i > 0 && s.start > segs[i - 1].ende), 'keine Lücke');
});
test('es gibt unklar-Blöcke', () => ok(segs.some((s) => s.topfId === 'unklar'), 'kein unklar-Block'));
test('am Wochenende kein Startup, Studio oder Wohnungsbau', () => {
  for (const s of segs) {
    const tag = new Date(s.start).getDay();
    if (tag === 0 || tag === 6) ok(!['t2', 't3', 't4'].includes(s.topfId), `Werktags-Topf am Wochenende: ${s.topfId}`);
  }
});

gruppe('Testdaten: Startwert');
test('gleicher Startwert ergibt gleiche Daten', () => {
  const zweit = erzeugeTestdaten({ ende: ENDE, tage: 14, toepfe, zufall: zufallsgenerator(7) });
  eq(zweit, daten);
});
test('anderer Startwert ergibt andere Daten', () => {
  const anders = erzeugeTestdaten({ ende: ENDE, tage: 14, toepfe, zufall: zufallsgenerator(8) });
  ok(JSON.stringify(anders) !== JSON.stringify(daten), 'gleiche Daten bei anderem Startwert');
});
