// The trend chart on the runs page: errors and warnings across saved runs, oldest on the left,
// as inline SVG with no library. Colors come from the page's style sheet through classes.

import { html } from "./html.js";
import { plural, runName, shortDate } from "./format.js";

const WIDTH = 640;
const HEIGHT = 180;
const PAD = { left: 40, right: 16, top: 14, bottom: 30 };

// A top for the axis that is a round number at or above the largest count.
export function axisTop(largest) {
  if (largest <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= largest) return step * magnitude;
  }
  return 10 * magnitude;
}

function change(counts, word) {
  const first = counts[0];
  const last = counts[counts.length - 1];
  const low = Math.min(...counts);
  const high = Math.max(...counts);
  if (low === high) return `${word} stayed at ${last}`;
  if (first === last) return `${word} are back at ${last}, having ranged from ${low} to ${high}`;
  return `${word} went ${last < first ? "down" : "up"} from ${first} to ${last}`;
}

// One sentence for the chart, which screen readers read in place of the drawing.
export function trendSummary(runs) {
  if (runs.length === 0) return "No runs saved yet.";
  const last = runs[runs.length - 1];
  if (runs.length === 1) return `One run, with ${plural(last.errors, "error")} and ${plural(last.warnings, "warning")}.`;
  const counts = (key) => runs.map((run) => run[key]);
  return `Over the last ${runs.length} runs, ${change(counts("errors"), "errors")}, and ${change(counts("warnings"), "warnings")}.`;
}

// The x and y of each run's point. `runs` is oldest first.
export function chartPoints(runs, key, top) {
  const inner = WIDTH - PAD.left - PAD.right;
  const tall = HEIGHT - PAD.top - PAD.bottom;
  return runs.map((run, index) => ({
    x: Math.round(PAD.left + (runs.length === 1 ? inner / 2 : (inner * index) / (runs.length - 1))),
    y: Math.round(PAD.top + tall - (tall * run[key]) / top),
    run,
  }));
}

function series(runs, key, top) {
  const points = chartPoints(runs, key, top);
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const dots = points.map(({ x, y, run }) => html`<circle class="dot ${key}" cx="${x}" cy="${y}" r="3.5"><title>${runName(run)}: ${plural(run[key], key.slice(0, -1))}</title></circle>`);
  return html`<polyline class="line ${key}" points="${line}"></polyline>${dots}`;
}

export function trendChart(runs) {
  if (runs.length === 0) return html``;
  const top = axisTop(Math.max(1, ...runs.map((run) => Math.max(run.errors, run.warnings))));
  const bottom = HEIGHT - PAD.bottom;
  const grid = [0, top / 2, top].map((value) => {
    const y = Math.round(PAD.top + (HEIGHT - PAD.top - PAD.bottom) * (1 - value / top));
    return html`<line class="grid" x1="${PAD.left}" x2="${WIDTH - PAD.right}" y1="${y}" y2="${y}"></line><text class="axis" x="${PAD.left - 6}" y="${y + 4}" text-anchor="end">${Number.isInteger(value) ? value : value.toFixed(1)}</text>`;
  });
  const first = runs[0];
  const last = runs[runs.length - 1];
  const dates = runs.length === 1
    ? html`<text class="axis" x="${WIDTH / 2}" y="${bottom + 20}" text-anchor="middle">${shortDate(first.ranAt)}</text>`
    : html`<text class="axis" x="${PAD.left}" y="${bottom + 20}" text-anchor="start">${shortDate(first.ranAt)}</text><text class="axis" x="${WIDTH - PAD.right}" y="${bottom + 20}" text-anchor="end">${shortDate(last.ranAt)}</text>`;
  return html`<figure class="trend">
<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="trend-title trend-desc" focusable="false">
<title id="trend-title">Errors and warnings in the last ${plural(runs.length, "run")}</title>
<desc id="trend-desc">${trendSummary(runs)}</desc>
${grid}${dates}${series(runs, "warnings", top)}${series(runs, "errors", top)}
</svg>
<figcaption><span class="key errors">Errors</span> <span class="key warnings">Warnings</span> <span class="muted">${trendSummary(runs)}</span></figcaption>
</figure>`;
}
