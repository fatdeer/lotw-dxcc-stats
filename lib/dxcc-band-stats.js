import fs from "fs";
import path from "path";

/**
 * DXCC Challenge 统计中使用的标准波段列表（按频率从低到高）
 * 最后一项 "Other" 用于收集不在列表中的波段
 */
const BAND_ORDER = [
  "160m",
  "80m",
  "40m",
  "30m",
  "20m",
  "17m",
  "15m",
  "12m",
  "10m",
  "6m",
  "2m",
];

/**
 * 标准化 BAND 字段值
 * LoTW ADIF 中的 BAND 字段通常已为标准格式（如 "20m"），
 * 但可能存在大小写差异或前后空格
 */
function normalizeBand(band) {
  if (!band) return "Other";
  const b = String(band).trim().toLowerCase();
  if (BAND_ORDER.includes(b)) return b;
  return "Other";
}

/**
 * 把 ADIF 风格的日期 (YYYYMMDD) 标准化为 YYYY-MM-DD
 */
function fmtDate(value) {
  if (!value) return "";
  const v = String(value).trim();
  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }
  return v;
}

/**
 * 清理 QSL 时间戳中的注释文本
 */
function cleanQslTimestamp(value) {
  if (!value) return "";
  return value.replace(/\s*\/\/.*$/, "").trim();
}

/**
 * 用于 QSL 时间戳排序的 key（毫秒），不可解析时回退为 Infinity
 */
function qslSortKey(record) {
  const rxqsl = record.app_lotw_rxqsl;
  if (rxqsl) {
    const t = Date.parse(rxqsl + (rxqsl.includes(":") ? "" : " 00:00:00"));
    if (!isNaN(t)) return t;
  }
  const qsoDate = record.qso_date;
  if (qsoDate && /^\d{8}$/.test(qsoDate)) {
    const t = Date.parse(
      `${qsoDate.slice(0, 4)}-${qsoDate.slice(4, 6)}-${qsoDate.slice(6, 8)}`,
    );
    if (!isNaN(t)) return t;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * 解析 ADIF 文件，仅提取 QSL 已确认的记录
 */
function parseQSLRecords(adifData) {
  const records = [];
  const recordsSection = adifData.split(/<eoh>/i)[1] || "";
  const recordTexts = recordsSection.split(/<eor>/i);

  for (const recordText of recordTexts) {
    if (!recordText.trim()) continue;
    const record = {};
    const fieldMatches = recordText.match(/<([^:>]+):(\d+)>([^<]*)/gi);
    if (!fieldMatches) continue;

    for (const fm of fieldMatches) {
      const m = fm.match(/<([^:>]+):(\d+)>([^<]*)/i);
      if (m) {
        record[m[1].toLowerCase()] = m[3].trim();
      }
    }

    const isQslConfirmed =
      record.qsl_rcvd === "Y" || record.app_lotw_qsl_rcvd === "Y";
    if (!isQslConfirmed) continue;

    // DXCC 实体编号必须存在且非 0
    if (!record.dxcc) continue;
    const dxccCode = record.dxcc.trim();
    if (dxccCode === "0" || dxccCode === "") continue;

    records.push(record);
  }
  return records;
}

/**
 * 给定一组 QSL 记录，按波段分组产生"每个 DXCC 实体的首次 QSL"列表
 *
 * 处理规则：
 *   - 对每个波段独立计算
 *   - 同一波段内同一 DXCC 实体若有多条 QSL，取 QSL 时间最早的那条
 *   - 各波段内按 QSL 时间升序输出
 */
function buildPerBandFirstQSL(qslRecords) {
  // band -> dxccCode -> 最早的那条记录
  const allBands = [...BAND_ORDER, "Other"];
  const bandBuckets = Object.fromEntries(allBands.map((b) => [b, new Map()]));

  for (const r of qslRecords) {
    const dxccCode = r.dxcc.trim();
    const band = normalizeBand(r.band);

    const bucket = bandBuckets[band];
    const existing = bucket.get(dxccCode);
    if (!existing || qslSortKey(r) < qslSortKey(existing)) {
      bucket.set(dxccCode, r);
    }
  }

  // 各波段按 QSL 时间升序输出
  const result = {};
  for (const band of allBands) {
    const items = Array.from(bandBuckets[band].entries()).map(
      ([dxccCode, record]) => ({
        dxcc: parseInt(dxccCode, 10),
        entity: record.country || record.app_lotw_dxcc_entity || `DXCC #${dxccCode}`,
        callsign: record.call || "",
        mode: record.submode || record.mode || "",
        band: record.band || "",
        qso_date: fmtDate(record.qso_date),
        qsl_received: cleanQslTimestamp(record.app_lotw_rxqsl || ""),
      }),
    );
    items.sort((a, b) => {
      const ka = a.qsl_received || "9999";
      const kb = b.qsl_received || "9999";
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.dxcc - b.dxcc;
    });
    result[band] = items;
  }
  return result;
}

/**
 * 渲染单个波段的 Markdown 表格
 */
function renderBandTable(bandName, items) {
  const lines = [];
  lines.push(`### ${bandName} (${items.length} entities)`);
  lines.push("");
  if (items.length === 0) {
    lines.push("_No confirmed entities on this band._");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    "| # | Callsign | Entity | Mode | Band | QSO Date | QSL Received |",
  );
  lines.push(
    "|---|----------|--------|------|------|----------|--------------|",
  );
  items.forEach((it, i) => {
    lines.push(
      `| ${i + 1} | ${it.callsign} | ${it.entity} | ${it.mode} | ${it.band} | ${it.qso_date} | ${it.qsl_received} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

/**
 * 生成锚点 ID（GitHub Markdown 兼容）
 */
function bandAnchor(band) {
  return band.toLowerCase().replace(/\s+/g, "-");
}

/**
 * 主入口：基于 ADIF 文件生成按波段的 DXCC 统计报告（JSON + Markdown）
 *
 * @param {string} adifFilePath
 * @param {object} configContext - 来自 createConfigContext()
 * @returns {{jsonPath:string, mdPath:string, summary:object, challenge:number}}
 */
export function generateDXCCByBand(adifFilePath, configContext) {
  if (!fs.existsSync(adifFilePath)) {
    throw new Error(`ADIF file not found: ${adifFilePath}`);
  }

  console.log(
    "[LoTW-DXCC] DXCC-band-stats: Building per-band confirmed-DXCC tables...",
  );
  const adifData = fs.readFileSync(adifFilePath, "utf8");
  const qslRecords = parseQSLRecords(adifData);
  console.log(
    `[LoTW-DXCC] DXCC-band-stats: Found ${qslRecords.length} QSL-confirmed records`,
  );

  const bandBuckets = buildPerBandFirstQSL(qslRecords);

  // 构建摘要：每个波段的已确认 DXCC 数
  const allBands = [...BAND_ORDER, "Other"];
  const summary = {};
  let challenge = 0;
  for (const band of allBands) {
    const count = bandBuckets[band].length;
    summary[band] = count;
    challenge += count;
  }

  const callsign = configContext.getCallsign
    ? configContext.getCallsign()
    : null;
  const dataDir = configContext.getPath("data");

  // --- 写 JSON ---
  const json = {
    callsign: callsign || "",
    last_updated: new Date().toISOString(),
    challenge,
    summary,
    by_band: bandBuckets,
  };

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const jsonPath = path.resolve(dataDir, "lotwDxccByBand.json");
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), "utf8");
  console.log(`[LoTW-DXCC] DXCC-band-stats: JSON written to ${jsonPath}`);

  // --- 渲染 Markdown ---
  const mdLines = [];
  const heading = callsign
    ? `DXCC by Band — ${callsign}`
    : "DXCC by Band";
  mdLines.push(`# ${heading}`);
  mdLines.push("");

  // Shields.io 徽章
  const challengeBadge = `![Challenge](https://img.shields.io/badge/Challenge-${challenge}-red)`;
  const bandBadges = allBands
    .filter((b) => summary[b] > 0)
    .map((b) => `![${b}](https://img.shields.io/badge/${encodeURIComponent(b)}-${summary[b]}-blue)`)
    .join(" ");
  mdLines.push(`${challengeBadge} ${bandBadges}`);
  mdLines.push("");
  mdLines.push(`Last updated: ${json.last_updated}`);
  mdLines.push("");

  // 目录（Table of Contents）
  mdLines.push("## Table of Contents");
  mdLines.push("");
  mdLines.push("- [Summary by Band](#summary-by-band)");
  for (const band of allBands) {
    if (summary[band] > 0) {
      mdLines.push(`- [${band} (${summary[band]})](#${bandAnchor(band)})`);
    }
  }
  mdLines.push("");

  // Summary 表格
  mdLines.push("## Summary by Band");
  mdLines.push("");
  mdLines.push("| Band | Confirmed DXCC |");
  mdLines.push("|------|----------------|");
  for (const band of allBands) {
    mdLines.push(`| [${band}](#${bandAnchor(band)}) | ${summary[band]} |`);
  }
  mdLines.push(`| **Challenge Total** | **${challenge}** |`);
  mdLines.push("");
  mdLines.push(
    "> **DXCC Challenge** = sum of unique DXCC entities confirmed on each band (160m through 6m). An entity confirmed on multiple bands counts once per band.",
  );
  mdLines.push("");
  mdLines.push(
    "Each table below is sorted by **QSL received date** in ascending order.",
  );
  mdLines.push("");

  // 各波段详情表格
  for (const band of allBands) {
    mdLines.push(`## ${band}`);
    mdLines.push("");
    mdLines.push(renderBandTable(band, bandBuckets[band]));
    mdLines.push("[Back to top](#table-of-contents)");
    mdLines.push("");
  }

  const mdPath = path.resolve(dataDir, "lotwDxccByBand.md");
  fs.writeFileSync(mdPath, mdLines.join("\n"), "utf8");
  console.log(`[LoTW-DXCC] DXCC-band-stats: Markdown written to ${mdPath}`);

  return { jsonPath, mdPath, summary, challenge };
}
