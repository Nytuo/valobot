// Valorant rank / match data through the HenrikDev unofficial API (https://docs.henrikdev.xyz).
// tracker.gg has no self-serve Valorant API and Riot's official one needs a production key, so
// this module is the only place that talks to the data provider: swap it to change provider.
const API_BASE = 'https://api.henrikdev.xyz';
const PLATFORM = 'pc';
const MIN_INTERVAL_MS = Number(process.env.HENRIK_MIN_INTERVAL_MS) || 3000; // minimum gap; weighted quota is also checked from response headers
const REQUEST_TIMEOUT_MS = 10000;
const RANK_CACHE_MS = 60 * 1000;
const MAX_RATE_LIMIT_RETRY_MS = 60 * 1000;
const MAX_MATCHES_PER_HISTORY = 5;

class StatsError extends Error {
  constructor(code, retryAfterMs = 0) {
    super(code);
    this.code = code; // 'rate_limited' | 'unauthorized' | 'unavailable'
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const isConfigured = () => Boolean(process.env.HENRIK_API_KEY);

// All calls go through one queue, spaced out to respect the provider's rate limit
let queue = Promise.resolve();
let lastCall = 0;
let rateLimitedUntil = 0;
let quotaLimit = null;
let quotaRemaining = null;
let quotaResetAt = 0;

async function waitForQuota(estimatedCredits) {
  if (quotaLimit === null || quotaRemaining === null) return;
  if (quotaResetAt <= Date.now()) {
    quotaRemaining = quotaLimit;
    quotaResetAt = 0;
  }

  if (estimatedCredits > quotaLimit || quotaRemaining >= estimatedCredits) return;

  const resetWait = quotaResetAt - Date.now();
  if (resetWait > 0) await sleep(resetWait + 250);
  quotaRemaining = quotaLimit;
  quotaResetAt = 0;
}

function observeQuota(res) {
  const limit = Number(res.headers.get('x-ratelimit-limit'));
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)) return;

  quotaLimit = limit;
  quotaRemaining = Math.max(0, remaining);
  quotaResetAt = Number.isFinite(reset) && reset > 0
    ? Date.now() + reset * 1000
    : (quotaRemaining < quotaLimit ? Date.now() + 60 * 1000 : Date.now());
}

function estimatedCredits(pathname, query) {
  if (!pathname.includes('/matches/')) return 2; // API request + one underlying Riot lookup
  const size = Number(query.size) || MAX_MATCHES_PER_HISTORY;
  return 2 + Math.max(1, Math.ceil(size)); // API request + history + up to `size` match lookups
}

function throttled(task, credits) {
  const run = queue.then(async () => {
    const remainingCooldown = rateLimitedUntil - Date.now();
    if (remainingCooldown > 0) throw new StatsError('rate_limited', remainingCooldown);

    await waitForQuota(credits);
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return task();
  });
  queue = run.catch(() => {});
  return run;
}

function getRetryAfterMs(res) {
  const retryAfter = res.headers.get('retry-after');
  const seconds = Number(retryAfter);
  if (retryAfter && Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);

  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) return Math.max(1000, retryAt - Date.now());

  const reset = res.headers.get('x-ratelimit-reset');
  const resetSeconds = Number(reset);
  if (reset !== null && Number.isFinite(resetSeconds)) return Math.max(1000, resetSeconds * 1000);
  return 60 * 1000;
}

function markRateLimited(res) {
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + getRetryAfterMs(res));
  return new StatsError('rate_limited', rateLimitedUntil - Date.now());
}

function apiGet(pathname, query = {}) {
  return throttled(async () => {
    const url = new URL(API_BASE + pathname); // fixed host: user input only ever lands in encoded path segments
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

    const request = async () => {
      try {
        return await fetch(url, {
          headers: { Authorization: process.env.HENRIK_API_KEY, Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
      } catch {
        throw new StatsError('unavailable');
      }
    };

    let res = await request();
    observeQuota(res);
    if (res.status === 429) {
      const rateLimitError = markRateLimited(res);
      if (rateLimitError.retryAfterMs > MAX_RATE_LIMIT_RETRY_MS) throw rateLimitError;

      await sleep(rateLimitError.retryAfterMs);
      lastCall = Date.now();
      res = await request();
      observeQuota(res);
      if (res.status === 429) throw markRateLimited(res);
    }

    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new StatsError('unauthorized');
    if (!res.ok) throw new StatsError('unavailable');
    return res.json();
  }, estimatedCredits(pathname, query));
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

function profileMatchesInHistory(body, profiles, sinceMs) {
  const matchesByProfile = new Map(profiles.map(profile => [profile, []]));
  if (!body || !Array.isArray(body.data)) return matchesByProfile;

  for (const match of body.data) {
    const startedAt = Date.parse(match.metadata?.started_at);
    if (!Number.isFinite(startedAt) || startedAt < sinceMs) continue;

    for (const profile of profiles) {
      const me = findPlayer(match, profile);
      if (!me) continue;

      const rounds = Array.isArray(match.rounds) ? match.rounds.length : 0;
      const team = (match.teams || []).find(t => t.team_id === me.team_id);
      const stats = me.stats || {};
      const shots = num(stats.headshots) + num(stats.bodyshots) + num(stats.legshots);

      matchesByProfile.get(profile).push({
        matchId: String(match.metadata?.match_id || `${profile.name}${startedAt}`),
        startedAt,
        map: String(match.metadata?.map?.name || '?').slice(0, 30),
        queueId: String(match.metadata?.queue?.id || '').toLowerCase(),
        queue: String(match.metadata?.queue?.name || match.metadata?.queue?.id || '').slice(0, 30),
        agent: String(me.agent?.name || '').slice(0, 30),
        agentIcon: /^[0-9a-f-]{36}$/i.test(String(me.agent?.id || ''))
          ? `https://media.valorant-api.com/agents/${me.agent.id}/displayicon.png`
          : null,
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
  }
  return matchesByProfile;
}

// Each returned match contains stats for all players in that match, not only the requested account.
async function getSquadMatchesSince(anchorProfile, squadProfiles, sinceMs) {
  const body = await apiGet(
    `/valorant/v4/matches/${seg(anchorProfile.region)}/${PLATFORM}/${seg(anchorProfile.name)}/${seg(anchorProfile.tag)}`,
    { size: MAX_MATCHES_PER_HISTORY }
  );
  return profileMatchesInHistory(body, squadProfiles, sinceMs);
}

// Recent matches for one player, reduced to that player's displayed stats.
async function getMatchesSince(profile, sinceMs) {
  const matchesByProfile = await getSquadMatchesSince(profile, [profile], sinceMs);
  return matchesByProfile.get(profile) || [];
}

module.exports = { StatsError, isConfigured, getRank, getMatchesSince, getSquadMatchesSince, MAX_MATCHES_PER_HISTORY };
