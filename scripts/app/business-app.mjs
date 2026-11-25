// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS - main ApplicationV2 window
// Tabs: main · leadership · personnel · events · competition · facility · products
// ═══════════════════════════════════════════════════════════════════════════

import { MODULE_ID, ATTRIBUTES, SPEND_LEVELS, WAGE_LEVELS, esc, signed, clampInt, ROLE_DOMAINS, ROLE_STAT_MAX, defaultRoleStats, uid, EVENT_CAT_ICONS, STATE_VERSION } from '../constants.mjs';
import {
  loadState, saveState, listBusinesses, getBusiness, createBusiness,
  defaultFacility, defaultProduct, defaultCompetitor, addLog, migrate
} from '../state/store.mjs';
import { validateBackup, buildEnvelope } from '../state/backup.mjs';
import { randomWorker, randomCrew } from '../engine/names.mjs';
import { projectWeek, financeCostMult, syncStrength } from '../engine/week.mjs';
import { workerEffectiveness } from '../engine/people.mjs';
import { rollWeeklyEvent, removeEvent, removeJournalEntries, failMultiplier, scaledSpec, consequenceTokens, logEventStep, resolveEvent, difficultyDc } from '../engine/story-events.mjs';
import { describeRival, rollHouseProfile, rollFigure, seedCompetitor, RIVAL_NAMES, RIVAL_MOS } from '../engine/rivals.mjs';
import { CbNoteEditor, sanitizeNoteHtml } from './note-editor.mjs';
import { CbRulebook } from './rulebook.mjs';
import { armLink, isLinkWaiting, initRollLink, LINK_TTL_MS } from './roll-link.mjs';
import { renovate, renovateCost, RENOVATE_GAIN } from '../engine/facilities.mjs';
import { currentDateLabel, dateLabelAfterDays, calendariaActive, openCalendaria } from '../calendaria.mjs';
import { THEMES, DEFAULT_THEME, THEME_SETTING } from '../themes.mjs';
import { drawRadar, drawProfit, drawTrends, TREND_SERIES } from './graphs.mjs';
import { openWeekPreview, openTrends } from './reports.mjs';
import { requestWeekRun, runAllWeeksAsGm, broadcastStateChanged } from '../sockets.mjs';


/**
 * Persist a state mutation, then push every open window (players included)
 * to re-render. GM-only: world settings refuse non-GM writes, and a client
 * that couldn't save must not ask everyone else to refresh either.
 */
async function saveAndBroadcast(state) {
  if (!game.user.isGM) return;
  await saveState(state);
  broadcastStateChanged();
}

/**
 * Localized one-line consequence strings for a success/fail spec
 * ("Might +1 · Treasury −200 · Cash −50"). v1.17 kept local after the
 * dialog flow was removed — the events tab renders stakes inline.
 */
function formatConsequences(spec = {}) {
  const i18n = game.i18n.localize.bind(game.i18n);
  return consequenceTokens(spec).map((tok) => {
    if (tok.kind === 'attr') return `${i18n(`CYBUS.Attr.${tok.key}`)} ${signed(tok.delta)}`;
    if (tok.kind === 'cash') return `${i18n('CYBUS.Events.Stakes.Cash')} ${signed(tok.delta)}`;
    if (tok.kind === 'workerMorale') return `${i18n('CYBUS.Events.Stakes.WorkerMorale')} ${signed(tok.delta)}`;
    if (tok.kind === 'workerProd') return `${i18n('CYBUS.Events.Stakes.WorkerProd')} ${signed(tok.delta)}`;
    if (tok.kind === 'roleMorale') return `${i18n('CYBUS.Events.Stakes.RoleMorale')} ${signed(tok.delta)}`;
    if (tok.kind === 'roleProd') return `${i18n('CYBUS.Events.Stakes.RoleProd')} ${signed(tok.delta)}`;
    if (tok.kind === 'loyalty') return `${i18n('CYBUS.Events.Stakes.Loyalty')} ${signed(tok.delta)}`;
    if (tok.kind === 'productDemand') return `${i18n('CYBUS.Events.Stakes.ProductDemand')} ${signed(tok.delta)}`;
    if (tok.kind === 'facilityCondition') return `${i18n('CYBUS.Events.Stakes.FacilityCondition')} ${signed(tok.delta)}`;
    if (tok.kind === 'competitorStrength') return `${i18n('CYBUS.Events.Stakes.Rivals')} ${signed(tok.delta)}`;
    if (tok.kind === 'competitorPressure') return i18n('CYBUS.Events.Stakes.PressureReset');
    if (tok.kind === 'hire') return game.i18n.format('CYBUS.Events.Stakes.Hire', { count: tok.count });
    if (tok.kind === 'fire') return i18n('CYBUS.Events.Stakes.Fire');
    if (tok.kind === 'walkout') return i18n('CYBUS.Events.Stakes.Walkout');
    return '';
  }).filter(Boolean);
}

/**
 * Shared hover popover for panel notes. Appended to document.body so it paints
 * above EVERYTHING in the app (no stacking-context fights inside the card),
 * positioned from the note button's bounding rect. Theme variables are copied
 * from the owning [data-cb-theme] root so the pop follows the active theme.
 */
let notePop = null;
let notePopInstalled = false;
const NOTE_POP_VARS = ['--cb-panel', '--cb-panel-border', '--cb-text', '--cb-dim', '--cb-accent'];

function ensureNotePop() {
  if (notePop?.isConnected) return notePop;
  notePop = document.createElement('div');
  notePop.className = 'cb-note-pop';
  document.body.appendChild(notePop);
  return notePop;
}

function showNotePop(btn) {
  const pop = ensureNotePop();
  const html = btn.dataset.noteHtml?.trim();
  pop.innerHTML = html || `<em>${game.i18n.localize('CYBUS.Role.NotesEmpty')}</em>`;
  const themed = btn.closest('[data-cb-theme]');
  if (themed) {
    const cs = getComputedStyle(themed);
    for (const v of NOTE_POP_VARS) pop.style.setProperty(v, cs.getPropertyValue(v));
  }
  pop.classList.add('visible');
  const r = btn.getBoundingClientRect();
  pop.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 8));
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = '';
  });
}

function hideNotePop() {
  notePop?.classList.remove('visible');
}

/** Document-level delegation; safe to call multiple times. */
export function installNotePopDelegation() {
  if (notePopInstalled) return;
  notePopInstalled = true;
  document.addEventListener('mouseover', (e) => {
    const btn = e.target.closest?.('.cb-note-btn');
    if (btn) showNotePop(btn);
  });
  document.addEventListener('mouseout', (e) => {
    const btn = e.target.closest?.('.cb-note-btn');
    if (btn && !btn.contains(e.relatedTarget)) hideNotePop();
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.cb-note-btn')) hideNotePop();
  }, true);
}

/**
 * Shared hover popover for worker persona cards (name · age · gender, prose
 * description, three trait chips). Same body-level escape as the note pop:
 * the in-card CSS tooltip kept losing paint-order fights inside the table,
 * so this one is appended to document.body with position: fixed. Anchored
 * ABOVE the badge button, flipping below only when there is no headroom.
 */
let workerPop = null;
let workerPopInstalled = false;
const WORKER_POP_VARS = ['--cb-panel', '--cb-panel-border', '--cb-text', '--cb-dim', '--cb-accent'];

function ensureWorkerPop() {
  if (workerPop?.isConnected) return workerPop;
  workerPop = document.createElement('div');
  workerPop.className = 'cb-worker-pop';
  document.body.appendChild(workerPop);
  return workerPop;
}

function showWorkerTip(btn) {
  const b = getBusiness(loadState(), btn.dataset.businessId);
  const w = b?.staff?.workers.find((x) => x.id === btn.dataset.workerId);
  if (!w) return;
  const pop = ensureWorkerPop();
  const genderKey = w.gender === 'f' ? 'CYBUS.Worker.GenderF' : 'CYBUS.Worker.GenderM';
  const L = (k) => game.i18n.localize(k);
  const l = w.look;
  const lookRows = l ? `
    <span class="cb-worker-pop-look">
      <span class="cb-look-row"><b>${L('CYBUS.Worker.LookHair')}</b><span>${esc(l.hair)}, ${esc(l.style)}</span></span>
      <span class="cb-look-row"><b>${L('CYBUS.Worker.LookEyes')}</b><span>${esc(l.eyes)}</span></span>
      <span class="cb-look-row"><b>${L('CYBUS.Worker.LookHeight')}</b><span>${l.height} cm</span></span>
      <span class="cb-look-row"><b>${L('CYBUS.Worker.LookWeight')}</b><span>${l.weight} kg</span></span>
      <span class="cb-look-row"><b>${L('CYBUS.Worker.LookBuild')}</b><span>${esc(l.build)}</span></span>
      <span class="cb-look-row"><b>${L('CYBUS.Worker.LookBeauty')}</b><span>${esc(l.beautyWord)} (${l.beauty}/10)</span></span>
    </span>` : '';
  pop.innerHTML = `
    <span class="cb-worker-pop-head">${esc(w.name)} &#183; ${w.age} &#183; ${L(genderKey)}</span>
    <span class="cb-worker-pop-desc">${esc(w.description ?? '')}</span>
    ${lookRows}
    <span class="cb-worker-pop-traits">${(w.traits ?? []).map((t) => `<span class="cb-trait-chip">${esc(t)}</span>`).join('')}</span>`;
  const themed = btn.closest('[data-cb-theme]');
  if (themed) {
    const cs = getComputedStyle(themed);
    for (const v of WORKER_POP_VARS) pop.style.setProperty(v, cs.getPropertyValue(v));
  }
  pop.classList.add('visible');
  const r = btn.getBoundingClientRect();
  pop.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 8));
    let top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = '';
  });
}

function hideWorkerTip() {
  workerPop?.classList.remove('visible');
}

/** Document-level delegation; safe to call multiple times. */
export function installWorkerTipDelegation() {
  if (workerPopInstalled) return;
  workerPopInstalled = true;
  document.addEventListener('mouseover', (e) => {
    const btn = e.target.closest?.('.cb-worker-info');
    if (btn) showWorkerTip(btn);
  });
  document.addEventListener('mouseout', (e) => {
    const btn = e.target.closest?.('.cb-worker-info');
    if (btn && !btn.contains(e.relatedTarget)) hideWorkerTip();
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.cb-worker-info')) hideWorkerTip();
  }, true);
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ATTR_ICONS = {
  profit: 'fas fa-sack-dollar', marketing: 'fas fa-bullhorn', personnel: 'fas fa-users',
  leadership: 'fas fa-chess-king', morale: 'fas fa-face-smile', danger: 'fas fa-skull-crossbones'
};

/** Live app instances, so socket updates can refresh every open window. */
const openApps = new Set();
export function refreshApps() {
  for (const app of openApps) app.refresh();
}

/**
 * Public chat card announcing an event outcome. When the outcome came from a
 * linked chat roll, `roll` ({rollerName, total, dc}) renders the roll line.
 */
async function postEventCard(result, roll = null) {
  const i18n = game.i18n.localize.bind(game.i18n);
  const verdict = result.success ? i18n('CYBUS.Events.Outcome.success') : i18n('CYBUS.Events.Outcome.fail');
  const cls = result.success ? 'up' : 'down';
  const cashBit = result.cashDelta ? ` · ${i18n('CYBUS.Events.Stakes.Cash')} ${signed(result.cashDelta)}` : '';
  const deltaBit = Object.entries(result.deltas ?? {})
    .map(([k, v]) => `${i18n(`CYBUS.Attr.${k}`)} ${signed(v)}`).join(', ');
  const rollBit = roll
    ? `<div class="cb-chat-roll-line">${esc(game.i18n.format('CYBUS.Events.LinkedRollLine', { roller: roll.rollerName, total: roll.total, dc: roll.dc }))}</div>`
    : '';
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ user: game.user }),
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    content: `<div class="cb-chat-card cb-event-roll"><strong>${esc(result.title)}</strong> — ${esc(verdict)}${result.solution ? ` <em>(${esc(result.solution)})</em>` : ''}<div class="cb-chat-net ${cls}">${result.success ? '+' : '−'} ${esc(verdict)}${cashBit}</div>${rollBit}${deltaBit ? `<div class="cb-chat-attrs">${esc(deltaBit)}</div>` : ''}${result.note ? `<div class="cb-chat-note">${esc(result.note)}</div>` : ''}</div>`
  });
}

/**
 * GM-side completion of a linked roll (roll-link.mjs disarms before calling).
 * Resolves the armed solution with the roll-derived outcome, persists,
 * announces to chat and refreshes every open window.
 */
export async function resolveLinkedRoll({ businessId, eventId, solutionIndex, outcome, total, dc, rollerName }) {
  if (!game.user.isGM) return;
  const state = loadState();
  const business = getBusiness(state, businessId);
  if (!business) return;
  const result = resolveEvent(business, eventId, solutionIndex, outcome);
  if (!result) {
    ui.notifications.warn(game.i18n.localize('CYBUS.Events.LinkResolvedAlready'));
    refreshApps();
    return;
  }
  await saveAndBroadcast(state);
  await postEventCard(result, { rollerName, total, dc });
  refreshApps();
}

/** Bring an already-open window to the front, or open a fresh one. */
export function focusOrOpenApp(businessId = null) {
  for (const app of openApps) {
    if (app.rendered) {
      if (businessId) app.businessId = businessId;
      app.render();
      app.bringToFront();
      return app;
    }
  }
  const app = new CypherBusinessApp({ businessId: businessId ?? undefined });
  app.render(true);
  return app;
}

export class CypherBusinessApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: 'cypher-business-app',
    classes: ['cypher-business'],
    tag: 'div',
    position: { width: 1180, height: 880 },
    window: {
      icon: 'fas fa-building-columns',
      title: 'CYBUS.App.Title',
      resizable: true,
      minimizable: true,
      contentClasses: ['cb-root']
    },
    actions: {
      switchTab: CypherBusinessApp.#switchTab,
      runWeek: CypherBusinessApp.#runWeek,
      runAllWeeks: CypherBusinessApp.#runAllWeeks,
      openCal: CypherBusinessApp.#openCal,
      createBusiness: CypherBusinessApp.#createBusiness,
      deleteBusiness: CypherBusinessApp.#deleteBusiness,
      uploadBanner: CypherBusinessApp.#uploadBanner,
      clearBanner: CypherBusinessApp.#clearBanner,
      manageManagers: CypherBusinessApp.#manageManagers,
      exportState: CypherBusinessApp.#exportState,
      importState: CypherBusinessApp.#importState,
      attrStep: CypherBusinessApp.#attrStep,
      stepStat: CypherBusinessApp.#stepStat,
      editNote: CypherBusinessApp.#editNote,
      hireOne: CypherBusinessApp.#hireOne,
      hireFive: CypherBusinessApp.#hireFive,
      fireWorker: CypherBusinessApp.#fireWorker,
      cycleGender: CypherBusinessApp.#cycleGender,
      addRole: CypherBusinessApp.#addRole,
      removeRole: CypherBusinessApp.#removeRole,
      clearRole: CypherBusinessApp.#clearRole,
      clearLeadWorker: CypherBusinessApp.#clearLeadWorker,
      addLeadWorker: CypherBusinessApp.#addLeadWorker,
      removeLeadWorker: CypherBusinessApp.#removeLeadWorker,
      logEventStep: CypherBusinessApp.#logEventStep,
      resolveEventSolution: CypherBusinessApp.#resolveEventSolution,
      linkRoll: CypherBusinessApp.#linkRoll,
      forceEvent: CypherBusinessApp.#forceEvent,
      deleteEvent: CypherBusinessApp.#deleteEvent,
      clearJournal: CypherBusinessApp.#clearJournal,
      addCompetitor: CypherBusinessApp.#addCompetitor,
      removeCompetitor: CypherBusinessApp.#removeCompetitor,
      genCompDesc: CypherBusinessApp.#genCompDesc,
      addCompFigure: CypherBusinessApp.#addCompFigure,
      rerollCompFigure: CypherBusinessApp.#rerollCompFigure,
      removeCompFigure: CypherBusinessApp.#removeCompFigure,
      toggleCompFigs: CypherBusinessApp.#toggleCompFigs,
      toggleCompIntel: CypherBusinessApp.#toggleCompIntel,
      addFacility: CypherBusinessApp.#addFacility,
      removeFacility: CypherBusinessApp.#removeFacility,
      visitFacility: CypherBusinessApp.#visitFacility,
      renovateFacility: CypherBusinessApp.#renovateFacility,
      clearFacilityScene: CypherBusinessApp.#clearFacilityScene,
      addProduct: CypherBusinessApp.#addProduct,
      removeProduct: CypherBusinessApp.#removeProduct,
      toggleProduct: CypherBusinessApp.#toggleProduct,
      openProductItem: CypherBusinessApp.#openProductItem,
      clearProductItem: CypherBusinessApp.#clearProductItem,
      rollCompetitor: CypherBusinessApp.#rollCompetitor,
      weekPreview: CypherBusinessApp.#weekPreview,
      trends: CypherBusinessApp.#trends,
      toggleSeries: CypherBusinessApp.#toggleSeries,
      openRulebook: CypherBusinessApp.#openRulebook
    }
  };

  static PARTS = {
    nav:        { template: 'modules/cypher-business/templates/nav.hbs' },
    main:       { template: 'modules/cypher-business/templates/tab-main.hbs' },
    leadership: { template: 'modules/cypher-business/templates/tab-leadership.hbs' },
    personnel:  { template: 'modules/cypher-business/templates/tab-personnel.hbs' },
    events:     { template: 'modules/cypher-business/templates/tab-events.hbs' },
    competition:{ template: 'modules/cypher-business/templates/tab-competition.hbs' },
    facility:   { template: 'modules/cypher-business/templates/tab-facility.hbs' },
    products:   { template: 'modules/cypher-business/templates/tab-products.hbs' }
  };

  /** @param {{ businessId?: string}} [options] */
  constructor(options = {}) {
    super(options);
    this.businessId = options.businessId ?? null;
    this.activeTab = 'main';
    this.trendSeries = { net: true, cash: true, morale: true, danger: true };
    openApps.add(this);
    // keep charts honest when the window is resized
    window.addEventListener('resize', () => this.#redrawMainCharts());
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async close(options = {}) {
    openApps.delete(this);
    return super.close(options);
  }

  /** Reload state from settings and re-render (socket refresh path). */
  refresh() {
    this.render();
  }

  async _prepareContext() {
    const state = loadState();
    const businesses = listBusinesses(state);
    if (!this.businessId || !getBusiness(state, this.businessId)) {
      this.businessId = businesses[0]?.id ?? null;
    }
    const business = getBusiness(state, this.businessId);
    const isGM = game.user.isGM;
    // what one wage unit actually costs per week (wage level × finance discounts)
    const wageCostMult = (WAGE_LEVELS[clampInt(business?.spend?.wage ?? 2, 0, WAGE_LEVELS.length - 1)] ?? 1)
      * (business ? financeCostMult(business) : 1);
    // weekly projection computed once — reused by the context key and the
    // per-product slices on the product cards (matched by name)
    const projection = business ? projectWeek(business) : null;

    return {
      business,
      businesses,
      isGM,
      canEdit: game.user.isGM,
      activeTab: this.activeTab,
      attrs: ATTRIBUTES.map((k) => ({
        key: k,
        label: game.i18n.localize(`CYBUS.Attr.${k}`),
        value: business?.attributes[k] ?? 0,
        pct: (business?.attributes[k] ?? 0) * 10,
        icon: ATTR_ICONS[k] ?? 'fas fa-gauge'
      })),
      spendLevels: SPEND_LEVELS,
      wageLevels: WAGE_LEVELS.map((m, i) => ({ i, mult: m })),
      theme: game.settings.get(MODULE_ID, THEME_SETTING),
      themes: THEMES,
      calendaria: { active: calendariaActive(), dateLabel: currentDateLabel() },
      nextWeekLabel: currentDateLabel() ?? `Week ${(business?.week.index ?? 0) + 1}`,
      projection,
      trendSeries: TREND_SERIES.map((s) => ({
        ...s,
        label: s.axis === 'money'
          ? game.i18n.localize(`CYBUS.Report.Ser.${s.key}`)
          : game.i18n.localize(`CYBUS.Attr.${s.key}`),
        active: !!this.trendSeries[s.key]
      })),
      // facility cards enriched with their scene (header image + visit target)
      // and the renovation economics (cost scales with capacity)
      facilities: (business?.facilities ?? []).map((f) => {
        const scene = f.sceneId ? game.scenes.get(f.sceneId) : null;
        const renoCost = renovateCost(f);
        return {
          ...f,
          hasScene: !!scene, sceneName: scene?.name ?? '', img: scene?.thumb ?? scene?.img ?? '',
          renoCost, renoGain: RENOVATE_GAIN,
          renoDisabled: (f.condition ?? 0) >= 100 || (business?.treasury?.cash ?? 0) < renoCost,
          renoTitle: game.i18n.format('CYBUS.Fac.RenovateHint', { cost: renoCost, gain: RENOVATE_GAIN })
        };
      }),
      users: game.users.map((u) => ({ id: u.id, name: u.name, manager: business?.managers.includes(u.id) })),
      // pending story events enriched for the sleek cards — players get the plain
      // description card; GMs get per-solution stakes, step pips and declare buttons
      storyEvents: (business?.story?.pending ?? []).map((ev) => {
        const failMult = failMultiplier(ev.difficulty);
        return {
          ...ev,
          icon: EVENT_CAT_ICONS[ev.cat] ?? 'fas fa-star',
          isGM,
          dc: difficultyDc(ev.difficulty),
          solutions: (ev.solutions ?? []).map((s, i) => {
            const done = ev.progress?.[i] ?? 0;
            const need = Math.max(1, s.steps ?? 1);
            return {
              ...s,
              index: i,
              linkWaiting: isLinkWaiting(ev.id, i),
              poolLabel: game.i18n.localize(`CYBUS.Pool.${s.pool}`),
              skillLabel: game.i18n.localize(`CYBUS.Skill.${s.skill}`),
              successText: formatConsequences(s.success).join(' · '),
              failText: formatConsequences(scaledSpec(s.fail, failMult)).join(' · '),
              pips: Array.from({ length: need }, (_, k) => ({ done: k < done })),
              ready: done >= need
            };
          })
        };
      }),
      // product cards enriched with their linked item (header image) and the
      // per-product slice of the weekly projection (matched by name —
      // projectWeek only exposes {name, units, revenue, cost})
      products: (business?.products ?? []).map((p) => {
        const item = p.itemId ? game.items.get(p.itemId) : null;
        const proj = projection?.products?.find((x) => x.name === p.name);
        return {
          ...p,
          demandPct: (p.demand ?? 0) * 10,
          hasItem: !!item, itemName: item?.name ?? '', img: item?.img ?? '',
          projUnits: proj?.units ?? null, projRevenue: proj?.revenue ?? null
        };
      }),
      // rivals enriched for the sleek cards: per-house accent hue, name monogram,
      // per-figure hue offsets, and the pressure gauge that drives rival-move events
      competitors: (business?.competitors ?? []).map((c) => {
        const hue = [...c.id].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) % 360, 7);
        const pressure = c.pressure ?? 0;
        return {
          ...c,
          accent: `hsl(${hue} 55% 55%)`,
          initial: (c.name || '?').trim().charAt(0).toUpperCase(),
          pressure,
          pressPct: pressure * 10,
          pressClass: pressure >= 7 ? 'hi' : pressure >= 4 ? 'mid' : '',
          figsOpen: this._compFigsOpen?.has(c.id) ?? false,
          intelOpen: this._compIntelOpen?.has(c.id) ?? false,
          npcs: (c.npcs ?? []).map((n, k) => ({
            ...n,
            compId: c.id,
            figHue: (hue + 40 + k * 47) % 360,
            initial: (n.name || '?').trim().charAt(0).toUpperCase()
          }))
        };
      }),
      // personnel rows enriched with the derived effectiveness stat
      workers: (business?.staff?.workers ?? []).map((w) => ({ ...w, eff: workerEffectiveness(w) })),
      // leadership roster enriched for the role cards
      roles: (business?.leadership?.roles ?? []).map((r) => ({
        ...r,
        effPct: Math.round((0.3 + clampInt(r.strength ?? 5, 0, 5) * 0.14) * 100),
        pPct: clampInt(r.productivity ?? 5, 0, 10) * 10,
        mPct: clampInt(r.morale ?? 5, 0, 10) * 10,
        lPct: clampInt(r.loyalty ?? 5, 0, 10) * 10,
        domainKey: ROLE_DOMAINS.includes(r.domain) ? r.domain : 'leadership',
        domainLabel: game.i18n.localize(`CYBUS.Role.Domains.${ROLE_DOMAINS.includes(r.domain) ? r.domain : 'leadership'}.Label`),
        domainDesc: game.i18n.localize(`CYBUS.Role.Domains.${ROLE_DOMAINS.includes(r.domain) ? r.domain : 'leadership'}.Desc`),
        isNPC: r.actorIsNPC !== false,
        wageWeekly: Math.round(Math.max(0, r.wage ?? 0) * wageCostMult)
      })),
      domains: ROLE_DOMAINS.map((d) => ({ key: d, label: game.i18n.localize(`CYBUS.Role.Domains.${d}.Label`) })),
      leadWorkers: (business?.leadWorkers ?? []).map((w) => ({
        ...w,
        effPct: Math.round((0.3 + clampInt(w.strength ?? 5, 0, 5) * 0.14) * 100),
        pPct: clampInt(w.productivity ?? 5, 0, 10) * 10,
        mPct: clampInt(w.morale ?? 5, 0, 10) * 10,
        lPct: clampInt(w.loyalty ?? 5, 0, 10) * 10,
        domainKey: ROLE_DOMAINS.includes(w.domain) ? w.domain : 'operations',
        domainLabel: game.i18n.localize(`CYBUS.Role.Domains.${ROLE_DOMAINS.includes(w.domain) ? w.domain : 'operations'}.Label`),
        domainDesc: game.i18n.localize(`CYBUS.Role.Domains.${ROLE_DOMAINS.includes(w.domain) ? w.domain : 'operations'}.Desc`),
        isNPC: w.actorIsNPC !== false,
        wageWeekly: Math.round(Math.max(0, w.wage ?? 0) * wageCostMult)
      }))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    // theme attribute drives every color in the CSS
    root.setAttribute('data-cb-theme', context.theme ?? DEFAULT_THEME);

    // ── tab switching ──
    root.querySelectorAll('.cb-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.activeTab));
    root.querySelectorAll('.cb-nav-item').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.activeTab));

    // ── field editing via [data-edit] delegation (bind once - root persists) ──
    if (!this._cbChangeBound) {
      root.addEventListener('change', (event) => this.#onFieldChange(event));
      // GM-only: right-click a house-intel line to edit it inline
      root.addEventListener('contextmenu', (event) => this.#onIntelContextMenu(event));
      // journal "select all" checkbox toggles every entry's checkbox
      root.addEventListener('change', (event) => {
        if (!event.target.matches('.cb-journal-check-all')) return;
        root.querySelectorAll('.cb-journal-check').forEach((c) => { c.checked = event.target.checked; });
      });
      this._cbChangeBound = true;
    }

    // ── drag & drop actors onto leadership roles ──
    root.querySelectorAll('.cb-role[data-role-id]').forEach((el) => {
      el.addEventListener('dragover', (e) => { if (context.canEdit) e.preventDefault(); });
      el.addEventListener('drop', (e) => this.#onDropRole(e, el.dataset.roleId));
    });

    // ── drag & drop actors onto leading-worker slots ──
    root.querySelectorAll('.cb-lw[data-lw-id]').forEach((el) => {
      el.addEventListener('dragover', (e) => { if (context.canEdit) e.preventDefault(); });
      el.addEventListener('drop', (e) => this.#onDropLeadWorker(e, el.dataset.lwId));
    });

    // ── drag & drop scenes onto facility cards (GM sets the header image) ──
    root.querySelectorAll('.cb-fac-card[data-fac-id]').forEach((el) => {
      el.addEventListener('dragover', (e) => { if (context.canEdit) e.preventDefault(); });
      el.addEventListener('drop', (e) => this.#onDropScene(e, el.dataset.facId));
    });

    // ── drag & drop items onto product cards (GM sets the header image) ──
    root.querySelectorAll('.cb-prod-card[data-prod-id]').forEach((el) => {
      el.addEventListener('dragover', (e) => { if (context.canEdit) e.preventDefault(); });
      el.addEventListener('drop', (e) => this.#onDropItem(e, el.dataset.prodId));
    });

    // ── graphs (main tab) - deferred: first paint hasn't laid out yet ──
    if (this.activeTab === 'main' && context.business) {
      const draw = () => this.#redrawMainCharts();
      requestAnimationFrame(() => requestAnimationFrame(draw));
    }
  }

  /** Redraw the main-tab canvases from live state (resize / deferred first paint). */
  #redrawMainCharts() {
    if (!this.rendered || this.activeTab !== 'main' || !this.element) return;
    const business = getBusiness(loadState(), this.businessId);
    if (!business) return;
    const radar = this.element.querySelector('#cb-radar');
    const profit = this.element.querySelector('#cb-profit');
    const trends = this.element.querySelector('#cb-trends-main');
    if (radar?.isConnected) drawRadar(radar, business.attributes, ATTRIBUTES);
    if (profit?.isConnected) drawProfit(profit, business.treasury.history);
    if (trends?.isConnected) {
      trends.dataset.empty = game.i18n.localize('CYBUS.Report.NothingToPlot');
      drawTrends(trends, business.treasury.history, this.trendSeries);
    }
  }

  // ── mutations (GM or managers only) ─────────────────────────────────────

  async #mutate(fn) {
    const state = loadState();
    const business = getBusiness(state, this.businessId);
    if (!business || !game.user.isGM) return;
    await fn(state, business);
    await saveAndBroadcast(state);
    this.render();
  }

  /**
   * GM-only: right-click a house-intel line swaps it for an inline editor.
   * Blur / Ctrl+Enter saves via the normal mutate pipeline; Escape cancels.
   */
  async #onIntelContextMenu(event) {
    const el = event.target.closest('.cb-comp-intel-editable');
    if (!el || !game.user?.isGM) return;
    event.preventDefault();
    if (el.parentElement.querySelector('.cb-comp-intel-editing')) return;
    const id = el.dataset.compId;
    const field = el.dataset.compField;
    const orig = el.textContent;
    const ta = document.createElement('textarea');
    ta.className = 'cb-comp-intel-input cb-comp-intel-editing';
    ta.value = orig;
    ta.rows = 2;
    el.style.display = 'none';
    el.after(ta);
    ta.focus();
    ta.select();
    let settled = false;
    const finish = async (save) => {
      if (settled) return;
      settled = true;
      const val = ta.value;
      ta.remove();
      el.style.display = '';
      if (!save || val === orig) return;
      await this.#mutate((state, b) => {
        const c = b.competitors.find((x) => x.id === id);
        if (c && ['services', 'facilities'].includes(field)) c[field] = val;
      });
    };
    ta.addEventListener('blur', () => finish(true), { once: true });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
    });
  }

  async #onFieldChange(event) {
    const el = event.target.closest('[data-edit]');
    if (!el) return;
    const path = el.dataset.edit;
    const val = el.type === 'checkbox' ? el.checked : el.value;

    // client-local UI prefs - no business needed
    if (path === 'theme') {
      await game.settings.set(MODULE_ID, THEME_SETTING, val);
      this.render();
      return;
    }
    if (path === 'selectBusiness') {
      this.businessId = val || null;
      this.activeTab = 'main';
      this.render();
      return;
    }

    const businessId = this.businessId;
    const state = loadState();
    const business = getBusiness(state, businessId);
    if (!business || !game.user.isGM) return;

    const num = Number(val);
    const set = (obj, key, value) => { obj[key] = value; };

    if (path === 'business.name') business.name = val || business.name;
    else if (path === 'business.description') business.description = val;
    else if (path === 'business.cash') business.treasury.cash = Math.round(num);
    else if (path.startsWith('spend.')) business.spend[path.slice(6)] = Math.max(0, Math.min(5, Math.round(num)));
    else if (path.startsWith('worker.')) {
      const [, id, field] = path.split('.');
      const w = business.staff.workers.find((x) => x.id === id);
      // template binds name/age/morale/productivity/wage/note — nothing else is settable
      if (w) {
        if (field === 'name') w.name = val || w.name;
        else if (field === 'note') w.note = val;
        else if (field === 'age') w.age = clampInt(num, 0, 200);
        else if (field === 'morale') w.morale = clampInt(num, 0, 10);
        else if (field === 'productivity') w.productivity = clampInt(num, 0, 10);
        else if (field === 'wage') w.wage = clampInt(num, 0, 100000); // cap matches #stepStat
      }
    } else if (path.startsWith('role.')) {
      const [, id, field] = path.split('.');
      const r = business.leadership.roles.find((x) => x.id === id);
      if (r) {
        if (['productivity', 'morale', 'loyalty'].includes(field)) { r[field] = clampInt(num, 0, 10); syncStrength(r); }
        else if (field === 'wage') r.wage = clampInt(num, 0, 100000);
        else if (field === 'domain') { if (ROLE_DOMAINS.includes(val)) r.domain = val; }
        else if (field === 'title') r.title = val;
      }
    } else if (path.startsWith('lw.')) {
      const [, id, field] = path.split('.');
      const w = (business.leadWorkers ?? []).find((x) => x.id === id);
      if (w) {
        if (['productivity', 'morale', 'loyalty'].includes(field)) { w[field] = clampInt(num, 0, 10); syncStrength(w); }
        else if (field === 'wage') w.wage = clampInt(num, 0, 100000);
        else if (field === 'domain') { if (ROLE_DOMAINS.includes(val)) w.domain = val; }
        else if (field === 'title') w.title = val;
      }
    } else if (path.startsWith('comp.')) {
      const [, id, field] = path.split('.');
      const c = business.competitors.find((x) => x.id === id);
      if (c) set(c, field, ['name', 'focus', 'note', 'description', 'services', 'facilities'].includes(field) ? val : Math.max(0, Math.min(10, Math.round(num))));
    } else if (path.startsWith('fig.')) {
      const [, id, field] = path.split('.');
      for (const c of business.competitors) {
        const n = c.npcs?.find((x) => x.id === id);
        if (n) { if (['name', 'title', 'note'].includes(field)) set(n, field, val); break; }
      }
    } else if (path.startsWith('fac.')) {
      const [, id, field] = path.split('.');
      const f = business.facilities.find((x) => x.id === id);
      if (f) {
        if (field === 'name') f.name = val || f.name;
        else if (field === 'note') f.note = val;
        else if (field === 'condition') f.condition = clampInt(num, 0, 100);
        else if (field === 'capacity') f.capacity = clampInt(num, 0, 999);
      }
    } else if (path.startsWith('prod.')) {
      const [, id, field] = path.split('.');
      const p = business.products.find((x) => x.id === id);
      if (p) {
        // template binds name/kind/value/demand/baseDemand/workersDemand/active
        if (field === 'name') p.name = val || p.name;
        else if (field === 'kind') p.kind = val;
        else if (field === 'active') p.active = !!val;
        else if (field === 'value') p.value = clampInt(num, 0, 100);
        else if (field === 'demand') p.demand = clampInt(num, 0, 10);
        else if (field === 'baseDemand') p.baseDemand = clampInt(num, 0, 10);
        else if (field === 'workersDemand') p.workersDemand = clampInt(num, 0, 20);
      }
    }

    await saveAndBroadcast(state);
    this.render();
  }

  async #onDropRole(event, roleId) {
    event.preventDefault();
    let data;
    try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
    if (data?.type !== 'Actor') return;
    const actor = await fromUuid(data.uuid);
    if (!actor) return;
    await this.#mutate((state, b) => {
      const role = b.leadership.roles.find((r) => r.id === roleId);
      if (!role) return;
      role.actorUuid = actor.uuid;
      role.actorName = actor.name;
      role.portrait = actor.img ?? null;
      role.actorIsNPC = actor.type !== 'pc';
      addLog(b, 'leadership', `${actor.name} takes the role of ${role.title}.`);
    });
  }

  async #onDropLeadWorker(event, lwId) {
    event.preventDefault();
    let data;
    try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
    if (data?.type !== 'Actor') return;
    const actor = await fromUuid(data.uuid);
    if (!actor) return;
    await this.#mutate((state, b) => {
      const slot = (b.leadWorkers ??= []).find((w) => w.id === lwId);
      if (!slot) return;
      slot.actorUuid = actor.uuid;
      slot.actorName = actor.name;
      slot.portrait = actor.img ?? null;
      slot.actorIsNPC = actor.type !== 'pc';
      addLog(b, 'leadership', `${actor.name} steps up as ${slot.title}.`);
    });
  }

  // ── actions ─────────────────────────────────────────────────────────────

  static #switchTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static #runWeek(event, target) {
    if (!this.businessId) return;
    requestWeekRun(this.businessId);
  }

  static #runAllWeeks(event, target) {
    if (game.user.isGM) runAllWeeksAsGm();
  }

  static #openCal(event, target) {
    openCalendaria();
  }

  static #weekPreview(event, target) {
    if (!this.businessId) return;
    openWeekPreview(this.businessId);
  }

  static #trends(event, target) {
    if (!this.businessId) return;
    openTrends(this.businessId);
  }

  static async #toggleSeries(event, target) {
    const key = target.dataset.series;
    this.trendSeries[key] = !this.trendSeries[key];
    this.render();
  }

  /** The manual — GM edition or player handbook, decided inside the dialog. */
  static #openRulebook(_event, _target) {
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof CbRulebook) { app.bringToFront(); return; }
    }
    new CbRulebook().render(true);
  }

  static async #createBusiness(event, target) {
    if (!game.user.isGM) return;
    const name = window.prompt(game.i18n.localize('CYBUS.App.NamePrompt'), game.i18n.localize('CYBUS.App.NewBusiness'));
    if (!name) return;
    const state = loadState();
    const b = createBusiness(name.trim());
    state.businesses[b.id] = b;
    await saveAndBroadcast(state);
    this.businessId = b.id;
    this.render();
  }

  static async #deleteBusiness(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    const state = loadState();
    const b = getBusiness(state, this.businessId);
    if (!b) return;
    if (!window.confirm(game.i18n.format('CYBUS.App.DeleteConfirm', { name: b.name }))) return;
    delete state.businesses[this.businessId];
    await saveAndBroadcast(state);
    this.businessId = null;
    this.render();
  }

  /** Foundry file picker → store the chosen image as the business banner. */
  static async #uploadBanner(event, target) {
    if (!this.businessId) return;
    const state = loadState();
    const b = getBusiness(state, this.businessId);
    if (!b || !game.user.isGM) return;
    // Foundry 14 moved the picker off the global scope - dual-path for safety
    const Picker = foundry.applications?.apps?.FilePicker ?? globalThis.FilePicker;
    if (!Picker) {
      ui.notifications.warn('Cypher Business: file picker unavailable in this Foundry version.');
      return;
    }
    new Picker({
      type: 'image',
      current: b.banner || undefined,
      callback: async (path) => {
        const st = loadState();
        const biz = getBusiness(st, this.businessId);
        if (!biz || !game.user.isGM) return;
        biz.banner = path;
        await saveAndBroadcast(st);
        this.render();
      }
    }).render(true);
  }

  static async #clearBanner(event, target) {
    if (!this.businessId) return;
    const state = loadState();
    const b = getBusiness(state, this.businessId);
    if (!b || !game.user.isGM) return;
    b.banner = null;
    await saveAndBroadcast(state);
    this.render();
  }

  /** GM picks which players may VIEW this business and REQUEST week runs (v1.24+: read-only; editing is GM-only). */
  static #manageManagers(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    const state = loadState();
    const b = getBusiness(state, this.businessId);
    if (!b) return;
    const users = game.users.filter((u) => !u.isGM);
    const rows = users.map((u) => {
      const on = b.managers.includes(u.id);
      const avatar = u.avatar
        ? `<img class="cb-mgr-avatar" src="${esc(u.avatar)}" alt="">`
        : `<span class="cb-mgr-avatar cb-mgr-initials">${esc(u.name.slice(0, 2).toUpperCase())}</span>`;
      return `<label class="cb-mgr-row${on ? ' checked' : ''}"><input type="checkbox" value="${esc(u.id)}" ${on ? 'checked' : ''}> ${avatar} <span class="cb-mgr-name">${esc(u.name)}</span></label>`;
    }).join('') || `<p>${esc(game.i18n.localize('CYBUS.App.NoPlayers'))}</p>`;
    const content = `
      <p class="cb-mgr-what">${esc(game.i18n.localize('CYBUS.App.ManagersWhat'))}</p>
      <div class="cb-mgr-list">${rows}</div>`;
    const dlg = new foundry.applications.api.Dialog({
      window: { title: game.i18n.localize('CYBUS.App.Managers') },
      content,
      buttons: [{
        action: 'save',
        label: game.i18n.localize('Save'),
        callback: async (_event, button) => {
          const ids = [...button.form.querySelectorAll('input:checked')].map((i) => i.value);
          const st = loadState();
          const biz = getBusiness(st, b.id);
          if (biz) { biz.managers = ids; await saveAndBroadcast(st); }
          refreshApps();
        }
      }],
      rejectClose: false
    });
    dlg.render(true).then(() => {
      // checked-state styling follows the checkbox live
      dlg.element.addEventListener('change', (ev) => {
        if (ev.target.matches('input[type="checkbox"]')) ev.target.closest('.cb-mgr-row')?.classList.toggle('checked', ev.target.checked);
      });
    });
  }

  /** GM: download the entire module state as a JSON backup file. */
  static #exportState() {
    if (!game.user.isGM) return;
    const state = loadState();
    const envelope = buildEnvelope(state, {
      moduleId: MODULE_ID,
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? null,
      stateVersion: STATE_VERSION,
      exportedBy: game.user.name
    });
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${MODULE_ID}-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    ui.notifications.info(game.i18n.format('CYBUS.Data.ExportDone', { n: Object.keys(state.businesses).length }));
  }

  /** GM: pick a backup JSON file, validate it, confirm, then replace state (auto-migrated). */
  static #importState() {
    if (!game.user.isGM) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        ui.notifications.error(game.i18n.localize('CYBUS.Data.ImportParseFailed'));
        return;
      }
      const check = validateBackup(parsed);
      if (!check.ok) {
        ui.notifications.error(game.i18n.format('CYBUS.Data.ImportInvalid', { reason: check.reason }));
        return;
      }
      const ok = await foundry.applications.api.Dialog.confirm({
        window: { title: game.i18n.localize('CYBUS.Data.Import') },
        content: `<p>${esc(game.i18n.format('CYBUS.Data.ImportConfirm', { n: check.businesses, file: file.name }))}</p>`,
        ok: { label: game.i18n.localize('CYBUS.Data.Import') },
        rejectClose: false
      });
      if (!ok) return;
      // unwrap the envelope (or accept a bare state) and run the migration
      // chain so old backups upgrade to the current schema on the way in.
      const raw = parsed.state && parsed.businesses === undefined ? parsed.state : parsed;
      const upgraded = migrate(raw);
      await saveState(upgraded);
      broadcastStateChanged();
      refreshApps();
      ui.notifications.info(game.i18n.format('CYBUS.Data.ImportDone', { n: Object.keys(upgraded.businesses).length }));
    });
    input.click();
  }

  static async #attrStep(event, target) {
    const attr = target.dataset.attr;
    const dir = Number(target.dataset.dir);
    if (!ATTRIBUTES.includes(attr)) return; // whitelist — no prototype keys via data-attr
    await this.#mutate((state, b) => { b.attributes[attr] = Math.max(0, Math.min(10, (b.attributes[attr] ?? 5) + dir)); });
  }

  /** GM stepper for role / leading-worker stats (productivity · morale · loyalty · strength). */
  static async #stepStat(event, target) {
    const path = target.dataset.path ?? '';
    const dir = Number(target.dataset.dir);
    const [kind, id, field] = path.split('.');
    if (!dir || !['role', 'lw'].includes(kind) || !id || !field) return;
    if (!['productivity', 'morale', 'loyalty', 'wage'].includes(field)) return; // template-bound only
    const max = field === 'wage' ? 100000 : ROLE_STAT_MAX[field] ?? 10;
    const sync = field === 'wage' ? () => {} : syncStrength;
    if (kind === 'role') {
      await this.#mutate((state, b) => {
        const r = b.leadership.roles.find((x) => x.id === id);
        if (r) { r[field] = clampInt((r[field] ?? 5) + dir, 0, max); sync(r); }
      });
    } else {
      await this.#mutate((state, b) => {
        const w = (b.leadWorkers ?? []).find((x) => x.id === id);
        if (w) { w[field] = clampInt((w[field] ?? 5) + dir, 0, max); sync(w); }
      });
    }
  }

  /**
   * Open the note editor for a panel note. GM-only — the save path is
   * whitelisted to role./lw. *.note and run through sanitizeNoteHtml
   * (defense-in-depth, not the permission boundary).
   */
  static async #editNote(event, target) {
    const path = target.dataset.path ?? '';
    if (!/^(role|lw)\.[^.]+\.note$/.test(path)) return;
    if (!game.user.isGM) return;
    const state = loadState();
    const business = getBusiness(state, this.businessId);
    if (!business) return;
    const [kind, id] = path.split('.');
    const person = kind === 'role'
      ? business.leadership.roles.find((x) => x.id === id)
      : (business.leadWorkers ?? []).find((x) => x.id === id);
    if (!person) return;
    const editor = new CbNoteEditor(path, person.note ?? '', {
      panelTitle: person.title,
      onSave: async (html) => {
        const s = loadState();
        const b = getBusiness(s, this.businessId);
        if (!b) return;
        const p = kind === 'role'
          ? b.leadership.roles.find((x) => x.id === id)
          : (b.leadWorkers ?? []).find((x) => x.id === id);
        if (!p) return;
        p.note = sanitizeNoteHtml(html);
        await saveAndBroadcast(s);
        this.render();
      }
    });
    editor.render(true);
  }

  static async #hireOne(event, target) {
    await this.#mutate((state, b) => {
      const w = randomWorker();
      b.staff.workers.push(w);
      addLog(b, 'personnel', `Hired ${w.name} (${w.age}), productivity ${w.productivity}, effectiveness ${workerEffectiveness(w)}.`);
    });
  }

  static async #hireFive(event, target) {
    await this.#mutate((state, b) => {
      for (const w of randomCrew(5)) {
        b.staff.workers.push(w);
        addLog(b, 'personnel', `Hired ${w.name} (${w.age}), productivity ${w.productivity}, effectiveness ${workerEffectiveness(w)}.`);
      }
    });
  }

  static async #fireWorker(event, target) {
    const id = target.dataset.workerId;
    const state = loadState();
    const b = getBusiness(state, this.businessId);
    const w = b?.staff.workers.find((x) => x.id === id);
    if (!w) return;
    if (!window.confirm(game.i18n.format('CYBUS.Worker.FireConfirm', { name: w.name }))) return;
    await this.#mutate((state2, b2) => {
      const i = b2.staff.workers.findIndex((x) => x.id === id);
      if (i >= 0) {
        addLog(b2, 'personnel', `${b2.staff.workers[i].name} is let go.`);
        b2.staff.workers.splice(i, 1);
      }
    });
  }

  static async #cycleGender(event, target) {
    const id = target.dataset.workerId;
    await this.#mutate((state2, b2) => {
      const w = b2.staff.workers.find((x) => x.id === id);
      if (w) w.gender = w.gender === 'f' ? 'm' : 'f';
    });
  }

  static async #addRole(event, target) {
    const title = window.prompt(game.i18n.localize('CYBUS.Role.NewPrompt'), game.i18n.localize('CYBUS.Role.New'));
    if (!title) return;
    await this.#mutate((state, b) => {
      b.leadership.roles.push({
        id: foundry.utils.randomID(), title: title.trim(), domain: 'leadership',
        actorUuid: null, actorName: null, portrait: null, actorIsNPC: true, note: '', wage: 0,
        ...defaultRoleStats()
      });
    });
  }

  static async #removeRole(event, target) {
    await this.#mutate((state, b) => {
      const i = b.leadership.roles.findIndex((r) => r.id === target.dataset.roleId);
      if (i >= 0) b.leadership.roles.splice(i, 1);
    });
  }

  static async #clearRole(event, target) {
    await this.#mutate((state, b) => {
      const r = b.leadership.roles.find((x) => x.id === target.dataset.roleId);
      if (r) { r.actorUuid = null; r.actorName = null; r.portrait = null; }
    });
  }

  static async #clearLeadWorker(event, target) {
    await this.#mutate((state, b) => {
      const w = (b.leadWorkers ?? []).find((x) => x.id === target.dataset.lwId);
      if (w) { w.actorUuid = null; w.actorName = null; w.portrait = null; }
    });
  }

  static async #addLeadWorker(event, target) {
    const title = window.prompt(game.i18n.localize('CYBUS.LW.NewPrompt'), game.i18n.localize('CYBUS.LW.New'));
    if (!title) return;
    await this.#mutate((state, b) => {
      (b.leadWorkers ??= []).push({
        id: foundry.utils.randomID(), title: title.trim(), domain: 'operations',
        actorUuid: null, actorName: null, portrait: null, actorIsNPC: true, note: '', wage: 0,
        ...defaultRoleStats()
      });
    });
  }

  static async #removeLeadWorker(event, target) {
    await this.#mutate((state, b) => {
      const i = (b.leadWorkers ?? []).findIndex((x) => x.id === target.dataset.lwId);
      if (i >= 0) b.leadWorkers.splice(i, 1);
    });
  }

  /** GM-only: force an extra story event on top of the weekly one. */
  static async #forceEvent(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    const state = loadState();
    const business = getBusiness(state, this.businessId);
    if (!business) return;
    const ev = rollWeeklyEvent(business, Math.random, (off) => dateLabelAfterDays(off));
    if (!ev) return;
    const updated = structuredClone(business);
    updated.story.pending.push(ev);
    updated.log.unshift({ id: uid('log'), week: updated.week.index, type: `ev_${ev.cat}`, title: ev.title, text: `${ev.text} — lands ${ev.dateLabel}, ${ev.dueIn}w to resolve (GM-forced).`, at: Date.now() });
    state.businesses[this.businessId] = updated;
    await saveAndBroadcast(state);
    ui.notifications.info(`${ev.title} — ${game.i18n.localize('CYBUS.Events.Forced')}`);
    this.render();
  }

  /** GM-only: strike a pending event from the record — no consequences. */
  static async #deleteEvent(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    const state = loadState();
    const business = getBusiness(state, this.businessId);
    if (!business) return;
    const { business: updated, removed } = removeEvent(business, target.dataset.eventId);
    if (!removed) return;
    updated.log.unshift({ id: uid('log'), week: updated.week.index, type: `ev_${removed.cat}`, title: removed.title, text: `${removed.text} — removed by the GM; no consequences.`, at: Date.now() });
    state.businesses[this.businessId] = updated;
    await saveAndBroadcast(state);
    ui.notifications.info(`${removed.title} — ${game.i18n.localize('CYBUS.Events.Deleted')}`);
    this.render();
  }

  /**
   * GM-only: permanently delete the journal entries whose checkboxes are
   * ticked on the Events tab. Nothing else in the ledger is touched — this
   * scrubs history, it does not re-run any consequences.
   */
  static async #clearJournal(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    const ids = [...(this.element?.querySelectorAll('.cb-journal-check:checked') ?? [])]
      .map((c) => c.dataset.journalId)
      .filter(Boolean);
    if (!ids.length) {
      ui.notifications.warn(game.i18n.localize('CYBUS.Events.JournalNoneSelected'));
      return;
    }
    const state = loadState();
    const business = getBusiness(state, this.businessId);
    if (!business) return;
    const { business: updated, removed } = removeJournalEntries(business, ids);
    if (!removed.length) return;
    updated.log.unshift({
      id: uid('log'), week: updated.week.index, type: 'ev_journal_clear',
      title: game.i18n.localize('CYBUS.Events.Journal'),
      text: game.i18n.format('CYBUS.Events.JournalClearedLog', { count: removed.length }),
      at: Date.now()
    });
    state.businesses[this.businessId] = updated;
    await saveAndBroadcast(state);
    ui.notifications.info(game.i18n.format('CYBUS.Events.JournalCleared', { count: removed.length }));
    this.render();
  }

  /**
   * GM-only: record one table step toward a solution (v1.17 diceless model).
   * The engine caps progress at the required step count and logs the line.
   */
  static async #logEventStep(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    await this.#mutate((state, b) => {
      logEventStep(b, target.dataset.eventId, Number(target.dataset.solution ?? 0));
    });
  }

  /**
   * GM-only: declare how a solution ended at the table. Success is only
   * offered once every step is logged; failure is always declarable.
   * Consequences come from the solution's own stakes, scaled on failure.
   */
  static async #resolveEventSolution(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    const outcome = target.dataset.outcome === 'fail' ? 'fail' : 'success';
    const solutionIndex = Number(target.dataset.solution ?? 0);
    let result = null;
    await this.#mutate((state, b) => {
      result = resolveEvent(b, target.dataset.eventId, solutionIndex, outcome);
    });
    if (result) await postEventCard(result);
  }

  /**
   * GM-only: arm (or disarm) a one-shot link between a solution and the next
   * roll in chat. While armed, the next roll message resolves the solution
   * by total vs DC — see roll-link.mjs for the state machine.
   */
  static async #linkRoll(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    const state = loadState();
    const business = getBusiness(state, this.businessId);
    const ev = (business?.story?.pending ?? []).find((x) => x.id === target.dataset.eventId);
    if (!ev) return;
    const solutionIndex = Number(target.dataset.solution ?? 0);
    const link = armLink({
      businessId: this.businessId,
      eventId: ev.id,
      solutionIndex,
      dc: difficultyDc(ev.difficulty),
      title: ev.title
    });
    // armed (not toggled off): schedule a refresh just past the TTL so the
    // waiting state clears even if no chat message ever arrives
    if (link) setTimeout(() => refreshApps(), LINK_TTL_MS + 500);
    this.render();
  }

  static async #addCompetitor(event, target) {
    await this.#mutate((state, b) => {
      const c = defaultCompetitor();
      c.name = `${c.name} ${b.competitors.length + 1}`;
      seedCompetitor(c, Math.random);
      b.competitors.push(c);
      addLog(b, 'competition', `New rival on the board: ${c.name} (${c.focus}).`);
    });
  }

  static async #removeCompetitor(event, target) {
    await this.#mutate((state, b) => {
      const i = b.competitors.findIndex((c) => c.id === target.dataset.compId);
      if (i >= 0) b.competitors.splice(i, 1);
    });
  }

  static async #rollCompetitor(event, target) {
    await this.#mutate((state, b) => {
      const c = defaultCompetitor();
      c.name = RIVAL_NAMES[Math.floor(Math.random() * RIVAL_NAMES.length)];
      c.focus = RIVAL_MOS[Math.floor(Math.random() * RIVAL_MOS.length)];
      c.strength = 3 + Math.floor(Math.random() * 6);
      c.aggression = 2 + Math.floor(Math.random() * 6);
      seedCompetitor(c, Math.random);
      b.competitors.push(c);
      addLog(b, 'competition', `New rival on the board: ${c.name} (${c.focus}).`);
    });
  }

  /** GM: rewrite the house description from its M.O. + temperament. */
  /** UI-only expand/collapse for a rival's key-figure roster (session state). */
  static async #toggleCompFigs(event, target) {
    this._compFigsOpen ??= new Set();
    const id = target.dataset.compId;
    if (this._compFigsOpen.has(id)) this._compFigsOpen.delete(id);
    else this._compFigsOpen.add(id);
    this.render(false);
  }

  /** UI-only expand/collapse for a rival's house-intel profile (session state). */
  static async #toggleCompIntel(event, target) {
    this._compIntelOpen ??= new Set();
    const id = target.dataset.compId;
    if (this._compIntelOpen.has(id)) this._compIntelOpen.delete(id);
    else this._compIntelOpen.add(id);
    this.render(false);
  }

  static async #genCompDesc(event, target) {
    await this.#mutate((state, b) => {
      const c = b.competitors.find((x) => x.id === target.dataset.compId);
      if (!c) return;
      c.description = describeRival(c, Math.random);
      ({ services: c.services, facilities: c.facilities } = rollHouseProfile(c));
    });
  }

  static async #addCompFigure(event, target) {
    await this.#mutate((state, b) => {
      const c = b.competitors.find((x) => x.id === target.dataset.compId);
      if (!c) return;
      c.npcs ??= [];
      if (c.npcs.length >= 5) return;
      const fig = rollFigure(c, Math.random, c.npcs.map((n) => n.name));
      c.npcs.push(fig);
      addLog(b, 'competition', `${c.name}: ${fig.name} (${fig.title}) surfaces as a key figure.`);
    });
  }

  static async #rerollCompFigure(event, target) {
    await this.#mutate((state, b) => {
      const c = b.competitors.find((x) => x.id === target.dataset.compId);
      const i = c?.npcs?.findIndex((n) => n.id === target.dataset.figId) ?? -1;
      if (!c || i < 0) return;
      const fresh = rollFigure(c, Math.random, c.npcs.filter((_, k) => k !== i).map((n) => n.name));
      fresh.id = c.npcs[i].id; // keep the slot stable across renders
      c.npcs[i] = fresh;
    });
  }

  static async #removeCompFigure(event, target) {
    await this.#mutate((state, b) => {
      const c = b.competitors.find((x) => x.id === target.dataset.compId);
      const i = c?.npcs?.findIndex((n) => n.id === target.dataset.figId) ?? -1;
      if (c && i >= 0) c.npcs.splice(i, 1);
    });
  }

  static async #addFacility(event, target) {
    await this.#mutate((state, b) => b.facilities.push(defaultFacility()));
  }

  static async #removeFacility(event, target) {
    await this.#mutate((state, b) => {
      const i = b.facilities.findIndex((f) => f.id === target.dataset.facId);
      if (i >= 0) b.facilities.splice(i, 1);
    });
  }

  /** Any user with the app open can jump to the facility's scene. */
  static async #visitFacility(event, target) {
    const state = loadState();
    const f = getBusiness(state, this.businessId)?.facilities.find((x) => x.id === target.dataset.facId);
    const scene = f?.sceneId ? game.scenes.get(f.sceneId) : null;
    if (scene) await scene.view();
  }

  /**
   * GM-only: pay cash to restore facility condition on the spot — the honest
   * alternative to free-typing the condition slider (audit candidate #2).
   */
  static async #renovateFacility(event, target) {
    if (!game.user.isGM || !this.businessId) return;
    let result = null;
    await this.#mutate((state, b) => {
      result = renovate(b, target.dataset.facId);
      if (result?.ok) {
        addLog(b, 'facility', `Renovated ${result.name} +${result.gain}% (−${result.cost} shins).`);
      }
    });
    if (result && !result.ok) {
      const key = result.reason === 'cash' ? 'CYBUS.Fac.RenovateBroke'
        : result.reason === 'pristine' ? 'CYBUS.Fac.RenovatePristine' : 'CYBUS.Fac.RenovateMissing';
      ui.notifications.warn(game.i18n.localize(key));
    }
  }

  /** GM: detach the scene from the card (image header + visit button go with it). */
  static async #clearFacilityScene(event, target) {
    await this.#mutate((state, b) => {
      const f = b.facilities.find((x) => x.id === target.dataset.facId);
      if (f) f.sceneId = null;
    });
  }

  /** GM: drop a scene from the sidebar onto the card — its image becomes the header. */
  async #onDropScene(event, facId) {
    event.preventDefault();
    if (!game.user.isGM) return;
    let data;
    try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
    if (data?.type !== 'Scene') return;
    const scene = await fromUuid(data.uuid);
    if (!scene) return;
    await this.#mutate((state, b) => {
      const f = b.facilities.find((x) => x.id === facId);
      if (f) f.sceneId = scene.id;
    });
  }

  static async #addProduct(event, target) {
    await this.#mutate((state, b) => b.products.push(defaultProduct()));
  }

  static async #removeProduct(event, target) {
    await this.#mutate((state, b) => {
      const i = b.products.findIndex((p) => p.id === target.dataset.prodId);
      if (i >= 0) b.products.splice(i, 1);
    });
  }

  static async #toggleProduct(event, target) {
    await this.#mutate((state, b) => {
      const p = b.products.find((x) => x.id === target.dataset.prodId);
      if (p) p.active = !p.active;
    });
  }

  /** Any user: open the linked Foundry item's sheet from the card tag. */
  static async #openProductItem(event, target) {
    const state = loadState();
    const p = getBusiness(state, this.businessId)?.products.find((x) => x.id === target.dataset.prodId);
    const item = p?.itemId ? game.items.get(p.itemId) : null;
    if (item) item.sheet.render(true);
  }

  /** GM: detach the item from the card (header image goes with it). */
  static async #clearProductItem(event, target) {
    await this.#mutate((state, b) => {
      const p = b.products.find((x) => x.id === target.dataset.prodId);
      if (p) p.itemId = null;
    });
  }

  /** GM: drop an item from the sidebar onto the card — its image becomes the header. */
  async #onDropItem(event, prodId) {
    event.preventDefault();
    if (!game.user.isGM) return;
    let data;
    try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
    if (data?.type !== 'Item') return;
    const item = await fromUuid(data.uuid);
    if (!item) return;
    await this.#mutate((state, b) => {
      const p = b.products.find((x) => x.id === prodId);
      if (p) p.itemId = item.id;
    });
  }
}

// ── roll-link wiring ────────────────────────────────────────────────────────
// One-shot chat-roll → event resolution. The state machine lives in
// roll-link.mjs; here we only provide the Foundry-flavored callbacks.
initRollLink({
  onRoll: (payload) => { resolveLinkedRoll(payload); },
  onExpire: () => { refreshApps(); }
});
