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
