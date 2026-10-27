const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadSessions() {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse sessions.json, starting empty:', err.message);
    return {};
  }
}

function saveSessions(sessions) {
  ensureDataDir();
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save sessions.json:', err.message);
  }
}

module.exports = {
  loadSessions,
  saveSessions
};
