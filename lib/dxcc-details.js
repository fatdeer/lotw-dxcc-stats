import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { bucketsForRecord, MODE_BUCKETS } from "./dxcc-mode-classifier.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载 DXCC 实体名称表
const DXCC_ENTITIES = JSON.parse(
  fs.readFileSync(
    join(__dirname, "../schemas/dxcc-entities.json"),
    "utf8",
  ),
);

/**
 * 根据 DXCC 编号获取实体名称，未知时返回 "DXCC #<id>"
 */
export function getDXCCName(dxccCode) {
  return DXCC_ENTITIES[String(dxccCode)] || `DXCC #${dxccCode}`;
}

/**
 * 把 ADIF 风格的日期 (YYYYMMDD) 标准化为 YYYY-MM-DD；
 * APP_LoTW_RXQSL 一般已经是 YYYY-MM-DD HH:MM:SS，原样返回
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
 * LoTW 有时会在 APP_LoTW_RXQSL 值后面附带注释如：
 *   "2024-01-20 10:00:00 // QSL record matched/modified at LoTW"
 * 我们只保留时间戳部分（YYYY-MM-DD HH:MM:SS）
 */
function cleanQslTimestamp(value) {
  if (!value) return "";
  // 移除 // 及之后的所有内容
  const cleaned = value.replace(/\s*\/\/.*$/, "").trim();
  return cleaned;
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
  // 兜底：用 QSO 日期（虽不是 QSL 时间，但能保证稳定排序）
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
 * 复用与 adif-parser.js 一致的字段解析风格
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
 * 给定一组 QSL 记录，按 mode 桶产生"每个 DXCC 实体的首次 QSL"列表
 *
 * 处理规则：
 *   - 对每个桶（mixed / phone / cw / digital）独立计算
 *   - 同一个 DXCC 实体若有多条 QSL，取 QSL 时间最早的那条作为代表
 *   - 桶内最终按 QSL 时间升序输出（最早 QSL 的实体位列第一行）
 */
function buildPerModeFirstQSL(qslRecords) {
  // bucket -> dxccCode -> 最早的那条记录
  const buckets = Object.fromEntries(
    MODE_BUCKETS.map((b) => [b, new Map()]),
  );

  for (const r of qslRecords) {
    const dxccCode = r.dxcc.trim();
    const bucketIds = bucketsForRecord(r);

    for (const bid of bucketIds) {
      const bucket = buckets[bid];
      const existing = bucket.get(dxccCode);
      if (!existing || qslSortKey(r) < qslSortKey(existing)) {
        bucket.set(dxccCode, r);
      }
    }
  }

  // 各桶按 QSL 时间升序输出
  const result = {};
  for (const bid of MODE_BUCKETS) {
    const items = Array.from(buckets[bid].entries()).map(
      ([dxccCode, record]) => ({
        dxcc: parseInt(dxccCode, 10),
        entity: getDXCCName(dxccCode),
        callsign: record.call || "",
        mode: record.submode || record.mode || "",
        band: record.band || "",
        qso_date: fmtDate(record.qso_date),
        qso_time: record.time_on || "",
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
    result[bid] = items;
  }
  return result;
}

/**
 * 渲染单个桶的 Markdown 表格
 */
function renderBucketTable(title, items) {
  const lines = [];
  lines.push(`### ${title} (${items.length} entities)`);
  lines.push("");
  if (items.length === 0) {
    lines.push("_No confirmed entities in this mode bucket._");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    "| # | DXCC | Entity | Worked Callsign | Mode | Band | QSO Date | QSO Time | QSL Received |",
  );
  lines.push(
    "|---|------|--------|------------------|------|------|----------|----------|--------------|",
  );
  items.forEach((it, i) => {
    lines.push(
      `| ${i + 1} | ${it.dxcc} | ${it.entity} | ${it.callsign} | ${it.mode} | ${it.band} | ${it.qso_date} | ${it.qso_time} | ${it.qsl_received} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

/**
 * 主入口：基于 ADIF 文件生成两份 DXCC 明细报告（JSON + Markdown）
 *
 * @param {string} adifFilePath
 * @param {object} configContext - 来自 createConfigContext()
 * @returns {{jsonPath:string, mdPath:string, summary:object}}
 */
export function generateDXCCDetails(adifFilePath, configContext) {
  if (!fs.existsSync(adifFilePath)) {
    throw new Error(`ADIF file not found: ${adifFilePath}`);
  }

  console.log(
    "[LoTW-DXCC] DXCC-details: Building per-mode confirmed-DXCC tables...",
  );
  const adifData = fs.readFileSync(adifFilePath, "utf8");
  const qslRecords = parseQSLRecords(adifData);
  console.log(
    `[LoTW-DXCC] DXCC-details: Found ${qslRecords.length} QSL-confirmed records`,
  );

  const buckets = buildPerModeFirstQSL(qslRecords);

  const summary = {
    mixed: buckets.mixed.length,
    phone: buckets.phone.length,
    cw: buckets.cw.length,
    digital: buckets.digital.length,
  };

  const callsign = configContext.getCallsign
    ? configContext.getCallsign()
    : null;
  const dataDir = configContext.getPath("data");

  // 准备 JSON
  const json = {
    callsign: callsign || "",
    last_updated: new Date().toISOString(),
    summary,
    by_mode: buckets,
  };

  // 写 JSON
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const jsonPath = path.resolve(dataDir, "lotwDxccDetails.json");
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), "utf8");
  console.log(`[LoTW-DXCC] DXCC-details: JSON written to ${jsonPath}`);

  // 渲染 Markdown
  const mdLines = [];
  const heading = callsign
    ? `DXCC Confirmed Entities — ${callsign}`
    : "DXCC Confirmed Entities";
  mdLines.push(`# ${heading}`);
  mdLines.push("");

  // Shields.io 徽章（使用 lotwDxccDetails.json 的 summary 字段）
  // 使用静态徽章，因为 shields.io dynamic JSON 需要公网可达的 URL，
  // 而实际值在每次生成时已知，直接写入即可。
  mdLines.push(
    `![Mixed](https://img.shields.io/badge/Mixed-${summary.mixed}-blue) ` +
    `![Phone](https://img.shields.io/badge/Phone-${summary.phone}-green) ` +
    `![CW](https://img.shields.io/badge/CW-${summary.cw}-orange) ` +
    `![Digital](https://img.shields.io/badge/Digital-${summary.digital}-purple)`,
  );
  mdLines.push("");
  mdLines.push(`Last updated: ${json.last_updated}`);
  mdLines.push("");

  // 目录（Table of Contents）
  mdLines.push("## Table of Contents");
  mdLines.push("");
  mdLines.push("- [Summary by Mode](#summary-by-mode)");
  mdLines.push(`- [Mixed (${summary.mixed})](#mixed)`);
  mdLines.push(`- [Phone (${summary.phone})](#phone)`);
  mdLines.push(`- [CW (${summary.cw})](#cw)`);
  mdLines.push(`- [Digital (${summary.digital})](#digital)`);
  mdLines.push("");

  // Summary 表格
  mdLines.push("## Summary by Mode");
  mdLines.push("");
  mdLines.push("| Mode | Confirmed DXCC |");
  mdLines.push("|------|----------------|");
  mdLines.push(`| [Mixed](#mixed) | ${summary.mixed} |`);
  mdLines.push(`| [Phone](#phone) | ${summary.phone} |`);
  mdLines.push(`| [CW](#cw) | ${summary.cw} |`);
  mdLines.push(`| [Digital](#digital) | ${summary.digital} |`);
  mdLines.push("");
  mdLines.push(
    "Each table below is sorted by **QSL received date** in ascending order — row 1 is the first DXCC entity confirmed in that mode bucket.",
  );
  mdLines.push("");

  // 四个模式桶的详情表格（带锚点 ID）
  mdLines.push("## Mixed");
  mdLines.push("");
  mdLines.push(renderBucketTable("Mixed", buckets.mixed));
  mdLines.push("[Back to top](#table-of-contents)");
  mdLines.push("");
  mdLines.push("## Phone");
  mdLines.push("");
  mdLines.push(renderBucketTable("Phone", buckets.phone));
  mdLines.push("[Back to top](#table-of-contents)");
  mdLines.push("");
  mdLines.push("## CW");
  mdLines.push("");
  mdLines.push(renderBucketTable("CW", buckets.cw));
  mdLines.push("[Back to top](#table-of-contents)");
  mdLines.push("");
  mdLines.push("## Digital");
  mdLines.push("");
  mdLines.push(renderBucketTable("Digital", buckets.digital));
  mdLines.push("[Back to top](#table-of-contents)");
  mdLines.push("");

  const mdPath = path.resolve(dataDir, "lotwDxccDetails.md");
  fs.writeFileSync(mdPath, mdLines.join("\n"), "utf8");
  console.log(`[LoTW-DXCC] DXCC-details: Markdown written to ${mdPath}`);

  // 生成 DXCC 增长时间图（Mermaid xychart）
  const chartMd = generateGrowthChart(buckets, callsign);
  const chartPath = path.resolve(dataDir, "lotwDxccGrowth.md");
  fs.writeFileSync(chartPath, chartMd, "utf8");
  console.log(`[LoTW-DXCC] DXCC-details: Growth chart written to ${chartPath}`);

  return { jsonPath, mdPath, chartPath, summary };
}

/**
 * 生成 DXCC 增长时间图（Mermaid xychart-beta）
 * 横轴：日期（按月聚合）
 * 纵轴：累计已确认的 DXCC 实体数量
 * 四条线：Mixed / Phone / CW / Digital
 */
function generateGrowthChart(buckets, callsign) {
  const lines = [];
  const heading = callsign
    ? `DXCC Growth Over Time — ${callsign}`
    : "DXCC Growth Over Time";
  lines.push(`# ${heading}`);
  lines.push("");
  lines.push("The chart below shows how the number of confirmed DXCC entities grew over time, broken down by mode bucket.");
  lines.push("");

  // 按月聚合：收集所有桶中每个实体的 QSL 日期，按月统计累计数
  const allMonths = new Set();
  const bucketTimelines = {};

  for (const bid of MODE_BUCKETS) {
    const monthCounts = {}; // month -> 当月新增的实体数
    for (const item of buckets[bid]) {
      const qslDate = item.qsl_received;
      if (!qslDate) continue;
      // 提取 YYYY-MM
      const month = qslDate.substring(0, 7);
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        allMonths.add(month);
        monthCounts[month] = (monthCounts[month] || 0) + 1;
      }
    }
    bucketTimelines[bid] = monthCounts;
  }

  // 排序所有月份
  const sortedMonths = Array.from(allMonths).sort();

  if (sortedMonths.length === 0) {
    lines.push("_No QSL dates available to generate chart._");
    return lines.join("\n");
  }

  // 按半年聚合：只在每年的 6 月和 12 月取一个数据点
  // 这样无论数据跨度多长，横轴都不会太密
  const firstMonth = sortedMonths[0]; // e.g. "2018-03"
  const lastMonth = sortedMonths[sortedMonths.length - 1]; // e.g. "2026-05"
  const startYear = parseInt(firstMonth.split("-")[0]);
  const endYear = parseInt(lastMonth.split("-")[0]);

  // 生成半年刻度点：YYYY-06 和 YYYY-12
  const biannualPoints = [];
  for (let y = startYear; y <= endYear; y++) {
    biannualPoints.push(`${y}-06`);
    biannualPoints.push(`${y}-12`);
  }
  // 只保留 <= lastMonth 的点（避免出现未来的空数据点）
  const validPoints = biannualPoints.filter((p) => p <= lastMonth);

  // 为每个桶计算在各刻度点的累计值
  const labels = validPoints;
  const timelineData = {};
  for (const bid of MODE_BUCKETS) {
    // 先算出每月累计
    let cumulative = 0;
    const monthlyCumulative = {}; // month -> cumulative count at end of that month
    for (const m of sortedMonths) {
      cumulative += bucketTimelines[bid][m] || 0;
      monthlyCumulative[m] = cumulative;
    }

    // 在每个半年点取 "截至该月的累计值"（取该月或之前最近月的值）
    timelineData[bid] = [];
    for (const point of validPoints) {
      // 找 <= point 的最大月份的累计值
      let val = 0;
      for (const m of sortedMonths) {
        if (m <= point) {
          val = monthlyCumulative[m];
        } else {
          break;
        }
      }
      timelineData[bid].push(val);
    }
  }

  // 生成 Mermaid xychart-beta
  lines.push("```mermaid");
  lines.push("xychart-beta");
  lines.push(`  title "DXCC Confirmed Entities Growth${callsign ? ' — ' + callsign : ''}"`);
  lines.push(`  x-axis [${labels.map(l => `"${l}"`).join(", ")}]`);
  lines.push(`  y-axis "Confirmed DXCC Entities"`);
  lines.push(`  line [${timelineData.mixed.join(", ")}]`);
  lines.push(`  line [${timelineData.phone.join(", ")}]`);
  lines.push(`  line [${timelineData.cw.join(", ")}]`);
  lines.push(`  line [${timelineData.digital.join(", ")}]`);
  lines.push("```");
  lines.push("");
  lines.push("**Legend:** Line 1 = Mixed (all modes), Line 2 = Phone, Line 3 = CW, Line 4 = Digital");
  lines.push("");

  return lines.join("\n");
}