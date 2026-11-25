// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — facility operations (Foundry-free engine)
// Instant GM actions that trade cash for facility state. Weekly wear/repair
// lives in week.mjs; this is the on-demand lever (audit candidate #2).
// ═══════════════════════════════════════════════════════════════════════════

import { clamp100 } from '../constants.mjs';

/** Condition points restored per renovation purchase. */
export const RENOVATE_GAIN = 15;

/**
 * Cash cost of one renovation, scaled by facility size — bigger plants need
 * bigger crews and materials. Floored so tiny kiosks still pay something.
 */
export function renovateCost(facility) {
  return Math.max(25, Math.round((facility?.capacity || 5) * 8));
}

/**
 * Instant renovation: treasury → condition. Mutates the business in place.
 * Returns { ok:true, cost, gain, condition, name } on success, or
 * { ok:false, reason:'missing'|'pristine'|'cash', ... } without touching state.
 */
export function renovate(business, facilityId) {
  const f = (business?.facilities ?? []).find((x) => x.id === facilityId);
  if (!f) return { ok: false, reason: 'missing' };
  if ((f.condition ?? 0) >= 100) return { ok: false, reason: 'pristine' };
  const cost = renovateCost(f);
  if ((business.treasury?.cash ?? 0) < cost) return { ok: false, reason: 'cash', cost };
  const gain = Math.min(RENOVATE_GAIN, 100 - f.condition);
  business.treasury.cash -= cost;
  f.condition = clamp100((f.condition ?? 0) + gain);
  return { ok: true, cost, gain, condition: f.condition, name: f.name };
}
