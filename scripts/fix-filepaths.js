#!/usr/bin/env node
// fix-filepaths.js — Repair mangled filepaths in pending_operations.json by
//                    matching them against actual files on disk.
//
// The AI agent occasionally writes back filepaths that differ from the real
// filenames in subtle ways:
//
//   1. NFD vs NFC Unicode normalisation (macOS writes NFD; Windows NTFS uses NFC)
//   2. Typographic lookalikes — curly apostrophe (U+2019) vs straight (U+0027),
//      typographic hyphen (U+2010) vs hyphen-minus (U+002D), fullwidth parens, etc.
//   3. Deleted punctuation — apostrophes stripped entirely ("Don't" → "Dont")
//   4. Missing track numbers — "Album - Artist - Title" vs "Album - 01 - Artist - Title"
//   5. Folder name mismatches — agent adds "feat.", comma-artists, parentheticals,
//      or trailing punctuation that differs from the actual folder on disk
//   6. Combined cases of the above
//
// Resolution strategy — applied to EVERY path segment independently:
//
//   Step 1 — NFC normalise the full stored path and check if it exists as-is.
//   Step 2 — Walk each path segment. For any segment whose resolved directory
//             does not exist, fuzzy-match it against the real entries on disk
//             using the same four-tier strategy used for filenames:
//               (a) Lookalike character substitution
//               (b) Punctuation-stripped fuzzy key (exact)
//               (c) Digit-stripped fuzzy key (handles omitted track numbers)
//             Reassemble the corrected path and continue to the next segment.
//   Step 3 — Once all directory segments are resolved, apply the same four-tier
//             strategy to the final filename.
//   Step 4 — Unresolvable: report for manual attention.
//
// Usage:
//   node scripts/fix-filepaths.js              # dry-run (no files modified)
//   node scripts/fix-filepaths.js --apply      # write fixed paths to pending_operations.json
//   node scripts/fix-filepaths.js --file path/to/other.json --apply

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MUSIC_DIR } from "./config.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MUSIC_ROOT = path.resolve(PROJECT_ROOT, MUSIC_DIR);

// The leading folder name stored in every filepath (e.g. "Music" in
// "Music/Artist/track.mp3"). Derived from MUSIC_ROOT so it respects
// whatever the user configured in config.json rather than being hardcoded.
const MUSIC_FOLDER_NAME = path.basename(MUSIC_ROOT);

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
fix-filepaths.js — Repair mangled filepaths in pending_operations.json

Compares every filepath in the JSON against real files on disk and fixes paths
that differ due to Unicode normalisation, typographic lookalike characters,
deleted apostrophes, missing track numbers, or folder name mismatches caused
by the AI agent appending "feat.", comma-separated artists, etc.

Usage:
  node scripts/fix-filepaths.js [--file <path>] [--apply]

Options:
  --file <path>   JSON file to fix (default: pending_operations.json)
  --apply         Write fixes to disk (default: dry-run, nothing written)
  --help, -h      Show this help

Examples:
  node scripts/fix-filepaths.js
  node scripts/fix-filepaths.js --apply
  node scripts/fix-filepaths.js --file pending_operations_remapped.json --apply
`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

// ── Lookalike character map ───────────────────────────────────────────────────
//
// Each entry: [needle, ...replacements]
// The needle is what the agent commonly writes; replacements are what the real
// filename/folder may actually contain on disk. All replacements are tried.

const LOOKALIKE_MAP = [
  // Straight apostrophe → curly variants
  ["\u0027", "\u2019", "\u2018"], // ' → ' '
  // ASCII hyphen-minus → typographic hyphens
  ["\u002D", "\u2010", "\u2011"], // - → ‐ ‑
  // Straight double quote → curly variants
  ["\u0022", "\u201C", "\u201D"], // " → " "
  // ASCII tilde / fullwidth tilde → wave dash (common in Japanese filenames)
  ["\u007E", "\u301C", "\uFF5E"], // ~ → 〜 ～
  // ASCII parentheses → fullwidth parentheses
  ["\u0028", "\uFF08"], // ( → （
  ["\u0029", "\uFF09"], // ) → ）
];

// ── Fuzzy key helpers ─────────────────────────────────────────────────────────

/**
 * Produces a normalisation-insensitive key from a name string (NOT a full
 * path — call path.basename() first if needed).
 *
 * - Strips a trailing .mp3 extension
 * - NFC-normalises
 * - Lowercases
 * - Removes everything that is not:
 *     a-z 0-9
 *     accented/extended Latin    U+00C0–U+024F
 *     Greek                      U+0370–U+03FF
 *     Cyrillic                   U+0400–U+04FF
 *     Hebrew                     U+0590–U+05FF
 *     Arabic                     U+0600–U+06FF
 *     Hiragana                   U+3040–U+309F
 *     Katakana                   U+30A0–U+30FF
 *     CJK Unified Ideographs     U+4E00–U+9FFF
 *     Hangul                     U+AC00–U+D7AF
 *
 * Punctuation, spaces, symbols (including curly quotes, typographic dashes,
 * fullwidth chars, etc.) are stripped.
 */
function fuzzyKey(name) {
  const base = name.endsWith(".mp3") ? name.slice(0, -4) : name;
  return base
    .normalize("NFC")
    .toLowerCase()
    .replace(
      /[^a-z0-9\u00C0-\u024F\u0370-\u04FF\u0590-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g,
      "",
    );
}

/**
 * Like fuzzyKey but also strips all ASCII digits.
 * Handles omitted track numbers embedded mid-key
 * (e.g. "bestfusionfunk01snarkypuppy" → "bestfusionfunksnarkypuppy").
 */
function digitlessKey(name) {
  return fuzzyKey(name).replace(/[0-9]/g, "");
}

/**
 * Like fuzzyKey but additionally strips all combining diacritical marks
 * (accents, tildes, cedillas, etc.) after NFD decomposition.
 *
 * This allows matching filenames where the agent stripped an accent entirely
 * ("Desdenosa" matching "Desdeñosa", "Es pregunta" matching "És pregunta",
 * "Rai'n'b" matching "Raï'n'b").
 *
 * Non-Latin scripts (CJK, Cyrillic, etc.) are unaffected because their
 * characters do not decompose into base + combining mark pairs.
 */
function accentlessKey(name) {
  const base = name.endsWith(".mp3") ? name.slice(0, -4) : name;
  return base
    .normalize("NFD") // decompose accented chars into base + combining marks
    .replace(/[\u0300-\u036F]/g, "") // strip combining diacritical marks
    .normalize("NFC")
    .toLowerCase()
    .replace(
      /[^a-z0-9\u0370-\u04FF\u0590-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g,
      "",
    );
}

// ── Directory listing cache ───────────────────────────────────────────────────
//
// Cache readdir results — many tracks share the same folder.

const dirCache = new Map();

function listDir(dirPath) {
  if (dirCache.has(dirPath)) return dirCache.get(dirPath);
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    // directory doesn't exist — caller handles empty array gracefully
  }
  dirCache.set(dirPath, entries);
  return entries;
}

// ── Segment matcher ───────────────────────────────────────────────────────────

/**
 * Given a stored segment name (folder or filename) and the list of real
 * entries in the parent directory, return the best-matching real entry name,
 * or null if no match can be found.
 *
 * Matching tiers (in order):
 *   1. Exact match after NFC normalisation
 *   2. Lookalike character substitution
 *   3a. Punctuation-stripped fuzzy key — exact match
 *   3b. Punctuation-stripped fuzzy key — disk key is a prefix of stored key
 *       (handles folder names where the agent appended "feat.", ", Daya", etc.)
 *   4a. Digit-stripped fuzzy key — exact match (handles omitted track numbers)
 *   4b. Digit-stripped fuzzy key — prefix match
 *   5.  Accent-stripped fuzzy key — exact match (handles stripped diacritics)
 *   5b. Accent-stripped fuzzy key — prefix match
 */
function matchSegment(storedName, candidates, isFile = false) {
  const nfc = storedName.normalize("NFC");

  // Tier 1 — exact NFC match
  const exact = candidates.find((c) => c.normalize("NFC") === nfc);
  if (exact) return exact;

  // Tier 2 — lookalike substitution (try replacing needles with each replacement)
  for (const [needle, ...replacements] of LOOKALIKE_MAP) {
    if (!nfc.includes(needle)) continue;
    for (const replacement of replacements) {
      const substituted = nfc.replaceAll(needle, replacement);
      const match = candidates.find((c) => c.normalize("NFC") === substituted);
      if (match) return match;
    }
  }

  // Tier 3a — punctuation-stripped fuzzy key, exact
  const needle3 = fuzzyKey(nfc);
  if (needle3.length >= 1) {
    const matches3 = candidates.filter((c) => fuzzyKey(c) === needle3);
    if (matches3.length === 1) return matches3[0];
  }

  // Tier 3b — disk key is a prefix of (or equal to) stored key.
  // Handles folder segments where the agent appended extra text that doesn't
  // exist on disk: "The Cactus Channel feat. Chet Faker" → "The Cactus Channel",
  // "The Chainsmokers, Daya" → "The Chainsmokers", "The Marias & Triathalon" → "The Marias".
  // Only accepted when exactly one candidate qualifies, to avoid false positives.
  if (!isFile && needle3.length >= 8) {
    const prefixMatches3 = candidates.filter((c) => {
      const dk = fuzzyKey(c);
      return dk.length >= 4 && needle3.startsWith(dk);
    });
    if (prefixMatches3.length === 1) return prefixMatches3[0];
  }

  // Tier 4a — digit-stripped fuzzy key, exact (omitted track numbers mid-key)
  const needle4 = digitlessKey(nfc);
  if (needle4.length >= 8) {
    const matches4 = candidates.filter((c) => digitlessKey(c) === needle4);
    if (matches4.length === 1) return matches4[0];
  }

  // Tier 4b — digit-stripped prefix match for folder segments
  if (!isFile && needle4.length >= 8) {
    const prefixMatches4 = candidates.filter((c) => {
      const dk = digitlessKey(c);
      return dk.length >= 4 && needle4.startsWith(dk);
    });
    if (prefixMatches4.length === 1) return prefixMatches4[0];
  }

  // Tier 5a — accent-stripped fuzzy key, exact.
  // Handles cases where the agent stripped diacritics entirely:
  // "Es pregunta" → "És pregunta", "Desdenosa" → "Desdeñosa", "Rai'n'b" → "Raï'n'b".
  const needle5 = accentlessKey(nfc);
  if (needle5.length >= 1) {
    const matches5 = candidates.filter((c) => accentlessKey(c) === needle5);
    if (matches5.length === 1) return matches5[0];
  }

  // Tier 5b — accent-stripped prefix match for folder segments
  if (!isFile && needle5.length >= 8) {
    const prefixMatches5 = candidates.filter((c) => {
      const dk = accentlessKey(c);
      return dk.length >= 4 && needle5.startsWith(dk);
    });
    if (prefixMatches5.length === 1) return prefixMatches5[0];
  }

  return null;
}

// ── Core resolver ─────────────────────────────────────────────────────────────

/**
 * Given a filepath as stored in the JSON, return:
 *
 *   { resolved: true,  absPath, fixedRelative, method }
 *   { resolved: false, absPath: null, fixedRelative: null, method, candidates? }
 *
 * `fixedRelative` is relative to MUSIC_ROOT (forward slashes), ready to be
 * stored back in the JSON as `MUSIC_FOLDER_NAME + "/" + fixedRelative`.
 *
 * `method`:
 *   "exact"           — stored path resolves without any changes (after NFC)
 *   "segment_fixed"   — one or more path segments were corrected
 *   "not_found"       — no strategy worked
 */
function resolveFilePath(storedFilepath) {
  // Normalise path separators and apply NFC to the whole thing first.
  const nfc = storedFilepath.replace(/\\/g, "/").normalize("NFC");

  // Strip the leading music folder name (e.g. "Music/") so we work with a
  // path relative to MUSIC_ROOT only, avoiding double-folder joins.
  const prefix = MUSIC_FOLDER_NAME + "/";
  const relative = nfc.startsWith(prefix) ? nfc.slice(prefix.length) : nfc;

  // ── Fast path: file already exists exactly ────────────────────────────────
  const baseAbs = path.resolve(MUSIC_ROOT, relative);
  if (fs.existsSync(baseAbs)) {
    return {
      resolved: true,
      absPath: baseAbs,
      fixedRelative: relative,
      method: "exact",
    };
  }

  // ── Segment-by-segment resolution ────────────────────────────────────────
  //
  // Walk every segment of the relative path. For each segment, check if the
  // current accumulated directory + that segment exists. If not, fuzzy-match
  // the segment against the real entries at the current level.
  //
  // This handles both folder-level mismatches (agent wrote "The Marias &
  // Triathalon" but disk has "The Marias") AND filename-level mismatches.

  const segments = relative.split("/");
  let currentAbsDir = MUSIC_ROOT;
  const resolvedSegments = [];
  let anySegmentChanged = false;

  for (let i = 0; i < segments.length; i++) {
    const stored = segments[i];
    const isLast = i === segments.length - 1;
    const isFile = isLast; // last segment is the .mp3 filename

    // Check if the stored segment exists verbatim at this level
    const directPath = path.join(currentAbsDir, stored.normalize("NFC"));
    if (fs.existsSync(directPath)) {
      resolvedSegments.push(stored.normalize("NFC"));
      currentAbsDir = directPath;
      continue;
    }

    // It doesn't exist verbatim — try to match it against real entries
    const candidates = listDir(currentAbsDir).filter((entry) => {
      if (isFile) return entry.toLowerCase().endsWith(".mp3");
      // For directory segments, only consider actual directories
      try {
        return fs.statSync(path.join(currentAbsDir, entry)).isDirectory();
      } catch {
        return false;
      }
    });

    if (candidates.length === 0) {
      // No candidates to match against — unresolvable from here
      return {
        resolved: false,
        absPath: null,
        fixedRelative: null,
        method: "not_found",
      };
    }

    const matched = matchSegment(stored, candidates, isFile);
    if (!matched) {
      return {
        resolved: false,
        absPath: null,
        fixedRelative: null,
        method: "not_found",
      };
    }

    resolvedSegments.push(matched);
    currentAbsDir = path.join(currentAbsDir, matched);
    if (matched !== stored.normalize("NFC")) {
      anySegmentChanged = true;
    }
  }

  const fixedRelative = resolvedSegments.join("/");
  const absPath = path.resolve(MUSIC_ROOT, fixedRelative);

  // Sanity check — the reconstructed path must exist
  if (!fs.existsSync(absPath)) {
    return {
      resolved: false,
      absPath: null,
      fixedRelative: null,
      method: "not_found",
    };
  }

  return {
    resolved: true,
    absPath,
    fixedRelative,
    method: anySegmentChanged ? "segment_fixed" : "exact",
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
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

  if (!Array.isArray(data.operations) || !Array.isArray(data.manual_review)) {
    console.error(
      '❌  JSON must contain "operations" and "manual_review" arrays.',
    );
    process.exit(1);
  }

  console.log(`\n📂  File   : ${filePath}`);
  console.log(`🎵  Music  : ${MUSIC_ROOT}`);
  console.log(`🏁  Mode   : ${args.apply ? "APPLY" : "DRY RUN"}\n`);

  const allEntries = [
    ...data.operations.map((op, i) => ({
      section: "operations",
      index: i,
      entry: op,
    })),
    ...data.manual_review.map((op, i) => ({
      section: "manual_review",
      index: i,
      entry: op,
    })),
  ];

  let alreadyOk = 0;
  let fixedCount = 0;
  let notFoundCount = 0;

  const fixes = []; // { section, index, from, to }
  const unresolved = []; // { section, filepath }

  for (const { section, index, entry } of allEntries) {
    if (!entry.filepath) continue;

    const result = resolveFilePath(entry.filepath);

    if (!result.resolved) {
      notFoundCount++;
      unresolved.push({ section, filepath: entry.filepath });
      continue;
    }

    if (result.method === "exact") {
      alreadyOk++;
      continue;
    }

    // Reconstruct the full stored-style path (e.g. "Music/Artist/track.mp3")
    const fullFixed =
      MUSIC_FOLDER_NAME + "/" + result.fixedRelative.replace(/\\/g, "/");

    // Normalise the original for comparison (in case it only differs by NFC)
    const originalNormalised = entry.filepath
      .replace(/\\/g, "/")
      .normalize("NFC");

    if (fullFixed === originalNormalised) {
      alreadyOk++;
      continue;
    }

    fixedCount++;
    fixes.push({ section, index, from: entry.filepath, to: fullFixed });
  }

  // ── Report ────────────────────────────────────────────────────────────────

  if (fixes.length > 0) {
    console.log(`✏️   Fixable paths (${fixes.length}):\n`);
    for (const fix of fixes) {
      console.log(`  [${fix.section}]`);
      console.log(`    FROM: ${fix.from}`);
      console.log(`      TO: ${fix.to}\n`);
    }
  }

  if (unresolved.length > 0) {
    console.log(`❌  Unresolvable paths (${unresolved.length}):\n`);
    for (const u of unresolved) {
      console.log(`  [${u.section}] ${u.filepath}`);
    }
    console.log();
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("─".repeat(60));
  console.log(`  Already correct : ${alreadyOk}`);
  console.log(`  Fixed           : ${fixedCount}`);
  console.log(`  Not found       : ${notFoundCount}  (manual fix needed)`);

  if (fixedCount === 0 && notFoundCount === 0) {
    console.log("\n  ✅  All filepaths are already correct.\n");
    process.exit(0);
  }

  if (!args.apply && fixedCount > 0) {
    console.log(
      `\n  ℹ️   Dry run — run with --apply to write ${fixedCount} fix(es).\n`,
    );
    process.exit(notFoundCount > 0 ? 1 : 0);
  }

  if (!args.apply) {
    process.exit(notFoundCount > 0 ? 1 : 0);
  }

  // ── Apply ─────────────────────────────────────────────────────────────────

  for (const fix of fixes) {
    if (fix.section === "operations") {
      data.operations[fix.index].filepath = fix.to;
    } else {
      data.manual_review[fix.index].filepath = fix.to;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`\n  ✅  Written: ${filePath} (${fixedCount} path(s) fixed)\n`);

  process.exit(notFoundCount > 0 ? 1 : 0);
}

main();
