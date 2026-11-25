// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — state backup validator (Foundry-free, unit-testable)
// Export wraps the live settings state in an envelope; import validates the
// envelope BEFORE touching anything. Old backups are fine: the store's
// migrate() upgrades them on the way in.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate a parsed backup envelope or bare state object.
 * Accepts either our export envelope { module, state } or a raw
 * { version, businesses } state (e.g. hand-rolled). Never throws.
 * @returns {{ok:true, businesses:number, enveloped:boolean} | {ok:false, reason:string}}
 */
export function validateBackup(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'not-an-object' };
  }
  // Envelope markers decide how we read it: an envelope wraps the state under
  // `state`; anything else IS the state itself (hand-rolled backups).
  const enveloped = typeof data.module === 'string' || data.kind === 'state-backup';
  const state = enveloped ? data.state : data;
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, reason: 'no-state' };
  }
  if (typeof state.businesses !== 'object' || state.businesses === null || Array.isArray(state.businesses)) {
    return { ok: false, reason: 'no-businesses' };
  }
  let count = 0;
  for (const [key, b] of Object.entries(state.businesses)) {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) {
      return { ok: false, reason: `business-${key}-not-an-object` };
    }
    if (typeof b.id !== 'string' || !b.id) return { ok: false, reason: `business-${key}-no-id` };
    if (typeof b.name !== 'string' || !b.name) return { ok: false, reason: `business-${key}-no-name` };
    if (b.staff === null || typeof b.staff !== 'object') return { ok: false, reason: `business-${key}-no-staff` };
    if (!Array.isArray(b.staff.workers)) return { ok: false, reason: `business-${key}-no-workers` };
    if (b.week === null || typeof b.week !== 'object') return { ok: false, reason: `business-${key}-no-week` };
    if (typeof b.week.index !== 'number') return { ok: false, reason: `business-${key}-no-week-index` };
    count += 1;
  }
  return { ok: true, businesses: count, enveloped };
}

/**
 * Build the export envelope around a live state object.
 */
export function buildEnvelope(state, { moduleId, moduleVersion, stateVersion, exportedBy } = {}) {
  return {
    module: moduleId ?? 'cypher-business',
    kind: 'state-backup',
    moduleVersion: moduleVersion ?? null,
    stateVersion: stateVersion ?? state?.version ?? null,
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy ?? null,
    state
  };
}
