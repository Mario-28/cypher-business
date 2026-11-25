// ═══════════════════════════════════════════════════════════════════════════
// CYPHER BUSINESS — canvas charts (zero-dependency; reads theme colors from CSS)
//   drawRadar  — hexagon attribute chart
//   drawProfit — line/area chart of weekly net + cash history
//   drawTrends — multi-series weekly trends (money + attributes)
// ═══════════════════════════════════════════════════════════════════════════

import { clamp } from '../constants.mjs';

function cssVar(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 220;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Hexagonal radar for the six business attributes. attrs: {profit: n, …} */
export function drawRadar(canvas, attrs, order) {
  const { ctx, w, h } = setupCanvas(canvas);
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 34;
  const accent = cssVar(canvas, '--cb-accent', '#c9a227');
  const text = cssVar(canvas, '--cb-dim', '#999');
  const grid = cssVar(canvas, '--cb-grid', 'rgba(255,255,255,.12)');
  const n = order.length;

  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i, frac) => [cx + Math.cos(angle(i)) * R * frac, cy + Math.sin(angle(i)) * R * frac];

  // rings
  for (let ring = 1; ring <= 5; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = point(i % n, ring / 5);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // spokes
  for (let i = 0; i < n; i++) {
    const [x, y] = point(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = grid;
    ctx.stroke();
  }
  // data polygon
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const [x, y] = point(idx, Math.max(0.04, (attrs[order[idx]] ?? 0) / 10));
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = accent + '44';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  // vertices + value badges (at the vertex, pushed outward — clear of labels)
  for (let i = 0; i < n; i++) {
    const frac = Math.max(0.04, (attrs[order[i]] ?? 0) / 10);
    const [x, y] = point(i, frac);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    const [vx, vy] = point(i, Math.min(frac + 12 / R, 0.94));
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(attrs[order[i]] ?? 0), vx, vy);
  }
  // labels — outer ring, dim, well clear of the values
  ctx.font = '10px sans-serif';
  ctx.fillStyle = text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const [lx, ly] = point(i, 1.16);
    ctx.fillText(order[i].toUpperCase(), lx, ly);
  }
}

/** Line chart of weekly net income with cash trajectory. history: [{net, cash}] */
export function drawProfit(canvas, history) {
  const { ctx, w, h } = setupCanvas(canvas);
  const accent = cssVar(canvas, '--cb-accent', '#c9a227');
  const positive = cssVar(canvas, '--cb-positive', '#6fce8b');
  const negative = cssVar(canvas, '--cb-negative', '#d9534f');
  const grid = cssVar(canvas, '--cb-grid', 'rgba(255,255,255,.12)');
  const text = cssVar(canvas, '--cb-text', '#ddd');
  const pad = { l: 46, r: 12, t: 14, b: 22 };
  const data = history.slice(-26);
  if (!data.length) {
    ctx.font = '12px sans-serif';
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.fillText('No weeks recorded yet.', w / 2, h / 2);
    return;
  }
  const nets = data.map((d) => d.net);
  const maxAbs = Math.max(50, ...nets.map((v) => Math.abs(v)));
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pad.t + ih / 2 - (v / maxAbs) * (ih / 2 - 6);

  // zero line
  ctx.strokeStyle = grid;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.l, y(0));
  ctx.lineTo(w - pad.r, y(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // net line, colored per segment sign
  for (let i = 0; i < data.length - 1; i++) {
    ctx.beginPath();
    ctx.moveTo(x(i), y(nets[i]));
    ctx.lineTo(x(i + 1), y(nets[i + 1]));
    ctx.strokeStyle = nets[i + 1] >= 0 ? positive : negative;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // points
  for (let i = 0; i < data.length; i++) {
    ctx.beginPath();
    ctx.arc(x(i), y(nets[i]), 3, 0, Math.PI * 2);
    ctx.fillStyle = nets[i] >= 0 ? positive : negative;
    ctx.fill();
  }
  // scale labels
  ctx.font = '10px sans-serif';
  ctx.fillStyle = text;
  ctx.textAlign = 'right';
  ctx.fillText(`+${maxAbs}`, pad.l - 6, y(maxAbs) + 3);
  ctx.fillText(`-${maxAbs}`, pad.l - 6, y(-maxAbs) + 3);
  ctx.textAlign = 'left';
  ctx.fillText(data[0].label ?? '', pad.l, h - 6);
  ctx.textAlign = 'right';
  ctx.fillText(data[data.length - 1].label ?? '', w - pad.r, h - 6);
}

/** Trend series definitions: money flows on the left axis, attributes (0–10) on the right. */
export const TREND_SERIES = [
  { key: 'income',   axis: 'money', color: '#6fce8b' },
  { key: 'expenses', axis: 'money', color: '#d9534f' },
  { key: 'net',      axis: 'money', color: '#c9a227' },
  { key: 'cash',     axis: 'money', color: '#4d9de0' },
  { key: 'profit',     axis: 'attr', color: '#d4af37' },
  { key: 'marketing',  axis: 'attr', color: '#4d9de0' },
  { key: 'personnel',  axis: 'attr', color: '#6fce8b' },
  { key: 'leadership', axis: 'attr', color: '#9d7bea' },
  { key: 'morale',     axis: 'attr', color: '#e2905a' },
  { key: 'danger',     axis: 'attr', color: '#d33f43' }
];

const seriesValue = (h, key) => (h[key] ?? h.attrs?.[key] ?? null);

/** Multi-series line chart across recorded weeks. active: {key: bool} */
export function drawTrends(canvas, history, active) {
  const { ctx, w, h } = setupCanvas(canvas);
  const dim = cssVar(canvas, '--cb-dim', '#999');
  const grid = cssVar(canvas, '--cb-grid', 'rgba(255,255,255,.12)');
  const data = history.slice(-52);
  const on = TREND_SERIES.filter((s) => active[s.key] && data.some((hh) => seriesValue(hh, s.key) != null));
  if (!data.length || !on.length) {
    ctx.font = '12px sans-serif';
    ctx.fillStyle = dim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(canvas.dataset.empty ?? 'Nothing to plot yet.', w / 2, h / 2);
    return;
  }
  const pad = { l: 54, r: 42, t: 14, b: 22 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);

  const moneyOn = on.filter((s) => s.axis === 'money');
  const attrOn = on.filter((s) => s.axis === 'attr');
  const mMax = Math.max(50, ...moneyOn.flatMap((s) => data.map((hh) => Math.abs(seriesValue(hh, s.key) ?? 0))));
  const yM = (v) => pad.t + ih / 2 - (v / mMax) * (ih / 2 - 8);
  const yA = (v) => pad.t + ih - (clamp(v, 0, 10) / 10) * ih;

  // grid + axes
  ctx.font = '10px sans-serif';
  if (moneyOn.length) {
    ctx.strokeStyle = grid;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, yM(0)); ctx.lineTo(w - pad.r, yM(0)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = dim; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(`+${mMax}`, pad.l - 6, yM(mMax));
    ctx.fillText(`-${mMax}`, pad.l - 6, yM(-mMax));
  }
  if (attrOn.length) {
    ctx.fillStyle = dim; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('10', w - pad.r + 6, yA(10));
    ctx.fillText('0', w - pad.r + 6, yA(0));
  }
  ctx.fillStyle = dim; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(data[0].label ?? `W${data[0].index}`, pad.l, h - 6);
  ctx.textAlign = 'right';
  ctx.fillText(data[data.length - 1].label ?? `W${data[data.length - 1].index}`, w - pad.r, h - 6);

  // series
  for (const s of on) {
    const y = s.axis === 'money' ? yM : yA;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
      const v = seriesValue(data[i], s.key);
      if (v == null) { started = false; continue; }
      const px = x(i), py = y(v);
      started ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      started = true;
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    // last-value chip
    for (let i = data.length - 1; i >= 0; i--) {
      const v = seriesValue(data[i], s.key);
      if (v == null) continue;
      const px = x(i), py = y(v);
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = s.color;
      ctx.textAlign = px > w - 90 ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(v)), px + (px > w - 90 ? -7 : 7), py);
      break;
    }
  }
}
