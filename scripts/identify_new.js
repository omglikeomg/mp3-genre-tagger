// MP3 Classifier — Identify New / Modified Tracks
// Diffs the current Music folder against library_snapshot.json and produces
// batch files (new_music_batch_N.json) containing full track metadata — the
// same shape as the initial library_batch_N.json files — ready for the AI
// agent to classify.
//
// Detected changes:
//   • New file      — filepath not present in the snapshot
//   • Modified file — filepath present but mtime or size differs
//
// After writing batches the snapshot is updated:
//   • New / modified entries → status: "pending"
//   • Previously processed entries are left untouched
//
// Usage: node scripts/identify_new.js
//        yarn scan:new

import fs from "fs";
import path from "path";
import * as mm from "music-metadata";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const MUSIC_DIR = "./Music";
const SNAPSHOT_FILE = "./library_snapshot.json";
const OUTPUT_DIR = "./batches";
const BATCH_SIZE = 10;
const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".m4a", ".wav"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all audio files under dirPath.
 * Returns an array of { filePath: string, isCompilation: boolean }.
 */
function collectAudioFiles(dirPath, isCompilation = false) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.warn(`⚠️  Cannot read directory ${dirPath}: ${err.message}`);
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (
      entry.isFile() &&
      AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      results.push({ filePath: fullPath, isCompilation });
    } else if (entry.isDirectory()) {
      results.push(...collectAudioFiles(fullPath, isCompilation));
    }
  }
  return results;
}

/**
 * Walk the top-level Music directory and return all audio files, correctly
 * flagging anything inside the Compilations subfolder.
 */
function collectAllFiles(musicDir) {
  const allFiles = [];

  let topEntries;
  try {
    topEntries = fs.readdirSync(musicDir, { withFileTypes: true });
  } catch (err) {
    console.error(`❌ Cannot read Music directory: ${err.message}`);
    process.exit(1);
  }

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(musicDir, entry.name);

    if (entry.name === "Compilations") {
      // Each subfolder inside Compilations is a separate compilation album
      let compEntries;
      try {
        compEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      } catch (err) {
        console.warn(`⚠️  Cannot read Compilations folder: ${err.message}`);
        continue;
      }
      for (const compEntry of compEntries) {
        if (compEntry.isDirectory()) {
          allFiles.push(
            ...collectAudioFiles(path.join(fullPath, compEntry.name), true),
          );
        }
      }
    } else {
      // Regular artist folder
      allFiles.push(...collectAudioFiles(fullPath, false));
    }
  }

  return allFiles;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  // 1. Load existing snapshot (or start fresh)
  let snapshot = {};
  if (fs.existsSync(SNAPSHOT_FILE)) {
    try {
      snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    } catch (err) {
      console.warn(
        `⚠️  Could not parse ${SNAPSHOT_FILE}, starting with empty snapshot.`,
      );
    }
  } else {
    console.log(
      `ℹ️  No snapshot found at ${SNAPSHOT_FILE}. All files will be treated as new.\n` +
        `   Run "yarn snapshot" after your initial backfill to create a baseline.`,
    );
  }

  // 2. Scan current library
  console.log(`🔍 Scanning ${MUSIC_DIR} for changes…`);
  const allFiles = collectAllFiles(MUSIC_DIR);

  // 3. Diff against snapshot
  const toProcess = [];

  for (const { filePath, isCompilation } of allFiles) {
    const relativePath = path.relative(".", filePath);
    const stats = fs.statSync(filePath);
    const mtime = Math.floor(stats.mtimeMs / 1000);
    const { size } = stats;

    if (!(relativePath in snapshot)) {
      toProcess.push({
        filePath,
        relativePath,
        isCompilation,
        mtime,
        size,
        reason: "new",
      });
    } else {
      const snap = snapshot[relativePath];
      if (snap.mtime !== mtime || snap.size !== size) {
        toProcess.push({
          filePath,
          relativePath,
          isCompilation,
          mtime,
          size,
          reason: "modified",
        });
      }
    }
  }

  if (toProcess.length === 0) {
    console.log("✅ No new or modified files found. Library is up to date.");
    process.exit(0);
  }

  const newCount = toProcess.filter((f) => f.reason === "new").length;
  const modifiedCount = toProcess.filter((f) => f.reason === "modified").length;
  console.log(
    `✨ Found ${newCount} new file(s) and ${modifiedCount} modified file(s).`,
  );

  // 4. Extract full track metadata (same shape as prepare-input.js batches)
  console.log("📖 Reading metadata…");
  const batchEntries = [];

  for (const { filePath, relativePath, isCompilation, reason } of toProcess) {
    try {
      const metadata = await mm.parseFile(filePath);
      const common = metadata.common;
      const duration = metadata.format.duration;
      const artistName =
        common.albumartist || common.artist || "Unknown Artist";

      batchEntries.push({
        filepath: relativePath,
        title: common.title || path.basename(filePath),
        artist: common.artist || "Unknown Artist",
        album_artist: artistName,
        album: common.album || "Unknown Album",
        track_number: common.track?.no || 0,
        is_compilation: isCompilation,
        duration: duration ? Math.floor(duration / 60) : 0,
        is_session: duration > 900,
        // Informational — lets the agent know this is an incremental update.
        // "modified" entries may already have a classification; the agent
        // should re-evaluate them regardless.
        _change: reason,
      });
    } catch (err) {
      console.error(`⚠️  Skipping ${relativePath}: ${err.message}`);
    }
  }

  // 5. Write batch files
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const batches = [];
  for (let i = 0; i < batchEntries.length; i += BATCH_SIZE) {
    batches.push(batchEntries.slice(i, i + BATCH_SIZE));
  }

  console.log(`\n📂 Writing ${batches.length} batch file(s) to ${OUTPUT_DIR}/`);
  batches.forEach((batch, index) => {
    const filename = `new_music_batch_${index + 1}.json`;
    fs.writeFileSync(
      path.join(OUTPUT_DIR, filename),
      JSON.stringify(batch, null, 2),
    );
    const newInBatch = batch.filter((e) => e._change === "new").length;
    const modInBatch = batch.filter((e) => e._change === "modified").length;
    console.log(`  📄 ${filename} — ${newInBatch} new, ${modInBatch} modified`);
  });

  // 6. Update snapshot: mark new / modified files as "pending"
  for (const { relativePath, mtime, size } of toProcess) {
    snapshot[relativePath] = { mtime, size, status: "pending" };
  }
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));

  console.log(
    `\n💾 Snapshot updated — ${toProcess.length} entry(ies) marked as "pending".`,
  );
  console.log(
    `\nNext steps:\n` +
      `  1. Feed the new batch file(s) to the AI agent (same workflow as Step 2).\n` +
      `  2. Run "yarn backfill" to apply the new tags.\n` +
      `  3. Run "yarn snapshot" to re-baseline the snapshot once backfill is done.`,
  );
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
