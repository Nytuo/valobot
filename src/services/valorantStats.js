// Valorant rank / match data through the HenrikDev unofficial API (https://docs.henrikdev.xyz).
// tracker.gg has no self-serve Valorant API and Riot's official one needs a production key, so
// this module is the only place that talks to the data provider: swap it to change provider.
const API_BASE = 'https://api.henrikdev.xyz';
const PLATFORM = 'pc';
const MIN_INTERVAL_MS = Number(process.env.HENRIK_MIN_INTERVAL_MS) || 2200; // free tier: ~30 req/min
const REQUEST_TIMEOUT_MS = 10000;
const RANK_CACHE_MS = 60 * 1000;

class StatsError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'rate_limited' | 'unauthorized' | 'unavailable'
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const isConfigured = () => Boolean(process.env.HENRIK_API_KEY);

// All calls go through one queue, spaced out to respect the provider's rate limit
let queue = Promise.resolve();
let lastCall = 0;
function throttled(task) {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return task();
  });
  queue = run.catch(() => {});
  return run;
}

function apiGet(pathname, query = {}) {
  return throttled(async () => {
    const url = new URL(API_BASE + pathname); // fixed host: user input only ever lands in encoded path segments
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: process.env.HENRIK_API_KEY, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new StatsError('unavailable');
    }
    if (res.status === 404) return null;
    if (res.status === 429) throw new StatsError('rate_limited');
    if (res.status === 401 || res.status === 403) throw new StatsError('unauthorized');
    if (!res.ok) throw new StatsError('unavailable');
    return res.json();
  });
}

const seg = (value) => encodeURIComponent(value);

const rankCache = new Map();

// Current competitive rank. Returns null when the Riot ID does not exist.
async function getRank(profile, { fresh = false } = {}) {
  const key = `${profile.region}:${profile.name}#${profile.tag}`.toLowerCase();
  const cached = rankCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < RANK_CACHE_MS) return cached.value;

  const body = await apiGet(`/valorant/v3/mmr/${seg(profile.region)}/${PLATFORM}/${seg(profile.name)}/${seg(profile.tag)}`);
  const current = body?.data?.current;
  if (!body || !current) return null;

  const value = {
    tier: String(current.tier?.name || 'Unranked'),
    rr: Number.isFinite(current.rr) ? current.rr : null,
    elo: Number.isFinite(current.elo) ? current.elo : null,
    lastChange: Number.isFinite(current.last_change) ? current.last_change : null,
    puuid: typeof body.data?.account?.puuid === 'string' ? body.data.account.puuid : null
  };
  rankCache.set(key, { at: Date.now(), value });
  return value;
}

function findPlayer(match, profile) {
  const name = profile.name.toLowerCase();
  const tag = profile.tag.toLowerCase();
  return (match.players || []).find(p =>
    (profile.puuid && p.puuid === profile.puuid) ||
    (String(p.name || '').toLowerCase() === name && String(p.tag || '').toLowerCase() === tag)
  ) || null;
}

const num = (v) => (Number.isFinite(v) ? v : 0);

// Recent matches of a player that started after `sinceMs`, reduced to the numbers we display
async function getMatchesSince(profile, sinceMs) {
  const body = await apiGet(
    `/valorant/v4/matches/${seg(profile.region)}/${PLATFORM}/${seg(profile.name)}/${seg(profile.tag)}`,
    { size: 10 }
  );
  if (!body || !Array.isArray(body.data)) return [];

  const out = [];
  for (const match of body.data) {
    const startedAt = Date.parse(match.metadata?.started_at);
    if (!Number.isFinite(startedAt) || startedAt < sinceMs) continue;
    const me = findPlayer(match, profile);
    if (!me) continue;

    const rounds = Array.isArray(match.rounds) ? match.rounds.length : 0;
    const team = (match.teams || []).find(t => t.team_id === me.team_id);
    const stats = me.stats || {};
    const shots = num(stats.headshots) + num(stats.bodyshots) + num(stats.legshots);

    out.push({
      matchId: String(match.metadata?.match_id || `${profile.name}${startedAt}`),
      startedAt,
      map: String(match.metadata?.map?.name || '?').slice(0, 30),
      queue: String(match.metadata?.queue?.name || match.metadata?.queue?.id || '').slice(0, 30),
      agent: String(me.agent?.name || '').slice(0, 30),
      won: typeof team?.won === 'boolean' ? team.won : null,
      score: team?.rounds ? `${num(team.rounds.won)}-${num(team.rounds.lost)}` : null,
      kills: num(stats.kills),
      deaths: num(stats.deaths),
      assists: num(stats.assists),
      rounds,
      acs: rounds > 0 ? Math.round(num(stats.score) / rounds) : 0,
      adr: rounds > 0 ? Math.round(num(stats.damage?.dealt) / rounds) : 0,
      headshots: num(stats.headshots),
      shots
    });
  }
  return out;
}

module.exports = { StatsError, isConfigured, getRank, getMatchesSince };
