#!/usr/bin/env node
/**
 * verify-paths.js — Check that every filepath in pending_operations.json
 * points to a real file inside ./Music.
 *
 * Usage:
 *   node scripts/verify-paths.js
 */

import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OPS_FILE = resolve(ROOT, "pending_operations.json");

async function main() {
  const raw = await readFile(OPS_FILE, "utf-8");
  const pending = JSON.parse(raw);

  const entries = [
    ...(pending.operations ?? []).map((e) => ({ section: "operations", fp: e.filepath })),
    ...(pending.manual_review ?? []).map((e) => ({ section: "manual_review", fp: e.filepath })),
  ];

  let ok = 0;
  let missing = 0;
  const missingPaths = [];

  for (const { section, fp } of entries) {
    const abs = resolve(ROOT, fp);
    try {
      await access(abs, constants.F_OK);
      ok++;
    } catch {
      missing++;
      missingPaths.push({ section, fp });
    }
  }

  const total = ok + missing;
  const pct = total ? ((ok / total) * 100).toFixed(1) : "0.0";

  console.log(`\n  Checked:  ${total} filepaths`);
  console.log(`  Found:    ${ok}`);
  console.log(`  Missing:  ${missing}`);
  console.log(`  Match:    ${pct}%\n`);

  if (missingPaths.length) {
    console.log("  Missing paths:");
    for (const { section, fp } of missingPaths.slice(0, 30)) {
      console.log(`    [${section}] ${fp}`);
    }
    if (missingPaths.length > 30) {
      console.log(`    ... and ${missingPaths.length - 30} more`);
    }
    console.log();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
