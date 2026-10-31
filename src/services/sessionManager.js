const { EventEmitter } = require('events');
const { loadSessions, saveSessions } = require('./storage');

// Common Timezone Offsets in minutes relative to UTC
const TZ_OFFSETS = {
  UTC: 0, GMT: 0, Z: 0,
  WET: 0, WEST: 60,
  CET: 60, CEST: 120,
  BST: 60,
  EET: 120, EEST: 180,
  MSK: 180,
  EST: -300, EDT: -240,
  CST: -360, CDT: -300,
  MST: -420, MDT: -360,
  PST: -480, PDT: -420
};

// Weekday names mapping
const DAYS_OF_WEEK = {
  sunday: 0, sun: 0, dimanche: 0,
  monday: 1, mon: 1, lundi: 1,
  tuesday: 2, tue: 2, mardi: 2,
  wednesday: 3, wed: 3, mercredi: 3,
  thursday: 4, thu: 4, jeudi: 4,
  friday: 5, fri: 5, vendredi: 5,
  saturday: 6, sat: 6, samedi: 6
};

// Helper to parse reminder prior strings (e.g. "30m", "15m", "1h", "off") into minutes
function parseReminderMinutes(str) {
  if (!str) return 30;
  str = String(str).toLowerCase().trim();
  if (['off', 'none', 'false', '0', 'disabled'].includes(str)) return 0;
  const match = str.match(/^(\d+)\s*(m|min|mins|h|hr|hours)?$/i);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2] ? match[2].toLowerCase() : 'm';
    return unit.startsWith('h') ? val * 60 : val;
  }
  return 30;
}

const MAX_ADVANCE_MS = 14 * 24 * 60 * 60 * 1000; // matches must start within 14 days (setTimeout limit is ~24.8 days)
const MAX_ACTIVE_PER_CREATOR = 3;
const MIN_LEAD_MS = 3 * 60 * 1000;
const STALE_PARTY_MS = 2 * 60 * 60 * 1000; // a match older than this at startup is not announced any more
const PING_TARGETS = ['everyone', 'role', 'only_on_time', 'none'];
const REMINDER_PRIORS = ['off', '5m', '10m', '15m', '30m', '45m', '1h'];

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = Object.assign(Object.create(null), loadSessions());
    this.timers = new Map();
    this.reminderTimers = new Map();
    this.partyTimers = new Map();
    this.purgeUnloggedVotes();
    this.fixActiveSessionTimezones();
    this.restoreTimers();
  }

  // Purge any unauthenticated or mock web votes
  purgeUnloggedVotes() {
    let changed = false;
    let purgedCount = 0;
    for (const session of Object.values(this.sessions)) {
      if (!session.votes) continue;
      for (const [userId, vote] of Object.entries(session.votes)) {
        const isUnlogged = userId.startsWith('web_') ||
                           vote.username === 'Web Player' ||
                           vote.displayName === 'Web Player' ||
                           userId === 'web_admin';
        if (isUnlogged) {
          delete session.votes[userId];
          changed = true;
          purgedCount++;
        }
      }
    }
    if (changed) {
      this.persist();
      console.log(`🧹 [SessionManager] Purged ${purgedCount} unlogged web vote(s) from storage.`);
    }
    return purgedCount;
  }

  // Parse human time strings like "now", "21:00", "14:00", "tomorrow 20h", "friday 21:00", "in 1h"
  parseTimeString(timeStr, baseDate = new Date()) {
    if (!timeStr || typeof timeStr !== 'string' || timeStr.length > 64) return null;
    timeStr = timeStr.trim();

    // 0. "now" format
    if (timeStr.toLowerCase() === 'now') {
      return new Date(baseDate.getTime());
    }

    let dayOffset = 0;

    // 1. Check for future day prefixes: "tomorrow", "demain", "in X days", "friday", etc.
    const tomorrowMatch = timeStr.match(/^(?:tomorrow|demain)(?:\s+(?:at\s+)?(.*))?$/i);
    if (tomorrowMatch) {
      dayOffset = 1;
      timeStr = tomorrowMatch[1] ? tomorrowMatch[1].trim() : '21:00';
    } else {
      const inDaysMatch = timeStr.match(/^in\s+(\d+)\s*days?(?:\s+(?:at\s+)?(.*))?$/i);
      if (inDaysMatch) {
        dayOffset = parseInt(inDaysMatch[1], 10);
        timeStr = inDaysMatch[2] ? inDaysMatch[2].trim() : '21:00';
      } else {
        const dayMatch = timeStr.match(/^([a-zA-Z]+)(?:\s+(?:at\s+)?(.*))?$/i);
        if (dayMatch && DAYS_OF_WEEK[dayMatch[1].toLowerCase()] !== undefined) {
          const targetDay = DAYS_OF_WEEK[dayMatch[1].toLowerCase()];
          const currentDay = baseDate.getDay();
          let diff = targetDay - currentDay;
          if (diff <= 0) diff += 7; // next occurrence of this weekday
          dayOffset = diff;
          timeStr = dayMatch[2] ? dayMatch[2].trim() : '21:00';
        }
      }
    }

    const workingBase = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);

    // 2. Relative format: "in 45m", "in 2h", "+30m"
    const relMatch = timeStr.match(/^(?:in\s+|\+)?(\d+)\s*(m|min|mins|h|hr|hours)?$/i);
    if (relMatch && dayOffset === 0) {
      const val = parseInt(relMatch[1], 10);
      const unit = relMatch[2] ? relMatch[2].toLowerCase() : 'm';
      const ms = unit.startsWith('h') ? val * 60 * 60 * 1000 : val * 60 * 1000;
      return new Date(baseDate.getTime() + ms);
    }

    // 3. HH:MM or HHhMM format with optional meridiem and timezone (e.g. "21:00", "21h00", "14:00", "9:30pm EST")
    const timeMatch = timeStr.match(/^(\d{1,2})[:h](\d{2})?(?:\s*(am|pm))?(?:\s*([a-zA-Z]+|[+-]\d{1,2}(?::?\d{2})?))?$/i) ||
                      timeStr.match(/^(\d{1,2})(?:h)?(?:\s*(am|pm))?(?:\s*([a-zA-Z]+|[+-]\d{1,2}(?::?\d{2})?))?$/i);

    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const meridiem = (timeMatch[3] || '').toLowerCase();
      const tzStr = (timeMatch[4] || '').toUpperCase();

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;

      // If an explicit timezone is given (e.g. CET, UTC, EST)
      if (tzStr && TZ_OFFSETS[tzStr] !== undefined) {
        const offsetMinutes = TZ_OFFSETS[tzStr];
        const targetUtcMs = Date.UTC(workingBase.getUTCFullYear(), workingBase.getUTCMonth(), workingBase.getUTCDate(), hours, minutes, 0) - (offsetMinutes * 60 * 1000);
        const target = new Date(targetUtcMs);
        if (dayOffset === 0 && target.getTime() < baseDate.getTime() - 30 * 60 * 1000) {
          target.setUTCDate(target.getUTCDate() + 1);
        }
        return target;
      }

      // Default: parse in server's local configured timezone (process.env.TZ)
      const target = new Date(workingBase);
      target.setHours(hours, minutes, 0, 0);

      // If the target time is in the past by more than 30 minutes and no future day was explicitly requested, assume tomorrow
      if (dayOffset === 0 && target.getTime() < baseDate.getTime() - 30 * 60 * 1000) {
        target.setDate(target.getDate() + 1);
      }
      return target;
    }

    // 4. ISO timestamp or standard date parse
    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return null;
  }

  // Calculate default deadline: 15 minutes before party time or half the remaining time
  computeDeadline(partyDate, deadlineStr, baseDate = new Date()) {
    if (deadlineStr) {
      // Check for offset syntax like "15m before", "30m before"
      const beforeMatch = deadlineStr.match(/^(\d+)\s*(m|min|mins|h)?\s*before$/i);
      if (beforeMatch) {
        const val = parseInt(beforeMatch[1], 10);
        const unit = beforeMatch[2] ? beforeMatch[2].toLowerCase() : 'm';
        const ms = unit.startsWith('h') ? val * 60 * 60 * 1000 : val * 60 * 1000;
        return new Date(partyDate.getTime() - ms);
      }

      const parsed = this.parseTimeString(deadlineStr, baseDate);
      if (parsed) {
        // Ensure deadline is not already in the past if party is in the future
        if (parsed.getTime() > baseDate.getTime() && parsed.getTime() < partyDate.getTime()) {
          return parsed;
        }
      }
    }

    // Default: 15 minutes before party, or if less than 30 min away, halfway between now and party
    const diff = partyDate.getTime() - baseDate.getTime();
    if (diff > 30 * 60 * 1000) {
      return new Date(partyDate.getTime() - 15 * 60 * 1000);
    } else if (diff > 0) {
      return new Date(baseDate.getTime() + Math.floor(diff * 0.7));
    } else {
      return new Date(partyDate.getTime());
    }
  }

  createSession(options) {
    const id = options.id || `valo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();
    const creatorId = options.creator?.id || 'sender_1';

    const activeByCreator = this.getActiveSessions().filter(s => s.creator?.id === creatorId).length;
    if (activeByCreator >= MAX_ACTIVE_PER_CREATOR) {
      throw new Error(`Tu as déjà ${MAX_ACTIVE_PER_CREATOR} sessions actives. Annule-en une avant d'en lancer une autre.`);
    }

    const requestedParty = Number(options.partyTimestamp);
    let partyDate = Number.isFinite(requestedParty) && requestedParty > 0 ?
      new Date(requestedParty) :
      (this.parseTimeString(options.partyTime, now) || new Date(now.getTime() + 60 * 60 * 1000));

    // Minimum lead time so the "enough players?" check never fires before anyone could vote
    if (!isNaN(partyDate.getTime()) && partyDate.getTime() < now.getTime() + MIN_LEAD_MS) {
      partyDate = new Date(now.getTime() + MIN_LEAD_MS);
    }

    if (isNaN(partyDate.getTime()) || partyDate.getTime() < now.getTime() - 30 * 60 * 1000 || partyDate.getTime() > now.getTime() + MAX_ADVANCE_MS) {
      throw new Error("L'heure du match doit être comprise dans les 14 prochains jours.");
    }

    const requestedDeadline = Number(options.voteDeadlineTimestamp);
    let deadlineDate = Number.isFinite(requestedDeadline) && requestedDeadline > 0 ?
      new Date(requestedDeadline) :
      this.computeDeadline(partyDate, options.voteDeadline, now);
    if (isNaN(deadlineDate.getTime()) || deadlineDate.getTime() > partyDate.getTime()) {
      deadlineDate = this.computeDeadline(partyDate, null, now);
    }

    const partySize = [2, 3, 5].includes(Number(options.partySize)) ? Number(options.partySize) : 5;

    const session = {
      id,
      guildId: options.guildId || null,
      channelId: options.channelId || null,
      messageId: options.messageId || null,
      creator: {
        id: creatorId,
        username: options.creator?.username || 'Sender',
        displayName: options.creator?.displayName || options.creator?.username || 'Sender',
        avatar: options.creator?.avatar || null
      },
      note: options.note || 'Competitive 5-Stack',
      partySize,
      targetRole: {
        id: options.targetRoleId || 'everyone',
        name: options.targetRoleName || '@everyone'
      },
      targetMemberIds: options.targetMemberIds || [],
      partyTime: partyDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
      partyTimestamp: partyDate.getTime(),
      voteDeadline: deadlineDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
      voteDeadlineTimestamp: deadlineDate.getTime(),
      timezone: process.env.TIMEZONE || process.env.TZ || 'Europe/Paris',
      createdAt: now.getTime(),
      status: 'active', // 'active' | 'locked' | 'cancelled'
      cancelledBy: null,
      cancelReason: null,
      cancelledAt: null,
      reminderSent: Boolean(options.reminderSent),
      partyStartSent: Boolean(options.partyStartSent),
      pingTarget: PING_TARGETS.includes(options.pingTarget) ? options.pingTarget : 'everyone',
      reminderPrior: REMINDER_PRIORS.includes(options.reminderPrior) ? options.reminderPrior : '30m',
      votes: {},
      history: []
    };

    // Auto-vote sender as "sure" (sender can change or remove vote later)
    session.votes[session.creator.id] = {
      userId: session.creator.id,
      username: session.creator.username,
      displayName: session.creator.displayName,
      avatar: session.creator.avatar,
      status: 'sure',
      timestamp: now.getTime()
    };

    session.history.push({
      action: 'created',
      userId: session.creator.id,
      timestamp: now.getTime()
    });

    this.sessions[id] = session;
    this.persist();
    this.scheduleDeadline(session);
    this.scheduleReminder(session);
    this.schedulePartyStart(session);
    this.emit('sessionCreated', session);

    return session;
  }

  getSession(id) {
    // own-property check: ids such as "constructor" or "__proto__" must never resolve
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(this.sessions, id) ? this.sessions[id] : null;
  }

  // Shape sent to web clients: roster included, internal candidate list (all channel member ids) left out
  toPublic(session) {
    const { targetMemberIds, ...rest } = session;
    return { ...rest, roster: this.calculateRosters(session) };
  }

  getAllSessions() {
    return Object.values(this.sessions);
  }

  getActiveSessions() {
    return Object.values(this.sessions)
      .filter(s => s.status === 'active')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Automatically realign any active sessions whose partyTimestamp was skewed by UTC container defaults
  fixActiveSessionTimezones() {
    const updated = [];
    for (const session of Object.values(this.sessions)) {
      if (session.status !== 'active') continue;
      const base = new Date(session.createdAt || Date.now());
      const recomputed = this.parseTimeString(session.partyTime, base);
      if (recomputed && Math.abs(recomputed.getTime() - session.partyTimestamp) >= 30 * 60 * 1000) {
        console.log(`🕒 [SessionManager] Realigned session ${session.id} partyTimestamp from ${session.partyTimestamp} to ${recomputed.getTime()}`);
        session.partyTimestamp = recomputed.getTime();
        const newDeadline = this.computeDeadline(recomputed, session.voteDeadline, base);
        session.voteDeadlineTimestamp = newDeadline.getTime();
        session.timezone = process.env.TIMEZONE || process.env.TZ || 'Europe/Paris';
        updated.push(session);
      }
    }
    if (updated.length > 0) {
      this.persist();
    }
    return updated;
  }

  castVote(sessionId, user, voteType, meta = {}) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (!this.isVotingOpen(session)) {
      throw new Error(session.status === 'locked' ? 'Le match a déjà commencé, les votes sont clos.' : `Cannot vote on a ${session.status} session`);
    }

    // Guard: Prevent unauthenticated / anonymous web votes
    if (meta.source === 'web' && (!user || !user.id || user.id.startsWith('web_') || user.username === 'Web Player')) {
      throw new Error('Authentication required. Only logged-in Discord users can vote.');
    }

    const now = Date.now();
    const previousStatus = session.votes[user.id]?.status || null;
    const validVotes = ['sure', 'maybe', 'if_last', 'backup', 'no', 'remove'];
    if (!validVotes.includes(voteType)) {
      throw new Error(`Invalid vote type: ${voteType}`);
    }

    if (voteType === 'remove') {
      if (session.votes[user.id]) {
        delete session.votes[user.id];
        session.history.push({
          action: 'vote_removed',
          userId: user.id,
          timestamp: now
        });
      }
    } else {
      session.votes[user.id] = {
        userId: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null,
        status: voteType,
        timestamp: now
      };
      session.history.push({
        action: 'voted',
        userId: user.id,
        vote: voteType,
        timestamp: now
      });
    }

    this.persist();
    const joined = ['sure', 'maybe', 'if_last', 'backup'].includes(voteType) && previousStatus !== voteType;
    this.emit('sessionUpdated', session, { user, voteType, previousStatus, joined, ...meta });
    return session;
  }

  cancelSession(sessionId, cancelledByUser, reason = null) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status === 'cancelled') return session;

    session.status = 'cancelled';
    session.cancelReason = reason;
    session.cancelledAt = Date.now();
    session.cancelledBy = {
      id: cancelledByUser?.id || 'admin',
      username: cancelledByUser?.username || 'Admin',
      displayName: cancelledByUser?.displayName || cancelledByUser?.username || 'Admin'
    };

    session.history.push({
      action: 'cancelled',
      userId: session.cancelledBy.id,
      timestamp: session.cancelledAt
    });

    if (this.timers.has(sessionId)) {
      clearTimeout(this.timers.get(sessionId));
      this.timers.delete(sessionId);
    }
    if (this.reminderTimers.has(sessionId)) {
      clearTimeout(this.reminderTimers.get(sessionId));
      this.reminderTimers.delete(sessionId);
    }
    if (this.partyTimers.has(sessionId)) {
      clearTimeout(this.partyTimers.get(sessionId));
      this.partyTimers.delete(sessionId);
    }

    this.persist();
    this.emit('sessionCancelled', session);
    return session;
  }

  lockSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    if (session.status !== 'active') return session;

    session.status = 'locked';
    session.lockedAt = Date.now();
    session.history.push({
      action: 'locked_deadline',
      timestamp: session.lockedAt
    });

    if (this.timers.has(sessionId)) {
      clearTimeout(this.timers.get(sessionId));
      this.timers.delete(sessionId);
    }
    if (this.reminderTimers.has(sessionId)) {
      clearTimeout(this.reminderTimers.get(sessionId));
      this.reminderTimers.delete(sessionId);
    }

    this.persist();
    this.emit('sessionLocked', session);
    return session;
  }

  calculateRosters(session) {
    const partySize = session.partySize || 5;
    const votesList = Object.values(session.votes || {});

    // Categorize votes
    const sureVotes = votesList.filter(v => v.status === 'sure').sort((a, b) => a.timestamp - b.timestamp);
    const ifLastVotes = votesList.filter(v => v.status === 'if_last').sort((a, b) => a.timestamp - b.timestamp);
    const backupVotes = votesList.filter(v => v.status === 'backup').sort((a, b) => a.timestamp - b.timestamp);
    const maybeVotes = votesList.filter(v => v.status === 'maybe').sort((a, b) => a.timestamp - b.timestamp);
    const noVotes = votesList.filter(v => v.status === 'no').sort((a, b) => a.timestamp - b.timestamp);

    // Stacking allocation
    const teams = [];
    const usedUserIds = new Set();
    const backupQueue = [];

    // How many full teams can we make purely from 'sure' players?
    let remainingSure = [...sureVotes];

    while (remainingSure.length >= partySize) {
      const fullTeam = remainingSure.splice(0, partySize);
      fullTeam.forEach(p => usedUserIds.add(p.userId));
      teams.push(fullTeam);
    }

    // Now handle remaining sure players (fewer than partySize)
    if (remainingSure.length > 0) {
      const teamNumber = teams.length + 1;
      const currentTeam = [...remainingSure];
      currentTeam.forEach(p => usedUserIds.add(p.userId));

      // Complete the team while slots remain: "if a last" players first, then "if needed" backups
      for (const filler of [...ifLastVotes, ...backupVotes]) {
        if (currentTeam.length >= partySize) break;
        if (usedUserIds.has(filler.userId)) continue;
        currentTeam.push(filler);
        usedUserIds.add(filler.userId);
      }

      teams.push(currentTeam);
    }

    // 'if_last' and 'backup' players not needed to fill a slot stay in reserve
    const unusedIfLast = ifLastVotes.filter(v => !usedUserIds.has(v.userId));
    const unusedBackups = backupVotes.filter(v => !usedUserIds.has(v.userId));
    const allBackups = [...unusedBackups, ...unusedIfLast];

    // Didn't respond (from targetMemberIds if provided)
    const targetMemberIds = session.targetMemberIds || [];
    const unresponsiveIds = targetMemberIds.filter(id => !session.votes[id]);

    return {
      teams,
      team1: teams[0] || [],
      team2: teams[1] || [],
      additionalTeams: teams.slice(2),
      backups: allBackups,
      maybes: maybeVotes,
      declined: noVotes,
      ifLastUnassigned: unusedIfLast,
      unresponsive: unresponsiveIds,
      totalVotes: votesList.length,
      partySize
    };
  }

  scheduleDeadline(session) {
    if (session.status !== 'active') return;
    const now = Date.now();
    const msUntilDeadline = session.voteDeadlineTimestamp - now;

    if (this.timers.has(session.id)) {
      clearTimeout(this.timers.get(session.id));
      this.timers.delete(session.id);
    }

    if (msUntilDeadline <= 0) {
      // Already expired
      this.lockSession(session.id);
    } else {
      const timer = setTimeout(() => {
        this.lockSession(session.id);
      }, msUntilDeadline);
      this.timers.set(session.id, timer);
    }
  }

  // Schedule a reminder ping prior to party match time (customizable: 15m, 30m, 45m, 1h, off)
  scheduleReminder(session) {
    if (session.status !== 'active' || session.reminderSent) return;

    if (this.reminderTimers.has(session.id)) {
      clearTimeout(this.reminderTimers.get(session.id));
      this.reminderTimers.delete(session.id);
    }

    // If notifications are disabled or pingTarget is none
    if (session.pingTarget === 'none' || session.reminderPrior === 'off') return;

    const reminderMins = parseReminderMinutes(session.reminderPrior);
    if (reminderMins <= 0) return;

    const now = Date.now();
    const reminderTime = session.partyTimestamp - reminderMins * 60 * 1000;
    const msUntilReminder = reminderTime - now;

    if (msUntilReminder > 0) {
      const timer = setTimeout(() => {
        if (session.status === 'active' && !session.reminderSent) {
          session.reminderSent = true;
          this.persist();
          console.log(`📢 [SessionManager] Emitting ${reminderMins}m reminder event for session ${session.id}`);
          this.emit('sessionReminder', session);
        }
      }, msUntilReminder);

      this.reminderTimers.set(session.id, timer);
      console.log(`⏰ [SessionManager] Scheduled ${reminderMins}m reminder for session ${session.id} in ${Math.round(msUntilReminder / 60000)}m`);
    }
  }

  schedulePartyStart(session) {
    if (session.status === 'cancelled' || session.partyStartSent) return;

    if (this.partyTimers.has(session.id)) {
      clearTimeout(this.partyTimers.get(session.id));
      this.partyTimers.delete(session.id);
    }

    const msUntilParty = Math.max(0, session.partyTimestamp - Date.now());

    if (Date.now() - session.partyTimestamp > STALE_PARTY_MS) {
      session.partyStartSent = true;
      this.persist();
      console.log(`🕰️ [SessionManager] Session ${session.id} ended while the bot was offline, closing it silently.`);
      return;
    }

    const timer = setTimeout(() => {
      if (session.status !== 'cancelled' && !session.partyStartSent) {
        session.partyStartSent = true;
        this.persist();
        // Not enough players when the match is due: the party is cancelled automatically
        const roster = this.calculateRosters(session);
        if (roster.team1.length < (session.partySize || 5)) {
          console.log(`🛑 [SessionManager] Auto-cancelling session ${session.id}: ${roster.team1.length}/${session.partySize} players`);
          this.cancelSession(session.id, { id: 'system', username: 'Valobot', displayName: 'Valobot' }, 'not_enough_players');
        }
        console.log(`🎮 [SessionManager] Emitting match start event for session ${session.id}`);
        this.emit('sessionPartyStart', session);
      }
      this.partyTimers.delete(session.id);
    }, msUntilParty);

    this.partyTimers.set(session.id, timer);
  }

  // Votes stay open after the vote deadline (status "locked") until the real match time
  isVotingOpen(session) {
    if (!session || session.status === 'cancelled') return false;
    if (session.status === 'active') return true;
    return session.status === 'locked' && !session.partyStartSent && Date.now() < session.partyTimestamp;
  }

  // Force trigger reminder (useful for testing or manual prompt)
  triggerReminder(sessionId) {
    const session = this.getSession(sessionId);
    if (!session || session.status !== 'active') return false;
    session.reminderSent = true;
    this.persist();
    this.emit('sessionReminder', session);
    return true;
  }

  restoreTimers() {
    for (const session of Object.values(this.sessions)) {
      if (session.status === 'active') {
        this.scheduleDeadline(session);
        this.scheduleReminder(session);
        this.schedulePartyStart(session);
      } else if (session.status === 'locked') {
        this.schedulePartyStart(session);
      }
    }
  }

  persist() {
    saveSessions(this.sessions);
  }
}

// Singleton instance
const sessionManager = new SessionManager();
module.exports = sessionManager;
