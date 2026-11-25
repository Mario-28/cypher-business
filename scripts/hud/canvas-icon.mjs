// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — floating canvas medallion
// Design reference: Art Deco brass medallion — a bank-vault seal with
// concentric machine-engraved rings (Monopoly money × Chase Manhattan).
// Drag to move, click to open the business window, hover for a summary.
// ═══════════════════════════════════════════════════════════════════════════

import { MODULE_ID, esc } from '../constants.mjs';
import { loadState, listBusinesses } from '../state/store.mjs';
import { DEFAULT_THEME, THEME_SETTING } from '../themes.mjs';
import { focusOrOpenApp } from '../app/business-app.mjs';

const ICON_ID = 'cb-canvas-icon';
const CLICK_SLOP = 5; // px of pointer travel that still counts as a click

export class CbCanvasIcon {
  static instance = null;
  static _hooksBound = false;

  /** Create the singleton icon when the client setting allows it. */
  static init() {
    CbCanvasIcon.#bindHooks();
    const show = game.settings.get(MODULE_ID, 'showCanvasIcon');
    if (show && !CbCanvasIcon.instance) CbCanvasIcon.instance = new CbCanvasIcon();
    if (!show && CbCanvasIcon.instance) CbCanvasIcon.instance.destroy();
  }

  static #bindHooks() {
    if (CbCanvasIcon._hooksBound) return;
    CbCanvasIcon._hooksBound = true;

    // state changes (local writes AND socket-broadcast world updates) refresh
    // the badge + summary; theme changes recolor the medallion
    Hooks.on('updateSetting', (setting) => {
      const icon = CbCanvasIcon.instance;
      if (!icon?.element) return;
      if (setting.key === `${MODULE_ID}.state`) icon.refresh();
      else if (setting.key === `${MODULE_ID}.${THEME_SETTING}`) {
        icon.element.setAttribute('data-cb-theme', setting.value ?? DEFAULT_THEME);
      } else if (setting.key === `${MODULE_ID}.showCanvasIcon`) {
        CbCanvasIcon.init();
      }
    });
  }

  constructor() {
    this.element = null;
    this._drag = null;
    this.#build();
    this.#bindPointer();
    this.refresh();
  }

  destroy() {
    this.element?.remove();
    this.element = null;
    CbCanvasIcon.instance = null;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────

  #build() {
    const saved = game.settings.get(MODULE_ID, 'iconPos');
    const el = document.createElement('div');
    el.id = ICON_ID;
    el.classList.add('cb-ic-pop');
    el.innerHTML = `
      <div class="cb-ic-medallion">
        <div class="cb-ic-ring"></div>
        <div class="cb-ic-disc">
          <i class="fas fa-building-columns"></i>
          <div class="cb-ic-sheen"></div>
        </div>
      </div>
      <div class="cb-ic-badge" style="display:none"></div>
      <div class="cb-ic-tip" style="display:none"></div>`;
    document.body.appendChild(el);
    this.element = el;

    // saved spot wins; default floats right, vertically centered on screen
    const x = Number.isFinite(saved?.x) ? saved.x : Math.max(12, window.innerWidth - 76);
    const y = Number.isFinite(saved?.y) ? saved.y : Math.max(70, Math.round(window.innerHeight / 2 - 29));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;

    el.setAttribute('data-cb-theme', game.settings.get(MODULE_ID, THEME_SETTING) ?? DEFAULT_THEME);
  }

  // ── badge + hover summary ────────────────────────────────────────────────

  refresh() {
    if (!this.element) return;
    const businesses = listBusinesses(loadState());

    // red badge = unresolved story events across every business
    const pending = businesses.reduce((n, b) => n + (b.story?.pending?.length ?? 0), 0);
    const badge = this.element.querySelector('.cb-ic-badge');
    if (badge) {
      badge.textContent = pending;
      badge.style.display = pending > 0 ? '' : 'none';
      badge.classList.toggle('urgent', pending >= 3);
    }

    // hover summary card
    const tip = this.element.querySelector('.cb-ic-tip');
    if (!tip) return;
    if (!businesses.length) {
      tip.innerHTML = `
        <div class="cb-ic-tip-title">${esc(game.i18n.localize('CYBUS.App.Title'))}</div>
        <div class="cb-ic-tip-sub">${esc(game.i18n.localize('CYBUS.Float.NoBusiness'))}</div>`;
      return;
    }
    const rows = businesses.map((b) => {
      const week = b.week.lastLabel ?? `${esc(game.i18n.localize('CYBUS.Main.Week'))} ${b.week.index}`;
      const warn = b.story?.pending?.length
        ? `<span class="cb-ic-tip-warn">${esc(game.i18n.format('CYBUS.Float.Pending', { count: b.story.pending.length }))}</span>`
        : '';
      return `
        <div class="cb-ic-tip-row">
          <span class="cb-ic-tip-name">${esc(b.name)}</span>
          <span class="cb-ic-tip-meta">${esc(week)} · ${Math.round(b.treasury.cash)}</span>
          ${warn}
        </div>`;
    }).join('');
    tip.innerHTML = `
      <div class="cb-ic-tip-title">${esc(game.i18n.localize('CYBUS.Float.YourBusinesses'))}</div>
      ${rows}
      <div class="cb-ic-tip-foot">${esc(game.i18n.localize('CYBUS.Float.DragHint'))}</div>`;
  }

  // ── pointer: drag to move, click (no travel) to open ────────────────────

  #bindPointer() {
    const el = this.element;

    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = el.getBoundingClientRect();
      this._drag = {
        startX: event.clientX,
        startY: event.clientY,
        baseX: rect.left,
        baseY: rect.top,
        moved: false
      };
      el.classList.add('dragging');
      el.classList.remove('cb-ic-pop');
      try { el.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    });

    el.addEventListener('pointermove', (event) => {
      if (!this._drag) return;
      const dx = event.clientX - this._drag.startX;
      const dy = event.clientY - this._drag.startY;
      if (!this._drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      this._drag.moved = true;
      const x = Math.min(window.innerWidth - 58, Math.max(0, this._drag.baseX + dx));
      const y = Math.min(window.innerHeight - 58, Math.max(0, this._drag.baseY + dy));
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
    });

    el.addEventListener('pointerup', async (event) => {
      if (!this._drag) return;
      const { moved } = this._drag;
      this._drag = null;
      el.classList.remove('dragging');
      if (moved) {
        const rect = el.getBoundingClientRect();
        await game.settings.set(MODULE_ID, 'iconPos', { x: Math.round(rect.left), y: Math.round(rect.top) });
      } else {
        focusOrOpenApp();
      }
    });

    el.addEventListener('pointercancel', () => {
      this._drag = null;
      el.classList.remove('dragging');
    });

    el.addEventListener('pointerenter', () => {
      const tip = this.element?.querySelector('.cb-ic-tip');
      if (tip) tip.style.display = '';
    });
    el.addEventListener('pointerleave', () => {
      const tip = this.element?.querySelector('.cb-ic-tip');
      if (tip) tip.style.display = 'none';
    });
  }
}
