// Valobot Web App Client

let sessions = [];
let socket = null;
let currentUser = null;

// DOM Elements
const sessionsListEl = document.getElementById('sessionsList');
const emptyStateEl = document.getElementById('emptyState');
const activeSessionsCountEl = document.getElementById('activeSessionsCount');
const totalVotesCountEl = document.getElementById('totalVotesCount');
const botGuildsCountEl = document.getElementById('botGuildsCount');
const botStatusBadge = document.getElementById('botStatusBadge');
const botStatusText = document.getElementById('botStatusText');
const authWidget = document.getElementById('authWidget');
const loginRequiredNotice = document.getElementById('loginRequiredNotice');
const createModal = document.getElementById('createModal');
const openCreateModalBtn = document.getElementById('openCreateModalBtn');
const closeCreateModalBtn = document.getElementById('closeCreateModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const createSessionForm = document.getElementById('createSessionForm');
const emptyCreateBtn = document.getElementById('emptyCreateBtn');
const loadDemoBtn = document.getElementById('loadDemoBtn');
const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
const toastContainer = document.getElementById('toastContainer');
const channelSelect = document.getElementById('channelSelect');
const roleSelect = document.getElementById('roleSelect');
const submitCreateBtn = document.getElementById('submitCreateBtn');

// WebSocket Setup
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    botStatusBadge.className = 'status-indicator online';
    botStatusText.textContent = 'SYSTEM ONLINE';
  };

  socket.onclose = () => {
    botStatusBadge.className = 'status-indicator offline';
    botStatusText.textContent = 'DISCONNECTED';
    setTimeout(initWebSocket, 3000);
  };

  socket.onerror = () => {
    botStatusBadge.className = 'status-indicator offline';
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'INIT') {
        sessions = data.sessions || [];
        renderSessions();
      } else if (data.type === 'SESSION_CREATED') {
        sessions.unshift(data.payload);
        renderSessions();
        showToast('🎯 New Valorant stack session launched!');
      } else if (data.type === 'SESSION_UPDATED') {
        const updated = data.payload.session;
        const idx = sessions.findIndex(s => s.id === updated.id);
        if (idx !== -1) {
          sessions[idx] = updated;
        } else {
          sessions.unshift(updated);
        }
        renderSessions();
      } else if (data.type === 'SESSION_CANCELLED') {
        const cancelled = data.payload;
        const idx = sessions.findIndex(s => s.id === cancelled.id);
        if (idx !== -1) {
          sessions[idx] = cancelled;
        }
        renderSessions();
        showToast('🛑 Session has been CANCELLED and stamped.', 'error');
      } else if (data.type === 'SESSION_LOCKED') {
        const locked = data.payload;
        const idx = sessions.findIndex(s => s.id === locked.id);
        if (idx !== -1) {
          sessions[idx] = locked;
        }
        renderSessions();
        showToast('🔒 Vote deadline reached! Final roster locked.');
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  };
}

// Authentication Check
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();

    if (data.loggedIn && data.user) {
      currentUser = data.user;
      renderAuthUser(currentUser);
      loginRequiredNotice.style.display = 'none';
      submitCreateBtn.disabled = false;
      await fetchGuilds();
    } else {
      currentUser = null;
      renderAuthGuest();
      loginRequiredNotice.style.display = 'flex';
      channelSelect.innerHTML = '<option value="">-- Please log in with Discord first --</option>';
      submitCreateBtn.disabled = true;
    }
  } catch (err) {
    console.warn('Auth check failed:', err);
    renderAuthGuest();
  }
}

function renderAuthUser(user) {
  authWidget.innerHTML = `
    <div class="user-pill">
      ${user.avatar ? `<img src="${user.avatar}" class="user-avatar-small" alt="${escapeHtml(user.username)}" />` : ''}
      <span class="user-name-small">${escapeHtml(user.displayName || user.username)}</span>
      <button class="btn btn-secondary btn-sm" id="logoutBtn" style="padding: 0.15rem 0.5rem; font-size: 0.7rem; margin-left: 0.2rem;">Logout</button>
    </div>
  `;

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  });
}

function renderAuthGuest() {
  authWidget.innerHTML = `
    <a href="/api/auth/login" class="btn btn-secondary btn-sm" id="loginBtn">
      <span>🎮 Log in with Discord</span>
    </a>
  `;
}

// REST Fetchers
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.botConnected) {
      botStatusText.textContent = `BOT READY: ${data.botTag}`;
      botGuildsCountEl.textContent = data.guildCount || 0;
    } else {
      botStatusText.textContent = 'WEB SERVER ONLINE';
      botGuildsCountEl.textContent = '0 (Standby)';
    }
  } catch (err) {
    console.warn('Could not fetch status:', err);
  }
}

async function fetchGuilds() {
  if (!currentUser) return;

  try {
    const res = await fetch('/api/guilds');
    if (!res.ok) {
      if (res.status === 401) {
        channelSelect.innerHTML = '<option value="">-- Please log in with Discord --</option>';
      }
      return;
    }

    const guilds = await res.json();
    channelSelect.innerHTML = '';
    roleSelect.innerHTML = '<option value="">Channel Only (No Ping)</option>';

    if (guilds.length === 0) {
      channelSelect.innerHTML = '<option value="">No permitted channels found on server</option>';
      return;
    }

    guilds.forEach(guild => {
      const optGroup = document.createElement('optgroup');
      optGroup.label = guild.name;

      if (guild.channels) {
        guild.channels.forEach(ch => {
          const opt = document.createElement('option');
          opt.value = ch.id;
          opt.setAttribute('data-guild-id', guild.id);
          opt.textContent = `#${ch.name}`;
          optGroup.appendChild(opt);
        });
      }
      channelSelect.appendChild(optGroup);

      if (guild.roles) {
        guild.roles.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = `${guild.name} &bull; ${r.name}`;
          roleSelect.appendChild(opt);
        });
      }
    });
  } catch (err) {
    console.warn('Could not fetch guilds:', err);
  }
}

async function fetchSessions() {
  try {
    const res = await fetch('/api/sessions');
    sessions = await res.json();
    renderSessions();
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

// Format relative countdown
function formatCountdown(timestamp) {
  const diff = timestamp - Date.now();
  if (diff <= 0) return 'Passed';
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) {
    return `in ${hours}h ${mins % 60}m`;
  }
  return `in ${mins}m`;
}

// Render Sessions
function renderSessions() {
  // Update stats
  const activeCount = sessions.filter(s => s.status === 'active').length;
  let totalVotes = 0;
  sessions.forEach(s => {
    totalVotes += Object.keys(s.votes || {}).length;
  });

  activeSessionsCountEl.textContent = activeCount;
  totalVotesCountEl.textContent = totalVotes;

  if (sessions.length === 0) {
    sessionsListEl.innerHTML = '';
    emptyStateEl.style.display = 'block';
    return;
  }

  emptyStateEl.style.display = 'none';
  sessionsListEl.innerHTML = '';

  sessions.forEach(session => {
    const isCancelled = session.status === 'cancelled';
    const isLocked = session.status === 'locked';
    const partySize = session.partySize || 5;
    const roster = session.roster || {
      team1: [],
      team2: [],
      backups: [],
      maybes: [],
      ifLastUnassigned: [],
      declined: [],
      unresponsive: []
    };

    const card = document.createElement('div');
    card.className = `session-card ${isCancelled ? 'is-cancelled' : ''} ${isLocked ? 'is-locked' : ''}`;
    card.id = `session-${session.id}`;

    const modeLabel = partySize === 2 ? 'DUO STACK (2)' : (partySize === 3 ? 'TRIO STACK (3)' : 'FULL STACK (5)');
    const targetLabel = session.targetRole?.name || '@everyone';

    let statusBadgeHtml = '<span class="badge badge-status-active">RECRUITING</span>';
    if (isCancelled) statusBadgeHtml = '<span class="badge badge-status-cancelled">CANCELLED</span>';
    else if (isLocked) statusBadgeHtml = '<span class="badge badge-status-locked">VOTE LOCKED</span>';

    // Slots HTML for Team 1
    let slotsHtml = '';
    for (let i = 0; i < partySize; i++) {
      const player = roster.team1[i];
      if (player) {
        const isHost = player.userId === session.creator.id;
        const isFiller = player.status === 'if_last';
        const tag = isHost ? 'HOST' : (isFiller ? 'FILLER' : 'LOCKED');
        slotsHtml += `
          <div class="slot-card occupied">
            <div class="slot-index">#${i + 1}</div>
            <div class="slot-avatar">${(player.displayName || player.username || 'P')[0].toUpperCase()}</div>
            <div class="slot-info">
              <span class="slot-name">${escapeHtml(player.displayName || player.username)}</span>
              <span class="slot-role-tag">${tag}</span>
            </div>
          </div>
        `;
      } else {
        slotsHtml += `
          <div class="slot-card open">
            <div class="slot-index">#${i + 1}</div>
            <div class="slot-avatar">?</div>
            <div class="slot-info">
              <span class="slot-name">Open Slot</span>
              <span class="slot-role-tag">WAITING</span>
            </div>
          </div>
        `;
      }
    }

    // Team 2 (if formed!)
    let team2Html = '';
    if (roster.team2 && roster.team2.length > 0) {
      let team2Slots = '';
      for (let i = 0; i < partySize; i++) {
        const player = roster.team2[i];
        if (player) {
          team2Slots += `
            <div class="slot-card occupied">
              <div class="slot-index">#${i + 1}</div>
              <div class="slot-avatar">${(player.displayName || player.username || 'P')[0].toUpperCase()}</div>
              <div class="slot-info">
                <span class="slot-name">${escapeHtml(player.displayName || player.username)}</span>
                <span class="slot-role-tag">TEAM 2</span>
              </div>
            </div>
          `;
        } else {
          team2Slots += `
            <div class="slot-card open">
              <div class="slot-index">#${i + 1}</div>
              <div class="slot-avatar">?</div>
              <div class="slot-info">
                <span class="slot-name">Open Slot</span>
                <span class="slot-role-tag">WAITING</span>
              </div>
            </div>
          `;
        }
      }

      team2Html = `
        <div class="roster-team-title" style="margin-top: 1rem; color: var(--color-purple);">
          <span>⚔️ SQUAD 2 (${roster.team2.length}/${partySize})</span>
        </div>
        <div class="slots-grid">${team2Slots}</div>
      `;
    }

    const renderTags = (list, className) => {
      if (!list || list.length === 0) return '<span style="color: var(--color-text-dim); font-size: 0.75rem;">None</span>';
      return list.map(item => `<span class="user-tag ${className}">${escapeHtml(item.displayName || item.username || item)}</span>`).join('');
    };

    const myUserId = currentUser?.id || 'guest';
    const myVote = session.votes ? session.votes[myUserId]?.status : null;
    const canCancel = currentUser && (currentUser.id === session.creator.id || currentUser.id === 'admin');

    const localPartyTime = session.partyTimestamp ?
      new Date(session.partyTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) :
      session.partyTime;
    const localDeadline = session.voteDeadlineTimestamp ?
      new Date(session.voteDeadlineTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) :
      session.voteDeadline;

    const authNoticeHtml = !currentUser ? `
      <div class="vote-auth-banner" style="background: rgba(255, 70, 85, 0.12); border: 1px solid rgba(255, 70, 85, 0.3); padding: 0.5rem 0.75rem; border-radius: 4px; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem;">
        <span style="color: #ff9aa2;">🔒 You must be logged in with Discord to vote</span>
        <a href="/api/auth/login" class="btn btn-discord btn-sm" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;">Login with Discord</a>
      </div>
    ` : '';

    card.innerHTML = `
      ${isCancelled ? `
        <div class="cancelled-stamp-overlay">
          <div class="stamp-box">
            <div class="stamp-text">CANCELLED</div>
            <div class="stamp-sub">// RECRUITMENT ABORTED //</div>
          </div>
        </div>
      ` : ''}

      <div class="session-header">
        <div>
          <div class="session-badge-row">
            <span class="badge badge-mode">${modeLabel}</span>
            <span class="badge badge-target">${escapeHtml(targetLabel)}</span>
            ${statusBadgeHtml}
          </div>
          <h2 class="session-title">${escapeHtml(session.note || 'VALORANT STACK PROTOCOL')}</h2>
          <div class="session-creator">
            Initiated by <strong>${escapeHtml(session.creator?.displayName || session.creator?.username || 'Host')}</strong>
            &bull; ID: <code>${session.id}</code>
          </div>
        </div>

        <div>
          <button class="btn btn-danger btn-sm cancel-session-btn" data-id="${session.id}" ${isCancelled || !canCancel ? 'disabled' : ''}>
            ${isCancelled ? '❌ CANCELLED' : '🛑 CANCEL VOTE'}
          </button>
        </div>
      </div>

      <div class="session-timing-hud">
        <div class="time-item">
          <span class="time-label">MATCH BEGINS</span>
          <span class="time-val">${localPartyTime}</span>
          <span class="time-countdown">${formatCountdown(session.partyTimestamp)}</span>
        </div>
        <div class="time-item">
          <span class="time-label">VOTE DEADLINE</span>
          <span class="time-val">${localDeadline}</span>
          <span class="time-countdown">${formatCountdown(session.voteDeadlineTimestamp)}</span>
        </div>
        <div class="time-item">
          <span class="time-label">ROSTER STATUS</span>
          <span class="time-val">${roster.team1.length} / ${partySize}</span>
          <span class="time-countdown" style="color: ${roster.team1.length >= partySize ? 'var(--color-green)' : 'var(--color-amber)'}">
            ${roster.team1.length >= partySize ? 'STACK READY' : `${partySize - roster.team1.length} OPEN`}
          </span>
        </div>
      </div>

      <div class="session-roster">
        <div class="roster-team-title">
          <span>⚔️ SQUAD 1 (${roster.team1.length}/${partySize})</span>
          <span style="font-size: 0.75rem; color: var(--color-text-muted);">First ${partySize} 'Sure' players</span>
        </div>
        <div class="slots-grid">${slotsHtml}</div>
        ${team2Html}

        <div class="secondary-rosters">
          <div class="sub-roster-group">
            <h4>🎒 Backups / Bench (${roster.backups?.length || 0})</h4>
            <div class="sub-roster-tags">${renderTags(roster.backups, 'backup')}</div>
          </div>
          <div class="sub-roster-group">
            <h4>⚡ If a Last (${roster.ifLastUnassigned?.length || 0})</h4>
            <div class="sub-roster-tags">${renderTags(roster.ifLastUnassigned, 'if-last')}</div>
          </div>
          <div class="sub-roster-group">
            <h4>🤔 Maybe (${roster.maybes?.length || 0})</h4>
            <div class="sub-roster-tags">${renderTags(roster.maybes, 'maybe')}</div>
          </div>
          <div class="sub-roster-group">
            <h4>❌ Declined (${roster.declined?.length || 0})</h4>
            <div class="sub-roster-tags">${renderTags(roster.declined, 'declined')}</div>
          </div>
        </div>
      </div>

      <div class="voting-bar">
        ${authNoticeHtml}
        <div class="vote-buttons-row" style="${!currentUser ? 'opacity: 0.45; pointer-events: none;' : ''}">
          <button class="btn btn-vote btn-vote-sure vote-btn ${myVote === 'sure' ? 'active' : ''}" data-id="${session.id}" data-vote="sure" ${isCancelled || isLocked || !currentUser ? 'disabled' : ''}>
            🟢 Sure to be there
          </button>
          <button class="btn btn-vote btn-vote-maybe vote-btn ${myVote === 'maybe' ? 'active' : ''}" data-id="${session.id}" data-vote="maybe" ${isCancelled || isLocked || !currentUser ? 'disabled' : ''}>
            🟡 Will try (Maybe)
          </button>
          <button class="btn btn-vote btn-vote-if-last vote-btn ${myVote === 'if_last' ? 'active' : ''}" data-id="${session.id}" data-vote="if_last" ${isCancelled || isLocked || !currentUser ? 'disabled' : ''}>
            🟣 If a last
          </button>
          <button class="btn btn-vote btn-vote-backup vote-btn ${myVote === 'backup' ? 'active' : ''}" data-id="${session.id}" data-vote="backup" ${isCancelled || isLocked || !currentUser ? 'disabled' : ''}>
            🟠 If needed (Backup)
          </button>
          <button class="btn btn-vote btn-vote-no vote-btn ${myVote === 'no' ? 'active' : ''}" data-id="${session.id}" data-vote="no" ${isCancelled || isLocked || !currentUser ? 'disabled' : ''}>
            🔴 No
          </button>
          <button class="btn btn-secondary btn-sm vote-btn" data-id="${session.id}" data-vote="remove" ${isCancelled || isLocked || !currentUser ? 'disabled' : ''}>
            🗑️ Clear
          </button>
        </div>

        <div>
          <a href="/api/sessions/${session.id}/banner.png" target="_blank" class="btn btn-secondary btn-sm">
            🖼️ View Banner Card
          </a>
        </div>
      </div>
    `;

    sessionsListEl.appendChild(card);
  });

  document.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', handleVoteClick);
  });

  document.querySelectorAll('.cancel-session-btn').forEach(btn => {
    btn.addEventListener('click', handleCancelClick);
  });
}

// Voting handler (STRICT: Authentication required)
async function handleVoteClick(e) {
  if (!currentUser) {
    showToast('🔒 Please log in with Discord to cast a vote.', 'error');
    window.location.href = '/api/auth/login';
    return;
  }

  const sessionId = e.currentTarget.getAttribute('data-id');
  const voteType = e.currentTarget.getAttribute('data-vote');

  try {
    const res = await fetch(`/api/sessions/${sessionId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voteType
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to vote');
    }

    const updated = await res.json();
    const idx = sessions.findIndex(s => s.id === updated.id);
    if (idx !== -1) sessions[idx] = updated;
    renderSessions();
    showToast(`Vote recorded: ${voteType}`);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Cancel handler
async function handleCancelClick(e) {
  if (!currentUser) {
    showToast('🔒 Please log in with Discord to cancel a session.', 'error');
    return;
  }

  const sessionId = e.currentTarget.getAttribute('data-id');

  if (!confirm('Are you sure you want to CANCEL this Valorant session? It will be stamped CANCELLED in diagonal.')) {
    return;
  }

  try {
    const res = await fetch(`/api/sessions/${sessionId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to cancel session');
    }

    const updated = await res.json();
    const idx = sessions.findIndex(s => s.id === updated.id);
    if (idx !== -1) sessions[idx] = updated;
    renderSessions();
    showToast('🛑 Session CANCELLED and stamped in diagonal!', 'error');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Modal open/close
function openModal() {
  createModal.style.display = 'flex';
  if (!currentUser) {
    loginRequiredNotice.style.display = 'flex';
    submitCreateBtn.disabled = true;
  } else {
    loginRequiredNotice.style.display = 'none';
    submitCreateBtn.disabled = false;
  }
}
function closeModal() {
  createModal.style.display = 'none';
}

openCreateModalBtn.addEventListener('click', openModal);
emptyCreateBtn?.addEventListener('click', openModal);
closeCreateModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);

// Quick Chips
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const targetId = chip.getAttribute('data-target');
    const val = chip.getAttribute('data-val');
    document.getElementById(targetId).value = val;
  });
});

// Form Submission
createSessionForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!currentUser) {
    showToast('Please log in with Discord before launching a session.', 'error');
    window.location.href = '/api/auth/login';
    return;
  }

  const selectedOpt = channelSelect.options[channelSelect.selectedIndex];
  const channelId = channelSelect.value;
  const guildId = selectedOpt?.getAttribute('data-guild-id');

  if (!channelId || !guildId) {
    showToast('Please select a valid Discord channel.', 'error');
    return;
  }

  const partySize = document.querySelector('input[name="partySize"]:checked').value;
  const partyTime = document.getElementById('partyTimeInput').value.trim();
  const voteDeadline = document.getElementById('voteDeadlineInput').value.trim();
  const roleSelectEl = document.getElementById('roleSelect');
  const targetRoleId = roleSelectEl.value || null;
  const targetRoleName = targetRoleId ? (roleSelectEl.options[roleSelectEl.selectedIndex]?.text || '@everyone') : 'Channel';
  const note = document.getElementById('noteInput').value.trim();
  const pingTarget = document.getElementById('pingTargetSelect')?.value || 'everyone';
  const reminderPrior = document.getElementById('reminderPriorSelect')?.value || '30m';

  // Parse party time in user's browser local time to prevent server/client timezone discrepancies
  let partyTimestamp = null;
  const relMatch = partyTime.match(/^(?:in\s+|\+)?(\d+)\s*(m|min|mins|h|hr|hours)?$/i);
  if (relMatch) {
    const val = parseInt(relMatch[1], 10);
    const unit = relMatch[2] ? relMatch[2].toLowerCase() : 'm';
    partyTimestamp = Date.now() + (unit.startsWith('h') ? val * 3600000 : val * 60000);
  } else {
    const m = partyTime.match(/^(\d{1,2})[:h](\d{2})?(?:\s*(am|pm))?$/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const mins = m[2] ? parseInt(m[2], 10) : 0;
      const ampm = (m[3] || '').toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      const d = new Date();
      d.setHours(h, mins, 0, 0);
      if (d.getTime() < Date.now() - 30 * 60 * 1000) d.setDate(d.getDate() + 1);
      partyTimestamp = d.getTime();
    }
  }

  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partySize,
        partyTime,
        partyTimestamp,
        voteDeadline,
        guildId,
        channelId,
        targetRoleId,
        targetRoleName,
        pingTarget,
        reminderPrior,
        note
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to launch session');
    }

    sessions.unshift(data);
    renderSessions();
    closeModal();
    showToast('🚀 Valorant Stacking Vote launched successfully in Discord!');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Load Demo Session
loadDemoBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partySize: 5,
        partyTime: 'in 1h',
        voteDeadline: 'in 45m',
        note: 'Ascendant/Immortal Grind',
        guildId: 'demo_guild',
        channelId: 'demo_chan'
      })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Demo session creation failed');
    }

    await fetchSessions();
    showToast('✨ Demo session created!');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

refreshSessionsBtn.addEventListener('click', fetchSessions);

// Toast helper
function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
  toast.textContent = msg;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4500);
}

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// URL param notifications (e.g. ?login=success)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('login') === 'success') {
  showToast('🎮 Logged in with Discord successfully!');
  window.history.replaceState({}, document.title, window.location.pathname);
} else if (urlParams.get('error')) {
  showToast(`Login failed: ${urlParams.get('error')}`, 'error');
  window.history.replaceState({}, document.title, window.location.pathname);
}

// Initial boot
fetchStatus();
checkAuth();
fetchSessions();
initWebSocket();

setInterval(renderSessions, 10000);
