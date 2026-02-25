// MP3 Classifier — Generate Library Snapshot
// Creates a baseline snapshot of every audio file currently in the Music folder.
// Run this once after your initial classification + backfill is complete, so that
// future runs of identify_new.js have a clean baseline to diff against.
//
// Usage: node scripts/generate-snapshot.js
//        yarn snapshot

import fs from "fs";
import path from "path";

const MUSIC_DIR = "./Music";
const SNAPSHOT_FILE = "./library_snapshot.json";
const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".m4a", ".wav"]);

// ---------------------------------------------------------------------------
// Recursive directory walker — returns an array of absolute file paths for
// every audio file found under dirPath, up to maxDepth subdirectory levels.
// ---------------------------------------------------------------------------
function walkDir(dirPath, depth = 0, maxDepth = 3) {
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
      results.push(fullPath);
    } else if (entry.isDirectory() && depth < maxDepth) {
      results.push(...walkDir(fullPath, depth + 1, maxDepth));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (!fs.existsSync(MUSIC_DIR)) {
  console.error(`❌ Music directory not found: ${MUSIC_DIR}`);
  process.exit(1);
}

console.log(`🔍 Scanning ${MUSIC_DIR} for audio files…`);
const files = walkDir(MUSIC_DIR);

const snapshot = {};
for (const file of files) {
  // Normalise to a project-relative path without a leading "./"
  // e.g.  Music/Aphex Twin/Selected Ambient Works/01 Xtal.mp3
  const relativePath = path.relative(".", file);
  const stats = fs.statSync(file);
  snapshot[relativePath] = {
    mtime: Math.floor(stats.mtimeMs / 1000), // unix seconds, avoids float noise
    size: stats.size,
    status: "processed",
  };
}

fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
console.log(
  `✅ Snapshot written to ${SNAPSHOT_FILE} — ${Object.keys(snapshot).length} files marked as "processed".`,
);
