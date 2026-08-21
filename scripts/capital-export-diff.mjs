#!/usr/bin/env node
/**
 * Layout check of a generated workbook against the 17 Aug original.
 * Does not write the original. Compares sheet names, Master Tracker
 * header rows, and formula presence — not every cell value (the live
 * book has moved on).
 */
import { resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ORIG = resolve(
  homedir(),
  "Developer/Forge-Capital/260817 Master Investor Tracker TF (CANONICAL).xlsx",
);
const GEN =
  process.argv[2] ||
  resolve(
    homedir(),
    "Developer/Forge-Capital/260821 Master Investor Tracker TF (CANONICAL).xlsx",
  );

const orig = XLSX.readFile(ORIG);
const gen = XLSX.readFile(GEN);
const fails = [];
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " :: " + detail : ""}`);
  if (!ok) fails.push(label);
}

const origSheets = orig.SheetNames.filter((n) => n !== "Generated");
const genSheets = gen.SheetNames.filter((n) => n !== "Generated");
for (const name of origSheets) {
  check(`sheet ${name} present`, genSheets.includes(name));
}

const oH = XLSX.utils.sheet_to_json(orig.Sheets["Master Tracker"], { header: 1, defval: null });
const gH = XLSX.utils.sheet_to_json(gen.Sheets["Master Tracker"], { header: 1, defval: null });
check("Master Tracker row-1 group headers", JSON.stringify(oH[0]?.slice(0, 15)) === JSON.stringify(gH[0]?.slice(0, 15)), `${gH[0]?.slice(0, 9)}`);
check("Master Tracker row-2 sub-headers", JSON.stringify(oH[1]?.slice(0, 15)) === JSON.stringify(gH[1]?.slice(0, 15)));
check("investor column is index 9 on row 2", gH[1]?.[9] === "Investor", String(gH[1]?.[9]));
const dataRows = (gH.length || 0) - 2;
check("data rows >= 2700", dataRows >= 2700, String(dataRows));

// Formula cells: SheetJS community build often drops .f on read.
// openpyxl is the writer — check the XML via a sidecar python one-liner in the report.
const { execFileSync } = require("node:child_process");
const py = execFileSync(
  "python3",
  [
    "-c",
    "import openpyxl,sys; ws=openpyxl.load_workbook(sys.argv[1])['Master Tracker']; print(ws['A3'].value or ''); print(ws['R3'].value or '')",
    GEN,
  ],
  { encoding: "utf8" },
).trim().split("\n");
check("A3 is a days-ago formula", /TODAY\(\)/.test(py[0] || ""), (py[0] || "").slice(0, 80));
check("R3 is a days-since formula", /TODAY\(\)/.test(py[1] || ""), (py[1] || "").slice(0, 80));

if (fails.length) {
  console.error("layout_diff_failed", fails);
  process.exit(1);
}
console.log("layout_diff_ok");
