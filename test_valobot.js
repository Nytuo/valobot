const assert = require('assert');
const sessionManager = require('./src/services/sessionManager');
const { buildSessionMessagePayload } = require('./src/bot/embedBuilder');
const { renderSessionBanner } = require('./src/bot/stampRenderer');

console.log('🧪 Starting Valobot Comprehensive Test Suite...\n');

// Test 1: Session creation and sender auto-vote
console.log('Test 1: Creating session & checking auto-vote...');
const session = sessionManager.createSession({
  creator: { id: 'host_42', username: 'HostPlayer', displayName: 'HostPlayer' },
  partySize: 5,
  partyTime: 'in 2h',
  voteDeadline: 'in 1h',
  targetRoleId: 'role_valo',
  targetRoleName: '@Valorant',
  targetMemberIds: ['host_42', 'player_2', 'player_3', 'player_4', 'player_5', 'player_6', 'player_7'],
  note: 'Ascendant 5-Stack Grind'
});

assert.strictEqual(session.partySize, 5);
assert.strictEqual(session.status, 'active');
assert.ok(session.votes['host_42'], 'Host should be auto-voted');
assert.strictEqual(session.votes['host_42'].status, 'sure');
console.log('✅ Test 1 passed: Host auto-voted as "sure"');

// Test 2: Casting votes and Team 1 roster filling
console.log('\nTest 2: Casting votes for players 2, 3, 4, 5...');
sessionManager.castVote(session.id, { id: 'player_2', username: 'Player2' }, 'sure');
sessionManager.castVote(session.id, { id: 'player_3', username: 'Player3' }, 'sure');
sessionManager.castVote(session.id, { id: 'player_4', username: 'Player4' }, 'sure');
sessionManager.castVote(session.id, { id: 'player_5', username: 'Player5' }, 'sure');

let roster = sessionManager.calculateRosters(session);
assert.strictEqual(roster.team1.length, 5, 'Team 1 should have exactly 5 players');
assert.strictEqual(roster.team1[0].userId, 'host_42', 'First slot is host');
assert.strictEqual(roster.team1[4].userId, 'player_5', 'Fifth slot is player_5');
console.log('✅ Test 2 passed: Team 1 has 5 locked players');

// Test 3: Overflow into Team 2 and Backups
console.log('\nTest 3: Adding 6 more "sure" players to test Team 2 formation...');
for (let i = 6; i <= 11; i++) {
  sessionManager.castVote(session.id, { id: `player_${i}`, username: `Player${i}` }, 'sure');
}
roster = sessionManager.calculateRosters(session);
assert.strictEqual(roster.team1.length, 5, 'Team 1 still has 5');
assert.strictEqual(roster.team2.length, 5, 'Team 2 formed with 5 players!');
assert.strictEqual(roster.teams.length, 3, 'Team 3 has the 11th player in progress');
console.log('✅ Test 3 passed: Team 2 automatically created with 5 players');

// Test 4: "If a last" fill logic
console.log('\nTest 4: Testing "If a last" filler logic...');
// Create a separate session with 4 players and 1 "if a last"
const s2 = sessionManager.createSession({
  creator: { id: 's2_host', username: 'Leader' },
  partySize: 5,
  partyTime: '22:00',
  voteDeadline: '21:30'
});
sessionManager.castVote(s2.id, { id: 's2_p2', username: 'P2' }, 'sure');
sessionManager.castVote(s2.id, { id: 's2_p3', username: 'P3' }, 'sure');
sessionManager.castVote(s2.id, { id: 's2_p4', username: 'P4' }, 'sure');
sessionManager.castVote(s2.id, { id: 's2_filler', username: 'Filler' }, 'if_last');

let r2 = sessionManager.calculateRosters(s2);
assert.strictEqual(r2.team1.length, 5, 'Team 1 should be completed to 5 with the "if_last" player');
assert.strictEqual(r2.team1[4].userId, 's2_filler', 'Filler filled the 5th spot');
console.log('✅ Test 4 passed: "If a last" voter automatically completed 5-stack');

// Test 5: Host removing / changing vote
console.log('\nTest 5: Testing vote change and removal...');
sessionManager.castVote(s2.id, { id: 's2_host', username: 'Leader' }, 'maybe');
assert.strictEqual(s2.votes['s2_host'].status, 'maybe');

sessionManager.castVote(s2.id, { id: 's2_host', username: 'Leader' }, 'remove');
assert.strictEqual(s2.votes['s2_host'], undefined, 'Host vote removed');
console.log('✅ Test 5 passed: Vote updated to maybe and removed');

// Test 6: Cancellation and Diagonal CANCELLED stamp
console.log('\nTest 6: Cancelling session and generating CANCELLED stamp banner...');
sessionManager.cancelSession(session.id, { id: 'host_42', username: 'HostPlayer' });
assert.strictEqual(session.status, 'cancelled');

const cancelledBannerBuffer = renderSessionBanner(session, roster, true);
assert.ok(cancelledBannerBuffer && cancelledBannerBuffer.length > 1000, 'Stamp buffer generated');
console.log(`✅ Test 6 passed: CANCELLED stamp generated (${cancelledBannerBuffer.length} bytes)`);

// Test 7: Discord Embed Builder payload verification
console.log('\nTest 7: Verifying Discord Embed & ActionRows payload...');
const discordPayload = buildSessionMessagePayload(session, roster, 'https://valobot.example.com');
assert.ok(discordPayload.embeds.length === 1, 'Has embed');
assert.ok(discordPayload.components.length === 2, 'Has 2 action rows');
assert.ok(discordPayload.files.length === 1, 'Has banner attachment');
assert.ok(discordPayload.embeds[0].data.title.includes('CANCELLED'), 'Title indicates cancelled');
console.log('✅ Test 7 passed: Discord payload generated with buttons and attachments');

// Test 8: Timezone parsing & formatting
console.log('\nTest 8: Verifying Timezone parsing and formatting...');
const refDate = new Date('2026-10-28T17:00:00.000Z');
const parsedCet = sessionManager.parseTimeString('21:00 CET', refDate);
const parsedUtc = sessionManager.parseTimeString('21:00 UTC', refDate);
assert.strictEqual(parsedCet.toISOString(), '2026-10-28T20:00:00.000Z', '21:00 CET should be 20:00:00 UTC');
assert.strictEqual(parsedUtc.toISOString(), '2026-10-28T21:00:00.000Z', '21:00 UTC should be 21:00:00 UTC');
console.log('✅ Test 8 passed: Timezone parsing correctly converts CET and UTC');

// Test 9: Unlogged web vote prevention & purge
console.log('\nTest 9: Testing unlogged web vote rejection and purge...');
const testSession = sessionManager.createSession({
  creator: { id: 'auth_host', username: 'AuthHost' },
  partySize: 5,
  partyTime: 'in 1h'
});

// Voting from web without logged-in Discord user should fail
assert.throws(() => {
  sessionManager.castVote(testSession.id, { id: 'web_abc12', username: 'Web Player' }, 'sure', { source: 'web' });
}, /Authentication required/, 'Should reject unauthenticated web votes');

// Inject a mock unlogged vote manually to test purgeUnloggedVotes
testSession.votes['web_ghost'] = {
  userId: 'web_ghost',
  username: 'Web Player',
  status: 'sure'
};
assert.ok(testSession.votes['web_ghost'], 'Ghost vote added');
const purgedCount = sessionManager.purgeUnloggedVotes();
assert.strictEqual(testSession.votes['web_ghost'], undefined, 'Ghost vote should be purged');
assert.ok(purgedCount >= 1, 'Should report purged count');
console.log('✅ Test 9 passed: Unlogged web votes rejected and purged');

// Test 10: 30-minute prior reminder ping for unresponsive channel members
(async () => {
  console.log('\nTest 10: Testing 30-min prior reminder and unresponsive user detection...');
  const reminderSession = sessionManager.createSession({
    creator: { id: 'reminder_host', username: 'Host' },
    partySize: 5,
    partyTime: 'in 2h',
    targetMemberIds: ['reminder_host', 'user_a', 'user_b', 'user_c']
  });

  // user_a votes 'sure'
  sessionManager.castVote(reminderSession.id, { id: 'user_a', username: 'UserA' }, 'sure');

  // Mock Discord client and channel
  const mockChannel = {
    isTextBased: () => true,
    members: new Map([
      ['user_a', { user: { id: 'user_a', bot: false } }],
      ['user_b', { user: { id: 'user_b', bot: false } }],
      ['user_c', { user: { id: 'user_c', bot: false } }],
      ['user_d', { user: { id: 'user_d', bot: false } }],
      ['bot_user', { user: { id: 'bot_user', bot: true } }]
    ]),
    messages: {
      fetch: async () => new Map()
    }
  };

  const mockClient = {
    user: { id: 'valobot_id' },
    channels: {
      fetch: async () => mockChannel
    }
  };

  const { getUnresponsiveChannelMembers } = require('./src/bot/handlers');
  const unresponsive = await getUnresponsiveChannelMembers(mockClient, reminderSession, mockChannel);

  // Host and user_a voted. bot_user is bot. valobot_id is bot.
  // Unresponsive should be user_b, user_c, and user_d!
  assert.ok(!unresponsive.includes('reminder_host'), 'Host should not be marked unresponsive');
  assert.ok(!unresponsive.includes('user_a'), 'Voted user should not be marked unresponsive');
  assert.ok(!unresponsive.includes('bot_user'), 'Bots should not be marked unresponsive');
  assert.ok(unresponsive.includes('user_b'), 'user_b should be unresponsive');
  assert.ok(unresponsive.includes('user_c'), 'user_c should be unresponsive');
  assert.ok(unresponsive.includes('user_d'), 'user_d should be unresponsive');

  // Test reminder event triggering
  let reminderFired = false;
  sessionManager.once('sessionReminder', (s) => {
    if (s.id === reminderSession.id) reminderFired = true;
  });
  sessionManager.triggerReminder(reminderSession.id);
  assert.strictEqual(reminderFired, true, 'Reminder event should fire');
  assert.strictEqual(reminderSession.reminderSent, true, 'reminderSent flag should be set');

  console.log('✅ Test 10 passed: 30m prior reminder and unresponsive user detection verified');

  // Test 11: Customizable ping target and reminder prior settings
  console.log('\nTest 11: Testing customizable ping target and reminder prior...');
  const { parsePingSettingsInput } = require('./src/bot/handlers');

  // Test modal input parsing
  const opt1 = parsePingSettingsInput('only on time, 15m');
  assert.strictEqual(opt1.pingTarget, 'only_on_time');
  assert.strictEqual(opt1.reminderPrior, '15m');

  const opt2 = parsePingSettingsInput('role, 1h');
  assert.strictEqual(opt2.pingTarget, 'role');
  assert.strictEqual(opt2.reminderPrior, '1h');

  const opt3 = parsePingSettingsInput('none, off');
  assert.strictEqual(opt3.pingTarget, 'none');
  assert.strictEqual(opt3.reminderPrior, 'off');

  const opt4 = parsePingSettingsInput('');
  assert.strictEqual(opt4.pingTarget, 'everyone');
  assert.strictEqual(opt4.reminderPrior, '30m');

  // Test session creation with custom pingTarget and reminderPrior
  const customSession = sessionManager.createSession({
    creator: { id: 'custom_host', username: 'CustomHost' },
    partySize: 5,
    partyTime: 'in 3h',
    pingTarget: 'only_on_time',
    reminderPrior: '15m'
  });
  assert.strictEqual(customSession.pingTarget, 'only_on_time');
  assert.strictEqual(customSession.reminderPrior, '15m');

  // Test session with disabled reminder (off)
  const silentSession = sessionManager.createSession({
    creator: { id: 'silent_host', username: 'SilentHost' },
    partySize: 5,
    partyTime: 'in 2h',
    pingTarget: 'none',
    reminderPrior: 'off'
  });
  assert.strictEqual(silentSession.pingTarget, 'none');
  assert.strictEqual(silentSession.reminderPrior, 'off');
  assert.ok(!sessionManager.reminderTimers.has(silentSession.id), 'Disabled reminder should not schedule a timer');

  console.log('✅ Test 11 passed: Custom ping target and reminder prior settings verified');

  console.log('\n🎉 ALL 11 UNIT TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
})();
