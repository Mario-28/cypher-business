// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — world state store
// One world-scoped setting holds every business, keyed by id, versioned for
// migrations. Only the GM client ever writes; everyone reads.
// ═══════════════════════════════════════════════════════════════════════════

import {
  MODULE_ID, STATE_VERSION, ATTRIBUTES, ATTR_MAX, ATTR_MIN,
  DEFAULT_ROLES, LEAD_WORKER_ROLES, WAGE_LEVELS, uid, clampInt, clamp100,
  defaultRoleStats, ROLE_STAT_MAX, ROLE_DOMAINS, guessDomain
} from '../constants.mjs';
import { rollPersona, rollAppearance, rollTraits, seededRng } from '../engine/people.mjs';
import * as rivalsFlavor from '../engine/rivals.mjs';
import { EVENT_DEFS, SKILL_BONUS, stepsFor } from '../engine/story-events.mjs';

export function defaultAttributes() {
  return { profit: 5, marketing: 5, personnel: 5, leadership: 5, morale: 5, danger: 3 };
}

export function defaultSpend() {
  return { marketing: 2, maintenance: 2, wage: 2 }; // index into WAGE_LEVELS for wage
}

export function emptyState() {
  return { version: STATE_VERSION, businesses: {} };
}

export function createBusiness(name) {
  return {
    id: uid('biz'),
    name: name || 'New Business',
    description: '',
    banner: null,              // image path (Foundry file picker) or null
    createdAt: Date.now(),
    managers: [],              // user ids allowed to run weeks / edit
    attributes: defaultAttributes(),
    treasury: { cash: 500, history: [] },
    spend: defaultSpend(),
    leadership: {
      roles: DEFAULT_ROLES.map(({ title, domain }) => ({
        id: uid('role'), title, domain,
        actorUuid: null, actorName: null, portrait: null, actorIsNPC: true, note: '',
        ...defaultRoleStats()
      }))
    },
    leadWorkers: defaultLeadWorkers(),
    staff: { workers: [] },
    facilities: [],
    products: [],
    competitors: [],
    pending: [],               // DEPRECATED v7 — superseded by story.pending (migrated below)
    story: { pending: [], journal: [] }, // weekly story events: open + history
    log: [],                   // journal of past weeks / notable moments
    week: { index: 0, lastLabel: null, lastRunAt: null }
  };
}

export function defaultFacility() {
  return { id: uid('fac'), name: 'Main Facility', condition: 80, capacity: 10, note: '', sceneId: null };
}

export function defaultProduct() {
  // v1.23 economy: value = per-unit profit; demand = market pull; workersDemand =
  // headcount the line needs. price/cost/stock are gone.
  return { id: uid('prod'), name: 'New Product', kind: 'product', value: 10, demand: 5, baseDemand: 5, workersDemand: 2, active: true, itemId: null };
}

export function defaultCompetitor() {
  return { id: uid('comp'), name: 'Rival Co.', strength: 5, aggression: 4, focus: 'Undercutting prices', note: '', description: '', npcs: [], pressure: 0 };
}

/** Ten promoted-crew slots — same actor drop + stats as leadership, half engine weight. */
export function defaultLeadWorkers() {
  return LEAD_WORKER_ROLES.map((title) => ({
    id: uid('lw'), title, domain: guessDomain(title),
    actorUuid: null, actorName: null, portrait: null, actorIsNPC: true, note: '', wage: 0,
    ...defaultRoleStats()
  }));
}

// ─── load / save ────────────────────────────────────────────────────────────

export function loadState() {
  const raw = game.settings.get(MODULE_ID, 'state');
  return migrate(raw ?? emptyState());
}

/** Only valid on the GM client — enforced by callers, double-checked here. */
export async function saveState(state) {
  if (!game.user.isGM) {
    console.warn('cypher-business | saveState called on non-GM client — refused.');
    return;
  }
  await game.settings.set(MODULE_ID, 'state', state);
}

// ─── migrations ─────────────────────────────────────────────────────────────

export function migrate(state) {
  let s = state ?? emptyState();
  if (typeof s.version !== 'number') s.version = 0;
  // v2 — leadership role stats, domains, portraits; v3 — leading workers get the same
  // v4 — workers: quality→productivity, force dropped (effectiveness is derived), gender added
  s.version = STATE_VERSION;
  s.businesses ??= {};
  for (const [bizId, b] of Object.entries(s.businesses)) {
    b.id ??= bizId; // map key IS the lookup id — never let a backfill invent a new one
    // v1.32 — defensive skeleton backfill. Hand-imported or pre-release states
    // can be missing whole sections while passing backup validation; every
    // engine/app loop assumes they exist. ??= fills gaps only — idempotent.
    b.name ??= 'Unnamed Business';
    const skel = createBusiness(b.name);
    for (const [k, v] of Object.entries(skel)) b[k] ??= v;
    // partial parents survive top-level ??= — merge/repair the nested bits
    b.attributes = { ...defaultAttributes(), ...(b.attributes ?? {}) };
    b.spend = { ...defaultSpend(), ...(b.spend ?? {}) };
    b.treasury ??= skel.treasury;
    b.treasury.cash ??= 500;
    b.treasury.history ??= [];
    if (!Array.isArray(b.staff?.workers)) b.staff = { workers: [] };
    if (!Array.isArray(b.leadership?.roles)) b.leadership = skel.leadership;
    b.banner ??= null;
    b.leadWorkers ??= defaultLeadWorkers();
    for (const w of b.staff?.workers ?? []) {
      if (typeof w.productivity !== 'number' && typeof w.quality === 'number') w.productivity = clampInt(w.quality, 0, 10);
      delete w.quality;
      delete w.force;
      if (!['f', 'm'].includes(w.gender)) {
        const h = [...(w.name ?? w.id)].reduce((sum, c) => sum + c.charCodeAt(0), 0);
        w.gender = h % 2 ? 'f' : 'm'; // deterministic — legacy 'x' rosters convert on load
      }
      if (!w.description || !Array.isArray(w.traits) || w.traits.length !== 3) {
        const persona = rollPersona(w, seededRng(w.name ?? w.id));
        w.description = persona.description;
        w.traits = persona.traits;
      }
      if (!w.look || typeof w.look !== 'object') {
        // ':look' seed namespace — personas from earlier versions stay untouched
        w.look = rollAppearance(w, seededRng(`${w.name ?? w.id}:look`));
      }
    }
    for (const r of b.leadership?.roles ?? []) {
      r.domain ??= guessDomain(r.title);
      r.portrait ??= null;
      r.actorIsNPC ??= true;
      const defs = defaultRoleStats();
      for (const [k, v] of Object.entries(defs)) {
        const max = ROLE_STAT_MAX[k];
        r[k] = typeof r[k] === 'number' ? clampInt(r[k], 0, max) : v;
      }
      r.wage = typeof r.wage === 'number' ? Math.max(0, Math.round(r.wage)) : 0;
    }
    // v7 — story event system replaces the flat problem table
    b.story ??= { pending: [], journal: [] };
    b.story.pending ??= [];
    b.story.journal ??= [];
    if (Array.isArray(b.pending)) {
      for (const p of b.pending) {
        // legacy problems become story events carrying their own outcome specs,
        // so old saves keep playable deadlines instead of being silently dropped
        b.story.pending.push({
          id: p.id ?? uid('ev'),
          defId: 'legacy_problem',
          cat: 'business',
          difficulty: 4,
          dc: 12,
          title: p.title ?? 'Unresolved matter',
          text: p.text ?? '',
          approaches: (Array.isArray(p.options) && p.options.length
            ? p.options
            : [{ label: 'Handle it in-house' }, { label: 'Throw coin at it' }]
          ).map((o) => ({ label: o.label ?? 'Deal with it', pool: 'intellect', skill: 'none', asset: 0 })),
          success: { cash: p.options?.[0]?.cash ?? 0, note: p.options?.[0]?.text ?? 'Settled, at last.' },
          fail: { attrs: { danger: 1, morale: -1 }, note: 'It festers, as these things do.' },
          dateLabel: '—',
          dueIn: Math.max(0, p.deadline ?? 0),
          createdWeek: b.week?.index ?? 0
        });
      }
      delete b.pending;
    }
    // v8 — events go diceless: approach lists become 3+ solutions with steps + per-solution stakes
    for (const ev of b.story.pending ?? []) {
      if (Array.isArray(ev.solutions) && ev.solutions.length >= 3 && Array.isArray(ev.progress)) continue;
      const def = EVENT_DEFS.find((d) => d.id === ev.defId);
      const legacySuccess = ev.success ?? { note: 'Settled.' };
      const legacyFail = ev.fail ?? { attrs: { danger: 1, morale: -1 }, note: 'It festers, as these things do.' };
      let sols;
      if (def?.solutions) {
        // live definition — adopt its authored stakes, steps scaled by the event's difficulty
        sols = def.solutions.map((s) => ({
          ...structuredClone(s),
          steps: stepsFor(Math.max(1, s.steps ?? 1), ev.difficulty ?? 4)
        }));
      } else {
        // legacy ad-hoc approaches (or the synthetic legacy_problem) — keep their labels,
        // carry the event's embedded stakes into every solution, pad to three
        sols = (Array.isArray(ev.approaches) ? ev.approaches : []).filter(Boolean).map((a) => ({
          label: a.label ?? 'Deal with it',
          desc: a.desc ?? a.text ?? '',
          pool: ['might', 'speed', 'intellect'].includes(a.pool) ? a.pool : 'intellect',
          skill: Object.hasOwn(SKILL_BONUS, a.skill) ? a.skill : 'none',
          asset: Math.max(0, a.asset ?? 0),
          steps: stepsFor(1, ev.difficulty ?? 4),
          success: structuredClone(legacySuccess),
          fail: structuredClone(legacyFail)
        }));
        if (!sols.length) {
          sols = [{ label: 'Handle it in-house', desc: '', pool: 'intellect', skill: 'none',
                    asset: 0, steps: stepsFor(1, ev.difficulty ?? 4),
                    success: structuredClone(legacySuccess), fail: structuredClone(legacyFail) }];
        }
        while (sols.length < 3) {
          const last = sols[sols.length - 1];
          sols.push({ ...structuredClone(last), label: sols.length === 1 ? 'The bold play' : 'The safe route' });
        }
      }
      ev.solutions = sols;
      ev.progress = sols.map((_, i) => (Array.isArray(ev.progress) ? (ev.progress[i] ?? 0) : 0));
      delete ev.approaches;
      delete ev.success;
      delete ev.fail;
      delete ev.dc; // diceless — the dc only fed the old roll dialog
    }
    // pre-v8 journal entries recorded failures as 'failure'; the diceless
    // journal vocabulary is success / fail / expired (i18n + CSS key off it)
    for (const j of b.story.journal) {
      if (j.outcome === 'failure') j.outcome = 'fail';
      j.id ??= uid('jev'); // checkbox-scrub needs stable ids on legacy entries
    }
    for (const f of b.facilities ?? []) {
      f.sceneId ??= null; // v1.21 — scene-tied cards (header image + visit)
      f.capacity ??= 10;
    }
    for (const p of b.products ?? []) {
      p.itemId ??= null; // v1.22 — item-tied cards (header image)
      // v1.23 economy rework: value replaces price/cost (per-unit profit),
      // workersDemand replaces the stock convention (headcount per line)
      if (typeof p.value !== 'number') p.value = clampInt(p.price ?? 10, 0, 100);
      if (typeof p.workersDemand !== 'number') p.workersDemand = 2;
      delete p.price; delete p.cost; delete p.stock;
    }
    for (const c of b.competitors ?? []) {
      c.npcs ??= [];
      c.pressure = Number.isFinite(c.pressure) ? clampInt(c.pressure, 0, 10) : 0;
      // intel fields: the two new profile lines generate once when empty —
      // they are v1.20 fields so no GM text can exist yet. Description stays
      // GM-authored (v1.18 rule: migration never authors it).
      const { rollHouseProfile } = rivalsFlavor;
      c.description ??= '';
      if (!c.services) c.services = rollHouseProfile(c).services;
      if (!c.facilities) c.facilities = rollHouseProfile(c).facilities;
      for (const n of c.npcs) {
        const gRng = seededRng(`${n.name ?? n.id}:g`);
        n.gender = ['f', 'm'].includes(n.gender) ? n.gender : (gRng() < 0.5 ? 'f' : 'm');
        n.title ??= 'The Fixer';
        n.age ??= 30;
        n.note ??= '';
        if (!Array.isArray(n.traits)) n.traits = rollTraits(seededRng(`${n.name ?? n.id}:t`));
        n.description ||= `Around the house, the staff just say "${n.traits[0]}."`;
        if (!n.look || typeof n.look !== 'object') n.look = rollAppearance(n, seededRng(`${n.name ?? n.id}:look`));
      }
    }
    for (const w of b.leadWorkers ?? []) {
      w.domain = ROLE_DOMAINS.includes(w.domain) ? w.domain : guessDomain(w.title);
      w.portrait ??= null;
      w.actorIsNPC ??= true;
      w.note ??= '';
      const defs = defaultRoleStats();
      for (const [k, v] of Object.entries(defs)) {
        const max = ROLE_STAT_MAX[k];
        w[k] = typeof w[k] === 'number' ? clampInt(w[k], 0, max) : v;
      }
      w.wage = typeof w.wage === 'number' ? Math.max(0, Math.round(w.wage)) : 0;
    }
  }
  return s;
}

// ─── selectors ──────────────────────────────────────────────────────────────

export function listBusinesses(state) {
  return Object.values(state?.businesses ?? {});
}

export function getBusiness(state, id) {
  return state?.businesses?.[id] ?? null;
}

/** May this user request a week run for this business? (GM always; managers
 *  since v1.24.0 have view + week-request only — editing is GM-only.) */
export function canManage(business, user) {
  if (!business || !user) return false;
  return user.isGM || business.managers.includes(user.id);
}

// ─── mutations (operate on a draft; caller saves) ──────────────────────────

export function addLog(business, type, text, label = null) {
  business.log.unshift({ id: uid('log'), week: business.week.index, label, type, text, at: Date.now() });
  if (business.log.length > 200) business.log.length = 200;
}

/** Apply a list of { attr, delta } effects to attributes, clamped. */
export function applyAttrEffects(business, effects) {
  const deltas = {};
  for (const e of effects ?? []) {
    if (!ATTRIBUTES.includes(e.attr)) continue;
    const before = business.attributes[e.attr];
    business.attributes[e.attr] = clampInt(before + (e.delta ?? 0), ATTR_MIN, ATTR_MAX);
    const actual = business.attributes[e.attr] - before;
    if (actual !== 0) deltas[e.attr] = (deltas[e.attr] ?? 0) + actual;
  }
  return deltas;
}
