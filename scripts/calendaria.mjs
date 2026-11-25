// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — Calendaria adapter (optional dependency)
// All Calendaria access funnels through this file. If Calendaria is missing
// the module falls back to an internal week counter — everything still works.
// ═══════════════════════════════════════════════════════════════════════════

export function calendariaActive() {
  try {
    return !!game.modules.get('calendaria')?.active && !!globalThis.CALENDARIA?.api;
  } catch {
    return false;
  }
}

/** Human-readable current in-world date, or null without Calendaria. */
export function currentDateLabel() {
  if (!calendariaActive()) return null;
  try {
    return CALENDARIA.api.formatDate(undefined, 'dateLong')
      ?? CALENDARIA.api.formatDate(CALENDARIA.api.getCurrentDateTime(), 'dateLong');
  } catch (err) {
    console.warn('cypher-business | Calendaria date failed:', err);
    return null;
  }
}

/**
 * In-world date label `days` from now, or null without Calendaria / on any
 * API surprise. Used to date weekly story events; callers fall back to
 * engine-side "Day N" labels.
 */
export function dateLabelAfterDays(days) {
  if (!calendariaActive()) return null;
  try {
    const now = CALENDARIA.api.getCurrentDateTime();
    // Calendaria datetimes are plain objects {year, month, day, ...} in its
    // current API; offset via its own clock math when available, else Date.
    if (now && typeof CALENDARIA.api.addTime === 'function') {
      const shifted = CALENDARIA.api.addTime(now, { day: days });
      return CALENDARIA.api.formatDate(shifted, 'dateLong');
    }
    if (now && typeof now === 'object' && 'day' in now) {
      const d = new Date(now.year ?? 2026, (now.month ?? 1) - 1, (now.day ?? 1) + days);
      return d.toLocaleDateString(game.i18n.lang, { dateStyle: 'long' });
    }
    const d = new Date(Date.now() + days * 86400000);
    return d.toLocaleDateString(game.i18n.lang, { dateStyle: 'long' });
  } catch (err) {
    console.warn('cypher-business | Calendaria date offset failed:', err);
    return null;
  }
}

/** Advance the world clock by N days (GM only — Calendaria routes via socket). */
export async function advanceDays(days) {
  if (!calendariaActive()) return false;
  try {
    await CALENDARIA.api.advanceTime({ day: days });
    return true;
  } catch (err) {
    console.warn('cypher-business | Calendaria advanceTime failed:', err);
    return false;
  }
}

/** Open Calendaria's big calendar, if present. */
export function openCalendaria() {
  if (!calendariaActive()) return false;
  try {
    CALENDARIA.api.showBigCal();
    return true;
  } catch (err) {
    console.warn('cypher-business | Calendaria showBigCal failed:', err);
    return false;
  }
}
