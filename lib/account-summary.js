import { saveJSONData } from "./file-manager.js";

/**
 * Build an account-level summary from per-callsign LoTW statistics.
 *
 * QSO and QSL record totals are additive because each callsign is queried with
 * qso_owncall. DXCC confirmations are a union: an entity confirmed by multiple
 * callsigns is counted once at account level.
 */
export function buildAccountSummary(callsignStats) {
  if (!Array.isArray(callsignStats) || callsignStats.length === 0) {
    throw new Error("At least one callsign result is required");
  }

  const dxccStats = {};
  let totalQso = 0;
  let totalQsl = 0;
  let lastQsoRx = "";
  let lastQsl = "";

  for (const stats of callsignStats) {
    if (!stats || typeof stats !== "object") {
      throw new Error("Invalid callsign statistics result");
    }

    totalQso += Number(stats.total_qso) || 0;
    totalQsl += Number(stats.total_qsl) || 0;
    lastQsoRx = latestTimestamp(lastQsoRx, stats.app_lotw_lastQsoRx);
    lastQsl = latestTimestamp(lastQsl, stats.app_lotw_lastQsl);

    for (const [dxccCode, entityStats] of Object.entries(
      stats.dxcc_stats || {},
    )) {
      if (!dxccStats[dxccCode]) {
        dxccStats[dxccCode] = { qso: 0, qsl: 0 };
      }
      dxccStats[dxccCode].qso += Number(entityStats.qso) || 0;
      dxccStats[dxccCode].qsl = Math.max(
        dxccStats[dxccCode].qsl,
        Number(entityStats.qsl) > 0 ? 1 : 0,
      );
    }
  }

  const dxccConfirmed = Object.values(dxccStats).filter(
    (entityStats) => entityStats.qsl > 0,
  ).length;

  return {
    app_lotw_lastQsoRx: lastQsoRx,
    app_lotw_lastQsl: lastQsl,
    last_updated: new Date().toISOString(),
    total_qso: totalQso,
    total_qsl: totalQsl,
    dxcc_confirmed: dxccConfirmed,
    dxcc_stats: dxccStats,
  };
}

export function saveAccountSummary(callsignStats, outputPath) {
  const accountSummary = buildAccountSummary(callsignStats);
  saveJSONData(accountSummary, outputPath);
  return accountSummary;
}

function latestTimestamp(currentValue, candidateValue) {
  if (!candidateValue) return currentValue;
  if (!currentValue || candidateValue > currentValue) return candidateValue;
  return currentValue;
}
