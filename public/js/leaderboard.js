// Leaderboard page — public gamification view
async function loadLeaderboard() {
  const tbody = document.querySelector('#leaderboard-table tbody');
  try {
    const rows = await Auth.api('/leaderboard');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">${I18N.t('leaderboard.empty')}</td></tr>`;
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    tbody.innerHTML = rows.map((row, i) => `
      <tr>
        <td>${medals[i] || `#${i + 1}`}</td>
        <td>👤 ${Auth.esc(row.participant_name)}</td>
        <td><strong>${row.total_points}</strong></td>
        <td>${row.completed_commitments}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">${Auth.esc(err.message)}</td></tr>`;
  }
}
loadLeaderboard();
