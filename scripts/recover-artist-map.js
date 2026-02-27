// recover-artist-map.js
// Recovers missing artist genre assignments in artist_map.json by deriving
// them from the genre data already present in pending_operations.json.
//
// Strategy:
//   1. Query pending_operations.json via jq to extract artist folder names and genres.
//   2. For every `operations` entry, tally (primary_genre, secondary_genre) votes
//      per artist folder (majority vote wins).
//   3. Find artists in artist_map.json whose genres are currently empty.
//   4. Match empty artists to vote winners (exact, then case-insensitive fallback).
//   5. Patch artist_map.json atomically via jq, writing a temp file first.
//
// Usage:
//   node scripts/recover-artist-map.js
//   node scripts/recover-artist-map.js --dry-run
//   node scripts/recover-artist-map.js --verbose
//   node scripts/recover-artist-map.js --ops path/to/pending_operations.json
//   node scripts/recover-artist-map.js --map path/to/artist_map.json

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const args = {
        dryRun: false,
        verbose: false,
        ops: 'pending_operations.json',
        map: 'artist_map.json',
    };

    let i = 2;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            args.dryRun = true;
            i++;
        } else if (arg === '--verbose' || arg === '-v') {
            args.verbose = true;
            i++;
        } else if (arg === '--ops' && i + 1 < argv.length) {
            args.ops = argv[i + 1];
            i += 2;
        } else if (arg === '--map' && i + 1 < argv.length) {
            args.map = argv[i + 1];
            i += 2;
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else {
            console.error(`Unknown argument: ${arg}`);
            printUsage();
            process.exit(1);
        }
    }
    return args;
}

function printUsage() {
    console.log(`
recover-artist-map.js — Recover missing artist genres from pending_operations.json

Usage:
  node scripts/recover-artist-map.js [options]

Options:
  --dry-run          Show what would change without writing any files
  --verbose, -v      Print detailed match / mismatch information
  --ops <path>       Path to pending_operations.json  (default: pending_operations.json)
  --map <path>       Path to artist_map.json          (default: artist_map.json)
  --help, -h         Show this help message
`);
}

// ---------------------------------------------------------------------------
// jq helpers
// ---------------------------------------------------------------------------

function runJq(expr, filepath) {
    try {
        return execFileSync('jq', ['-r', expr, filepath], { encoding: 'utf8' });
    } catch (err) {
        console.error(`[ERROR] jq failed: ${err.stderr ?? err.message}`);
        process.exit(1);
    }
}

function runJqJson(expr, filepath) {
    const raw = runJq(expr, filepath);
    return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Step 1 — Build genre votes from pending_operations.json
// ---------------------------------------------------------------------------

function buildGenreVotes(opsPath, verbose) {
    console.log('[1/4] Reading operations from pending_operations.json …');

    // Pull only the three fields we need; jq keeps memory tiny.
    const data = runJqJson(
        '[.operations[] | {fp: (.filepath | split("/")[1]), pg: .primary_genre, sg: .secondary_genre}]',
        opsPath,
    );

    // votes: Map<artistFolder, Map<"pg|sg", count>>
    const votes = new Map();

    for (const item of data) {
        const artist = (item.fp ?? '').trim();
        const pg = (item.pg ?? '').trim();
        const sg = (item.sg ?? '').trim();
        if (!artist || !pg) continue;

        const key = `${pg}|||${sg}`;
        if (!votes.has(artist)) votes.set(artist, new Map());
        const tally = votes.get(artist);
        tally.set(key, (tally.get(key) ?? 0) + 1);
    }

    console.log(`    Found genre votes for ${votes.size} unique artist folders.`);

    if (verbose) {
        let shown = 0;
        for (const [artist, tally] of votes) {
            if (shown >= 10) break;
            const [topKey, topCount] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
            const [pg, sg] = topKey.split('|||');
            console.log(`    ${artist.padEnd(40)}  →  ${pg} / ${sg}  (×${topCount})`);
            shown++;
        }
    }

    return votes;
}

// ---------------------------------------------------------------------------
// Step 2 — Find artists in artist_map.json with empty genres
// ---------------------------------------------------------------------------

function findEmptyArtists(mapPath, verbose) {
    console.log('[2/4] Finding artists with empty genres in artist_map.json …');

    const raw = runJq(
        'to_entries | map(select(.value.primary_genre == "")) | .[].key',
        mapPath,
    );

    const empty = raw.split('\n').map(l => l.trim()).filter(Boolean);
    console.log(`    ${empty.length} artists have empty genres.`);
    return empty;
}

// ---------------------------------------------------------------------------
// Step 3 — Match empty artists to vote winners
// ---------------------------------------------------------------------------

/**
 * Returns a Map<artistName, { primary_genre, secondary_genre }>
 */
function matchArtists(emptyArtists, votes, verbose) {
    console.log('[3/4] Matching empty artists to genre votes …');

    const matches = new Map();
    const unmatched = [];

    // Pre-build a lowercase lookup for case-insensitive fallback.
    const lowerKeys = new Map(); // lowercase → original key
    for (const key of votes.keys()) {
        lowerKeys.set(key.toLowerCase(), key);
    }

    for (const artist of emptyArtists) {
        // Exact match first.
        if (votes.has(artist)) {
            const [pg, sg] = topGenrePair(votes.get(artist));
            matches.set(artist, { primary_genre: pg, secondary_genre: sg });
            continue;
        }

        // Case-insensitive fallback.
        const found = lowerKeys.get(artist.toLowerCase());
        if (found) {
            const [pg, sg] = topGenrePair(votes.get(found));
            matches.set(artist, { primary_genre: pg, secondary_genre: sg });
            if (verbose) {
                console.log(`    Case-insensitive match: "${artist}" → "${found}"`);
            }
            continue;
        }

        unmatched.push(artist);
    }

    console.log(`    Matched   : ${matches.size}`);
    console.log(`    Unmatched : ${unmatched.length}`);

    if (verbose && unmatched.length > 0) {
        console.log('    Unmatched artists (no genre data in pending_operations):');
        const preview = unmatched.slice(0, 30);
        for (const a of preview.sort()) {
            console.log(`      "${a}"`);
        }
        if (unmatched.length > 30) {
            console.log(`      … and ${unmatched.length - 30} more`);
        }
    }

    return matches;
}

/** Given a tally Map<"pg|||sg", count>, return [pg, sg] of the winning pair. */
function topGenrePair(tally) {
    const [topKey] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const [pg, sg] = topKey.split('|||');
    return [pg, sg];
}

// ---------------------------------------------------------------------------
// Step 4 — Patch artist_map.json
// ---------------------------------------------------------------------------

function patchArtistMap(mapPath, matches, dryRun, verbose) {
    console.log('[4/4] Patching artist_map.json …');

    if (matches.size === 0) {
        console.log('    Nothing to patch.');
        return 0;
    }

    if (dryRun) {
        console.log(`    [DRY RUN] Would patch ${matches.size} artists. No files written.`);
        if (verbose) {
            for (const [artist, { primary_genre, secondary_genre }] of [...matches.entries()].sort()) {
                console.log(`      ${artist.padEnd(50)}  ${primary_genre} / ${secondary_genre}`);
            }
        }
        return matches.size;
    }

    // Write the patch dict to a temp file so we don't hit shell arg-length limits.
    const patchObj = {};
    for (const [artist, genres] of matches) {
        patchObj[artist] = genres;
    }

    const tmpFile = path.join(os.tmpdir(), `artist-map-patch-${Date.now()}.json`);
    try {
        fs.writeFileSync(tmpFile, JSON.stringify(patchObj, null, 2), 'utf8');

        // jq expression: walk every key; if it exists in $patch, replace .value.
        const jqExpr = (
            'to_entries | map(' +
            '  if ($patch[0][.key] // null) != null' +
            '  then .value = $patch[0][.key]' +
            '  else .' +
            '  end' +
            ') | from_entries'
        );

        const outPath = mapPath + '.tmp';
        let patched;
        try {
            patched = execFileSync(
                'jq',
                ['--slurpfile', 'patch', tmpFile, jqExpr, mapPath],
                { encoding: 'utf8' },
            );
        } catch (err) {
            console.error(`[ERROR] jq patch failed: ${err.stderr ?? err.message}`);
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
            process.exit(1);
        }

        fs.writeFileSync(outPath, patched, 'utf8');
        // Atomic replace
        fs.renameSync(outPath, mapPath);

        console.log(`    Wrote patched artist_map.json  (${matches.size} artists updated).`);

        if (verbose) {
            for (const [artist, { primary_genre, secondary_genre }] of [...matches.entries()].sort()) {
                console.log(`      ${artist.padEnd(50)}  ${primary_genre} / ${secondary_genre}`);
            }
        }

        return matches.size;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) { /* best-effort cleanup */ }
    }
}

// ---------------------------------------------------------------------------
// Step 5 — Verification
// ---------------------------------------------------------------------------

function verify(mapPath) {
    const remaining = parseInt(
        runJq('to_entries | map(select(.value.primary_genre == "")) | length', mapPath).trim(),
        10,
    );
    const total = parseInt(runJq('keys | length', mapPath).trim(), 10);
    console.log(`\n    Artist map: ${total} total, ${remaining} still empty.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const args = parseArgs(process.argv);

const opsPath = path.resolve(PROJECT_ROOT, args.ops);
const mapPath = path.resolve(PROJECT_ROOT, args.map);

for (const [p, flag] of [[opsPath, '--ops'], [mapPath, '--map']]) {
    if (!fs.existsSync(p)) {
        console.error(`[ERROR] File not found (${flag}): ${p}`);
        process.exit(1);
    }
}

console.log('='.repeat(60));
console.log('Artist Map Recovery');
console.log(`  ops  : ${opsPath}`);
console.log(`  map  : ${mapPath}`);
console.log(`  mode : ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log('='.repeat(60));

const votes   = buildGenreVotes(opsPath, args.verbose);
const empty   = findEmptyArtists(mapPath, args.verbose);
const matches = matchArtists(empty, votes, args.verbose);
const updated = patchArtistMap(mapPath, matches, args.dryRun, args.verbose);

if (!args.dryRun) {
    verify(mapPath);
}

console.log('\nDone.');
console.log(`  Updated : ${updated}`);
console.log(`  Skipped : ${empty.length - updated}  (no genre data in pending_operations)`);
