/**
 * Pure Node.js SVG line chart generator for DXCC growth over time.
 * No external dependencies required.
 *
 * Produces a multi-line chart with:
 *   - Monthly data points (precise cumulative values)
 *   - Shape-preserving smooth curves that pass through every data point
 *   - x-axis labels at Jun and Dec
 *   - Sparse value labels at December checkpoints and the latest point
 */

const COLORS = {
  mixed: "#3b82f6", // blue
  phone: "#22c55e", // green
  cw: "#f97316", // orange
  digital: "#a855f7", // purple
};

const BUCKETS = [
  { id: "mixed", label: "Mixed (all modes)", shortLabel: "Mixed" },
  { id: "phone", label: "Phone (SSB/FM)", shortLabel: "Phone" },
  { id: "cw", label: "CW", shortLabel: "CW" },
  { id: "digital", label: "Digital (FT8/RTTY/...)", shortLabel: "Digital" },
];

const CHART_WIDTH = 900;
const CHART_HEIGHT = 440;
const PADDING = { top: 50, right: 120, bottom: 60, left: 60 };

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

  // Determine y-axis max (round up to a nice number)
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
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" role="img" aria-label="${escapeXml(title)}" style="background:#fff;font-family:Arial,sans-serif">\n`;
  svg += `  <rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="white"/>\n`;

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
      svg += `  <line x1="${x}" y1="${PADDING.top + plotHeight}" x2="${x}" y2="${PADDING.top + plotHeight + 5}" stroke="#999" stroke-width="1"/>\n`;
      svg += `  <text x="${x}" y="${y}" text-anchor="middle" font-size="10" fill="#666">${months[i]}</text>\n`;
    }
  }

  // Y-axis line
  svg += `  <line x1="${PADDING.left}" y1="${PADDING.top}" x2="${PADDING.left}" y2="${PADDING.top + plotHeight}" stroke="#999" stroke-width="1"/>\n`;

  // Draw a shape-preserving smooth path for each bucket. The curve passes
  // through every real monthly value and never invents a lower cumulative value.
  for (const bucket of BUCKETS) {
    const values = data[bucket.id];
    if (!values || values.length === 0) continue;
    const color = COLORS[bucket.id];
    const points = values.map((value, index) => ({
      x: xOf(index),
      y: yOf(value),
    }));
    const pathData = buildMonotonePath(points);
    svg += `  <path d="${pathData}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>\n`;
  }

  // Label half-year checkpoints plus the latest value. Unchanged checkpoint
  // values are omitted so the labels remain useful in a GitHub README.
  const labelIndices = [
    ...new Set(
      months
        .map((month, index) => ({ month, index }))
        .filter(
          ({ month, index }) =>
            month.endsWith("-06") ||
            month.endsWith("-12") ||
            index === months.length - 1,
        )
        .map(({ index }) => index),
    ),
  ];

  for (const index of labelIndices) {
    const checkpointPosition = labelIndices.indexOf(index);
    const previousIndex =
      checkpointPosition > 0 ? labelIndices[checkpointPosition - 1] : undefined;
    const candidates = BUCKETS.flatMap((bucket) => {
      const values = data[bucket.id];
      if (!values || index >= values.length) return [];
      const isLatest = index === months.length - 1;
      if (!isLatest && values[index] === 0) return [];
      if (
        !isLatest &&
        previousIndex !== undefined &&
        values[index] === values[previousIndex]
      ) {
        return [];
      }
      return [{
        ...bucket,
        color: COLORS[bucket.id],
        value: values[index],
        x: xOf(index),
        y: yOf(values[index]),
      }];
    }).sort((a, b) => a.y - b.y);

    for (const group of groupNearbyLabels(candidates)) {
      const offsets = labelOffsets(group.length);
      const rawLabelYs = group.map(
        (candidate, groupIndex) => candidate.y + offsets[groupIndex],
      );
      const minLabelY = PADDING.top + 10;
      const maxLabelY = PADDING.top + plotHeight - 6;
      let groupShift = 0;
      if (Math.min(...rawLabelYs) < minLabelY) {
        groupShift = minLabelY - Math.min(...rawLabelYs);
      }
      if (Math.max(...rawLabelYs) + groupShift > maxLabelY) {
        groupShift += maxLabelY - (Math.max(...rawLabelYs) + groupShift);
      }
      group.forEach((candidate, groupIndex) => {
        const isLatest = index === months.length - 1;
        const labelY = clamp(
          candidate.y + offsets[groupIndex] + groupShift,
          minLabelY,
          maxLabelY,
        );
        const labelX = isLatest ? candidate.x + 9 : candidate.x;
        const textAnchor = isLatest ? "start" : "middle";
        const label = isLatest
          ? `${candidate.shortLabel} ${candidate.value}`
          : String(candidate.value);

        svg += `  <line x1="${candidate.x.toFixed(1)}" y1="${candidate.y.toFixed(1)}" x2="${labelX.toFixed(1)}" y2="${(labelY - 4).toFixed(1)}" stroke="${candidate.color}" stroke-width="1" stroke-opacity="0.55"/>\n`;
        svg += `  <circle cx="${candidate.x.toFixed(1)}" cy="${candidate.y.toFixed(1)}" r="3" fill="white" stroke="${candidate.color}" stroke-width="2"><title>${escapeXml(`${months[index]} · ${candidate.shortLabel}: ${candidate.value}`)}</title></circle>\n`;
        svg += `  <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${textAnchor}" font-size="10" font-weight="600" fill="${candidate.color}" stroke="white" stroke-width="3" paint-order="stroke">${escapeXml(label)}</text>\n`;
      });
    }
  }

  // Legend (top-left area, with colored lines + circles for clarity)
  const legendX = PADDING.left + 10;
  const legendY = PADDING.top + 15;
  svg += `  <rect x="${legendX - 8}" y="${legendY - 12}" width="185" height="${BUCKETS.length * 20 + 8}" rx="4" fill="white" fill-opacity="0.9" stroke="#ddd" stroke-width="1"/>\n`;
  for (let i = 0; i < BUCKETS.length; i++) {
    const bucket = BUCKETS[i];
    const color = COLORS[bucket.id];
    const ly = legendY + i * 20;
    svg += `  <line x1="${legendX}" y1="${ly}" x2="${legendX + 20}" y2="${ly}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>\n`;
    svg += `  <circle cx="${legendX + 10}" cy="${ly}" r="3" fill="${color}"/>\n`;
    svg += `  <text x="${legendX + 26}" y="${ly + 4}" font-size="10" fill="#333">${bucket.label}</text>\n`;
  }

  svg += `</svg>\n`;
  return svg;
}

/**
 * Build a monotone cubic Hermite spline represented as an SVG path.
 * The weighted harmonic-mean tangents are shape-preserving, which matters
 * for cumulative totals: a smooth segment cannot dip below earlier values.
 */
function buildMonotonePath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  const segmentWidths = [];
  const slopes = [];
  for (let i = 0; i < points.length - 1; i++) {
    const width = points[i + 1].x - points[i].x;
    segmentWidths.push(width);
    slopes.push((points[i + 1].y - points[i].y) / width);
  }

  const tangents = new Array(points.length);
  if (points.length === 2) {
    tangents[0] = slopes[0];
    tangents[1] = slopes[0];
  } else {
    tangents[0] = endpointTangent(
      segmentWidths[0],
      segmentWidths[1],
      slopes[0],
      slopes[1],
    );
    tangents[points.length - 1] = endpointTangent(
      segmentWidths[segmentWidths.length - 1],
      segmentWidths[segmentWidths.length - 2],
      slopes[slopes.length - 1],
      slopes[slopes.length - 2],
    );

    for (let i = 1; i < points.length - 1; i++) {
      const before = slopes[i - 1];
      const after = slopes[i];
      if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) {
        tangents[i] = 0;
        continue;
      }
      const weightBefore = 2 * segmentWidths[i] + segmentWidths[i - 1];
      const weightAfter = segmentWidths[i] + 2 * segmentWidths[i - 1];
      tangents[i] =
        (weightBefore + weightAfter) /
        (weightBefore / before + weightAfter / after);
    }
  }

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const width = segmentWidths[i];
    const firstControlX = points[i].x + width / 3;
    const firstControlY = points[i].y + (tangents[i] * width) / 3;
    const secondControlX = points[i + 1].x - width / 3;
    const secondControlY = points[i + 1].y - (tangents[i + 1] * width) / 3;
    path += ` C ${firstControlX.toFixed(1)} ${firstControlY.toFixed(1)}, ${secondControlX.toFixed(1)} ${secondControlY.toFixed(1)}, ${points[i + 1].x.toFixed(1)} ${points[i + 1].y.toFixed(1)}`;
  }
  return path;
}

function endpointTangent(firstWidth, secondWidth, firstSlope, secondSlope) {
  let tangent =
    ((2 * firstWidth + secondWidth) * firstSlope - firstWidth * secondSlope) /
    (firstWidth + secondWidth);
  if (Math.sign(tangent) !== Math.sign(firstSlope)) return 0;
  if (
    Math.sign(firstSlope) !== Math.sign(secondSlope) &&
    Math.abs(tangent) > Math.abs(3 * firstSlope)
  ) {
    tangent = 3 * firstSlope;
  }
  return tangent;
}

function groupNearbyLabels(candidates) {
  const groups = [];
  for (const candidate of candidates) {
    const current = groups[groups.length - 1];
    if (!current || candidate.y - current[current.length - 1].y > 18) {
      groups.push([candidate]);
    } else {
      current.push(candidate);
    }
  }
  return groups;
}

function labelOffsets(count) {
  if (count === 1) return [-9];
  return Array.from({ length: count }, (_, index) =>
    (index - (count - 1) / 2) * 16,
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
