// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — panel note editor (tiny WYSIWYG for role / lead-worker notes)
// Opens from the sticky-note icon on each leadership card. Notes are plain-ish
// HTML sanitized to a tiny allowlist. Editing is GM-only (the app gates the
// editor); the sanitizer is defense-in-depth, not the permission boundary.
// ═══════════════════════════════════════════════════════════════════════════

import { MODULE_ID } from '../constants.mjs';
import { THEME_SETTING } from '../themes.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Tags allowed inside a panel note — everything else is unwrapped or dropped. */
const NOTE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI']);

/**
 * Sanitize note HTML to the allowlist. Disallowed tags are unwrapped (their
 * children survive); all attributes are stripped.
 *
 * BFS queue, not sibling-walking: children are enqueued BEFORE any unwrap, so
 * nodes spliced into the tree by a disallowed parent's unwrap are still
 * visited. (The old firstElementChild walk skipped them — `<marquee><b
 * onmouseover=…>` kept the attribute through the unwrap.)
 */
export function sanitizeNoteHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html ?? ''}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  let guard = 0;
  const queue = [...root.children];
  while (queue.length) {
    const el = queue.shift();
    if (++guard > 5000) return ''; // pathological document — drop the whole note
    queue.push(...el.children);
    if (NOTE_TAGS.has(el.tagName)) {
      for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
    } else {
      el.replaceWith(...el.childNodes);
    }
  }
  return root.innerHTML.trim();
}

export class CbNoteEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: 'cb-note-editor',
    classes: ['cypher-business', 'cb-note-editor-window'],
    tag: 'div',
    position: { width: 380 },
    window: {
      icon: 'fas fa-note-sticky',
      title: 'CYBUS.NoteEditor.Title',
      resizable: false,
      minimizable: false,
      contentClasses: ['cb-root']
    },
    actions: {
      save: CbNoteEditor.#save,
      cancel: CbNoteEditor.#cancel,
      fmtBold: CbNoteEditor.#fmtBold,
      fmtItalic: CbNoteEditor.#fmtItalic,
      fmtList: CbNoteEditor.#fmtList
    }
  };

  static PARTS = {
    editor: { template: 'modules/cypher-business/templates/note-editor.hbs' }
  };

  /**
   * @param {string} path      state path being edited, e.g. "role.abc123.note"
   * @param {string} initial   current (sanitized) HTML
   * @param {{ panelTitle?: string, onSave: (html: string) => Promise<void> }} hooks
   */
  constructor(path, initial, hooks = {}, options = {}) {
    super(options);
    this.path = path;
    this.initial = initial ?? '';
    this.onSave = hooks.onSave ?? (async () => {});
    if (hooks.panelTitle) this.windowTitle = `${game.i18n.localize('CYBUS.NoteEditor.Title')} — ${hooks.panelTitle}`;
  }

  get title() { return this.windowTitle ?? super.title; }

  async _prepareContext() {
    return {
      theme: game.settings.get(MODULE_ID, THEME_SETTING),
      html: this.initial
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element?.querySelector('.cb-note-editor')?.setAttribute('data-cb-theme', context.theme);
    const editable = this.element?.querySelector('.cb-ne-editable');
    if (editable && options.isFirstRender) editable.focus();
  }

  #editable() { return this.element?.querySelector('.cb-ne-editable'); }

  #exec(command) {
    this.#editable()?.focus();
    document.execCommand(command);
  }

  static #fmtBold(_event, _target) { this.#exec('bold'); }
  static #fmtItalic(_event, _target) { this.#exec('italic'); }
  static #fmtList(_event, _target) { this.#exec('insertUnorderedList'); }

  static async #save(_event, _target) {
    const html = sanitizeNoteHtml(this.#editable()?.innerHTML ?? '');
    await this.onSave(html);
    await this.close();
  }

  static async #cancel(_event, _target) {
    await this.close();
  }
}
