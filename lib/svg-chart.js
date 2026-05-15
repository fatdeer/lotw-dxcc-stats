/**
 * Pure Node.js SVG line chart generator for DXCC growth over time.
 * No external dependencies required.
 *
 * Produces a multi-line chart with:
 *   - Monthly data points (precise growth curve)
 *   - x-axis labels only at Jun and Dec (clean axis)
 *   - Color-coded lines with legend
 */

const COLORS = {
  mixed: "#3b82f6",   // blue
  phone: "#22c55e",   // green
  cw: "#f97316",      // orange
  digital: "#a855f7", // purple
};

const CHART_WIDTH = 800;
const CHART_HEIGHT = 400;
const PADDING = { top: 50, right: 30, bottom: 60, left: 60 };

/**
 * Generate an SVG line chart.
 *
 * @param {object} params
 * @param {string[]} params.months - Continuous month array ["2018-03", "2018-04", ...]
 * @param {object} params.data - { mixed: number[], phone: number[], cw: number[], digital: number[] }
 * @param {string} params.title - Chart title
 * @returns {string} - Complete SVG markup
 */
export function generateSVGChart({ months, data, title }) {
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  // Determine y-axis max (round up to nice number)
  const allValues = Object.values(data).flat();
  const maxVal = Math.max(...allValues, 1);
  const yMax = niceMax(maxVal);

  // X scale: map month index -> pixel x
  const xStep = months.length > 1 ? plotWidth / (months.length - 1) : plotWidth;
  const xOf = (i) => PADDING.left + i * xStep;

  // Y scale: map value -> pixel y (inverted - 0 at bottom)
  const yOf = (v) => PADDING.top + plotHeight - (v / yMax) * plotHeight;

  let svg = "";

  // SVG header
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" style="background:#fff;font-family:Arial,sans-serif">\n`;

  // Title
  svg += `  <text x="${CHART_WIDTH / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${escapeXml(title)}</text>\n`;

  // Grid lines (y-axis)
  const yTicks = generateYTicks(yMax);
  for (const tick of yTicks) {
    const y = yOf(tick);
    svg += `  <line x1="${PADDING.left}" y1="${y}" x2="${CHART_WIDTH - PADDING.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>\n`;
    svg += `  <text x="${PADDING.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#666">${tick}</text>\n`;
  }

  // X-axis line
  svg += `  <line x1="${PADDING.left}" y1="${PADDING.top + plotHeight}" x2="${CHART_WIDTH - PADDING.right}" y2="${PADDING.top + plotHeight}" stroke="#999" stroke-width="1"/>\n`;

  // X-axis labels (only Jun and Dec)
  for (let i = 0; i < months.length; i++) {
    const mo = parseInt(months[i].split("-")[1]);
    if (mo === 6 || mo === 12) {
      const x = xOf(i);
      const y = PADDING.top + plotHeight + 20;
      // Vertical tick mark
      svg += `  <line x1="${x}" y1="${PADDING.top + plotHeight}" x2="${x}" y2="${PADDING.top + plotHeight + 5}" stroke="#999" stroke-width="1"/>\n`;
      // Label
      svg += `  <text x="${x}" y="${y}" text-anchor="middle" font-size="10" fill="#666">${months[i]}</text>\n`;
    }
  }

  // Y-axis line
  svg += `  <line x1="${PADDING.left}" y1="${PADDING.top}" x2="${PADDING.left}" y2="${PADDING.top + plotHeight}" stroke="#999" stroke-width="1"/>\n`;

  // Draw lines for each bucket
  const bucketOrder = ["mixed", "phone", "cw", "digital"];
  for (const bid of bucketOrder) {
    const values = data[bid];
    if (!values || values.length === 0) continue;
    const color = COLORS[bid];

    // Build SVG polyline points
    const points = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
    svg += `  <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>\n`;
  }

  // Legend (top-right area, with colored lines + circles for clarity)
  const legendItems = [
    { label: "Mixed (all modes)", color: COLORS.mixed },
    { label: "Phone (SSB/FM)", color: COLORS.phone },
    { label: "CW", color: COLORS.cw },
    { label: "Digital (FT8/RTTY/...)", color: COLORS.digital },
  ];
  const legendX = CHART_WIDTH - PADDING.right - 180;
  const legendY = PADDING.top + 15;
  // Background box
  svg += `  <rect x="${legendX - 8}" y="${legendY - 12}" width="185" height="${legendItems.length * 20 + 8}" rx="4" fill="white" fill-opacity="0.9" stroke="#ddd" stroke-width="1"/>\n`;
  for (let i = 0; i < legendItems.length; i++) {
    const { label, color } = legendItems[i];
    const ly = legendY + i * 20;
    // Color line sample
    svg += `  <line x1="${legendX}" y1="${ly}" x2="${legendX + 20}" y2="${ly}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>\n`;
    // Color circle
    svg += `  <circle cx="${legendX + 10}" cy="${ly}" r="3" fill="${color}"/>\n`;
    // Label text
    svg += `  <text x="${legendX + 26}" y="${ly + 4}" font-size="10" fill="#333">${label}</text>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}

/**
 * Round up to a "nice" maximum for the y-axis
 */
function niceMax(value) {
  if (value <= 10) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const factor = value / magnitude;
  if (factor <= 1.5) return 1.5 * magnitude;
  if (factor <= 2) return 2 * magnitude;
  if (factor <= 3) return 3 * magnitude;
  if (factor <= 5) return 5 * magnitude;
  if (factor <= 7.5) return 7.5 * magnitude;
  return 10 * magnitude;
}

/**
 * Generate nice y-axis tick values
 */
function generateYTicks(yMax) {
  const ticks = [];
  const step = yMax <= 50 ? 10 : yMax <= 150 ? 25 : yMax <= 300 ? 50 : 100;
  for (let v = 0; v <= yMax; v += step) {
    ticks.push(v);
  }
  return ticks;
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
