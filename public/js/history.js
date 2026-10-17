// History page — requires login (admins see their own retros)

// Emoji per mood level (1-5), used on the evolution chart's right axis
const MOOD_AXIS_EMOJI = { 1: '🫠', 2: '😬', 3: '🙃', 4: '😌', 5: '🤩' };

// Full history list (unfiltered), used by the filter bar
let allRetros = [];

// Wire up the filter bar
['filter-text', 'filter-status', 'filter-from', 'filter-to'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', applyHistoryFilters);
});
document.getElementById('filter-clear')?.addEventListener('click', () => {
  ['filter-text', 'filter-status', 'filter-from', 'filter-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  applyHistoryFilters();
});

async function loadHistory() {
  const list = document.getElementById('retro-list');
  if (!Auth.token) {
    list.innerHTML = `
      <div class="auth-required">
        <p>🔒 <strong>Log in to see your retro history.</strong></p>
        <p class="muted">History is private — each admin sees only the retros they created.</p>
        <button class="btn" onclick="Auth.openAuthModal('login')">Log In / Register</button>
      </div>`;
    return;
  }
  let retros;
  try {
    retros = await Auth.api('/retros');
  } catch (err) {
    list.innerHTML = `<p class="muted">Could not load history: ${Auth.esc(err.message)}</p>`;
    return;
  }
  if (!retros.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">🗂️</div>
        <h3>No retros yet</h3>
        <p class="muted">Create your first retrospective from the Home page and it will show up here.</p>
        <a class="btn" href="/">+ Create your first retro</a>
      </div>`;
    return;
  }
  allRetros = retros;
  renderRetroList(retros);

  loadEvolution();
  loadHealthScore();
}

// Apply client-side filters to the history list
function applyHistoryFilters() {
  const text = (document.getElementById('filter-text')?.value || '').toLowerCase();
  const status = document.getElementById('filter-status')?.value || '';
  const from = document.getElementById('filter-from')?.value || '';
  const to = document.getElementById('filter-to')?.value || '';
  const filtered = allRetros.filter(r => {
    if (text && !r.title.toLowerCase().includes(text)) return false;
    if (status && r.status !== status) return false;
    const day = r.created_at?.slice(0, 10) || '';
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  renderRetroList(filtered);
}

function renderRetroList(retros) {
  const list = document.getElementById('retro-list');
  if (!retros.length) {
    list.innerHTML = '<p class="muted" style="grid-column:1/-1">No retros match the current filters.</p>';
    return;
  }
  list.innerHTML = retros.map(r => `
    <div class="retro-card ${r.status}">
      <h3>${Auth.esc(r.title)}</h3>
      ${r.sprint ? `<p class="muted">Sprint: ${Auth.esc(r.sprint)}</p>` : ''}
      <p class="muted">Created: ${r.created_at?.slice(0, 10) || ''}</p>
      <p class="retro-badges">
        <span class="badge">${r.card_count} cards</span>
        <span class="badge">${r.commitment_count} commitments</span>
        <span class="badge status-${r.status}">${r.status === 'closed' ? '✅ Closed' : '🟢 Open'}</span>
      </p>
      <a class="btn small" href="/retro.html?id=${r.id}">Open</a>
      <button class="btn small danger retro-delete" data-id="${r.id}" data-title="${Auth.esc(r.title)}" title="Delete retro">🗑</button>
    </div>`).join('');
}

// Delete retro (owner only) — event delegation on the list
document.getElementById('retro-list')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.retro-delete');
  if (!btn) return;
  if (!confirm(`⚠️ Delete "${btn.dataset.title}" permanently? All cards, commitments and points will be lost.`)) return;
  try {
    await Auth.api(`/retros/${btn.dataset.id}`, { method: 'DELETE' });
    btn.closest('.retro-card').remove();
    Auth.toast(I18N.t('history.retroDeleted'));
  } catch (err) {
    Auth.toast(`Could not delete: ${err.message}`);
  }
});

// Team Health Score: composite 0-100 per retro (participation, engagement, follow-through)
async function loadHealthScore() {
  const section = document.getElementById('health-score-section');
  if (!section) return;
  let scores;
  try {
    scores = await Auth.api('/health-score');
  } catch {
    section.innerHTML = '';
    return;
  }
  if (!scores.length) { section.innerHTML = ''; return; }
  const latest = scores[scores.length - 1];
  const card = s => {
    const cls = s.score >= 70 ? 'good' : s.score >= 40 ? 'mid' : 'low';
    const bar = (label, value) => `
      <div>
        <small>${label}: ${value}%</small>
        <div class="health-bar"><div class="health-bar-fill" style="width:${value}%"></div></div>
      </div>`;
    return `
      <div class="health-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0;font-size:1rem">${Auth.esc(s.title)}</h3>
          <span class="health-score ${cls}">${s.score}</span>
        </div>
        ${bar('Participation', s.participation)}
        ${bar('Engagement', s.engagement)}
        ${bar('Follow-through', s.follow_through)}
        <div class="health-meta">
          <span>👥 ${s.participants}</span>
          <span>🗂 ${s.cards} cards</span>
          <span>👍 ${s.votes}</span>
          <span>✅ ${s.commitments_done}/${s.commitments_total} commitments</span>
          ${s.mood_avg != null ? `<span title="Average team mood">${MOOD_AXIS_EMOJI[Math.round(s.mood_avg)] || '—'} ${s.mood_avg}</span>` : ''}
        </div>
        <a class="btn small secondary" href="/retro.html?id=${s.retro_id}" style="margin-top:8px">Open</a>
      </div>`;
  };
  section.innerHTML = `
    <h3 style="margin-top:8px">💚 Team Health Score</h3>
    <p class="muted" style="font-size:0.85rem">Composite score: participation (40%) + vote engagement (30%) + commitment follow-through (30%). Latest retro: <strong>${latest.score}</strong>/100.</p>
    <div class="health-grid">${scores.slice(-6).reverse().map(card).join('')}</div>
    ${scores.length >= 2 ? `
      <h3 style="margin-top:20px">📈 Team Trends</h3>
      <p class="muted" style="font-size:0.85rem">Health score and team mood across your retros.</p>
      <div class="evolution-chart" style="position:relative"><canvas id="trends-canvas"></canvas></div>` : ''}`;
  if (scores.length >= 2 && window.Chart) {
    const recent = scores.slice(-12);
    new Chart(document.getElementById('trends-canvas'), {
      type: 'line',
      data: {
        labels: recent.map(s => s.sprint || s.title.slice(0, 18)),
        datasets: [
          {
            label: 'Health Score',
            data: recent.map(s => s.score),
            borderColor: '#2e9e5b',
            backgroundColor: 'rgba(46,158,91,0.12)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y',
          },
          ...(recent.some(s => s.mood_avg != null) ? [{
            label: 'Team Mood (1-5)',
            data: recent.map(s => s.mood_avg),
            borderColor: '#ff6b35',
            backgroundColor: 'rgba(255,107,53,0.12)',
            borderDash: [6, 4],
            tension: 0.3,
            yAxisID: 'mood',
          }] : []),
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { precision: 0 } },
          ...(recent.some(s => s.mood_avg != null) ? { mood: { position: 'right', min: 1, max: 5, grid: { drawOnChartArea: false } } } : {}),
        },
      },
    });
  }
}

// Evolution chart: completed commitments per retro (Chart.js, loaded from CDN)
async function loadEvolution() {
  const container = document.getElementById('evolution-chart');
  let data;
  try {
    data = await Auth.api('/evolution');
  } catch {
    container.innerHTML = '';
    return;
  }
  if (!data.length) { container.innerHTML = ''; return; }
  if (!window.Chart) {
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
  container.innerHTML = '<canvas id="evolution-canvas"></canvas>';
  new Chart(document.getElementById('evolution-canvas'), {
    type: 'bar',
    data: {
      labels: data.map(r => r.title),
      datasets: [
        { label: 'Completed commitments', data: data.map(r => Number(r.completed)), backgroundColor: '#22c55e' },
        { label: 'Total commitments', data: data.map(r => Number(r.total)), backgroundColor: '#94a3b8' },
        {
          type: 'line',
          label: 'Team mood (1-5)',
          data: data.map(r => r.mood_avg != null ? Number(r.mood_avg) : null),
          yAxisID: 'mood',
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b',
          pointRadius: 5,
          pointStyle: 'rectRot',
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            afterBody: items => {
              const r = data[items[0].dataIndex];
              const pct = r.total ? Math.round(Number(r.completed) / Number(r.total) * 100) : 0;
              return `Completion: ${pct}%`;
            },
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        mood: {
          position: 'right', min: 1, max: 5, grid: { drawOnChartArea: false },
          ticks: { stepSize: 1, callback: v => MOOD_AXIS_EMOJI[v] || v },
        },
      },
    },
  });
}

loadHistory();
