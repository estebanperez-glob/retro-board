// Organization page — programs, teams, PIs and their dashboards.
// All data via Auth.api (Bearer token). Access enforced server-side.
(function () {
  const content = () => document.getElementById('org-content');
  const esc = s => Auth.esc(String(s ?? ''));

  async function init() {
    if (!Auth.token) {
      document.getElementById('org-content').innerHTML =
        '<p class="muted">🔒 Log in to see your organization.</p>';
      return;
    }
    await loadOverview();
  }

  // ---------- Overview: programs + teams ----------
  async function loadOverview() {
    const el = content();
    try {
      const [programs, teams] = await Promise.all([
        Auth.api('/programs'),
        Auth.api('/teams'),
      ]);
      const programCards = programs.map(p => `
        <div class="retro-card open">
          <h3>📋 ${esc(p.name)}</h3>
          <p class="muted">${esc(p.description || '')}</p>
          <p class="retro-badges">
            <span class="badge">${p.role === 'rte' ? '⭐ RTE' : '👤 Member'}</span>
            <span class="badge">👥 ${p.team_count} teams</span>
          </p>
          <button class="btn small program-open" data-id="${p.id}">Open program</button>
        </div>`).join('');
      const teamCards = teams.map(t => `
        <div class="retro-card open">
          <h3>👥 ${esc(t.name)}</h3>
          <p class="retro-badges">
            <span class="badge">🧑‍🤝‍🧑 ${t.member_count} members</span>
            <span class="badge">🗂 ${t.retro_count} retros</span>
          </p>
          <button class="btn small team-open" data-id="${t.id}">Open team</button>
        </div>`).join('');

      el.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn" id="btn-new-program">➕ New Program</button>
          <button class="btn" id="btn-new-team">➕ New Team</button>
        </div>
        <h3>Programs</h3>
        <div class="retro-grid">${programCards || '<p class="muted">No programs yet — create one to group teams.</p>'}</div>
        <h3 style="margin-top:20px">Teams</h3>
        <div class="retro-grid">${teamCards || '<p class="muted">No teams yet.</p>'}</div>
        <div id="detail-section" style="margin-top:24px"></div>`;

      el.querySelector('#btn-new-program').onclick = () => showCreateProgram();
      el.querySelector('#btn-new-team').onclick = () => showCreateTeam(programs);
      el.querySelectorAll('.program-open').forEach(b => b.onclick = () => openProgram(b.dataset.id));
      el.querySelectorAll('.team-open').forEach(b => b.onclick = () => openTeam(b.dataset.id));
      el.querySelectorAll('.team-open').forEach(b => b.onclick = () => openTeam(b.dataset.id));
    } catch (err) {
      el.innerHTML = `<p class="muted">🔒 ${esc(err.message)}</p>`;
    }
  }

  // ---------- Create forms ----------
  function showCreateProgram() {
    const name = prompt('Program name (e.g. "Payments ART"):');
    if (!name || !name.trim()) return;
    const description = prompt('Description (optional):') || '';
    Auth.api('/programs', { method: 'POST', body: JSON.stringify({ name, description }) })
      .then(() => { Auth.toast('Program created'); loadOverview(); })
      .catch(err => Auth.toast(err.message));
  }

  function showCreateTeam(programs) {
    const name = prompt('Team name (e.g. "Team Alpha"):');
    if (!name || !name.trim()) return;
    let programId = '';
    if (programs.length) {
      const opts = programs.map(p => `${p.id}. ${p.name}`).join('\n');
      const pick = prompt(`Assign to program (enter number, empty for standalone):\n${opts}`);
      if (pick && pick.trim()) programId = Number(pick.trim());
    }
    Auth.api('/teams', { method: 'POST', body: JSON.stringify({ name, program_id: programId || undefined }) })
      .then(() => { Auth.toast('Team created'); loadOverview(); })
      .catch(err => Auth.toast(err.message));
  }

  // ---------- Team dashboard ----------
  async function openTeam(teamId) {
    const el = content();
    try {
      const d = await Auth.api(`/teams/${teamId}/dashboard`);
      const retroRows = d.retros.map(r => `
        <tr>
          <td><a href="/retro.html?id=${r.id}">${esc(r.title)}</a></td>
          <td>${esc(r.sprint || '—')}</td>
          <td>${r.status === 'closed' ? '✅' : '🟢'}</td>
          <td>${r.created_at?.slice(0, 10) || ''}</td>
        </tr>`).join('');
      const lbRows = (d.leaderboard || []).map((row, i) => `
        <tr><td>${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</td><td>👤 ${esc(row.participant_name)}</td><td><strong>${row.total_points}</strong></td><td>${row.completed_commitments}</td></tr>`).join('');
      el.innerHTML = `
        <p><a class="btn secondary small" href="#" id="back-to-org">← Organization</a></p>
        <h3>👥 ${esc(d.team.name)}</h3>
        <div class="health-card" style="max-width:280px">
          <span class="health-score ${d.health >= 70 ? 'good' : d.health >= 40 ? 'mid' : d.health != null ? 'low' : ''}">${d.health ?? '—'}</span>
          <small>Team Health Score</small>
        </div>
        <p class="muted">Commitments: ✅ ${d.commitments?.done || 0} done · ⏳ ${d.commitments?.pending || 0} pending</p>
        <h4>Retros</h4>
        <table><thead><tr><th>Title</th><th>Sprint</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>${retroRows || '<tr><td colspan="4" class="muted">No retros assigned to this team yet.</td></tr>'}</tbody></table>
        <h4 style="margin-top:16px">Team Leaderboard</h4>
        <table><thead><tr><th>Rank</th><th>Participant</th><th>Points</th><th>Completed</th></tr></thead>
        <tbody>${lbRows || '<tr><td colspan="4" class="muted">No points yet.</td></tr>'}</tbody></table>`;
      el.querySelector('#back-to-org').onclick = e => { e.preventDefault(); loadOverview(); };
    } catch (err) {
      el.innerHTML = `<p class="muted">🔒 ${esc(err.message)}</p>`;
    }
  }

  // ---------- Program dashboard ----------
  async function openProgram(programId) {
    const el = content();
    try {
      const d = await Auth.api(`/programs/${programId}/dashboard`);
      const statRows = (d.teamStats || []).map(t => `
        <tr>
          <td>${esc(t.team_name)}</td>
          <td>${t.retros}</td>
          <td>${t.participants}</td>
          <td>${t.commitments_done}/${t.commitments_total}</td>
          <td><strong>${t.total_points}</strong></td>
        </tr>`).join('');
      const lbRows = (d.leaderboard || []).map((t, i) => `
        <tr><td>${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</td><td>🏷 ${esc(t.team_name)}</td><td><strong>${t.total_points}</strong></td></tr>`).join('');
      const depRows = (d.dependencies || []).map(dep => `
        <tr>
          <td>${esc(dep.retro_title)}</td>
          <td>${esc(dep.description)}</td>
          <td>${esc(dep.owner_team_name || '—')}</td>
          <td>→ ${esc(dep.depends_on_team_name || '—')}</td>
          <td>${dep.status === 'done' ? '✅' : '⏳'}</td>
        </tr>`).join('');
      el.innerHTML = `
        <p><a class="btn secondary small" href="#" id="back-to-org">← Back</a></p>
        <h3>📋 ${esc(d.program.name)}</h3>
        <h4>Teams</h4>
        <table><thead><tr><th>Team</th><th>Retros</th><th>Participants</th><th>Commitments done</th><th>Points</th></tr></thead>
        <tbody>${statRows || '<tr><td colspan="5" class="muted">No teams in this program yet.</td></tr>'}</tbody></table>
        <h4 style="margin-top:16px">Inter-team Leaderboard</h4>
        <table><thead><tr><th>Rank</th><th>Team</th><th>Points</th></tr></thead>
        <tbody>${lbRows || '<tr><td colspan="3" class="muted">No points yet.</td></tr>'}</tbody></table>
        <h4 style="margin-top:16px">Cross-team Dependencies</h4>
        <table><thead><tr><th>Retro</th><th>Commitment</th><th>Owner team</th><th>Depends on</th><th>Status</th></tr></thead>
        <tbody>${depRows || '<tr><td colspan="5" class="muted">No cross-team dependencies.</td></tr>'}</tbody></table>`;
      el.querySelector('#back-to-org').onclick = e => { e.preventDefault(); loadOverview(); };
    } catch (err) {
      el.innerHTML = `<p class="muted">🔒 ${esc(err.message)}</p>`;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
