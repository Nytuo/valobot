const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function readJsonFile(file, label) {
  ensureDataDir();
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('unexpected format');
    return parsed;
  } catch (err) {
    console.error(`Failed to parse ${label}, starting empty:`, err.message);
    // Keep the unreadable file instead of silently overwriting it on the next save
    try {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
    } catch (copyErr) {
      console.error(`Could not back up corrupted ${label}:`, copyErr.message);
    }
    return {};
  }
}

// Atomic write (temp file + rename) with owner-only permissions, so a crash never leaves a half-written file
function writeJsonFile(file, data, label) {
  ensureDataDir();
  const tmpFile = `${file}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpFile, file);
  } catch (err) {
    console.error(`Failed to save ${label}:`, err.message);
  }
}

const loadSessions = () => readJsonFile(SESSIONS_FILE, 'sessions.json');
const saveSessions = (sessions) => writeJsonFile(SESSIONS_FILE, sessions, 'sessions.json');
const loadProfiles = () => readJsonFile(PROFILES_FILE, 'profiles.json');
const saveProfiles = (profiles) => writeJsonFile(PROFILES_FILE, profiles, 'profiles.json');

module.exports = {
  loadSessions,
  saveSessions,
  loadProfiles,
  saveProfiles
};
