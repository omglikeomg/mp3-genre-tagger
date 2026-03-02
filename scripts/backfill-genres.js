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

    const absPath = path.resolve(MUSIC_ROOT, op.filepath);
    const success = nodeID3.update(tags, absPath);

    if (success) {
      console.log(`✅ Tagged: ${op.filepath} -> [${genreString}]`);
      successCount++;
    } else {
      console.error(`❌ Failed: ${op.filepath}`);
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
