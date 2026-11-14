'use strict';
/* categorize.js gegen ein falsches fetch. Kein echter Key, kein Netz. */
import { test, gruppe, ok, eq, wirft, app } from './framework.js';
import { FAELLE } from './zuordnung-faelle.js?v=0.2.0';
import { attrappeFetch, antwortHuelle, jsonAntwort } from './zuordnung-attrappe.js?v=0.2.0';

const cat = await app('categorize');
const key = await app('key');
const { CONFIG } = await app('config');
const TESTKEY = 'sk-test-0123456789abcdefWXYZ';
key._keySpeicherName(`zeit-test.catkey.${Date.now()}`);

const F = (id) => FAELLE.find((f) => f.id === id);
/** Ersetzt fetch fuer die Dauer von fn. handler(url, opt) -> Response oder wirft. */
async function mitFetch(handler, fn) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opt) => { calls.push({ url, opt, body: JSON.parse(opt.body) }); return handler(url, opt); };
  try { return await fn(calls); } finally { globalThis.fetch = orig; }
}
const gut = (antwort) => () => jsonAntwort(200, antwortHuelle(JSON.stringify(antwort)));

gruppe('categorize: Anfrage');

test('ohne Key: kein_key, kein Aufruf', async () => {
  key.removeKey();
  await mitFetch(() => { throw new Error('darf nicht aufgerufen werden'); }, async (calls) => {
    const e = await wirft(() => cat.categorize(F('F01').eingabe));
    eq(e.art, 'kein_key'); ok(e.blockierend, 'blockierend'); eq(calls.length, 0, 'kein Aufruf');
  });
});

test('Anfrage: Endpunkt, Modell, Schema strikt, store false, Key nur im Header', async () => {
  key.setKey(TESTKEY);
  await mitFetch(gut(F('F01').beispiel), async (calls) => {
    await cat.categorize(F('F01').eingabe);
    const c = calls[0];
    eq(c.url, CONFIG.zuordnenEndpoint); eq(c.opt.method, 'POST');
    eq(c.opt.headers.Authorization, `Bearer ${TESTKEY}`);
    ok(!c.opt.body.includes(TESTKEY), 'Key nicht im Body');
    eq(c.body.model, CONFIG.zuordnenModell); eq(c.body.store, false);
    eq(c.body.reasoning, { effort: CONFIG.zuordnenReasoning });
    eq(c.body.instructions, cat.SYSTEMPROMPT);
    eq(c.body.text.format.type, 'json_schema'); eq(c.body.text.format.strict, true); eq(c.body.text.format.name, 'zuordnung');
    eq(c.body.input.length, 1); eq(c.body.input[0].role, 'user');
  });
});

test('Datenschutz: nur id, hinweise, unter; archivierte Töpfe und Namen gehen nicht hinaus', async () => {
  key.setKey(TESTKEY);
  const f = F('F32');
  const eingabe = { ...f.eingabe, toepfe: f.eingabe.toepfe.map((t) => ({ ...t, farbe: '#123456', bezahlt: true, reihenfolge: 9 })) };
  await mitFetch(gut(f.beispiel), async (calls) => {
    await cat.categorize(eingabe);
    const n = JSON.parse(calls[0].body.input[0].content);
    eq(Object.keys(n), ['jetzt', 'fenster_start', 'angekuendigt', 'toepfe', 'transkript']);
    eq(n.toepfe.map((t) => t.id), ['t1', 't2', 't3', 't4'], 'archivierter t5 fehlt');
    for (const t of n.toepfe) eq(Object.keys(t), ['id', 'hinweise', 'unter']);
    eq(n.toepfe[0].unter[1], { id: 'u2', name: 'Essen' });
    const s = JSON.stringify(calls[0].body);
    ok(!s.includes('#123456') && !s.includes('"name":"Privat"') && !s.includes('"t5"'), 'keine Farbe, kein Anzeigename, kein archivierter Topf');
  });
});

test('Schema: Kennungen als enum aus der gesendeten Liste, alle Felder Pflicht', async () => {
  const n = cat._intern.nachrichtAus(F('F01').eingabe);
  const s = cat._intern.schemaFuer(n.toepfe);
  const t = s.properties.taetigkeiten.items;
  eq(t.properties.topf_id.enum, ['t1', 't2', 't3', 't4', 'unklar']);
  eq(t.properties.unter_id.anyOf[0].enum, ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7']);
  eq(t.required, ['topf_id', 'unter_id', 'text', 'start', 'ende', 'zeit_quelle']);
  eq(s.required, ['taetigkeiten', 'ab_jetzt', 'stimmung', 'unklar']);
  // alle Objekte additionalProperties:false, alle Eigenschaften required
  const pruefe = (o, pfad) => {
    if (!o || typeof o !== 'object') return;
    if (o.type === 'object') {
      eq(o.additionalProperties, false, `${pfad} additionalProperties`);
      eq([...o.required].sort(), Object.keys(o.properties).sort(), `${pfad} required`);
    }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') pruefe(v, `${pfad}.${k}`);
  };
  pruefe(s, 'schema');
  // ohne Unterpunkte: unter_id nur null
  const ohne = cat._intern.schemaFuer([{ id: 't2', hinweise: 'x', unter: [] }]);
  eq(ohne.properties.taetigkeiten.items.properties.unter_id, { type: 'null' });
});

test('leeres Transkript: ungueltig/eingabe, kein Aufruf', async () => {
  key.setKey(TESTKEY);
  await mitFetch(() => { throw new Error('nein'); }, async (calls) => {
    const e = await wirft(() => cat.categorize({ ...F('F01').eingabe, transkript: '   ' }));
    eq(e.art, 'ungueltig'); eq(e.grund, 'eingabe'); eq(calls.length, 0);
  });
});

gruppe('categorize: Antworten');

test('gültige Antwort wird unverändert geliefert, meta gefüllt', async () => {
  key.setKey(TESTKEY);
  const f = F('F07');
  await mitFetch(gut(f.beispiel), async () => {
    const meta = {};
    const a = await cat.categorize(f.eingabe, { meta, modell: 'anderes-modell', reasoning: 'none' });
    eq(a, f.beispiel);
    eq(meta.modell, 'anderes-modell'); eq(meta.reasoning, 'none'); eq(meta.status, 200);
    eq(meta.nutzung.input_tokens, 1900); ok(typeof meta.dauerMs === 'number', 'dauerMs');
  });
});

test('alle Beispielantworten passieren die Strukturprüfung', async () => {
  key.setKey(TESTKEY);
  for (const f of FAELLE) {
    await mitFetch(gut(f.beispiel), async () => { eq(await cat.categorize(f.eingabe), f.beispiel, f.id); });
  }
});

const fehlerFall = async (handler) => {
  key.setKey(TESTKEY);
  return mitFetch(handler, () => wirft(() => cat.categorize(F('F01').eingabe)));
};

test('HTTP 401 -> auth, Key-Rest maskiert', async () => {
  const e = await fehlerFall(() => jsonAntwort(401, { error: { message: `Incorrect API key provided: ${TESTKEY}. sk-abc****wxyz`, code: 'invalid_api_key' } }));
  eq(e.art, 'auth'); eq(e.status, 401); ok(e.blockierend, 'blockierend');
  ok(!e.message.includes(TESTKEY) && !e.message.includes('sk-abc'), e.message);
});
test('HTTP 429 quota -> auth, 429 sonst -> server, 500 -> server, 400 -> ungueltig/abgelehnt', async () => {
  eq((await fehlerFall(() => jsonAntwort(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }))).art, 'auth');
  eq((await fehlerFall(() => jsonAntwort(429, { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }))).art, 'server');
  eq((await fehlerFall(() => jsonAntwort(500, { error: { message: 'boom' } }))).art, 'server');
  const e = await fehlerFall(() => jsonAntwort(400, { error: { message: "Invalid schema for response_format 'zuordnung'", type: 'invalid_request_error' } }));
  eq(e.art, 'ungueltig'); eq(e.grund, 'abgelehnt'); ok(e.message.includes('Invalid schema'), e.message);
});
test('Netzfehler -> netz', async () => {
  const e = await fehlerFall(() => { throw new TypeError('Failed to fetch'); });
  eq(e.art, 'netz'); eq(e.name, 'CategorizeError');
});
test('Antwort nicht lesbar -> server', async () => {
  eq((await fehlerFall(() => new Response('<html>', { status: 200 }))).art, 'server');
});
test('Verweigerung, unvollständig, kein JSON, Schema verletzt -> ungueltig mit grund und roh', async () => {
  const v = await fehlerFall(() => jsonAntwort(200, antwortHuelle(null, { refusal: 'Nein.' })));
  eq([v.art, v.grund], ['ungueltig', 'verweigert']);
  const u = await fehlerFall(() => jsonAntwort(200, antwortHuelle('{"taet', { status: 'incomplete', incomplete: 'max_output_tokens' })));
  eq([u.art, u.grund], ['ungueltig', 'unvollstaendig']); ok(u.message.includes('max_output_tokens'), u.message);
  const k = await fehlerFall(() => jsonAntwort(200, antwortHuelle('{"taetigkeiten": [')));
  eq([k.art, k.grund, k.roh], ['ungueltig', 'antwort', '{"taetigkeiten": [']);
  ok(k.nutzung && k.nutzung.output_tokens === 260, 'nutzung auch im Fehlerfall');
  const bad = (a) => fehlerFall(() => jsonAntwort(200, antwortHuelle(JSON.stringify(a))));
  const basis = F('F01').beispiel;
  const faelle = [
    { ...basis, extra: 1 },
    { ...basis, stimmung: { wert: 3, stichwort: 'x' } },
    { ...basis, taetigkeiten: [{ ...basis.taetigkeiten[0], start: '9:00' }] },
    { ...basis, taetigkeiten: [{ ...basis.taetigkeiten[0], topf_id: 't9' }] },
    { ...basis, taetigkeiten: [{ ...basis.taetigkeiten[0], zeit_quelle: 'vermutet' }] },
    { taetigkeiten: [], ab_jetzt: null, stimmung: null },
  ];
  for (const a of faelle) { const e = await bad(a); eq([e.art, e.grund], ['ungueltig', 'antwort'], JSON.stringify(a).slice(0, 80)); }
});

test('Attrappe: 401 für alle Anfragen -> auth', async () => {
  key.setKey(TESTKEY);
  const { fetch: f } = attrappeFetch(FAELLE, { verzoegerungMs: 0, auth401: true });
  const e = await mitFetch(f, () => wirft(() => cat.categorize(F('F05').eingabe)));
  eq(e.art, 'auth');
  key.removeKey();
});
