'use strict';
/* Attrappe fuer fetch: beantwortet Anfragen an die Responses API ohne Netz, anhand der Testfaelle.
   Fuer prompt-test.html?attrappe=1 und fuer die Tests. Liefert gueltige, fachlich falsche und unbrauchbare
   Antworten in festem Muster, damit sich Anzeige, Auswertung und Fehlerbehandlung pruefen lassen. */

const kopie = (o) => JSON.parse(JSON.stringify(o));

export function antwortHuelle(text, { status = 'completed', refusal = null, incomplete = null, model = 'attrappe' } = {}) {
  const content = [];
  if (text != null) content.push({ type: 'output_text', text, annotations: [] });
  if (refusal) content.push({ type: 'refusal', refusal });
  return {
    id: 'resp_attrappe', object: 'response', status, model,
    incomplete_details: incomplete ? { reason: incomplete } : null,
    output: [
      { type: 'reasoning', id: 'rs_attrappe', summary: [] },
      { type: 'message', id: 'msg_attrappe', role: 'assistant', status: 'completed', content },
    ],
    usage: {
      input_tokens: 1900, input_tokens_details: { cached_tokens: 1536, cache_write_tokens: 0 },
      output_tokens: 260, output_tokens_details: { reasoning_tokens: 140 }, total_tokens: 2160,
    },
  };
}
export const jsonAntwort = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Fachlich falsche, aber formal gueltige Antwort zu einem Fall. */
export function falscheAntwort(fall) {
  const a = kopie(fall.beispiel);
  if (a.taetigkeiten.length) {
    const t = a.taetigkeiten[0];
    t.topf_id = t.topf_id === 't2' ? 't3' : 't2'; t.unter_id = null;
  } else {
    const j = fall.eingabe.jetzt.slice(-5);
    const h = Math.max(0, Number(j.slice(0, 2)) - 1);
    a.taetigkeiten.push({ topf_id: 't2', unter_id: null, text: 'Erfunden', start: `${String(h).padStart(2, '0')}:${j.slice(3)}`, ende: j, zeit_quelle: 'genannt' });
  }
  return a;
}

/** Unbrauchbare Antworten, der Reihe nach. */
const KAPUTT = [
  () => jsonAntwort(200, antwortHuelle('{"taetigkeiten": [ {"topf_id": "t1"')),                         // abgeschnittenes JSON
  () => jsonAntwort(200, antwortHuelle(null, { refusal: 'Dazu kann ich nichts sagen.' })),              // Verweigerung
  () => jsonAntwort(200, antwortHuelle('{"taetigkeiten":[]', { status: 'incomplete', incomplete: 'max_output_tokens' })),
  () => jsonAntwort(200, antwortHuelle(JSON.stringify({ taetigkeiten: [], ab_jetzt: null, stimmung: { wert: 5, stichwort: 'x' }, unklar: null }))), // Schema verletzt
  () => jsonAntwort(500, { error: { message: 'The server had an error processing your request.', type: 'server_error', code: null } }),
  () => new Response('<html>Bad Gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), // kein JSON
];

/** Plan je Fall (Index i) und Lauf (1..3): 'richtig' | 'falsch' | 'kaputt'. */
export function plan(i, lauf) {
  switch (i % 4) {
    case 0: return 'richtig';
    case 1: return lauf === 3 ? 'falsch' : 'richtig';
    case 2: return lauf === 2 ? 'kaputt' : 'richtig';
    default: return i % 8 === 3 && lauf === 1 ? 'falsch' : 'richtig';
  }
}

/** Erzeugt ein fetch-Ersatz. faelle: FAELLE. Optionen: verzoegerungMs, auth401 (alle Anfragen 401).
    Der Lauf je Fall wird aus der Reihenfolge der Anfragen gezaehlt. Liefert { fetch, anfragen }. */
export function attrappeFetch(faelle, { verzoegerungMs = 30, auth401 = false } = {}) {
  const zaehler = new Map();
  const anfragen = [];
  let kaputtNr = 0;
  const f = async (url, opt) => {
    const body = JSON.parse(opt.body);
    anfragen.push({ url, body, headers: opt.headers });
    if (verzoegerungMs) await new Promise((r) => setTimeout(r, verzoegerungMs + Math.random() * verzoegerungMs));
    if (auth401) return jsonAntwort(401, { error: { message: 'Incorrect API key provided: sk-abc*******wxyz.', type: 'invalid_request_error', code: 'invalid_api_key' } });
    const nachricht = JSON.parse(body.input[0].content);
    const i = faelle.findIndex((x) => x.eingabe.transkript.trim() === nachricht.transkript);
    if (i < 0) return jsonAntwort(400, { error: { message: 'Attrappe: Fall unbekannt', type: 'invalid_request_error' } });
    const lauf = (zaehler.get(i) || 0) + 1; zaehler.set(i, lauf);
    const art = plan(i, lauf);
    if (art === 'kaputt') return KAPUTT[(kaputtNr++) % KAPUTT.length]();
    const a = art === 'falsch' ? falscheAntwort(faelle[i]) : kopie(faelle[i].beispiel);
    return jsonAntwort(200, antwortHuelle(JSON.stringify(a), { model: body.model }));
  };
  return { fetch: f, anfragen };
}
