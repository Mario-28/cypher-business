// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — report dialogs
//   week preview — projected ledger for the upcoming week (pure projection)
//   trends       — multi-series line chart across recorded weeks
// ═══════════════════════════════════════════════════════════════════════════

import { loadState, getBusiness } from '../state/store.mjs';
import { projectWeek } from '../engine/week.mjs';
import { drawTrends, TREND_SERIES } from './graphs.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CbReportApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'cb-report',
    classes: ['cypher-business'],
    tag: 'div',
    position: { width: 620, height: 540 },
    window: {
      icon: 'fas fa-chart-line',
      title: 'CYBUS.Report.TrendsTitle',
      resizable: true,
      contentClasses: ['cb-root', 'cb-report-root']
    },
    actions: {
      toggleSeries: CbReportApp.#toggleSeries
    }
  };

  static PARTS = {
    report: { template: 'modules/cypher-business/templates/report.hbs' }
  };

  /** @param {{ mode: 'week'|'trends', businessId: string }} options */
  constructor(options = {}) {
    super(options);
    this.mode = options.mode ?? 'trends';
    this.businessId = options.businessId;
    this.activeSeries = { net: true, cash: true, morale: true, danger: true };
  }

  get title() {
    const key = this.mode === 'week' ? 'CYBUS.Report.PreviewTitle' : 'CYBUS.Report.TrendsTitle';
    const b = getBusiness(loadState(), this.businessId);
    return `${game.i18n.localize(key)} — ${b?.name ?? ''}`;
  }

  async _prepareContext() {
    const business = getBusiness(loadState(), this.businessId);
    const isWeek = this.mode === 'week';
    const projection = isWeek && business ? projectWeek(business) : null;
    return {
      business,
      isWeek,
      isTrends: !isWeek,
      projection,
      series: TREND_SERIES.map((s) => ({
        ...s,
        label: s.axis === 'money'
          ? game.i18n.localize(`CYBUS.Report.Ser.${s.key}`)
          : game.i18n.localize(`CYBUS.Attr.${s.key}`),
        active: !!this.activeSeries[s.key]
      })),
      emptyText: game.i18n.localize('CYBUS.Report.NothingToPlot')
    };
  }

  _onRender(context) {
    super._onRender(context);
    if (this.mode !== 'trends') return;
    // double rAF: canvas needs the laid-out panel size, not the first-paint guess
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const canvas = this.element.querySelector('#cb-trends');
      if (!canvas?.isConnected) return;
      canvas.dataset.empty = context.emptyText;
      const business = getBusiness(loadState(), this.businessId);
      drawTrends(canvas, business?.treasury.history ?? [], this.activeSeries);
    }));
  }

  static async #toggleSeries(event, target) {
    const key = target.dataset.series;
    this.activeSeries[key] = !this.activeSeries[key];
    this.render();
  }
}

/** Open the projected-ledger dialog for a business. */
export function openWeekPreview(businessId) {
  if (!businessId) return;
  new CbReportApp({ mode: 'week', businessId, window: { icon: 'fas fa-calculator' } }).render(true);
}

/** Open the weekly-trends dialog for a business. */
export function openTrends(businessId) {
  if (!businessId) return;
  new CbReportApp({ mode: 'trends', businessId }).render(true);
}
