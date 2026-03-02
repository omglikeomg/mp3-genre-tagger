#!/usr/bin/env node
/**
 * verify-paths.js — Check that every filepath in pending_operations.json
 * points to a real file on disk.
 *
 * The music root is read from config.json → "musicDir" (defaults to "./Music").
 *
 * Usage:
 *   node scripts/verify-paths.js
 */

import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { MUSIC_DIR } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OPS_FILE = resolve(ROOT, "pending_operations.json");

// Resolve MUSIC_DIR to an absolute path so we can join relative track segments
// against it regardless of where the script is invoked from.
const MUSIC_ROOT = resolve(ROOT, MUSIC_DIR);

// The first path segment in every stored filepath is the music folder name
// (e.g. "Music" in "Music/Artist/track.mp3"). We strip it before joining with
// MUSIC_ROOT so the lookup works even when musicDir is an absolute path
// pointing somewhere outside the project root.
const MUSIC_FOLDER = basename(MUSIC_ROOT);

async function main() {
  const raw = await readFile(OPS_FILE, "utf-8");
  const pending = JSON.parse(raw);

  const entries = [
    ...(pending.operations ?? []).map((e) => ({
      section: "operations",
      fp: e.filepath,
    })),
    ...(pending.manual_review ?? []).map((e) => ({
      section: "manual_review",
      fp: e.filepath,
    })),
  ];

  let ok = 0;
  let missing = 0;
  const missingPaths = [];

  for (const { section, fp } of entries) {
    // Strip the leading music folder segment (e.g. "Music/") so we can
    // resolve the remainder against the configured MUSIC_ROOT.
    const normalized = fp.replace(/\\/g, "/");
    const prefix = MUSIC_FOLDER + "/";
    const relative = normalized.startsWith(prefix)
      ? normalized.slice(prefix.length)
      : normalized;
    const abs = resolve(MUSIC_ROOT, relative);
    try {
      await access(abs, constants.F_OK);
      ok++;
    } catch {
      missing++;
      missingPaths.push({ section, fp });
    }
  }

  const total = ok + missing;
  const pct = total ? ((ok / total) * 100).toFixed(1) : "0.0";

  console.log(`\n  Checked:  ${total} filepaths`);
  console.log(`  Found:    ${ok}`);
  console.log(`  Missing:  ${missing}`);
  console.log(`  Match:    ${pct}%\n`);

  if (missingPaths.length) {
    console.log("  Missing paths:");
    for (const { section, fp } of missingPaths.slice(0, 30)) {
      console.log(`    [${section}] ${fp}`);
    }
    if (missingPaths.length > 30) {
      console.log(`    ... and ${missingPaths.length - 30} more`);
    }
    console.log();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
