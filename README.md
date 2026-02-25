# MP3 Genre Classifier — Workflow Guide

## Links

- [System Prompt](./prompt.md)
- [Config Module](./scripts/config.js)
- [Prepare Input Script](./scripts/prepare-input.js)
- [Backfill Script](./scripts/backfill-genres.js)
- [Generate Snapshot Script](./scripts/generate-snapshot.js)
- [Identify New Tracks Script](./scripts/identify_new.js)
- [Genre Name List](./genre-name-list.json)

## Overview

This project uses an AI agent to classify and tag your MP3 music library with genres from a curated taxonomy.
The process is split into three phases: *Prepare*, *Classify*, and *Apply*.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   1. PREPARE    │────▶│   2. CLASSIFY   │────▶│    3. APPLY     │
│  (You + Script) │     │   (AI Agent)    │     │  (You + Script) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
  prepare-input.js        prompt.md +             backfill-genres.js
  ➜ batches/*.json        batches/*.json          ➜ ID3 tags
  ➜ artist_map.json       ➜ pending_operations    written to .mp3
                          ➜ artist_map updated
```

After the initial run, use the incremental workflow for future library updates:

```
┌──────────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌──────────────────────┐
│   0. BASELINE        │────▶│   1. DIFF       │────▶│   2. CLASSIFY   │────▶│   3. APPLY & RESYNC  │
│  generate-snapshot   │     │  identify_new   │     │   (AI Agent)    │     │  backfill-genres.js  │
└──────────────────────┘     └─────────────────┘     └─────────────────┘     └──────────────────────┘
  (run once after initial      ➜ new_music_batch        ➜ pending_operations    ➜ ID3 tags written
   backfill is complete)         _N.json files           appended                yarn snapshot to
  ➜ library_snapshot.json                                                        re-baseline
```

## Prerequisites

1. **Node.js** (v18+) installed.
2. Your music library accessible from the project root (default: `./Music`).
3. Install dependencies:

```sh
yarn add music-metadata node-id3
```

### Machine-Specific Music Path

By default all scripts look for your library at `./Music`. If your library lives elsewhere (e.g. an external drive or a different folder name), set it once in `config.json` at the project root:

1. Copy the provided template:

```sh
cp config.example.json config.json
```

2. Open `config.json` and set `musicDir` to your path (absolute or relative):

```json
{
  "musicDir": "/Volumes/ExternalDrive/Music"
}
```

`config.json` is git-ignored, so each machine can have its own path without affecting the repository.
All three scanning scripts (`prepare-input.js`, `identify_new.js`, `generate-snapshot.js`) read this value automatically via `scripts/config.js`. If no `config.json` is present, they fall back to `./Music`.

## Incremental Update Workflow

Once your initial library is fully classified and tagged, use this shorter loop whenever you add new music:

### Step 0 (one-time): Create a Baseline Snapshot

After completing your first full backfill, run:

```sh
node scripts/generate-snapshot.js
# or: yarn snapshot
```

This records the `mtime`, `size`, and `status: "processed"` for every file currently in `Music/`.
You only need to do this once. From this point forward, `identify_new.js` has a baseline to diff against.

### Step A: Identify New / Modified Tracks

After adding new music to your music folder, run:

```sh
node scripts/identify_new.js
# or: yarn scan:new
```

This will:
- Diff the current library against `library_snapshot.json`.
- Detect **new** files (not in snapshot) and **modified** files (changed `mtime` or `size`).
- Extract full track metadata (same format as the initial batches) using `music-metadata`.
- Write one or more `batches/new_music_batch_N.json` files.
- Update `library_snapshot.json`, marking the new/modified entries as `"pending"`.

### Step B: Feed New Batches to the AI Agent

Same as the main Step 2. Provide the agent with:
1. The system prompt from `prompt.md`.
2. Each `new_music_batch_N.json` file.

The agent will:
- Check `artist_map.json` — if the artist is already mapped, it inherits existing genres automatically.
- If the artist is new, it creates a new entry in `artist_map.json`.
- For multi-artist compilations (`album_artist: "Various Artists"`), it classifies at the track level.
- Append results to `pending_operations.json` as usual.

### Step C: Review, Apply, and Re-baseline

Follow the same Steps 3–6 from the main workflow (review stats, dry run, backfill, resolve manual review).

Once backfill is done, re-baseline the snapshot so the newly tagged files are marked `"processed"`:

```sh
node scripts/generate-snapshot.js
# or: yarn snapshot
```

## Directory Structure

```
project-root/
├── Music/                        # Your MP3 library
│   ├── Artist Name/              # One folder per artist (MP3s inside)
│   └── Compilations/             # Compilation albums (one subfolder each)
│       ├── Now That's What.../
│       └── Greatest Hits.../
├── scripts/
│   ├── config.js                 # Shared: reads config.json, exports MUSIC_DIR
│   ├── prepare-input.js          # Step 1: Extract metadata into batches
│   ├── review-stats.js           # Step 3: Review & inspect classification results
│   ├── backfill-genres.js        # Step 5: Write genre tags to MP3 files
│   ├── resolve-review.js         # Step 6: Move manual_review entries to operations
│   ├── generate-snapshot.js      # Incremental: baseline the library after backfill
│   └── identify_new.js           # Incremental: diff library vs snapshot, create new batches
├── batches/                      # (generated) Batch JSON files for the agent
├── artist_map.json               # (generated) Artist-to-genre mapping
├── pending_operations.json       # (generated by agent) Classification results
├── library_snapshot.json         # (generated) File index for incremental updates
├── config.json                   # (git-ignored) Per-machine settings (e.g. musicDir)
├── config.example.json           # Template for config.json
└── prompt.md                     # System prompt for the AI agent
```

## Step-by-Step Workflow

### Step 1: Prepare Input Data

Run the prepare script from the project root:

```sh
node scripts/prepare-input.js
# or: yarn scan
```

This will:
- Scan your configured music folder (default: `./Music`) for all artist folders and `Compilations` subfolders.
- Read MP3 metadata (title, artist, album, duration, etc.) from each file.
- Output numbered batch files into `./batches/` (e.g., `library_batch_1.json`, `library_batch_2.json`).
- Generate a blank `artist_map.json` listing every unique artist found.

**Verify:** Open a batch file and confirm the entries look correct — relative filepaths, no year field, `is_session` flags on long tracks.

### Step 2: Feed Batches to the AI Agent

Open a session with your AI agent and provide it with:

1. The **system prompt** from [prompt.md](./prompt.md).
2. The **first batch**: `batches/library_batch_1.json`.

The agent will handle the rest automatically. For each batch it will:
- **Read** `artist_map.json` and `pending_operations.json` from disk (creating them if they don't exist).
- Classify all tracks in the batch.
- **Append** new results to `pending_operations.json` (accumulating across batches — no manual merging needed).
- **Update** `artist_map.json` with genres for any newly encountered artists.

#### Per-Batch Loop

For each subsequent batch, instruct the agent:

```
Now classify the next batch: [paste or attach library_batch_N.json]
```

The agent reads the current `artist_map.json` automatically, ensuring consistency with prior batches.
Repeat until all batches are processed.

> **Note:** You do NOT need to copy, paste, or merge any JSON files between batches.
> The agent reads and writes `pending_operations.json` and `artist_map.json` directly.

### Step 3: Review Agent Output

Before applying any tags, review the results using `review-stats.js`.

#### Quick Summary

Total counts of operations vs. manual review entries:

```sh
node scripts/review-stats.js --summary
# or: yarn stats:summary
```

#### Genre Distribution

See how many tracks were assigned to each primary genre, with a bar chart sorted by count:

```sh
node scripts/review-stats.js --genres
# or: yarn stats:genres
```

#### Confidence Distribution

See the spread of confidence scores across all operations:

```sh
node scripts/review-stats.js --confidence
# or: yarn stats:confidence
```

#### List Manual Review Entries

Show all tracks that need your attention, with index, reason, and confidence:

```sh
node scripts/review-stats.js --manual
# or: yarn stats:manual
```

#### Find Tracks by Artist

Search operations for a specific artist (case-insensitive substring match):

```sh
node scripts/review-stats.js --artist "Artist Name"
```

#### List All Unique Genre Pairs

See every primary + secondary combination the agent used:

```sh
node scripts/review-stats.js --pairs
# or: yarn stats:pairs
```

#### Spot-Check: Low Confidence Operations

Show operations that were auto-approved but have borderline confidence (7–8):

```sh
node scripts/review-stats.js --low-confidence
# or: yarn stats:low
```

#### Run All Reports

Run every report sequentially in a single command:

```sh
node scripts/review-stats.js --all
# or: yarn stats
```

### Step 4: Dry Run

Run the backfill script in dry-run mode to preview what will be written:

```sh
node scripts/backfill-genres.js --dry-run
# or: yarn backfill:dry
```

This will:
- Validate every genre string against the allowed taxonomy.
- Print what *would* be tagged, without modifying any files.
- Report any invalid genres the agent may have hallucinated.

**Review the output carefully.** Fix any issues in `pending_operations.json` before proceeding.

### Step 5: Apply Tags

> ⚠️ **Back up your Music folder before this step.** The script writes directly to MP3 ID3 tags.

Once you're satisfied with the dry run, apply the tags for real:

```sh
node scripts/backfill-genres.js
# or: yarn backfill
```

The script will:
- Write the combined genre string (`primary_genre; secondary_genre`) to each MP3's ID3 `genre` tag.
- Skip any tracks with genres not in the taxonomy.
- Print a summary: ✅ tagged | ❌ failed | ⚠️ skipped.

### Step 6: Handle Manual Review

After backfill completes, the script will remind you if there are unresolved `manual_review` entries.

Use `resolve-review.js` to work through them:

#### List all entries awaiting review

```sh
node scripts/resolve-review.js --list
# or: yarn review:list
```

This prints every `manual_review` entry with its index number, filepath, reason, and confidence.

#### Resolve an entry by index

```sh
node scripts/resolve-review.js --resolve 0 --primary "Jazz" --secondary "Blues"
# or: yarn review --resolve 0 --primary "Jazz" --secondary "Blues"
```

#### Resolve an entry by filepath match

```sh
node scripts/resolve-review.js --resolve "Compay Segundo" --primary "Latino [Salsa, Merengue, Son Cubano, Cumbia]"
# or: yarn review --resolve "Compay Segundo" --primary "Latino [Salsa, Merengue, Son Cubano, Cumbia]"
```

The script will:
- Validate the genre(s) against the taxonomy (rejects invalid genres).
- Remove the entry from `manual_review`.
- Add it to `operations` with `"status": "apply"`.
- Write the updated `pending_operations.json` back to disk.

After resolving entries, run `yarn backfill` (or `node scripts/backfill-genres.js`) again to tag the newly resolved tracks.

#### Available genres (for --primary / --secondary)

```sh
node scripts/resolve-review.js --help
# or: yarn review:help
```

This prints the full list of valid genre strings.

## Quick Reference

| Step | Command                                        | Yarn Shortcut             | Output                                       |
|------|------------------------------------------------|---------------------------|----------------------------------------------|
| —    | `cp config.example.json config.json`           | —                         | Per-machine `config.json`                    |
| 1    | `node scripts/prepare-input.js`                | `yarn scan`               | `batches/*.json`, `artist_map.json`          |
| 2    | AI agent session                               | —                         | `pending_operations.json`, `artist_map.json` |
| 3a   | `node scripts/review-stats.js --all`           | `yarn stats`              | Console review                               |
| 3b   | `node scripts/review-stats.js --artist "…"`    | —                         | Console search results                       |
| 4    | `node scripts/backfill-genres.js --dry-run`    | `yarn backfill:dry`       | Console preview                              |
| 5    | `node scripts/backfill-genres.js`              | `yarn backfill`           | ID3 tags written to MP3s                     |
| 6a   | `node scripts/resolve-review.js --list`        | `yarn review:list`        | Console listing                              |
| 6b   | `node scripts/resolve-review.js --resolve …`   | `yarn review --resolve …` | Updated `pending_operations.json`            |
| —    | `node scripts/generate-snapshot.js`            | `yarn snapshot`           | `library_snapshot.json`                      |
| A    | `node scripts/identify_new.js`                 | `yarn scan:new`           | `batches/new_music_batch_N.json`             |

## Troubleshooting

### "No pending operations file found!"

You haven't created `pending_operations.json` yet. Complete Step 2 first.

### Tracks skipped with "invalid genre"

The AI agent used a genre string that doesn't exactly match the taxonomy. Check for typos or invented categories in `pending_operations.json` and correct them.

### Tracks in `manual_review` with "Artist unknown"

The agent couldn't identify the artist. Use `resolve-review.js` to assign genres manually, or provide more context to the agent.

### Backfill reports failures

The MP3 file may be corrupted, read-only, or the filepath in the JSON no longer matches the actual file location. Verify the file exists and is writable.

### Agent overwrote pending_operations.json instead of appending

Re-read the system prompt to the agent, emphasizing the "Accumulating Results Across Batches" section. Re-run the affected batch. If the problem persists, you can manually merge two JSON files with a small Node one-liner:

```sh
node -e "
  const fs = require('fs');
  const a = JSON.parse(fs.readFileSync('old_pending_operations.json', 'utf8'));
  const b = JSON.parse(fs.readFileSync('new_batch_output.json', 'utf8'));
  const merged = {
    operations: [...a.operations, ...b.operations],
    manual_review: [...a.manual_review, ...b.manual_review]
  };
  fs.writeFileSync('pending_operations.json', JSON.stringify(merged, null, 2));
  console.log('Merged:', merged.operations.length, 'operations,', merged.manual_review.length, 'manual_review');
"