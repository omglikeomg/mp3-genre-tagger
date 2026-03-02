// backfill-genres.js
// Reads pending_operations.json and writes genre tags to MP3 files.
//
// Dependencies:
//   yarn add node-id3
//
// Usage:
//   node scripts/backfill-genres.js            # Apply genre tags to MP3 files
//   node scripts/backfill-genres.js --dry-run   # Preview changes without modifying files

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nodeID3 from "node-id3";
import { MUSIC_DIR, VALID_GENRES } from "./config.js";

// --- CONFIGURATION ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OPERATIONS_FILE = path.join(PROJECT_ROOT, "pending_operations.json");
const MUSIC_ROOT = path.resolve(PROJECT_ROOT, MUSIC_DIR);
const DRY_RUN = process.argv.includes("--dry-run");

// VALID_GENRES is loaded from genre-name-list.json via config.js.

// Maps characters that metadata scanners or AI agents commonly write into JSON
// to their typographic lookalikes that may actually appear in filenames on disk.
// Each entry is [needle, ...replacements] — all combinations are tried.
const LOOKALIKE_MAP = [
  // Straight apostrophe / ASCII apostrophe  →  curly variants
  ["\u0027", "\u2019", "\u2018"], // ' → ' '
  // ASCII hyphen-minus  →  typographic hyphens
  ["\u002D", "\u2010", "\u2011"], // - → ‐ ‑
  // Straight double quote  →  curly variants
  ["\u0022", "\u201C", "\u201D"], // " → " "
];

/**
 * Try to resolve a filepath to one that actually exists on disk.
 *
 * Strategy:
 *   1. NFC-normalise (fixes macOS NFD decomposed chars on Windows NTFS).
 *   2. If the file exists, return it immediately.
 *   3. Otherwise, iterate through LOOKALIKE_MAP and try every single-character
 *      substitution until a match is found on disk.
 *   4. Return null if no variant resolves to an existing file.
 */
function resolveFilePath(musicRoot, filepath) {
  // Step 1 — NFC normalisation (handles combining diacritics, Japanese kana, etc.)
  const nfc = filepath.normalize("NFC");
  const base = path.resolve(musicRoot, nfc);
  if (fs.existsSync(base)) return base;

  // Step 2 — try lookalike substitutions one character position at a time
  for (const [needle, ...replacements] of LOOKALIKE_MAP) {
    if (!nfc.includes(needle)) continue;
    for (const replacement of replacements) {
      const candidate = path.resolve(
        musicRoot,
        nfc.replaceAll(needle, replacement),
      );
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // Step 3 — exhausted all options
  return null;
}

function validateGenre(genre) {
  // Strip the "[DJ SET]" suffix before validating
  const cleaned = genre.replace(/\s*\[DJ SET\]\s*$/i, "").trim();
  return VALID_GENRES.some(
    (valid) => valid.toLowerCase() === cleaned.toLowerCase(),
  );
}

function backfillGenres() {
  if (!fs.existsSync(OPERATIONS_FILE)) {
    console.error("No pending operations file found!");
    return;
  }

  if (DRY_RUN) {
    console.log("🏁 DRY RUN MODE — no files will be modified.\n");
  }

  const data = JSON.parse(fs.readFileSync(OPERATIONS_FILE, "utf8"));
  const ops = data.operations.filter((op) => op.status === "apply");

  console.log(`Starting backfill for ${ops.length} tracks...`);

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  ops.forEach((op) => {
    const genreString = op.secondary_genre
      ? `${op.primary_genre}; ${op.secondary_genre}`
      : op.primary_genre;

    // Validate each genre against the taxonomy
    const genresToCheck = [op.primary_genre, op.secondary_genre].filter(
      Boolean,
    );
    const invalidGenres = genresToCheck.filter((g) => !validateGenre(g));

    if (invalidGenres.length > 0) {
      console.warn(
        `⚠️  Skipped (invalid genre): ${op.filepath} -> [${invalidGenres.join(", ")}]`,
      );
      skippedCount++;
      return;
    }

    if (DRY_RUN) {
      console.log(`🔍 Would tag: ${op.filepath} -> [${genreString}]`);
      successCount++;
      return;
    }

    const tags = {
      genre: genreString,
    };

    // Resolve the filepath tolerantly:
    //   • NFC-normalise to fix macOS NFD decomposed chars on Windows NTFS.
    //   • Fall back through a lookalike map for typographic characters that
    //     metadata scanners or the AI agent may have normalised differently
    //     (e.g. curly apostrophes vs straight, U+2010 hyphen vs U+002D).
    const absPath = resolveFilePath(MUSIC_ROOT, op.filepath);

    if (!absPath) {
      console.error(
        `❌ Failed (file not found after lookalike fallback): ${op.filepath}`,
      );
      failCount++;
      return;
    }

    // Read the file into a Buffer via Node's fs so that Unicode file paths
    // (e.g. Japanese characters) are handled correctly on Windows.
    // Passing a path string directly to node-id3 causes it to call the native
    // fs binding internally, which fails on Windows when the path contains
    // non-ASCII characters outside the system ANSI code page.
    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(absPath);
    } catch (err) {
      console.error(
        `❌ Failed (could not read file): ${op.filepath} — ${err.message}`,
      );
      failCount++;
      return;
    }

    const updatedBuffer = nodeID3.update(tags, fileBuffer);

    if (updatedBuffer === false) {
      console.error(`❌ Failed (tag update error): ${op.filepath}`);
      failCount++;
      return;
    }

    try {
      fs.writeFileSync(absPath, updatedBuffer);
      console.log(`✅ Tagged: ${op.filepath} -> [${genreString}]`);
      successCount++;
    } catch (err) {
      console.error(
        `❌ Failed (could not write file): ${op.filepath} — ${err.message}`,
      );
      failCount++;
    }
  });

  console.log(
    `\nBackfill complete. ✅ ${successCount} tagged | ❌ ${failCount} failed | ⚠️  ${skippedCount} skipped (invalid genre).`,
  );
  if (DRY_RUN) {
    console.log(
      "ℹ️  This was a dry run. Run without --dry-run to apply changes.",
    );
  }
  if (data.manual_review.length > 0) {
    console.log(
      `Note: ${data.manual_review.length} tracks require manual review in the JSON file.`,
    );
  }
}

backfillGenres();
