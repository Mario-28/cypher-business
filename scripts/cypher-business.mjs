// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — module entry point
// ═══════════════════════════════════════════════════════════════════════════

import { MODULE_ID, MODULE_VERSION } from './constants.mjs';
import { loadState, listBusinesses, getBusiness, canManage } from './state/store.mjs';
import { focusOrOpenApp, installNotePopDelegation, installWorkerTipDelegation } from './app/business-app.mjs';
import { CbCanvasIcon } from './hud/canvas-icon.mjs';
import { THEMES, DEFAULT_THEME, THEME_SETTING } from './themes.mjs';
import { registerSockets } from './sockets.mjs';

Hooks.on('init', () => {
  console.log(`Cypher Business | v${MODULE_VERSION} initializing`);
  installNotePopDelegation();
  installWorkerTipDelegation();

  // world state — hidden from the settings menu, managed by the app
  game.settings.register(MODULE_ID, 'state', {
    name: 'Cypher Business State',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  // per-client visual theme
  game.settings.register(MODULE_ID, THEME_SETTING, {
    name: 'CYBUS.Settings.Theme.Name',
    hint: 'CYBUS.Settings.Theme.Hint',
    scope: 'client',
    config: true,
    type: String,
    choices: Object.fromEntries(THEMES.map((t) => [t.id, t.name])),
    default: DEFAULT_THEME
  });

  // floating canvas medallion
  game.settings.register(MODULE_ID, 'showCanvasIcon', {
    name: 'CYBUS.Settings.CanvasIcon.Name',
    hint: 'CYBUS.Settings.CanvasIcon.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, 'iconPos', {
    name: 'Canvas Icon Position',
    scope: 'client',
    config: false,
    type: Object,
    default: null
  });
});

Hooks.on('ready', () => {
  console.log('Cypher Business | ready');
  registerSockets();

  // public API for macros / other modules
  game.cypherBusiness = {
    open: (businessId = null) => focusOrOpenApp(businessId),
    businesses: () => listBusinesses(loadState()),
    canManage: (businessId, user = game.user) => {
      const b = getBusiness(loadState(), businessId);
      return canManage(b, user);
    }
  };

  // floating canvas medallion
  CbCanvasIcon.init();

  // module management entry button
  // Foundry v13+: hook receives Record<string, SceneControl>, tools fire onChange
  Hooks.on('getSceneControlButtons', (controls) => {
    const token = controls?.tokens;
    if (!token?.tools) return;
    token.tools.cypherBusiness = {
      name: 'cypher-business',
      title: 'CYBUS.Controls.Open',
      icon: 'fas fa-building-columns',
      order: Object.keys(token.tools).length,
      button: true,
      onChange: () => game.cypherBusiness.open()
    };
  });
});
