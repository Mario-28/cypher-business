// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — roll-link mode (v1.25.0)
// Lets a GM arm a pending story-event solution to resolve off the NEXT chat
// roll instead of a hand-clicked verdict: total vs DC (difficulty × 3).
//
// This file is Foundry-free: all state lives module-locally, time is
// injectable, and the chat hook is installed from the app via initRollLink().
// That keeps the decision helpers unit-testable in plain node.
// ═══════════════════════════════════════════════════════════════════════════

export const LINK_TTL_MS = 90_000;

// ── module-local arm state (one per client — the arming GM's client) ────────
let armed = null; // {businessId, eventId, solutionIndex, dc, title, expiresAt}

export function getLink() { return armed; }

export function isLinkWaiting(eventId, solutionIndex, now = Date.now()) {
  return !!armed && armed.eventId === eventId && armed.solutionIndex === solutionIndex
    && armed.expiresAt > now;
}

/** Arm (or re-arm) the one-shot link. Passing the same target disarms it. */
export function armLink(target, now = Date.now()) {
  if (armed && armed.eventId === target.eventId && armed.solutionIndex === target.solutionIndex
    && armed.expiresAt > now) {
    armed = null;
    return null;
  }
  armed = { ...target, expiresAt: now + LINK_TTL_MS };
  return armed;
}

export function disarm() { armed = null; }

// ── pure decision helpers (unit-tested) ─────────────────────────────────────

/** Outcome of a roll total against a Cypher DC — ties succeed. */
export function outcomeForRoll(total, dc) {
  return Number(total) >= Number(dc) ? 'success' : 'fail';
}

/**
 * Pull the final total out of a Foundry chat message (v14: message.rolls is
 * an array of Roll instances). Returns null when the message has no roll —
 * text chatter, cards, whispers must never consume a link.
 */
export function extractRollTotal(message) {
  const rolls = message?.rolls;
  if (!Array.isArray(rolls) || rolls.length === 0) return null;
  const total = rolls[0]?.total;
  return Number.isFinite(total) ? total : null;
}

/** Display name for whoever threw the linked roll. */
export function rollRollerName(message) {
  return message?.speaker?.alias || message?.user?.name || '—';
}

// ── chat hook (wired by the app; callbacks keep this file game-free) ────────

/**
 * Install the createChatMessage hook. `onRoll(payload)` runs on the arming
 * client when a linked roll lands (payload adds total/outcome/rollerName).
 * `onExpire()` re-renders UI so the waiting state clears when the TTL lapses.
 */
export function initRollLink({ onRoll, onExpire } = {}) {
  if (typeof Hooks === 'undefined') return; // plain-node imports: no-op
  Hooks.on('createChatMessage', (message) => {
    if (!armed) return;
    const now = Date.now();
    if (armed.expiresAt <= now) { disarm(); onExpire?.(); return; }
    if (typeof game !== 'undefined' && !game.user.isGM) return; // only the arming GM resolves
    const total = extractRollTotal(message);
    if (total === null) return; // not a roll message — keep waiting
    const payload = { ...armed, total, outcome: outcomeForRoll(total, armed.dc), rollerName: rollRollerName(message) };
    disarm();
    onRoll?.(payload);
  });
}
