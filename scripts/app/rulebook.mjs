// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — the Manual (rulebook dialog)
// One template, two editions: the context branches on game.user.isGM — GMs
// get the full engine + controls manual, players get the handbook. The button
// lives in the nav, right of the theme dropdown; anyone may read their edition.
// ═══════════════════════════════════════════════════════════════════════════

import { MODULE_ID } from '../constants.mjs';
import { THEME_SETTING } from '../themes.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CbRulebook extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: 'cb-rulebook',
    classes: ['cypher-business', 'cb-rulebook-window'],
    tag: 'div',
    position: { width: 780, height: 640 },
    window: {
      icon: 'fas fa-book',
      resizable: true,
      minimizable: true,
      contentClasses: ['cb-root']
    },
    actions: {
      jumpTo: CbRulebook.#jumpTo
    }
  };

  static PARTS = {
    manual: { template: 'modules/cypher-business/templates/rulebook.hbs' }
  };

  get title() {
    const key = game.user.isGM ? 'CYBUS.Rulebook.GmEdition' : 'CYBUS.Rulebook.PlayerEdition';
    return game.i18n.localize(key);
  }

  async _prepareContext() {
    return {
      isGM: game.user.isGM,
      theme: game.settings.get(MODULE_ID, THEME_SETTING)
    };
  }

  /**
   * TOC / inline cross-reference jumps. Foundry app windows have no native
   * anchor navigation, so buttons carry data-jump="#id" and we scroll the
   * target into view inside the scrollable window content.
   */
  static #jumpTo(event, target) {
    const sel = target.dataset.jump;
    if (!sel) return;
    this.element?.querySelector('.cb-manual')?.querySelector(sel)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
