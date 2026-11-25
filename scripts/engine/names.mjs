// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — random worker generator
// Name pools + stat distribution for hireable NPC personnel.
// ═══════════════════════════════════════════════════════════════════════════

import { d } from '../constants.mjs';
import { uid, clampInt } from '../constants.mjs';
import { workerEffectiveness } from './people.mjs';
import { rollPersona, rollAppearance } from './people.mjs';

export const FIRST = [
  'Aldous', 'Mira', 'Kellan', 'Sera', 'Dovan', 'Petra', 'Ivo', 'Lysa', 'Cormac', 'Nadia',
  'Thessaly', 'Brann', 'Odessa', 'Ferro', 'Wren', 'Haskel', 'Isolde', 'Jory', 'Katya', 'Lazlo',
  'Marnie', 'Nils', 'Ottavia', 'Pavel', 'Quilla', 'Rennick', 'Sable', 'Tam', 'Ulric', 'Vessa',
  'Waldo', 'Xandra', 'Yorick', 'Zora', 'Anselm', 'Berta', 'Cassius', 'Della', 'Emeric', 'Fenna',
  'Goran', 'Hella', 'Idris', 'Jessa', 'Korrin', 'Livia', 'Marek', 'Nerissa', 'Osric', 'Priya',
  'Quentin', 'Rosalind', 'Stellan', 'Tilda', 'Ulf', 'Verity', 'Wilhelm', 'Yara', 'Zebulon', 'Anthea',
  'Borin', 'Cressida', 'Dain', 'Elowen', 'Falko', 'Gisela', 'Halvar', 'Ines', 'Jasper', 'Kira',
  'Leander', 'Magda', 'Nox', 'Oberon', 'Perpetua', 'Roland', 'Sybil', 'Torvald', 'Una', 'Viktor',
  'Winslow', 'Xiomara', 'Yannick', 'Zelda', 'Ambrose', 'Beatrix', 'Cyrus', 'Delphine', 'Edmund', 'Freya'
];

export const LAST = [
  'Ashford', 'Blackbriar', 'Corvid', 'Dunmore', 'Everly', 'Fairwind', 'Grimsbane', 'Halloway', 'Ironwood', 'Jex',
  'Kestrel', 'Lockhart', 'Meridian', 'Nighthollow', 'Oakhart', 'Pryce', 'Quillon', 'Ravenswood', 'Sorrel', 'Thorne',
  'Underhill', 'Vance', 'Whitlock', 'Yarrow', 'Zephyr', 'Ambrose', 'Brightwater', 'Coldwell', 'Darkmoor', 'Emberly',
  'Frost', 'Grimshaw', 'Hightower', 'Inkwell', 'Justman', 'Kirk', 'Longford', 'Marlowe', 'Netherby', 'Osbourne',
  'Pike', 'Quick', 'Rotherham', 'Silvers', 'Tennant', 'Umber', 'Voss', 'Westbrook', 'Yates', 'Zeeman',
  'Abernathy', 'Boone', 'Carstairs', 'Delacroix', 'Ellery', 'Fairbanks', 'Granger', 'Hollis', 'Ingram', 'Joyner'
];

/** Weighted age: most workers land 22–50. */
function rollAge(rng) {
  const r = rng();
  if (r < 0.15) return 18 + d(rng, 4);        // 18–22 young blood
  if (r < 0.75) return 23 + d(rng, 27);       // 23–49 prime
  return 50 + d(rng, 15);                     // 50–65 veterans
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
  const first = FIRST[Math.floor(rng() * FIRST.length)];
  const last = LAST[Math.floor(rng() * LAST.length)];
  const gender = rollGender(rng);
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
