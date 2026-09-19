// Retro Board — main app logic
const API = '/api';
let currentUser = sessionStorage.getItem('retroUser') || null;
let authToken = localStorage.getItem('retroToken') || null;
let authUsername = localStorage.getItem('retroAuthUser') || null;
let currentRetroId = new URLSearchParams(location.search).get('id');
let ws = null;
let retroIsAdmin = false;

const app = document.getElementById('app');

// ---------- Utilities ----------
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
  return res.json();
}

function toast(message, cls = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${cls}`;
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setAuth(token, username) {
  authToken = token;
  authUsername = username;
  if (token) {
    localStorage.setItem('retroToken', token);
    localStorage.setItem('retroAuthUser', username);
  } else {
    localStorage.removeItem('retroToken');
    localStorage.removeItem('retroAuthUser');
  }
}

async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
  setAuth(null, null);
  renderNav();
  renderHome();
}

function renderNav() {
  const nav = document.querySelector('header nav');
  if (!nav) return;
  const authArea = authUsername
    ? `<span class="nav-user">👤 ${esc(authUsername)}</span><a href="#" id="nav-logout">Logout</a>`
    : `<a href="#" id="nav-login">Login / Register</a>`;
  nav.innerHTML = `
    <a href="/">Home</a>
    <a href="/history.html">History</a>
    <a href="/leaderboard.html">Leaderboard</a>
    ${authArea}`;
  const loginLink = document.getElementById('nav-login');
  if (loginLink) loginLink.onclick = e => { e.preventDefault(); openAuthModal(); };
  const logoutLink = document.getElementById('nav-logout');
  if (logoutLink) logoutLink.onclick = e => { e.preventDefault(); logout(); };
}

// ---------- Auth modal ----------
function openAuthModal(mode = 'login') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${mode === 'login' ? 'Log In' : 'Create Account'}</h3>
      <p class="muted" style="font-size:0.85rem">Admins log in to create and manage their own retro spaces. Participants don't need an account.</p>
      <div class="form-group">
        <label>Username</label>
        <input id="auth-user" autocomplete="username">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="auth-pass" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="auth-switch">${mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}</button>
        <button class="btn" id="auth-go">${mode === 'login' ? 'Log In' : 'Register'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#auth-switch').onclick = () => { overlay.remove(); openAuthModal(mode === 'login' ? 'register' : 'login'); };
  overlay.querySelector('#auth-user').focus();
  const submit = async () => {
    const username = overlay.querySelector('#auth-user').value.trim();
    const password = overlay.querySelector('#auth-pass').value;
    if (!username || !password) return toast('Username and password are required', 'points');
    try {
      const result = await api(mode === 'login' ? '/login' : '/register', {
        method: 'POST', body: JSON.stringify({ username, password }),
      });
      setAuth(result.token, result.username);
      overlay.remove();
      renderNav();
      toast(`Welcome, ${result.username}! 🎉`);
      if (location.pathname === '/' || location.pathname === '/index.html') renderHome();
    } catch (err) {
      toast(err.message, 'points');
    }
  };
  overlay.querySelector('#auth-go').onclick = submit;
  overlay.addEventListener('keydown', e => e.key === 'Enter' && submit());
}

// ---------- Retro templates ----------
const TEMPLATES = {
  classic: {
    name: 'Classic (Went Well / Didn\'t Go Well / Actions)',
    columns: {
      went_well: '😄 What Went Well',
      didnt_go_well: "😕 What Didn't Go Well",
      action: '💡 Action Items',
    },
  },
  ssc: {
    name: 'Start / Stop / Continue',
    columns: {
      start_doing: '🚀 Start Doing',
      stop_doing: '🛑 Stop Doing',
      continue_doing: '🔁 Continue Doing',
    },
  },
  msg: {
    name: 'Mad / Sad / Glad',
    columns: { mad: '😠 Mad', sad: '😢 Sad', glad: '😊 Glad' },
  },
  '4ls': {
    name: '4Ls (Liked / Learned / Lacked / Longed for)',
    columns: {
      liked: '👍 Liked',
      learned: '🧠 Learned',
      lacked: '🕳 Lacked',
      longed_for: '✨ Longed For',
    },
  },
};

// ---------- Home ----------
async function renderHome() {
  renderNav();
  const hero = `
    <div class="home-hero">
      <h2>Make your retros fun and actionable 🎉</h2>
      <p class="muted">Create a retrospective, share the link with your team, and track commitments together.</p>
      ${authUsername ? '' : '<p class="muted" style="font-size:0.9rem">💡 <strong>Tip:</strong> log in to create and manage your own retro spaces (close, reopen, delete, anonymous mode).</p>'}
      <div class="join-form">
        <input id="retro-title" placeholder="Retro title (e.g. Sprint 42 Retro)" style="min-width:260px">
        <input id="retro-sprint" placeholder="Sprint (optional)" style="max-width:150px">
        <select id="retro-template">
          ${Object.entries(TEMPLATES).map(([id, t]) => `<option value="${id}">${t.name}</option>`).join('')}
        </select>
        <label class="check-label"><input type="checkbox" id="retro-anon"> Anonymous cards</label>
        <button class="btn" id="create-retro">Create Retro</button>
      </div>
      <div class="join-form">
        <input id="join-id" placeholder="Retro ID to join" style="max-width:200px">
        <button class="btn secondary" id="join-retro">Join Retro</button>
      </div>
    </div>`;
  app.innerHTML = hero + `<div id="dashboard-section"></div>`;

  document.getElementById('create-retro').onclick = async () => {
    const title = document.getElementById('retro-title').value.trim();
    if (!title) return toast('Please enter a title', 'points');
    const sprint = document.getElementById('retro-sprint').value.trim();
    const template = document.getElementById('retro-template').value;
    const is_anonymous = document.getElementById('retro-anon').checked;
    if (!authUsername) {
      const ok = confirm('You are not logged in. Without an account you won\'t be able to manage this retro later (close, reopen, delete).\n\nCreate it anyway?');
      if (!ok) return openAuthModal('register');
    }
    await createRetroWithCarryOver(title, sprint, template, is_anonymous);
  };
  document.getElementById('join-retro').onclick = () => {
    const id = document.getElementById('join-id').value.trim();
    if (id) location.href = `/retro.html?id=${id}`;
  };

  renderCommitmentsDashboard();
}

// Create a retro; if the previous retro has pending commitments, offer to carry them over
async function createRetroWithCarryOver(title, sprint, template, is_anonymous) {
  const retros = await api('/retros');
  const previous = retros.find(r => r.status === 'open' && r.card_count > 0);
  let carry_over_from = null;
  if (previous) {
    const pending = await api(`/retros/${previous.id}/pending-commitments`);
    if (pending.length > 0) {
      const list = pending.map(cm => `• ${cm.description} — ${cm.assignee}`).join('\n');
      const ok = confirm(
        `The retro "${previous.title}" has ${pending.length} pending commitment(s):\n\n${list}\n\n` +
        `Import them into the new retro?`);
      if (ok) carry_over_from = previous.id;
    }
  }
  const retro = await api('/retros', {
    method: 'POST',
    body: JSON.stringify({ title, sprint, template, is_anonymous, carry_over_from }),
  });
  location.href = `/retro.html?id=${retro.id}`;
}

// ---------- Commitments dashboard (home) ----------
async function renderCommitmentsDashboard() {
  const section = document.getElementById('dashboard-section');
  if (!section) return;
  let items;
  try {
    items = await api('/commitments-dashboard');
  } catch {
    section.innerHTML = '';
    return;
  }
  if (!items.length) {
    section.innerHTML = '<p class="muted" style="text-align:center">No pending commitments. Great job! 🎉</p>';
    return;
  }
  const overdue = items.filter(i => i.is_overdue);
  const onTrack = items.filter(i => !i.is_overdue);
  const renderItem = cm => `
    <div class="dash-item ${cm.is_overdue ? 'overdue' : ''}">
      <div class="dash-desc">${cm.is_overdue ? '⚠️ ' : ''}${esc(cm.description)}</div>
      <div class="dash-meta">
        <span class="assignee">👤 ${esc(cm.assignee)}</span>
        ${cm.due_date ? `<span class="due">📅 ${cm.due_date}</span>` : ''}
        <a href="/retro.html?id=${cm.retro_id}" class="dash-retro">${esc(cm.retro_title)}</a>
      </div>
    </div>`;
  section.innerHTML = `
    <div class="dashboard">
      <div class="dashboard-header">
        <h2>📋 Pending Commitments <span class="badge">${items.length}</span></h2>
        <button class="btn small secondary" id="copy-summary">📋 Copy Summary for Slack/Email</button>
      </div>
      ${overdue.length ? `<h3 class="overdue-title">⚠️ Overdue (${overdue.length})</h3>${overdue.map(renderItem).join('')}` : ''}
      ${onTrack.length ? `<h3>On Track (${onTrack.length})</h3>${onTrack.map(renderItem).join('')}` : ''}
    </div>`;
  document.getElementById('copy-summary').onclick = () => copyCommitmentsSummary(items);
}

function copyCommitmentsSummary(items) {
  const byAssignee = {};
  for (const cm of items) {
    (byAssignee[cm.assignee] = byAssignee[cm.assignee] || []).push(cm);
  }
  const lines = ['📋 Pending commitments — Retro Board', ''];
  for (const [assignee, list] of Object.entries(byAssignee)) {
    lines.push(`*${assignee}*`);
    for (const cm of list) {
      const due = cm.due_date ? ` (due ${cm.due_date}${cm.is_overdue ? ' — OVERDUE ⚠️' : ''})` : '';
      lines.push(`  • ${cm.description}${due}`);
    }
    lines.push('');
  }
  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => toast('Summary copied! Paste it in Slack or email ✅'))
    .catch(() => toast('Could not copy to clipboard', 'points'));
}

// ---------- Retro board ----------
async function renderRetro() {
  renderNav();
  if (!currentRetroId) return renderHome();
  if (!currentUser) return renderJoinPrompt();

  const retro = await api(`/retros/${currentRetroId}`);
  retroIsAdmin = !!retro.is_admin;
  const participants = await api(`/retros/${currentRetroId}/participants`);
  const cards = await api(`/retros/${currentRetroId}/cards`);
  const commitments = await api(`/retros/${currentRetroId}/commitments`);
  const template = TEMPLATES[retro.template] || TEMPLATES.classic;

  app.innerHTML = `
    <div class="retro-header">
      <h2>${esc(retro.title)} ${retro.status === 'closed' ? '✅' : '🟢'} ${retro.is_anonymous ? '🎭' : ''}</h2>
      <p class="muted">
        ${retro.is_anonymous ? '🎭 Anonymous mode — card authors are hidden. ' : ''}
        ${retro.created_by ? `Admin: <strong>${esc(retro.created_by)}</strong>. ` : ''}
        You are <strong>${esc(currentUser)}</strong> — share this URL: <code>${location.href}</code>
      </p>
      <div class="participants-bar" id="participants-bar"></div>
      <div style="margin-top:8px">
        ${retroIsAdmin ? `
          <button class="btn small secondary" id="close-retro" ${retro.status === 'closed' ? 'disabled' : ''}>Close Retro</button>
          <button class="btn small secondary" id="reopen-retro" ${retro.status === 'open' ? 'disabled' : ''}>Reopen Retro</button>
          <button class="btn small danger" id="delete-retro">Delete Retro</button>
        ` : ''}
        <span class="muted" id="votes-counter" style="margin-left:8px"></span>
      </div>
    </div>
    <div class="board" id="board"></div>
    <h2 style="margin-top:40px">📋 Commitments</h2>
    <p class="muted">Drag cards between columns. Mark as done to award 10 points!</p>
    <div class="kanban" id="kanban"></div>
    <div style="margin-top:24px">
      <button class="btn" id="add-commitment">+ Add Commitment</button>
      <a class="btn secondary" href="${API}/retros/${currentRetroId}/acta" download style="text-decoration:none;display:inline-block;margin-left:8px">⬇ Export Minutes (acta)</a>
    </div>`;

  renderParticipants(participants);
  renderBoard(cards, template);
  renderKanban(commitments);
  connectWs();
  wireRetroEvents();
}

function renderJoinPrompt() {
  app.innerHTML = `
    <div class="home-hero">
      <h2>Join this retrospective 👋</h2>
      <div class="join-form">
        <input id="join-name" placeholder="Your name" style="min-width:240px">
        <button class="btn" id="join-btn">Join</button>
      </div>
    </div>`;
  const join = async () => {
    const name = document.getElementById('join-name').value.trim();
    if (!name) return toast('Please enter your name', 'points');
    currentUser = name;
    sessionStorage.setItem('retroUser', name);
    await api(`/retros/${currentRetroId}/join`, { method: 'POST', body: JSON.stringify({ name }) });
    renderRetro();
  };
  document.getElementById('join-btn').onclick = join;
  document.getElementById('join-name').addEventListener('keydown', e => e.key === 'Enter' && join());
}

function renderParticipants(participants) {
  const bar = document.getElementById('participants-bar');
  bar.innerHTML = participants.map(p => `<span class="participant-chip">👤 ${esc(p.name)}</span>`).join('');
}

function renderBoard(cards, template) {
  const board = document.getElementById('board');
  board.style.gridTemplateColumns = `repeat(${Object.keys(template.columns).length}, 1fr)`;
  board.innerHTML = Object.entries(template.columns).map(([col, label]) => `
    <div class="column ${col}" data-col="${col}">
      <h3>${label}</h3>
      <div class="cards" data-col="${col}">
        ${cards.filter(c => c.column_type === col).map(renderCard).join('')}
      </div>
      <div class="add-card-form">
        <textarea placeholder="Add a card..." data-col="${col}"></textarea>
        <button class="btn small add-card" data-col="${col}">Add Card</button>
      </div>
    </div>`).join('');

  board.querySelectorAll('.add-card').forEach(btn => {
    btn.onclick = async () => {
      const col = btn.dataset.col;
      const textarea = board.querySelector(`textarea[data-col="${col}"]`);
      const content = textarea.value.trim();
      if (!content) return;
      await api(`/retros/${currentRetroId}/cards`, {
        method: 'POST',
        body: JSON.stringify({ column_type: col, content, author: currentUser }),
      });
      textarea.value = '';
    };
  });

  board.querySelectorAll('.vote-btn').forEach(btn => {
    btn.onclick = async () => {
      try {
        await api(`/cards/${btn.dataset.id}/vote`, { method: 'POST', body: JSON.stringify({ voter: currentUser }) });
      } catch (err) {
        toast(err.message, 'points');
      }
    };
  });
  board.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => api(`/cards/${btn.dataset.id}`, { method: 'DELETE' });
  });
  board.querySelectorAll('.edit-btn').forEach(btn => {
    btn.onclick = () => openEditCardModal(btn.dataset.id, btn.dataset.content);
  });
}

function renderCard(card) {
  return `
    <div class="card" data-id="${card.id}">
      <div class="content">${esc(card.content)}</div>
      <div class="meta">
        <span>by ${esc(card.author)}</span>
        <span>
          <button class="vote-btn" data-id="${card.id}" title="Vote">👍 ${card.votes}</button>
          <button class="edit-btn" data-id="${card.id}" data-content="${esc(card.content)}" title="Edit">✏️</button>
          <button class="delete-btn" data-id="${card.id}" title="Delete">🗑</button>
        </span>
      </div>
    </div>`;
}

function openEditCardModal(cardId, currentContent) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Edit Card</h3>
      <div class="form-group">
        <textarea id="card-content">${currentContent}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="card-cancel">Cancel</button>
        <button class="btn" id="card-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#card-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#card-save').onclick = async () => {
    const content = overlay.querySelector('#card-content').value.trim();
    if (!content) return toast('Content is required', 'points');
    await api(`/cards/${cardId}`, { method: 'PUT', body: JSON.stringify({ content }) });
    overlay.remove();
  };
}

// ---------- Commitments Kanban ----------
const KANBAN_LABELS = { pending: '⏳ Pending', in_progress: '🔄 In Progress', done: '✅ Done' };

function renderKanban(commitments) {
  const kanban = document.getElementById('kanban');
  kanban.innerHTML = Object.keys(KANBAN_LABELS).map(status => `
    <div class="kcolumn ${status}" data-status="${status}">
      <h3>${KANBAN_LABELS[status]}</h3>
      <div class="kcards" data-status="${status}">
        ${commitments.filter(c => c.status === status).map(renderCommitment).join('')}
      </div>
    </div>`).join('');

  // Drag & drop
  kanban.querySelectorAll('.commitment').forEach(el => {
    el.draggable = true;
    el.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', el.dataset.id));
  });
  kanban.querySelectorAll('.kcards').forEach(zone => {
    zone.addEventListener('dragover', e => e.preventDefault());
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const status = zone.dataset.status;
      const cm = commitments.find(c => c.id === Number(id));
      if (cm && cm.status !== status) {
        await api(`/commitments/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      }
    });
  });

  kanban.querySelectorAll('.delete-cm').forEach(btn => {
    btn.onclick = () => api(`/commitments/${btn.dataset.id}`, { method: 'DELETE' });
  });
  kanban.querySelectorAll('.edit-cm').forEach(btn => {
    btn.onclick = () => openCommitmentModal(commitments.find(c => c.id === Number(btn.dataset.id)));
  });
}

function renderCommitment(cm) {
  const overdue = cm.due_date && cm.status !== 'done' && new Date(cm.due_date) < new Date();
  return `
    <div class="commitment ${cm.status} ${overdue ? 'overdue' : ''}" data-id="${cm.id}">
      <div class="desc">${esc(cm.description)}</div>
      <div class="meta">
        <span class="assignee">👤 ${esc(cm.assignee)}</span>
        <span class="due">${cm.due_date ? '📅 ' + cm.due_date : ''}</span>
      </div>
      <div class="meta" style="margin-top:6px">
        <span>
          <button class="edit-cm small" data-id="${cm.id}">✏️</button>
          <button class="delete-cm small" data-id="${cm.id}">🗑</button>
        </span>
      </div>
    </div>`;
}

function openCommitmentModal(existing = null) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${existing ? 'Edit Commitment' : 'New Commitment'}</h3>
      <div class="form-group">
        <label>Description</label>
        <textarea id="cm-desc">${existing ? esc(existing.description) : ''}</textarea>
      </div>
      <div class="form-group">
        <label>Assignee</label>
        <input id="cm-assignee" value="${existing ? esc(existing.assignee) : esc(currentUser)}">
      </div>
      <div class="form-group">
        <label>Due date</label>
        <input type="date" id="cm-due" value="${existing?.due_date || ''}">
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="cm-cancel">Cancel</button>
        <button class="btn" id="cm-save">${existing ? 'Save' : 'Create'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#cm-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#cm-save').onclick = async () => {
    const description = overlay.querySelector('#cm-desc').value.trim();
    const assignee = overlay.querySelector('#cm-assignee').value.trim();
    const due_date = overlay.querySelector('#cm-due').value;
    if (!description || !assignee) return toast('Description and assignee are required', 'points');
    if (existing) {
      await api(`/commitments/${existing.id}`, { method: 'PUT', body: JSON.stringify({ description, assignee, due_date }) });
    } else {
      await api(`/retros/${currentRetroId}/commitments`, { method: 'POST', body: JSON.stringify({ description, assignee, due_date }) });
    }
    overlay.remove();
  };
}

// ---------- WebSocket live sync ----------
function connectWs() {
  if (ws) ws.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?retroId=${currentRetroId}`);
  ws.onmessage = e => {
    const { event, payload } = JSON.parse(e.data);
    handleLiveEvent(event, payload);
  };
}

function handleLiveEvent(event, payload) {
  switch (event) {
    case 'card_added':
      document.querySelector(`.cards[data-col="${payload.column_type}"]`)?.insertAdjacentHTML('beforeend', renderCard(payload));
      break;
    case 'card_updated': {
      const el = document.querySelector(`.card[data-id="${payload.id}"]`);
      if (el) el.outerHTML = renderCard(payload);
      break;
    }
    case 'card_deleted':
      document.querySelector(`.card[data-id="${payload.id}"]`)?.remove();
      break;
    case 'votes_changed': {
      const btn = document.querySelector(`.vote-btn[data-id="${payload.cardId}"]`);
      if (btn) btn.innerHTML = `👍 ${payload.votes}`;
      refreshVotesCounter();
      break;
    }
    case 'commitment_added':
    case 'commitment_updated':
    case 'commitment_deleted':
      refreshCommitments();
      break;
    case 'participants_changed':
      refreshParticipants();
      break;
    case 'points_awarded':
      toast(`🎉 ${payload.participant} earned ${payload.amount} points!`, 'points');
      break;
    case 'retro_closed':
      toast('This retro has been closed ✅');
      break;
    case 'retro_reopened':
      toast('This retro has been reopened 🟢');
      break;
    case 'retro_deleted':
      toast('This retro has been deleted by the admin', 'points');
      setTimeout(() => { location.href = '/'; }, 2000);
      break;
  }
}

async function refreshCommitments() {
  const commitments = await api(`/retros/${currentRetroId}/commitments`);
  renderKanban(commitments);
}

async function refreshParticipants() {
  const participants = await api(`/retros/${currentRetroId}/participants`);
  renderParticipants(participants);
}

// ---------- Retro actions ----------
async function refreshVotesCounter() {
  const el = document.getElementById('votes-counter');
  if (!el) return;
  try {
    const { used, max } = await api(`/retros/${currentRetroId}/votes-used?voter=${encodeURIComponent(currentUser)}`);
    el.textContent = `👍 ${used}/${max} votes used`;
  } catch { /* counter is non-critical */ }
}

function wireRetroEvents() {
  const closeBtn = document.getElementById('close-retro');
  if (closeBtn) closeBtn.onclick = async () => {
    if (confirm('Close this retro? It will move to History.')) {
      await api(`/retros/${currentRetroId}/close`, { method: 'POST' });
      toast('Retro closed ✅');
    }
  };
  const reopenBtn = document.getElementById('reopen-retro');
  if (reopenBtn) reopenBtn.onclick = async () => {
    await api(`/retros/${currentRetroId}/reopen`, { method: 'POST' });
    toast('Retro reopened 🟢');
  };
  const deleteBtn = document.getElementById('delete-retro');
  if (deleteBtn) deleteBtn.onclick = async () => {
    if (confirm('⚠️ Delete this retro permanently? All cards, commitments and points will be lost.')) {
      await api(`/retros/${currentRetroId}`, { method: 'DELETE' });
      location.href = '/';
    }
  };
  document.getElementById('add-commitment').onclick = () => openCommitmentModal();
  refreshVotesCounter();
}

// ---------- Router ----------
if (location.pathname === '/retro.html') {
  renderRetro();
} else {
  renderHome();
}
