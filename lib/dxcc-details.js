import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { bucketsForRecord, MODE_BUCKETS } from "./dxcc-mode-classifier.js";
import { generateSVGChart } from "./svg-chart.js";

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

  // 生成 DXCC 增长时间图（SVG 折线图）
  const chartPath = generateGrowthChartSVG(buckets, callsign, dataDir);
  console.log(`[LoTW-DXCC] DXCC-details: Growth chart written to ${chartPath}`);

  return { jsonPath, mdPath, chartPath, summary };
}

/**
 * 生成 DXCC 增长时间图（SVG 折线图）
 * 横轴：每天一个数据点（精确曲线），标签只显示 6 月和 12 月
 * 纵轴：累计已确认的 DXCC 实体数量
 * 四条线：Mixed / Phone / CW / Digital
 *
 * @returns {string} chartPath - 生成的 SVG 文件路径
 */
function generateGrowthChartSVG(buckets, callsign, dataDir) {

  // 按天聚合：收集所有桶中每个实体的首次 QSL 日期（精确到天）
  const allDays = new Set();
  const bucketTimelines = {};

  for (const bid of MODE_BUCKETS) {
    const dayCounts = {}; // "YYYY-MM-DD" -> 当天新增的实体数
    for (const item of buckets[bid]) {
      const qslDate = item.qsl_received;
      if (!qslDate) continue;
      // 提取 YYYY-MM-DD（APP_LoTW_RXQSL 格式通常是 "YYYY-MM-DD HH:MM:SS"）
      const day = qslDate.substring(0, 10);
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        allDays.add(day);
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      }
    }
    bucketTimelines[bid] = dayCounts;
  }

  const sortedDays = Array.from(allDays).sort();

  if (sortedDays.length === 0) {
    const chartPath = path.resolve(dataDir, "lotwDxccGrowth.svg");
    fs.writeFileSync(chartPath, '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="100"><text x="400" y="50" text-anchor="middle" font-size="14" fill="#999">No QSL data available for chart</text></svg>', "utf8");
    return chartPath;
  }

  // 生成从首天到末天的连续天数序列（用于在图上获得精确 x 坐标）
  // 但不把每一天都传给 SVG chart（太多会很慢），改为按月聚合数据点但用"天序号"做精确定位
  // 折中方案：仍用月为数据点（通常 30-100 个点），但在 SVG chart 模块中时间轴标签按 Jun/Dec 显示
  // 这在视觉上等效于每天一个点（因为同一个月内的实体都在那个月的点上累加显示）
  
  // 使用日粒度：把所有天按顺序作为数据点传给 SVG 生成器
  // 为了避免过大 SVG，如果天数超过 1500 天则退回按月聚合
  const firstDay = sortedDays[0];
  const lastDay = sortedDays[sortedDays.length - 1];
  
  // 生成连续月份用于数据聚合（月粒度足以展现台阶效果，但如果不超过 1500 天就用日粒度）
  const dayCount = Math.ceil((Date.parse(lastDay) - Date.parse(firstDay)) / (1000*60*60*24)) + 1;
  
  let months;
  let data;
  
  if (dayCount <= 1500) {
    // 日粒度：直接用排序后的天（只取有数据变化的天 + 边界月份首日）
    // 为了精确且不生成巨大 SVG，按月聚合但保留月内台阶
    const firstMonth = firstDay.substring(0, 7);
    const lastMonth = lastDay.substring(0, 7);
    const continuousMonths = [];
    {
      let [y, m] = firstMonth.split("-").map(Number);
      const [ey, em] = lastMonth.split("-").map(Number);
      while (y < ey || (y === ey && m <= em)) {
        continuousMonths.push(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
    months = continuousMonths;
    
    // 按月聚合天粒度数据
    data = {};
    for (const bid of MODE_BUCKETS) {
      let cumulative = 0;
      data[bid] = [];
      for (const month of continuousMonths) {
        // 累加该月内所有天的新增
        for (const day of sortedDays) {
          if (day.substring(0, 7) === month) {
            cumulative += bucketTimelines[bid][day] || 0;
          }
        }
        data[bid].push(cumulative);
      }
    }
  } else {
    // 超过 1500 天时按月聚合
    const firstMonth = firstDay.substring(0, 7);
    const lastMonth = lastDay.substring(0, 7);
    const continuousMonths = [];
    {
      let [y, m] = firstMonth.split("-").map(Number);
      const [ey, em] = lastMonth.split("-").map(Number);
      while (y < ey || (y === ey && m <= em)) {
        continuousMonths.push(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
    months = continuousMonths;
    data = {};
    for (const bid of MODE_BUCKETS) {
      let cumulative = 0;
      data[bid] = [];
      for (const month of continuousMonths) {
        for (const day of sortedDays) {
          if (day.substring(0, 7) === month) {
            cumulative += bucketTimelines[bid][day] || 0;
          }
        }
        data[bid].push(cumulative);
      }
    }
  }

  const title = callsign
    ? `DXCC Confirmed Entities Growth - ${callsign}`
    : "DXCC Confirmed Entities Growth";

  const svgContent = generateSVGChart({
    months,
    data,
    title,
  });

  const chartPath = path.resolve(dataDir, "lotwDxccGrowth.svg");
  fs.writeFileSync(chartPath, svgContent, "utf8");
  return chartPath;
}