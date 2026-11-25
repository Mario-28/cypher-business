// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — random worker generator
// Name pools + stat distribution for hireable NPC personnel.
// ═══════════════════════════════════════════════════════════════════════════

import { d } from '../constants.mjs';
import { uid, clampInt } from '../constants.mjs';
import { workerEffectiveness } from './people.mjs';
import { rollPersona, rollAppearance } from './people.mjs';

// Gendered first-name pools — personnel and rival figures draw the first
// name from the pool matching their rolled gender (see pickFirstName).
export const FEMALE_FIRST = [
  'Mira', 'Sera', 'Petra', 'Lysa', 'Nadia', 'Thessaly', 'Odessa', 'Wren', 'Isolde', 'Katya',
  'Marnie', 'Ottavia', 'Quilla', 'Sable', 'Vessa', 'Xandra', 'Zora', 'Berta', 'Della', 'Fenna',
  'Hella', 'Jessa', 'Livia', 'Nerissa', 'Priya', 'Rosalind', 'Tilda', 'Verity', 'Yara', 'Anthea',
  'Cressida', 'Elowen', 'Gisela', 'Ines', 'Kira', 'Magda', 'Perpetua', 'Sybil', 'Una', 'Xiomara',
  'Zelda', 'Beatrix', 'Delphine', 'Freya'
];

export const MALE_FIRST = [
  'Aldous', 'Kellan', 'Dovan', 'Ivo', 'Cormac', 'Brann', 'Ferro', 'Haskel', 'Jory', 'Lazlo',
  'Nils', 'Pavel', 'Rennick', 'Tam', 'Ulric', 'Waldo', 'Yorick', 'Anselm', 'Cassius', 'Emeric',
  'Goran', 'Idris', 'Korrin', 'Marek', 'Osric', 'Quentin', 'Stellan', 'Ulf', 'Wilhelm', 'Zebulon',
  'Borin', 'Dain', 'Falko', 'Halvar', 'Jasper', 'Leander', 'Nox', 'Oberon', 'Roland', 'Torvald',
  'Viktor', 'Winslow', 'Yannick', 'Ambrose', 'Cyrus', 'Edmund'
];

/** Full pool — legacy import surface (rivals docs, old exports). */
export const FIRST = [...FEMALE_FIRST, ...MALE_FIRST];

/** First name from the pool matching the worker's gender. */
export function pickFirstName(gender, rng) {
  const pool = gender === 'f' ? FEMALE_FIRST : MALE_FIRST;
  return pool[Math.floor(rng() * pool.length)];
}

export const LAST = [
  'Ashford', 'Blackbriar', 'Corvid', 'Dunmore', 'Everly', 'Fairwind', 'Grimsbane', 'Halloway', 'Ironwood', 'Jex',
  'Kestrel', 'Lockhart', 'Meridian', 'Nighthollow', 'Oakhart', 'Pryce', 'Quillon', 'Ravenswood', 'Sorrel', 'Thorne',
  'Underhill', 'Vance', 'Whitlock', 'Yarrow', 'Zephyr', 'Ambrose', 'Brightwater', 'Coldwell', 'Darkmoor', 'Emberly',
  'Frost', 'Grimshaw', 'Hightower', 'Inkwell', 'Justman', 'Kirk', 'Longford', 'Marlowe', 'Netherby', 'Osbourne',
  'Pike', 'Quick', 'Rotherham', 'Silvers', 'Tennant', 'Umber', 'Voss', 'Westbrook', 'Yates', 'Zeeman',
  'Abernathy', 'Boone', 'Carstairs', 'Delacroix', 'Ellery', 'Fairbanks', 'Granger', 'Hollis', 'Ingram', 'Joyner'
];

/** Uniform 18–30 — the Ninth World hires young and burns fast. */
function rollAge(rng) {
  return 18 + d(rng, 13) - 1; // 18–30, flat
}

/** Quality & force weighted toward the middle, tails possible. */
function rollStat(rng) {
  const a = d(rng, 10), b = d(rng, 10);
  return clampInt((a + b) / 2 + 1); // 2–10 skewed to 5–6
}

/** Gender: even male / female split. */
function rollGender(rng) {
  return rng() < 0.5 ? 'f' : 'm';
}

export function randomWorker(rng = Math.random) {
  const gender = rollGender(rng);
  const first = pickFirstName(gender, rng);
  const last = LAST[Math.floor(rng() * LAST.length)];
  const age = rollAge(rng);
  const productivity = rollStat(rng);
  const morale = clampInt(4 + d(rng, 4)); // 5–8 starters
  const effectiveness = workerEffectiveness({ productivity, morale });
  const persona = rollPersona({ gender, age, productivity, morale }, rng);
  return {
    id: uid('wrk'),
    name: `${first} ${last}`,
    gender,
    age,
    morale,
    productivity,
    wage: 10 + productivity * 2 + effectiveness, // weekly wage in coin
    note: '',
    description: persona.description,
    traits: persona.traits,
    look: rollAppearance({ gender, age }, rng)
  };
}

export function randomCrew(count, rng = Math.random) {
  return Array.from({ length: count }, () => randomWorker(rng));
}

/** Gender for a NAMED slot, hashed from the name — deterministic so a given
 *  actor always gets the same persona; the GM can flip it on the roster. */
function genderFromName(name) {
  const h = [...String(name)].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return h % 2 ? 'f' : 'm';
}

/**
 * Snapshot a leading-worker slot into a payroll worker (personnel tab).
 * The slot stays the leadership-side record; the worker is a real crew
 * member — wage, morale, productivity all feed the weekly engine.
 */
export function lwToWorker(lw, rng = Math.random) {
  const named = typeof lw.actorName === 'string' && lw.actorName.trim() !== '';
  const gender = named ? genderFromName(lw.actorName) : rng() < 0.5 ? 'f' : 'm';
  const name = named
    ? lw.actorName.trim()
    : `${pickFirstName(gender, rng)} ${LAST[Math.floor(rng() * LAST.length)]}`;
  const age = rollAge(rng);
  const productivity = clampInt(lw.productivity ?? rollStat(rng), 0, 10);
  const morale = clampInt(lw.morale ?? clampInt(4 + d(rng, 4)), 0, 10);
  const effectiveness = workerEffectiveness({ productivity, morale });
  const persona = rollPersona({ gender, age, productivity, morale }, rng);
  return {
    id: uid('wrk'),
    lwId: lw.id ?? null,
    name,
    gender,
    age,
    morale,
    productivity,
    wage: 10 + productivity * 2 + effectiveness,
    note: '',
    description: persona.description,
    traits: persona.traits,
    look: rollAppearance({ gender, age }, rng)
  };
}
