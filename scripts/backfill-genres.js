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
 * Produce a "fuzzy key" from a filename for last-resort matching.
 *
 * Strips the .mp3 extension, removes all non-alphanumeric characters
 * (apostrophes, hyphens, punctuation, spaces, track-number tokens, etc.),
 * and lowercases the result. This lets us match filenames where the agent
 * deleted apostrophes ("Don't" → "Dont"), omitted track numbers
 * ("- 01 -" absent), or used different punctuation.
 */
function fuzzyKey(filename) {
  return path
    .basename(filename, ".mp3")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u3000-\u9FFF]/g, ""); // strip punctuation/spaces, keep accented + CJK
}

/**
 * Like fuzzyKey but also strips all digit characters.
 * Used for a second-pass match where track numbers embedded mid-key
 * (e.g. "bestfusionfunk01snarkypuppy") would otherwise prevent a substring
 * hit against a JSON key that has no track number ("bestfusionfunksnarkypuppy").
 */
function digitlessKey(filename) {
  return fuzzyKey(filename).replace(/[0-9]/g, "");
}

/**
 * Try to resolve a filepath to one that actually exists on disk.
 *
 * Strategy:
 *   1. NFC-normalise (fixes macOS NFD decomposed chars on Windows NTFS).
 *   2. If the file exists, return it immediately.
 *   3. Otherwise, iterate through LOOKALIKE_MAP and try every single-character
 *      substitution until a match is found on disk.
 *   4. Last resort: read the target directory and fuzzy-match by stripped filename.
 *      Handles cases where the agent deleted apostrophes ("Im Confessin" vs
 *      "I'm Confessin'") or omitted track numbers ("Artist - Title" vs
 *      "Album - 01 - Artist - Title").
 *   5. Return null if no variant resolves to an existing file.
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

  // Step 3 — fuzzy match inside the target directory
  const targetDir = path.resolve(musicRoot, path.dirname(nfc));
  if (fs.existsSync(targetDir)) {
    const needle = fuzzyKey(nfc);
    const entries = fs
      .readdirSync(targetDir)
      .filter((f) => f.toLowerCase().endsWith(".mp3"));

    // Step 3a — exact fuzzy key match (handles deleted apostrophes, track numbers)
    const exactMatches = entries.filter((f) => fuzzyKey(f) === needle);
    if (exactMatches.length === 1) {
      return path.join(targetDir, exactMatches[0]);
    }
    if (exactMatches.length > 1) {
      console.warn(
        `⚠️  Fuzzy match ambiguous for: ${filepath} — candidates: ${exactMatches.join(", ")}`,
      );
      return null;
    }

    // Step 3b — digit-stripped key match: strip all digits from both keys before
    // comparing. This handles omitted track numbers that are embedded mid-key
    // (e.g. JSON "bestfusionfunksnarkypuppyshofukan" matches disk key
    // "bestfusionfunk01snarkypuppyshofukan" once the "01" is removed from both).
    // The needle must be at least 8 chars long after digit-stripping to avoid
    // false positives on very short titles.
    const digitlessNeedle = digitlessKey(nfc);
    if (digitlessNeedle.length >= 8) {
      const digitlessMatches = entries.filter(
        (f) => digitlessKey(f) === digitlessNeedle,
      );
      if (digitlessMatches.length === 1) {
        return path.join(targetDir, digitlessMatches[0]);
      }
      if (digitlessMatches.length > 1) {
        console.warn(
          `⚠️  Digit-stripped fuzzy match ambiguous for: ${filepath} — candidates: ${digitlessMatches.join(", ")}`,
        );
      }
    }
  }

  // Step 4 — exhausted all options
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
