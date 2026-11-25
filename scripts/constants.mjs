// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — constants & shared utils
// ═══════════════════════════════════════════════════════════════════════════

export const MODULE_ID = 'cypher-business';
export const MODULE_VERSION = '1.44.0';

export const SOCKET_CHANNEL = `system.${MODULE_ID}`;

/** Business attributes — the six dials everything revolves around. */
export const ATTRIBUTES = ['profit', 'marketing', 'personnel', 'leadership', 'morale', 'danger'];
export const ATTR_MAX = 10;
export const ATTR_MIN = 0;

/** Story-event category → icon class (full FontAwesome string for the template). */
export const EVENT_CAT_ICONS = {
  global: 'fas fa-globe', business: 'fas fa-briefcase', leadership: 'fas fa-crown',
  personnel: 'fas fa-users', competition: 'fas fa-chess-knight', facility: 'fas fa-warehouse',
  product: 'fas fa-box-open', crisis: 'fas fa-skull-crossbones'
};

/** Weekly spend knobs (levels 0–5). */
export const SPEND_LEVELS = [0, 1, 2, 3, 4, 5];
export const MARKETING_SPEND_COST = 25;   // cash per level
export const MAINTENANCE_SPEND_COST = 20; // cash per level
export const WAGE_LEVELS = [0.6, 0.8, 1.0, 1.2, 1.5]; // multiplier of base wage

/** Leadership domains — each role influences a different segment of the business. */
export const ROLE_DOMAINS = ['leadership', 'operations', 'marketing', 'finance', 'security'];

/** Per-role stat ranges. */
export const ROLE_STAT_MAX = { productivity: 10, morale: 10, loyalty: 10, strength: 5 };
export function defaultRoleStats() {
  return { productivity: 5, morale: 5, loyalty: 5, strength: 5 };
}

/** Default leadership roles a fresh business starts with (title + domain). */
export const DEFAULT_ROLES = [
  { title: 'Chief Executive', domain: 'leadership' },
  { title: 'Operations Manager', domain: 'operations' },
  { title: 'Marketing Director', domain: 'marketing' },
  { title: 'Finance Officer', domain: 'finance' },
  { title: 'Security Chief', domain: 'security' }
];

/** Keyword guess for migrating legacy/custom roles onto a domain. */
export function guessDomain(title = '') {
  const t = String(title).toLowerCase();
  if (/secur|guard|enforc|warden/.test(t)) return 'security';
  if (/market|advert|promo|brand|trader|sales/.test(t)) return 'marketing';
  if (/financ|account|treasur|econom|quarter|bookkeep/.test(t)) return 'finance';
  if (/operat|logistic|foreman|production|supply|crew chief/.test(t)) return 'operations';
  return 'leadership';
}

/** Leading-worker slots — promoted crew under the leadership, actor-droppable. */
export const LEAD_WORKER_ROLES = [
  'Floor Foreman',
  'Shift Supervisor',
  'Head of Security',
  'Quartermaster',
  'Chief Accountant',
  'Head of Sales',
  'Master Artisan',
  'Chief Medic',
  'Head Porter',
  'Union Representative'
];

/** Schema version for world state. Bump + add migration when shape changes. */
export const STATE_VERSION = 8;

// ─── tiny helpers ──────────────────────────────────────────────────────────

export function clamp(value, min = ATTR_MIN, max = ATTR_MAX) {
  const n = Number(value);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function clampInt(value, min = ATTR_MIN, max = ATTR_MAX) {
  return Math.round(clamp(value, min, max));
}

export function clamp100(value) {
  return Math.round(clamp(value, 0, 100));
}

let _uidCounter = 0;
/** Collision-safe-ish id without crypto dependency. */
export function uid(prefix = 'id') {
  _uidCounter = (_uidCounter + 1) % 0xffff;
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}${_uidCounter.toString(36)}`;
}

/** Escape a value for safe interpolation into an HTML string (chat cards). */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sign-aware number formatting: -12, +300 */
export function signed(n) {
  const v = Math.round(Number(n) || 0);
  return v > 0 ? `+${v}` : `${v}`;
}

/** d6 helper using an injectable rng (Math.random by default). */
export function d(rng, sides = 6) {
  return 1 + Math.floor(rng() * sides);
}

/** Simple weighted pick from [{ w, ... }] entries. */
export function weightedPick(entries, rng) {
  const total = entries.reduce((sum, e) => sum + (e.w ?? 1), 0);
  let roll = rng() * total;
  for (const e of entries) {
    roll -= (e.w ?? 1);
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}
