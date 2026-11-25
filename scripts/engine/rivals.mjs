// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — rival generator
// Foundry-free. Competitor flavor: house descriptions written around their
// M.O., and the crucial figures who actually run the rival operation.
// All randomness flows through the injected rng.
// ═══════════════════════════════════════════════════════════════════════════

import { uid, d, clampInt } from '../constants.mjs';
import { rollTraits, rollAppearance } from './people.mjs';
import { LAST, pickFirstName } from './names.mjs';

// Re-exported so the app can retire its local pools.
export const RIVAL_NAMES = [
  'Red Falcon Trading', 'Gilt & Grit Co.', 'The Hollow Crown', 'Saltworks Union',
  'Voss & Daughters', 'The Night Market', 'Iron Quill Imports', 'Bramble & Sons',
  'The Gilded Viper', 'Cinder Lane Collective', 'Moth & Candle Ltd.', 'The Pale Ledger',
];
export const RIVAL_MOS = [
  'Undercutting prices', 'Elite clientele', 'Smuggling', 'Gossip campaigns',
  'Vertical monopoly', 'Quality arms race', 'Territory muscle', 'Novelty churn',
];

/** The roles a rival's key figures fill — underworld offices, not job titles. */
export const FIGURE_TITLES = [
  'The Money', 'The Face', 'Chief Enforcer', 'Master of Whispers',
  'Head Clerk', 'The Fixer', 'The Brains', 'Old Blood',
];

const OBJECT_PRONOUN = { f: 'her', m: 'him', them: 'them' };

/** One-line M.O. descriptions, keyed by lower-cased RIVAL_MOS fragment. */
const MO_LINES = {
  'undercutting': 'They sell at a loss to starve you out, and their purse is deeper than yours.',
  'elite': 'They do not compete with you — they compete above you, and mention your name only to laugh.',
  'smuggling': 'Half their stock never sees a customs house, and the price of that freedom is paid in favors.',
  'gossip': 'Their sharpest weapon is a printing press and a grudge that never sleeps.',
  'monopoly': 'They own the supplier, the hauler, and the stall. You are allowed to exist at their discretion.',
  'quality': 'Every season they ship something finer than last, and their customers notice the difference.',
  'territory': 'Their negotiators carry crowbars. The message arrives with the morning delivery.',
  'novelty': 'They mint a new fad every month and bury yesterday\'s stock without a funeral.',
};

/** What a rival sells, keyed by lower-cased M.O. fragment. */
const SERVICE_LINES = {
  'undercutting': 'Cut-rate staples at impossibly thin margins — and whatever fell off the back of their carts besides.',
  'elite': 'Bespoke commissions, appointment-only showings, and a waiting list that flatters the wealthy.',
  'smuggling': 'Untaxed luxuries, embargoed curiosities, and delivery to addresses no legitimate hauler will visit.',
  'gossip': 'Pamphlets, rumor-brokering, and the useful kind of silence — all three for sale.',
  'monopoly': 'Everything from raw material to retail shelf; the market buys from them because there is no one else.',
  'quality': 'Signature lines that get finer every season; their catalog reads like a boast.',
  'territory': 'Protection, freight, and "insurance" — all priced by the street, not the shop.',
  'novelty': 'A revolving shelf of fads and limited runs; last month\'s stock vanishes overnight.',
};

/** Their physical footprint, keyed by lower-cased M.O. fragment. */
const FACILITY_LINES = {
  'undercutting': 'A dockside warehouse with more night shifts than windows, and a ledger written in pencil.',
  'elite': 'A marble-front showroom in the best quarter, plus a workshop that visitors are never shown.',
  'smuggling': 'A "legitimate" import house on the quay, three cellars deep, with a door the tax men have never found.',
  'gossip': 'A modest print shop above a tea room — the tea room does the listening.',
  'monopoly': 'Offices over the exchange, yards by the river, and warehouses on every road out of town.',
  'quality': 'A spotless manufactory with master artisans on every bench and a waiting list for the waiting list.',
  'territory': 'A fortified counting-house on the main street; the locals call it the keep, half in jest.',
  'novelty': 'A bright, loud shopfront that changes face every month, and a back room full of whatever sells next.',
};

/**
 * The rival's commercial footprint: what they sell (services) and where they
 * operate (facilities), both keyed off the M.O. with generic fallbacks.
 * Pure lookup — no rng — so it is deterministic per M.O.
 */
export function rollHouseProfile(c) {
  const mo = String(c.focus ?? '').toLowerCase();
  const pick = (pool) =>
    Object.entries(pool).find(([k]) =>
      mo.includes(k) || (k === 'undercutting' && mo.includes('price')))?.[1] ?? null;
  return {
    services: pick(SERVICE_LINES)
      ?? 'Their catalog shifts with the market; whatever sells, they sell first.',
    facilities: pick(FACILITY_LINES)
      ?? 'Their premises are deliberately unremarkable — forgettable fronts, careful landlords.',
  };
}

const AMBITION_LINES = [
  'They want your corner of the market, and they are patient.',
  'They want you gone by winter, and they have said so openly.',
  'They want a truce they can betray at the precise moment it pays best.',
  'They barely know you exist — which is its own kind of insult.',
  'They want to buy you out cheap, and every bad week moves the price in their favor.',
];

const FIGURE_BACKGROUNDS = [
  'Has served the house since before the current sign hung over the door.',
  'Keeps every secret the house owns — and one that could burn it down.',
  'Came up from the docks and still collects debts in person.',
  'Runs three ledgers: one for the tax man, one for the boss, one for themselves.',
  'Smiles with real warmth exactly once per negotiation, and it is never sincere.',
  'Was poached from a competitor and never explained why they left.',
  'Knows every watch rotation on the docks and buys the rounds to keep it that way.',
  'Handles the arrangements nobody asks about and everybody benefits from.',
  'Lost a fortune once and treats vengeance as a retirement plan.',
  'Is family to the owner — by blood, marriage, or debt, depending on who is asked.',
  'Learned the trade in a court, a barracks, or a casino; the accent never says which.',
  'Keeps a polite, well-dressed front over a very practical mind.',
];

const FIGURE_CLOSERS = [
  'Crossing them is discouraged.',
  'Loyal for as long as the coin holds out.',
  'The last person you want deciding your credit is good.',
  'Ruthless, punctual, and unfailingly courteous.',
  'Never raises their voice. Never needs to.',
  'The one the boss calls after midnight.',
];

/**
 * House description written around the rival's M.O. and temperament.
 * Deterministic when fed a seeded rng.
 */
export function describeRival(c, rng = Math.random) {
  const mo = String(c.focus ?? '').toLowerCase();
  const line = Object.entries(MO_LINES).find(([k]) => mo.includes(k))?.[1]
    ?? 'Their methods are a mystery, and the mystery is deliberate.';
  const parts = [line];
  const agg = c.aggression ?? 5;
  const str = c.strength ?? 5;
  if (agg >= 8) parts.push('They move openly and hit hard; half the market flinches when their wagons roll in.');
  else if (agg <= 3) parts.push('They strike rarely, but always where it hurts most.');
  else parts.push('They probe constantly — small cuts, never a duel.');
  if (str >= 8) parts.push('There is no point in the city their reach does not cover.');
  else if (str <= 3) parts.push('They are small, but small things slip through locked doors.');
  parts.push(AMBITION_LINES[Math.floor(rng() * AMBITION_LINES.length)]);
  return parts.join(' ');
}

/**
 * One crucial figure in a rival house. `existing` names are avoided so a
 * roster never carries two of the same person.
 */
export function rollFigure(c, rng = Math.random, existing = []) {
  const gender = rng() < 0.5 ? 'f' : 'm';
  const age = 28 + d(rng, 30); // 29–59 — schemers of consequence
  let name = '';
  for (let tries = 0; tries < 12; tries++) {
    const candidate = `${pickFirstName(gender, rng)} ${LAST[Math.floor(rng() * LAST.length)]}`;
    if (!existing.includes(candidate)) { name = candidate; break; }
    name = name || candidate;
  }
  const title = FIGURE_TITLES[Math.floor(rng() * FIGURE_TITLES.length)];
  const traits = rollTraits(rng);
  const trait = traits[0];
  const pronoun = OBJECT_PRONOUN[gender];
  const description = [
    FIGURE_BACKGROUNDS[Math.floor(rng() * FIGURE_BACKGROUNDS.length)],
    `${FIGURE_CLOSERS[Math.floor(rng() * FIGURE_CLOSERS.length)]}`,
    `Around ${pronoun}, the staff just say "${trait}."`,
  ].join(' ');
  return {
    id: uid('fig'),
    name,
    title,
    gender,
    age,
    note: '',
    description,
    traits,
    look: rollAppearance({ gender, age }, rng),
  };
}

/**
 * Fill a freshly created competitor with flavor: a house description and
 * one or two key figures (the second is likelier for strong rivals).
 */
export function seedCompetitor(c, rng = Math.random) {
  c.description = describeRival(c, rng);
  ({ services: c.services, facilities: c.facilities } = rollHouseProfile(c));
  const count = (c.strength ?? 5) >= 7 || rng() < 0.5 ? 2 : 1;
  c.npcs = [];
  for (let i = 0; i < count; i++) {
    c.npcs.push(rollFigure(c, rng, c.npcs.map((n) => n.name)));
  }
  return c;
}

// ─── pressure: how rivals move from background noise to story events ────────

export const RIVAL_PRESSURE_MAX = 10;
export const RIVAL_PRESSURE_RESET = 4;

/**
 * Classify a weekly attack/defense contest between one rival and the business.
 * Thresholds are shared with week.mjs, which applies the immediate damage.
 */
export function rivalBand(attack, defense) {
  if (attack > defense + 2) return 'rivalBig';
  if (defense > attack + 4) return 'bizBig';
  if (attack > defense) return 'rivalEdge';
  return 'bizEdge';
}

/**
 * Advance one rival's pressure gauge for the week and, if it tops out, convert
 * the buildup into a rival-move event on the story board. Mutates b + c.
 * Returns { notes: report lines, spawned: event|null }.
 */
export function rivalWeekOutcome(b, c, band, labelFor = null) {
  const before = c.pressure ?? 0;
  const delta = band === 'rivalBig' ? 2 : band === 'rivalEdge' ? 1 : band === 'bizBig' ? -2 : -1;
  // v1.40 — success attracts attention: a fat, profitable business builds
  // resentment even in the weeks it wins the exchange. Additive on every
  // band, so it slows de-escalation without ever flipping a win into buildup.
  const bump = (b.attributes?.profit ?? 5) >= 8 ? 1 : 0;
  c.pressure = clampInt(before + delta + bump, 0, RIVAL_PRESSURE_MAX);
  const notes = [];
  let spawned = null;
  if (c.pressure >= RIVAL_PRESSURE_MAX) {
    spawned = rivalMoveEvent(b, c, labelFor);
    b.story ??= { pending: [], journal: [] };
    b.story.pending ??= [];
    b.story.pending.push(spawned);
    c.pressure = RIVAL_PRESSURE_RESET;
    notes.push(`${c.name} makes a move — "${spawned.title}" lands on the Events tab.`);
  } else if (delta > 0 && c.pressure >= RIVAL_PRESSURE_MAX - 2) {
    notes.push(`${c.name} is close to making a move (pressure ${c.pressure}/${RIVAL_PRESSURE_MAX}).`);
  } else if (delta < 0 && before >= RIVAL_PRESSURE_MAX - 2 && c.pressure < RIVAL_PRESSURE_MAX - 2) {
    notes.push(`${c.name} backs off — pressure eases to ${c.pressure}/${RIVAL_PRESSURE_MAX}.`);
  }
  return { notes, spawned };
}

/**
 * Build the rival-move story event for a pressure-maxed competitor. Solutions
 * are authored here (not in EVENT_DEFS) because the target rival is dynamic;
 * defId 'rival_move' is ad-hoc, same as 'custom'. Every resolution path (each
 * success, and solution-0's fail, which fires on expiry) resets the rival's
 * pressure — the move is spent once played out.
 */
export function rivalMoveEvent(b, c, labelFor = null) {
  const difficulty = clampInt(Math.round((c.strength + c.aggression) / 3) + 1, 2, 9);
  const moKey = Object.keys(MO_LINES).find((k) => (c.focus ?? '').toLowerCase().includes(k));
  const moLine = moKey
    ? MO_LINES[moKey]
    : 'They have been circling your trade for weeks, and now the circle closes.';
  const spent = { target: c.id, set: RIVAL_PRESSURE_RESET };
  const blunt = { target: c.id, delta: -1 };
  const solutions = [
    {
      label: 'Meet them head-on',
      desc: 'No subtlety — answer every cut with a counter of your own.',
      pool: 'might', skill: 'none', asset: 0, steps: 2,
      success: { competitorStrength: blunt, competitorPressure: spent, attrs: { marketing: 1 }, note: `${c.name} limps home with a bruised ledger.` },
      fail: { attrs: { marketing: -2 }, productDemand: -1, competitorPressure: spent, note: `${c.name} takes the exchange and sells the story.` }
    },
    {
      label: 'Undercut and outlast',
      desc: 'Bleed coin now to bleed them longer. The treasury will feel it either way.',
      pool: 'intellect', skill: 'none', asset: 0, steps: 2,
      success: { cash: -50, competitorStrength: blunt, competitorPressure: spent, note: `${c.name} folds first; the market notices who paid for the win.` },
      fail: { cash: -50, attrs: { marketing: -1, danger: 1 }, competitorPressure: spent, note: 'You paid, they stayed, and now everyone knows the price of your nerve.' }
    },
    {
      label: 'Turn their game inside out',
      desc: 'Fast, dirty, and quiet. If it goes wrong it goes very wrong.',
      pool: 'speed', skill: 'none', asset: 0, steps: 1,
      success: { attrs: { morale: 1 }, competitorStrength: blunt, competitorPressure: spent, note: `Their own trick arrives on ${c.name}'s doorstep with your calling card.` },
      fail: { attrs: { morale: -2, danger: 1 }, productDemand: -1, competitorPressure: spent, note: `The play unravels in public. ${c.name} sends a thank-you note.` }
    }
  ];
  return {
    id: uid('ev'),
    defId: 'rival_move',
    cat: 'competition',
    difficulty,
    title: `${c.name} makes a move`,
    text: `Pressure from ${c.name} finally breaks the surface. ${moLine}`,
    solutions,
    progress: solutions.map(() => 0),
    dateLabel: typeof labelFor === 'function' ? labelFor(2) : '—',
    dueDateLabel: typeof labelFor === 'function' ? labelFor(2 + 2 * 7) : null,
    dueIn: 2,
    createdWeek: b.week?.index ?? 0,
    compId: c.id
  };
}
