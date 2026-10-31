// Discord user -> Riot ID links. Opt-in only: a player appears in stats reports once they linked themselves.
const { loadProfiles, saveProfiles } = require('./storage');

const REGIONS = ['eu', 'na', 'ap', 'kr', 'latam', 'br'];
const DEFAULT_REGION = REGIONS.includes((process.env.VALORANT_REGION || '').toLowerCase())
  ? process.env.VALORANT_REGION.toLowerCase()
  : 'eu';

const profiles = Object.assign(Object.create(null), loadProfiles());

// "Name#TAG" -> { name, tag } or null. Strips hidden characters, enforces Riot's length rules.
function parseRiotId(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '')
    .trim();
  const idx = cleaned.lastIndexOf('#');
  if (idx < 1) return null;
  const name = cleaned.slice(0, idx).trim();
  const tag = cleaned.slice(idx + 1).trim();
  if (name.length < 3 || name.length > 16) return null;
  if (!/^[A-Za-z0-9]{3,5}$/.test(tag)) return null;
  if (/[\/\\?%<>`*_~|@]/.test(name)) return null;
  return { name, tag };
}

const isUserId = (id) => typeof id === 'string' && /^\d{5,25}$/.test(id);

function getProfile(userId) {
  return isUserId(userId) && Object.prototype.hasOwnProperty.call(profiles, userId) ? profiles[userId] : null;
}

function setProfile(userId, { name, tag, region, puuid = null, source = 'manual' }) {
  if (!isUserId(userId)) throw new Error('Invalid user id');
  profiles[userId] = {
    name,
    tag,
    region: REGIONS.includes(region) ? region : DEFAULT_REGION,
    puuid,
    source,
    linkedAt: Date.now()
  };
  saveProfiles(profiles);
  return profiles[userId];
}

function removeProfile(userId) {
  if (!getProfile(userId)) return false;
  delete profiles[userId];
  saveProfiles(profiles);
  return true;
}

const riotLabel = (profile) => `${profile.name}#${profile.tag}`;

// Public tracker.gg page of a player (we link to it, we do not scrape it)
const trackerUrl = (profile) =>
  `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(riotLabel(profile))}/overview`;

module.exports = { REGIONS, DEFAULT_REGION, parseRiotId, getProfile, setProfile, removeProfile, riotLabel, trackerUrl };
