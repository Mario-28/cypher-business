// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — native socket channel
//   cbWeekRequest   player → all GMs: "may I run a week for this business?"
//   cbWeekClaim     GM     → all GMs: "I'm running it — close your dialog"
//   cbStateChanged  GM     → all: some state mutation happened, re-render
// GM clients are the only writers (world settings require it anyway).
// ═══════════════════════════════════════════════════════════════════════════

import { SOCKET_CHANNEL, esc, signed, ATTRIBUTES } from './constants.mjs';
import { loadState, saveState, getBusiness, canManage, addLog } from './state/store.mjs';
import { resolveWeek } from './engine/week.mjs';
import { currentDateLabel, dateLabelAfterDays, advanceDays } from './calendaria.mjs';

const _handledGmRequests = new Set();
const _openWeekDialogs = new Map(); // requestId → DialogV2 (live week-request prompts)

function claimGmRequest(requestId) {
  if (!requestId || _handledGmRequests.has(requestId)) return false;
  _handledGmRequests.add(requestId);
  if (_handledGmRequests.size > 256) {
    _handledGmRequests.delete(_handledGmRequests.values().next().value);
  }
  return true;
}

export function registerSockets() {
  game.socket.on(SOCKET_CHANNEL, async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    switch (payload.type) {
      case 'cbWeekRequest':
        if (game.user.isGM) await handleWeekRequest(payload);
        break;
      case 'cbWeekClaim':
        if (game.user.isGM) closeWeekDialog(payload.requestId, payload.gmId);
        break;
      case 'cbStateChanged':
        await rerenderAll();
        break;
      default:
        break;
    }
  });
}

/** GM and every player re-render their open business windows. */
async function rerenderAll() {
  const { refreshApps } = await import('./app/business-app.mjs');
  refreshApps();
}

export function broadcastStateChanged() {
  game.socket.emit(SOCKET_CHANNEL, { type: 'cbStateChanged' });
}

// ── week running ─────────────────────────────────────────────────────────────

/** Player (or GM locally) asks for a week to run. */
export function requestWeekRun(businessId) {
  const state = loadState();
  const b = getBusiness(state, businessId);
  if (!b) return;
  if (game.user.isGM) { runWeekAsGm(businessId); return; }
  if (!canManage(b, game.user)) {
    ui.notifications.warn(game.i18n.localize('CYBUS.Socket.NotManager'));
    return;
  }
  game.socket.emit(SOCKET_CHANNEL, {
    type: 'cbWeekRequest',
    businessId,
    userId: game.user.id,
    requestId: foundry.utils.randomID(16)
  });
  ui.notifications.info(game.i18n.localize('CYBUS.Socket.RequestSent'));
}

async function handleWeekRequest(payload) {
  if (!claimGmRequest(payload.requestId)) return;
  const state = loadState();
  const b = getBusiness(state, payload.businessId);
  if (!b) return;
  const user = game.users.get(payload.userId);
  const dlg = new foundry.applications.api.DialogV2({
    window: { title: game.i18n.localize('CYBUS.Socket.WeekRequest') },
    content: `<p>${esc(game.i18n.format('CYBUS.Socket.WeekRequestText', { user: user?.name ?? '?', business: b.name }))}</p>`,
    buttons: [{ label: game.i18n.localize('CYBUS.Socket.RunIt'), action: 'run' }],
    rejectClose: false
  });
  _openWeekDialogs.set(payload.requestId, dlg);
  const choice = await dlg.wait();
  _openWeekDialogs.delete(payload.requestId);
  if (choice !== 'run') return;
  // re-claim after the dialog: every GM client claimed the requestId when it
  // ARRIVED (so two GMs could both see the prompt), which means the second
  // clicker must lose here or the week would run twice. The cbWeekClaim
  // broadcast above closes the other dialogs before that matters.
  if (!claimGmRequest(`run:${payload.requestId}`)) {
    ui.notifications.info(game.i18n.localize('CYBUS.Socket.AlreadyRan'));
    return;
  }
  game.socket.emit(SOCKET_CHANNEL, { type: 'cbWeekClaim', requestId: payload.requestId, gmId: game.user.id });
  await runWeekAsGm(payload.businessId, { requestedBy: user });
}

/** Another GM claimed the week while our prompt sat open — close it. */
function closeWeekDialog(requestId, gmId) {
  const dlg = _openWeekDialogs.get(requestId);
  if (!dlg) return;
  _openWeekDialogs.delete(requestId);
  dlg.close(); // resolves wait() with null → the click path never fires
  const gm = game.users.get(gmId);
  ui.notifications.info(game.i18n.format('CYBUS.Socket.ClaimedBy', { gm: gm?.name ?? '?' }));
}

/** The actual week run — GM client only. */
export async function runWeekAsGm(businessId, { requestedBy = null, advance = true } = {}) {
  if (!game.user.isGM) return;
  const state = loadState();
  const b = getBusiness(state, businessId);
  if (!b) return;

  const label = currentDateLabel() ?? `Week ${b.week.index + 1}`;
  // in-world date for the week's story event (1–7 days out); null → engine fallback
  const dateLabelFor = (dayOffset) => dateLabelAfterDays(dayOffset);
  const { business: updated, report } = resolveWeek(b, Math.random, label, dateLabelFor);
  addLog(updated, 'week', `Week ${report.weekIndex} closed: net ${signed(report.net)} (cash ${report.cash}).`, label);
  state.businesses[businessId] = updated;
  await saveState(state);

  await postWeekChatCard(updated, report, requestedBy);
  broadcastStateChanged();
  const { refreshApps } = await import('./app/business-app.mjs');
  refreshApps();

  // advance the world calendar one week (silently; Calendaria handles sync)
  if (advance) advanceDays(7);
}

/**
 * GM convenience: resolve every business in one click.
 * The calendar advances ONCE for the whole batch — runWeekAsGm skips its
 * own advance here, otherwise N businesses would skip N weeks per click.
 */
export async function runAllWeeksAsGm() {
  if (!game.user.isGM) return;
  const state = loadState();
  const ids = Object.keys(state.businesses);
  if (!ids.length) return;
  for (const id of ids) await runWeekAsGm(id, { advance: false });
  advanceDays(7);
}

// ── chat report ──────────────────────────────────────────────────────────────

async function postWeekChatCard(business, report, requestedBy) {
  const i18n = (k) => game.i18n.localize(k);
  const attrLine = Object.entries(report.deltas)
    .map(([k, v]) => `<span class="cb-chat-attr ${v > 0 ? 'up' : 'down'}">${esc(i18n(`CYBUS.Attr.${k}`))} ${signed(v)}</span>`)
    .join(' ');
  const lines = report.lines
    .map((l) => `<div class="cb-chat-line ${l.kind}"><span>${esc(l.label)}</span><span>${l.amount > 0 ? '+' : ''}${l.amount}</span></div>`)
    .join('');
  const notes = [...report.expired.map((e) => `⚠ ${e.title} went unresolved${e.note ? ` — ${e.note}` : ''}.`), ...report.competitors, ...report.notes]
    .map((n) => `<div class="cb-chat-note">${esc(n)}</div>`).join('');
  const eventHtml = report.event
    ? `<div class="cb-chat-event ${esc(report.event.cat)}"><strong>${esc(report.event.title)}</strong> — ${esc(report.event.text)} <em>(lands ${esc(report.event.dateLabel)} · ${report.event.dueIn}w to resolve)</em></div>`
    : '';

  const html = `
  <div class="cb-chat-card">
    <h3>${esc(business.name)} — ${esc(report.label)}</h3>
    <div class="cb-chat-net ${report.net >= 0 ? 'up' : 'down'}">${report.net >= 0 ? '+' : ''}${report.net} net · cash ${report.cash}</div>
    ${lines ? `<div class="cb-chat-lines">${lines}</div>` : ''}
    ${eventHtml}
    ${attrLine ? `<div class="cb-chat-attrs">${attrLine}</div>` : ''}
    ${notes ? `<div class="cb-chat-notes">${notes}</div>` : ''}
  </div>`;

  const speaker = requestedBy ? { alias: requestedBy.name } : ChatMessage.getSpeaker({ user: game.user });
  await ChatMessage.create({
    user: game.user.id,
    speaker,
    content: html,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}
