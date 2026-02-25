// review-stats.js
// Review and inspect pending_operations.json from the command line.
//
// Usage:
//   node scripts/review-stats.js --summary              # Quick counts overview
//   node scripts/review-stats.js --genres                # Genre distribution bar chart
//   node scripts/review-stats.js --confidence            # Confidence score distribution
//   node scripts/review-stats.js --manual                # List all manual_review entries
//   node scripts/review-stats.js --artist "Artist Name"  # Find tracks by artist
//   node scripts/review-stats.js --pairs                 # List unique genre pair combinations
//   node scripts/review-stats.js --low-confidence        # Spot-check borderline operations (7–8)
//   node scripts/review-stats.js --all                   # Run all reports sequentially

import fs from 'fs';

// --- CONFIGURATION ---
const OPERATIONS_FILE = './pending_operations.json';

// --- HELPERS ---

function loadData() {
    if (!fs.existsSync(OPERATIONS_FILE)) {
        console.error(`No pending operations file found at ${OPERATIONS_FILE}`);
        console.error('Complete Step 2 (AI agent classification) first.');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(OPERATIONS_FILE, 'utf8'));
}

function parseArgs(argv) {
    const args = {};
    let i = 2;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '--summary') { args.summary = true; i++; }
        else if (arg === '--genres') { args.genres = true; i++; }
        else if (arg === '--confidence') { args.confidence = true; i++; }
        else if (arg === '--manual') { args.manual = true; i++; }
        else if (arg === '--pairs') { args.pairs = true; i++; }
        else if (arg === '--low-confidence') { args.lowConfidence = true; i++; }
        else if (arg === '--all') { args.all = true; i++; }
        else if (arg === '--artist' && i + 1 < argv.length) {
            args.artist = argv[i + 1];
            i += 2;
        }
        else if (arg === '--help' || arg === '-h') { args.help = true; i++; }
        else {
            console.error(`Unknown argument: ${arg}`);
            process.exit(1);
        }
    }
    return args;
}

function heading(title) {
    const line = '─'.repeat(70);
    console.log(`\n${line}`);
    console.log(`  ${title}`);
    console.log(line);
}

function pad(str, len) {
    const s = String(str);
    return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function printUsage() {
    console.log(`
review-stats.js — Inspect and review pending_operations.json

Usage:
  node scripts/review-stats.js <command>

Commands:
  --summary          Quick counts: operations, manual review, totals
  --genres           Primary genre distribution with bar chart
  --confidence       Confidence score distribution
  --manual           List all manual_review entries with index, reason, confidence
  --artist <name>    Search operations by artist name (case-insensitive substring)
  --pairs            List all unique primary + secondary genre combinations
  --low-confidence   Spot-check operations with borderline confidence (7–8)
  --all              Run all reports sequentially

  --help, -h         Show this help message
`);
}

// --- REPORTS ---

function reportSummary(data) {
    heading('Summary');

    const ops = data.operations || [];
    const reviews = data.manual_review || [];
    const applyCount = ops.filter(op => op.status === 'apply').length;
    const otherStatus = ops.length - applyCount;

    console.log(`  Ready to apply:   ${applyCount}`);
    if (otherStatus > 0) {
        console.log(`  Other status:     ${otherStatus}`);
    }
    console.log(`  Manual review:    ${reviews.length}`);
    console.log(`  Total tracks:     ${ops.length + reviews.length}`);
    console.log('');
}

function reportGenres(data) {
    heading('Genre Distribution (Primary)');

    const ops = data.operations || [];
    if (ops.length === 0) {
        console.log('  No operations found.\n');
        return;
    }

    // Count occurrences of each primary genre
    const counts = {};
    for (const op of ops) {
        const genre = op.primary_genre || '(empty)';
        counts[genre] = (counts[genre] || 0) + 1;
    }

    // Sort descending by count
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const maxCount = sorted[0][1];
    const maxBarWidth = 30;

    for (const [genre, count] of sorted) {
        const barLen = Math.max(1, Math.round((count / maxCount) * maxBarWidth));
        const bar = '█'.repeat(barLen);
        console.log(`  ${pad(genre, 45)} ${bar} ${count}`);
    }
    console.log('');
}

function reportConfidence(data) {
    heading('Confidence Distribution');

    const ops = data.operations || [];
    if (ops.length === 0) {
        console.log('  No operations found.\n');
        return;
    }

    // Group by confidence_1
    const counts = {};
    for (const op of ops) {
        const conf = op.confidence_1 ?? '?';
        counts[conf] = (counts[conf] || 0) + 1;
    }

    // Sort descending by confidence level
    const sorted = Object.entries(counts)
        .sort((a, b) => {
            const aNum = Number(a[0]);
            const bNum = Number(b[0]);
            if (isNaN(aNum) && isNaN(bNum)) return 0;
            if (isNaN(aNum)) return 1;
            if (isNaN(bNum)) return -1;
            return bNum - aNum;
        });

    const maxCount = Math.max(...sorted.map(s => s[1]));
    const maxBarWidth = 30;

    for (const [conf, count] of sorted) {
        const barLen = Math.max(1, Math.round((count / maxCount) * maxBarWidth));
        const bar = '█'.repeat(barLen);
        console.log(`  Confidence ${pad(conf, 3)}  ${bar} ${count} tracks`);
    }
    console.log('');
}

function reportManual(data) {
    heading('Manual Review Entries');

    const reviews = data.manual_review || [];
    if (reviews.length === 0) {
        console.log('  ✅ No entries in manual_review. Nothing to resolve.\n');
        return;
    }

    console.log(`  ${reviews.length} entries require attention:\n`);

    reviews.forEach((entry, idx) => {
        const filepath = entry.filepath || '(no filepath)';
        const reason = entry.reason || '(no reason)';
        const confidence = entry.confidence ?? '?';
        console.log(`  [${idx}]  ${filepath}`);
        console.log(`       Reason: ${reason}`);
        console.log(`       Confidence: ${confidence}`);
        console.log('');
    });

    console.log(`  To resolve: node scripts/resolve-review.js --resolve <index> --primary "<genre>" [--secondary "<genre>"]`);
    console.log('');
}

function reportArtist(data, searchTerm) {
    heading(`Search: "${searchTerm}"`);

    const ops = data.operations || [];
    const pattern = searchTerm.toLowerCase();

    const matches = ops.filter(op => {
        const filepath = (op.filepath || '').toLowerCase();
        const primary = (op.primary_genre || '').toLowerCase();
        const secondary = (op.secondary_genre || '').toLowerCase();
        return filepath.includes(pattern) || primary.includes(pattern) || secondary.includes(pattern);
    });

    if (matches.length === 0) {
        console.log(`  No operations match "${searchTerm}".\n`);
        return;
    }

    console.log(`  ${matches.length} matches:\n`);

    for (const op of matches) {
        const genre = op.secondary_genre
            ? `${op.primary_genre}; ${op.secondary_genre}`
            : op.primary_genre;
        console.log(`  ${op.filepath}`);
        console.log(`    Genre: ${genre}  (confidence: ${op.confidence_1 ?? '?'}/${op.confidence_2 ?? '?'})`);
    }
    console.log('');
}

function reportPairs(data) {
    heading('Unique Genre Pairs');

    const ops = data.operations || [];
    if (ops.length === 0) {
        console.log('  No operations found.\n');
        return;
    }

    const pairCounts = {};
    for (const op of ops) {
        const pair = op.secondary_genre
            ? `${op.primary_genre}; ${op.secondary_genre}`
            : op.primary_genre;
        pairCounts[pair] = (pairCounts[pair] || 0) + 1;
    }

    const sorted = Object.entries(pairCounts).sort((a, b) => b[1] - a[1]);

    for (const [pair, count] of sorted) {
        console.log(`  ${pad(pair, 70)} (${count})`);
    }

    console.log(`\n  ${sorted.length} unique combinations across ${ops.length} tracks.`);
    console.log('');
}

function reportLowConfidence(data) {
    heading('Low Confidence Operations (7–8)');

    const ops = data.operations || [];
    const borderline = ops
        .filter(op => op.confidence_1 !== undefined && op.confidence_1 >= 7 && op.confidence_1 <= 8)
        .sort((a, b) => a.confidence_1 - b.confidence_1);

    if (borderline.length === 0) {
        console.log('  ✅ No borderline operations. All approved tracks have confidence > 8.\n');
        return;
    }

    console.log(`  ${borderline.length} operations with borderline confidence:\n`);

    for (const op of borderline) {
        const genre = op.secondary_genre
            ? `${op.primary_genre}; ${op.secondary_genre}`
            : op.primary_genre;
        console.log(`  [conf ${op.confidence_1}]  ${op.filepath}`);
        console.log(`          Genre: ${genre}`);
    }
    console.log('');
}

// --- MAIN ---

const args = parseArgs(process.argv);

const hasCommand = args.summary || args.genres || args.confidence || args.manual
    || args.artist || args.pairs || args.lowConfidence || args.all;

if (args.help || !hasCommand) {
    printUsage();
    process.exit(0);
}

const data = loadData();

if (args.all || args.summary) reportSummary(data);
if (args.all || args.genres) reportGenres(data);
if (args.all || args.confidence) reportConfidence(data);
if (args.all || args.manual) reportManual(data);
if (args.all || args.pairs) reportPairs(data);
if (args.all || args.lowConfidence) reportLowConfidence(data);

if (args.artist) reportArtist(data, args.artist);
