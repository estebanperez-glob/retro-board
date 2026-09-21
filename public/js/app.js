// Retro Board — main app logic (uses shared Auth from auth.js)
let currentUser = sessionStorage.getItem('retroUser') || null;
let currentRetroId = new URLSearchParams(location.search).get('id');
let ws = null;
let retroIsAdmin = false;
let retroJoinCode = null;

const app = document.getElementById('app');

function toast(message, cls = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${cls}`;
  setTimeout(() => el.classList.add('hidden'), 3000);
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
  const graffitiTitle = 'RETRO BOARD'.split('').map((ch, i) =>
    ch === ' ' ? '<span class="space"> </span>' : `<span class="g${i % 5}">${ch}</span>`
  ).join('');
  const hero = `
    <section class="graffiti-hero">
      <h2 class="graffiti-title" aria-label="Retro Board">${graffitiTitle}</h2>
      <p class="graffiti-tagline">Spray your ideas. Vote the best. Ship the fixes. 🎨</p>
    </section>
    <div class="home-hero">
      <h2>Make your retros fun and actionable 🎉</h2>
      <p class="muted">Create a retrospective, share the invitation link with your team, and track commitments together.</p>
      ${Auth.username ? '' : '<p class="muted" style="font-size:0.9rem">💡 <strong>Tip:</strong> log in to create and manage your own retro spaces. Participants join with the invitation link — no account needed.</p>'}
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
    if (!Auth.token) return Auth.openAuthModal('register');
    const title = document.getElementById('retro-title').value.trim();
    if (!title) return toast('Please enter a title', 'points');
    const sprint = document.getElementById('retro-sprint').value.trim();
    const template = document.getElementById('retro-template').value;
    const is_anonymous = document.getElementById('retro-anon').checked;
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
  const retros = await Auth.api('/retros');
  const previous = retros.find(r => r.status === 'open' && r.card_count > 0);
  let carry_over_from = null;
  if (previous) {
    const pending = await Auth.api(`/retros/${previous.id}/pending-commitments`);
    if (pending.length > 0) {
      const list = pending.map(cm => `• ${cm.description} — ${cm.assignee}`).join('\n');
      const ok = confirm(
        `The retro "${previous.title}" has ${pending.length} pending commitment(s):\n\n${list}\n\n` +
        `Import them into the new retro?`);
      if (ok) carry_over_from = previous.id;
    }
  }
  const retro = await Auth.api('/retros', {
    method: 'POST',
    body: JSON.stringify({ title, sprint, template, is_anonymous, carry_over_from }),
  });
  // Store the admin's participant token so they land directly in the board
  sessionStorage.setItem('retroParticipantToken', retro.participant_token);
  sessionStorage.setItem('retroParticipantRetroId', String(retro.id));
  sessionStorage.setItem(`retroUser_${retro.id}`, Auth.username);
  location.href = `/retro.html?id=${retro.id}`;
}

// ---------- Commitments dashboard (home) ----------
async function renderCommitmentsDashboard() {
  const section = document.getElementById('dashboard-section');
  if (!section) return;
  if (!Auth.token) { section.innerHTML = ''; return; }
  let items;
  try {
    items = await Auth.api('/commitments-dashboard');
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
      <div class="dash-desc">${cm.is_overdue ? '⚠️ ' : ''}${Auth.esc(cm.description)}</div>
      <div class="dash-meta">
        <span class="assignee">👤 ${Auth.esc(cm.assignee)}</span>
        ${cm.due_date ? `<span class="due">📅 ${cm.due_date}</span>` : ''}
        <a href="/retro.html?id=${cm.retro_id}" class="dash-retro">${Auth.esc(cm.retro_title)}</a>
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
  if (!currentRetroId) return renderHome();

  // Restore participant identity for this retro (per-retro, in sessionStorage)
  const storedToken = sessionStorage.getItem('retroParticipantToken');
  const storedRetroId = sessionStorage.getItem('retroParticipantRetroId');
  if (storedToken && storedRetroId === currentRetroId) {
    currentUser = sessionStorage.getItem(`retroUser_${currentRetroId}`);
  }

  // If not a member yet, show the join screen (needs name + invitation code)
  let retro;
  try {
    retro = await Auth.api(`/retros/${currentRetroId}`);
    retroIsAdmin = !!retro.is_admin;
    retroJoinCode = retro.join_code || null;
  } catch (err) {
    return renderJoinScreen(err.message);
  }

  const participants = await Auth.api(`/retros/${currentRetroId}/participants`);
  const cards = await Auth.api(`/retros/${currentRetroId}/cards`);
  const commitments = await Auth.api(`/retros/${currentRetroId}/commitments`);
  const template = TEMPLATES[retro.template] || TEMPLATES.classic;

  app.innerHTML = `
    <div class="retro-header">
      <h2>${Auth.esc(retro.title)} ${retro.status === 'closed' ? '✅' : '🟢'} ${retro.is_anonymous ? '🎭' : ''}</h2>
      <p class="muted">
        ${retro.is_anonymous ? '🎭 Anonymous mode — card authors are hidden. ' : ''}
        ${retro.created_by ? `Admin: <strong>${Auth.esc(retro.created_by)}</strong>. ` : ''}
        You are <strong>${Auth.esc(currentUser)}</strong>.
      </p>
      ${retroIsAdmin ? `
        <div class="invite-box">
          <span class="muted">Invitation link:</span>
          <code id="invite-link">${location.origin}/retro.html?id=${retro.id}&key=${retroJoinCode}</code>
          <button class="btn small secondary" id="copy-invite">Copy</button>
        </div>` : ''}
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
      <a class="btn secondary" href="/api/retros/${currentRetroId}/acta?token=${encodeURIComponent(storedToken || '')}" download style="text-decoration:none;display:inline-block;margin-left:8px">⬇ Export Minutes (acta)</a>
      <button class="btn secondary" id="export-pdf" style="margin-left:8px">🖨 Export PDF</button>
    </div>`;

  renderParticipants(participants);
  renderBoard(cards, template);
  renderKanban(commitments);
  connectWs();
  wireRetroEvents();
}

// Join screen: shown when you don't belong to this retro yet
function renderJoinScreen(message) {
  // Fetch minimal public info to show what you're joining
  fetch(`/api/retros/${currentRetroId}/preview`)
    .then(r => r.ok ? r.json() : null)
    .then(preview => {
      const key = new URLSearchParams(location.search).get('key') || '';
      app.innerHTML = `
        <div class="home-hero">
          <h2>Join ${preview ? `"${Auth.esc(preview.title)}"` : 'this retrospective'} 👋</h2>
          ${message ? `<p class="muted" style="color:var(--red)">${Auth.esc(message)}</p>` : ''}
          <div class="join-form">
            <input id="join-name" placeholder="Your name" style="min-width:220px">
            <input id="join-code" placeholder="Invitation code" value="${Auth.esc(key)}" style="max-width:180px">
            <button class="btn" id="join-btn">Join</button>
          </div>
          <p class="muted" style="font-size:0.85rem">The invitation code comes in the link the admin shared with you.</p>
        </div>`;
      const join = async () => {
        const name = document.getElementById('join-name').value.trim();
        const join_code = document.getElementById('join-code').value.trim();
        if (!name) return toast('Please enter your name', 'points');
        try {
          const result = await Auth.api(`/retros/${currentRetroId}/join`, {
            method: 'POST', body: JSON.stringify({ name, join_code }),
          });
          currentUser = result.name;
          sessionStorage.setItem('retroParticipantToken', result.access_token);
          sessionStorage.setItem('retroParticipantRetroId', currentRetroId);
          sessionStorage.setItem(`retroUser_${currentRetroId}`, result.name);
          renderRetro();
        } catch (err) {
          toast(err.message, 'points');
        }
      };
      document.getElementById('join-btn').onclick = join;
      document.getElementById('join-name').addEventListener('keydown', e => e.key === 'Enter' && join());
      document.getElementById('join-code').addEventListener('keydown', e => e.key === 'Enter' && join());
    });
}

function renderParticipants(participants) {
  const bar = document.getElementById('participants-bar');
  bar.innerHTML = participants.map(p => `<span class="participant-chip">👤 ${Auth.esc(p.name)}</span>`).join('');
}

function renderBoard(cards, template) {
  const board = document.getElementById('board');
  board.style.gridTemplateColumns = `repeat(${Object.keys(template.columns).length}, 1fr)`;
  board.innerHTML = Object.entries(template.columns).map(([col, label]) => `
    <div class="column ${col}" data-col="${col}">
      <h3>${label}</h3>
      <div class="cards" data-col="${col}">
        ${cards.filter(c => c.column_type === col).map(renderCard).join('') ||
          '<p class="empty-column muted">No cards yet — be the first to add one! 🎨</p>'}
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
      await Auth.api(`/retros/${currentRetroId}/cards`, {
        method: 'POST',
        body: JSON.stringify({ column_type: col, content, author: currentUser }),
      });
      textarea.value = '';
    };
  });

  board.querySelectorAll('.vote-btn').forEach(btn => {
    btn.onclick = async () => {
      try {
        await Auth.api(`/cards/${btn.dataset.id}/vote`, { method: 'POST', body: JSON.stringify({ voter: currentUser }) });
      } catch (err) {
        toast(err.message, 'points');
      }
    };
  });
  board.querySelectorAll('.delete-btn').forEach(btn => {
    btn.onclick = () => Auth.api(`/cards/${btn.dataset.id}`, { method: 'DELETE' });
  });
  board.querySelectorAll('.edit-btn').forEach(btn => {
    btn.onclick = () => openEditCardModal(btn.dataset.id, btn.dataset.content);
  });
}

function renderCard(card) {
  return `
    <div class="card" data-id="${card.id}" draggable="true">
      <div class="content">${Auth.esc(card.content)}</div>
      <div class="meta">
        <span>by ${Auth.esc(card.author)}</span>
        <span>
          <button class="vote-btn" data-id="${card.id}" title="Vote">👍 ${card.votes}</button>
          <button class="edit-btn" data-id="${card.id}" data-content="${Auth.esc(card.content)}" title="Edit">✏️</button>
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
    await Auth.api(`/cards/${cardId}`, { method: 'PUT', body: JSON.stringify({ content }) });
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

  // Drag & drop via delegation on the kanban container (survives re-renders)
  if (!kanban.dataset.wired) {
    kanban.dataset.wired = 'true';
    kanban.addEventListener('dragstart', e => {
      const cmEl = e.target.closest('.commitment');
      if (!cmEl) return;
      e.dataTransfer.setData('text/plain', cmEl.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    kanban.addEventListener('dragover', e => {
      const zone = e.target.closest('.kcards');
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    kanban.addEventListener('dragleave', e => {
      const zone = e.target.closest('.kcards');
      if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    kanban.addEventListener('drop', async e => {
      const zone = e.target.closest('.kcards');
      if (!zone) return;
      e.preventDefault();
      zone.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      const status = zone.dataset.status;
      const cmEl = kanban.querySelector(`.commitment[data-id="${id}"]`);
      if (cmEl && cmEl.closest('.kcards') === zone) return; // already there
      try {
        await Auth.api(`/commitments/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
        // Optimistic move; WS refreshCommitments re-renders with server truth
        if (cmEl) zone.appendChild(cmEl);
      } catch (err) {
        toast(err.message, 'points');
      }
    });
    kanban.addEventListener('click', e => {
      const del = e.target.closest('.delete-cm');
      if (del) { Auth.api(`/commitments/${del.dataset.id}`, { method: 'DELETE' }).catch(err => toast(err.message, 'points')); return; }
      const edit = e.target.closest('.edit-cm');
      if (edit) {
        const cm = commitments.find(c => c.id === Number(edit.dataset.id));
        if (cm) openCommitmentModal(cm);
      }
    });
  }
}

function renderCommitment(cm) {
  const overdue = cm.due_date && cm.status !== 'done' && new Date(cm.due_date) < new Date();
  return `
    <div class="commitment ${cm.status} ${overdue ? 'overdue' : ''}" data-id="${cm.id}" draggable="true">
      <div class="desc">${Auth.esc(cm.description)}</div>
      <div class="meta">
        <span class="assignee">👤 ${Auth.esc(cm.assignee)}</span>
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
        <textarea id="cm-desc">${existing ? Auth.esc(existing.description) : ''}</textarea>
      </div>
      <div class="form-group">
        <label>Assignee</label>
        <input id="cm-assignee" value="${existing ? Auth.esc(existing.assignee) : Auth.esc(currentUser)}">
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
      await Auth.api(`/commitments/${existing.id}`, { method: 'PUT', body: JSON.stringify({ description, assignee, due_date }) });
    } else {
      await Auth.api(`/retros/${currentRetroId}/commitments`, { method: 'POST', body: JSON.stringify({ description, assignee, due_date }) });
    }
    overlay.remove();
  };
}

// ---------- WebSocket live sync ----------
let wsReconnectDelay = 1000;
let wsReconnectTimer = null;

function connectWs() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (ws) { ws.onclose = null; ws.close(); }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const query = new URLSearchParams({ retroId: currentRetroId });
  if (Auth.token) query.set('userToken', Auth.token);
  const participantToken = sessionStorage.getItem('retroParticipantToken');
  if (participantToken) query.set('participantToken', participantToken);
  ws = new WebSocket(`${proto}://${location.host}/ws?${query}`);
  ws.onopen = () => { wsReconnectDelay = 1000; };
  ws.onmessage = e => {
    const { event, payload } = JSON.parse(e.data);
    handleLiveEvent(event, payload);
  };
  // Auto-reconnect with exponential backoff (Render free tier sleeps/restarts)
  ws.onclose = () => {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      connectWs();
    }, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
  };
}

function handleLiveEvent(event, payload) {
  switch (event) {
    case 'card_added':
      document.querySelector(`.cards[data-col="${payload.column_type}"]`)?.insertAdjacentHTML('beforeend', renderCard(payload));
      break;
    case 'card_updated': {
      const el = document.querySelector(`.card[data-id="${payload.id}"]`);
      if (el) {
        el.outerHTML = renderCard(payload);
        // If the update moved it to another column, relocate the new node
        moveCardElement(payload.id, payload.column_type);
      }
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
      renderRetro().catch(() => {});
      break;
    case 'retro_reopened':
      toast('This retro has been reopened 🟢');
      renderRetro().catch(() => {});
      break;
    case 'retro_deleted':
      toast('This retro has been deleted by the admin', 'points');
      setTimeout(() => { location.href = '/'; }, 2000);
      break;
  }
}

async function refreshCommitments() {
  const commitments = await Auth.api(`/retros/${currentRetroId}/commitments`);
  renderKanban(commitments);
}

async function refreshParticipants() {
  const participants = await Auth.api(`/retros/${currentRetroId}/participants`);
  renderParticipants(participants);
}

// ---------- Retro actions ----------
async function refreshVotesCounter() {
  const el = document.getElementById('votes-counter');
  if (!el) return;
  try {
    const { used, max } = await Auth.api(`/retros/${currentRetroId}/votes-used?voter=${encodeURIComponent(currentUser)}`);
    el.textContent = `👍 ${used}/${max} votes used`;
  } catch { /* counter is non-critical */ }
}

function wireRetroEvents() {
  const closeBtn = document.getElementById('close-retro');
  if (closeBtn) closeBtn.onclick = async () => {
    if (confirm('Close this retro? It will move to History.')) {
      await Auth.api(`/retros/${currentRetroId}/close`, { method: 'POST' });
      toast('Retro closed ✅');
    }
  };
  const reopenBtn = document.getElementById('reopen-retro');
  if (reopenBtn) reopenBtn.onclick = async () => {
    await Auth.api(`/retros/${currentRetroId}/reopen`, { method: 'POST' });
    toast('Retro reopened 🟢');
  };
  const deleteBtn = document.getElementById('delete-retro');
  if (deleteBtn) deleteBtn.onclick = async () => {
    if (confirm('⚠️ Delete this retro permanently? All cards, commitments and points will be lost.')) {
      await Auth.api(`/retros/${currentRetroId}`, { method: 'DELETE' });
      location.href = '/';
    }
  };
  const copyInvite = document.getElementById('copy-invite');
  if (copyInvite) copyInvite.onclick = () => {
    navigator.clipboard.writeText(document.getElementById('invite-link').textContent)
      .then(() => toast('Invitation link copied! Share it with your team ✅'))
      .catch(() => toast('Could not copy', 'points'));
  };
  document.getElementById('add-commitment').onclick = () => openCommitmentModal();
  document.getElementById('export-pdf').onclick = () => openPrintableActa(currentRetroId, storedToken);
  refreshVotesCounter();
}

// ---------- Printable acta (Export PDF via print dialog) ----------
async function openPrintableActa(retroId, participantToken) {
  // Fetch the acta as markdown, then render a clean printable view
  const headers = {};
  if (participantToken) headers['X-Participant-Token'] = participantToken;
  const res = await fetch(`/api/retros/${retroId}/acta`, { headers });
  if (!res.ok) { toast('Could not load the acta', 'points'); return; }
  const md = await res.text();

  // Minimal markdown → HTML (headings, bold, italics, list items)
  const html = md.split('\n').map(line => {
    if (line.startsWith('# ')) return `<h1>${Auth.esc(line.slice(2))}</h1>`;
    if (line.startsWith('## ')) return `<h2>${Auth.esc(line.slice(3))}</h2>`;
    if (line.startsWith('- ')) return `<li>${Auth.esc(line.slice(2))}</li>`;
    if (!line.trim()) return '';
    return `<p>${Auth.esc(line)}</p>`;
  }).join('\n')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>');

  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked — allow pop-ups to export PDF', 'points'); return; }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Retro Board — Minutes</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 40px auto; color: #1a1a2e; line-height: 1.6; }
    h1 { border-bottom: 2px solid #5b6ee1; padding-bottom: 8px; }
    h2 { color: #5b6ee1; margin-top: 28px; }
    li { margin: 4px 0; }
    .print-hint { background: #eef0fb; border: 1px solid #c5cdf0; padding: 10px 14px; border-radius: 8px; margin-bottom: 24px; font-family: system-ui, sans-serif; font-size: 0.9rem; }
    @media print { .print-hint { display: none; } }
  </style>
</head>
<body>
  <div class="print-hint">💡 Tip: in the print dialog choose <strong>"Save as PDF"</strong> as the destination.</div>
  ${html}
  <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
</body>
</html>`);
  win.document.close();
}

// ---------- Router ----------
if (location.pathname === '/retro.html') {
  renderRetro();
} else {
  renderHome();
}
