'use strict';
/* Testdaten-Erzeuger (Paket F, Abschnitt 6). Reine Funktionen: kein Datenbankzugriff, kein Netz, keine Seite.
   Liefert { eintraege, segmente } im Datenmodell. Alle Datensaetze tragen testdaten: true.
   Ids sind lokal (1, 2, ...); die Seite vergibt beim Einspielen neue Ids und setzt eintragId um. */
import { tagesBeginn, fensterStartFuer } from '../js/zeit.js?v=0.4.1';

const MINUTE = 60 * 1000;
const NACHT_ENDE = 24 * 60 - 20; // spaeteste Endzeit: 03:40, Minuten nach 04:00 des Tages

/** Deterministischer Zufallsgenerator (mulberry32): gleicher Startwert, gleiche Zahlenfolge in [0, 1). */
export function zufallsgenerator(startwert = 1) {
  let s = Math.floor(startwert) >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Vorlagen. topf/unter: Kennung bzw. Unterpunkt-Name (wird gegen toepfe aufgeloest). min: Dauer in Minuten.
const V = {
  morgen: { topf: 't1', unter: 'Morgen- und Abendroutine', text: 'Morgenroutine', sprech: 'Morgenroutine gemacht', min: [40, 70] },
  fruehstueck: { topf: 't1', unter: 'Essen', text: 'Frühstück', sprech: 'gefrühstückt', min: [15, 30] },
  mittag: { topf: 't1', unter: 'Essen', text: 'Mittagessen', sprech: 'Mittag gegessen', min: [30, 45] },
  abend: { topf: 't1', unter: 'Morgen- und Abendroutine', text: 'Abendroutine', sprech: 'Abendroutine gemacht', min: [30, 50] },
  einkauf: { topf: 't1', unter: 'Organisation', text: 'Einkaufen', sprech: 'einkaufen gewesen', min: [30, 50] },
  aufgeraeumt: { topf: 't1', unter: 'Zuhause', text: 'Wohnung aufgeräumt', sprech: 'die Wohnung aufgeräumt', min: [30, 60] },
  freunde: { topf: 't1', unter: 'Freunde', text: 'Abend mit Freunden', sprech: 'mit Freunden gegessen', min: [90, 150] },
  hobby: { topf: 't1', unter: 'Hobby', text: 'Gitarre geübt', sprech: 'Gitarre geübt', min: [30, 60] },
  spass: { topf: 't1', unter: 'Spaß', text: 'Serie geschaut', sprech: 'eine Folge geschaut', min: [40, 90] },
  mails: { topf: 't2', text: 'Mails beantwortet', sprech: 'Mails fürs Startup beantwortet', min: [30, 60] },
  pitch: { topf: 't2', text: 'Pitch-Deck', sprech: 'am Pitch-Deck fürs Startup gearbeitet', min: [60, 120] },
  call: { topf: 't2', text: 'Call mit den Gründern', sprech: 'den Call mit den Gründern gehabt', min: [30, 60] },
  rechnungen: { topf: 't3', text: 'Rechnungen', sprech: 'Rechnungen fürs Töpferstudio geschrieben', min: [30, 60] },
  glasuren: { topf: 't3', text: 'Glasuren gemischt', sprech: 'Glasuren im Studio gemischt', min: [30, 50] },
  kurs: { topf: 't3', text: 'Kurs vorbereitet', sprech: 'den Kurs im Studio vorbereitet', min: [40, 75] },
  bauantrag: { topf: 't4', text: 'Am Bauantrag gearbeitet', sprech: 'am Bauantrag gesessen', min: [60, 120] },
  hausverwaltung: { topf: 't4', text: 'Hausverwaltung angerufen', sprech: 'mit der Hausverwaltung telefoniert', min: [10, 25] },
  jonas: { topf: 'unklar', text: 'Gespräch mit Jonas', sprech: 'mit Jonas über sein neues Projekt gesprochen', min: [30, 60] },
};
const STIMMUNGEN = [
  { wert: -1, stichwort: 'müde' },
  { wert: 1, stichwort: 'zufrieden' },
  { wert: -2, stichwort: 'genervt' },
  { wert: 2, stichwort: 'froh' },
];

/**
 * erzeugeTestdaten({ ende, tage = 14, toepfe, zufall })
 * ende: Zeitpunkt (ms), bis zu dem erzeugt wird. toepfe: Liste wie in der Datenbank (id, unter, archiviert).
 * zufall: Funktion, die Zahlen in [0, 1) liefert (zufallsgenerator(startwert)).
 */
export function erzeugeTestdaten({ ende, tage = 14, toepfe, zufall = zufallsgenerator(1) } = {}) {
  if (typeof ende !== 'number') throw new Error('erzeugeTestdaten: ende fehlt');
  if (!Array.isArray(toepfe)) throw new Error('erzeugeTestdaten: toepfe fehlen');
  const zahl = () => zufall();
  const zwischen = (a, b) => a + Math.floor(zahl() * (b - a + 1)); // Grenzen inklusive
  const wahl = (liste) => liste[Math.floor(zahl() * liste.length)];
  const mit = (p) => zahl() < p;

  // Topf und Unterpunkt aufloesen. Fehlt der Topf (oder ist archiviert), entfaellt der Block; fehlt nur der Unterpunkt, bleibt er null.
  function kennungen(vorlage) {
    if (vorlage.topf === 'unklar') return { topfId: 'unklar', unterId: null };
    const topf = toepfe.find((t) => t.id === vorlage.topf && !t.archiviert);
    if (!topf) return null;
    const unter = vorlage.unter ? (topf.unter || []).find((u) => u.name === vorlage.unter) : null;
    return { topfId: topf.id, unterId: unter ? unter.id : null };
  }

  /** Tagesplan in Minuten nach 04:00. Bloecke sind nacheinander, nie ueberlappend. */
  function tagesplan(wochenende) {
    const b = [];
    let c = wochenende ? 270 : 150; // 08:30 am Wochenende, 06:30 an Werktagen
    let mittag = false, unklarSchon = false;
    const lege = (vorlage, zeitQuelle = mit(0.25) ? 'geschaetzt' : 'genannt', ende = null) => {
      const dauer = zwischen(Math.ceil(vorlage.min[0] / 5), Math.floor(vorlage.min[1] / 5)) * 5;
      const k = kennungen(vorlage);
      const e = ende == null ? c + dauer : ende;
      if (k) b.push({ ...k, text: vorlage.text, sprech: vorlage.sprech, start: c, ende: e, zeitQuelle, unklar: vorlage.topf === 'unklar' });
      c = e; // immer vorwaerts, auch wenn der Block entfaellt
    };
    const pause = (p) => { if (mit(p)) c += zwischen(5, 20); }; // nicht erfasste Zeit
    const nachtBlock = (p) => {
      if (!mit(p)) return;
      c = Math.max(c, zwischen(1110, 1170)); // 22:30 bis 23:30: ueber Mitternacht, aber vor 04:00
      if (c >= NACHT_ENDE) return;
      lege(wahl([V.freunde, V.spass]), 'genannt', Math.min(c + zwischen(60, 200), NACHT_ENDE));
    };

    if (!wochenende) {
      if (mit(0.9)) lege(V.morgen);
      if (mit(0.6)) lege(V.fruehstueck);
      const wohnung = mit(0.35);
      while (c < 840) { // bis 18:00
        if (!mittag && c >= 420) { mittag = true; lege(V.mittag); continue; } // ab 11:00 einmal Mittag
        if (!unklarSchon && mit(0.1)) { unklarSchon = true; lege(V.jonas); }
        else {
          const pool = [V.mails, V.pitch, V.call, V.rechnungen, V.glasuren, V.kurs];
          if (wohnung) pool.push(V.bauantrag, V.hausverwaltung);
          lege(wahl(pool));
        }
        pause(0.25);
      }
      for (let n = zwischen(1, 3); n > 0 && c < 1080; n--) { lege(wahl([V.einkauf, V.aufgeraeumt, V.hobby, V.spass, V.freunde])); pause(0.2); }
      if (c < 1140 && mit(0.7)) lege(V.abend);
      nachtBlock(0.08);
    } else {
      if (mit(0.6)) lege(V.morgen);
      if (mit(0.9)) lege(V.fruehstueck);
      while (c < 960) { // bis 16:00
        if (!mittag && c >= 480) { mittag = true; lege(V.mittag); continue; }
        if (!unklarSchon && mit(0.08)) { unklarSchon = true; lege(V.jonas); }
        else lege(wahl([V.hobby, V.aufgeraeumt, V.einkauf, V.spass]));
        pause(0.2);
      }
      if (mit(0.5)) lege(V.freunde);
      if (mit(0.6) && c < 1140) lege(V.abend);
      nachtBlock(0.25);
    }
    return b;
  }

  const heute = tagesBeginn(ende);
  const gruppen = []; // { zeit, blocks, tagBeginn, angekuendigt }, zeitlich geordnet
  for (let d = 0; d < tage; d++) {
    const datum = new Date(heute);
    datum.setDate(datum.getDate() - (tage - 1 - d)); // Tagesbeginn 04:00 des Tages d
    const beginn = datum.getTime();
    const wochentag = new Date(beginn + 12 * 60 * MINUTE).getDay();
    const plan = tagesplan(wochentag === 0 || wochentag === 6);
    // Absolute Zeiten; alles nach dem Jetzt-Zeitpunkt entfaellt, ein laufender Block endet am Jetzt
    const blocks = plan
      .map((x) => ({ ...x, start: beginn + x.start * MINUTE, ende: beginn + x.ende * MINUTE }))
      .filter((x) => x.start < ende)
      .map((x) => ({ ...x, ende: Math.min(x.ende, ende) }));
    // Eintraege: je 1 bis 3 aufeinanderfolgende Bloecke (eine Aufnahme), nie ueber den Tag hinaus
    for (let i = 0; i < blocks.length;) {
      const n = Math.min(blocks.length - i, zwischen(1, 3));
      gruppen.push({ blocks: blocks.slice(i, i + n), tagBeginn: beginn });
      i += n;
    }
  }

  // Zeitpunkt je Eintrag: kurz nach dem letzten Block, hoechstens bis zum naechsten Block; nie nach dem Jetzt
  gruppen.forEach((g, k) => {
    const letzte = g.blocks[g.blocks.length - 1];
    let zeit = letzte.ende + zwischen(0, 4) * MINUTE;
    const naechste = gruppen[k + 1];
    if (naechste && naechste.tagBeginn === g.tagBeginn) zeit = Math.min(zeit, naechste.blocks[0].start);
    g.zeit = Math.min(zeit, ende);
  });

  const eintraege = [];
  const segmente = [];
  let vorherigeZeit = null;
  gruppen.forEach((g, k) => {
    const id = k + 1;
    const naechste = gruppen[k + 1];
    let angekuendigt = null;
    if (naechste && naechste.blocks[0].start - g.zeit <= 60 * MINUTE && mit(0.8)) {
      const n = naechste.blocks[0];
      angekuendigt = { topfId: n.topfId, unterId: n.unterId, text: n.text };
    }
    const stimmung = mit(0.08) ? wahl(STIMMUNGEN) : null;
    const satz = g.blocks.map((x, j) => (j === 0 ? 'Zuerst ' : 'dann ') + x.sprech).join(', ') + '.';
    eintraege.push({
      id,
      zeit: g.zeit,
      status: 'fertig',
      transkript: stimmung ? `${satz} Ich bin ${stimmung.stichwort}.` : satz,
      fensterStart: fensterStartFuer(g.zeit, vorherigeZeit),
      angekuendigt,
      stimmung: stimmung ? { wert: stimmung.wert, stichwort: stimmung.stichwort } : null,
      unklar: g.blocks.some((x) => x.unklar) ? 'Ein Block konnte keinem Topf sicher zugeordnet werden.' : null,
      promptVersion: 'zuordnung-4',
      fehler: null,
      audioId: null,
      testdaten: true,
    });
    for (const x of g.blocks) {
      segmente.push({
        id: segmente.length + 1,
        eintragId: id,
        topfId: x.topfId,
        unterId: x.unterId,
        start: x.start,
        ende: x.ende,
        text: x.text,
        quelle: 'ki',
        zeitQuelle: x.zeitQuelle,
        testdaten: true,
      });
    }
    vorherigeZeit = g.zeit;
  });

  return { eintraege, segmente };
}
