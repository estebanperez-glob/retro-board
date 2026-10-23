// Organization page — programs, teams, PIs and their dashboards.
// All data via Auth.api (Bearer token). Access enforced server-side.
// UX: proper modals with user pickers (searchable dropdown) instead of prompt().
(function () {
  const content = () => document.getElementById('org-content');
  const esc = s => Auth.esc(String(s ?? ''));
  const t = k => (window.I18N ? I18N.t(k) : null) || k;

  // ---------- Modal helpers ----------
  function closeModal() {
    document.getElementById('org-modal-backdrop')?.remove();
  }

  function openModal(title, bodyHtml, onMount) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.id = 'org-modal-backdrop';
    backdrop.className = 'org-modal-backdrop';
    backdrop.innerHTML = `
      <div class="org-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="org-modal-header">
          <h3>${esc(title)}</h3>
          <button class="org-modal-close" aria-label="Close">✕</button>
        </div>
        <div class="org-modal-body">${bodyHtml}</div>
      </div>`;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector('.org-modal-close').onclick = closeModal;
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onEsc); }
    });
    if (onMount) onMount(backdrop.querySelector('.org-modal'));
    return backdrop.querySelector('.org-modal');
  }

  // ---------- User picker (searchable dropdown) ----------
  let userOptionsCache = null;
  async function getUserOptions() {
    if (!userOptionsCache) userOptionsCache = Auth.api('/users/options');
    return (await userOptionsCache).slice();
  }

  function userPickerHtml(id, placeholder) {
    return `
      <input class="org-user-search" id="${id}-search" type="text"
        placeholder="${esc(placeholder || t('org.searchUser'))}" autocomplete="off">
      <div class="org-user-list" id="${id}-list"></div>`;
  }

  function mountUserPicker(modal, id, users, onPick) {
    const search = modal.querySelector(`#${id}-search`);
    const list = modal.querySelector(`#${id}-list`);
    let selected = null;
    const render = () => {
      const q = (search.value || '').trim().toLowerCase();
      const matches = users.filter(u => !q || u.username.toLowerCase().includes(q)).slice(0, 8);
      list.innerHTML = matches.length
        ? matches.map(u => `<button type="button" class="org-user-item" data-id="${u.id}" data-username="${esc(u.username)}">👤 ${esc(u.username)}</button>`).join('')
        : `<div class="org-user-empty">${esc(t('org.noUsersFound'))}</div>`;
      list.querySelectorAll('.org-user-item').forEach(b => b.onclick = () => {
        selected = { id: Number(b.dataset.id), username: b.dataset.username };
        search.value = selected.username;
        list.innerHTML = '';
        onPick(selected);
      });
    };
    search.addEventListener('input', render);
    search.addEventListener('focus', render);
    render();
    return { get selected() { return selected; } };
  }

  // ---------- Overview: programs + teams ----------
  async function init() {
    if (!Auth.token) {
      content().innerHTML = `<p class="muted">🔒 ${esc(t('org.loginRequired'))}</p>`;
      return;
    }
    await loadOverview();
  }

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
            <span class="badge">${p.role === 'rte' ? '⭐ ' + t('org.roleRte') : '👤 ' + t('org.roleMember')}</span>
            <span class="badge">👥 ${p.team_count} ${t('org.teams')}</span>
          </p>
          <button class="btn small program-open" data-id="${p.id}">${t('org.openProgram')}</button>
        </div>`).join('');
      const teamCards = teams.map(tm => `
        <div class="retro-card open">
          <h3>👥 ${esc(tm.name)}</h3>
          <p class="retro-badges">
            <span class="badge">🧑‍🤝‍🧑 ${tm.member_count} ${t('org.members')}</span>
            <span class="badge">🗂 ${tm.retro_count} ${t('org.retros')}</span>
          </p>
          <button class="btn small team-open" data-id="${tm.id}">${t('org.openTeam')}</button>
        </div>`).join('');

      el.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn" id="btn-new-program">➕ ${t('org.newProgram')}</button>
          <button class="btn" id="btn-new-team">➕ ${t('org.newTeam')}</button>
        </div>
        <h3>${t('org.programs')}</h3>
        <div class="retro-grid">${programCards || `<p class="muted">${t('org.noPrograms')}</p>`}</div>
        <h3 style="margin-top:20px">${t('org.teamsHeading')}</h3>
        <div class="retro-grid">${teamCards || `<p class="muted">${t('org.noTeams')}</p>`}</div>`;

      el.querySelector('#btn-new-program').onclick = () => showCreateProgram();
      el.querySelector('#btn-new-team').onclick = () => showCreateTeam(programs);
      el.querySelectorAll('.program-open').forEach(b => b.onclick = () => openProgram(b.dataset.id));
      el.querySelectorAll('.team-open').forEach(b => b.onclick = () => openTeam(b.dataset.id));
    } catch (err) {
      el.innerHTML = `<p class="muted">🔒 ${esc(err.message)}</p>`;
    }
  }

  // ---------- Create forms (modals) ----------
  function showCreateProgram() {
    openModal('➕ ' + t('org.newProgram'), `
      <label class="org-field"><span>${t('org.programName')}</span>
        <input id="np-name" type="text" maxlength="60" placeholder="${esc(t('org.programNamePh'))}"></label>
      <label class="org-field"><span>${t('org.programDesc')}</span>
        <input id="np-desc" type="text" maxlength="200" placeholder="${esc(t('org.programDescPh'))}"></label>
      <div class="org-modal-actions">
        <button class="btn secondary" id="np-cancel">${t('org.cancel')}</button>
        <button class="btn" id="np-save">${t('org.create')}</button>
      </div>`, modal => {
      const save = () => {
        const name = modal.querySelector('#np-name').value.trim();
        if (!name) { Auth.toast(t('org.nameRequired')); return; }
        const description = modal.querySelector('#np-desc')?.value.trim() || '';
        Auth.api('/programs', { method: 'POST', body: JSON.stringify({ name, description }) })
          .then(() => { closeModal(); Auth.toast(t('org.programCreated')); loadOverview(); })
          .catch(err => Auth.toast(err.message));
      };
      modal.querySelector('#np-save').onclick = save;
      modal.querySelector('#np-cancel').onclick = closeModal;
      modal.querySelector('#np-name').focus();
    });
  }

  function showCreateTeam(programs) {
    openModal('➕ ' + t('org.newTeam'), `
      <label class="org-field"><span>${t('org.teamName')}</span>
        <input id="nt-name" type="text" maxlength="60" placeholder="${esc(t('org.teamNamePh'))}"></label>
      <label class="org-field"><span>${t('org.assignProgram')}</span>
        <select id="nt-program">
          <option value="">— ${t('org.standalone')} —</option>
          ${programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select></label>
      <div class="org-modal-actions">
        <button class="btn secondary" id="nt-cancel">${t('org.cancel')}</button>
        <button class="btn" id="nt-save">${t('org.create')}</button>
      </div>`, modal => {
      const save = () => {
        const name = modal.querySelector('#nt-name').value.trim();
        if (!name) { Auth.toast(t('org.nameRequired')); return; }
        const programId = modal.querySelector('#nt-program').value;
        Auth.api('/teams', { method: 'POST', body: JSON.stringify({ name, program_id: programId ? Number(programId) : undefined }) })
          .then(() => { closeModal(); Auth.toast(t('org.teamCreated')); loadOverview(); })
          .catch(err => Auth.toast(err.message));
      };
      modal.querySelector('#nt-save').onclick = save;
      modal.querySelector('#nt-cancel').onclick = closeModal;
      modal.querySelector('#nt-name').focus();
    });
  }

  // ---------- Team dashboard ----------
  async function openTeam(teamId) {
    const el = content();
    try {
      const [d, team, programs] = await Promise.all([
        Auth.api(`/teams/${teamId}/dashboard`),
        Auth.api(`/teams/${teamId}`),
        Auth.api('/programs'),
      ]);
      const retroRows = d.retros.map(r => `
        <tr>
          <td><a href="/retro.html?id=${r.id}">${esc(r.title)}</a></td>
          <td>${esc(r.sprint || '—')}</td>
          <td>${r.status === 'closed' ? '✅' : '🟢'}</td>
          <td>${r.created_at?.slice(0, 10) || ''}</td>
        </tr>`).join('');
      const lbRows = (d.leaderboard || []).map((row, i) => `
        <tr><td>${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</td><td>👤 ${esc(row.participant_name)}</td><td><strong>${row.total_points}</strong></td><td>${row.completed_commitments}</td></tr>`).join('');
      const memberRows = (team.members || []).map(m => `
        <tr>
          <td>👤 ${esc(m.username)}</td>
          <td>${m.role === 'lead' ? '⭐ ' + t('org.lead') : '👤 ' + t('org.member')}</td>
          <td><button class="btn small secondary member-remove" data-user="${esc(m.username)}">${t('org.remove')}</button></td>
        </tr>`).join('');
      const programName = team.program_id
        ? esc((programs.find(p => p.id === team.program_id) || {}).name || '')
        : '';
      el.innerHTML = `
        <p><a class="btn secondary small" href="#" id="back-to-org">← ${t('org.backToOrg')}</a></p>
        <h3>👥 ${esc(d.team.name)}</h3>
        <div class="org-stats-row">
          <div class="health-card">
            <span class="health-score ${d.health >= 70 ? 'good' : d.health >= 40 ? 'mid' : d.health != null ? 'low' : ''}">${d.health ?? '—'}</span>
            <small>${t('org.healthScore')}</small>
          </div>
          <div class="org-stat"><strong>${d.commitments?.done || 0}</strong><small>✅ ${t('org.done')}</small></div>
          <div class="org-stat"><strong>${d.commitments?.pending || 0}</strong><small>⏳ ${t('org.pending')}</small></div>
          <div class="org-stat"><strong>${d.retros.length}</strong><small>🗂 ${t('org.retros')}</small></div>
        </div>
        <div class="org-section">
          <div class="org-section-head">
            <h4>${t('org.membersHeading')}</h4>
            <button class="btn small" id="btn-add-member">➕ ${t('org.addMember')}</button>
          </div>
          <table><thead><tr><th>${t('org.user')}</th><th>${t('org.role')}</th><th></th></tr></thead>
          <tbody>${memberRows || `<tr><td colspan="3" class="muted">${t('org.noMembers')}</td></tr>`}</tbody></table>
        </div>
        <div class="org-section">
          <div class="org-section-head">
            <h4>${t('org.programHeading')}</h4>
            <button class="btn small secondary" id="btn-assign-program">🔗 ${t('org.changeProgram')}</button>
          </div>
          <p>${team.program_id ? `📋 ${programName || t('org.assignedProgram')}` : t('org.standaloneTeam')}</p>
        </div>
        <div class="org-section">
          <h4>${t('org.retrosHeading')}</h4>
          <table><thead><tr><th>${t('org.title')}</th><th>${t('org.sprint')}</th><th>${t('org.status')}</th><th>${t('org.created')}</th></tr></thead>
          <tbody>${retroRows || `<tr><td colspan="4" class="muted">${t('org.noRetrosTeam')}</td></tr>`}</tbody></table>
        </div>
        <div class="org-section">
          <h4>${t('org.teamLeaderboard')}</h4>
          <table><thead><tr><th>#</th><th>${t('org.participant')}</th><th>${t('org.points')}</th><th>${t('org.completed')}</th></tr></thead>
          <tbody>${lbRows || `<tr><td colspan="4" class="muted">${t('org.noPoints')}</td></tr>`}</tbody></table>
        </div>`;
      el.querySelector('#back-to-org').onclick = e => { e.preventDefault(); loadOverview(); };
      el.querySelector('#btn-add-member').onclick = () => showAddTeamMember(teamId, team.members || []);
      el.querySelectorAll('.member-remove').forEach(b => b.onclick = () => {
        if (!confirm(`${t('org.removeMemberConfirm')} ${b.dataset.user}?`)) return;
        Auth.api(`/teams/${teamId}/members/${encodeURIComponent(b.dataset.user)}`, { method: 'DELETE' })
          .then(() => { Auth.toast(t('org.memberRemoved')); openTeam(teamId); })
          .catch(err => Auth.toast(err.message));
      });
      el.querySelector('#btn-assign-program').onclick = () => showAssignProgram(teamId, team.program_id, programs);
    } catch (err) {
      el.innerHTML = `<p class="muted">🔒 ${esc(err.message)}</p>`;
    }
  }

  // Add team member: modal with searchable user dropdown
  async function showAddTeamMember(teamId, currentMembers) {
    let users;
    try { users = await getUserOptions(); }
    catch (err) { Auth.toast(err.message); return; }
    const existing = new Set(currentMembers.map(m => m.username));
    const available = users.filter(u => !existing.has(u.username));
    openModal('➕ ' + t('org.addMember'), `
      <p class="muted">${t('org.pickUser')}</p>
      ${userPickerHtml('tm', t('org.searchUser'))}
      <div class="org-modal-actions">
        <button class="btn secondary" id="tm-cancel">${t('org.cancel')}</button>
      </div>`, modal => {
      mountUserPicker(modal, 'tm', available, picked => {
        Auth.api(`/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ username: picked.username }) })
          .then(() => { closeModal(); Auth.toast(t('org.memberAdded')); openTeam(teamId); })
          .catch(err => { Auth.toast(err.message); });
      });
      modal.querySelector('#tm-cancel').onclick = closeModal;
    });
  }

  // Assign team to program: modal with select dropdown
  function showAssignProgram(teamId, currentProgramId, programs) {
    openModal('🔗 ' + t('org.changeProgram'), `
      <label class="org-field"><span>${t('org.assignProgram')}</span>
        <select id="ap-program">
          <option value="">— ${t('org.standalone')} —</option>
          ${programs.map(p => `<option value="${p.id}" ${p.id === currentProgramId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label>
      <div class="org-modal-actions">
        <button class="btn secondary" id="ap-cancel">${t('org.cancel')}</button>
        <button class="btn" id="ap-save">${t('org.save')}</button>
      </div>`, modal => {
      modal.querySelector('#ap-save').onclick = () => {
        const programId = modal.querySelector('#ap-program').value;
        Auth.api(`/teams/${teamId}/program`, { method: 'PUT', body: JSON.stringify({ program_id: programId ? Number(programId) : null }) })
          .then(() => { closeModal(); Auth.toast(t('org.assignmentUpdated')); openTeam(teamId); })
          .catch(err => Auth.toast(err.message));
      };
      modal.querySelector('#ap-cancel').onclick = closeModal;
    });
  }

  // ---------- Program dashboard ----------
  async function openProgram(programId) {
    const el = content();
    try {
      const [d, members] = await Promise.all([
        Auth.api(`/programs/${programId}/dashboard`),
        Auth.api(`/programs/${programId}/members`),
      ]);
      const isRte = d.program.role === 'rte';
      const statRows = (d.teamStats || []).map(tm => `
        <tr>
          <td>${esc(tm.team_name)}</td>
          <td>${tm.retros}</td>
          <td>${tm.participants}</td>
          <td>${tm.commitments_done}/${tm.commitments_total}</td>
          <td><strong>${tm.total_points}</strong></td>
        </tr>`).join('');
      const lbRows = (d.leaderboard || []).map((tm, i) => `
        <tr><td>${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)}</td><td>🏷 ${esc(tm.team_name)}</td><td><strong>${tm.total_points}</strong></td></tr>`).join('');
      const depRows = (d.dependencies || []).map(dep => `
        <tr>
          <td>${esc(dep.retro_title)}</td>
          <td>${esc(dep.description)}</td>
          <td>${esc(dep.owner_team_name || '—')}</td>
          <td>→ ${esc(dep.depends_on_team_name || '—')}</td>
          <td>${dep.status === 'done' ? '✅' : '⏳'}</td>
        </tr>`).join('');
      const memberRows = members.map(m => `
        <tr>
          <td>👤 ${esc(m.username)}</td>
          <td>${m.role === 'rte' ? '⭐ ' + t('org.roleRte') : '👤 ' + t('org.roleMember')}</td>
          <td>${isRte ? `<button class="btn small secondary pm-remove" data-user="${esc(m.username)}">${t('org.remove')}</button>` : ''}</td>
        </tr>`).join('');
      el.innerHTML = `
        <p><a class="btn secondary small" href="#" id="back-to-org">← ${t('org.backToOrg')}</a></p>
        <h3>📋 ${esc(d.program.name)}</h3>
        <div class="org-section">
          <div class="org-section-head">
            <h4>${t('org.programMembers')}</h4>
            ${isRte ? `<button class="btn small" id="btn-add-pm">➕ ${t('org.addMember')}</button>` : ''}
          </div>
          <table><thead><tr><th>${t('org.user')}</th><th>${t('org.role')}</th><th></th></tr></thead>
          <tbody>${memberRows || `<tr><td colspan="3" class="muted">${t('org.noMembers')}</td></tr>`}</tbody></table>
        </div>
        <div class="org-section">
          <h4>${t('org.teamsHeading')}</h4>
          <table><thead><tr><th>${t('org.team')}</th><th>${t('org.retros')}</th><th>${t('org.participants')}</th><th>${t('org.commitmentsDone')}</th><th>${t('org.points')}</th></tr></thead>
          <tbody>${statRows || `<tr><td colspan="5" class="muted">${t('org.noTeamsProgram')}</td></tr>`}</tbody></table>
        </div>
        <div class="org-section">
          <h4>${t('org.interTeamLb')}</h4>
          <table><thead><tr><th>#</th><th>${t('org.team')}</th><th>${t('org.points')}</th></tr></thead>
          <tbody>${lbRows || `<tr><td colspan="3" class="muted">${t('org.noPoints')}</td></tr>`}</tbody></table>
        </div>
        <div class="org-section">
          <h4>${t('org.crossTeamDeps')}</h4>
          <table><thead><tr><th>${t('org.retro')}</th><th>${t('org.commitment')}</th><th>${t('org.ownerTeam')}</th><th>${t('org.dependsOn')}</th><th>${t('org.status')}</th></tr></thead>
          <tbody>${depRows || `<tr><td colspan="5" class="muted">${t('org.noDeps')}</td></tr>`}</tbody></table>
        </div>`;
      el.querySelector('#back-to-org').onclick = e => { e.preventDefault(); loadOverview(); };
      if (isRte) {
        el.querySelector('#btn-add-pm').onclick = () => showAddProgramMember(programId, members);
        el.querySelectorAll('.pm-remove').forEach(b => b.onclick = () => {
          if (!confirm(`${t('org.removeMemberConfirm')} ${b.dataset.user}?`)) return;
          Auth.api(`/programs/${programId}/members/${encodeURIComponent(b.dataset.user)}`, { method: 'DELETE' })
            .then(() => { Auth.toast(t('org.memberRemoved')); openProgram(programId); })
            .catch(err => Auth.toast(err.message));
        });
      }
    } catch (err) {
      el.innerHTML = `<p class="muted">🔒 ${esc(err.message)}</p>`;
    }
  }

  // Add program member: modal with searchable user dropdown + role select
  async function showAddProgramMember(programId, currentMembers) {
    let users;
    try { users = await getUserOptions(); }
    catch (err) { Auth.toast(err.message); return; }
    const existing = new Set(currentMembers.map(m => m.username));
    const available = users.filter(u => !existing.has(u.username));
    openModal('➕ ' + t('org.addMember'), `
      <p class="muted">${t('org.pickUser')}</p>
      ${userPickerHtml('pm', t('org.searchUser'))}
      <label class="org-field"><span>${t('org.role')}</span>
        <select id="pm-role">
          <option value="member">👤 ${t('org.member')}</option>
          <option value="rte">⭐ ${t('org.roleRte')}</option>
        </select></label>
      <div class="org-modal-actions">
        <button class="btn secondary" id="pm-cancel">${t('org.cancel')}</button>
      </div>`, modal => {
      mountUserPicker(modal, 'pm', available, picked => {
        const role = modal.querySelector('#pm-role').value;
        Auth.api(`/programs/${programId}/members`, { method: 'POST', body: JSON.stringify({ username: picked.username, role }) })
          .then(() => { closeModal(); Auth.toast(t('org.memberAdded')); openProgram(programId); })
          .catch(err => Auth.toast(err.message));
      });
      modal.querySelector('#pm-cancel').onclick = closeModal;
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
