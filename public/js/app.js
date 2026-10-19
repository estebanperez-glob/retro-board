// Retro Board — main app logic (uses shared Auth from auth.js)
let currentUser = sessionStorage.getItem('retroUser') || null;
let currentRetroId = new URLSearchParams(location.search).get('id');
let ws = null;
let retroIsAdmin = false;
let retroJoinCode = null;
let retroWebhookUrl = null;
let retroTemplate = 'classic';
let retroCustomColumns = null; // JSON string when the retro uses custom columns

// Resolve the active board template (custom columns take precedence)
function currentTemplate() {
  if (retroCustomColumns) {
    try {
      return { name: 'Custom', columns: Object.fromEntries(JSON.parse(retroCustomColumns).map(c => [c.key, c.label])) };
    } catch { /* fall through to built-in */ }
  }
  return TEMPLATES[retroTemplate] || TEMPLATES.classic;
}

const app = document.getElementById('app');

function toast(message, cls = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${cls}`;
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---------- Retro templates ----------
let savedTemplates = []; // user's saved custom templates (loaded on home)
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
  sailboat: {
    name: 'Sailboat (Wind / Anchors / Risks / Island)',
    columns: {
      wind: '🌬 Wind (Propellers)',
      anchors: '⚓ Anchors (Dragging Us)',
      risks: '⚠️ Risks Ahead',
      island: '🏝 Island (Goals)',
    },
  },
  starfish: {
    name: 'Starfish (More / Less / Start / Stop / Keep)',
    columns: {
      more: '➕ Keep Doing More',
      less: '📉 Do Less',
      start: '🚀 Start Doing',
      stop: '🛑 Stop Doing',
      keep: '✅ Keep Doing',
    },
  },
  daki: {
    name: 'DAKI (Drop / Add / Keep / Improve)',
    columns: {
      drop: '🗑 Drop',
      add: '➕ Add',
      keep: '✅ Keep',
      improve: '🔧 Improve',
    },
  },
  wellbeing: {
    name: 'Wellbeing Check-in',
    columns: {
      energized: '⚡ Energized By',
      drained: '🪫 Drained By',
      support_needed: '🤝 Support Needed',
      suggestions: '💭 Ideas to Improve',
    },
  },
};

// ---------- Home ----------
// Featured template of the month: rotates monthly so teams try new formats
function featuredTemplateBanner() {
  const ids = Object.keys(TEMPLATES);
  const month = new Date().getMonth();
  const featuredId = ids[month % ids.length];
  const featured = TEMPLATES[featuredId];
  return `
    <div class="featured-template">
      <span>⭐ <strong>${I18N.t('home.featured')}</strong> ${featured.name} — a fresh format to try with your team</span>
      <button class="btn small" id="use-featured" data-tpl="${featuredId}">${I18N.t('home.tryIt')}</button>
    </div>`;
}

async function renderHome() {
  const graffitiTitle = 'RETRO BOARD'.split('').map((ch, i) =>
    ch === ' ' ? '<span class="space"> </span>' : `<span class="g${i % 5}">${ch}</span>`
  ).join('');
  const hero = `
    <section class="graffiti-hero">
      <h2 class="graffiti-title" aria-label="Retro Board">${graffitiTitle}</h2>
      <p class="graffiti-tagline">${I18N.t('home.tagline')}</p>
    </section>
    <div class="home-hero">
      <h2>${I18N.t('home.heroTitle')}</h2>
      <p class="muted">${I18N.t('home.heroSub')}</p>
      ${Auth.username ? '' : `<p class="muted" style="font-size:0.9rem">${I18N.t('home.tip')}</p>`}
      <div class="join-form">
        <input id="retro-title" placeholder="${I18N.t('home.retroTitlePh')}" style="min-width:260px">
        <input id="retro-sprint" placeholder="${I18N.t('home.sprintPh')}" style="max-width:150px">
        <select id="retro-template">
          ${Object.entries(TEMPLATES).map(([id, t]) => `<option value="${id}">${t.name}</option>`).join('')}
          <option value="custom">${I18N.t('home.customColumns')}</option>
        </select>
        <label class="check-label"><input type="checkbox" id="retro-anon"> ${I18N.t('home.anonCards')}</label>
        <button class="btn" id="create-retro">${I18N.t('home.createRetro')}</button>
      </div>
      <div class="join-form">
        <input id="join-id" placeholder="${I18N.t('home.joinIdPh')}" style="max-width:200px">
        <button class="btn secondary" id="join-retro">${I18N.t('home.joinRetro')}</button>
      </div>
      <p class="muted" style="margin-top:12px"><a href="/templates.html">${I18N.t('home.browseTemplates')}</a></p>
      ${featuredTemplateBanner()}
    </div>`;
  app.innerHTML = hero + `<div id="dashboard-section"></div>`;

  // Preselect template from query param (SEO template pages link here)
  const tplParam = new URLSearchParams(location.search).get('template');
  if (tplParam && TEMPLATES[tplParam]) {
    document.getElementById('retro-template').value = tplParam;
  }

  // Featured template "Try it" button
  document.getElementById('use-featured')?.addEventListener('click', e => {
    document.getElementById('retro-template').value = e.currentTarget.dataset.tpl;
    document.getElementById('retro-title').focus();
    document.querySelector('.join-form')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Custom columns editor: shown when the "Custom columns…" option is selected
  const templateSelect = document.getElementById('retro-template');
  const customEditor = document.createElement('div');
  customEditor.id = 'custom-columns-editor';
  customEditor.className = 'custom-columns-editor hidden';
  customEditor.innerHTML = `
    <p class="muted" style="font-size:0.85rem;margin:8px 0 4px">${I18N.t('home.customColsHint')}</p>
    <div id="custom-col-rows"></div>
    <button class="btn small secondary" id="add-custom-col">${I18N.t('home.addColumn')}</button>`;
  templateSelect.closest('.join-form').after(customEditor);
  const rowsEl = document.getElementById('custom-col-rows');
  const addRow = (label = '') => {
    const row = document.createElement('div');
    row.className = 'custom-col-row';
    row.innerHTML = `<input class="custom-col-label" placeholder="${I18N.t('home.colLabelPh')}" maxlength="40">
      <button class="btn small danger remove-col" title="${I18N.t('home.removeCol')}">✕</button>`;
    row.querySelector('.remove-col').onclick = () => row.remove();
    if (label) row.querySelector('input').value = label;
    rowsEl.appendChild(row);
  };
  addRow(); addRow(); // start with two rows
  document.getElementById('add-custom-col').onclick = () => {
    if (rowsEl.children.length >= 8) return toast(I18N.t('home.maxCols'));
    addRow();
  };
  templateSelect.addEventListener('change', () => {
    customEditor.classList.toggle('hidden', templateSelect.value !== 'custom');
    renderTemplatePreview();
  });

  // --- Template preview: chips showing the columns of the selected template ---
  function renderTemplatePreview() {
    let previewEl = document.getElementById('template-preview');
    if (!previewEl) {
      previewEl = document.createElement('div');
      previewEl.id = 'template-preview';
      previewEl.className = 'template-preview';
      templateSelect.closest('.join-form').after(previewEl);
    }
    const val = templateSelect.value;
    let columns = null;
    if (TEMPLATES[val]) {
      previewEl.innerHTML = Object.values(TEMPLATES[val].columns)
        .map(l => `<span class="template-chip">${l}</span>`).join('');
    } else if (val.startsWith('saved:')) {
      const tpl = savedTemplates.find(t => String(t.id) === val.slice(6));
      if (tpl) {
        try {
          previewEl.innerHTML = JSON.parse(tpl.columns_json)
            .map(c => `<span class="template-chip">${Auth.esc(c.label)}</span>`).join('');
        } catch { previewEl.innerHTML = ''; }
      } else previewEl.innerHTML = '';
    } else {
      previewEl.innerHTML = `<span class="muted" style="font-size:0.85rem">${I18N.t('home.defineColsBelow')}</span>`;
    }
  }
  renderTemplatePreview();

  // --- Saved templates: load into the select (logged-in users) ---
  if (Auth.token) {
    Auth.api('/templates').then(rows => {
      savedTemplates = rows;
      if (!rows.length) return;
      const savedGroup = document.createElement('optgroup');
      savedGroup.label = 'My saved templates';
      for (const t of rows) {
        const opt = document.createElement('option');
        opt.value = `saved:${t.id}`;
        opt.textContent = `💾 ${t.name}`;
        savedGroup.appendChild(opt);
      }
      templateSelect.insertBefore(savedGroup, templateSelect.querySelector('option[value="custom"]'));
    }).catch(() => {});
  }

  document.getElementById('create-retro').onclick = async () => {
    if (!Auth.token) return Auth.openAuthModal('register');
    const title = document.getElementById('retro-title').value.trim();
    if (!title) return toast(I18N.t('board.titleFirst'), 'points');
    const sprint = document.getElementById('retro-sprint').value.trim();
    const template = document.getElementById('retro-template').value;
    const is_anonymous = document.getElementById('retro-anon').checked;
    let custom_columns = null;
    let templateParam = template;
    if (template.startsWith('saved:')) {
      const tpl = savedTemplates.find(t => String(t.id) === template.slice(6));
      if (!tpl) return toast(I18N.t('board.tplNotFound'), 'points');
      custom_columns = tpl.columns_json;
      templateParam = 'classic'; // ignored when custom_columns is set
    } else if (template === 'custom') {
      const labels = [...customEditor.querySelectorAll('.custom-col-row input')]
        .map(inp => inp.value.trim()).filter(Boolean);
      if (labels.length < 2) return toast(I18N.t('board.tplMinCols'), 'points');
      custom_columns = JSON.stringify(labels.map(label => ({
        key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col',
        label,
      })));
    }
    await createRetroWithCarryOver(title, sprint, templateParam, is_anonymous, custom_columns);
  };

  document.getElementById('join-retro').onclick = () => {
    const id = document.getElementById('join-id').value.trim();
    if (id) location.href = `/retro.html?id=${id}`;
  };

  renderCommitmentsDashboard();
}

// Create a retro; if the previous retro has pending commitments, offer to carry them over
async function createRetroWithCarryOver(title, sprint, template, is_anonymous, custom_columns = null) {
  const retros = await Auth.api('/retros');
  const previous = retros.find(r => r.status === 'open' && r.card_count > 0);
  let carry_over_from = null;
  if (previous) {
    const pending = await Auth.api(`/retros/${previous.id}/pending-commitments`);
    if (pending.length > 0) {
      const list = pending.map(cm => `• ${Auth.esc(cm.description)} — ${Auth.esc(cm.assignee)}`).join('<br>');
      const ok = await new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
          <div class="modal">
            <h3>${I18N.t('board.carryOverTitle')}</h3>
            <p class="muted">The retro "<strong>${Auth.esc(previous.title)}</strong>" ${I18N.t('board.carryOverHas')} ${pending.length} ${I18N.t('board.carryOverPending')}</p>
            <div class="carry-list">${list}</div>
            <p class="muted">${I18N.t('board.carryOverImport')}</p>
            <div class="modal-actions">
              <button class="btn secondary" id="carry-no">${I18N.t('board.carryOverNo')}</button>
              <button class="btn" id="carry-yes">${I18N.t('board.carryOverYes')}</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#carry-no').onclick = () => { overlay.remove(); resolve(false); };
        overlay.querySelector('#carry-yes').onclick = () => { overlay.remove(); resolve(true); };
      });
      if (ok) carry_over_from = previous.id;
    }
  }
  const retro = await Auth.api('/retros', {
    method: 'POST',
    body: JSON.stringify({ title, sprint, template, is_anonymous, carry_over_from, custom_columns }),
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
    section.innerHTML = `<p class="muted" style="text-align:center">${I18N.t('board.noPendingCommitments')}</p>`;
    return;
  }
  const overdue = items.filter(i => i.is_overdue);
  const onTrack = items.filter(i => !i.is_overdue);
  const renderItem = cm => `
    <div class="dash-item ${cm.is_overdue ? 'overdue' : ''}">
      <div class="dash-desc">${cm.is_overdue ? '⚠️ ' : ''}${Auth.esc(cm.description)}</div>
      <div class="dash-meta">
        <span class="assignee">👤 ${Auth.esc(cm.assignee)}</span>
        ${cm.due_date ? `<span class="due">📅 ${Auth.esc(cm.due_date)}</span>` : ''}
        <a href="/retro.html?id=${cm.retro_id}" class="dash-retro">${Auth.esc(cm.retro_title)}</a>
      </div>
    </div>`;
  section.innerHTML = `
    <div class="dashboard">
      <div class="dashboard-header">
        <h2>📋 ${I18N.t('board.kanbanPending').replace('⏳ ', '')} <span class="badge">${items.length}</span></h2>
        <button class="btn small secondary" id="copy-summary">📋 ${I18N.t('home.copySummary')}</button>
      </div>
      ${overdue.length ? `<h3 class="overdue-title">${I18N.t('mc.overdue')} (${overdue.length})</h3>${overdue.map(renderItem).join('')}` : ''}
      ${onTrack.length ? `<h3>${I18N.t('mc.onTrack')} (${onTrack.length})</h3>${onTrack.map(renderItem).join('')}` : ''}
    </div>`;
  document.getElementById('copy-summary').onclick = () => copyCommitmentsSummary(items);
}

function copyCommitmentsSummary(items) {
  const byAssignee = {};
  for (const cm of items) {
    (byAssignee[cm.assignee] = byAssignee[cm.assignee] || []).push(cm);
  }
  const lines = [`📋 ${I18N.t('board.kanbanPending').replace('⏳ ', '')} — Retro Board`, ''];
  for (const [assignee, list] of Object.entries(byAssignee)) {
    lines.push(`*${assignee}*`);
    for (const cm of list) {
      const due = cm.due_date ? ` (${I18N.t('board.dueDate')} ${cm.due_date}${cm.is_overdue ? ` — ${I18N.t('mc.overdue')} ⚠️` : ''})` : '';
      lines.push(`  • ${cm.description}${due}`);
    }
    lines.push('');
  }
  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => toast(I18N.t('board.summaryCopied')))
    .catch(() => toast(I18N.t('board.copyFailed'), 'points'));
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
    retroWebhookUrl = retro.webhook_url || null;
    retroTemplate = retro.template || 'classic';
    retroCustomColumns = retro.custom_columns || null;
  } catch (err) {
    return renderJoinScreen(err.message);
  }

  const participants = await Auth.api(`/retros/${currentRetroId}/participants`);
  const cards = await Auth.api(`/retros/${currentRetroId}/cards`);
  const commitments = await Auth.api(`/retros/${currentRetroId}/commitments`);
  const template = retro.custom_columns
    ? { name: 'Custom', columns: Object.fromEntries(JSON.parse(retro.custom_columns).map(c => [c.key, c.label])) }
    : (TEMPLATES[retro.template] || TEMPLATES.classic);

  app.innerHTML = `
    <div class="retro-header">
      <h2>${Auth.esc(retro.title)} ${retro.status === 'closed' ? '✅' : '🟢'} ${retro.is_anonymous ? '🎭' : ''}</h2>
      <p class="muted">
        ${retro.is_anonymous ? I18N.t('board.anonMode') + ' ' : ''}
        ${retro.created_by ? `${I18N.t('board.admin')} <strong>${Auth.esc(retro.created_by)}</strong>. ` : ''}
        ${I18N.t('board.youAre')} <strong>${Auth.esc(currentUser)}</strong>.
      </p>
      ${retroIsAdmin ? `
        <div class="invite-box">
          <span class="muted">${I18N.t('board.inviteLink')}</span>
          <code id="invite-link">${location.origin}/retro.html?id=${retro.id}&key=${retroJoinCode}</code>
          <button class="btn small secondary" id="copy-invite">${I18N.t('board.copy')}</button>
        </div>` : ''}
      <div class="participants-bar" id="participants-bar"></div>
      <div class="mood-bar" id="mood-bar"></div>
      <div style="margin-top:8px">
        ${retroIsAdmin ? `
          <button class="btn small secondary" id="close-retro" ${retro.status === 'closed' ? 'disabled' : ''}>${I18N.t('board.closeRetro')}</button>
          <button class="btn small secondary" id="reopen-retro" ${retro.status === 'open' ? 'disabled' : ''}>${I18N.t('board.reopen')}</button>
          <button class="btn small secondary" id="duplicate-retro">${I18N.t('board.duplicate')}</button>
          <button class="btn small secondary" id="save-template">${I18N.t('board.saveTemplate')}</button>
          <button class="btn small danger" id="delete-retro">${I18N.t('board.deleteRetro')}</button>
        ` : ''}
        <span class="muted" id="votes-counter" style="margin-left:8px"></span>
      </div>
    </div>
    <div class="board" id="board"></div>
    <h2 style="margin-top:40px">${I18N.t('board.commitments')}</h2>
    <p class="muted">${I18N.t('board.kanbanHint')}</p>
    <div class="kanban" id="kanban"></div>
    <div class="retro-actions" style="margin-top:24px">
      <button class="btn" id="add-commitment">+ ${I18N.t('board.addCommitment')}</button>
      <a class="btn secondary" href="/api/retros/${currentRetroId}/acta?token=${encodeURIComponent(storedToken || '')}" download style="text-decoration:none;display:inline-block;margin-left:8px">${I18N.t('board.exportActa')}</a>
      <button class="btn secondary" id="export-pdf" style="margin-left:8px">${I18N.t('board.exportPdf')}</button>
      <button class="btn secondary" id="export-csv" style="margin-left:8px">${I18N.t('board.exportCsvJira')}</button>
      <button class="btn secondary" id="ai-summary" style="margin-left:8px">${I18N.t('board.summary')}</button>
      <button class="btn secondary" id="auto-group" style="margin-left:8px">${I18N.t('board.autoGroupCards')}</button>
      <button class="btn secondary" id="facilitator-timer" style="margin-left:8px">${I18N.t('board.facilitatorTimer')}</button>
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
          <h2>${I18N.t('join.btn')} ${preview ? `"${Auth.esc(preview.title)}"` : I18N.t('join.thisRetro')} 👋</h2>
          ${message ? `<p class="muted" style="color:var(--red)">${Auth.esc(message)}</p>` : ''}
          <div class="join-form">
            <input id="join-name" placeholder="${I18N.t('join.namePh')}" style="min-width:220px">
            <input id="join-code" placeholder="${I18N.t('join.codePh')}" value="${Auth.esc(key)}" style="max-width:180px">
            <button class="btn" id="join-btn">${I18N.t('join.btn')}</button>
          </div>
          <p class="muted" style="font-size:0.85rem">${I18N.t('join.hint')}</p>
        </div>`;
      const join = async () => {
        const name = document.getElementById('join-name').value.trim();
        const join_code = document.getElementById('join-code').value.trim();
        if (!name) return toast(I18N.t('join.enterName'), 'points');
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
  renderMood(participants);
}

// --- Team mood ---
const MOOD_OPTIONS = [
  { key: 'thrilled', emoji: '🤩', label: 'Thrilled' },
  { key: 'good',     emoji: '😌', label: 'Good' },
  { key: 'soso',     emoji: '🙃', label: 'So-so' },
  { key: 'tense',    emoji: '😬', label: 'Tense' },
  { key: 'burned',   emoji: '🫠', label: 'Burned out' },
];

function renderMood(participants) {
  const bar = document.getElementById('mood-bar');
  if (!bar) return;
  const withMood = participants.filter(p => p.mood);
  const counts = {};
  for (const p of withMood) counts[p.mood] = (counts[p.mood] || 0) + 1;
  const summary = MOOD_OPTIONS
    .filter(m => counts[m.key])
    .map(m => `<span class="mood-count" title="${m.label}: ${counts[m.key]}">${m.emoji}×${counts[m.key]}</span>`)
    .join(' ');
  const myMood = participants.find(p => p.name === currentUser)?.mood || null;
  bar.innerHTML = `
    <span class="muted">${I18N.t('board.teamMood')}</span>
    ${MOOD_OPTIONS.map(m => `
      <button class="mood-btn ${myMood === m.key ? 'selected' : ''}" data-mood="${m.key}" title="${m.label}">${m.emoji}</button>
    `).join('')}
    <span class="mood-summary" id="mood-summary">${summary || `<span class="muted">${I18N.t('board.noMoods')}</span>`}</span>`;
  bar.querySelectorAll('.mood-btn').forEach(btn => {
    btn.onclick = async () => {
      try {
        await Auth.api(`/retros/${currentRetroId}/mood`, {
          method: 'PUT', body: JSON.stringify({ mood: btn.dataset.mood }),
        });
      } catch (err) {
        toast(err.message, 'points');
      }
    };
  });
}

function renderBoard(cards, template) {
  const board = document.getElementById('board');
  board.style.gridTemplateColumns = `repeat(${Object.keys(template.columns).length}, 1fr)`;
  board.innerHTML = Object.entries(template.columns).map(([col, label]) => {
    const colCount = cards.filter(c => c.column_type === col).length;
    return `
    <div class="column ${col}" data-col="${col}">
      <h3>${label} <span class="col-count">${cards.filter(c => c.column_type === col).length}</span></h3>
      <div class="cards" data-col="${col}">
        ${cards.filter(c => c.column_type === col).map(renderCard).join('') ||
          `<p class="empty-column muted">${I18N.t('board.noCards')}</p>`}
      </div>
      <div class="add-card-form">
        <textarea placeholder="${I18N.t('board.addCardPh')}" data-col="${col}"></textarea>
        <button class="btn small add-card" data-col="${col}">${I18N.t('board.addCard')}</button>
      </div>
    </div>`;
  }).join('');

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

  board.querySelectorAll('.add-card-form textarea').forEach(ta => {
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        board.querySelector(`.add-card[data-col="${e.target.dataset.col}"]`)?.click();
      }
    });
  });

  // Vote / delete / edit via event delegation on the board container
  // (survives re-renders and cards inserted by WebSocket events)
  if (!board.dataset.actionsWired) {
    board.dataset.actionsWired = 'true';
    board.addEventListener('click', async e => {
      const voteBtn = e.target.closest('.vote-btn');
      if (voteBtn) {
        try {
          await Auth.api(`/cards/${voteBtn.dataset.id}/vote`, { method: 'POST', body: JSON.stringify({ voter: currentUser }) });
        } catch (err) {
          toast(err.message, 'points');
        }
        return;
      }
      const deleteBtn = e.target.closest('.delete-btn');
      if (deleteBtn) {
        try {
          await Auth.api(`/cards/${deleteBtn.dataset.id}`, { method: 'DELETE' });
        } catch (err) {
          toast(err.message, 'points');
        }
        return;
      }
      const editBtn = e.target.closest('.edit-btn');
      if (editBtn) openEditCardModal(editBtn.dataset.id, editBtn.dataset.content);
    });
  }

  // Drag & drop via delegation on the board container (survives re-renders)
  if (!board.dataset.wired) {
    board.dataset.wired = 'true';
    wireTouchMove(board); // touch fallback: long-press → "Move to…" menu
    board.addEventListener('dragstart', e => {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      e.dataTransfer.setData('text/plain', cardEl.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      cardEl.classList.add('dragging');
    });
    board.addEventListener('dragend', () => {
      board.querySelectorAll('.card.dragging').forEach(el => el.classList.remove('dragging'));
      board.querySelectorAll('.cards.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    board.addEventListener('dragover', e => {
      const colEl = e.target.closest('.column');
      if (!colEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      colEl.querySelector('.cards')?.classList.add('drag-over');
    });
    board.addEventListener('dragleave', e => {
      const colEl = e.target.closest('.column');
      if (colEl && !colEl.contains(e.relatedTarget)) colEl.querySelector('.cards')?.classList.remove('drag-over');
    });
    board.addEventListener('drop', async e => {
      const colEl = e.target.closest('.column');
      if (!colEl) return;
      e.preventDefault();
      colEl.querySelector('.cards')?.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      const col = colEl.dataset.col;
      const cardEl = board.querySelector(`.card[data-id="${id}"]`);
      if (cardEl && cardEl.closest('.column') === colEl) return; // already there
      try {
        await Auth.api(`/cards/${id}`, { method: 'PUT', body: JSON.stringify({ column_type: col }) });
        // No optimistic move: the WS card_updated broadcast re-renders and
        // relocates the card with server truth (avoids duplicate nodes)
      } catch (err) {
        toast(err.message, 'points');
      }
    });
  }
}

// Client-side sentiment heuristic (mirrors src/text.js sentimentOf)
const SENTIMENT_POSITIVE = new Set(('good great well awesome love loved excellent happy glad nice amazing better best ' +
  'win winning success successful improve improved improvement fast smooth clear helpful productive fun easy ' +
  'solid strong proud enjoy enjoyed efficient reliable fantastic perfect thanks thank appreciate appreciated ' +
  'like liked useful valuable quick robust').split(' '));
const SENTIMENT_NEGATIVE = new Set(('bad worse worst hate hated sad angry upset mad frustrated frustrating slow ' +
  'blocked blocker bug bugs broken fail failed failure issue issues problem problems unclear confusing confused ' +
  'difficult hard delay delayed late overdue missing lost stuck tedious painful annoying poor weak unstable ' +
  'crash crashed error errors wrong struggle struggled lack lacked lacking').split(' '));

function sentimentOf(text) {
  const words = String(text).toLowerCase().split(/[^a-z]+/);
  let score = 0;
  for (const w of words) {
    if (SENTIMENT_POSITIVE.has(w)) score += 1;
    if (SENTIMENT_NEGATIVE.has(w)) score -= 1;
  }
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

const SENTIMENT_EMOJI = { positive: '😊', neutral: '😐', negative: '😟' };

// Move a card element to the right column (used by WS card_updated)
function moveCardElement(cardId, columnType) {
  const cardEl = document.querySelector(`.card[data-id="${cardId}"]`);
  if (!cardEl) return;
  const zone = document.querySelector(`.cards[data-col="${columnType}"]`);
  if (!zone) return;
  if (cardEl.closest('.cards') === zone) return; // already there
  const oldZone = cardEl.closest('.cards');
  zone.appendChild(cardEl);
  // Remove the "empty column" placeholder if it exists in the target zone
  zone.querySelector('.empty-column')?.remove();
  // Keep column count badges in sync (source loses one, target gains one)
  if (oldZone) {
    const oldCol = oldZone.dataset.col;
    const oldCount = oldZone.querySelectorAll('.card').length;
    const oldCountEl = document.querySelector(`.column[data-col="${oldCol}"] .col-count`);
    if (oldCountEl) oldCountEl.textContent = oldCount;
  }
  const newCount = zone.querySelectorAll('.card').length;
  const newCountEl = zone.closest('.column')?.querySelector('.col-count');
  if (newCountEl) newCountEl.textContent = newCount;
}

// Touch fallback for drag & drop: long-press on a card opens a "Move to…" menu.
// HTML5 drag events don't fire on touch screens, so this covers phones/tablets.
function wireTouchMove(board) {
  let pressTimer = null;
  let longPressed = false;
  board.addEventListener('touchstart', e => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    longPressed = false;
    pressTimer = setTimeout(() => {
      longPressed = true;
      if (navigator.vibrate) navigator.vibrate(30);
      showMoveMenu(cardEl);
    }, 500);
  }, { passive: true });
  board.addEventListener('touchmove', () => {
    clearTimeout(pressTimer); // scrolling cancels the long-press
  }, { passive: true });
  board.addEventListener('touchend', () => clearTimeout(pressTimer));
  board.addEventListener('touchcancel', () => clearTimeout(pressTimer));

  function showMoveMenu(cardEl) {
    document.getElementById('touch-move-menu')?.remove();
    const columns = [...document.querySelectorAll('.column')];
    const current = cardEl.closest('.column')?.dataset.col;
    const menu = document.createElement('div');
    menu.id = 'touch-move-menu';
    menu.className = 'touch-move-menu';
    menu.innerHTML = `
      <p class="touch-menu-title">${I18N.t('board.moveCardTo')}</p>
      ${columns.filter(c => c.dataset.col !== current).map(c =>
        `<button class="btn small secondary" data-col="${c.dataset.col}">${c.querySelector('h3')?.textContent || c.dataset.col}</button>`
      ).join('')}
      <button class="btn small danger" id="touch-move-cancel">${I18N.t('common.cancel')}</button>`;
    document.body.appendChild(menu);
    menu.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-col]');
      if (btn) {
        try {
          await Auth.api(`/cards/${cardEl.dataset.id}`, { method: 'PUT', body: JSON.stringify({ column_type: btn.dataset.col }) });
        } catch (err) {
          toast(err.message, 'points');
        }
      }
      menu.remove();
    });
  }
}

function renderCard(card) {
  const groupBadge = card.group_label
    ? `<span class="group-badge" data-group="${Auth.esc(card.group_label)}" title="${I18N.t('board.groupLabel')} ${Auth.esc(card.group_label)}">🗂 ${Auth.esc(card.group_label)}</span> ` : '';
  return `
    <div class="card" data-id="${card.id}" draggable="true">
      ${groupBadge ? `<div class="group-row">${groupBadge}</div>` : ''}
      <div class="content">${Auth.esc(card.content)} <span class="sentiment-badge" title="${I18N.t('board.feedbackTone')} ${sentimentOf(card.content)}">${SENTIMENT_EMOJI[sentimentOf(card.content)]}</span></div>
      <div class="meta">
        <span>${I18N.t('board.by')} ${Auth.esc(card.author)}</span>
        <span>
          <button class="vote-btn" data-id="${card.id}" title="${I18N.t('board.vote')}" aria-label="${I18N.t('board.voteForCard')}">👍 ${card.votes}</button>
          <button class="edit-btn" data-id="${card.id}" data-content="${Auth.esc(card.content)}" title="${I18N.t('board.edit')}" aria-label="${I18N.t('board.editCard')}">✏️</button>
          <button class="delete-btn" data-id="${card.id}" title="${I18N.t('board.delete')}" aria-label="${I18N.t('board.deleteCard')}">🗑</button>
        </span>
      </div>
    </div>`;
}

function openEditCardModal(cardId, currentContent) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${I18N.t('board.editCardTitle')}</h3>
      <div class="form-group">
        <textarea id="card-content"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="card-cancel">${I18N.t('common.cancel')}</button>
        <button class="btn" id="card-save">${I18N.t('common.save')}</button>
      </div>
    </div>`;
  // Set the value via JS (not interpolation) — avoids double-escaping and XSS
  overlay.querySelector('#card-content').value = currentContent ?? '';
  document.body.appendChild(overlay);
  overlay.querySelector('#card-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#card-save').onclick = async () => {
    const content = overlay.querySelector('#card-content').value.trim();
    if (!content) return toast(I18N.t('board.contentRequired'), 'points');
    await Auth.api(`/cards/${cardId}`, { method: 'PUT', body: JSON.stringify({ content }) });
    overlay.remove();
  };
}

// ---------- Commitments Kanban ----------
const KANBAN_LABELS = () => ({ pending: I18N.t('board.kanbanPending'), in_progress: I18N.t('board.kanbanInProgress'), done: I18N.t('board.kanbanDone') });

function renderKanban(commitments) {
  window.__latestCommitments = commitments; // keep click handlers working with fresh data
  const kanban = document.getElementById('kanban');
  kanban.innerHTML = Object.keys(KANBAN_LABELS()).map(status => `
    <div class="kcolumn ${status}" data-status="${status}">
      <h3>${KANBAN_LABELS()[status]}</h3>
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
      const colEl = e.target.closest('.kcolumn');
      if (!colEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      colEl.querySelector('.kcards')?.classList.add('drag-over');
    });
    kanban.addEventListener('dragleave', e => {
      const colEl = e.target.closest('.kcolumn');
      if (colEl && !colEl.contains(e.relatedTarget)) colEl.querySelector('.kcards')?.classList.remove('drag-over');
    });
    kanban.addEventListener('drop', async e => {
      const colEl = e.target.closest('.kcolumn');
      if (!colEl) return;
      e.preventDefault();
      colEl.querySelector('.kcards')?.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      const status = colEl.dataset.status;
      const cmEl = kanban.querySelector(`.commitment[data-id="${id}"]`);
      if (cmEl && cmEl.closest('.kcolumn') === colEl) return; // already there
      try {
        await Auth.api(`/commitments/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
        // No optimistic move: WS commitment_updated triggers refreshCommitments
        // with server truth (avoids duplicate nodes)
      } catch (err) {
        toast(err.message, 'points');
      }
    });
    kanban.addEventListener('click', e => {
      const del = e.target.closest('.delete-cm');
      if (del) { Auth.api(`/commitments/${del.dataset.id}`, { method: 'DELETE' }).catch(err => toast(err.message, 'points')); return; }
      const edit = e.target.closest('.edit-cm');
      if (edit) {
        const cm = (window.__latestCommitments || []).find(c => c.id === Number(edit.dataset.id));
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
        <span class="due">${cm.due_date ? '📅 ' + Auth.esc(cm.due_date) : ''}</span>
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
      <h3>${existing ? I18N.t('board.editCommitment') : I18N.t('board.newCommitment')}</h3>
      <div class="form-group">
        <label>${I18N.t('board.description')}</label>
        <textarea id="cm-desc">${existing ? Auth.esc(existing.description) : ''}</textarea>
      </div>
      <div class="form-group">
        <label>${I18N.t('board.assignee')}</label>
        <input id="cm-assignee" value="${existing ? Auth.esc(existing.assignee) : Auth.esc(currentUser)}">
      </div>
      <div class="form-group">
        <label>${I18N.t('board.dueDate')}</label>
        <input type="date" id="cm-due" value="${existing?.due_date || ''}">
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="cm-cancel">${I18N.t('common.cancel')}</button>
        <button class="btn" id="cm-save">${existing ? I18N.t('common.save') : I18N.t('board.create')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#cm-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#cm-save').onclick = async () => {
    const description = overlay.querySelector('#cm-desc').value.trim();
    const assignee = overlay.querySelector('#cm-assignee').value.trim();
    const due_date = overlay.querySelector('#cm-due').value;
    if (!description || !assignee) return toast(I18N.t('board.descAssigneeRequired'), 'points');
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
      document.querySelector(`.cards[data-col="${payload.column_type}"]`)?.querySelector('.empty-column')?.remove();
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
    case 'mood_changed':
      refreshParticipants();
      break;
    case 'cards_refresh':
      refreshCards();
      break;
    case 'points_awarded':
      toast(I18N.t('board.pointsEarned').replace('{name}', payload.participant).replace('{n}', payload.amount), 'points');
      break;
    case 'retro_closed':
      toast(I18N.t('board.retroClosedMsg'));
      renderRetro().catch(() => {});
      break;
    case 'retro_reopened':
      toast(I18N.t('board.retroReopenedMsg'));
      renderRetro().catch(() => {});
      break;
    case 'retro_deleted':
      toast(I18N.t('board.retroDeletedMsg'), 'points');
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

async function refreshCards() {
  const cards = await Auth.api(`/retros/${currentRetroId}/cards`);
  renderBoard(cards, currentTemplate());
}

// ---------- Retro actions ----------
async function refreshVotesCounter() {
  const el = document.getElementById('votes-counter');
  if (!el) return;
  try {
    const { used, max } = await Auth.api(`/retros/${currentRetroId}/votes-used?voter=${encodeURIComponent(currentUser)}`);
    el.textContent = I18N.t('board.votesUsed').replace('{n}', `${used}/${max}`);
  } catch { /* counter is non-critical */ }
}

function wireRetroEvents() {
  const closeBtn = document.getElementById('close-retro');
  if (closeBtn) closeBtn.onclick = async () => {
    if (confirm(I18N.t('board.closeConfirm'))) {
      await Auth.api(`/retros/${currentRetroId}/close`, { method: 'POST' });
      toast(I18N.t('board.retroClosed'));
    }
  };
  const reopenBtn = document.getElementById('reopen-retro');
  if (reopenBtn) reopenBtn.onclick = async () => {
    await Auth.api(`/retros/${currentRetroId}/reopen`, { method: 'POST' });
    toast(I18N.t('board.retroReopened'));
  };
  const deleteBtn = document.getElementById('delete-retro');
  if (deleteBtn) deleteBtn.onclick = async () => {
    if (confirm(I18N.t('board.deleteConfirm'))) {
      await Auth.api(`/retros/${currentRetroId}`, { method: 'DELETE' });
      location.href = '/';
    }
  };
  const duplicateBtn = document.getElementById('duplicate-retro');
  if (duplicateBtn) duplicateBtn.onclick = async () => {
    if (!confirm(I18N.t('board.duplicateConfirm'))) return;
    try {
      const result = await Auth.api(`/retros/${currentRetroId}/duplicate`, { method: 'POST' });
      toast(I18N.t('board.retroDuplicated'));
      setTimeout(() => { location.href = `/retro.html?id=${result.id}`; }, 800);
    } catch (err) {
      toast(err.message, 'points');
    }
  };
  const saveTemplateBtn = document.getElementById('save-template');
  if (saveTemplateBtn) saveTemplateBtn.onclick = async () => {
    const name = prompt(I18N.t('board.tplNamePrompt'));
    if (!name || !name.trim()) return;
    try {
      await Auth.api(`/retros/${currentRetroId}/save-template`, {
        method: 'POST', body: JSON.stringify({ name: name.trim() }),
      });
      toast(I18N.t('board.tplSaved'));
    } catch (err) {
      toast(err.message, 'points');
    }
  };
  const copyInvite = document.getElementById('copy-invite');
  if (copyInvite) copyInvite.onclick = () => {
    navigator.clipboard.writeText(document.getElementById('invite-link').textContent)
      .then(() => toast(I18N.t('board.inviteCopied')))
      .catch(() => toast(I18N.t('board.copyFailedShort'), 'points'));
  };
  document.getElementById('add-commitment').onclick = () => openCommitmentModal();
  document.getElementById('export-pdf').onclick = () => openPrintableActa(currentRetroId);
  document.getElementById('export-csv').onclick = () => {
    const token = encodeURIComponent(sessionStorage.getItem('retroParticipantToken') || '');
    location.href = `/api/retros/${currentRetroId}/commitments.csv?token=${token}`;
  };
  document.getElementById('ai-summary').onclick = () => showAiSummary();
  document.getElementById('auto-group').onclick = () => autoGroupCards();
  document.getElementById('facilitator-timer').onclick = () => openFacilitatorTimer();
  // Slack/Teams webhook config (admin only)
  const webhookBtn = document.createElement('button');
  webhookBtn.className = 'btn small secondary';
  webhookBtn.id = 'config-webhook';
  webhookBtn.textContent = I18N.t('board.webhook');
  webhookBtn.style.marginLeft = '8px';
  if (retroIsAdmin) {
    document.getElementById('add-commitment').parentElement.appendChild(webhookBtn);
    webhookBtn.onclick = () => openWebhookModal();
  }
  refreshVotesCounter();
}

// ---------- Printable acta (Export PDF via print dialog) ----------
async function openPrintableActa(retroId) {
  // Fetch the acta as markdown, then render a clean printable view.
  // The participant token lives in sessionStorage (per retro) — read it here,
  // it is NOT in this function's scope otherwise.
  const participantToken = sessionStorage.getItem('retroParticipantToken');
  const tokenRetroId = sessionStorage.getItem('retroParticipantRetroId');
  const headers = {};
  if (participantToken && String(tokenRetroId) === String(retroId)) {
    headers['X-Participant-Token'] = participantToken;
  }
  const res = await fetch(`/api/retros/${retroId}/acta`, { headers });
  if (!res.ok) { toast(I18N.t('board.actaLoadFailed'), 'points'); return; }
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
  if (!win) { toast(I18N.t('board.popupBlocked'), 'points'); return; }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${I18N.t('board.minutesTitle')}</title>
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
  <div class="print-hint">${I18N.t('board.printTip')}</div>
  ${html}
</body>
</html>`);
  win.document.close();
  win.focus();
  // Print directly after writing the document — window.onload inside
  // document.write is unreliable across browsers
  setTimeout(() => win.print(), 400);
}

// ---------- AI Summary (heuristic, server-side) ----------
async function showAiSummary() {
  let md;
  try {
    const headers = { 'X-Participant-Token': sessionStorage.getItem('retroParticipantToken') || '' };
    if (Auth.token) headers['Authorization'] = `Bearer ${Auth.token}`;
    const res = await fetch(`/api/retros/${currentRetroId}/summary`, { headers });
    if (!res.ok) throw new Error();
    md = await res.text();
  } catch {
    return toast(I18N.t('board.summaryFailed'), 'points');
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal wide">
      <h3>${I18N.t('board.summaryTitle')}</h3>
      <pre id="summary-text" class="summary-pre">${Auth.esc(md)}</pre>
      <div class="modal-actions">
        <button class="btn secondary" id="summary-copy">${I18N.t('common.copy')}</button>
        <button class="btn" id="summary-close">${I18N.t('common.close')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#summary-close').onclick = () => overlay.remove();
  overlay.querySelector('#summary-copy').onclick = () => {
    navigator.clipboard.writeText(md)
      .then(() => toast(I18N.t('board.summaryCopied')))
      .catch(() => toast(I18N.t('board.copyFailedShort'), 'points'));
  };
}

// ---------- Auto-group cards (server-side clustering) ----------
async function autoGroupCards() {
  try {
    const result = await Auth.api(`/retros/${currentRetroId}/auto-group`, { method: 'POST' });
    toast(I18N.t('board.grouped').replace('{n}', result.grouped).replace('{g}', result.groups));
    const cards = await Auth.api(`/retros/${currentRetroId}/cards`);
    renderBoard(cards, currentTemplate());
  } catch (err) {
    toast(err.message, 'points');
  }
}

// ---------- Facilitator timer (client-side, phases with presets) ----------
const TIMER_PHASES = [
  { name: null, i18n: 'timer.gatherCards', minutes: 8 },
  { name: null, i18n: 'timer.discussGroup', minutes: 10 },
  { name: null, i18n: 'timer.vote', minutes: 3 },
  { name: null, i18n: 'timer.actions', minutes: 10 },
];

function openFacilitatorTimer() {
  if (document.getElementById('timer-widget')) return;
  const widget = document.createElement('div');
  widget.id = 'timer-widget';
  widget.innerHTML = `
    <div class="timer-head">
      <strong>${I18N.t('timer.title')}</strong>
      <button class="timer-close" id="timer-close">✕</button>
    </div>
    <div class="timer-phase" id="timer-phase">${I18N.t('timer.gatherCards')}</div>
    <div class="timer-display" id="timer-display">08:00</div>
    <div class="timer-controls">
      <button class="btn small" id="timer-start">${I18N.t('timer.start')}</button>
      <button class="btn small secondary" id="timer-pause">${I18N.t('timer.pause')}</button>
      <button class="btn small secondary" id="timer-reset">${I18N.t('timer.reset')}</button>
      <button class="btn small secondary" id="timer-next">${I18N.t('timer.next')}</button>
    </div>
    <div class="timer-phases-list" id="timer-phases"></div>`;
  document.body.appendChild(widget);
  let phaseIndex = 0;
  let remaining = TIMER_PHASES[0].minutes * 60;
  let timerId = null;
  const renderPhases = () => {
    document.getElementById('timer-phases').innerHTML = TIMER_PHASES.map((p, i) =>
      `<span class="timer-phase-item ${i === phaseIndex ? 'active' : ''}">${i + 1}. ${I18N.t(p.i18n)} (${p.minutes}m)</span>`).join('');
    document.getElementById('timer-phase').textContent = I18N.t(TIMER_PHASES[phaseIndex].i18n);
  };
  const renderTime = () => {
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    document.getElementById('timer-display').textContent = `${m}:${s}`;
    document.title = `${m}:${s} — ${I18N.t(TIMER_PHASES[phaseIndex].i18n)} · Retro Board`;
  };
  const stop = () => { if (timerId) { clearInterval(timerId); timerId = null; } };
  const tick = () => {
    remaining -= 1;
    if (remaining <= 0) {
      stop();
      toast(`${I18N.t('timer.timesUp')} "${I18N.t(TIMER_PHASES[phaseIndex].i18n)}"!`);
      document.title = I18N.t('timer.timesUpTitle');
      return;
    }
    renderTime();
  };
  document.getElementById('timer-start').onclick = () => { stop(); timerId = setInterval(tick, 1000); };
  document.getElementById('timer-pause').onclick = stop;
  document.getElementById('timer-reset').onclick = () => { stop(); remaining = TIMER_PHASES[phaseIndex].minutes * 60; renderTime(); };
  document.getElementById('timer-next').onclick = () => {
    stop();
    phaseIndex = (phaseIndex + 1) % TIMER_PHASES.length;
    remaining = TIMER_PHASES[phaseIndex].minutes * 60;
    renderPhases(); renderTime();
  };
  document.getElementById('timer-close').onclick = () => { stop(); widget.remove(); document.title = 'Retro Board'; };
  renderPhases(); renderTime();
}

// ---------- Slack/Teams webhook modal (admin) ----------
function openWebhookModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${I18N.t('board.webhookTitle')}</h3>
      <p class="muted" style="font-size:0.85rem">${I18N.t('board.webhookHelp')}</p>
      <div class="form-group">
        <label>${I18N.t('common.webhookUrl')}</label>
        <input id="webhook-url" placeholder="https://hooks.slack.com/services/..." value="${Auth.esc(retroWebhookUrl || '')}">
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="webhook-remove">${I18N.t('board.webhookRemove')}</button>
        <button class="btn secondary" id="webhook-cancel">${I18N.t('common.cancel')}</button>
        <button class="btn secondary" id="webhook-test">${I18N.t('board.webhookTest')}</button>
        <button class="btn" id="webhook-save">${I18N.t('common.save')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#webhook-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#webhook-test').onclick = async () => {
    const webhook_url = overlay.querySelector('#webhook-url').value.trim();
    if (webhook_url !== (retroWebhookUrl || '')) {
      toast(I18N.t('board.saveUrlFirst'), 'points');
      return;
    }
    try {
      await Auth.api(`/retros/${currentRetroId}/webhook-test`, { method: 'POST' });
      toast(I18N.t('board.webhookTestSent'));
    } catch (err) {
      toast(err.message, 'points');
    }
  };
  overlay.querySelector('#webhook-remove').onclick = async () => {
    await Auth.api(`/retros/${currentRetroId}/webhook`, { method: 'PUT', body: JSON.stringify({ webhook_url: null }) });
    retroWebhookUrl = null;
    toast(I18N.t('board.webhookRemoved'));
    overlay.remove();
  };
  overlay.querySelector('#webhook-save').onclick = async () => {
    const webhook_url = overlay.querySelector('#webhook-url').value.trim();
    try {
      await Auth.api(`/retros/${currentRetroId}/webhook`, { method: 'PUT', body: JSON.stringify({ webhook_url }) });
      retroWebhookUrl = webhook_url;
      toast(I18N.t('board.webhookSaved'));
      overlay.remove();
    } catch (err) {
      toast(err.message, 'points');
    }
  };
}

// ---------- Router ----------
if (location.pathname === '/retro.html') {
  renderRetro();
} else {
  renderHome();
}
