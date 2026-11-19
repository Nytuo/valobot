const assert = require('node:assert/strict');

async function testMockRateLimit() {
  process.env.HENRIK_API_KEY = 'test-key';
  process.env.HENRIK_MIN_INTERVAL_MS = '1';

  let fetchCalls = 0;
  const mockResponse = (status, remaining, reset, jsonBody = null) => ({
    status,
    ok: status < 400,
    headers: {
      get: name => ({
        'x-ratelimit-limit': '30',
        'x-ratelimit-remaining': String(remaining),
        'x-ratelimit-reset': String(reset)
      }[name.toLowerCase()] ?? null)
    },
    json: async () => jsonBody || ({
      data: {
        current: { tier: { name: 'Gold 1' }, rr: 25, elo: 1000 },
        account: { puuid: 'test-puuid' }
      }
    })
  });
  global.fetch = async () => {
    fetchCalls++;
    if (fetchCalls === 1) return mockResponse(429, 0, 1);
    if (fetchCalls === 2) return mockResponse(200, 28, 60);
    if (fetchCalls === 3) return mockResponse(200, 5, 1);
    return mockResponse(200, 28, 60, { data: [] });
  };

  const valorantStats = require('./src/services/valorantStats');
  const profile = { region: 'eu', name: 'RateLimitTest', tag: 'TEST' };

  const rank = await valorantStats.getRank(profile, { fresh: true });
  assert.equal(rank.tier, 'Gold 1');
  assert.equal(fetchCalls, 2, 'A 429 should wait for reset and retry once');

  await valorantStats.getRank(profile, { fresh: true });
  assert.equal(fetchCalls, 3);

  const startedAt = Date.now();
  await valorantStats.getMatchesSince(profile, Date.now());
  assert.ok(Date.now() - startedAt >= 1000, 'Match request should wait when its estimated cost exceeds remaining quota');
  assert.equal(fetchCalls, 4);

  const matchStartedAt = Date.now() - 60 * 1000;
  const teammate = { region: 'eu', name: 'Teammate', tag: 'TEAM' };
  const matchBody = {
    data: [{
      metadata: {
        match_id: 'test-match',
        started_at: new Date(matchStartedAt).toISOString(),
        map: { name: 'Ascent' },
        queue: { id: 'competitive', name: 'Competitive' }
      },
      players: [
        {
          name: profile.name,
          tag: profile.tag,
          team_id: 'Red',
          agent: { name: 'Jett' },
          stats: { kills: 20, deaths: 15, assists: 5, score: 4000, damage: { dealt: 2200 } }
        },
        {
          name: teammate.name,
          tag: teammate.tag,
          team_id: 'Red',
          agent: { name: 'Sova' },
          stats: { kills: 12, deaths: 16, assists: 8, score: 3000, damage: { dealt: 1800 } }
        }
      ],
      rounds: Array(24).fill({}),
      teams: [
        { team_id: 'Red', won: true, rounds: { won: 13, lost: 11 } },
        { team_id: 'Blue', won: false, rounds: { won: 11, lost: 13 } }
      ]
    }]
  };
  global.fetch = async () => {
    fetchCalls++;
    return mockResponse(200, 16, 60, matchBody);
  };
  let historyUrl;
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    historyUrl = new URL(input);
    return originalFetch(input, init);
  };
  const squadMatches = await valorantStats.getSquadMatchesSince(
    profile,
    [profile, teammate],
    matchStartedAt - 1000
  );
  assert.equal(fetchCalls, 5, 'One history request should cover every player in its match payload');
  assert.equal(historyUrl.searchParams.get('size'), '5', 'History calls should be capped at five matches');
  assert.equal(valorantStats.MAX_MATCHES_PER_HISTORY, 5);
  assert.equal(squadMatches.get(profile)[0].kills, 20);
  assert.equal(squadMatches.get(teammate)[0].kills, 12);
  console.log('Stats API quota budgeting and retry test passed');
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] || null;
}

function options(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

const HISTORY_GAP_MS = 50 * 60 * 1000;
const MAX_MATCH_HISTORY_QUERIES = 3;

function hasHistoryGap(matchesByProfile, sinceMs, untilMs) {
  const startedAt = [...new Set(
    [...matchesByProfile.values()].flatMap(matches => [...matches.values()].map(match => match.startedAt))
  )].sort((a, b) => a - b);

  let previous = sinceMs;
  for (const time of startedAt) {
    if (time - previous >= HISTORY_GAP_MS) return true;
    previous = time;
  }
  return Math.max(sinceMs, untilMs) - previous >= HISTORY_GAP_MS;
}

function summarizePlayer(profile, rank, matches) {
  const competitive = matches.filter(match => match.queueId === 'competitive');
  const wins = competitive.filter(match => match.won === true).length;
  const losses = competitive.filter(match => match.won === false).length;
  const totals = competitive.reduce((result, match) => ({
    kills: result.kills + match.kills,
    deaths: result.deaths + match.deaths,
    assists: result.assists + match.assists
  }), { kills: 0, deaths: 0, assists: 0 });

  return {
    riotId: `${profile.name}#${profile.tag}`,
    rank: rank ? { tier: rank.tier, rr: rank.rr, elo: rank.elo } : null,
    competitiveGames: competitive.length,
    wins,
    losses,
    kills: totals.kills,
    deaths: totals.deaths,
    assists: totals.assists,
    kda: ((totals.kills + totals.assists) / Math.max(1, totals.deaths)).toFixed(2)
  };
}

async function testLiveStats() {
  require('dotenv').config();
  if (!process.env.HENRIK_API_KEY) {
    throw new Error('HENRIK_API_KEY absent. Configure-la dans .env sans la partager.');
  }

  const riotIds = options('riot-id');
  if (riotIds.length === 0) {
    throw new Error('Ajoute un ou plusieurs comptes : npm run test:stats:live -- --riot-id "Pseudo#TAG" [--riot-id "Autre#TAG"] [--region eu]');
  }
  const region = option('region') || process.env.VALORANT_REGION || 'eu';
  const profiles = riotIds.map(riotId => {
    const separator = riotId.lastIndexOf('#');
    if (separator <= 0 || separator === riotId.length - 1) {
      throw new Error(`Riot ID invalide : ${riotId}. Format attendu : Pseudo#TAG.`);
    }
    return {
      name: riotId.slice(0, separator),
      tag: riotId.slice(separator + 1),
      region
    };
  });
  const realFetch = global.fetch;
  let requestNumber = 0;
  let totalRequestMs = 0;
  let previousQuotaRemaining = null;
  let observedQuotaDecrease = 0;

  global.fetch = async (input, init) => {
    const url = new URL(input);
    const startedAt = Date.now();
    const estimatedCredits = url.pathname.includes('/matches/')
      ? 2 + (Number(url.searchParams.get('size')) || 5)
      : 2;
    requestNumber++;
    console.log(`[API ${requestNumber}] -> ${init?.method || 'GET'} ${url.pathname}${url.search}`);
    console.log(`[API ${requestNumber}] Coût maximal estimé : ${estimatedCredits} crédits`);
    try {
      const response = await realFetch(input, init);
      const duration = Date.now() - startedAt;
      totalRequestMs += duration;
      console.log(`[API ${requestNumber}] <- HTTP ${response.status} en ${duration} ms`);
      const remainingHeader = response.headers.get('x-ratelimit-remaining');
      const currentRemaining = Number(remainingHeader);
      if (remainingHeader !== null && Number.isFinite(currentRemaining)) {
        if (previousQuotaRemaining !== null && currentRemaining < previousQuotaRemaining) {
          const decrease = previousQuotaRemaining - currentRemaining;
          observedQuotaDecrease += decrease;
          console.log(`[API ${requestNumber}] Baisse de quota observée : ${decrease} crédit(s), usages globaux inclus`);
        }
        previousQuotaRemaining = currentRemaining;
      }
      const rateHeaders = [
        'RateLimit-Policy',
        'RateLimit',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-RateLimit-Bucket',
        'Retry-After',
        'X-Request-ID',
        'X-Cache-Status',
        'X-Cache-TTL'
      ].map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null);
      if (rateHeaders.length > 0) {
        console.log(`[API ${requestNumber}] Quota/cache: ${rateHeaders.map(([name, value]) => `${name}=${value}`).join(' | ')}`);
      }
      return response;
    } catch (err) {
      const duration = Date.now() - startedAt;
      totalRequestMs += duration;
      console.log(`[API ${requestNumber}] <- échec après ${duration} ms (${err.message})`);
      throw err;
    }
  };

  const valorantStats = require('./src/services/valorantStats');
  const startedAt = Date.now();
  const since = startedAt - 7 * 24 * 60 * 60 * 1000;
  const ranks = new Map();
  const matchesByProfile = new Map(profiles.map(profile => [profile, new Map()]));
  const errors = [];
  let historiesQueried = 0;
  try {
    console.log(`Diagnostic live pour ${profiles.length} joueur(s), région ${region}.`);
    console.log('Rangs : un appel par joueur. Matchs : joueur de référence puis au plus deux recherches de secours si un trou de 50 min subsiste.');
    for (const profile of profiles) {
      const riotId = `${profile.name}#${profile.tag}`;
      try {
        ranks.set(profile, await valorantStats.getRank(profile, { fresh: true }));
      } catch (err) {
        errors.push({
          riotId,
          phase: 'rank',
          error: err.code || 'unavailable',
          retryAfterSeconds: err.retryAfterMs
            ? Math.ceil(err.retryAfterMs / 1000)
            : null
        });
        break;
      }
    }

    if (errors.length === 0 && profiles.length > 0) {
      for (const anchor of profiles) {
        if (historiesQueried > 0 && !hasHistoryGap(matchesByProfile, since, Date.now())) break;
        try {
          const history = await valorantStats.getSquadMatchesSince(anchor, profiles, since);
          for (const profile of profiles) {
            for (const match of history.get(profile) || []) {
              matchesByProfile.get(profile).set(match.matchId, match);
            }
          }
          historiesQueried++;
        } catch (err) {
          errors.push({
            riotId: `${anchor.name}#${anchor.tag}`,
            phase: 'matches',
            error: err.code || 'unavailable',
            retryAfterSeconds: err.retryAfterMs
              ? Math.ceil(err.retryAfterMs / 1000)
              : null
          });
          break;
        }
        if (historiesQueried >= MAX_MATCH_HISTORY_QUERIES) break;
      }
    }

    for (const error of errors) {
      console.error(`Arrêt du lot (${error.phase}) sur ${error.riotId} : ${error.error}` +
        (error.retryAfterSeconds ? `, réessaie dans ${error.retryAfterSeconds}s.` : '.'));
    }
    const results = profiles.map(profile =>
      summarizePlayer(profile, ranks.get(profile), [...matchesByProfile.get(profile).values()])
    );
    const successful = results.filter(result => !result.error);
    const squadTotals = successful.reduce((total, result) => ({
      competitiveGames: total.competitiveGames + result.competitiveGames,
      wins: total.wins + result.wins,
      losses: total.losses + result.losses,
      kills: total.kills + result.kills,
      deaths: total.deaths + result.deaths,
      assists: total.assists + result.assists
    }), { competitiveGames: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0 });

    console.log('\nRésumé synthétique :');
    console.log(JSON.stringify({
      region,
      playersSucceeded: successful.length,
      playersAttempted: results.length,
      players: results,
      matchHistoriesQueried: historiesQueried,
      estimatedMaxCreditsForBatch: profiles.length * 2 + historiesQueried * 7,
      estimatedMaxCreditsIfAllFallbacksNeeded: profiles.length * 2 + Math.min(profiles.length, MAX_MATCH_HISTORY_QUERIES) * 7,
      observedQuotaDecrease,
      errors,
      squadTotals: {
        ...squadTotals,
        kda: ((squadTotals.kills + squadTotals.assists) / Math.max(1, squadTotals.deaths)).toFixed(2)
      },
      requestsSent: requestNumber,
      apiTimeMs: totalRequestMs,
      totalTimeMs: Date.now() - startedAt
    }, null, 2));
    if (errors.length > 0) process.exitCode = 1;
  } finally {
    global.fetch = realFetch;
  }
}

const run = process.argv.includes('--live') ? testLiveStats : testMockRateLimit;
run().catch(err => {
  console.error(`Test stats échoué : ${err.code || err.message}`);
  process.exitCode = 1;
});
