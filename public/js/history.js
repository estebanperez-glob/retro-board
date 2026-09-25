// History page — requires login (admins see their own retros)
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
    list.innerHTML = '<p class="muted">No retros yet. Create one from the Home page!</p>';
    return;
  }
  list.innerHTML = retros.map(r => `
    <div class="retro-card ${r.status}">
      <h3>${Auth.esc(r.title)}</h3>
      ${r.sprint ? `<p class="muted">Sprint: ${Auth.esc(r.sprint)}</p>` : ''}
      <p class="muted">Created: ${r.created_at?.slice(0, 10) || ''}</p>
      <p>
        <span class="badge">${r.card_count} cards</span>
        <span class="badge">${r.commitment_count} commitments</span>
        <span class="badge status-${r.status}">${r.status === 'closed' ? '✅ Closed' : '🟢 Open'}</span>
      </p>
      <a class="btn small" href="/retro.html?id=${r.id}">Open</a>
    </div>`).join('');

  loadEvolution();
  loadHealthScore();
}

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
        </div>
        <a class="btn small secondary" href="/retro.html?id=${s.retro_id}" style="margin-top:8px">Open</a>
      </div>`;
  };
  section.innerHTML = `
    <h3 style="margin-top:8px">💚 Team Health Score</h3>
    <p class="muted" style="font-size:0.85rem">Composite score: participation (40%) + vote engagement (30%) + commitment follow-through (30%). Latest retro: <strong>${latest.score}</strong>/100.</p>
    <div class="health-grid">${scores.slice(-6).reverse().map(card).join('')}</div>`;
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
      ],
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

loadHistory();
