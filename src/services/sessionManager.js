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

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = loadSessions();
    this.timers = new Map();
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

  // Parse human time strings like "21:00", "21h30", "21:00 CET", "in 30m", "in 1h"
  parseTimeString(timeStr, baseDate = new Date()) {
    if (!timeStr) return null;
    timeStr = timeStr.trim();

    // Relative format: "in 45m", "in 2h", "+30m"
    const relMatch = timeStr.match(/^(?:in\s+|\+)?(\d+)\s*(m|min|mins|h|hr|hours)?$/i);
    if (relMatch) {
      const val = parseInt(relMatch[1], 10);
      const unit = relMatch[2] ? relMatch[2].toLowerCase() : 'm';
      const ms = unit.startsWith('h') ? val * 60 * 60 * 1000 : val * 60 * 1000;
      return new Date(baseDate.getTime() + ms);
    }

    // HH:MM or HHhMM format with optional meridiem and timezone (e.g. "21:00", "21h00", "21:00 CET", "9:30pm EST")
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
        const targetUtcMs = Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), hours, minutes, 0) - (offsetMinutes * 60 * 1000);
        const target = new Date(targetUtcMs);
        if (target.getTime() < baseDate.getTime() - 30 * 60 * 1000) {
          target.setUTCDate(target.getUTCDate() + 1);
        }
        return target;
      }

      // Default: parse in server's local configured timezone (process.env.TZ)
      const target = new Date(baseDate);
      target.setHours(hours, minutes, 0, 0);

      // If the target time is in the past by more than 30 minutes, assume tomorrow
      if (target.getTime() < baseDate.getTime() - 30 * 60 * 1000) {
        target.setDate(target.getDate() + 1);
      }
      return target;
    }

    // ISO timestamp or standard date parse
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

    const partyDate = options.partyTimestamp ?
      new Date(options.partyTimestamp) :
      (this.parseTimeString(options.partyTime, now) || new Date(now.getTime() + 60 * 60 * 1000));

    const deadlineDate = options.voteDeadlineTimestamp ?
      new Date(options.voteDeadlineTimestamp) :
      this.computeDeadline(partyDate, options.voteDeadline, now);

    const partySize = [2, 3, 5].includes(Number(options.partySize)) ? Number(options.partySize) : 5;

    const session = {
      id,
      guildId: options.guildId || null,
      channelId: options.channelId || null,
      messageId: options.messageId || null,
      creator: {
        id: options.creator?.id || 'sender_1',
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
      cancelledAt: null,
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
    this.emit('sessionCreated', session);

    return session;
  }

  getSession(id) {
    return this.sessions[id] || null;
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
    const session = this.sessions[sessionId];
    if (!session) throw new Error('Session not found');
    if (session.status !== 'active') throw new Error(`Cannot vote on a ${session.status} session`);

    // Guard: Prevent unauthenticated / anonymous web votes
    if (meta.source === 'web' && (!user || !user.id || user.id.startsWith('web_') || user.username === 'Web Player')) {
      throw new Error('Authentication required. Only logged-in Discord users can vote.');
    }

    const now = Date.now();
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
    this.emit('sessionUpdated', session, { user, voteType, ...meta });
    return session;
  }

  cancelSession(sessionId, cancelledByUser) {
    const session = this.sessions[sessionId];
    if (!session) throw new Error('Session not found');
    if (session.status === 'cancelled') return session;

    session.status = 'cancelled';
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

    this.persist();
    this.emit('sessionCancelled', session);
    return session;
  }

  lockSession(sessionId) {
    const session = this.sessions[sessionId];
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

      // Can we complete this team with "if a last" players?
      // "If a last" players join specifically if needed to complete the stack!
      const neededCount = partySize - currentTeam.length;
      if (neededCount === 1 && ifLastVotes.length > 0) {
        // Exactly 1 needed, and we have an "if a last" player ready!
        const filler = ifLastVotes.find(v => !usedUserIds.has(v.userId));
        if (filler) {
          currentTeam.push(filler);
          usedUserIds.add(filler.userId);
        }
      }

      teams.push(currentTeam);
    }

    // Remaining 'sure' that couldn't be placed (if any), 'if_last' not used, and 'backup'
    const unusedIfLast = ifLastVotes.filter(v => !usedUserIds.has(v.userId));
    const allBackups = [...backupVotes, ...unusedIfLast];

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

  restoreTimers() {
    for (const session of Object.values(this.sessions)) {
      if (session.status === 'active') {
        this.scheduleDeadline(session);
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
