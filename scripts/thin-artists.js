#!/usr/bin/env node
// thin-artists.js — Find artists with few songs in a given genre
//
// Usage:
//   node scripts/thin-artists.js <genre> [--max <n>] [--match primary|secondary|any]
//
// Options:
//   <genre>              Genre string to search for (case-insensitive, partial match supported)
//   --max <n>            Maximum track count threshold (default: 2)
//   --match              Which genre field to check: primary, secondary, or any (default: any)
//
// Examples:
//   node scripts/thin-artists.js "jazz"
//   node scripts/thin-artists.js "DnB" --max 3
//   node scripts/thin-artists.js "House" --match primary --max 1

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PENDING_OPS_FILE = path.join(PROJECT_ROOT, 'pending_operations.json');

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage:
  node scripts/thin-artists.js <genre> [--max <n>] [--match primary|secondary|any]

Options:
  <genre>          Genre string to search for (case-insensitive, partial match)
  --max <n>        Maximum track count to include (default: 2)
  --match          Which genre field: primary | secondary | any  (default: any)

Examples:
  node scripts/thin-artists.js "jazz"
  node scripts/thin-artists.js "DnB" --max 3
  node scripts/thin-artists.js "House" --match primary --max 1
`);
  process.exit(0);
}

const genreQuery = args[0];
let maxTracks = 2;
let matchMode = 'any'; // 'primary' | 'secondary' | 'any'

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--max' && args[i + 1]) {
    const parsed = parseInt(args[i + 1], 10);
    if (isNaN(parsed) || parsed < 1) {
      console.error('❌  --max must be a positive integer');
      process.exit(1);
    }
    maxTracks = parsed;
    i++;
  } else if (args[i] === '--match' && args[i + 1]) {
    const m = args[i + 1].toLowerCase();
    if (!['primary', 'secondary', 'any'].includes(m)) {
      console.error('❌  --match must be one of: primary, secondary, any');
      process.exit(1);
    }
    matchMode = m;
    i++;
  }
}

// ── Load data ─────────────────────────────────────────────────────────────────

if (!fs.existsSync(PENDING_OPS_FILE)) {
  console.error(`❌  Could not find pending_operations.json at:\n    ${PENDING_OPS_FILE}`);
  process.exit(1);
}

let operations;
try {
  const raw = fs.readFileSync(PENDING_OPS_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  operations = parsed.operations ?? parsed; // support both wrapped and bare arrays
} catch (err) {
  console.error(`❌  Failed to parse pending_operations.json: ${err.message}`);
  process.exit(1);
}

// ── Helper: extract artist folder name from filepath ──────────────────────────
//
// Filepaths look like:  Music/Artist Name/Artist Name - Album - 01 - Track.mp3
// We use the first folder segment after Music/ as the canonical artist key.

function extractArtist(filepath) {
  // Normalise separators
  const parts = filepath.replace(/\\/g, '/').split('/');
  // parts[0] = "Music", parts[1] = artist folder, parts[2] = filename
  if (parts.length >= 3 && parts[0].toLowerCase() === 'music') {
    return parts[1];
  }
  // Fallback: second segment regardless
  return parts[1] ?? filepath;
}

// ── Helper: genre match ───────────────────────────────────────────────────────

const queryLower = genreQuery.toLowerCase();

function genreMatches(op) {
  const inPrimary   = (op.primary_genre   ?? '').toLowerCase().includes(queryLower);
  const inSecondary = (op.secondary_genre ?? '').toLowerCase().includes(queryLower);

  if (matchMode === 'primary')   return inPrimary;
  if (matchMode === 'secondary') return inSecondary;
  return inPrimary || inSecondary; // 'any'
}

// ── Count tracks per artist for the matching genre ───────────────────────────

/** @type {Map<string, { count: number, primaryGenre: string, secondaryGenre: string }>} */
const artistStats = new Map();

for (const op of operations) {
  if (!genreMatches(op)) continue;

  const artist = extractArtist(op.filepath);
  if (!artist) continue;

  if (!artistStats.has(artist)) {
    artistStats.set(artist, {
      count: 0,
      primaryGenre: op.primary_genre ?? '',
      secondaryGenre: op.secondary_genre ?? '',
    });
  }
  artistStats.get(artist).count++;
}

if (artistStats.size === 0) {
  console.log(`\n🔍  No tracks found matching genre: "${genreQuery}"\n`);
  process.exit(0);
}

// ── Filter to thin artists ────────────────────────────────────────────────────

const thin = [...artistStats.entries()]
  .filter(([, s]) => s.count <= maxTracks)
  .sort((a, b) => {
    // Sort by count ascending, then artist name alphabetically
    if (a[1].count !== b[1].count) return a[1].count - b[1].count;
    return a[0].localeCompare(b[0]);
  });

// ── Output ────────────────────────────────────────────────────────────────────

const matchedTotal = [...artistStats.values()].reduce((s, v) => s + v.count, 0);
const matchLabel = matchMode === 'any' ? 'primary or secondary' : `${matchMode} only`;

console.log();
console.log(`🎵  Genre query : "${genreQuery}"  (${matchLabel})`);
console.log(`📊  Max tracks  : ${maxTracks}`);
console.log(`🎤  Total artists in genre    : ${artistStats.size}`);
console.log(`🎤  Artists with ≤ ${maxTracks} track(s)  : ${thin.length}  (out of ${matchedTotal} total matched tracks)`);
console.log();

if (thin.length === 0) {
  console.log('  ✅  No thin artists found — every artist has more tracks than the threshold.\n');
  process.exit(0);
}

// Column widths
const maxArtistLen = Math.max(6, ...thin.map(([a]) => a.length));
const colArtist = Math.min(maxArtistLen, 40);
const colCount  = 6;
const colGenre  = 44;

const pad = (s, n) => String(s).padEnd(n);
const header = `  ${pad('Artist', colArtist)}  ${pad('Trks', colCount)}  ${pad('Primary Genre', colGenre)}  Secondary Genre`;
const divider = `  ${'-'.repeat(colArtist)}  ${'-'.repeat(colCount)}  ${'-'.repeat(colGenre)}  ${'-'.repeat(colGenre)}`;

console.log(header);
console.log(divider);

for (const [artist, stats] of thin) {
  const name = artist.length > colArtist ? artist.slice(0, colArtist - 1) + '…' : artist;
  console.log(
    `  ${pad(name, colArtist)}  ${pad(stats.count, colCount)}  ${pad(stats.primaryGenre, colGenre)}  ${stats.secondaryGenre}`
  );
}

console.log();
