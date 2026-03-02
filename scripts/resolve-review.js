// resolve-review.js
// Moves entries from manual_review to operations in pending_operations.json.
//
// Dependencies:
//   (none beyond Node.js built-ins)
//
// Usage:
//   node scripts/resolve-review.js --list                                          # List all manual_review entries
//   node scripts/resolve-review.js --resolve 0 --primary "Jazz"                    # Resolve entry #0 with primary genre
//   node scripts/resolve-review.js --resolve 0 --primary "Jazz" --secondary "Blues" # Resolve with both genres
//   node scripts/resolve-review.js --resolve "path/to/file.mp3" --primary "Pop"    # Resolve by filepath match

import fs from "fs";

// --- CONFIGURATION ---
const OPERATIONS_FILE = "./pending_operations.json";

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
  const args = {};
  let i = 2; // skip node and script path
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--list") {
      args.list = true;
      i++;
    } else if (arg === "--resolve" && i + 1 < argv.length) {
      args.resolve = argv[i + 1];
      i += 2;
    } else if (arg === "--primary" && i + 1 < argv.length) {
      args.primary = argv[i + 1];
      i += 2;
    } else if (arg === "--secondary" && i + 1 < argv.length) {
      args.secondary = argv[i + 1];
      i += 2;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
      i++;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

function validateGenre(genre) {
  const cleaned = genre.replace(/\s*\[DJ SET\]\s*$/i, "").trim();
  return VALID_GENRES.some(
    (valid) => valid.toLowerCase() === cleaned.toLowerCase(),
  );
}

function findCanonicalGenre(genre) {
  const cleaned = genre.replace(/\s*\[DJ SET\]\s*$/i, "").trim();
  const match = VALID_GENRES.find(
    (valid) => valid.toLowerCase() === cleaned.toLowerCase(),
  );
  if (!match) return null;
  // Preserve [DJ SET] suffix if it was present
  const hasDjSet = /\s*\[DJ SET\]\s*$/i.test(genre);
  return hasDjSet ? `${match} [DJ SET]` : match;
}

function loadData() {
  if (!fs.existsSync(OPERATIONS_FILE)) {
    console.error(`No pending operations file found at ${OPERATIONS_FILE}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(OPERATIONS_FILE, "utf8"));
}

function saveData(data) {
  fs.writeFileSync(OPERATIONS_FILE, JSON.stringify(data, null, 2));
}

function printUsage() {
  console.log(`
resolve-review.js — Move manual_review entries to operations

Usage:
  node scripts/resolve-review.js --list
    List all manual_review entries with their index numbers.

  node scripts/resolve-review.js --resolve <index|filepath> --primary <genre> [--secondary <genre>]
    Resolve a manual_review entry by moving it to operations with the given genres.
    The entry can be identified by its numeric index (from --list) or by a filepath substring match.

Available genres:
${VALID_GENRES.map((g) => `  - ${g}`).join("\n")}
`);
}

// --- COMMANDS ---

function listReview() {
  const data = loadData();
  const reviews = data.manual_review || [];

  if (reviews.length === 0) {
    console.log("✅ No entries in manual_review. Nothing to resolve.");
    return;
  }

  console.log(`\n📋 Manual Review Entries (${reviews.length} total):\n`);
  console.log("─".repeat(100));

  reviews.forEach((entry, idx) => {
    const filepath = entry.filepath || "(no filepath)";
    const reason = entry.reason || "(no reason)";
    const confidence = entry.confidence ?? "?";
    console.log(`  [${idx}]  ${filepath}`);
    console.log(`       Reason: ${reason}`);
    console.log(`       Confidence: ${confidence}`);
    console.log("");
  });

  console.log("─".repeat(100));
  console.log(`\nTo resolve an entry, run:`);
  console.log(
    `  node scripts/resolve-review.js --resolve <index> --primary "<genre>" [--secondary "<genre>"]`,
  );
}

function resolveEntry(identifier, primaryGenre, secondaryGenre) {
  // Validate genres
  const canonicalPrimary = findCanonicalGenre(primaryGenre);
  if (!canonicalPrimary) {
    console.error(`❌ Invalid primary genre: "${primaryGenre}"`);
    console.error(`\nRun with --list or --help to see available genres.`);
    process.exit(1);
  }

  let canonicalSecondary = null;
  if (secondaryGenre) {
    canonicalSecondary = findCanonicalGenre(secondaryGenre);
    if (!canonicalSecondary) {
      console.error(`❌ Invalid secondary genre: "${secondaryGenre}"`);
      console.error(`\nRun with --list or --help to see available genres.`);
      process.exit(1);
    }
  }

  const data = loadData();
  const reviews = data.manual_review || [];

  if (reviews.length === 0) {
    console.log("✅ No entries in manual_review. Nothing to resolve.");
    return;
  }

  // Find the entry — by numeric index or filepath substring
  let targetIndex = -1;

  const asNumber = parseInt(identifier, 10);
  if (!isNaN(asNumber) && String(asNumber) === identifier) {
    // Numeric index
    if (asNumber < 0 || asNumber >= reviews.length) {
      console.error(
        `❌ Index ${asNumber} is out of range. There are ${reviews.length} entries (0–${reviews.length - 1}).`,
      );
      process.exit(1);
    }
    targetIndex = asNumber;
  } else {
    // Filepath substring match
    const matches = reviews
      .map((entry, idx) => ({ entry, idx }))
      .filter(
        ({ entry }) => entry.filepath && entry.filepath.includes(identifier),
      );

    if (matches.length === 0) {
      console.error(
        `❌ No manual_review entry matches filepath "${identifier}".`,
      );
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`❌ Multiple entries match "${identifier}":`);
      matches.forEach(({ entry, idx }) => {
        console.error(`  [${idx}] ${entry.filepath}`);
      });
      console.error(
        `\nPlease use a more specific filepath or the numeric index.`,
      );
      process.exit(1);
    }
    targetIndex = matches[0].idx;
  }

  const entry = reviews[targetIndex];

  // Build the new operation
  const newOp = {
    filepath: entry.filepath,
    status: "apply",
    primary_genre: canonicalPrimary,
    secondary_genre: canonicalSecondary || "",
    confidence_1: 10,
    confidence_2: canonicalSecondary ? 10 : 0,
  };

  // Move: remove from manual_review, add to operations
  data.manual_review.splice(targetIndex, 1);
  if (!data.operations) data.operations = [];
  data.operations.push(newOp);

  saveData(data);

  const genreString = canonicalSecondary
    ? `${canonicalPrimary}; ${canonicalSecondary}`
    : canonicalPrimary;

  console.log(`\n✅ Resolved: ${entry.filepath}`);
  console.log(`   Genre:  ${genreString}`);
  console.log(
    `   Moved from manual_review[${targetIndex}] → operations[${data.operations.length - 1}]`,
  );
  console.log(
    `\n   ${data.manual_review.length} entries remaining in manual_review.`,
  );
}

// --- MAIN ---

const args = parseArgs(process.argv);

if (args.help || (!args.list && args.resolve === undefined)) {
  printUsage();
  process.exit(0);
}

if (args.list) {
  listReview();
} else if (args.resolve !== undefined) {
  if (!args.primary) {
    console.error("❌ --primary <genre> is required when resolving an entry.");
    console.error("   Run with --help to see available genres.");
    process.exit(1);
  }
  resolveEntry(args.resolve, args.primary, args.secondary || null);
}
