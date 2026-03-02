#!/usr/bin/env node
// merge-batch.js
// Merges a single batch result file into pending_operations.json and artist_map.json.
//
// The batch result file must follow this schema:
//   {
//     "batch": 174,
//     "operations": [ { filepath, status, primary_genre, secondary_genre, confidence_1, confidence_2 }, ... ],
//     "manual_review": [ { filepath, reason, confidence }, ... ],
//     "artist_map_updates": {
//       "Artist Name": { "primary_genre": "...", "secondary_genre": "..." },
//       ...
//     }
//   }
//
// Usage:
//   node scripts/merge-batch.js <batch-result-file>
//   node scripts/merge-batch.js batches/output/batch_174_results.json
//   node scripts/merge-batch.js --dry-run batches/output/batch_174_results.json

import fs from 'fs';
import path from 'path';

// --- CONFIGURATION ---
const OPERATIONS_FILE  = './pending_operations.json';
const ARTIST_MAP_FILE  = './artist_map.json';
const LAST_BATCH_FILE  = './LAST_BATCH';

// --- VALID GENRE TAXONOMY ---
const VALID_GENRES = [
  "Vintage Rock [Classic, Rockabilly]",
  "Punk [incl. Psychobilly]",
  "Nu Metal",
  "Traditional Metal [Heavy, Power]",
  "Extreme Metal [Death, Black, Doom, Sludge]",
  "Prog & Psychedelia",
  "Alt-Rock Era [90s-00s, Grunge]",
  "Hard Rock - Classic - [60s-70s]",
  "Hard Rock - Modern - [80s+]",
  "Indie & Shoegaze",
  "Jazz",
  "Blues",
  "Ambient, VGM & OST [Dungeon Synth, VGM]",
  "Vaporwave [Barber Beats, Chill]",
  "Retrowave [Synthwave]",
  "Pop",
  "Groove [Funk, Disco, Soul, R&B]",
  "Hyperpop",
  "Hip Hop [Rap, Trap]",
  "Industrial & Goth",
  "Trip Hop",
  "DnB & Breaks [Jungle]",
  "Big Beat & Chemical Breaks",
  "Electroswing",
  "House [incl. Deep House]",
  "French House, Filter House",
  "UK Garage [incl. Dubstep]",
  "Dark Electro [Midtempo, EBM]",
  "World Beats [Organic]",
  "Modern Techno [Minimal, Melodic]",
  "Techno [Upbeat]",
  "Techno [Slower]",
  "Americana & Folk [Acoustic]",
  "Latino [Salsa, Merengue, Son Cubano, Cumbia]",
  "Iberian [Flamenco, Fado, Rumba]",
  "Caribbean [Reggae, Ska]",
  "Rock Nacional [Uru/Arg]",
  "Latin Classics [Tango, Oldies]",
  "Classical",
];

// --- HELPERS ---

function parseArgs(argv) {
  const args = { dryRun: false, file: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run' || argv[i] === '-n') {
      args.dryRun = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      args.help = true;
    } else if (!argv[i].startsWith('--')) {
      args.file = argv[i];
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

function printUsage() {
  console.log(`
merge-batch.js — Merge a batch result file into pending_operations.json and artist_map.json

Usage:
  node scripts/merge-batch.js [--dry-run] <batch-result-file>

Arguments:
  <batch-result-file>   Path to the batch result JSON file (e.g. batches/output/batch_174_results.json)
  --dry-run, -n         Preview what would be merged without modifying any files
  --help, -h            Show this help message

Batch result file schema:
  {
    "batch": 174,
    "operations": [
      {
        "filepath": "Music/Artist/...",
        "status": "apply",
        "primary_genre": "Jazz",
        "secondary_genre": "Blues",
        "confidence_1": 9,
        "confidence_2": 8
      }
    ],
    "manual_review": [
      {
        "filepath": "Music/Unknown/...",
        "reason": "Artist unknown",
        "confidence": 2
      }
    ],
    "artist_map_updates": {
      "Artist Name": {
        "primary_genre": "Jazz",
        "secondary_genre": "Blues"
      }
    }
  }
`);
}

function isValidGenre(genre) {
  // Strip the "[DJ SET]" suffix before validating
  const cleaned = genre.replace(/\s*\[DJ SET\]\s*$/i, '').trim();
  return VALID_GENRES.some(v => v.toLowerCase() === cleaned.toLowerCase());
}

function canonicalGenre(genre) {
  const cleaned = genre.replace(/\s*\[DJ SET\]\s*$/i, '').trim();
  const match = VALID_GENRES.find(v => v.toLowerCase() === cleaned.toLowerCase());
  if (!match) return null;
  const hasDjSet = /\s*\[DJ SET\]\s*$/i.test(genre);
  return hasDjSet ? `${match} [DJ SET]` : match;
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`❌ Failed to parse JSON from ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function saveJson(filePath, data, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] Would write: ${filePath}`);
    return;
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// --- VALIDATION ---

function validateBatchResult(data, filePath) {
  const errors = [];
  const warnings = [];

  if (typeof data.batch !== 'number') {
    warnings.push('"batch" field is missing or not a number — LAST_BATCH will not be updated');
  }

  if (!Array.isArray(data.operations)) {
    errors.push('"operations" must be an array');
  }

  if (!Array.isArray(data.manual_review)) {
    errors.push('"manual_review" must be an array');
  }

  if (errors.length > 0) {
    console.error(`❌ Invalid batch result file: ${filePath}`);
    errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }

  // Validate individual operations
  let invalidGenreCount = 0;
  (data.operations || []).forEach((op, i) => {
    if (!op.filepath) warnings.push(`operations[${i}]: missing filepath`);

    if (op.primary_genre) {
      const canon = canonicalGenre(op.primary_genre);
      if (!canon) {
        warnings.push(`operations[${i}]: invalid primary_genre "${op.primary_genre}" — will be skipped`);
        invalidGenreCount++;
      }
    } else {
      warnings.push(`operations[${i}]: missing primary_genre`);
    }

    if (op.secondary_genre && !isValidGenre(op.secondary_genre)) {
      warnings.push(`operations[${i}]: invalid secondary_genre "${op.secondary_genre}" — will be cleared`);
    }
  });

  // Validate artist_map_updates
  if (data.artist_map_updates && typeof data.artist_map_updates === 'object') {
    Object.entries(data.artist_map_updates).forEach(([artist, genres]) => {
      if (genres.primary_genre && !isValidGenre(genres.primary_genre)) {
        warnings.push(`artist_map_updates["${artist}"]: invalid primary_genre "${genres.primary_genre}"`);
      }
      if (genres.secondary_genre && !isValidGenre(genres.secondary_genre)) {
        warnings.push(`artist_map_updates["${artist}"]: invalid secondary_genre "${genres.secondary_genre}"`);
      }
    });
  }

  return warnings;
}

// --- MERGE LOGIC ---

function mergeOperations(existing, incoming) {
  const existingPaths = new Set(existing.map(op => op.filepath));
  const added = [];
  const skipped = [];

  for (const op of incoming) {
    // Canonicalize genres
    const canonPrimary = op.primary_genre ? canonicalGenre(op.primary_genre) : null;
    const canonSecondary = op.secondary_genre && isValidGenre(op.secondary_genre)
      ? canonicalGenre(op.secondary_genre)
      : (op.secondary_genre || '');

    if (!canonPrimary) {
      skipped.push({ filepath: op.filepath, reason: `invalid primary_genre: "${op.primary_genre}"` });
      continue;
    }

    if (existingPaths.has(op.filepath)) {
      // Overwrite existing entry (e.g. re-classified on re-run)
      const idx = existing.findIndex(e => e.filepath === op.filepath);
      existing[idx] = { ...op, primary_genre: canonPrimary, secondary_genre: canonSecondary };
      added.push({ filepath: op.filepath, overwritten: true });
    } else {
      existing.push({ ...op, primary_genre: canonPrimary, secondary_genre: canonSecondary });
      existingPaths.add(op.filepath);
      added.push({ filepath: op.filepath, overwritten: false });
    }
  }

  return { added, skipped };
}

function mergeReviews(existing, incoming) {
  const existingPaths = new Set(existing.map(r => r.filepath));
  const added = [];

  for (const review of incoming) {
    if (existingPaths.has(review.filepath)) {
      // Update existing review
      const idx = existing.findIndex(r => r.filepath === review.filepath);
      existing[idx] = review;
      added.push({ filepath: review.filepath, overwritten: true });
    } else {
      existing.push(review);
      existingPaths.add(review.filepath);
      added.push({ filepath: review.filepath, overwritten: false });
    }
  }

  return { added };
}

function mergeArtistMap(artistMap, updates) {
  const results = { updated: [], added: [], invalid: [] };

  for (const [artist, genres] of Object.entries(updates)) {
    const primaryOk  = !genres.primary_genre  || isValidGenre(genres.primary_genre);
    const secondaryOk = !genres.secondary_genre || isValidGenre(genres.secondary_genre);

    if (!primaryOk) {
      results.invalid.push({ artist, reason: `invalid primary_genre: "${genres.primary_genre}"` });
      continue;
    }

    const entry = {
      primary_genre:   genres.primary_genre   || '',
      secondary_genre: genres.secondary_genre || '',
    };

    if (artist in artistMap) {
      artistMap[artist] = entry;
      results.updated.push(artist);
    } else {
      artistMap[artist] = entry;
      results.added.push(artist);
    }
  }

  return results;
}

// --- MAIN ---

function main() {
  const args = parseArgs(process.argv);

  if (args.help || !args.file) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const batchFile = path.resolve(args.file);
  const dryRun = args.dryRun;

  if (dryRun) {
    console.log('🏁 DRY RUN MODE — no files will be modified.\n');
  }

  // --- Load batch result ---
  console.log(`📂 Loading batch result: ${batchFile}`);
  const batchData = loadJson(batchFile);

  // --- Validate ---
  const warnings = validateBatchResult(batchData, batchFile);
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(w => console.log(`   - ${w}`));
    console.log('');
  }

  const batchNumber = typeof batchData.batch === 'number' ? batchData.batch : null;
  const incomingOps     = batchData.operations     || [];
  const incomingReviews = batchData.manual_review  || [];
  const artistUpdates   = batchData.artist_map_updates || {};

  console.log(`📊 Batch ${batchNumber ?? '(unknown)'}: ${incomingOps.length} operations, ${incomingReviews.length} manual_review, ${Object.keys(artistUpdates).length} artist_map updates`);

  // --- Load existing data ---
  let pendingData = { operations: [], manual_review: [] };
  if (fs.existsSync(OPERATIONS_FILE)) {
    pendingData = loadJson(OPERATIONS_FILE);
    if (!Array.isArray(pendingData.operations))  pendingData.operations  = [];
    if (!Array.isArray(pendingData.manual_review)) pendingData.manual_review = [];
  } else {
    console.log(`ℹ️  ${OPERATIONS_FILE} does not exist — will create it.`);
  }

  const artistMap = fs.existsSync(ARTIST_MAP_FILE) ? loadJson(ARTIST_MAP_FILE) : {};

  const prevOpCount     = pendingData.operations.length;
  const prevReviewCount = pendingData.manual_review.length;
  const prevArtistCount = Object.keys(artistMap).length;

  // --- Merge operations ---
  const opResult     = mergeOperations(pendingData.operations, incomingOps);
  const reviewResult = mergeReviews(pendingData.manual_review, incomingReviews);
  const mapResult    = mergeArtistMap(artistMap, artistUpdates);

  // --- Report ---
  const newOps      = opResult.added.filter(o => !o.overwritten).length;
  const overwritten = opResult.added.filter(o =>  o.overwritten).length;
  const skipped     = opResult.skipped.length;

  console.log('\n📝 Operations:');
  console.log(`   Before : ${prevOpCount}`);
  console.log(`   Added  : +${newOps}${overwritten > 0 ? ` (${overwritten} overwritten)` : ''}`);
  if (skipped > 0) {
    console.log(`   Skipped: ${skipped} (invalid genres)`);
    opResult.skipped.forEach(s => console.log(`     - ${s.filepath}: ${s.reason}`));
  }
  console.log(`   After  : ${pendingData.operations.length}`);

  console.log('\n🔍 Manual Review:');
  console.log(`   Before : ${prevReviewCount}`);
  console.log(`   Added  : +${reviewResult.added.filter(r => !r.overwritten).length}`);
  console.log(`   After  : ${pendingData.manual_review.length}`);

  console.log('\n🗂️  Artist Map:');
  console.log(`   Before : ${prevArtistCount}`);
  if (mapResult.updated.length > 0) {
    console.log(`   Updated: ${mapResult.updated.length}`);
    mapResult.updated.forEach(a => console.log(`     ✏️  ${a} -> ${artistUpdates[a].primary_genre}`));
  }
  if (mapResult.added.length > 0) {
    console.log(`   Added  : ${mapResult.added.length}`);
    mapResult.added.forEach(a => console.log(`     ➕ ${a} -> ${artistUpdates[a].primary_genre}`));
  }
  if (mapResult.invalid.length > 0) {
    console.log(`   Invalid: ${mapResult.invalid.length}`);
    mapResult.invalid.forEach(e => console.log(`     ❌ ${e.artist}: ${e.reason}`));
  }
  console.log(`   After  : ${Object.keys(artistMap).length}`);

  // --- Write ---
  console.log('');
  saveJson(OPERATIONS_FILE, pendingData, dryRun);
  if (!dryRun) console.log(`✅ Written: ${OPERATIONS_FILE}`);

  saveJson(ARTIST_MAP_FILE, artistMap, dryRun);
  if (!dryRun) console.log(`✅ Written: ${ARTIST_MAP_FILE}`);

  if (batchNumber !== null) {
    if (!dryRun) {
      fs.writeFileSync(LAST_BATCH_FILE, String(batchNumber) + '\n', 'utf8');
      console.log(`✅ Updated: ${LAST_BATCH_FILE} -> ${batchNumber}`);
    } else {
      console.log(`  [dry-run] Would update LAST_BATCH -> ${batchNumber}`);
    }
  }

  if (dryRun) {
    console.log('\n🏁 Dry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\n🎉 Batch merge complete.');
  }
}

main();
