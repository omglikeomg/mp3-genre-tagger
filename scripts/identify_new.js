const fs = require("fs");
const path = require("path");
const glob = require("glob");

const SNAPSHOT_FILE = "./library_snapshot.json";
const MUSIC_DIR = "./Music"; // Adjust to your path

// 1. Load the old snapshot
let oldSnapshot = [];
if (fs.existsSync(SNAPSHOT_FILE)) {
  oldSnapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
}

// 2. Scan current library
console.log("🔍 Scanning library for changes...");
const currentFiles = glob.sync(`${MUSIC_DIR}/**/*.{mp3,flac,m4a}`);

// 3. Identify New Files (Files in current but not in old)
const newFiles = currentFiles.filter((file) => !oldSnapshot.includes(file));

if (newFiles.length === 0) {
  console.log("✅ No new music found.");
  process.exit(0);
}

console.log(`✨ Found ${newFiles.length} new files!`);

// 4. Chunk these new files into batches of 10
const batches = [];
for (let i = 0; i < newFiles.length; i += 10) {
  batches.push(newFiles.slice(i, i + 10));
}

// 5. Save the new batches for Aider to process
batches.forEach((batch, index) => {
  fs.writeFileSync(
    `./batches/new_music_batch_${index + 1}.json`,
    JSON.stringify(batch, null, 2),
  );
});

// 6. Update the snapshot for next time
fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentFiles, null, 2));

console.log(`📂 Created ${batches.length} new batch files in ./batches/`);
