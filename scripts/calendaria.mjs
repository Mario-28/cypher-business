// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — Calendaria adapter (optional dependency)
// All Calendaria access funnels through this file. If Calendaria is missing
// the module falls back to an internal week counter — everything still works.
// Duties: date labels, world-clock advance, big-cal opener, AND the v1.43
// deadline-note surface (player-visible Calendaria notes + end-of-week
// popup reminders for every business — see the bottom section).
// ═══════════════════════════════════════════════════════════════════════════

import { WAGE_LEVELS, clampInt, esc } from './constants.mjs';
import { EVENT_CAT_INFO } from './engine/story-events.mjs';
import { loadState, saveState } from './state/store.mjs';

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

// ── deadline notes + week-close reminder (v1.43) ─────────────────────────────
//
// Every pending story event becomes a PLAYER-VISIBLE Calendaria note dated
// at its resolve-by day (landing day + dueIn weeks), with a `dialog` reminder
// targeted at ALL users one day before the deadline — Calendaria's own
// ReminderScheduler pops it on every client, no socket work on our side.
// Each business also gets one rolling "week close" briefing note dated one
// week out: it pops at the end of the week with the current open events,
// staffing, cash and trouble flags. Note ids are remembered in
// business.story.calNoteIds so re-syncs update instead of duplicate.

const NOTE_CATEGORY = 'business';
const WEEK_NOTE_KEY = 'week';
const WEEK_NOTE_DAYS = 7;

function calApi() {
  return calendariaActive() ? globalThis.CALENDARIA.api : null;
}

/** Current in-world date as {year, month, day}, or null. */
function nowDate() {
  const api = calApi();
  if (!api) return null;
  try {
    const dt = api.getCurrentDateTime();
    if (dt && typeof dt === 'object' && Number.isFinite(dt.year)) return dt;
    return null;
  } catch (err) {
    console.warn('cypher-business | Calendaria getCurrentDateTime failed:', err);
    return null;
  }
}

/**
 * In-world date `days` from `base`, via Calendaria's own clock math.
 * Returned shape {year, month, day} matches api.createNote's startDate:
 * month passes through untouched (Calendaria months are 0-indexed end to
 * end), day is 1-indexed (the API folds it to the data model's 0-indexed
 * dayOfMonth internally).
 */
function dateAfterDays(api, base, days) {
  try {
    const shifted = typeof api.addDays === 'function'
      ? api.addDays(base, days)
      : api.addTime?.(base, { day: days });
    if (!shifted || !Number.isFinite(shifted.year)) return null;
    return { year: shifted.year, month: shifted.month, day: (shifted.dayOfMonth ?? shifted.day ?? 0) + 1 };
  } catch (err) {
    console.warn('cypher-business | Calendaria date offset failed:', err);
    return null;
  }
}

async function safeGetNote(api, id) {
  try {
    return await api.getNote(id);
  } catch {
    return null;
  }
}

async function deleteNoteById(api, id) {
  try {
    await api.deleteNote(id);
  } catch (err) {
    console.warn(`cypher-business | Calendaria deleteNote(${id}) failed:`, err);
  }
}

/** Player-safe content: title + deadline + flavor text. NEVER the solutions
 *  (stakes are GM eyes only — the app is the GM's surface, notes are everyone's). */
function eventNoteContent(ev) {
  const due = ev.dueDateLabel ? `resolve by ${ev.dueDateLabel}` : `due in ${ev.dueIn} week(s)`;
  return `<p><strong>${esc(ev.title)}</strong> — ${esc(due)}.</p><p>${esc(ev.text)}</p>`;
}

/** The "relevant things" the week-close popup lists: open events, staffing,
 *  cash, and every quiet alarm that deserves a decision this week. */
function buildWeekBriefing(b) {
  const pending = b.story?.pending ?? [];
  const crew = b.staff?.workers?.length ?? 0;
  const needed = (b.products ?? []).filter((p) => p.active !== false)
    .reduce((s, p) => s + (p.workersDemand ?? 2), 0);
  const pct = needed > 0 ? Math.min(100, Math.round((crew / needed) * 100)) : 100;
  const lines = [];
  if (pending.length) {
    const nearest = pending.reduce((a, e) => ((e.dueIn ?? 99) < (a.dueIn ?? 99) ? e : a), pending[0]);
    lines.push(`Open events: ${pending.length} — nearest deadline ${nearest.dueDateLabel ?? `${nearest.dueIn}w`} (${nearest.title})`);
  } else {
    lines.push('Open events: none');
  }
  lines.push(`Crew: ${crew}/${needed} staffed (${pct}%)`);
  const wageMult = WAGE_LEVELS[clampInt(b.spend?.wage ?? 2, 0, WAGE_LEVELS.length - 1)];
  lines.push(`Cash: ${Math.round(b.treasury?.cash ?? 0)} · wage level ×${wageMult}`);
  const flags = [];
  if (pct < 100) flags.push(`Short-staffed — the lines want ${needed}, the payroll has ${crew}.`);
  if ((b.attributes?.morale ?? 5) <= 2) flags.push('Crew morale is critical.');
  if ((b.treasury?.cash ?? 0) < 0) flags.push('The treasury is underwater — debt collectors are circling.');
  for (const f of b.facilities ?? []) {
    if ((f.condition ?? 100) < 35) flags.push(`${f.name} is falling apart (condition ${Math.round(f.condition)}).`);
  }
  for (const c of b.competitors ?? []) {
    if ((c.pressure ?? 0) >= 9) flags.push(`${c.name} is one provocation from making a move.`);
  }
  const items = lines.map((l) => `<li>${esc(l)}</li>`).join('');
  const flagItems = flags.map((f) => `<li>${esc(f)}</li>`).join('');
  return `<p><strong>${esc(b.name)}</strong> — week ${b.week?.index ?? 0} closes soon. Run the weekly ledger from the business sheet.</p>`
    + `<ul>${items}</ul>`
    + (flagItems ? `<p>Watch:</p><ul>${flagItems}</ul>` : '');
}

/** Shared reminder/visibility fields — the popup + player permission core. */
function noteFields({ name, content, startDate, color, icon }) {
  return {
    name, content, startDate,
    allDay: true,
    repeat: 'never',
    categories: [NOTE_CATEGORY],
    color, icon,
    displayStyle: 'pip',
    visibility: 'visible',          // every player sees it on the calendar
    reminderType: 'dialog',        // pop-up dialog, not just a toast
    reminderOffset: 1,
    reminderUnit: 'day',           // …one day before the note's date
    reminderTargets: 'all',        // …on EVERY user's screen
    silent: false
  };
}

/**
 * Sync one business's Calendaria surface (deadline notes + week-close
 * briefing). Idempotent — safe after every state change. GM client only
 * (Calendaria note CRUD needs GM perms); no-ops without Calendaria or when
 * the world date is unavailable. Persists only when the note-id map changed.
 */
export async function syncBusinessCalendarNotes(businessId) {
  const api = calApi();
  if (!api || !game.user?.isGM) return false;
  const state = loadState();
  const b = state.businesses?.[businessId];
  if (!b) return false;
  const now = nowDate();
  if (!now) return false;
  const today = dateAfterDays(api, now, 0);
  if (!today) return false;

  b.story ??= {};
  const map = (b.story.calNoteIds ??= {});
  let dirty = false;

  // ── one deadline note per pending event ──
  const pending = b.story.pending ?? [];
  const pendingIds = new Set(pending.map((e) => e.id));
  for (const id of Object.keys(map)) {
    if (id === WEEK_NOTE_KEY || pendingIds.has(id)) continue;
    await deleteNoteById(api, map[id]); // resolved / expired / GM-deleted
    delete map[id];
    dirty = true;
  }
  for (const ev of pending) {
    const due = dateAfterDays(api, now, ev.dueInDays ?? ev.dueIn * WEEK_NOTE_DAYS);
    if (!due) continue;
    const hue = EVENT_CAT_INFO[ev.cat]?.hue ?? 35;
    const fields = noteFields({
      name: `⏳ ${b.name}: ${ev.title}`,
      content: eventNoteContent(ev),
      startDate: due,
      color: `hsl(${hue} 55% 55%)`,
      icon: 'fas fa-hourglass-half'
    });
    const existingId = map[ev.id];
    const existing = existingId ? await safeGetNote(api, existingId) : null;
    if (existing) {
      try {
        await api.updateNote(existingId, fields);
      } catch (err) {
        console.warn(`cypher-business | Calendaria updateNote(${existingId}) failed:`, err);
      }
    } else {
      try {
        const page = await api.createNote({
          name: fields.name, content: fields.content, startDate: due, categories: [NOTE_CATEGORY]
        });
        map[ev.id] = page.id;
        try {
          await api.updateNote(page.id, fields);
        } catch (err) {
          console.warn(`cypher-business | Calendaria updateNote(${page.id}) failed:`, err);
        }
        dirty = true;
      } catch (err) {
        console.warn('cypher-business | Calendaria createNote failed:', err);
      }
    }
  }

  // ── the rolling week-close briefing ──
  const weekName = `🔔 ${b.name} — week close`;
  const weekContent = buildWeekBriefing(b);
  const weekColor = '#d4af37';
  const weekId = map[WEEK_NOTE_KEY];
  const existingWeek = weekId ? await safeGetNote(api, weekId) : null;
  if (!existingWeek) {
    const weekDate = dateAfterDays(api, now, WEEK_NOTE_DAYS);
    if (weekDate) {
      const fields = noteFields({ name: weekName, content: weekContent, startDate: weekDate, color: weekColor, icon: 'fas fa-coins' });
      try {
        const page = await api.createNote({
          name: fields.name, content: fields.content, startDate: weekDate, categories: [NOTE_CATEGORY]
        });
        map[WEEK_NOTE_KEY] = page.id;
        try {
          await api.updateNote(page.id, fields);
        } catch (err) {
          console.warn(`cypher-business | Calendaria updateNote(${page.id}) failed:`, err);
        }
        dirty = true;
      } catch (err) {
        console.warn('cypher-business | Calendaria createNote (week close) failed:', err);
      }
    }
  } else {
    // refresh content always; RE-DATE only when the stored date has passed —
    // frequent syncs must not push the end-of-week popup forward forever.
    const s = existingWeek.flagData?.startDate ?? existingWeek.startDate;
    const stored = s ? { year: s.year, month: s.month ?? 0, day: (s.dayOfMonth ?? s.day ?? 1) } : null;
    const storedPast = stored
      && (stored.year < today.year
        || (stored.year === today.year && stored.month < today.month)
        || (stored.year === today.year && stored.month === today.month && stored.day < today.day));
    const fields = noteFields({
      name: weekName,
      content: weekContent,
      startDate: storedPast ? dateAfterDays(api, now, WEEK_NOTE_DAYS) : undefined,
      color: weekColor,
      icon: 'fas fa-coins'
    });
    if (!fields.startDate) delete fields.startDate; // partial update keeps the stored date
    try {
      await api.updateNote(weekId, fields);
    } catch (err) {
      console.warn(`cypher-business | Calendaria updateNote(${weekId}) failed:`, err);
    }
  }

  if (dirty) await saveState(state);
  return true;
}

/**
 * Remove every Calendaria note this business owns. Call BEFORE the business
 * itself is deleted from state (the note-id map lives on the business).
 */
export async function clearBusinessCalendarNotes(business) {
  const api = calApi();
  if (!api) return;
  const map = business?.story?.calNoteIds;
  if (!map) return;
  for (const id of Object.values(map)) {
    await deleteNoteById(api, id);
  }
  delete business.story.calNoteIds;
}
