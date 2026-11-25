// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — weekly engine (pure)
// resolveWeek() takes a business object + injectable rng and returns a NEW
// business plus a report. No Foundry globals — unit-testable in node.
// ═══════════════════════════════════════════════════════════════════════════

import {
  ATTRIBUTES, ATTR_MAX, ATTR_MIN, WAGE_LEVELS,
  MARKETING_SPEND_COST, MAINTENANCE_SPEND_COST,
  ROLE_STAT_MAX, defaultRoleStats,
  clamp, clampInt, clamp100, uid, d
} from '../constants.mjs';
import { rollWeeklyEvent, tickStoryEvents } from './story-events.mjs';
import { rivalBand, rivalWeekOutcome } from './rivals.mjs';

// ─── helpers ────────────────────────────────────────────────────────────────

function activeProducts(b) {
  return b.products.filter((p) => p.active);
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function facilityEfficiency(b) {
  if (!b.facilities.length) return 0.5; // working out of a back room
  return clamp(avg(b.facilities.map((f) => f.condition)) / 100, 0.1, 1);
}

/**
 * v1.23 — staffing requirement: each active line demands `workersDemand` heads
 * from the payroll. crewNeeded() is the weekly headcount the active lines ask
 * for; resolveWeek compares it against the workers actually on payroll.
 */
function crewNeeded(b) {
  return activeProducts(b).reduce((s, p) => s + (p.workersDemand ?? 2), 0);
}

function avgProductivity(b) {
  return b.staff.workers.length ? avg(b.staff.workers.map((w) => w.productivity ?? 5)) : 5;
}

function filledRoles(b) {
  return b.leadership.roles.filter((r) => r.actorUuid);
}

/** Strength is DERIVED, never edited: the rounded mean of P/M/L, clamped 0–5. Synced everywhere. */
export function syncStrength(p) {
  p.strength = clampInt(Math.round(((p.productivity ?? 5) + (p.morale ?? 5) + (p.loyalty ?? 5)) / 6), 0, 5);
  return p.strength;
}

/** Effectiveness of any filled post (role or leading worker): 0.3 at strength 0 → 1.0 at strength 5. */
export function personEff(p) {
  return p?.actorUuid ? 0.3 + clampInt(p.strength ?? 5, 0, 5) * 0.14 : 0;
}
export function roleEffectiveness(r) {
  return personEff(r);
}

/** Aggregate domain power from every filled role (leadership·operations·marketing·finance·security). */
export function domainPower(b) {
  const p = { leadership: 0, operations: 0, marketing: 0, finance: 0, security: 0 };
  for (const r of b.leadership?.roles ?? []) {
    if (!r.actorUuid) continue;
    p[r.domain] = (p[r.domain] ?? 0) + personEff(r);
  }
  // leading workers count at half weight toward their domain
  for (const w of b.leadWorkers ?? []) {
    if (!w.actorUuid) continue;
    p[w.domain] = (p[w.domain] ?? 0) + personEff(w) * 0.5;
  }
  return p;
}

/** Income multiplier from leadership productivity + filled leading-worker slots (0.5–1% each by strength). */
export function leadershipIncomeMult(b) {
  const prod = (b.leadership?.roles ?? []).reduce((s, r) => s + (r.actorUuid ? (r.productivity ?? 5) - 5 : 0), 0);
  const lw = (b.leadWorkers ?? []).filter((w) => w.actorUuid)
    .reduce((s, w) => s + 0.005 + clampInt(w.strength ?? 5, 0, 5) * 0.001, 0);
  return clamp(1 + prod * 0.005 + lw, 0.75, 1.3);
}

/** Cost multiplier from finance-domain roles (up to −20%). */
export function financeCostMult(b) {
  return 1 - Math.min(0.2, domainPower(b).finance * 0.08);
}

function wageLevel(b) {
  return WAGE_LEVELS[clampInt(b.spend.wage, 0, WAGE_LEVELS.length - 1)];
}

// ─── the weekly run ─────────────────────────────────────────────────────────

/**
 * Advance one week. Returns { business, report }.
 * @param {object} business  source business (not mutated — cloned)
 * @param {function} rng     injectable random source (defaults Math.random)
 * @param {string}   label   date label for this week (Calendaria or "Week N")
 * @param {function|null} dateLabelFor  (dayOffset 1–7, weekIndex) => in-world
 *                         date label for the weekly story event (Calendaria
 *                         in the app; "Week N · Day d" fallback in tests)
 */
export function resolveWeek(business, rng = Math.random, label = null, dateLabelFor = null) {
  const b = structuredClone(business);
  const lines = [];        // treasury lines for the report
  const notes = [];       // human-readable notes
  const deltas = {};      // aggregate attribute deltas
  const track = (ds) => {
    for (const [k, v] of Object.entries(ds)) deltas[k] = (deltas[k] ?? 0) + v;
  };
  const attr = (key, delta) => {
    const before = b.attributes[key];
    b.attributes[key] = clampInt(before + delta, ATTR_MIN, ATTR_MAX);
    const actual = b.attributes[key] - before;
    if (actual) deltas[key] = (deltas[key] ?? 0) + actual;
  };
  const cash = (amount, labelText, kind = 'expense') => {
    if (!amount) return;
    b.treasury.cash += amount;
    lines.push({ kind, label: labelText, amount: Math.round(amount) });
  };

  const weekLabel = label ?? `Week ${b.week.index + 1}`;

  // ── 1. story event deadlines ─────────────────────────────────────────
  // events whose due week has passed fail automatically (consequences applied)
  const expiredEvents = tickStoryEvents(b, rng);
  const expired = [];
  for (const e of expiredEvents) {
    // tickStoryEvents already applied the consequences to the treasury —
    // this line is REPORT-ONLY so the ledger shows the hit exactly once.
    if (e.cashDelta) lines.push({ kind: 'expense', label: `${e.title} (expired)`, amount: Math.round(e.cashDelta) });
    track(e.deltas ?? {});
    expired.push({ title: e.title, note: e.note ?? '' });
    notes.push(`${e.title} went unresolved — ${e.note ?? 'consequences land either way.'}`);
  }

  // ── 1b. leadership roster: domain power + income multiplier ────────────
  const power = domainPower(b);
  const leadMult = leadershipIncomeMult(b);
  const spendMult = financeCostMult(b);

  // ── 2. spending ────────────────────────────────────────────────────────
  const wages = b.staff.workers.reduce((s, w) => s + (w.wage ?? 10), 0) * wageLevel(b);
  cash(-Math.round(wages * spendMult), `Wages (${b.staff.workers.length} staff)`);
  // leadership + leading-worker wages — paid only while the post is held
  const rosterWages = filledRoles(b).reduce((s, r) => s + Math.max(0, r.wage ?? 0), 0)
    + (b.leadWorkers ?? []).filter((w) => w.actorUuid).reduce((s, w) => s + Math.max(0, w.wage ?? 0), 0);
  if (rosterWages > 0) cash(-Math.round(rosterWages * wageLevel(b) * spendMult), 'Leadership wages');
  cash(-Math.round(b.spend.marketing * MARKETING_SPEND_COST * spendMult), `Marketing push (Lv ${b.spend.marketing})`);
  cash(-Math.round(b.spend.maintenance * MAINTENANCE_SPEND_COST * spendMult), `Upkeep & security (Lv ${b.spend.maintenance})`);
  if (b.spend.marketing > 0) attr('marketing', b.spend.marketing >= 4 ? 2 : 1);

  // ── 3. facilities ──────────────────────────────────────────────────────
  for (const f of b.facilities) {
    const repair = b.spend.maintenance * 4;
    const wear = d(rng, 4);
    f.condition = clamp100(f.condition + repair - wear);
  }

  // ── 3b. facility mood — condition shapes personnel morale ──────────────
  // Housed crews drift ±1 toward the average facility condition (as a 0–10 mood).
  // Cramped quarters (crew bigger than total capacity) sour everyone an extra −1.
  if (b.facilities.length && b.staff.workers.length) {
    const avgCond = avg(b.facilities.map((f) => f.condition));
    const moodTarget = clampInt(Math.round(avgCond / 10), 1, 10);
    const totalCap = b.facilities.reduce((s, f) => s + (f.capacity ?? 0), 0);
    const crowded = b.staff.workers.length > totalCap;
    for (const w of b.staff.workers) {
      if (w.morale < moodTarget) w.morale = clampInt(w.morale + 1, 1, 10);
      else if (w.morale > moodTarget) w.morale = clampInt(w.morale - 1, 1, 10);
      if (crowded) w.morale = clampInt(w.morale - 1, 1, 10);
    }
    if (crowded) notes.push(`Overcrowded quarters — the crew of ${b.staff.workers.length} sleeps in shifts built for ${totalCap}. Morale suffers.`);
  }

  // ── 4. wage morale + quits ─────────────────────────────────────────────
  // Pay bands speak louder than speeches — a continuum, not a cliff:
  //   0.6 starvation: business mood −1, crew −1/wk, real quit risk
  //   0.8 lean:       crew −1/wk, a grumbler may drift away
  //   1.0 market:     no news — the default band
  //   1.2 generous:   crew +1/wk, business mood +1
  //   1.5 lavish:     crew +2/wk, business mood +1
  // Quits target the LOWEST-morale worker (and only while morale ≤ 5), so a
  // resignation is legible — the roster shows the grumbler before they walk.
  const wlIdx = clampInt(b.spend.wage, 0, WAGE_LEVELS.length - 1);
  if (wlIdx <= 1 && b.staff.workers.length) {
    for (const w of b.staff.workers) w.morale = clampInt(w.morale - 1, 1, 10);
    if (rng() < (wlIdx === 0 ? 0.3 : 0.12)) {
      const lowest = b.staff.workers.reduce((a, w) => (w.morale ?? 5) < (a.morale ?? 5) ? w : a, b.staff.workers[0]);
      if ((lowest.morale ?? 5) <= 5) {
        b.staff.workers.splice(b.staff.workers.indexOf(lowest), 1);
        notes.push(`${lowest.name} quits over the pay — the writing was on the wall.`);
        attr('personnel', -1);
      }
    }
    if (wlIdx === 0) {
      attr('morale', -1);
      notes.push('Word of the miserable wages spreads — the crew sours.');
    }
  } else if (wlIdx >= 3 && b.staff.workers.length) {
    const drift = wlIdx === 4 ? 2 : 1;
    for (const w of b.staff.workers) w.morale = clampInt(w.morale + drift, 1, 10);
    attr('morale', 1);
    if (wlIdx === 4) notes.push('The house pays over the odds — the whole district hears of it.');
  }
  // passive morale drift toward 5
  attr('morale', b.attributes.morale > 6 ? -1 : b.attributes.morale < 4 ? 1 : 0);

  // ── 5. leadership & personnel drift ────────────────────────────────────
  const filled = filledRoles(b).length;
  const targetLead = clampInt(2 + filled * 2);
  attr('leadership', b.attributes.leadership < targetLead ? 1 : b.attributes.leadership > targetLead ? -1 : 0);
  const targetPers = clampInt(avg(b.staff.workers.map((w) => w.productivity ?? 5)) || 5);
  attr('personnel', b.attributes.personnel < targetPers ? 1 : b.attributes.personnel > targetPers ? -1 : 0);

  // ── 5b. role morale echoes the business; loyalty, strength, walk-outs ──
  // one week of person dynamics shared by leadership roles + leading workers
  function personWeek(p) {
    const moraleBefore = p.morale ?? 5;
    // morale chases the business mood (±2 dead zone)
    if (p.morale < b.attributes.morale - 2) p.morale = clampInt(p.morale + 1, 0, 10);
    else if (p.morale > b.attributes.morale + 2) p.morale = clampInt(p.morale - 1, 0, 10);
    // morale drives productivity
    if (p.morale <= 3 && p.productivity > 0) p.productivity = clampInt(p.productivity - 1, 0, 10);
    else if (p.morale >= 8 && p.productivity < 10) p.productivity = clampInt(p.productivity + 1, 0, 10);
    // loyalty follows morale drops, recovers in good times
    if (p.morale < moraleBefore) p.loyalty = clampInt((p.loyalty ?? 5) - 1, 0, 10);
    else if (p.morale >= 8 && (p.loyalty ?? 5) < 10) p.loyalty = clampInt(p.loyalty + 1, 0, 10);
    // strength is derived from the other three — never drifts on its own
    syncStrength(p);
    return p.loyalty <= 0;
  }

  function vacatePost(p, isLW = false) {
    notes.push(`${p.actorName} (${p.title}) walks out — loyalty spent. The post is vacant.`);
    b.log.unshift({ id: uid('log'), week: b.week.index, type: 'leadership', title: `${p.actorName} walks out`, text: `${p.title} is vacant again. Loyalty had run dry.`, at: Date.now() });
    p.actorUuid = null; p.actorName = null; p.portrait = null;
    Object.assign(p, defaultRoleStats());
    attr('morale', -1);
  }

  const roster = filledRoles(b);
  if (roster.length) {
    const avgRoleMorale = avg(roster.map((r) => r.morale ?? 5));
    if (avgRoleMorale <= 3) attr('morale', -1);
    else if (avgRoleMorale >= 8) attr('morale', 1);
    for (const r of roster) if (personWeek(r)) vacatePost(r);
  }

  // ── 5c. leading workers live by the same rules ────────────────────────
  const leads = (b.leadWorkers ?? []).filter((w) => w.actorUuid);
  if (leads.length) {
    const avgLeadMorale = avg(leads.map((w) => w.morale ?? 5));
    if (avgLeadMorale <= 3) attr('morale', -1);
    else if (avgLeadMorale >= 8) attr('morale', 1);
    for (const w of leads) if (personWeek(w)) vacatePost(w, true);
  }

  // ── 6. competitor phase ────────────────────────────────────────────────
  const compNotes = [];
  for (const c of b.competitors) {
    const attack = c.aggression + d(rng, 6) - Math.min(2, power.security * 0.8)
      + (b.attributes.profit >= 7 ? 1 : 0); // v1.40 — success makes you a juicier target
    // v1.42 — crew quality defends market share: a sharp crew keeps service
    // consistent and customers loyal, so rivals can't undercut as easily.
    // round(p/3) caps the contribution at +3 (personnel 10).
    const defense = b.attributes.marketing + b.attributes.leadership
      + Math.round(b.attributes.personnel / 3) + d(rng, 6);
    const band = rivalBand(attack, defense);
    if (band === 'rivalBig') {
      const prod = activeProducts(b);
      if (prod.length && rng() < 0.6) {
        const p = prod[Math.floor(rng() * prod.length)];
        p.demand = clampInt(p.demand - 1, 0, 10);
        compNotes.push(`${c.name} undercuts you — demand for ${p.name} slips.`);
      } else {
        attr('marketing', -1);
        compNotes.push(`${c.name} steals your limelight.`);
      }
      if (attack > defense + 5) attr('danger', 1);
    } else if (band === 'bizBig') {
      attr('marketing', 1);
      compNotes.push(`You outmaneuver ${c.name} and win market buzz.`);
    }
    // pressure gauge: buildup becomes a rival-move event at max
    const r = rivalWeekOutcome(b, c, band, dateLabelFor);
    for (const n of r.notes) compNotes.push(n);
    if (r.spawned) {
      b.log.unshift({
        id: uid('log'), week: b.week.index, type: 'ev_competition', title: r.spawned.title,
        text: `${r.spawned.text} — lands ${r.spawned.dateLabel}${r.spawned.dueDateLabel ? `, resolve by ${r.spawned.dueDateLabel}` : `, ${r.spawned.dueIn}w to resolve`}.`, at: Date.now()
      });
    }
  }

  // ── 7. income ──────────────────────────────────────────────────────────
  // v1.23 economy: each line's market pull is its demand scaled by marketing,
  // danger, facility condition and leadership; the STAFFING ratio (payroll vs
  // the lines' combined workersDemand) throttles every line proportionally.
  // Profit per unit is the line's `value` (× the productivity price premium).
  const heads = crewNeeded(b);
  const crew = b.staff.workers.length;
  // v1.41 — operations domain stretches the same payroll across more line
  // demand: scheduling, cross-training, less idle time. +5% per point of ops
  // power, capped at +25% — needs a real ops bench, one manager can't carry it.
  const opsStretch = 1 + Math.min(0.25, power.operations * 0.05);
  const staffRatio = heads > 0 ? clamp((crew * opsStretch) / heads, 0, 1) : 1;
  const fac = facilityEfficiency(b);
  const qualMult = 1 + (avgProductivity(b) - 5) / 20;
  // v1.40 — profit is load-bearing: a thriving business sells on reputation.
  // Asymmetric on purpose — success compounds slowly at the top, but a
  // struggling business gets no penalty here (the death spiral lives in §9).
  const mkt = 0.6 + b.attributes.marketing / 12 + Math.min(0.15, power.marketing * 0.05)
    + Math.max(0, (b.attributes.profit - 5) * 0.02);
  const dangerMult = 1 - b.attributes.danger * 0.03;
  // price-demand coupling (balance probe 2026-11-24): cheap lines move volume,
  // pricey lines move margin. priceFactor bottoms out at 0.15 so luxury never
  // fully dies; ×4 volume keeps a demand-5 line in the 100–400/wk band.
  let gross = 0;
  for (const p of activeProducts(b)) {
    const priceFactor = Math.max(0.15, 1 - (p.value ?? 10) / 110);
    const units = Math.max(0, p.demand * mkt * dangerMult * staffRatio * fac * leadMult * (0.7 + rng() * 0.6) * 3 * priceFactor);
    gross += Math.round(units * (p.value ?? 10) * qualMult);
  }
  if (heads > crew) {
    const rawPct = Math.round(clamp(crew / heads, 0, 1) * 100);
    const runPct = Math.round(staffRatio * 100);
    notes.push(runPct > rawPct
      ? `Short-staffed — the lines want ${heads} workers, the payroll has ${crew}. Sharp operations lift the floor to ${runPct}%.`
      : `Short-staffed — the lines want ${heads} workers, the payroll has ${crew}. Everything runs at ${runPct}%.`);
  }
  if (gross > 0) cash(gross, 'Sales', 'income');
  // demand drifts toward baseline (active lines only — a paused line keeps
  // its market pull frozen while it's off the floor)
  for (const p of activeProducts(b)) p.demand = clampInt(p.demand + (p.demand < (p.baseDemand ?? 5) ? 1 : p.demand > (p.baseDemand ?? 5) ? -1 : 0), 0, 10);

  // morale feeds profit margin
  if (b.attributes.morale >= 8) { cash(40, 'Productivity bonus', 'income'); attr('profit', 1); }
  if (b.attributes.morale <= 2) { cash(-30, 'Slack & errors'); attr('profit', -1); }

  // ── 8. weekly story event ────────────────────────────────────────────
  // one categorized, difficulty-scaled event per week; it lands in pending
  // and waits for the table's word before its deadline (see story-events.mjs)
  let event = null;
  const ev = rollWeeklyEvent(b, rng, dateLabelFor);
  if (ev) {
    b.story.pending.push(ev);
    event = { id: ev.id, title: ev.title, text: ev.text, cat: ev.cat, difficulty: ev.difficulty, dateLabel: ev.dateLabel, dueDateLabel: ev.dueDateLabel ?? null, dueIn: ev.dueIn };
    b.log.unshift({ id: uid('log'), week: b.week.index, type: `ev_${ev.cat}`, title: ev.title, text: `${ev.text} — lands ${ev.dateLabel}${ev.dueDateLabel ? `, resolve by ${ev.dueDateLabel}` : `, ${ev.dueIn}w to resolve`}.`, at: Date.now() });
  }

  // ── 9. danger drift + debt stress ──────────────────────────────────────
  attr('danger', d(rng, 3) - 2 - Math.min(1, Math.round(power.security * 0.5))); // wander, soothed by security
  if (b.treasury.cash < 0) {
    attr('danger', 1);
    attr('morale', -1);
    notes.push('Debt collectors are circling — the treasury is underwater.');
  }

  // ── 9b. profit standing — success draws attention, failure draws doubt ──
  // Read BEFORE this week's net updates the dial: the table reacts to the
  // track record they can see, not the week that just ended.
  const standing = b.attributes.profit;
  if (standing >= 8 && d(rng, 3) === 3) { // slow creep — the underworld notices a fat purse
    attr('danger', 1);
    notes.push('Word of your success spreads through the district — the underworld takes notice.');
  }
  if (standing <= 2) {
    attr('leadership', -1);
    notes.push('The backers read the ledger and lose confidence.');
  }
  if (standing <= 1 && b.week.index % 2 === 0) {
    attr('morale', -1);
    notes.push('Layoff rumors move through the crew.');
  }

  // profit attribute trends with recent net results
  const net = b.treasury.cash - (business.treasury.cash); // approx this week's net
  attr('profit', net > 150 ? 1 : net < -150 ? -1 : 0);

  // ── 10. ledger ─────────────────────────────────────────────────────────
  b.week.index += 1;
  b.week.lastLabel = weekLabel;
  b.week.lastRunAt = Date.now();
  const income = lines.filter((l) => l.kind === 'income').reduce((s, l) => s + l.amount, 0);
  const expenses = lines.filter((l) => l.kind === 'expense').reduce((s, l) => s + -l.amount, 0);
  b.treasury.history.push({
    index: b.week.index, label: weekLabel,
    income: Math.round(income), expenses: Math.round(expenses), net: Math.round(income - expenses),
    cash: Math.round(b.treasury.cash), attrs: { ...b.attributes }
  });
  if (b.treasury.history.length > 104) b.treasury.history.splice(0, b.treasury.history.length - 104);

  return {
    business: b,
    report: {
      weekIndex: b.week.index, label: weekLabel,
      income: Math.round(income), expenses: Math.round(expenses), net: Math.round(income - expenses),
      cash: Math.round(b.treasury.cash),
      crew, crewNeeded: heads, staffing: Math.round(staffRatio * 100),
      lines, notes, deltas, event, expired, competitors: compNotes
    }
  };
}

/**
 * Project the upcoming week's ledger WITHOUT running it — same math as
 * resolveWeek with the random sales factor at its mean (1.0). Events and
 * rival moves can't be foreseen; this is the expected baseline.
 * Pure: does not mutate the business.
 */
export function projectWeek(business) {
  const b = business;
  const lines = [];
  const push = (kind, label, amount) => {
    if (!amount) return;
    lines.push({ kind, label, amount: Math.round(amount) });
  };

  const power = domainPower(b);
  const leadMult = leadershipIncomeMult(b);
  const spendMult = financeCostMult(b);

  const wages = b.staff.workers.reduce((s, w) => s + (w.wage ?? 10), 0) * wageLevel(b);
  push('expense', `Wages (${b.staff.workers.length} staff)`, -Math.round(wages * spendMult));
  const rosterWages = (b.leadership?.roles ?? []).filter((r) => r.actorUuid).reduce((s, r) => s + Math.max(0, r.wage ?? 0), 0)
    + (b.leadWorkers ?? []).filter((w) => w.actorUuid).reduce((s, w) => s + Math.max(0, w.wage ?? 0), 0);
  if (rosterWages > 0) push('expense', 'Leadership wages', -Math.round(rosterWages * wageLevel(b) * spendMult));
  push('expense', `Marketing push (Lv ${b.spend.marketing})`, -Math.round(b.spend.marketing * MARKETING_SPEND_COST * spendMult));
  push('expense', `Upkeep & security (Lv ${b.spend.maintenance})`, -Math.round(b.spend.maintenance * MAINTENANCE_SPEND_COST * spendMult));

  const heads = crewNeeded(b);
  const crew = b.staff.workers.length;
  // opsStretch mirrors resolveWeek §7 — see there for the rationale
  const opsStretch = 1 + Math.min(0.25, power.operations * 0.05);
  const staffRatio = heads > 0 ? clamp((crew * opsStretch) / heads, 0, 1) : 1;
  const qualMult = 1 + (avgProductivity(b) - 5) / 20;
  const mkt = 0.6 + b.attributes.marketing / 12 + Math.min(0.15, power.marketing * 0.05)
    + Math.max(0, (b.attributes.profit - 5) * 0.02);
  const dangerMult = 1 - b.attributes.danger * 0.03;
  const fac = facilityEfficiency(b);
  let gross = 0;
  const products = [];
  for (const p of activeProducts(b)) {
    const priceFactor = Math.max(0.15, 1 - (p.value ?? 10) / 110);
    const units = Math.max(0, p.demand * mkt * dangerMult * staffRatio * fac * leadMult * 3 * priceFactor);
    const revenue = Math.round(units * (p.value ?? 10) * qualMult);
    gross += revenue;
    products.push({ name: p.name, units: Math.round(units), revenue });
  }
  if (gross > 0) push('income', 'Sales', gross);
  if (b.attributes.morale >= 8) push('income', 'Productivity bonus', 40);
  if (b.attributes.morale <= 2) push('expense', 'Slack & errors', -30);

  const income = lines.filter((l) => l.kind === 'income').reduce((s, l) => s + l.amount, 0);
  const expenses = lines.filter((l) => l.kind === 'expense').reduce((s, l) => s + -l.amount, 0);
  return {
    lines,
    products,
    crew, crewNeeded: heads, staffing: Math.round(staffRatio * 100),
    income: Math.round(income),
    expenses: Math.round(expenses),
    net: Math.round(income - expenses),
    cashAfter: Math.round(b.treasury.cash + income - expenses),
    factors: {
      facility: Math.round(fac * 100),
      staff: Math.round(staffRatio * 100),
      market: Math.round(mkt * 100),
      danger: Math.round(dangerMult * 100)
    }
  };
}


