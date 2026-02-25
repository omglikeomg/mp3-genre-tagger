// MP3 Classifier — Shared Configuration
//
// This module reads optional per-machine settings from `config.json` at the
// project root and exports them for use by all scripts.
//
// To customise your setup, copy `config.example.json` to `config.json` and
// edit it.  That file is git-ignored, so it stays local to your machine.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve the project root regardless of where the script is invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'config.json');

const DEFAULT_MUSIC_DIR = './Music';

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`⚠️  Could not parse config.json: ${err.message}. Falling back to defaults.`);
    return {};
  }
}

const config = loadConfig();

/**
 * Absolute or relative path to the music library root.
 * Reads from config.json → "musicDir".
 * Defaults to "./Music" (relative to the project root / cwd).
 */
export const MUSIC_DIR = config.musicDir ?? DEFAULT_MUSIC_DIR;
