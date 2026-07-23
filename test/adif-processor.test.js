import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "@jest/globals";
import { mergeIncrementalADIFData } from "../lib/adif-processor.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function field(name, value) {
  return `<${name}:${value.length}>${value}`;
}

function record({ timestamp, call, qsl = "N", frequency = "14.07400" }) {
  return [
    field("APP_LoTW_QSO_TIMESTAMP", timestamp),
    field("CALL", call),
    field("BAND", "20M"),
    field("FREQ", frequency),
    field("MODE", "FT8"),
    field("STATION_CALLSIGN", "BD4VOJ"),
    field("APP_LoTW_OWNCALL", "BD4VOJ"),
    field("QSO_DATE", timestamp.slice(0, 10).replaceAll("-", "")),
    field("TIME_ON", timestamp.slice(11, 19).replaceAll(":", "")),
    field("QSL_RCVD", qsl),
    "<eor>",
  ].join("\n");
}

function adif({ lastQsoRx, records }) {
  return [
    "ARRL Logbook of the World Status Report",
    field("PROGRAMID", "LoTW"),
    field("APP_LoTW_LASTQSORX", lastQsoRx),
    field("APP_LoTW_NUMREC", String(records.length)),
    "<eoh>",
    ...records,
    "<APP_LoTW_EOF>",
  ].join("\n");
}

function createContext(adifPath) {
  return {
    config: { qsoDataFileBackup: false },
    getPath(kind) {
      expect(kind).toBe("adif");
      return adifPath;
    },
    createBackupPath() {
      return `${adifPath}.bak`;
    },
  };
}

test("incremental QSO merge advances cursor and is idempotent", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lotw-dxcc-stats-"));
  temporaryDirectories.push(directory);

  const adifPath = path.join(directory, "lotwQso.adif");
  const original = record({
    timestamp: "2026-07-01T01:02:03Z",
    call: "W1AW",
    qsl: "Y",
  });
  const added = record({
    timestamp: "2026-07-02T04:05:06Z",
    call: "JA1ABC",
  });
  fs.writeFileSync(
    adifPath,
    adif({ lastQsoRx: "2026-07-01 02:00:00", records: [original] }),
  );

  const incremental = adif({
    lastQsoRx: "2026-07-02 05:00:00",
    records: [
      record({
        timestamp: "2026-07-01T01:02:03Z",
        call: "W1AW",
      }),
      added,
      added,
    ],
  });

  await mergeIncrementalADIFData(
    incremental,
    adifPath,
    createContext(adifPath),
  );

  const merged = fs.readFileSync(adifPath, "utf8");
  expect(merged).toMatch(/<APP_LoTW_LASTQSORX:19>2026-07-02 05:00:00/);
  expect(merged).toMatch(/<APP_LoTW_NUMREC:1>2/);
  expect((merged.match(/<eor>/gi) || []).length).toBe(2);
  expect((merged.match(/<CALL:4>W1AW/gi) || []).length).toBe(1);
  expect((merged.match(/<CALL:6>JA1ABC/gi) || []).length).toBe(1);
  expect(merged).toMatch(/<QSL_RCVD:1>Y/);
});

test("same-second QSOs with different callsigns are preserved", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lotw-dxcc-stats-"));
  temporaryDirectories.push(directory);

  const adifPath = path.join(directory, "lotwQso.adif");
  fs.writeFileSync(
    adifPath,
    adif({
      lastQsoRx: "2026-07-01 02:00:00",
      records: [
        record({
          timestamp: "2026-07-01T01:02:03Z",
          call: "W1AW",
        }),
      ],
    }),
  );

  await mergeIncrementalADIFData(
    adif({
      lastQsoRx: "2026-07-01 03:00:00",
      records: [
        record({
          timestamp: "2026-07-01T01:02:03Z",
          call: "K1ABC",
        }),
      ],
    }),
    adifPath,
    createContext(adifPath),
  );

  const merged = fs.readFileSync(adifPath, "utf8");
  expect((merged.match(/<eor>/gi) || []).length).toBe(2);
  expect(merged).toMatch(/<CALL:4>W1AW/);
  expect(merged).toMatch(/<CALL:5>K1ABC/);
});
