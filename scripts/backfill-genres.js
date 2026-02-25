// backfill-genres.js
// Reads pending_operations.json and writes genre tags to MP3 files.
//
// Dependencies:
//   yarn add node-id3
//
// Usage:
//   node scripts/backfill-genres.js            # Apply genre tags to MP3 files
//   node scripts/backfill-genres.js --dry-run   # Preview changes without modifying files

import fs from 'fs';
import nodeID3 from 'node-id3';

// --- CONFIGURATION ---
const OPERATIONS_FILE = './pending_operations.json';
const DRY_RUN = process.argv.includes('--dry-run');

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

function validateGenre(genre) {
    // Strip the "[DJ SET]" suffix before validating
    const cleaned = genre.replace(/\s*\[DJ SET\]\s*$/i, '').trim();
    return VALID_GENRES.some(valid => valid.toLowerCase() === cleaned.toLowerCase());
}

function backfillGenres() {
    if (!fs.existsSync(OPERATIONS_FILE)) {
        console.error("No pending operations file found!");
        return;
    }

    if (DRY_RUN) {
        console.log("🏁 DRY RUN MODE — no files will be modified.\n");
    }

    const data = JSON.parse(fs.readFileSync(OPERATIONS_FILE, 'utf8'));
    const ops = data.operations.filter(op => op.status === 'apply');

    console.log(`Starting backfill for ${ops.length} tracks...`);

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    ops.forEach(op => {
        const genreString = op.secondary_genre
            ? `${op.primary_genre}; ${op.secondary_genre}`
            : op.primary_genre;

        // Validate each genre against the taxonomy
        const genresToCheck = [op.primary_genre, op.secondary_genre].filter(Boolean);
        const invalidGenres = genresToCheck.filter(g => !validateGenre(g));

        if (invalidGenres.length > 0) {
            console.warn(`⚠️  Skipped (invalid genre): ${op.filepath} -> [${invalidGenres.join(', ')}]`);
            skippedCount++;
            return;
        }

        if (DRY_RUN) {
            console.log(`🔍 Would tag: ${op.filepath} -> [${genreString}]`);
            successCount++;
            return;
        }

        const tags = {
            genre: genreString
        };

        const success = nodeID3.update(tags, op.filepath);

        if (success) {
            console.log(`✅ Tagged: ${op.filepath} -> [${genreString}]`);
            successCount++;
        } else {
            console.error(`❌ Failed: ${op.filepath}`);
            failCount++;
        }
    });

    console.log(`\nBackfill complete. ✅ ${successCount} tagged | ❌ ${failCount} failed | ⚠️  ${skippedCount} skipped (invalid genre).`);
    if (DRY_RUN) {
        console.log("ℹ️  This was a dry run. Run without --dry-run to apply changes.");
    }
    if (data.manual_review.length > 0) {
        console.log(`Note: ${data.manual_review.length} tracks require manual review in the JSON file.`);
    }
}

backfillGenres();
