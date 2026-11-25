/**
 * people.mjs — persona generator for hired workers.
 * Foundry-free. Descriptions weave gender (pronouns), age band, and skill;
 * traits are three distinct picks from a fixed pool; appearance rolls a
 * coherent physical profile (weight derives from build × height², age greys
 * the hair, men past 45 may thin on top). All randomness flows through the
 * injected rng so migrations can use a deterministic seed.
 */

import { clampInt } from '../constants.mjs';

const TRAITS = [
  'stubborn', 'quick-witted', 'methodical', 'hot-tempered', 'kind', 'sarcastic',
  'diligent', 'restless', 'quiet', 'charming', 'suspicious', 'generous',
  'punctual', 'a daydreamer', 'blunt', 'loyal', 'nosy', 'patient',
  'nervous', 'cheerful', 'grim', 'resourceful', 'proud', 'superstitious',
  'a gossip', 'a perfectionist', 'laid-back', 'ambitious', 'moody',
  'honest to a fault', 'crafty', 'brave', 'shy', 'vain', 'hard-drinking',
];

const BACKGROUNDS = [
  'Grew up on a farm and still wakes before dawn.',
  'Ran away to the city at sixteen and never once looked back.',
  'Learned the trade from a parent who never said "well done."',
  'Paid off a family debt doing exactly this kind of work.',
  'Keeps a second job that nobody at the shop knows about.',
  'Served a stretch in the militia; does not talk about it.',
  'Apprenticed under a master who fired them twice and rehired them three times.',
  'Keeps a private ledger of every favor anyone owes them.',
  'Sends most of the wage to family two towns over.',
  'Once had a shop of their own. It burned.',
  'Walked halfway across the realm for this job.',
  'Reads every contract twice, then once more aloud.',
];

const AGE_LINES = [
  { max: 26, text: 'Young and hungry, still collecting calluses and grudges.' },
  { max: 41, text: 'In their prime — steady hands, steady habits.' },
  { max: 56, text: 'Midway through a working life; every shortcut here was learned the hard way.' },
  { max: Infinity, text: 'Grey at the temples and unhurried in speech; decades show in the work.' },
];

const OBJECT_PRONOUN = { f: 'her', m: 'him' };

/** Three distinct traits, order preserved, drawn through rng. */
export function rollTraits(rng) {
  const pool = [...TRAITS];
  const picks = [];
  for (let i = 0; i < 3; i++) picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return picks;
}

/** Two-sentence portrait: age band + background, closing on the first trait. */
export function describeWorker(w, rng = Math.random) {
  const parts = [];
  const skill = ((w.productivity ?? 5) + (w.morale ?? 5)) / 2;
  if (skill >= 8) parts.push('Widely reckoned the surest hand on the floor.');
  parts.push(AGE_LINES.find((a) => (w.age ?? 30) < a.max).text);
  parts.push(BACKGROUNDS[Math.floor(rng() * BACKGROUNDS.length)]);
  const trait = w.traits?.[0] ?? 'steady';
  parts.push(`The whole floor knows ${OBJECT_PRONOUN[w.gender] ?? 'them'} as "${trait}."`);
  return parts.join(' ');
}

/** Full persona: traits first, then the description written around them. */
export function rollPersona(w, rng = Math.random) {
  const traits = rollTraits(rng);
  return { description: describeWorker({ ...w, traits }, rng), traits };
}

/** Deterministic rng (FNV-1a → mulberry32) so migrations never re-roll. */
export function seededRng(seedStr) {
  let h = 2166136261;
  for (const c of String(seedStr)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── physical appearance ────────────────────────────────────────────────────

const HAIR_YOUNG = [
  'black', 'dark brown', 'chestnut', 'auburn', 'copper red', 'honey blonde',
  'ash blonde', 'sandy brown', 'red', 'straw blonde',
];
const HAIR_OLD = ['iron grey', 'salt-and-pepper', 'silver', 'white', 'greying brown', 'greying black'];
const EYE_COLORS = ['dark brown', 'hazel', 'green', 'blue', 'grey', 'amber', 'pale blue', 'black'];
/** [word, bmi factor] — weight is derived so the body stays coherent. */
const BUILDS = [
  ['wiry', 17.5], ['lean', 19], ['sinewy', 20], ['average', 21.5],
  ['broad', 23.5], ['stocky', 25], ['heavyset', 27], ['burly', 26],
];
const STYLES_F = [
  'a practical bun', 'a single braid', 'a loose ponytail', 'shoulder-length and loose',
  'pinned up neatly', 'a braided crown', 'cropped short', "a fighter's knot",
];
const STYLES_M = [
  'cropped short', 'a shaggy mop', 'slicked back', 'a close buzz',
  'shoulder-length, tied back', 'parted neatly', 'a wild mane', "a worker's topknot",
];
/** score → label; bands are upper-exclusive. */
const BEAUTY_WORDS = [[3, 'rough-hewn'], [5, 'plain'], [7, 'pleasant'], [9, 'comely'], [Infinity, 'striking']];

export function beautyWord(score) {
  return BEAUTY_WORDS.find(([max]) => score < max)[1];
}

/**
 * Physical profile. Age greys the hair (nothing before 35, ~90% by 60); men
 * past 45 can go thin on top; height spreads ±12 cm around a gender mean and
 * weight is recomputed from build so the numbers agree with each other.
 */
export function rollAppearance(w, rng = Math.random) {
  const age = w.age ?? 30;
  const greyChance = age < 35 ? 0 : Math.min(0.9, (age - 35) * 0.035);
  const pool = rng() < greyChance ? HAIR_OLD : HAIR_YOUNG;
  const hair = pool[Math.floor(rng() * pool.length)];
  const eyes = EYE_COLORS[Math.floor(rng() * EYE_COLORS.length)];
  const hBase = w.gender === 'f' ? 163 : 177;
  const height = Math.round(hBase + rng() * 24 - 12);
  const [build, bmi] = BUILDS[Math.floor(rng() * BUILDS.length)];
  const weight = Math.max(42, Math.round(bmi * (height / 100) ** 2));
  const thinChance = w.gender === 'm' && age >= 45 ? Math.min(0.5, (age - 40) * 0.03) : 0;
  let style;
  if (rng() < thinChance) style = rng() < 0.5 ? 'a bald pate' : 'a comb-over losing its battle';
  else {
    const styles = w.gender === 'f' ? STYLES_F : STYLES_M;
    style = styles[Math.floor(rng() * styles.length)];
  }
  const beauty = clampInt(Math.round(rng() * 5 + rng() * 5), 0, 10);
  return { hair, eyes, height, weight, build, style, beauty, beautyWord: beautyWord(beauty) };
}

/**
 * Worker effectiveness is DERIVED, never edited: rounded mean of productivity
 * + morale, 0–10. Lives here (not week.mjs) so the module graph stays acyclic —
 * names/story-events both need it without importing the weekly engine.
 */
export function workerEffectiveness(w) {
  return clampInt(Math.round(((w.productivity ?? 5) + (w.morale ?? 5)) / 2), 0, 10);
}

// ─── dossier export — the tooltip card as portable text / chat HTML ─────────
// Pure builders (L = localize fn injected) so both the app action and the
// node tests share one source. GM note is deliberately EXCLUDED: it is an
// internal annotation and must never reach public chat.

const escHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Plain-text dossier — clipboard / journal paste. */
export function workerDossierText(w, L = (k) => k) {
  const genderKey = w.gender === 'f' ? 'CYBUS.Worker.GenderF' : 'CYBUS.Worker.GenderM';
  const l = w.look ?? {};
  const lines = [
    `${w.name} — ${L(genderKey)}, ${w.age}`,
    `${L('CYBUS.Worker.Effectiveness')} ${workerEffectiveness(w)}/10 · ${L('CYBUS.Worker.Morale')} ${w.morale} · ${L('CYBUS.Worker.Productivity')} ${w.productivity} · ${L('CYBUS.Worker.Wage')} ${w.wage ?? 0}`,
    '',
    w.description ?? '',
    '',
    `${L('CYBUS.Worker.LookHair')}: ${l.hair ?? '—'}, ${l.style ?? ''}`.trim(),
    `${L('CYBUS.Worker.LookEyes')}: ${l.eyes ?? '—'}`,
    `${L('CYBUS.Worker.LookHeight')}: ${l.height ?? '—'} cm · ${L('CYBUS.Worker.LookWeight')}: ${l.weight ?? '—'} kg · ${L('CYBUS.Worker.LookBuild')}: ${l.build ?? '—'}`,
    `${L('CYBUS.Worker.LookBeauty')}: ${l.beautyWord ?? '—'} (${l.beauty ?? 0}/10)`
  ];
  if (Array.isArray(w.traits) && w.traits.length) lines.push('', w.traits.join(', '));
  return lines.join('\n');
}

/** Styled HTML dossier for a chat card — inline styles (chat lives outside module CSS). */
export function workerDossierHtml(w, L = (k) => k) {
  const genderKey = w.gender === 'f' ? 'CYBUS.Worker.GenderF' : 'CYBUS.Worker.GenderM';
  const l = w.look ?? {};
  const dim = 'opacity:.72;font-size:11px';
  const row = (label, value) =>
    `<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.08)"><span style="${dim}">${escHtml(label)}</span><span>${escHtml(value)}</span></div>`;
  const traits = (Array.isArray(w.traits) ? w.traits : [])
    .map((t) => `<span style="display:inline-block;padding:1px 8px;margin:2px 4px 0 0;border-radius:999px;font-size:11px;font-weight:700;border:1px solid #c9a22766;color:#c9a227">${escHtml(t)}</span>`)
    .join('');
  return `<div style="border:1px solid #c9a22755;border-radius:10px;padding:10px 14px;background:rgba(10,10,14,.35);font-size:13px;line-height:1.5">
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;border-bottom:1px solid rgba(255,255,255,.14);padding-bottom:5px;margin-bottom:6px">
    <span style="font-weight:800;font-size:15px">${escHtml(w.name)}</span>
    <span style="${dim}">${w.age} &middot; ${escHtml(L(genderKey))}</span>
  </div>
  <div style="${dim}">${escHtml(L('CYBUS.Worker.Effectiveness'))} ${workerEffectiveness(w)}/10 &middot; ${escHtml(L('CYBUS.Worker.Morale'))} ${w.morale} &middot; ${escHtml(L('CYBUS.Worker.Productivity'))} ${w.productivity}</div>
  <p style="font-style:italic;margin:7px 0">${escHtml(w.description ?? '')}</p>
  ${row(L('CYBUS.Worker.LookHair'), `${l.hair ?? '—'}, ${l.style ?? ''}`.trim())}
  ${row(L('CYBUS.Worker.LookEyes'), l.eyes ?? '—')}
  ${row(L('CYBUS.Worker.LookHeight'), `${l.height ?? '—'} cm`)}
  ${row(L('CYBUS.Worker.LookWeight'), `${l.weight ?? '—'} kg`)}
  ${row(L('CYBUS.Worker.LookBuild'), l.build ?? '—')}
  ${row(L('CYBUS.Worker.LookBeauty'), `${l.beautyWord ?? '—'} (${l.beauty ?? 0}/10)`)}
  <div style="margin-top:7px">${traits}</div>
</div>`;
}
