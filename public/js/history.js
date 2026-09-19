async function loadHistory() {
  const [retrosRes, evoRes] = await Promise.all([fetch('/api/retros'), fetch('/api/evolution')]);
  const retros = await retrosRes.json();
  const evolution = await evoRes.json();
  const list = document.getElementById('retro-list');

  // Evolution chart: completed vs pending commitments per retro
  const chart = document.getElementById('evolution-chart');
  if (chart) {
    const withCommitments = evolution.filter(r => r.total > 0);
    if (withCommitments.length) {
      chart.innerHTML = withCommitments.map(r => {
        const maxVal = Math.max(...withCommitments.map(x => x.total));
        const scale = v => Math.max(8, Math.round((v / maxVal) * 110));
        return `
          <div class="evo-bar-group" title="${r.title}: ${r.completed}/${r.total} completed">
            <div class="evo-bars">
              <div class="evo-bar completed" style="height:${scale(r.completed)}px"></div>
              <div class="evo-bar pending" style="height:${scale(r.total - r.completed)}px"></div>
            </div>
            <div class="evo-label">${r.sprint || r.title}</div>
          </div>`;
      }).join('') + `
        <div class="evo-legend" style="position:absolute;bottom:8px;right:16px">
          <span><span class="evo-dot" style="background:var(--green)"></span>Completed</span>
          <span><span class="evo-dot" style="background:var(--surface-2);border:1px solid var(--muted)"></span>Pending</span>
        </div>`;
    } else {
      chart.innerHTML = '<p class="muted">No commitments yet — the chart will appear as teams complete them.</p>';
    }
  }

  if (!retros.length) {
    list.innerHTML = '<p class="muted">No retros yet. Create one from the Home page!</p>';
    return;
  }
  list.innerHTML = retros.map(r => `
    <div class="retro-card">
      <h3>${r.title} ${r.status === 'closed' ? '✅' : '🟢'}</h3>
      ${r.sprint ? `<p class="muted">Sprint: ${r.sprint}</p>` : ''}
      <p class="stats">📅 ${r.created_at} · 🃏 ${r.card_count} cards · 📋 ${r.commitment_count} commitments</p>
      <div class="actions">
        <a class="btn small" href="/retro.html?id=${r.id}" style="text-decoration:none">Open</a>
        <a class="btn small secondary" href="/api/retros/${r.id}/acta" download style="text-decoration:none">⬇ Minutes</a>
      </div>
    </div>`).join('');
}
loadHistory();
