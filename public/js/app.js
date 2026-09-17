// Retro Board — main app logic
const API = '/api';
let currentUser = sessionStorage.getItem('retroUser') || null;
let currentRetroId = new URLSearchParams(location.search).get('id');
let ws = null;

const app = document.getElementById('app');

// ---------- Utilities ----------
async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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

// ---------- Home ----------
function renderHome() {
  app.innerHTML = `
    <div class="home-hero">
      <h2>Make your retros fun and actionable 🎉</h2>
      <p class="muted">Create a retrospective, share the link with your team, and track commitments together.</p>
      <div class="join-form">
        <input id="retro-title" placeholder="Retro title (e.g. Sprint 42 Retro)" style="min-width:280px">
        <input id="retro-sprint" placeholder="Sprint (optional)" style="max-width:160px">
        <button class="btn" id="create-retro">Create Retro</button>
      </div>
      <div class="join-form">
        <input id="join-id" placeholder="Retro ID to join" style="max-width:200px">
        <button class="btn secondary" id="join-retro">Join Retro</button>
      </div>
    </div>`;
  document.getElementById('create-retro').onclick = async () => {
    const title = document.getElementById('retro-title').value.trim();
    if (!title) return toast('Please enter a title', 'points');
    const retro = await api('/retros', { method: 'POST', body: JSON.stringify({ title, sprint: document.getElementById('retro-sprint').value.trim() }) });
    location.href = `/retro.html?id=${retro.id}`;
  };
  document.getElementById('join-retro').onclick = () => {
    const id = document.getElementById('join-id').value.trim();
    if (id) location.href = `/retro.html?id=${id}`;
  };
}

// ---------- Retro board ----------
async function renderRetro() {
  if (!currentRetroId) return renderHome();
  if (!currentUser) return renderJoinPrompt();

  const retro = await api(`/retros/${currentRetroId}`);
  const participants = await api(`/retros/${currentRetroId}/participants`);
  const cards = await api(`/retros/${currentRetroId}/cards`);
  const commitments = await api(`/retros/${currentRetroId}/commitments`);

  app.innerHTML = `
    <div class="retro-header">
      <h2>${esc(retro.title)} ${retro.status === 'closed' ? '✅' : '🟢'}</h2>
      <p class="muted">You are <strong>${esc(currentUser)}</strong> — share this URL with your team: <code>${location.href}</code></p>
      <div class="participants-bar" id="participants-bar"></div>
      <button class="btn small secondary" id="close-retro" ${retro.status === 'closed' ? 'disabled' : ''}>Close Retro</button>
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
  renderBoard(cards);
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

const COLUMN_LABELS = {
  went_well: '😄 What Went Well',
  didnt_go_well: '😕 What Didn\'t Go Well',
  action: '💡 Action Items',
};

function renderBoard(cards) {
  const board = document.getElementById('board');
  board.innerHTML = Object.keys(COLUMN_LABELS).map(col => `
    <div class="column ${col}" data-col="${col}">
      <h3>${COLUMN_LABELS[col]}</h3>
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
    btn.onclick = () => api(`/cards/${btn.dataset.id}/vote`, { method: 'POST', body: JSON.stringify({ voter: currentUser }) });
  });
  board.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => api(`/cards/${btn.dataset.id}`, { method: 'DELETE' });
  });
}

function renderCard(card) {
  const voted = card.voters?.includes(currentUser);
  return `
    <div class="card" data-id="${card.id}">
      <div class="content">${esc(card.content)}</div>
      <div class="meta">
        <span>by ${esc(card.author)}</span>
        <span>
          <button class="vote-btn ${voted ? 'voted' : ''}" data-id="${card.id}" title="Vote">👍 ${card.votes}</button>
          <button class="delete-btn" data-id="${card.id}" title="Delete">🗑</button>
        </span>
      </div>
    </div>`;
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
function wireRetroEvents() {
  document.getElementById('close-retro').onclick = async () => {
    if (confirm('Close this retro? It will move to History.')) {
      await api(`/retros/${currentRetroId}/close`, { method: 'POST' });
      toast('Retro closed ✅');
    }
  };
  document.getElementById('add-commitment').onclick = () => openCommitmentModal();
}

// ---------- Router ----------
if (location.pathname === '/retro.html') {
  renderRetro();
} else {
  renderHome();
}
