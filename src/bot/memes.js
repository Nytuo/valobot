// Picks the meme attached to reminders / flop messages.
// Discord embeds only render DIRECT image files. Page links (e.g. klipy.com/gifs/xxx) show "image failed to load",
// so a meme is resolved in this order:
//   1. a local file in assets/memes/<kind>/        -> uploaded as an attachment (most reliable)
//   2. a direct image URL (.gif/.png/.jpg/.webp)   -> embed image
//   3. any other https link                        -> posted as a plain link so Discord unfurls it
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const MEMES_DIR = path.join(__dirname, '../../assets/memes');
const IMAGE_FILE = /\.(gif|png|jpe?g|webp)$/i;
const IMAGE_URL = /\.(gif|png|jpe?g|webp)(\?[^\s]*)?$/i;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function localMemes(kind) {
  const dir = path.join(MEMES_DIR, kind);
  try {
    return fs.readdirSync(dir)
      .filter(file => IMAGE_FILE.test(file))
      .filter(file => fs.statSync(path.join(dir, file)).size <= MAX_FILE_BYTES)
      .map(file => path.join(dir, file));
  } catch {
    return [];
  }
}

// kind: 'flop' | 'reminder'. Env override: FLOP_MEME_URLS / REMINDER_MEME_URLS (comma separated https URLs)
function pickMeme(kind, defaultUrls = []) {
  const local = localMemes(kind);
  if (local.length > 0) {
    const file = pick(local);
    return { file: new AttachmentBuilder(file, { name: `meme_${Date.now()}${path.extname(file).toLowerCase()}` }) };
  }

  const fromEnv = (process.env[`${kind.toUpperCase()}_MEME_URLS`] || '')
    .split(',').map(u => u.trim()).filter(u => u.startsWith('https://'));
  const pool = (fromEnv.length > 0 ? fromEnv : defaultUrls).filter(u => u.startsWith('https://'));
  if (pool.length === 0) return {};

  const url = pick(pool);
  return IMAGE_URL.test(url) ? { imageUrl: url } : { linkUrl: url };
}

module.exports = { pickMeme };
