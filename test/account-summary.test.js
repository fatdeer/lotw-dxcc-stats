import { expect, test } from "@jest/globals";
import { buildAccountSummary } from "../lib/account-summary.js";

test("account summary adds records and unions confirmed DXCC entities", () => {
  const summary = buildAccountSummary([
    {
      app_lotw_lastQsoRx: "2026-07-11 02:30:48",
      app_lotw_lastQsl: "2026-07-23 04:12:18",
      total_qso: 61596,
      total_qsl: 35643,
      dxcc_stats: {
        1: { qso: 10, qsl: 1 },
        2: { qso: 3, qsl: 0 },
      },
    },
    {
      app_lotw_lastQsoRx: "2025-12-31 16:15:32",
      app_lotw_lastQsl: "2026-07-22 04:23:36",
      total_qso: 8281,
      total_qsl: 5646,
      dxcc_stats: {
        1: { qso: 2, qsl: 1 },
        2: { qso: 4, qsl: 1 },
        3: { qso: 1, qsl: 0 },
      },
    },
  ]);

  expect(summary.total_qso).toBe(69877);
  expect(summary.total_qsl).toBe(41289);
  expect(summary.app_lotw_lastQsoRx).toBe("2026-07-11 02:30:48");
  expect(summary.app_lotw_lastQsl).toBe("2026-07-23 04:12:18");
  expect(summary.dxcc_confirmed).toBe(2);
  expect(summary.dxcc_stats).toEqual({
    1: { qso: 12, qsl: 1 },
    2: { qso: 7, qsl: 1 },
    3: { qso: 1, qsl: 0 },
  });
  expect(summary.last_updated).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
});

test("account summary rejects an empty result set", () => {
  expect(() => buildAccountSummary([])).toThrow(
    "At least one callsign result is required",
  );
});
