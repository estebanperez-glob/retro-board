async function loadLeaderboard() {
  const res = await fetch('/api/leaderboard');
  const rows = await res.json();
  const tbody = document.querySelector('#leaderboard-table tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="muted">No points yet. Complete commitments to earn points!</td></tr>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${medals[i] || i + 1}</td>
      <td>${r.participant_name}</td>
      <td>${r.total_points}</td>
      <td>${r.completed_commitments}</td>
    </tr>`).join('');
}
loadLeaderboard();
