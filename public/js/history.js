async function loadHistory() {
  const res = await fetch('/api/retros');
  const retros = await res.json();
  const list = document.getElementById('retro-list');
  if (!retros.length) {
    list.innerHTML = '<p class="muted">No retros yet. Create one from the Home page!</p>';
    return;
  }
  list.innerHTML = retros.map(r => `
    <div class="retro-card">
      <h3>${r.title}</h3>
      ${r.sprint ? `<p class="muted">Sprint: ${r.sprint}</p>` : ''}
      <p class="stats">📅 ${r.created_at} · 🃏 ${r.card_count} cards · 📋 ${r.commitment_count} commitments · ${r.status === 'closed' ? '✅ Closed' : '🟢 Open'}</p>
      <div class="actions">
        <a class="btn small" href="/retro.html?id=${r.id}" style="text-decoration:none">Open</a>
        <a class="btn small secondary" href="/api/retros/${r.id}/acta" download style="text-decoration:none">⬇ Minutes</a>
      </div>
    </div>`).join('');
}
loadHistory();
