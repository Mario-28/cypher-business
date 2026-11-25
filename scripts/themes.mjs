// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — theme registry (the CSS lives in styles/cypher-business.css;
// each theme is a [data-cb-theme="…"] block of custom properties)
// ═══════════════════════════════════════════════════════════════════════════

export const THEMES = [
  { id: 'noir',      name: 'Executive Noir (default)', icon: 'fas fa-moon' },
  { id: 'velvet',    name: 'Velvet & Gold',            icon: 'fas fa-crown' },
  { id: 'corporate', name: 'Corporate Teal',           icon: 'fas fa-briefcase' },
  { id: 'crimson',   name: 'Crimson Syndicate',        icon: 'fas fa-skull' },
  { id: 'emerald',   name: 'Emerald Ledger',           icon: 'fas fa-gem' },
  { id: 'paper',     name: 'Paper Ledger (light)',     icon: 'fas fa-scroll' }
];

export const DEFAULT_THEME = 'noir';
export const THEME_SETTING = 'theme';
