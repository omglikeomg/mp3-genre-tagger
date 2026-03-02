#!/usr/bin/env node
// fix-genres.mjs — Canonicalize invalid/abbreviated genre strings in a
//                  pending_operations JSON file.
//
// Two classes of problem are fixed:
//
//   1. Abbreviated base genre — e.g. "Hip Hop" → "Hip Hop [Rap, Trap]"
//      The script finds the single canonical genre that *starts with* the
//      invalid string (case-insensitive).  If more than one canonical genre
//      starts with the same prefix the match is ambiguous and the entry is
//      reported but left unchanged.
//
//   2. [DJ SET] on an abbreviated base — e.g. "Hip Hop [DJ SET]"
//      The [DJ SET] suffix is stripped, the base is resolved as above, then
//      the suffix is re-attached: "Hip Hop [Rap, Trap] [DJ SET]".
//
// Usage:
//   node scripts/fix-genres.mjs                          # fix pending_operations.json (dry-run)
//   node scripts/fix-genres.mjs --apply                  # write changes
//   node scripts/fix-genres.mjs --file pending_operations_remapped.json --apply
//   node scripts/fix-genres.mjs --file pending_operations_remapped.json  # dry-run

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { VALID_GENRES } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { file: "pending_operations.json", apply: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--apply") {
      args.apply = true;
    } else if (argv[i] === "--file" && argv[i + 1]) {
      args.file = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`
fix-genres.mjs — Canonicalize abbreviated/invalid genres in a pending_operations file

Usage:
  node scripts/fix-genres.mjs [--file <path>] [--apply]

Options:
  --file <path>   Path to the JSON file to fix (default: pending_operations.json)
  --apply         Write the fixed file to disk (default: dry-run, no writes)
  --help, -h      Show this help message

Examples:
  node scripts/fix-genres.mjs
  node scripts/fix-genres.mjs --apply
  node scripts/fix-genres.mjs --file pending_operations_remapped.json --apply
`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

// ── Genre resolution ──────────────────────────────────────────────────────────

const DJ_SET_SUFFIX_RE = /\s*\[DJ SET\]\s*$/i;

/**
 * Given a raw genre string from the file, return the canonical form or null
 * if it cannot be resolved unambiguously.
 *
 * Returns an object:
 *   { canonical: string, changed: boolean, ambiguous: boolean, candidates?: string[] }
 */
function resolve(raw) {
  if (!raw) return null;

  const hasDjSet = DJ_SET_SUFFIX_RE.test(raw);
  const base = raw.replace(DJ_SET_SUFFIX_RE, "").trim();
  const baseLower = base.toLowerCase();

  // 1. Exact match on the base — already canonical (or just needs DJ SET re-attached).
  const exact = VALID_GENRES.find((g) => g.toLowerCase() === baseLower);
  if (exact) {
    const canonical = hasDjSet ? `${exact} [DJ SET]` : exact;
    return { canonical, changed: canonical !== raw, ambiguous: false };
  }

  // 2. Prefix match — find all canonical genres that start with the base string.
  const candidates = VALID_GENRES.filter((g) =>
    g.toLowerCase().startsWith(baseLower),
  );

  if (candidates.length === 1) {
    const canonical = hasDjSet
      ? `${candidates[0]} [DJ SET]`
      : candidates[0];
    return { canonical, changed: canonical !== raw, ambiguous: false };
  }

  if (candidates.length > 1) {
    return { canonical: raw, changed: false, ambiguous: true, candidates };
  }

  // 3. No match at all.
  return { canonical: raw, changed: false, ambiguous: false, unresolved: true };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
const filePath = path.resolve(PROJECT_ROOT, args.file);

if (!fs.existsSync(filePath)) {
  console.error(`❌  File not found: ${filePath}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch (err) {
  console.error(`❌  Failed to parse JSON: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(data.operations)) {
  console.error('❌  JSON does not contain an "operations" array.');
  process.exit(1);
}

console.log(`\n📂  File   : ${filePath}`);
console.log(`🏁  Mode   : ${args.apply ? "APPLY" : "DRY RUN"}\n`);

let fixedCount = 0;
let ambiguousCount = 0;
let unresolvedCount = 0;

for (const op of data.operations) {
  for (const field of ["primary_genre", "secondary_genre"]) {
    const raw = op[field];
    if (!raw) continue;

    const result = resolve(raw);
    if (!result) continue;

    if (result.ambiguous) {
      console.warn(
        `⚠️  Ambiguous  [${field}] "${raw}"\n` +
          `     Candidates: ${result.candidates.join(" | ")}\n` +
          `     filepath  : ${op.filepath}\n`,
      );
      ambiguousCount++;
      continue;
    }

    if (result.unresolved) {
      console.error(
        `❓  Unresolved [${field}] "${raw}"\n` +
          `     filepath  : ${op.filepath}\n`,
      );
      unresolvedCount++;
      continue;
    }

    if (result.changed) {
      console.log(
        `✏️   Fixed      [${field}] "${raw}"\n` +
          `           →  "${result.canonical}"\n` +
          `     filepath  : ${op.filepath}\n`,
      );
      if (args.apply) {
        op[field] = result.canonical;
      }
      fixedCount++;
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("─".repeat(60));
console.log(`  Fixed      : ${fixedCount}`);
console.log(`  Ambiguous  : ${ambiguousCount}  (manual review needed)`);
console.log(`  Unresolved : ${unresolvedCount}  (not in taxonomy)`);

if (fixedCount === 0 && ambiguousCount === 0 && unresolvedCount === 0) {
  console.log("\n  ✅  All genres are already canonical.\n");
  process.exit(0);
}

if (!args.apply && fixedCount > 0) {
  console.log(`\n  ℹ️   Dry run — run with --apply to write changes.\n`);
}

if (args.apply && fixedCount > 0) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`\n  ✅  Written: ${filePath}\n`);
}

if (unresolvedCount > 0 || ambiguousCount > 0) {
  process.exit(1);
}
