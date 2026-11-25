// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — story event engine (pure, node-testable)
//
// Replaces the old flat problem table with a categorized, difficulty-scaled
// event system. One event is generated per weekly run, landing on a random
// day of that week (date label comes from an injectable callback so the
// engine stays Foundry-free; the app layer supplies Calendaria labels).
//
// Categories:
//   global      — world-level happenings that wash over the business
//   business    — internal/administrative affairs
//   leadership  — executive drama (roles, loyalty, coups)
//   personnel   — crew-level events (strikes, sickness, talent)
//   competition — rival moves (price wars, smears, poaching)
//   facility    — buildings and infrastructure
//   product     — the product line itself
//   crisis      — MAJOR CRISIS: whole-business threats, difficulty floor 5
//
// Difficulty 1–10 (Cypher scale; DC = difficulty × 3). Common rolls are 1–6;
// the roll gains a size bias from facilities/products/competitors/crew so
// bigger businesses face harder events.
//
// Resolution (v1.17): NO dice. Players never see outcomes or options — their
// copy is a pure description card + a count badge. The GM reads the event,
// picks one of THREE solutions (canonical / bold / safe — each with its own
// success & failure stakes), and works it at the table. Each solution needs
// a number of STEPS logged by the GM (difficulty scales the count) before
// "success" unlocks; "failure" is always available. Declaring an outcome
// applies that solution's spec, writes a journal entry, and clears the
// event. Unresolved events expire when their deadline passes and apply
// solution 1's fail spec automatically.
// ═══════════════════════════════════════════════════════════════════════════

import { ATTRIBUTES, ATTR_MAX, ATTR_MIN, clampInt, clamp100, uid, weightedPick } from '../constants.mjs';
import { randomWorker } from './names.mjs';

export const EVENT_CATEGORIES = ['global', 'business', 'leadership', 'personnel', 'competition', 'facility', 'product', 'crisis'];

/** Skill training → roll bonus (kept for display of the suggested pool). */
export const SKILL_BONUS = { inability: -3, none: 0, trained: 3, specialized: 6 };

// ─── category meta ────────────────────────────────────────────────────────────

/** Per-category accent hues (classes `.cb-ev-cat-<cat>` key off these). */
export const EVENT_CAT_INFO = {
  global:      { hue: 210, blurb: 'The world moves and the business feels it.' },
  business:    { hue: 35,  blurb: 'Internal affairs — books, partners, paperwork.' },
  leadership:  { hue: 265, blurb: 'The people at the top are still people.' },
  personnel:   { hue: 150, blurb: 'The crew is the engine and the engine grumbles.' },
  competition: { hue: 0,   blurb: 'Rivals never sleep.' },
  facility:    { hue: 30,  blurb: 'Walls, roofs, boilers — things wear down.' },
  product:     { hue: 190, blurb: 'What you sell is who you are.' },
  crisis:      { hue: 0,   blurb: 'MAJOR CRISIS — existential threat.' }
};

// ─── difficulty ─────────────────────────────────────────────────────────────

/** Cypher target number for a difficulty. */
export function difficultyDc(difficulty) {
  return clampInt(difficulty, 1, 10) * 3;
}

/** Scale of the business → 0–4 difficulty bias (bigger = harder events). */
export function sizeBias(b) {
  const crew = Math.ceil((b.staff?.workers?.length ?? 0) / 5);
  const size = (b.facilities?.length ?? 0) + (b.products?.length ?? 0) + (b.competitors?.length ?? 0) + crew;
  return clampInt(Math.floor(size / 3), 0, 4);
}

/** 1–6 common roll + bias, clamped 1–10. `floor` sets a minimum (crisis = 5). */
export function rollDifficulty(rng, bias = 0, floor = 1) {
  const roll = 1 + Math.floor(rng() * 6) + clampInt(bias, 0, 4);
  return clampInt(Math.max(floor, roll), 1, 10);
}

/** Failure consequences scale with difficulty tier. */
/** Difficulty-tiered fail multiplier (1 / 1.5 / 2 / 2.5) — failure hurts more the bigger the mess. */
export function failMultiplier(difficulty = 4) {
  if (difficulty <= 3) return 1;
  if (difficulty <= 6) return 1.5;
  if (difficulty <= 8) return 2;
  return 2.5;
}

/** Pure: scale a stake spec by a multiplier — used to DISPLAY difficulty-scaled
 *  failure stakes (resolveEvent applies the same math for real). */
export function scaledSpec(spec = {}, mult = 1) {
  const scaled = { ...spec };
  if (spec.cash) scaled.cash = Math.round(spec.cash * mult);
  if (spec.attrs) scaled.attrs = Object.fromEntries(
    Object.entries(spec.attrs).map(([k, v]) => [k, Math.round(v * mult)])
  );
  return scaled;
}

// ─── outcome specs ────────────────────────────────────────────────────────────

/**
 * Break an outcome spec into display tokens for the stakes block.
 * Each token: { kind, icon, label } — cash, an attribute delta, or a
 * directive (fireWorst / roleWalkout / roleLoyalty / rivalAttack).
 */
/** Flatten a spec into plain semantic tokens for UI stakes lines. Each token
 * carries a kind plus key/delta where meaningful; the app layer localizes. */
export function consequenceTokens(spec = {}) {
  const toks = [];
  for (const [k, v] of Object.entries(spec.attrs ?? {})) {
    if (v) toks.push({ kind: 'attr', key: k, delta: v });
  }
  if (spec.cash) toks.push({ kind: 'cash', delta: spec.cash });
  if (spec.workerMorale) toks.push({ kind: 'workerMorale', delta: spec.workerMorale });
  if (spec.workerProd) toks.push({ kind: 'workerProd', delta: spec.workerProd });
  if (spec.roleMorale) toks.push({ kind: 'roleMorale', delta: spec.roleMorale });
  if (spec.roleProd) toks.push({ kind: 'roleProd', delta: spec.roleProd });
  if (spec.roleLoyalty) toks.push({ kind: 'loyalty', delta: spec.roleLoyalty });
  if (spec.productDemand) toks.push({ kind: 'productDemand', delta: spec.productDemand });
  if (spec.facilityCondition) toks.push({ kind: 'facilityCondition', delta: spec.facilityCondition });
  if (spec.competitorStrength) toks.push({ kind: 'competitorStrength', delta: spec.competitorStrength.delta, target: spec.competitorStrength.target });
  if (spec.competitorPressure) toks.push({ kind: 'competitorPressure', set: spec.competitorPressure.set, target: spec.competitorPressure.target });
  if (spec.hireWorkers) toks.push({ kind: 'hire', count: spec.hireWorkers });
  if (spec.fireWorst) toks.push({ kind: 'fire' });
  if (spec.roleWalkout) toks.push({ kind: 'walkout' });
  return toks;
}

/**
 * Apply an outcome spec to a business (mutates). `mult` scales numeric
 * effects (failure scaling). Returns a summary for reports/journal:
 *   { cash, cashDelta, deltas: {attrKey: appliedDelta}, note, fired?, walkout? }
 * `deltas` is attr-keyed because week.mjs folds it into the report.
 * Spec fields: cash, attrs{ }, workerMorale, workerProd, roleMorale,
 * roleProd, roleLoyalty, productDemand, facilityCondition, competitorStrength
 * ({ target:'all'|'strongest'|compId, delta }), competitorPressure
 * ({ target?: compId, set }), hireWorkers (absolute count — NOT scaled by
 * mult, so failure stakes never hire MORE than success), fireWorst,
 * roleWalkout, note.
 */
export function applyOutcome(b, spec = {}, mult = 1, rng = Math.random) {
  const s = (n) => Math.round(n * mult);
  const deltas = {};
  let cash = 0;
  const out = { deltas, cash: 0, cashDelta: 0, note: spec.note ?? '' };

  if (spec.cash) {
    cash = s(spec.cash);
    b.treasury.cash = Math.round((b.treasury.cash ?? 0) + cash);
    out.cash = cash;
    out.cashDelta = cash;
  }

  for (const [k, v] of Object.entries(spec.attrs ?? {})) {
    if (!ATTRIBUTES.includes(k)) continue;
    const before = b.attributes[k];
    b.attributes[k] = clampInt(before + s(v), ATTR_MIN, ATTR_MAX);
    const actual = b.attributes[k] - before;
    if (actual) deltas[k] = (deltas[k] ?? 0) + actual;
  }

  const workers = b.staff?.workers;
  if (workers?.length) {
    if (spec.workerMorale) for (const w of workers) w.morale = clampInt((w.morale ?? 5) + s(spec.workerMorale), 1, 10);
    if (spec.workerProd) for (const w of workers) w.productivity = clampInt((w.productivity ?? 5) + s(spec.workerProd), 0, 10);
    if (spec.fireWorst) {
      const worst = workers.reduce((a, x) => ((x.productivity ?? 5) + (x.morale ?? 5)) < ((a.productivity ?? 5) + (a.morale ?? 5)) ? x : a, workers[0]);
      const i = workers.indexOf(worst);
      if (i >= 0) workers.splice(i, 1);
      out.fired = worst.name ?? 'a worker';
    }
  }

  const people = [...(b.leadership?.roles ?? []), ...(b.leadWorkers ?? [])];
  for (const p of people) {
    if (!p.actorUuid) continue;
    if (spec.roleMorale) p.morale = clampInt((p.morale ?? 5) + s(spec.roleMorale), 0, 10);
    if (spec.roleProd) p.productivity = clampInt((p.productivity ?? 5) + s(spec.roleProd), 0, 10);
    if (spec.roleLoyalty) p.loyalty = clampInt((p.loyalty ?? 5) + s(spec.roleLoyalty), 0, 10);
  }
  for (const p of people) {
    if (p.actorUuid) p.strength = clampInt(Math.round(((p.productivity ?? 5) + (p.morale ?? 5) + (p.loyalty ?? 5)) / 6), 0, 5);
  }

  if (spec.roleWalkout && (b.leadership?.roles ?? []).length) {
    const filled = b.leadership.roles.filter((r) => r.actorUuid);
    if (filled.length) {
      const lowest = filled.reduce((a, r) => (r.loyalty ?? 5) < (a.loyalty ?? 5) ? r : a, filled[0]);
      lowest.actorUuid = null;
      lowest.morale = Math.min(lowest.morale ?? 5, 3);
      lowest.loyalty = 0;
      out.walkout = lowest.title ?? 'an officer';
    }
  }

  if (spec.productDemand && b.products?.length) {
    for (const p of b.products) if (p.active !== false) p.demand = clampInt((p.demand ?? 5) + s(spec.productDemand), 0, 10);
  }

  if (spec.facilityCondition && b.facilities?.length) {
    for (const f of b.facilities) f.condition = clamp100((f.condition ?? 80) + s(spec.facilityCondition));
  }

  if (spec.competitorStrength && b.competitors?.length) {
    const { target = 'all', delta = 1 } = spec.competitorStrength;
    const s2 = s(delta);
    const byId = b.competitors.find((c) => c.id === target);
    const targets = byId
      ? [byId]
      : target === 'strongest'
        ? [b.competitors.reduce((a, c) => (c.strength ?? 5) > (a.strength ?? 5) ? c : a, b.competitors[0])]
        : b.competitors;
    for (const c of targets) c.strength = clampInt((c.strength ?? 5) + s2, 0, 10);
  }

  if (spec.competitorPressure && b.competitors?.length) {
    const { target = null, set = 0 } = spec.competitorPressure;
    const targets = target
      ? b.competitors.filter((c) => c.id === target)
      : b.competitors;
    for (const c of targets) c.pressure = clampInt(set, 0, 10);
  }

  // hiring is absolute (never mult-scaled) — new hands join the payroll
  if (spec.hireWorkers) {
    const roster = workers ?? (b.staff.workers = []);
    const n = Math.max(0, Math.round(spec.hireWorkers));
    const hired = [];
    for (let i = 0; i < n; i++) {
      const w = randomWorker(rng);
      roster.push(w);
      hired.push(w.name);
    }
    if (hired.length) out.hired = hired;
  }

  return out;
}

// ─── steps ──────────────────────────────────────────────────────────────────

/**
 * Number of table-steps a solution needs before "success" can be declared.
 * Base count (per solution) scaled by difficulty: +1 at 4+, +2 at 7+.
 */
export function stepsFor(base, difficulty) {
  return Math.max(1, base + (difficulty >= 7 ? 2 : difficulty >= 4 ? 1 : 0));
}

// ─── instantiation ──────────────────────────────────────────────────────────

/**
 * Build a pending event instance from a def. Steps per solution are derived
 * from the solution's base step count + difficulty. `labelFor(dayOffset)`
 * supplies an in-fiction date label (Calendaria in the app; fallback here).
 */
export function instantiateEvent(def, business, rng, labelFor = null, fixedDifficulty = null) {
  const difficulty = fixedDifficulty ?? rollDifficulty(rng, sizeBias(business), def.cat === 'crisis' ? 5 : 1);
  const dueIn = clampInt(def.deadline ?? 2, 1, 4);
  const day = 1 + Math.floor(rng() * 7);
  const solutions = (def.solutions ?? []).map((sol) => ({
    ...structuredClone(sol),
    steps: stepsFor(sol.steps ?? 1, difficulty)
  }));
  return {
    id: uid('ev'),
    defId: def.id, cat: def.cat, difficulty,
    title: def.title, text: def.text,
    solutions,
    progress: solutions.map(() => 0),
    dateLabel: typeof labelFor === 'function' ? labelFor(day) : `Day ${day}`,
    // dated deadline (Calendaria): the event MUST be resolved by this in-world
    // date — landing day + dueIn weeks. null when no calendar is active.
    dueDateLabel: typeof labelFor === 'function' ? labelFor(day + dueIn * 7) : null,
    // raw day offset of the resolve-by date (from "now") — the app layer
    // uses it to place real Calendaria deadline notes without reparsing labels.
    dueInDays: day + dueIn * 7,
    dueIn,
    createdWeek: business.week?.index ?? 0
  };
}

/** Category-gated, danger-gated weighted pick over the def table. */
export function eligibleDefs(b) {
  const hasFac = (b.facilities?.length ?? 0) > 0;
  const hasProd = (b.products ?? []).some((p) => p.active !== false);
  const hasComp = (b.competitors?.length ?? 0) > 0;
  const hasLead = (b.leadership?.roles ?? []).some((r) => r.actorUuid);
  const hasCrew = (b.staff?.workers?.length ?? 0) > 0;
  return EVENT_DEFS.filter((d) => {
    if (d.minDanger != null && (b.attributes?.danger ?? 5) < d.minDanger) return false;
    if (d.maxDanger != null && (b.attributes?.danger ?? 5) > d.maxDanger) return false;
    if (d.cat === 'facility' && !hasFac) return false;
    if (d.cat === 'product' && !hasProd) return false;
    if (d.cat === 'competition' && !hasComp) return false;
    if (d.cat === 'leadership' && !hasLead) return false;
    if (d.cat === 'personnel' && !hasCrew) return false;
    return true;
  });
}

/**
 * Roll ONE weekly story event — returns the pending INSTANCE (or null when
 * nothing is eligible). The caller pushes it onto business.story.pending.
 * GM-forced events use `fixedDefId` to push a specific def down the same
 * pipeline (skips eligibility gating — the GM said so).
 */
export function rollWeeklyEvent(b, rng = Math.random, labelFor = null, fixedDefId = null) {
  if (fixedDefId) {
    const def = EVENT_DEFS.find((d) => d.id === fixedDefId);
    return def ? instantiateEvent(def, b, rng, labelFor) : null;
  }
  const pool = eligibleDefs(b);
  if (!pool.length) return null;
  return instantiateEvent(weightedPick(pool, rng), b, rng, labelFor);
}

// ─── GM resolution (v1.17: declared outcomes, no dice) ──────────────────────

/**
 * Log one step of progress on a solution (GM declares what the table did).
 * Mutates progress in place; returns the event's new progress for this
 * solution. No-op for unknown ids / out-of-range solutions.
 */
export function logEventStep(business, eventId, solutionIndex) {
  const ev = business.story?.pending?.find((e) => e.id === eventId);
  if (!ev || !ev.solutions?.[solutionIndex]) return null;
  ev.progress ??= ev.solutions.map(() => 0);
  if ((ev.progress[solutionIndex] ?? 0) >= ev.solutions[solutionIndex].steps) return ev.progress[solutionIndex];
  ev.progress[solutionIndex] = (ev.progress[solutionIndex] ?? 0) + 1;
  return ev.progress[solutionIndex];
}

/**
 * Declare the FINAL OUTCOME of an event for a chosen solution (mutates in
 * place). Applies that solution's success or fail spec (fail scaled by
 * difficulty tier), writes the journal entry + log line, and removes the
 * event. Returns the result summary (null when the id is unknown).
 */
export function resolveEvent(b, eventId, solutionIndex = 0, outcome, rng = Math.random) {
  const idx = b.story?.pending?.findIndex((e) => e.id === eventId) ?? -1;
  if (idx < 0) return null;
  const ev = b.story.pending[idx];
  const sol = ev.solutions?.[solutionIndex] ?? ev.solutions?.[0] ?? null;
  const spec = outcomeSpec(ev, outcome, solutionIndex);
  const success = outcome === 'success';
  const mult = success ? 1 : failMultiplier(ev.difficulty);
  const summary = applyOutcome(b, spec, mult, rng);
  b.story.pending.splice(idx, 1);
  const result = {
    success, difficulty: ev.difficulty, title: ev.title, cat: ev.cat,
    solution: sol?.label ?? null,
    note: summary.note, deltas: summary.deltas, cashDelta: summary.cashDelta,
    fired: summary.fired ?? null, walkout: summary.walkout ?? null,
    hired: summary.hired ?? null
  };
  journalEvent(b, ev, success ? 'success' : 'fail', result);
  return result;
}

// ─── weekly tick ────────────────────────────────────────────────────────────

/** Count down dueIn each week (mutates in place). Expired events auto-apply
 *  solution 1's fail spec, get journaled, and return a result list for the
 *  weekly report. week.mjs calls this directly on the business it resolves. */
export function tickStoryEvents(business, rng = Math.random) {
  const b = business;
  const expired = [];
  if (!b.story?.pending?.length) return expired;
  const remaining = [];
  for (const ev of b.story.pending) {
    ev.dueIn = (ev.dueIn ?? 1) - 1;
    if (ev.dueIn < 0) {
      const spec = outcomeSpec(ev, 'fail', 0);
      const summary = applyOutcome(b, spec, failMultiplier(ev.difficulty), rng);
      const result = {
        success: false, expired: true, title: ev.title, cat: ev.cat,
        note: summary.note, deltas: summary.deltas, cashDelta: summary.cashDelta,
        fired: summary.fired ?? null, walkout: summary.walkout ?? null,
        hired: summary.hired ?? null
      };
      journalEvent(b, ev, 'expired', result);
      expired.push(result);
    } else {
      remaining.push(ev);
    }
  }
  b.story.pending = remaining;
  return expired;
}

// ─── internals ──────────────────────────────────────────────────────────────

/**
 * Spec for an outcome: solution-scoped (v1.17+) → embedded on the instance
 * (v8 legacy) → def-level legacy → def solutions.
 */
function outcomeSpec(ev, kind, index = 0) {
  return ev.solutions?.[index]?.[kind]
      ?? ev[kind]
      ?? EVENT_DEFS.find((d) => d.id === ev.defId)?.solutions?.[index]?.[kind]
      ?? EVENT_DEFS.find((d) => d.id === ev.defId)?.[kind]
      ?? {};
}

/** Prepend a journal entry (newest first, capped at 100) + a business-log line. */
function journalEvent(b, ev, outcome, result) {
  b.story.journal ??= [];
  b.story.journal.unshift({
    id: uid('jev'), title: ev.title, cat: ev.cat, difficulty: ev.difficulty,
    outcome,
    solution: result.solution ?? null,
    note: result.note ?? '', deltas: result.deltas ?? {}, cash: result.cashDelta ?? 0,
    dateLabel: ev.dateLabel ?? null, dueDateLabel: ev.dueDateLabel ?? null,
    week: b.week?.index ?? 0, at: Date.now()
  });
  if (b.story.journal.length > 100) b.story.journal.length = 100;
  const verb = outcome === 'success' ? 'Resolved' : outcome === 'fail' ? 'Failed' : 'Expired';
  b.log ??= [];
  b.log.unshift({
    id: uid('log'), week: b.week?.index ?? 0, type: `ev_${outcome}`,
    title: ev.title,
    text: `${verb}${result.solution ? ` via ${result.solution}` : ''} — ${result.note ?? ''}`.trim(),
    at: Date.now()
  });
}

/** GM fiat: strike a pending event without applying any consequences. */
export function removeEvent(business, eventId) {
  const b = structuredClone(business);
  const idx = b.story?.pending?.findIndex((e) => e.id === eventId) ?? -1;
  if (idx < 0) return { business: b, removed: null };
  const [removed] = b.story.pending.splice(idx, 1);
  return { business: b, removed };
}

/**
 * GM fiat: scrub journal entries from the record (checkbox-selected on the
 * Events tab). `ids` may be a single id or an array; entries without a
 * matching id are kept. Returns the cloned business plus the array of
 * removed entries (empty when nothing matched).
 */
export function removeJournalEntries(business, ids) {
  const b = structuredClone(business);
  const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
  const journal = b.story?.journal ?? [];
  const kept = journal.filter((j) => !wanted.has(j.id));
  const removed = journal.filter((j) => wanted.has(j.id));
  if (b.story) b.story.journal = kept;
  return { business: b, removed };
}

export const EVENT_DEFS = [
  // ═══ GLOBAL — the world moves, the business feels it ═══
  { id: 'gl_tariffs', cat: 'global', w: 3, deadline: 2, title: 'Trade War Tariffs',
    text: 'The crown slaps sudden tariffs on traded goods. Every supplier invoice just grew teeth.',
    solutions: [
      { label: 'Secure local suppliers', desc: 'Eat the cost and reroute through domestic suppliers.', pool: 'intellect', skill: 'trained', asset: 1, steps: 1,
        success: { cash: -50, attrs: { personnel: 1 }, note: 'Costs rise, but the crew keeps moving product.' },
        fail: { cash: -200, attrs: { marketing: -2 }, note: 'Shelves thin out and regulars drift away.' } },
      { label: 'Smuggle past customs', desc: 'Greased palms and midnight wagons beat any tariff.', pool: 'speed', skill: 'trained', asset: 0, steps: 2,
        success: { cash: 150, attrs: { danger: 1 }, note: 'Untaxed goods, fat margins — and a whiff of contraband about the place.' },
        fail: { cash: -250, attrs: { danger: 2, leadership: -1 }, note: 'A seized shipment and some very pointed questions from the harbourmaster.' } },
      { label: 'Stockpile quietly', desc: 'Buy quiet and ride out the season.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -25, note: 'Thin weeks, but the doors stay open.' },
        fail: { cash: -120, attrs: { marketing: -1 }, note: 'Stock runs short and so does the customers\' patience.' } }] },
  { id: 'gl_plague', cat: 'global', w: 2, deadline: 2, title: 'Plague Quarantine',
    text: 'Sickness in the district. The watch seals the streets — nobody in, nobody out.',
    solutions: [
      { label: 'Switch to deliveries', desc: 'Baskets on doorsteps, coin through the grate.', pool: 'speed', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -30, attrs: { marketing: 2 }, note: 'People remember who kept them fed when the doors were locked.' },
        fail: { cash: -150, attrs: { personnel: -2, marketing: -1 }, note: 'The quarantine outlasts the larder, and so does the misery.' } },
      { label: 'Run the cordon at night', desc: 'The watch is thin after midnight. So is conscience.', pool: 'speed', skill: 'specialized', asset: 0, steps: 2,
        success: { cash: 120, attrs: { danger: 2 }, note: 'Trade never sleeps — neither do the watch\'s informants, sadly.' },
        fail: { cash: -200, attrs: { danger: 2, personnel: -2 }, note: 'Flouting a quarantine earns stocks for the crew and a black mark for the house.' } },
      { label: 'Board up and wait', desc: 'Bar the doors and count the loss.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, note: 'A lost month. Everyone\'s alive, at least.' },
        fail: { cash: -120, attrs: { morale: -1 }, note: 'Idle hands, empty purses, muttering on the stoop.' } }] },
  { id: 'gl_procession', cat: 'global', w: 2, deadline: 1, title: 'Royal Procession',
    text: 'The crown\'s heir tours the district. Crowds, chaos, opportunity.',
    solutions: [
      { label: 'Decorate and cater', desc: 'Bunting, portable stalls, commemorative cups.', pool: 'intellect', skill: 'trained', asset: 1, steps: 1,
        success: { cash: 120, attrs: { marketing: 2 }, note: 'The procession passes right by the front door. Everyone sees the name.' },
        fail: { cash: -40, note: 'The crowd swept past the badly-placed stall and took half the stock with it.' } },
      { label: 'Arrange a private viewing', desc: 'A quiet word with the chamberlain.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 200, attrs: { marketing: 3, leadership: 1 }, note: 'The heir raises a cup with the house sigil on it. Priceless.' },
        fail: { cash: -150, attrs: { leadership: -1 }, note: 'The chamberlain is unbribed, unimpressed, and now remembers the name for the wrong reasons.' } },
      { label: 'Sell to the crowd', desc: 'Cheap hot pies where the people stand.', pool: 'speed', skill: 'none', asset: 0, steps: 1,
        success: { cash: 60, note: 'Thin margin, thick crowds. A decent day.' },
        fail: { cash: -30, note: 'The crowd moved on; the pies did not.' } }] },
  { id: 'gl_currency', cat: 'global', w: 2, deadline: 1, title: 'Currency Debasement',
    text: 'The mint adulterates the coinage. Silver in hand is worth less every week.',
    solutions: [
      { label: 'Convert to goods', desc: 'Coin is shrinking; grain is not.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { profit: 2 }, note: 'Warehouses full of hard goods while the coinage shrinks.' },
        fail: { cash: -150, attrs: { profit: -1 }, note: 'Bought high just before the panic peaked.' } },
      { label: 'Speculate on silver', desc: 'Bet the direction of the debasement.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 250, attrs: { danger: 1 }, note: 'The mint\'s own assayer lost money to this house. He noticed.' },
        fail: { cash: -250, attrs: { profit: -2 }, note: 'Wrong side of the mint\'s arithmetic.' } },
      { label: 'Price in barter', desc: 'Eggs, labour, favours — anything but coin.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -20, note: 'Barter keeps the lights on, barely.' },
        fail: { cash: -100, attrs: { marketing: -1 }, note: 'Customers who insist on real coin go elsewhere.' } }] },
  { id: 'gl_propaganda', cat: 'global', w: 2, deadline: 2, title: 'Propaganda Campaign',
    text: 'The crown floods the streets with slogans. Merchants must display loyalty or be noticed.',
    solutions: [
      { label: 'Display loudly', desc: 'Banners, pledges, the works.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -30, attrs: { marketing: 1 }, note: 'Officially approved. The flag looks fine in the window.' },
        fail: { cash: -80, attrs: { marketing: -1 }, note: 'Even the flag looks half-hearted, and the censor notices half-hearted.' } },
      { label: 'Win the pamphlet war', desc: 'Fund the loudest voice in the district.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 100, attrs: { marketing: 2, danger: 1 }, note: 'The house\'s name is on every loyalist\' lips. And every rebel\'s list.' },
        fail: { cash: -150, attrs: { danger: 2 }, note: 'Backing the wrong pamphleteer is a kind of treason, apparently.' } },
      { label: 'Keep heads down', desc: 'No banners, no trouble.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'Ignored by the censors, ignored by everyone.' },
        fail: { cash: -60, attrs: { marketing: -1 }, note: 'The only door without a flag is the one everyone remembers.' } }] },
  { id: 'gl_storm', cat: 'global', w: 2, deadline: 1, title: 'The Strange Storm',
    text: 'Green-black clouds roll in off the sea. Ships vanish. Old sailors cross themselves.',
    solutions: [
      { label: 'Hunker down', desc: 'Batten hatches, board windows, wait it out.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -40, note: 'A soaked week and a few broken panes. Could be worse.' },
        fail: { cash: -120, attrs: { personnel: -1 }, note: 'The roof goes in the night shift; so do three days of trade.' } },
      { label: 'Salvage the wrecks', desc: 'The storm giveth, if you\'re quick.', pool: 'speed', skill: 'trained', asset: 0, steps: 2,
        success: { cash: 220, attrs: { danger: 1 }, note: 'Flotsam, salvage rights, and no questions asked.' },
        fail: { cash: -100, attrs: { personnel: -2 }, note: 'The sea takes the salvage crew\'s boat as a finder\'s fee.' } },
      { label: 'Shelter the neighbours', desc: 'Open the cellar, bank goodwill.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -30, attrs: { morale: 2, marketing: 1 }, note: 'The whole street rode out the storm under this roof.' },
        fail: { cash: -60, attrs: { morale: -1 }, note: 'Damp blankets and short tempers; gratitude lasts a day, mildew a month.' } }] },
  { id: 'gl_pilgrims', cat: 'global', w: 2, deadline: 1, title: 'Pilgrim Tide',
    text: 'Thousands pass through on pilgrimage. They carry little coin but need everything.',
    solutions: [
      { label: 'Serve the pilgrims', desc: 'Cheap beds, honest bread, fair prices.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: 80, attrs: { marketing: 2, morale: 1 }, note: 'Pilgrims talk. Every one of them is walking word of mouth.' },
        fail: { cash: -20, attrs: { marketing: -1 }, note: 'Word spreads that the house gouges the faithful.' } },
      { label: 'Sell supplies to the host', desc: 'The pilgrimage needs wagons, tents, salt pork.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 200, attrs: { marketing: 1 }, note: 'A contract with the pilgrimage guild recurs every season.' },
        fail: { cash: -120, note: 'Overbought perishables for a column that took the southern road instead.' } },
      { label: 'Ignore the tide', desc: 'Not our customers.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'Business as usual.' },
        fail: { cash: -50, attrs: { marketing: -1 }, note: 'The rivals across the street fed the tide and bought loyalty with it.' } }] },
  { id: 'gl_bankrun', cat: 'global', w: 2, deadline: 2, title: 'Bank Run',
    text: 'Rumour says the great bank is insolvent. The queue outside wraps around the block.',
    solutions: [
      { label: 'Pull deposits early', desc: 'Get in the queue first.', pool: 'speed', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 100, note: 'Coin in hand before the doors barred.' },
        fail: { cash: -180, note: 'The bank suspends payment with the house\'s savings inside.' } },
      { label: 'Short the bank', desc: 'Sell what everyone else is about to want to sell.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 300, attrs: { danger: 1 }, note: 'The collapse was, regrettably, very profitable.' },
        fail: { cash: -250, attrs: { danger: 2, leadership: -1 }, note: 'The bank survives and its agents ask who sold it short.' } },
      { label: 'Ride it out', desc: 'The bank has weathered panics before.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The panic passes; the deposits are safe.' },
        fail: { cash: -100, note: 'A frozen account for a frozen season.' } }] },

  // ═══ BUSINESS — internal affairs ═══
  { id: 'bz_audit', cat: 'business', w: 3, deadline: 2, title: 'Tax Audit',
    text: 'A royal auditor arrives with wax seals and an appetite for discrepancies.',
    solutions: [
      { label: 'Clean books', desc: 'Bite the bullet and settle the difference.', pool: 'intellect', skill: 'trained', asset: 1, steps: 1,
        success: { cash: -80, attrs: { leadership: 1 }, note: 'Paid in full, stamped, and officially boring.' },
        fail: { cash: -220, attrs: { leadership: -1 }, note: 'Fines, interest, and a file with the house\'s name on it.' } },
      { label: 'Creative accounting', desc: 'The ledger has… gaps. Fill them artfully.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 100, attrs: { danger: 1 }, note: 'The auditor signs off and leaves confused but impressed.' },
        fail: { cash: -300, attrs: { danger: 2, leadership: -2 }, note: 'Forgery discovered. The crown does not find it charming.' } },
      { label: 'Modest settlement', desc: 'Pay a little now to argue later.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -50, note: 'A quiet settlement; the auditor moves on to richer prey.' },
        fail: { cash: -150, attrs: { marketing: -1 }, note: 'The audit drags on and the whispers start.' } }] },
  { id: 'bz_inheritance', cat: 'business', w: 2, deadline: 2, title: 'Inheritance Dispute',
    text: 'A distant relative of the founder emerges with a claim on a share of the business.',
    solutions: [
      { label: 'Settle quietly', desc: 'A buyout is cheaper than a war.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -100, note: 'A signed renunciation and a farewell dinner.' },
        fail: { cash: -200, attrs: { morale: -1 }, note: 'The claim festers and the staff pick sides.' } },
      { label: 'Fight in court', desc: 'The claim is paper-thin. Prove it.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 50, attrs: { leadership: 2 }, note: 'The claim collapses; the house\'s title is ironclad.' },
        fail: { cash: -200, attrs: { leadership: -1, marketing: -1 }, note: 'Legal fees and lurid testimony for the scandal sheets.' } },
      { label: 'Welcome them in', desc: 'Perhaps the bloodline is worth more than the fuss.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { leadership: 1, morale: 1 }, note: 'The new partner is annoying but useful.' },
        fail: { attrs: { leadership: -1, morale: -1 }, note: 'The new partner is worse than annoying.' } }] },
  { id: 'bz_embezzle', cat: 'business', w: 2, deadline: 2, title: 'Embezzlement',
    text: 'The books don\'t add up. Someone inside has been skimming for months.',
    solutions: [
      { label: 'Quiet dismissal', desc: 'Recover what you can, no scandal.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -50, attrs: { leadership: 1 }, note: 'The thief vanishes into the night with a warning instead of a trial.' },
        fail: { cash: -150, attrs: { morale: -2 }, note: 'The staff learns the thief got away with it. Everyone has ideas now.' } },
      { label: 'Set a trap', desc: 'Mark the ledgers and wait.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 100, attrs: { leadership: 2 }, note: 'Caught red-handed, restitution made, example set.' },
        fail: { cash: -100, attrs: { morale: -1, leadership: -1 }, note: 'The trap springs on the wrong clerk.' } },
      { label: 'Report to the watch', desc: 'Let the law make an example.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { leadership: 1, danger: -1 }, note: 'Public justice, public deterrence.' },
        fail: { cash: -80, attrs: { morale: -2 }, note: 'The crew watches a colleague carted off in chains. Productivity suffers.' } }] },
  { id: 'bz_fire_archives', cat: 'business', w: 2, deadline: 1, title: 'Fire in the Archives',
    text: 'Smoke curls up from the records room. Decades of contracts, deeds, and debts are in there.',
    solutions: [
      { label: 'Organize a bucket line', desc: 'Save what can be saved.', pool: 'speed', skill: 'none', asset: 0, steps: 1,
        success: { cash: -40, note: 'Soot and soaked paper, but the deeds survive.' },
        fail: { cash: -120, attrs: { personnel: -1 }, note: 'Half the archives are ash and someone\'s sleeve caught fire.' } },
      { label: 'Salvage the strongbox first', desc: 'Deeds and coin before ledgers.', pool: 'speed', skill: 'trained', asset: 0, steps: 2,
        success: { cash: 150, attrs: { leadership: 1 }, note: 'The iron box comes out glowing. Everything vital is in it.' },
        fail: { cash: -100, attrs: { leadership: -2 }, note: 'The strongbox is empty — and now everyone knows what was kept where.' } },
      { label: 'Let it burn and rebuild', desc: 'Paper is replaceable. Mostly.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -100, note: 'Rebuild the records from memory and copies. Costly, quiet.' },
        fail: { cash: -200, attrs: { marketing: -1 }, note: 'A rival produces a "copy" of a deed the house can no longer disprove.' } }] },
  { id: 'bz_guild', cat: 'business', w: 3, deadline: 2, title: 'Guild Demands',
    text: 'The trade guild wants higher dues, stricter standards, and a seat at the table.',
    solutions: [
      { label: 'Negotiate terms', desc: 'Some dues are the price of the badge.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -80, attrs: { marketing: 1 }, note: 'A modest dues increase buys guild protection and the badge on the door.' },
        fail: { cash: -150, attrs: { marketing: -1 }, note: 'The guild blackballs the house from the autumn fair.' } },
      { label: 'Break the guild\'s grip', desc: 'Organize the independents.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 100, attrs: { marketing: 2, danger: 2 }, note: 'The independents rally. The guild will remember this.' },
        fail: { cash: -200, attrs: { danger: 2, marketing: -2 }, note: 'The guild crushes the rebellion and names this house its ringleader.' } },
      { label: 'Join and comply', desc: 'Badge, dues, standards — all of it.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, attrs: { marketing: 1 }, note: 'Respectable, protected, regulated.' },
        fail: { cash: -100, note: 'Dues eat the quarter\'s margin.' } }] },
  { id: 'bz_supplier', cat: 'business', w: 3, deadline: 2, title: 'Supplier Collapse',
    text: 'The chief supplier\'s warehouse burned. The pipeline is dry as summer.',
    solutions: [
      { label: 'Dual-source', desc: 'Spread orders across smaller houses.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -60, attrs: { personnel: 1 }, note: 'Smaller lots, more wagons, no single throat to choke the business.' },
        fail: { cash: -150, attrs: { marketing: -1 }, note: 'The little suppliers can\'t cover the volume; shelves gape.' } },
      { label: 'Buy the wreck', desc: 'The burned supplier is cheap now. Very cheap.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -100, attrs: { profit: 2 }, note: 'Their routes, their contracts, their people — all under one roof now.' },
        fail: { cash: -250, attrs: { profit: -1 }, note: 'The wreck turns out to be mostly debt wearing a warehouse costume.' } },
      { label: 'Ration stock', desc: 'Sell less, sell dear, hold out.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -40, attrs: { marketing: -1 }, note: 'Thin shelves, loyal regulars, a survived month.' },
        fail: { cash: -100, attrs: { marketing: -2 }, note: 'Empty shelves send customers to rivals who still have stock.' } }] },
  { id: 'bz_blackmail', cat: 'business', w: 2, deadline: 2, title: 'The Blackmail Letter',
    text: 'An anonymous letter knows something true and ugly. It wants money.',
    solutions: [
      { label: 'Pay once', desc: 'Buy silence and hope it stays bought.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -100, note: 'The letter stops. For now.' },
        fail: { cash: -200, attrs: { morale: -1 }, note: 'Paid once, and now they know you\'ll pay again.' } },
      { label: 'Hunt the writer', desc: 'Turn the game around on the writer.', pool: 'speed', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { leadership: 2 }, note: 'The blackmailer is unmasked and suddenly very reasonable.' },
        fail: { cash: -150, attrs: { danger: 2, marketing: -1 }, note: 'The letters publish in revenge, signed with the house\'s name.' } },
      { label: 'Publish it yourself', desc: 'Take the sting out first.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { marketing: 1, morale: 1 }, note: 'The scandal, confessed and contextualized, becomes a strange kind of charm.' },
        fail: { attrs: { marketing: -2, morale: -1 }, note: 'Confession without absolution. The story runs anyway, worse now.' } }] },
  { id: 'bz_boom', cat: 'business', w: 2, deadline: 2, title: 'Boom Quarter',
    text: 'Money moves through the district like meltwater. Everyone is buying.',
    solutions: [
      { label: 'Expand hours', desc: 'More shifts, more stock, more everything.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 180, attrs: { profit: 2 }, note: 'The boom paid for the extra lamps and then some.' },
        fail: { cash: -80, attrs: { personnel: -1 }, note: 'Hired too fast, trained too slow, dropped too many plates.' } },
      { label: 'Speculate on the upswing', desc: 'Buy forward, sell into the peak.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 350, attrs: { profit: 2, danger: 1 }, note: 'Bought the warehouse next door with the quarter\'s winnings.' },
        fail: { cash: -250, attrs: { profit: -2 }, note: 'The boom breaks exactly as the forward contracts come due.' } },
      { label: 'Steady as she goes', desc: 'Booms end. Reputations don\'t.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: 80, attrs: { marketing: 1 }, note: 'Regular prices, regulars pleased. The boom tips well.' },
        fail: { cash: 40, note: 'A quiet quarter while rivals get rich loud.' } }] },

  // ═══ LEADERSHIP — the people at the top ═══
  { id: 'ld_poacher', cat: 'leadership', w: 3, deadline: 1, title: 'Rival Poacher',
    text: 'A rival is courting the house\'s best officer with promises of titles and twice the pay.',
    solutions: [
      { label: 'Counter-offer', desc: 'Match the money, keep the talent.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -120, attrs: { leadership: 1 }, note: 'Signed for another season. The rival\'s courier leaves empty-handed.' },
        fail: { attrs: { leadership: -2, morale: -1 }, roleWalkout: true, note: 'The office is cleared out by morning. The rival sends a thank-you card.' } },
      { label: 'Expose the rival', desc: 'Ruin the offer, keep the officer.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { marketing: 1, leadership: 2 }, note: 'The rival\'s promises turn out to be vapour. Loyalty, strangely, improves.' },
        fail: { cash: -100, attrs: { danger: 1, leadership: -1 }, note: 'Slander suit. The officer defects anyway, out of disgust or greed.' } },
      { label: 'Let them go', desc: 'No chain is a good chain.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 1 }, note: 'A fond farewell and a good reference. The crew notices the grace of it.' },
        fail: { attrs: { leadership: -2, profit: -1 }, roleWalkout: true, note: 'The departure cascades; two more officers start "just looking."' } }] },
  { id: 'ld_scandal', cat: 'leadership', w: 2, deadline: 1, title: 'Scandalous Letters',
    text: 'Someone is mailing ugly personal letters about the management to staff and customers.',
    solutions: [
      { label: 'Trace the sender', desc: 'Paper, ink, and postage all have habits.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { leadership: 1 }, note: 'The sender is found — a dismissed clerk with a grudge and, now, a warning.' },
        fail: { cash: -80, attrs: { morale: -1 }, note: 'More letters. Better penmanship.' } },
      { label: 'Drown it in scandal of your own', desc: 'Release something juicier, truer, kinder.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { marketing: 2 }, note: 'The scandal sheets print the house\'s version and forget the letters entirely.' },
        fail: { attrs: { marketing: -2, morale: -1 }, note: 'Now there are TWO scandals. Mathematics is cruel.' } },
      { label: 'Ignore it', desc: 'Ink dries. Truth outlasts it.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The letters taper off. Boredom is the gossip-monger\'s enemy.' },
        fail: { attrs: { morale: -2, marketing: -1 }, note: 'Unanswered slander settles in people\'s minds like soot.' } }] },
  { id: 'ld_succession', cat: 'leadership', w: 2, deadline: 2, title: 'Succession Crisis',
    text: 'The founder is old. Two heirs circle the desk with knives drawn (metaphorically, so far).',
    solutions: [
      { label: 'Mediate the heirs', desc: 'Split duties, define domains, keep both.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { leadership: 2 }, note: 'A formal partition of responsibilities, signed and witnessed. The founder sleeps.' },
        fail: { attrs: { leadership: -2, morale: -1 }, note: 'The mediation collapses into recrimination. The staff divides into camps.' } },
      { label: 'Back the stronger heir', desc: 'One ruler is worth two pretenders.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { attrs: { leadership: 1, profit: 1 }, note: 'A clean succession, one coronation, one retirement villa.' },
        fail: { cash: -150, attrs: { leadership: -2 }, note: 'Backed the wrong heir. The right one remembers.' } },
      { label: 'The founder decides alone', desc: 'Stay out of the bloodline\'s way.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The will names one heir. The other sues quietly and loses.' },
        fail: { attrs: { leadership: -1, morale: -2 }, note: 'An unclear will, an open wound, a year of tension.' } }] },
  { id: 'ld_coup', cat: 'leadership', w: 2, deadline: 1, title: 'Boardroom Coup',
    text: 'The officers meet behind locked doors. The rumour is a vote of no confidence.',
    solutions: [
      { label: 'Address the grievances', desc: 'Find out what they actually want.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -60, attrs: { morale: 2, leadership: 1 }, note: 'Raises where due, apologies where owed. The coup dissolves into minutes.' },
        fail: { attrs: { leadership: -2, morale: -2 }, note: 'Too little, too late. The vote carries.' } },
      { label: 'Pre-empt and purge', desc: 'Fire the ringleaders before the vote.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { leadership: 1, danger: 1 }, note: 'Decisive. Ruthless. The survivors are very loyal now, or very quiet.' },
        fail: { cash: -100, attrs: { leadership: -3, morale: -3 }, note: 'The purge misfires; the whole officer corps walks in solidarity.' } },
      { label: 'Call the vote now', desc: 'Trust the loyalty you\'ve earned.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { leadership: 2 }, note: 'The vote fails 1–6. The one dissenter resigns gracefully.' },
        fail: { attrs: { leadership: -2, morale: -1 }, roleWalkout: true, note: 'The vote carries. Management changes hands over a weekend.' } }] },
  { id: 'ld_drift', cat: 'leadership', w: 3, deadline: 2, title: 'Vision Drift',
    text: 'The house has lost its thread. What is it for? The staff can feel the aimlessness.',
    solutions: [
      { label: 'Hold a summit', desc: 'Officers and foremen, one long honest day.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { leadership: 2, morale: 1 }, note: 'A renewed charter, three clear goals, and a toast.' },
        fail: { attrs: { morale: -1 }, note: 'The summit produces a mission statement everyone hates equally.' } },
      { label: 'Found a flagship project', desc: 'Give the house a mountain to climb.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 100, attrs: { marketing: 2, morale: 2 }, note: 'The whole district watches the house build the impossible thing.' },
        fail: { cash: -200, attrs: { morale: -2, marketing: -1 }, note: 'The flagship sinks at the pier, metaphorically and expensively.' } },
      { label: 'Let it settle', desc: 'Drift is a season, not a sentence.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The fog passes on its own. Mostly.' },
        fail: { attrs: { morale: -2, leadership: -1 }, note: 'A season of drift becomes a year. The best people leave first.' } }] },
  { id: 'ld_noble', cat: 'leadership', w: 2, deadline: 1, title: 'Noble Appointment',
    text: 'A minor noble offers patronage: prestige, contracts, and a title — with strings.',
    solutions: [
      { label: 'Accept formally', desc: 'Take the patronage and the obligations.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { marketing: 2, leadership: 1 }, cash: 100, note: 'The crest goes above the door; the contracts keep the ledger fat.' },
        fail: { attrs: { marketing: -1, danger: 1 }, note: 'The noble\'s enemies become the house\'s enemies, unconsulted.' } },
      { label: 'Negotiate the terms', desc: 'Take the honey, trim the strings.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 150, attrs: { marketing: 2 }, note: 'A patronage lite: the crest, the contracts, none of the fealty.' },
        fail: { attrs: { danger: 1, leadership: -1 }, note: 'The noble interprets negotiation as insolence. Nobles do that.' } },
      { label: 'Decline politely', desc: 'No crest, no strings.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 1 }, note: 'Independent and proud of it. The regulars respect the spine.' },
        fail: { attrs: { marketing: -1 }, note: 'The crest goes to a rival. Their door is suddenly busier.' } }] },
  { id: 'ld_assassin', cat: 'leadership', w: 1, deadline: 1, title: 'Assassination Attempt',
    text: 'A knife in the dark, a poisoned cup, a fall from a high window. Someone wants the boss dead.',
    solutions: [
      { label: 'Hire bodyguards', desc: 'Professional paranoia, around the clock.', pool: 'intellect', skill: 'trained', asset: 1, steps: 1,
        success: { cash: -100, attrs: { leadership: 1, danger: -1 }, note: 'The next attempt bounces off a very large person named Grief.' },
        fail: { attrs: { leadership: -2, morale: -2 }, note: 'The guards are bought or blind. It nearly works.' } },
      { label: 'Fake the death', desc: 'Dead men collect no knives.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { danger: -2 }, note: 'A funeral, a resurrection, and an assassin who reports success to the wrong patron.' },
        fail: { cash: -150, attrs: { danger: 2, marketing: -1 }, note: 'The "corpse" is spotted at the opera. The assassin tries again, angrier.' } },
      { label: 'Strike at the patron', desc: 'Answer the knife with a writ.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { danger: -1, leadership: 1 }, note: 'The patron\'s own allies shut the contract down. Business, not blood.' },
        fail: { attrs: { leadership: -1, danger: 2 }, note: 'The patron doubles the price on the contract.' } }] },
  { id: 'ld_mentor', cat: 'leadership', w: 2, deadline: 2, title: 'The Mentor Returns',
    text: 'The old founder\'s partner resurfaces — grey, sharp, and full of opinions about how things are run.',
    solutions: [
      { label: 'Give an advisory seat', desc: 'Honour the past, use its wisdom.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { leadership: 2 }, note: 'The old wolf sees things the young lions miss.' },
        fail: { attrs: { morale: -1, leadership: -1 }, note: 'The advisory seat becomes a throne. The staff walk on eggshells.' } },
      { label: 'A final great venture', desc: 'One more mountain, together.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 200, attrs: { leadership: 2, marketing: 1 }, note: 'The mentor\'s last project is the house\'s best year.' },
        fail: { cash: -150, attrs: { leadership: -1 }, note: 'The old methods don\'t fit the new world. Expensive lesson.' } },
      { label: 'A graceful stipend', desc: 'Gold watch, warm chair, distant office.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -80, attrs: { morale: 1 }, note: 'The mentor retires to a comfortable critic\'s chair and, eventually, gratitude.' },
        fail: { attrs: { marketing: -1, morale: -1 }, note: 'The mentor tells the district what the house has become. Colourfully.' } }] },

  // ═══ PERSONNEL — the crew is the engine ═══
  { id: 'ps_strike', cat: 'personnel', w: 3, deadline: 1, title: 'Strike Vote',
    text: 'The crew is one meeting away from walking out. Wages, hours, or respect — pick a grievance.',
    solutions: [
      { label: 'Meet the demands', desc: 'Pay the raise, fix the rota, say the apology.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -120, attrs: { morale: 3, personnel: 1 }, note: 'The strike dies unborn. The foreman cries a little. So does the ledger, happily.' },
        fail: { cash: -150, attrs: { morale: -3, personnel: -2 }, note: 'Too little, offered too late, with the wrong tone. The floor empties.' } },
      { label: 'Break the union', desc: 'Fire the organizers, hire scabs.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 50, attrs: { profit: 1, morale: -2, danger: 2 }, note: 'The strike collapses. The silence on the floor is expensive in other ways.' },
        fail: { cash: -200, attrs: { morale: -3, marketing: -1, personnel: -2 }, note: 'The district boycotts the scab shop. The court of public opinion is harsh.' } },
      { label: 'Arbitrate with a neutral', desc: 'Both sides swear to abide by the word of a respected third party.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, attrs: { morale: 1 }, note: 'A modest raise, a real grievance box, and everyone back to work by noon.' },
        fail: { cash: -100, attrs: { morale: -2 }, note: 'The arbitration splinters; both sides claim betrayal.' } }] },
  { id: 'ps_wagetheft', cat: 'personnel', w: 2, deadline: 2, title: 'The Wage Purse Rumor',
    text: 'Someone whispers the foreman skims the wage purse. The crew\'s eyes narrow.',
    solutions: [
      { label: 'Audit the purse together', desc: 'Open books, open counting.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 1 }, note: 'The purse is clean — the foreman weeps with relief, the crew relaxes.' },
        fail: { cash: -80, attrs: { morale: -2 }, note: 'The purse is short and now everyone knows. The foreman is gone by Friday.' } },
      { label: 'Set a trap for the rumor', desc: 'Mark the coins and watch where the story walks.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { attrs: { leadership: 2 }, note: 'The "honest" complainant is caught with marked coin. The crew\'s trust actually grows.' },
        fail: { attrs: { morale: -2, leadership: -1 }, note: 'The trap nets nothing and the suspicion festers.' } },
      { label: 'Dismiss the whispers', desc: 'No comment, back to work.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The rumor starves without fuel.' },
        fail: { attrs: { morale: -3, personnel: -1 }, note: 'Unanswered, the whisper becomes gospel. Two good hands quit over it.' } }] },
  { id: 'ps_contagion', cat: 'personnel', w: 2, deadline: 1, title: 'Contagion in the Dorm',
    text: 'Half the crew sleeps above the shop, and something chesty is moving through the bunks.',
    solutions: [
      { label: 'Hire a physicker', desc: 'Real medicine, paid by the house.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -90, attrs: { morale: 2, personnel: 1 }, note: 'Sick pay and a real doctor. The crew will remember this when the next offer comes.' },
        fail: { cash: -120, attrs: { personnel: -2, morale: -1 }, note: 'The physicker arrives to find the dorm half-empty and half-fevered.' } },
      { label: 'Quarantine the dorm', desc: 'Seal it, fumigate it, pay for lodgings elsewhere.', pool: 'intellect', skill: 'none', asset: 1, steps: 2,
        success: { cash: -60, attrs: { personnel: 1, danger: -1 }, note: 'The contagion dies in an empty room. Nobody else falls.' },
        fail: { cash: -100, attrs: { personnel: -3 }, note: 'Too slow; the sickness jumps to the day shift.' } },
      { label: 'Work through it', desc: 'It\'s a cold. People work through colds.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -30, note: 'A miserable week, a survived plague (probably).' },
        fail: { cash: -80, attrs: { personnel: -3, morale: -2 }, note: 'It was not a cold. Half the crew is bedridden by the weekend.' } }] },
  { id: 'ps_apprentice', cat: 'personnel', w: 3, deadline: 2, title: 'Apprentice Uprising',
    text: 'The apprentices demand real instruction, real wages, or they walk en masse.',
    solutions: [
      { label: 'Formalize the apprenticeship', desc: 'A curriculum, a stipend, a path to journeyman.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -70, attrs: { personnel: 2, morale: 1 }, note: 'The apprentices become the house\'s best advertisement — trained here, loyal here.' },
        fail: { cash: -90, attrs: { personnel: -1 }, note: 'The program is half-hearted and everyone smells it.' } },
      { label: 'Call their bluff', desc: 'The door is open. So is the hiring hall.', pool: 'intellect', skill: 'specialized', asset: 0, steps: 2,
        success: { cash: 40, attrs: { profit: 1 }, note: 'Half stay. The other half discover the hiring hall pays worse. They ask to return.' },
        fail: { cash: -120, attrs: { personnel: -3, morale: -2 }, note: 'It was not a bluff. The apprentices walk and the trade secrets walk with them.' } },
      { label: 'One grand gesture', desc: 'A masterclass, a banquet, a raise.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -100, attrs: { morale: 2 }, note: 'Bread, circuses, and a five percent raise. The uprising becomes a party.' },
        fail: { cash: -100, attrs: { morale: -1 }, note: 'The gesture reads as panic. The apprentices learn the house can be squeezed.' } }] },
  { id: 'ps_hiring', cat: 'personnel', w: 3, deadline: 2, title: 'The Hiring Fair',
    text: 'Seasonal labor fair in the square — every house in the district is fishing from the same pond, and your lines are short-handed.',
    solutions: [
      { label: 'Outbid the other houses', desc: 'Wages, signing bonuses, a hot meal at the gate. Money talks.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -80, hireWorkers: 3, attrs: { personnel: 1 }, note: 'Three solid hands sign before noon. The other houses glare across the square.' },
        fail: { cash: -120, hireWorkers: 1, attrs: { morale: -1 }, note: 'You pay top coin but the best workers already signed elsewhere. One straggler joins, overpaid.' } },
      { label: 'Sell the house\'s reputation', desc: 'No bonus — but show them the workshop, the dorm, the pay ledger.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { hireWorkers: 2, attrs: { morale: 1 }, note: 'Two experienced hands choose steady work over flash coin. They start Monday.' },
        fail: { hireWorkers: 1, attrs: { marketing: -1 }, note: 'The pitch lands flat; only a greenhorn believes it. Word is the house is cheap.' } },
      { label: 'Poach a rival\'s crew', desc: 'Find their disgruntled and make an offer at the tavern.', pool: 'speed', skill: 'specialized', asset: 1, steps: 2,
        success: { hireWorkers: 2, attrs: { profit: 1 }, competitorStrength: { target: 'strongest', delta: 1 }, note: 'Two of the rival\'s best defect by lantern-light. Their house notices — and remembers.' },
        fail: { attrs: { marketing: -1, morale: -1 }, note: 'The rival\'s foreman was listening at the next table. The district hears the house poaches.' } }] },
  { id: 'ps_foreman', cat: 'personnel', w: 2, deadline: 2, title: 'The Foreman Dies',
    text: 'The heart of the floor crew stops in the night. The work, and the crew, stop with him.',
    solutions: [
      { label: 'Promote from within', desc: 'The senior hand knows the floor best.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { personnel: 1, morale: 1 }, note: 'The crew rallies around one of their own. The funeral is paid for, the work resumes.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'The promotion splits the crew — half think the wrong hand got it.' } },
      { label: 'Hire a professional manager', desc: 'Credentials over sentiment.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -60, attrs: { profit: 2 }, note: 'The new foreman squeezes a fifth more work from the same hands.' },
        fail: { cash: -100, attrs: { morale: -3 }, note: 'The outsider knows spreadsheets, not people. The floor seethes.' } },
      { label: 'Run the floor yourself', desc: 'Management descends to the workbench.', pool: 'speed', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 2, leadership: 1 }, note: 'Boss on the floor earns respect and real knowledge of how the sausage is made.' },
        fail: { attrs: { profit: -2, morale: -1 }, note: 'Management is bad at the floor and the floor is bad at management.' } }] },
  { id: 'ps_talent', cat: 'personnel', w: 3, deadline: 2, title: 'Hidden Talent',
    text: 'The quiet wagon-loader writes poetry that patrons would pay for. Or sings. Or invents.',
    solutions: [
      { label: 'Promote and showcase', desc: 'Talent on the floor is talent wasted.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { marketing: 2, morale: 2 }, note: 'The house\'s name rides on the kid\'s gift. Everyone wins.' },
        fail: { attrs: { morale: -1 }, note: 'The spotlight burns the talent and they retreat back under a wagon cover.' } },
      { label: 'Sell the discovery', desc: 'A patron pays well for prodigies.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 200, attrs: { marketing: 1 }, note: 'The patron funds the talent; the house takes the finder\'s fee and the credit.' },
        fail: { cash: -60, attrs: { morale: -2 }, note: 'The crew learns the house sells its own. Trust, once sold, is hard to rebuy.' } },
      { label: 'Leave them be', desc: 'Not every gift needs a stage.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The loader keeps loading, the poems keep coming, the floor stays calm.' },
        fail: { attrs: { morale: -1 }, note: 'A rival house discovers the talent first and buys it for a pittance.' } }] },
  { id: 'ps_brawl', cat: 'personnel', w: 3, deadline: 1, title: 'Brawl on the Floor',
    text: 'Two crews, one staircase, an argument about a card game. Now there\'s blood on the sawdust.',
    solutions: [
      { label: 'Both sides pay', desc: 'Fines, apologies, back to work.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -30, attrs: { morale: 1 }, note: 'Justice is swift and symmetrical. The card game is banned, peace returns.' },
        fail: { cash: -80, attrs: { morale: -2 }, note: 'The fines read as favoritism. The feud simmers under the floorboards.' } },
      { label: 'Channel it', desc: 'A boxing evening, house teams, wagers.', pool: 'speed', skill: 'trained', asset: 0, steps: 2,
        success: { cash: 100, attrs: { morale: 2, marketing: 1 }, note: 'The grudge becomes the district\'s favorite sporting event. The house takes the gate.' },
        fail: { cash: -50, attrs: { personnel: -2, morale: -1 }, note: 'The boxing evening rekindles the brawl at larger scale. Furniture dies.' } },
      { label: 'Dismiss the worst', desc: 'Examples are instructive.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { personnel: -0, danger: -1 }, fireWorst: true, note: 'The ringleader is gone by morning. The floor exhales.' },
        fail: { attrs: { morale: -3 }, note: 'Fired the wrong one. The crew loved that one. The other one stays and smirks.' } }] },
  { id: 'ps_refugees', cat: 'personnel', w: 2, deadline: 2, title: 'The Migration Wind',
    text: 'War or famine upstream sends a tide of desperate, capable people through the district.',
    solutions: [
      { label: 'Hire the willing', desc: 'Cheap, grateful, skilled labor.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -40, attrs: { personnel: 2, profit: 1 }, note: 'The newcomers work like the desperate do. The house prospers on fair wages.' },
        fail: { cash: -80, attrs: { morale: -1 }, note: 'The hiring is haphazard; some jewels, some dross, some trouble.' } },
      { label: 'Set up a hiring hall', desc: 'Organize the tide for other houses too.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 150, attrs: { marketing: 2, leadership: 1 }, note: 'The house becomes the district\'s front door. Everyone owes a favor.' },
        fail: { cash: -100, attrs: { danger: 1 }, note: 'The hall attracts con artists, pickpockets, and one very organized gang.' } },
      { label: 'Turn them away', desc: 'No room, no risk.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The tide passes. The house is unchanged.' },
        fail: { attrs: { marketing: -1, morale: -1 }, note: 'The rivals hire the tide. Next season their floors hum and this one doesn\'t.' } }] },
  { id: 'ps_oldhand', cat: 'personnel', w: 2, deadline: 2, title: 'The Old Hand\'s Eyes',
    text: 'Berta has packed crates on this floor for thirty years. This week she misreads a label for the third time, and the whole crew is quietly watching what the house does about it.',
    solutions: [
      { label: 'A desk by the door', desc: 'Move her to greeting customers — honor, not exile.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -60, attrs: { personnel: 2, morale: 1 }, note: 'The crew sees loyalty repaid and works like it. Berta knows every customer by name.' },
        fail: { cash: -100, attrs: { morale: -1 }, note: 'The "desk" is obviously make-work and everyone sees it — especially Berta.' } },
      { label: 'One honest conversation', desc: 'A golden handshake and a proper farewell.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -100, attrs: { morale: 2, leadership: 1 }, note: 'A farewell feast, a real pension, and a story the crew tells for years.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'The talk goes badly, as it always does. She leaves mid-shift; two friends go with her.' } },
      { label: 'Look the other way', desc: 'She\'s earned a few bad labels.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The floor quietly covers for her. It holds — this time.' },
        fail: { attrs: { personnel: -1, morale: -1 }, note: 'A mislabeled crate reaches a very important customer. The floor stops covering.' } }] },
  { id: 'ps_grumble', cat: 'personnel', w: 3, deadline: 1, title: 'Grumble in the Ranks',
    text: 'It starts small — cold porridge, a missing stool, a joke that isn\'t a joke. Grievances compound quietly, and the foreman is either deaf or frightened.',
    solutions: [
      { label: 'Walk the floor and listen', desc: 'Stools, porridge, and whatever else surfaces.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -25, attrs: { morale: 2 }, note: 'Stools ordered, porridge thickened, one bully reassigned. The grumbling dies of accuracy.' },
        fail: { cash: -40, attrs: { morale: -1 }, note: 'The listening tour hears what it wants to hear. The porridge stays cold.' } },
      { label: 'Buy the grievance out', desc: 'A surprise bonus quiets any floor.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -120, attrs: { morale: 2, personnel: 1 }, note: 'Generosity lands. The house\'s name for paying well spreads past the district.' },
        fail: { cash: -120, attrs: { morale: -1 }, note: 'Paid grumblers learn that grumbling pays. The noise resumes at a slightly higher rate.' } },
      { label: 'Ignore it', desc: 'Background noise. It\'s always background noise.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The grumbling crests and subsides on its own, like weather.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'Unheard grumbles calcify into a list of demands, delivered by the whole floor at once.' } }] },
  { id: 'ps_masterclass', cat: 'personnel', w: 2, deadline: 2, title: 'The Master\'s Masterclass',
    text: 'A master of the trade passes through the district — the kind of name that fills a workshop by whisper alone. For a fee, she\'ll spend three days with the crew.',
    solutions: [
      { label: 'Pay the fee', desc: 'Coin for craft. The oldest trade there is.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -100, attrs: { personnel: 2 }, note: 'Three days of secrets the crew will unpack for a year. Hands visibly improve by Friday.' },
        fail: { cash: -100, attrs: { morale: -1 }, note: 'The fee is paid and the master spends three days mostly praising her own work.' } },
      { label: 'Barter a season', desc: 'Host and assist her for a season in exchange for the teaching.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -40, attrs: { personnel: 2, marketing: 1 }, note: 'The crew learns daily while the district watches the house host a legend.' },
        fail: { cash: -60, attrs: { morale: -1 }, note: 'A season of servitude to a perfectionist. The crew learns only dread, thoroughly.' } },
      { label: 'Send one promising hand', desc: 'Back the brightest worker\'s apprenticeship.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -30, attrs: { personnel: 1 }, note: 'The chosen hand returns changed and teaches the others for free out of pure zeal.' },
        fail: { cash: -30, note: 'The chosen hand quits to follow the master. The investment walks out the door wearing new boots.' } }] },
  { id: 'ps_gambling', cat: 'personnel', w: 2, deadline: 1, title: 'Payday at the Gaming Table',
    text: 'A slick new gaming den opens two doors down. By the second week, half the crew\'s wages are cycling through its tables before the coins cool.',
    solutions: [
      { label: 'Buy the debt ledgers', desc: 'Own the house\'s debts so the den\'s hooks come out of crew flesh.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -80, attrs: { morale: 1, danger: -1 }, note: 'The debts quietly dissolve. The crew never learns who paid — but the floor feels lighter.' },
        fail: { cash: -120, attrs: { personnel: -1 }, note: 'The ledgers are bought but the tables stay open; the crew resents the meddling AND keeps gambling.' } },
      { label: 'Wages in kind', desc: 'Room, board and chits — coin never reaches the table.', pool: 'intellect', skill: 'trained', asset: 0, steps: 2,
        success: { cash: -50, attrs: { personnel: 1 }, note: 'Coin never reaches the table; the gaming den folds within the month for lack of fish.' },
        fail: { cash: -40, attrs: { morale: -2 }, note: 'The crew despises scrip. Productivity dips out of pure, principled spite.' } },
      { label: 'Look away', desc: 'Grown hands spend their own coin.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'A few emptied purses; the crew learns or it doesn\'t.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'Two desperate hands are caught covering their debts from the till. The trust is the casualty.' } }] },
  { id: 'ps_overtime', cat: 'personnel', w: 3, deadline: 1, title: 'The Double Order',
    text: 'Two great orders land in the same week and both customers pay on delivery. The crew can fill one. Maybe both, if nobody sleeps.',
    solutions: [
      { label: 'Promise overtime pay', desc: 'Lamps burn late and the lamps get paid.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -90, attrs: { profit: 2, morale: 1 }, note: 'Both orders ship. The premium pay sweetens the fatigue and the customer\'s deposit fattens the ledger.' },
        fail: { cash: -60, attrs: { morale: -2, personnel: -1 }, note: 'The overtime is promised and underpaid. Exhausted crews notice arithmetic too.' } },
      { label: 'Hire temp hands', desc: 'Day laborers for the crunch.', pool: 'speed', skill: 'none', asset: 0, steps: 1,
        success: { cash: -70, hireWorkers: 1, attrs: { profit: 1 }, note: 'A scrappy labor crew bulks the line — and one of them is genuinely worth keeping on.' },
        fail: { cash: -100, attrs: { personnel: -1 }, note: 'The temps are worse than nothing. Rework eats the profit and a week of goodwill.' } },
      { label: 'Decline the smaller order', desc: 'Ship one perfectly, apologize artfully.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { marketing: 1 }, note: 'The shipped order lands flawlessly; the declined customer files the name under "reliable".' },
        fail: { attrs: { marketing: -1, profit: -1 }, note: 'Declined too late and waffled too openly — both customers walk, unimpressed.' } }] },
  { id: 'ps_champion', cat: 'personnel', w: 2, deadline: 2, title: 'The Worker\'s Champion',
    text: 'One voice has risen from the floor crew — literate, fearless, and genuinely beloved. The crew brings her their problems now. Management did not appoint her.',
    solutions: [
      { label: 'Promote her', desc: 'Foreman track, real authority, no ambiguity.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -30, attrs: { personnel: 2, morale: 1 }, note: 'Legitimacy turns a rival voice into the house\'s best instrument. The floor polices itself now.' },
        fail: { attrs: { morale: -1 }, note: 'The promotion is read as a muzzle. She declines it, in public, with a prepared speech.' } },
      { label: 'Discredit her', desc: 'A whisper campaign: troublemaker, agitator, thief of hours.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { personnel: -1 }, note: 'The whispers stick and the voice quiets. The crew\'s trust in the house thins by exactly one layer, permanently.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'The smear backfires spectacularly — she carries the crew\'s sympathy and the story to every tavern in the district.' } },
      { label: 'Partner with her', desc: 'Grievance box, monthly hearing, shared porridge budget.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 2, personnel: 1 }, note: 'The champion becomes the bridge between floor and office. Complaints arrive before they ferment.' },
        fail: { cash: -40, attrs: { morale: -1 }, note: 'The partnership produces meetings, minutes, and no measurable porridge improvement.' } }] },
  { id: 'ps_sickbed', cat: 'personnel', w: 3, deadline: 2, title: 'The Sickbed',
    text: 'Marta doesn\'t come in. The neighbor sends word: a fever that burns and breaks and burns again. The floor can cover her shifts — for a while.',
    solutions: [
      { label: 'Pay for the good physicker', desc: 'Real medicine, house coin, no questions.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -80, workerMorale: 1, note: 'The physicker\'s draughts work. Marta returns gaunt and devoted; the floor knows who paid.' },
        fail: { cash: -80, attrs: { personnel: -1, morale: -1 }, note: 'The fever wins anyway. The house pays for the funeral and works a hand short.' } },
      { label: 'Cover her shifts in rotation', desc: 'Everyone takes a slice of her week.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 1, personnel: 1 }, note: 'The crew covers Marta without being asked twice. She comes back to a floor that guarded her post.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'A month of double shifts frays everyone; someone else collapses by the third week.' } },
      { label: 'Bring light work to her bedside', desc: 'Labels, stitching, tallying — keep her in the loop.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -20, attrs: { personnel: 1 }, note: 'She stitches labels from her sickbed and the floor visits daily. The convalescence has company.' },
        fail: { attrs: { personnel: -1, morale: -1 }, note: 'Three visitors catch it before anyone thinks to stop the visits. The dorm has opinions.' } }] },
  { id: 'ps_baby', cat: 'personnel', w: 2, deadline: 3, title: 'The Expectant Hand',
    text: 'Sera is expecting — well into it now. She isn\'t asking permission; she\'s telling the house, because the floor already knows, and because someone must plan for the months she won\'t be on the line.',
    solutions: [
      { label: 'Paid leave, her post held', desc: 'The right thing, done out loud.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, attrs: { personnel: 2, morale: 2 }, note: 'The floor sees the house do right by one of its own. Sera comes back; the story stays told.' },
        fail: { cash: -60, attrs: { morale: -1 }, note: 'The promise is real but the paperwork eats it — half pay for half the leave, and everyone does the math.' } },
      { label: 'Cover the line, hire a temp', desc: 'A substitute for the months, coin for the cover.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -40, hireWorkers: 1, note: 'The temp covers beautifully and is worth keeping on when Sera returns — the floor gains a pair of hands.' },
        fail: { cash: -100, attrs: { personnel: -1 }, note: 'The temp is a disaster. The line limps for a season and the cover costs more than the wages saved.' } },
      { label: 'A quiet gift, no fuss', desc: 'Coin, discretion, no ceremony.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 1 }, note: 'The house marks it with a purse and blessedly little ceremony. Sera is grateful for the lack of fuss.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'No fuss reads as no care. She does not return after the birth, and the floor notices that too.' } }] },
  { id: 'ps_injury', cat: 'personnel', w: 3, deadline: 1, title: 'The Broken Arm',
    text: 'The loading pulley shears mid-haul. Borta is lucky — the crate misses her head by a handspan — but her arm breaks clean in two places, and the floor goes quiet.',
    solutions: [
      { label: 'Best chirurgeon, wages continue', desc: 'The good bone-setter and no lost pay.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -90, attrs: { personnel: 2, morale: 1 }, note: 'The arm mends straight and the wages never stop. The floor files this under "why we stay".' },
        fail: { cash: -90, attrs: { personnel: -1 }, note: 'The arm mends crooked. She keeps a desk forever after; the coin is remembered even where the medicine failed.' } },
      { label: 'The cheap bone-setter', desc: 'A lane-side splint and strong drink.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -30, attrs: { personnel: 1 }, note: 'Cheap but competent. She heals; the scar tells stories at the bench.' },
        fail: { cash: -60, attrs: { morale: -2, personnel: -1 }, note: 'The set fails and must be broken and reset. The floor learns precisely what a worker\'s arm is worth here.' } },
      { label: 'Blame her carelessness', desc: 'The insurer likes a tidy story; dock her pay.', pool: 'intellect', skill: 'trained', asset: 0, steps: 2,
        success: { cash: 30, attrs: { danger: 1, morale: -1 }, note: 'The claim is denied in the house\'s favor. The floor\'s silence on the matter is its own ledger entry.' },
        fail: { attrs: { morale: -3, personnel: -1 }, note: 'The floor closes ranks against the house. Work slows to a strict, deliberate, devastating rule.' } }] },
  { id: 'ps_wedding', cat: 'personnel', w: 2, deadline: 2, title: 'The Wedding Bell',
    text: 'Tess is marrying the cooper\'s second, and the whole floor is invited. The question nobody says aloud: does the house celebrate with them, or merely notice the empty benches?',
    solutions: [
      { label: 'Fund the feast', desc: 'Roast, fiddlers, and the house\'s name on the banner.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -70, attrs: { morale: 2, marketing: 1 }, note: 'The house toasts the couple in front of half the district. Everyone knows who paid; everyone approves.' },
        fail: { cash: -70, attrs: { morale: -1 }, note: 'The feast is funded but the speeches run long. The floor mostly remembers the hangover and the bill.' } },
      { label: 'The gift day', desc: 'The whole floor off, with pay, to see her wed.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -50, attrs: { morale: 2, personnel: 1 }, note: 'One lost day of work buys a season of goodwill and a bridesmaid roster drawn from the packing line.' },
        fail: { cash: -50, attrs: { profit: -1 }, note: 'The day off costs a delivery deadline. The customer is unmoved by romance.' } },
      { label: 'It\'s their private matter', desc: 'Business as usual; grown people manage their own lives.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The couple celebrates modestly; the floor covers the shift without complaint. Life goes on, evenly.' },
        fail: { attrs: { morale: -2 }, note: 'The floor attends anyway — unpaid, out of loyalty to her, and quietly resentful of the ledger that kept them.' } }] },
  { id: 'ps_heaviness', cat: 'personnel', w: 2, deadline: 2, title: 'The Quiet One',
    text: 'Tam stops humming. Then stops joking. Then stops meeting anyone\'s eyes at the bench. The work still gets done — slower, quieter, like a door closing one hinge at a time.',
    solutions: [
      { label: 'Notice early, lighten the load', desc: 'Lighter duties, no questions asked, no names named.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { morale: 2, personnel: 1 }, note: 'The floor never names it; the load just lightens for a while. Tam hums again by the new moon.' },
        fail: { attrs: { morale: -1 }, note: 'The lighter duties are noticed and misread as favoritism by two others. The kindness needs explaining it never wanted.' } },
      { label: 'The listening walk', desc: 'Someone senior walks him home, the long way.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 1, personnel: 1 }, note: 'Talk helps unevenly, like rain. He stays. The bench stays his.' },
        fail: { attrs: { morale: -1, personnel: -1 }, note: 'He quits rather than be walked home again. The floor is quiet for weeks, and not the good kind.' } },
      { label: 'Push through it', desc: 'Deadlines don\'t care about moods.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: 20, attrs: { profit: 1 }, note: 'The order ships. He does not celebrate with the others. The ledger shows a week; the bench shows a winter.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'He stops coming. The bench sits empty, and nobody touches his tools for a month out of something the house never asked about.' } }] },

  // ═══ COMPETITION — rivals never sleep ═══
  { id: 'cp_pricewar', cat: 'competition', w: 3, deadline: 2, title: 'Price War',
    text: 'The rival across the street halves prices. The street notices. So does the margin.',
    solutions: [
      { label: 'Match the prices', desc: 'Lean weeks, but the customers stay.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -80, attrs: { marketing: 1 }, note: 'The rival blinks first. The customers stayed through the storm.' },
        fail: { cash: -200, attrs: { profit: -1 }, note: 'Both sides bleed; the rival bleeds slower. They have deeper pockets.' } },
      { label: 'Undercut and outlast', desc: 'Win the war at a loss, win the peace forever.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 100, attrs: { marketing: 2, profit: 1 }, note: 'The rival\'s shop changes hands. This house sets the prices now.' },
        fail: { cash: -300, attrs: { profit: -2, marketing: -1 }, note: 'Outspent in a war of attrition. The victor buys the wreckage cheap.' } },
      { label: 'Sell quality, not price', desc: 'Cheap is a race to the floor. Good is a moat.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { marketing: 2, profit: 1 }, note: 'The regulars return to quality; the rival\'s bargain crowd is fickle.' },
        fail: { cash: -100, attrs: { marketing: -1 }, note: 'Quality costs money; the price-sensitive street shrugs and keeps crossing the road.' } }] },
  { id: 'cp_smear', cat: 'competition', w: 3, deadline: 1, title: 'Smear Campaign',
    text: 'Pamphlets, ballads, and a very creative caricaturist. The rival is buying a bad reputation for this house.',
    solutions: [
      { label: 'Sue for libel', desc: 'The law is slow but it leaves marks.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -50, attrs: { marketing: 1 }, note: 'A public retraction, printed in the rival\'s preferred typeface.' },
        fail: { cash: -120, attrs: { marketing: -2 }, note: 'The case drags; the caricatures multiply; the public forgets which house is which.' } },
      { label: 'Counter-smear', desc: 'Their house has skeletons too. Rent a poet.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { marketing: 2 }, note: 'The district is entertained for a month. Both houses survive; only one is embarrassed.' },
        fail: { cash: -100, attrs: { marketing: -2, danger: 1 }, note: 'The rival\'s lawyers are better. The house ends up the villain of the ballad.' } },
      { label: 'Rise above it', desc: 'Quality is the only rebuttal that lasts.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { marketing: 1, morale: 1 }, note: 'Regulars defend the house unprompted. The smears curdle into sympathy.' },
        fail: { attrs: { marketing: -2 }, note: 'Silence reads as guilt. The story sticks like wet paper.' } }] },
  { id: 'cp_talentraid', cat: 'competition', w: 2, deadline: 1, title: 'Talent Raid',
    text: 'A rival offers double wages to anyone who walks. Two already packed.',
    solutions: [
      { label: 'Golden handcuffs', desc: 'Retention bonuses, profit shares.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -100, attrs: { personnel: 1, morale: 1 }, note: 'The ones who stayed feel valued. The ones who left are not missed as much as feared.' },
        fail: { cash: -80, attrs: { personnel: -2 }, note: 'The bonus is too small, too late. The walkout continues.' } },
      { label: 'Raid them back', desc: 'Their people have grievances too.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { attrs: { personnel: 2, profit: 1 }, note: 'The rival\'s best foreman comes over with three journeymen and several recipes.' },
        fail: { cash: -120, attrs: { danger: 1, morale: -1 }, note: 'The raid backfires; the rival secures their people and takes two more of yours.' } },
      { label: 'Tighten the family', desc: 'Wages are not the only chain.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 2 }, note: 'Feasts, recognition, a house that feels like a house. Money loses the argument.' },
        fail: { attrs: { personnel: -1, morale: -1 }, note: 'Sentiment loses to arithmetic. The best accountant leaves.' } }] },
  { id: 'cp_muscle', cat: 'competition', w: 2, deadline: 1, title: 'Territory Muscle',
    text: 'A protection crew loyal to a rival starts loitering. The message is clear and so is the baseball bat.',
    solutions: [
      { label: 'Pay the unofficial tax', desc: 'Cheaper than broken windows.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -80, note: 'The loiterers nod politely. For now, that\'s the whole cost.' },
        fail: { cash: -150, attrs: { danger: 2 }, note: 'Paid once, and now the tax has a schedule and a collector with a ledger.' } },
      { label: 'Hire bigger muscle', desc: 'Answer the bat with a bigger bat.', pool: 'speed', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -60, attrs: { danger: -1 }, note: 'The loiterers find somewhere else to loiter. The bigger bat costs more than the tax but less than the shame.' },
        fail: { cash: -120, attrs: { personnel: -2, danger: 2 }, note: 'The escalation escalates. Someone\'s window breaks and it\'s this one.' } },
      { label: 'Go to the watch', desc: 'Law is cheaper than muscle.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { danger: -1, marketing: 1 }, note: 'The watch sweeps the corner. The house gets a reputation as a lawful house.' },
        fail: { cash: -70, attrs: { danger: 2 }, note: 'The watch is paid by the rival to see nothing. Now the house is a snitch AND a target.' } }] },
  { id: 'cp_buyout', cat: 'competition', w: 2, deadline: 2, title: 'The Buyout Offer',
    text: 'A consortium offers twice the value of the house. Cash, tonight, no questions.',
    solutions: [
      { label: 'Refuse with ceremony', desc: 'Some things are not for sale.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 2, marketing: 1 }, note: 'The refusal becomes legend. The crew walks taller; the district buys more.' },
        fail: { cash: -60, attrs: { morale: -1 }, note: 'Privately, some of the officers wonder what their shares were worth.' } },
      { label: 'Counter at three times', desc: 'Everything is for sale at the right price.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 500, note: 'They pay. The house changes hands; the founders retire to the coast with a fortune.' },
        fail: { cash: -100, attrs: { leadership: -1 }, note: 'The bluff is called. They withdraw the offer and buy a rival instead.' } },
      { label: 'Sell a minority stake', desc: 'Take the money, keep the wheel.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 200, attrs: { profit: 1 }, note: 'Capital without chains. The consortium invests and mostly stays out of the way.' },
        fail: { cash: 150, attrs: { leadership: -1, danger: 1 }, note: 'The minority stake becomes a wedge. They want the rest, eventually, and they are patient.' } }] },
  { id: 'cp_spy', cat: 'competition', w: 2, deadline: 2, title: 'Spy in the Ranks',
    text: 'A recipe, a ledger page, a whispered margin — someone is feeding the rival the house\'s secrets.',
    solutions: [
      { label: 'Feed them lies', desc: 'Poison the well carefully.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { marketing: 2, leadership: 1 }, note: 'The rival launches a copy of a product that doesn\'t work. The laughter is audible.' },
        fail: { cash: -100, attrs: { morale: -1 }, note: 'The spy notices the bait and doubles their discretion.' } },
      { label: 'Hunt them down', desc: 'Trust narrows; watch widens.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { leadership: 1 }, note: 'Caught copying the dye recipe. Dismissed without reference; the rival loses its eyes.' },
        fail: { attrs: { morale: -2 }, note: 'The hunt turns the floor into a courtroom. The spy stays hidden; the trust is the casualty.' } },
      { label: 'Codify the secrets', desc: 'Compartments, ciphers, need-to-know.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { profit: 1 }, note: 'The spy finds only fragments now. The house\'s real edge lives in fewer hands.' },
        fail: { cash: -80, attrs: { morale: -1 }, note: 'The compartmentalization slows the work more than it slows the spy.' } }] },
  { id: 'cp_cartel', cat: 'competition', w: 2, deadline: 2, title: 'The Cartel Forms',
    text: 'The rivals stop competing with each other and start competing with this house, together.',
    solutions: [
      { label: 'Join the cartel', desc: 'If you can\'t beat a monopoly, hold a share of it.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 120, attrs: { profit: 1, danger: 1 }, note: 'Stable prices, divided territory. Profitable, and one moral compromise heavier.' },
        fail: { cash: -100, attrs: { marketing: -1 }, note: 'The cartel takes the house\'s share and gives back rules.' } },
      { label: 'Break the cartel', desc: 'Report it, undercut it, wait for greed.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { marketing: 2, profit: 1 }, note: 'Cartels rot from within. The first defector gets the house\'s protection and the others scatter.' },
        fail: { cash: -200, attrs: { profit: -2, danger: 2 }, note: 'The cartel crushes the holdout with coordinated predatory pricing.' } },
      { label: 'Find a niche', desc: 'Cartels control the street, not the rooftops.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { profit: 1, marketing: 1 }, note: 'A specialty the cartel doesn\'t bother with becomes a moat the cartel can\'t cross.' },
        fail: { cash: -80, attrs: { marketing: -1 }, note: 'The niche turns out to be a rut.' } }] },
  { id: 'cp_dupe', cat: 'competition', w: 3, deadline: 1, title: 'The Dupe Product',
    text: 'A rival ships a knockoff of the house\'s signature at half price. It\'s worse. It\'s also half price.',
    solutions: [
      { label: 'Sue', desc: 'The design is protected. Probably.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -50, attrs: { marketing: 1 }, note: 'The dupe is barred from the market. The house\'s design is officially, legally, its own.' },
        fail: { cash: -120, attrs: { marketing: -1 }, note: 'The protection turns out to be parchment. The dupe sells on.' } },
      { label: 'Out-innovate', desc: 'Make the copy obsolete before it ships.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 150, attrs: { marketing: 2, profit: 1 }, note: 'Version three launches while the rival is still copying version one.' },
        fail: { cash: -150, attrs: { profit: -1 }, note: 'The rushed redesign flops. The dupe looks reliable by comparison.' } },
      { label: 'Warn the customers', desc: 'Point at the seams. Laugh in public.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { marketing: 2 }, note: 'A public demonstration: the dupe falls apart on stage. The house\'s name becomes a byword for the real thing.' },
        fail: { attrs: { marketing: -1 }, note: 'The demonstration backfires — the dupe holds, the crowd laughs at the house instead.' } }] },

  // ═══ FACILITY — walls, roofs, boilers ═══
  { id: 'fc_collapse', cat: 'facility', w: 2, deadline: 1, title: 'Roof Collapse',
    text: 'A beam gives up in the night. Rain gets in, and so does the street\'s opinion of the house.',
    solutions: [
      { label: 'Emergency repairs', desc: 'Scaffolding, carpenters, tarpaulins.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -100, facilityCondition: 10, note: 'Ugly but watertight. The work continues under canvas.' },
        fail: { cash: -180, facilityCondition: -15, attrs: { personnel: -1 }, note: 'The patch fails in the next rain. Inventory and morale both drown.' } },
      { label: 'Rebuild better', desc: 'A collapsed beam is an argument for a better roof.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -200, facilityCondition: 20, attrs: { marketing: 1 }, note: 'The new roof is the talk of the street — glass panels, iron trusses, light where darkness was.' },
        fail: { cash: -300, attrs: { profit: -1 }, note: 'The rebuild overruns and the house trades from a tent for a month.' } },
      { label: 'Patch and deny', desc: 'It\'s a small hole. It\'s always been a small hole.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -40, note: 'The patch holds. Probably.' },
        fail: { cash: -120, facilityCondition: -10, attrs: { marketing: -1 }, note: 'The patch doesn\'t hold. Neither do the customers\' nerves.' } }] },
  { id: 'fc_boiler', cat: 'facility', w: 2, deadline: 1, title: 'The Boiler Horror',
    text: 'The great boiler knocks like a giant\'s fist and smells of scorched iron. It is going to fail. Soon.',
    solutions: [
      { label: 'Replace it', desc: 'The expensive, correct, boring answer.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -150, facilityCondition: 15, note: 'New boiler, quiet pipes, hot water on demand. Boring is beautiful.' },
        fail: { cash: -200, attrs: { personnel: -1 }, note: 'The old boiler dies before the new one arrives. A cold, angry week.' } },
      { label: 'Patch it yourself', desc: 'It\'s just a valve. Probably. Probably just a valve.', pool: 'speed', skill: 'trained', asset: 0, steps: 2,
        success: { cash: -50, note: 'The knocking stops. The person who stopped it is promoted to "boiler whisperer."' },
        fail: { cash: -150, facilityCondition: -20, attrs: { personnel: -2 }, note: 'It was not just a valve. The scald ward at the temple knows the crew by name now.' } },
      { label: 'Shut it down', desc: 'Cold floors until the engineer arrives.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, note: 'Chilly but safe. The engineer\'s bill is half the price of the alternative.' },
        fail: { cash: -100, attrs: { morale: -2 }, note: 'Three cold weeks. The crew works in coats and complains in verse.' } }] },
  { id: 'fc_vermin', cat: 'facility', w: 3, deadline: 2, title: 'Vermin Bloom',
    text: 'Rats. In the walls. In the grain. In a customer\'s hat, briefly.',
    solutions: [
      { label: 'Hire the ratcatcher', desc: 'Professionals with ferrets and traps.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, note: 'The ferrets earn their keep. The grain is safe and the hat incident is forgotten.' },
        fail: { cash: -100, attrs: { marketing: -1 }, note: 'The rats are canny; the ratcatcher is not. The bloom continues.' } },
      { label: 'The great purge', desc: 'Tear out the walls, fumigate everything, rebuild.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -120, facilityCondition: 10, attrs: { marketing: 1 }, note: 'Not a creature stirring, and the renovated storero is the cleanest in the district.' },
        fail: { cash: -220, attrs: { marketing: -1, profit: -1 }, note: 'The purge closes the floor for a week and the rats simply move to the annex.' } },
      { label: 'Buy a terrier', desc: 'Every storeroom should have a dog.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -20, attrs: { morale: 1 }, note: 'The terrier is a hero. The crew names a drink after her.' },
        fail: { cash: -60, attrs: { marketing: -1 }, note: 'The terrier sleeps on the job; the rats unionize.' } }] },
  { id: 'fc_flood', cat: 'facility', w: 2, deadline: 1, title: 'The Cellar Floods',
    text: 'The river is up and the cellar is a cistern. Stock, coal, and three seasons of quiet storage are swimming.',
    solutions: [
      { label: 'Pump and salvage', desc: 'Buckets, pumps, and prayer.', pool: 'speed', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, note: 'Half the stock survives. The coal is ruined but the wine is arguably improved.' },
        fail: { cash: -150, attrs: { marketing: -1 }, note: 'The water wins. The cellar is a swamp and the quarter\'s reserves with it.' } },
      { label: 'Rebuild above flood line', desc: 'Raise the floor, stone the walls, never again.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -120, facilityCondition: 15, note: 'Next flood, the cellar watches the river go by like a satisfied cat.' },
        fail: { cash: -200, note: 'The works are interrupted by — of course — another flood.' } },
      { label: 'Convert to cold storage', desc: 'If it\'s going to be wet, make it usefully wet.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -40, attrs: { profit: 1 }, note: 'A cold cistern keeps fish. The fisherman pay rent for the privilege.' },
        fail: { cash: -80, note: 'A failed cistern is just a cellar that is also a crime scene for good cheese.' } }] },
  { id: 'fc_haunt', cat: 'facility', w: 1, deadline: 2, title: 'The Haunted Annex',
    text: 'The new annex has cold spots, footsteps, and a mirror that shows the wrong room. The crew won\'t work in it.',
    solutions: [
      { label: 'Hire a medium', desc: 'Talk to it, settle it, salt the thresholds.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -60, attrs: { morale: 1 }, note: 'The ghost is apparently a former clerk who just wants his ledger balanced. Done. He rests.' },
        fail: { cash: -100, attrs: { morale: -2, marketing: -1 }, note: 'The medium flees mid-ritual, leaving the haunting angrier and the staff terrified.' } },
      { label: 'Market the haunting', desc: 'Charging for ghost tours is just good sense.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 180, attrs: { marketing: 2, morale: 1 }, note: 'The most haunted annex in the district. Tickets sell out. The ghost seems to enjoy the audience.' },
        fail: { cash: -80, attrs: { marketing: -2 }, note: 'A patron is genuinely possessed at the séance dinner. The reviews are terrible.' } },
      { label: 'Board it up', desc: 'Some doors stay closed.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -20, note: 'The annex stays shut. The house loses the space but keeps its nerve.' },
        fail: { cash: -60, attrs: { profit: -1 }, note: 'Losing the annex means losing the storage; losing the storage means renting elsewhere at twice the price.' } }] },
  { id: 'fc_permit', cat: 'facility', w: 3, deadline: 2, title: 'Expansion Permit Blocked',
    text: 'The council desk is a swamp of forms, stamps, and one clerk who wants a reason to say no.',
    solutions: [
      { label: 'File everything perfectly', desc: 'Beat the bureaucracy with thoroughness.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -40, facilityCondition: 10, note: 'Triple-filed, cross-stamped, unimpeachable. The permit issues with visible reluctance.' },
        fail: { cash: -100, attrs: { leadership: -1 }, note: 'A missing form 7-B. The whole file returns to the bottom of the pile.' } },
      { label: 'Lean on connections', desc: 'A councillor owes the house a favour.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 50, facilityCondition: 15, note: 'The favour is called; the clerk is transferred; the permit lands on the desk by courier.' },
        fail: { cash: -120, attrs: { danger: 1, marketing: -1 }, note: 'The favour is refused and the story of the "bribe attempt" reaches the gazette.' } },
      { label: 'Build without it', desc: 'Ask forgiveness, not permission.', pool: 'speed', skill: 'none', asset: 0, steps: 1,
        success: { cash: 100, attrs: { danger: 1 }, note: 'The annex goes up in a week. The fine, when it comes, is cheaper than the wait.' },
        fail: { cash: -200, attrs: { danger: 2 }, note: 'The council orders the new wing torn down. Publicly. With workers watching.' } }] },
  { id: 'fc_sabotage', cat: 'facility', w: 2, deadline: 1, title: 'Sabotaged Machinery',
    text: 'Someone loosened the gears and salted the flour. Production stops while the crew counts fingers.',
    solutions: [
      { label: 'Fix and guard', desc: 'Repair, then watch.', pool: 'speed', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, note: 'The gears are true again and the night watch has new instructions.' },
        fail: { cash: -130, attrs: { personnel: -1 }, note: 'It happens again the next night. Nobody saw anything. Again.' } },
      { label: 'Hunt the saboteur', desc: 'Grease, footprints, motives.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { leadership: 2, danger: -1 }, note: 'Caught with the wrench in hand — hired by the rival two streets over. The exposure costs the rival more than the house.' },
        fail: { cash: -100, attrs: { morale: -2 }, note: 'The hunt accuses the wrong worker; the real saboteur smiles and sharpens the next wrench.' } },
      { label: 'Upgrade everything', desc: 'New locks, new gears, salted-flour detectors.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -90, facilityCondition: 10, note: 'The new machinery is better than the old and tamper-proof to boot.' },
        fail: { cash: -160, note: 'The upgrade is expensive; the saboteur is patient.' } }] },
  { id: 'fc_blessing', cat: 'facility', w: 2, deadline: 2, title: 'An Offer of Blessing',
    text: 'A temple offers to bless the premises — for a donation. The crew is split between reverence and skepticism.',
    solutions: [
      { label: 'Accept graciously', desc: 'The goodwill of the gods and the neighbourhood, one donation.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -50, attrs: { morale: 2, marketing: 1 }, note: 'The blessing is well attended; the house\'s name is spoken in the temple, favourably.' },
        fail: { cash: -50, note: 'The donation is taken; the blessing is perfunctory. The skeptics feel vindicated.' } },
      { label: 'Make it a festival', desc: 'Feed the crowd, host the rite, own the day.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 120, attrs: { marketing: 2, morale: 2 }, note: 'The temple festival fills the street. The house feeds half the district and the gods, presumably, approve.' },
        fail: { cash: -150, attrs: { marketing: -1 }, note: 'Rain on the festival day. Soggy hymns, ruined bunting, and a donation already spent.' } },
      { label: 'Politely decline', desc: 'The house keeps its own counsel.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'No donation, no offense. The temple\'s favour is unchanged, if not increased.' },
        fail: { attrs: { marketing: -1 }, note: 'The refusal is inflated into impiety. The devout regulars take their custom to the blessed rival across the street.' } }] },

  // ═══ PRODUCT — what you sell is who you are ═══
  { id: 'pd_badbatch', cat: 'product', w: 2, deadline: 1, title: 'The Bad Batch',
    text: 'A whole run of the signature product is off. Not dangerous — just wrong. Disappointing. Memorable, in the bad way.',
    solutions: [
      { label: 'Recall quietly', desc: 'Take it back, make it right, tell no one loudly.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -90, attrs: { marketing: 1 }, note: 'The recall is so graceful several customers come away MORE loyal. Weird, but true.' },
        fail: { cash: -180, attrs: { marketing: -2 }, note: 'The recall is late, grudging, and public. The apology tour costs double.' } },
      { label: 'Rebrand it', desc: 'The bad ale is now the "rustic small-batch limited edition."', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 80, attrs: { marketing: 2 }, note: 'Sold out. Critics call the flaw "character." The brewmaster weeps with laughter.' },
        fail: { cash: -100, attrs: { marketing: -2 }, note: 'The public is not fooled. The "limited edition" becomes a punchline.' } },
      { label: 'Dump it and move on', desc: 'Write it off, brew the next batch right.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -60, note: 'A lost week\'s production. The next batch is flawless and the incident fades.' },
        fail: { cash: -120, attrs: { marketing: -1 }, note: 'The dumped batch resurfaces on the black market, sold under the house\'s good name.' } }] },
  { id: 'pd_fad', cat: 'product', w: 2, deadline: 1, title: 'Viral Fad',
    text: 'Something about the product catches the street\'s imagination. Demand is suddenly ten times supply.',
    solutions: [
      { label: 'Capitalize hard', desc: 'Triple shifts, premium prices, ride it.', pool: 'speed', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 200, attrs: { marketing: 2, profit: 1 }, note: 'The fad pays for the new oven. When it fades, the oven remains.' },
        fail: { cash: -80, attrs: { morale: -2 }, note: 'The overtime breaks the crew; the fad breaks even faster. Nobody wins.' } },
      { label: 'Scarcity marketing', desc: 'Sell less, charge more, make queues.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 300, attrs: { marketing: 3 }, note: 'The queue becomes the attraction. The product becomes the legend.' },
        fail: { cash: -60, attrs: { marketing: -1 }, note: 'The queue never forms; the scarcity just reads as incompetence.' } },
      { label: 'Steady output', desc: 'Fads fade. Regulars don\'t. Serve the regulars.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: 100, attrs: { morale: 1 }, note: 'A modest windfall and no whiplash. The regulars never felt abandoned.' },
        fail: { cash: -40, attrs: { marketing: -1 }, note: 'The rival rides the fad into a fortune while this house watches, principled and poorer.' } }] },
  { id: 'pd_leak', cat: 'product', w: 2, deadline: 2, title: 'Design Walks Out',
    text: 'The master artisan storms out with the new design under one arm and a grievance under the other.',
    solutions: [
      { label: 'Win them back', desc: 'The grievance is real. Fix it.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -70, attrs: { personnel: 1, morale: 1 }, note: 'Apologies, a raise, a window in the workshop. The design comes home.' },
        fail: { cash: -120, attrs: { marketing: -1 }, note: 'The artisan sells the design to a rival. The grievance, it turns out, was the price.' } },
      { label: 'Buy the design back', desc: 'Money speaks; pride listens eventually.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -150, attrs: { profit: 1 }, note: 'Exclusive rights, signed and sealed. Expensive silence.' },
        fail: { cash: -100, attrs: { danger: 1 }, note: 'The negotiation becomes a public feud. The design is tainted for everyone.' } },
      { label: 'Design around it', desc: 'The second sketch is always better anyway.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { marketing: 1 }, note: 'The apprentice\'s redesign outsells the lost original. The master is furious, elsewhere.' },
        fail: { cash: -90, attrs: { marketing: -2 }, note: 'Without the master\'s eye, the follow-up product lands flat.' } }] },
  { id: 'pd_shortage', cat: 'product', w: 3, deadline: 1, title: 'Ingredient Shortage',
    text: 'The one thing the signature product cannot live without is suddenly unavailable at any price.',
    solutions: [
      { label: 'Reformulate', desc: 'Necessity is a recipe.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { marketing: 1 }, note: 'The substitute blend wins a blind tasting. The shortage becomes a footnote.' },
        fail: { cash: -100, attrs: { marketing: -2 }, note: 'The substitute is detectably worse. The regulars detect it.' } },
      { label: 'Hunt the source', desc: 'Somewhere upstream, someone has a crate.', pool: 'speed', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 120, attrs: { profit: 1 }, note: 'A caravan deal secures the last cartload — plus next season\'s first.' },
        fail: { cash: -140, note: 'The cartload was promised to three buyers. The auction for it is ruinous.' } },
      { label: 'Pause the product', desc: 'Sell what exists. Wait it out.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -40, attrs: { marketing: 1 }, note: '"Temporarily resting the signature" reads as integrity. The waitlist grows.' },
        fail: { cash: -90, attrs: { marketing: -1 }, note: 'The pause reads as failure. Regulars drift to rivals with reliable shelves.' } }] },
  { id: 'pd_iteration', cat: 'product', w: 3, deadline: 2, title: 'The Genius Iteration',
    text: 'The line cook / smith / brewer has a wild idea that might redefine the product. Or waste a month.',
    solutions: [
      { label: 'Fund the experiment', desc: 'The best ideas look like risks.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: 100, attrs: { marketing: 2, morale: 2 }, note: 'The new variant becomes the best-seller. The line cook gets a corner office and keeps the apron.' },
        fail: { cash: -100, attrs: { morale: -1 }, note: 'A month and a barrel of materials for something the cat wouldn\'t taste.' } },
      { label: 'Small-batch test', desc: 'Prove it at the tasting counter before betting the line.', pool: 'intellect', skill: 'trained', asset: 0, steps: 2,
        success: { cash: 150, attrs: { marketing: 1 }, note: 'The tasting panel raves; the scaled batch sells out in a day. Controlled genius.' },
        fail: { cash: -60, note: 'The panel is polite, the public is not. The iteration dies in committee, cheaply.' } },
      { label: 'Not now', desc: 'The line is sacred. Don\'t touch the line.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'Stability. The genius grumbles but the regulars never notice anything changed.' },
        fail: { attrs: { morale: -2, personnel: -1 }, note: 'The genius takes the idea to a rival. It redefines THEIR product instead.' } }] },
  { id: 'pd_season', cat: 'product', w: 3, deadline: 2, title: 'The Season Turns',
    text: 'Winter is coming and the summer stock will not sell itself. The product line must turn with the weather.',
    solutions: [
      { label: 'Clearance sale', desc: 'Sell it all at cost and turn the floor.', pool: 'speed', skill: 'none', asset: 0, steps: 1,
        success: { cash: 50, attrs: { marketing: 1 }, note: 'The sale empties the storeroom and fills the till. Winter stock lands on time.' },
        fail: { cash: -80, note: 'The sale fizzles. The summer stock becomes expensive insulation.' } },
      { label: 'Bundle and pivot', desc: 'Summer goods become winter premiums with the right story.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 180, attrs: { marketing: 2 }, note: '"Summer reserve" — aged, rare, only available in winter. The markup is scandalous and the queue is real.' },
        fail: { cash: -90, attrs: { marketing: -1 }, note: 'The story doesn\'t land. Bundled leftovers are still leftovers.' } },
      { label: 'Hold for next year', desc: 'Good stock keeps. Patience.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -20, note: 'The storeroom holds; next spring the stock sells at full price. Slow and whole.' },
        fail: { cash: -70, attrs: { profit: -1 }, note: 'Something in the storeroom does not keep. The insurance is unhelpful.' } }] },
  { id: 'pd_complaints', cat: 'product', w: 3, deadline: 1, title: 'Quality Complaints',
    text: 'Three regulars, two strangers, and one bard have all complained about the product this week.',
    solutions: [
      { label: 'Investigate the line', desc: 'Taste everything. Inspect everything.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -40, attrs: { marketing: 1 }, note: 'A tired apprentice and a mis-set gauge were the culprits. Fixed, apologized, compensated.' },
        fail: { cash: -100, attrs: { marketing: -2 }, note: 'The problem is systemic and the investigation only proves it loudly.' } },
      { label: 'Charm offensive', desc: 'The bard alone is worth ten apologies.', pool: 'intellect', skill: 'trained', asset: 1, steps: 2,
        success: { cash: 60, attrs: { marketing: 2 }, note: 'The bard repents publicly and sings the house\'s contrition. The complaints become a story of grace.' },
        fail: { cash: -80, attrs: { marketing: -2 }, note: 'The bard smells free drinks and sings about THAT instead.' } },
      { label: 'Defend the standard', desc: 'The product is fine. The customers are wrong.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { morale: 1 }, note: 'A dignified public statement. Some agree. The complaints fade into legend.' },
        fail: { attrs: { marketing: -3 }, note: '"The customers are wrong" is the wrong anthem. The bard writes it into the chorus.' } }] },
  { id: 'pd_gift', cat: 'product', w: 2, deadline: 2, title: 'The Gift Contract',
    text: 'A noble house wants the signature product, customized and delivered in bulk, for a grand wedding.',
    solutions: [
      { label: 'Fulfill to the letter', desc: 'Underpromise, overdeliver, invoice cleanly.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 180, attrs: { marketing: 2 }, note: 'The wedding is the season\'s event. Every guest asks where the gifts came from.' },
        fail: { cash: -90, attrs: { marketing: -1 }, note: 'A late delivery and a smudged crest. The noble house tells everyone, at length.' } },
      { label: 'Over-fulfill spectacularly', desc: 'Make the wedding gift the wedding story.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 300, attrs: { marketing: 3 }, note: 'The customized batch arrives with a presentation that stops the ceremony. The house\'s name is toasted by name.' },
        fail: { cash: -160, attrs: { marketing: -1, profit: -1 }, note: 'The spectacle overruns the budget and one presentation element literally catches fire.' } },
      { label: 'Decline, refer a rival', desc: 'Too big, too custom, too risky. Pass.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { attrs: { leadership: 1 }, note: 'The rival botches it; the house\'s judgment looks golden. The noble respects the honesty.' },
        fail: { attrs: { marketing: -1 }, note: 'The rival fulfills beautifully and inherits the noble\'s future business.' } }] },

  // ═══ CRISIS — MAJOR CRISIS ═══
  { id: 'cr_takeover', cat: 'crisis', w: 2, deadline: 2, title: 'Hostile Takeover',
    text: 'A consortium buys debts, buys allies, and buys time. The house wakes to find the walls owned by strangers.',
    solutions: [
      { label: 'White knight', desc: 'Find a friendlier buyer before the predator closes.', pool: 'intellect', skill: 'trained', asset: 1, steps: 1,
        success: { cash: 100, attrs: { leadership: 1 }, note: 'A loyal patron buys the debts and burns them. The consortium retreats, smiling thinly.' },
        fail: { cash: -250, attrs: { leadership: -2, morale: -2 }, note: 'The knight never materializes. The consortium starts choosing new curtains.' } },
      { label: 'Poison pill', desc: 'Make the house so expensive to digest that they choke.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: -100, attrs: { profit: 2 }, note: 'Golden parachutes for the staff, debt covenants tied to the brand — the consortium does the math and walks.' },
        fail: { cash: -300, attrs: { profit: -2, danger: 2 }, note: 'The pill poisons the patient. The house survives but the finances are wrecked for a year.' } },
      { label: 'Sell on your terms', desc: 'If the house falls, fall forward.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: 350, note: 'A negotiated sale at a fair price. The name survives inside a larger beast; the founders leave with fortunes.' },
        fail: { cash: 150, attrs: { morale: -2 }, note: 'A fire sale under duress. The staff learn their futures from the rumour mill.' } }] },
  { id: 'cr_lockdown', cat: 'crisis', w: 2, deadline: 2, title: 'Citywide Lockdown',
    text: 'Plague, insurrection, or royal mourning — the gates close. The city holds its breath and so does the ledger.',
    solutions: [
      { label: 'Ride it out', desc: 'Rations, wages, patience.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -120, attrs: { morale: 1 }, note: 'The doors reopen to find the house intact and the rivals thinned. The regulars flood back.' },
        fail: { cash: -250, attrs: { morale: -2 }, note: 'The lockdown outlasts the reserves. Wages go unpaid; goodwill follows.' } },
      { label: 'Essential-service status', desc: 'The house feeds the watch. The watch lets the house breathe.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 150, attrs: { marketing: 2, danger: -1 }, note: 'The house becomes the city\'s larder. When the gates open, the gratitude is institutional.' },
        fail: { cash: -100, attrs: { danger: 2 }, note: 'The permit is forged, discovered, and prosecuted during a lockdown. The judges are bored and merciless.' } },
      { label: 'Smuggle through the walls', desc: 'The city sleeps; commerce doesn\'t.', pool: 'speed', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 100, attrs: { danger: 2 }, note: 'Nightly ropes and rowboats. Profitable, terrifying, unrepeatable at dinner parties.' },
        fail: { cash: -150, attrs: { danger: 2, personnel: -2 }, note: 'The wall patrol is not bribable this season. The smugglers\' fine is paid in coin and dignity.' } }] },
  { id: 'cr_fire', cat: 'crisis', w: 2, deadline: 1, title: 'FIRE!',
    text: 'Not the annex. The main hall. It\'s in the walls. Everyone out, everything counts, now.',
    solutions: [
      { label: 'Evacuate and contain', desc: 'People first, walls second, goods last.', pool: 'speed', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -150, facilityCondition: -20, attrs: { morale: 2 }, note: 'The hall is scarred but standing and every soul is accounted for. The district helps rebuild.' },
        fail: { cash: -300, facilityCondition: -40, attrs: { personnel: -2, morale: -2 }, note: 'The fire takes the roof and two are hurt. The rebuild is long and the insurance is creative.' } },
      { label: 'Fight it house by house', desc: 'The bucket line becomes a battle line.', pool: 'speed', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: -80, facilityCondition: -5, attrs: { marketing: 2 }, note: 'The house that fought for itself becomes the street\'s legend. The damage is trivial; the pride is not.' },
        fail: { cash: -200, facilityCondition: -30, attrs: { personnel: -3 }, note: 'The fire wins the stairwell. The bucket line breaks. The night is long.' } },
      { label: 'Save the stock, let it burn', desc: 'The building is insured. The recipe is not.', pool: 'speed', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 100, facilityCondition: -50, note: 'The stock, the ledgers, and the strongbox make it out. The shell is rebuilt with insurance money.' },
        fail: { cash: -100, facilityCondition: -50, attrs: { profit: -2 }, note: 'The strongbox is insured. The inventory is not. The paperwork says "act of gods," plural.' } }] },
  { id: 'cr_defection', cat: 'crisis', w: 2, deadline: 1, title: 'Mass Defection',
    text: 'A rival offers the whole crew a signing bonus and a better canteen. A third have already said yes.',
    solutions: [
      { label: 'The counter-offer of the century', desc: 'Match, exceed, and make it personal.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 1,
        success: { cash: -250, attrs: { morale: 3, personnel: 2 }, note: 'Shares, raises, and a speech that actually lands. The defectors ask to come back. Some are allowed.' },
        fail: { cash: -150, attrs: { personnel: -3, morale: -3 }, note: 'The counter lands flat. The exodus continues through the week.' } },
      { label: 'Let the malcontents go', desc: 'A crew that wants to leave is already gone.', pool: 'intellect', skill: 'trained', asset: 0, steps: 2,
        success: { cash: -80, attrs: { morale: 1, profit: 1 }, note: 'The leave-takers go; the stay-takers close ranks. A leaner, truer crew remains.' },
        fail: { cash: -120, attrs: { personnel: -4, marketing: -1 }, note: 'The wrong third leaves. The skills gap swallows the quarter.' } },
      { label: 'Fight the rival', desc: 'Contracts, lawyers, and a whisper campaign.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { attrs: { marketing: 1, danger: -1 }, note: 'The rival\'s poaching contract is ruled unenforceable. The crew never even learns how close it came.' },
        fail: { cash: -100, attrs: { danger: 2, morale: -2 }, note: 'The legal war becomes a street war. Everyone picks a side; production picks neither.' } }] },
  { id: 'cr_syndicate', cat: 'crisis', w: 1, deadline: 1, title: 'The Syndicate Ultimatum',
    text: 'The underworld syndicate offers "protection" at a price that looks exactly like ownership. The deadline is tonight.',
    solutions: [
      { label: 'Pay', desc: 'Live to fight in a stronger season.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -200, note: 'The syndicate\'s collectors nod at the door. The house breathes and builds strength in the shadow.' },
        fail: { cash: -200, attrs: { danger: 2, profit: -1 }, note: 'The price rises monthly. Protection, it turns out, is a subscription.' } },
      { label: 'Refuse and fortify', desc: 'No deal. More locks. More guards.', pool: 'speed', skill: 'trained', asset: 1, steps: 2,
        success: { cash: -150, attrs: { danger: -1 }, note: 'The syndicate probes twice and finds walls. They move to softer prey, cursing politely.' },
        fail: { cash: -250, attrs: { personnel: -2, danger: 3 }, note: 'The refusals are answered with fire. The guards were not enough.' } },
      { label: 'Go to the law', desc: 'The watch has a syndicate desk. Using it is a statement.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { attrs: { danger: -2, marketing: 1 }, note: 'A grand raid nets the syndicate\'s local board. The house is famous; the street is safe; the syndicate remembers elsewhere.' },
        fail: { cash: -200, attrs: { danger: 3, morale: -2 }, note: 'The watch is compromised. The syndicate learns exactly who complained, and the house learns what "protection" really meant.' } }] },
  { id: 'cr_scandal', cat: 'crisis', w: 2, deadline: 2, title: 'The Scandal Erupts',
    text: 'The old rumor — the one everyone half-knew — is now printed, named, and sung. The house is infamous.',
    solutions: [
      { label: 'Total transparency', desc: 'Open the books, open the story, own it all.', pool: 'intellect', skill: 'trained', asset: 0, steps: 1,
        success: { cash: -80, attrs: { marketing: 2, morale: 1 }, note: 'The confession disarms the story. By winter it\'s a footnote; by spring, a charm.' },
        fail: { cash: -150, attrs: { marketing: -3 }, note: 'Transparency reveals a second, worse thing. The story writes itself for another month.' } },
      { label: 'The big distraction', desc: 'Give the street something better to talk about.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 100, attrs: { marketing: 3 }, note: 'A festival, a stunt, a marriage of scandalous cheerfulness. The old news dies of neglect.' },
        fail: { cash: -120, attrs: { marketing: -2 }, note: 'The distraction flops and the scandal gets a second wind: now it\'s funny AND true.' } },
      { label: 'Weather it in silence', desc: 'Stones fly; walls hold.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -40, note: 'A miserable season. The regulars stay. The story starves.' },
        fail: { cash: -100, attrs: { marketing: -2, morale: -2 }, note: 'Silence curdles into apparent guilt. The bard\'s ballad enters the permanent repertoire.' } }] },
  { id: 'cr_supplychain', cat: 'crisis', w: 2, deadline: 2, title: 'Supply Chain Collapse',
    text: 'The road is closed, the river is low, and the warehouses are empty. The pipeline is dust.',
    solutions: [
      { label: 'Find another way', desc: 'A longer road, a friendlier river, a mountain pass.', pool: 'speed', skill: 'trained', asset: 1, steps: 1,
        success: { cash: -120, attrs: { personnel: 1 }, note: 'The detour costs double but the shelves stay stocked. The crew builds the new route into the routine.' },
        fail: { cash: -220, attrs: { marketing: -2 }, note: 'The pass is snowbound, the river barge sinks, and the shelves empty anyway.' } },
      { label: 'Localize everything', desc: 'Grow it, make it, mine it in the district itself.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 50, attrs: { profit: 2, marketing: 2 }, note: 'The house ends the crisis owning half the district\'s production. Independence becomes profit.' },
        fail: { cash: -150, attrs: { profit: -2 }, note: 'Local suppliers can\'t scale. The experiment buys dependence of a different color.' } },
      { label: 'Ration and hibernate', desc: 'Half rations, half hours, half price. Survive.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { cash: -100, attrs: { morale: 1 }, note: 'The house shrinks to its loyal core and waits. The reopening feels like a resurrection.' },
        fail: { cash: -180, attrs: { morale: -3, personnel: -2 }, note: 'The hibernation becomes a slow death. The best people leave for warmer houses.' } }] },
  { id: 'cr_regime', cat: 'crisis', w: 1, deadline: 2, title: 'Regime Change',
    text: 'The old order falls in a fortnight of banners and bonfires. Licenses, contracts, and patrons are all suddenly negotiable.',
    solutions: [
      { label: 'Keep heads down', desc: 'No flags, no feasts, no faction.', pool: 'intellect', skill: 'none', asset: 0, steps: 1,
        success: { note: 'The house emerges unaffiliated and unharmed. Both regimes need bread and bolts; both find this house open.' },
        fail: { cash: -100, attrs: { marketing: -1 }, note: 'Neutrality reads as disloyalty to the winners. The new registry "loses" the house\'s license for a season.' } },
      { label: 'Back the winners early', desc: 'Supplies, loans, and quiet loyalty to the rising banner.', pool: 'intellect', skill: 'specialized', asset: 1, steps: 2,
        success: { cash: 250, attrs: { marketing: 3, leadership: 1 }, note: 'The new regime remembers its friends. The house becomes a chartered institution.' },
        fail: { cash: -300, attrs: { danger: 3, marketing: -2 }, note: 'Backed the wrong banner. The winners\' first act is a list; the house is on it.' } },
      { label: 'Serve every side', desc: 'Bread to the barricade, bread to the palace.', pool: 'speed', skill: 'trained', asset: 0, steps: 1,
        success: { cash: 100, note: 'The house sells to everyone, betrays no one openly, and somehow emerges with all fingers.' },
        fail: { cash: -150, attrs: { danger: 2, leadership: -2 }, note: 'Both sides discover the double ledger. Forgiveness is not in the new political vocabulary.' } }] }
];
