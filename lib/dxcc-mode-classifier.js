/**
 * 将 ADIF 的 MODE / SUBMODE 字段映射到 DXCC 的四个统计桶
 *   - phone   ：模拟话音 (SSB / AM / FM 等)
 *   - cw      ：CW
 *   - digital ：数字模式 (FT8 / FT4 / RTTY / PSK / JT* / MFSK / OLIVIA / MSK144 / Q65 / VARA 等)
 *   - mixed   ：所有 QSL 通联（与具体模式无关，等价于 LoTW DXCC Award Account 的 "Mixed"）
 *
 * 设计要点：
 *   1. 一条 QSL 记录会被同时计入 mixed + 它对应模式的桶
 *   2. 大小写不敏感，未知模式直接计入 mixed 但不计入 phone/cw/digital
 */

const PHONE_MODES = new Set([
  "SSB",
  "AM",
  "FM",
  "USB",
  "LSB",
  "DSB",
  "ISB",
  "FAX",
  "PHONE",
]);

const CW_MODES = new Set(["CW", "PCW"]);

// 数字模式：覆盖 LoTW 上常见的 ADIF 模式；判断时也接受这些前缀
const DIGITAL_MODES = new Set([
  "FT8",
  "FT4",
  "JT65",
  "JT9",
  "JT4",
  "JT44",
  "JT6M",
  "MFSK",
  "MFSK16",
  "MFSK32",
  "MFSK64",
  "MFSK128",
  "RTTY",
  "PSK",
  "PSK31",
  "PSK63",
  "PSK125",
  "QPSK31",
  "QPSK63",
  "QPSK125",
  "OLIVIA",
  "OPERA",
  "PAX",
  "PAX2",
  "ROS",
  "PACTOR",
  "PACKET",
  "PSK10",
  "DOMINO",
  "DOMINOEX",
  "DOMINOF",
  "MSK144",
  "Q65",
  "T10",
  "ARDOP",
  "VARA",
  "VARAFM",
  "VARAHF",
  "WSPR",
  "DIGITALVOICE",
  "DIGITAL",
  "JS8",
  "FSK441",
  "FSK31",
  "ATV",
  "C4FM",
  "DSTAR",
  "HELL",
  "HELL80",
  "FELDHELL",
  "PSKFEC31",
  "MT63",
  "THOR",
  "THROB",
  "THROBX",
  "CONTESTI",
  "CHIP",
  "CHIP64",
  "CHIP128",
  "FT8WPR",
]);

/**
 * 标准化 ADIF mode/submode 字段到大写并去掉空格
 */
function normalize(value) {
  if (!value) return "";
  return String(value).trim().toUpperCase();
}

/**
 * 判断给定模式属于 phone / cw / digital 哪个分类，未知则返回 null
 *
 * @param {string} mode - ADIF MODE 字段
 * @param {string} submode - ADIF SUBMODE 字段（优先级更高）
 * @returns {"phone"|"cw"|"digital"|null}
 */
export function classifyMode(mode, submode) {
  // SUBMODE 比 MODE 更精细（例如 MODE=MFSK, SUBMODE=FT8），优先看 SUBMODE
  const candidates = [normalize(submode), normalize(mode)].filter(Boolean);

  for (const m of candidates) {
    if (PHONE_MODES.has(m)) return "phone";
    if (CW_MODES.has(m)) return "cw";
    if (DIGITAL_MODES.has(m)) return "digital";
    // 兜底：以已知数字模式前缀开头也归为 digital
    for (const prefix of DIGITAL_MODES) {
      if (m.startsWith(prefix)) return "digital";
    }
  }
  return null;
}

/**
 * 给定一条 QSL 记录，返回它应该归属的所有桶 ID（含 "mixed"）
 * @param {object} record - ADIF 记录（字段名小写）
 * @returns {Array<"mixed"|"phone"|"cw"|"digital">}
 */
export function bucketsForRecord(record) {
  const buckets = ["mixed"];
  const cls = classifyMode(record.mode, record.submode);
  if (cls) buckets.push(cls);
  return buckets;
}

export const MODE_BUCKETS = ["mixed", "phone", "cw", "digital"];
