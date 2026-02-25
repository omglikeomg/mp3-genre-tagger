// MP3 Classifier — Prepare Input Script
// Dependencies: yarn add music-metadata
import fs from "fs";
import path from "path";
import * as mm from "music-metadata";
import { MUSIC_DIR } from "./config.js";

// --- CONFIGURATION ---
// MUSIC_DIR is read from config.json → "musicDir" (defaults to "./Music").
// Copy config.example.json to config.json and set "musicDir" to customise.
const BATCH_SIZE = 10;
const OUTPUT_DIR = "./batches";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// Collect MP3 files from a directory, with optional 1-level recursion
function collectMp3Files(dirPath) {
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullEntryPath = path.join(dirPath, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp3")) {
      results.push(fullEntryPath);
    } else if (entry.isDirectory()) {
      // 1-level recursion: scan immediate subdirectories for MP3s
      const subEntries = fs.readdirSync(fullEntryPath, { withFileTypes: true });
      for (const subEntry of subEntries) {
        if (subEntry.isFile() && subEntry.name.toLowerCase().endsWith(".mp3")) {
          results.push(path.join(fullEntryPath, subEntry.name));
        }
      }
    }
  }
  return results;
}

async function run() {
  const entries = fs.readdirSync(MUSIC_DIR, { withFileTypes: true });

  // 1. Identify Folders
  const artistFolders = entries
    .filter((e) => e.isDirectory() && e.name !== "Compilations")
    .map((e) => ({
      name: e.name,
      path: path.join(MUSIC_DIR, e.name),
      isComp: false,
    }));

  const compilationFolders = [];
  const compBase = path.join(MUSIC_DIR, "Compilations");
  if (fs.existsSync(compBase)) {
    const subDirs = fs
      .readdirSync(compBase, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        path: path.join(compBase, e.name),
        isComp: true,
      }));
    compilationFolders.push(...subDirs);
  }

  const allFolders = [...artistFolders, ...compilationFolders];
  const artistMap = {}; // We'll populate this with unique artists

  console.log(`Found ${allFolders.length} total folders to process.`);

  // 2. Process in Batches
  for (let i = 0; i < allFolders.length; i += BATCH_SIZE) {
    const batchFolders = allFolders.slice(i, i + BATCH_SIZE);
    const batchData = [];
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    console.log(`Processing Batch ${batchNum}...`);

    for (const folder of batchFolders) {
      const mp3Files = collectMp3Files(folder.path);

      for (const filePath of mp3Files) {
        // Build a relative path from the project root (relative to cwd)
        const relativePath = path.relative(".", filePath);
        try {
          const metadata = await mm.parseFile(filePath);
          const common = metadata.common;
          const duration = metadata.format.duration; // This is in seconds
          const artistName =
            common.albumartist || common.artist || "Unknown Artist";

          // Populate Artist Map (Shortcut)
          if (!artistMap[artistName]) {
            artistMap[artistName] = { primary_genre: "", secondary_genre: "" };
          }

          batchData.push({
            filepath: relativePath,
            title: common.title || path.basename(filePath),
            artist: common.artist || "Unknown Artist",
            album_artist: artistName,
            album: common.album || "Unknown Album",
            track_number: common.track.no || 0,
            is_compilation: folder.isComp,
            duration: duration ? Math.floor(duration / 60) : 0, // Duration in minutes
            is_session: duration > 900, // Flag as potential DJ set/session if > 15 mins
          });
        } catch (err) {
          console.error(`Skipping ${relativePath}: ${err.message}`);
        }
      }
    }

    // Write Batch JSON
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `library_batch_${batchNum}.json`),
      JSON.stringify(batchData, null, 2),
    );
  }

  // 3. Write Final Artist Map (blank — the AI agent will populate genres during classification)
  fs.writeFileSync("artist_map.json", JSON.stringify(artistMap, null, 2));
  console.log(
    `\nDone! Created ${Math.ceil(allFolders.length / BATCH_SIZE)} batch files in '${OUTPUT_DIR}' and a master 'artist_map.json'.`,
  );
}

run().catch(console.error);
