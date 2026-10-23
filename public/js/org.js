// Organization page — programs, teams, PIs and their dashboards.
// All data via Auth.api (Bearer token). Access enforced server-side.
// UX: proper modals with user pickers (searchable dropdown) instead of prompt().
(function () {
  const content = () => document.getElementById('org-content');
  const esc = s => Auth.esc(String(s ?? ''));
  const t = k => (window.I18N ? I18N.t(k) : null) || k;

  // Health score per retro row (same formula as the server's healthFromRows):
  // participation 40% + engagement 30% + follow-through 30%, scaled 0-100.
  function healthFromTrendRow(r) {
    const participants = Number(r.participants || 0);
    const cards = Number(r.cards || 0);
    const votes = Number(r.votes || 0);
    const total = Number(r.commitments_total || 0);
    const done = Number(r.commitments_done || 0);
    const participation = Math.min(100, participants * 20);
    const engagement = Math.min(100, cards * 10 + votes * 2);
    const followThrough = total > 0 ? Math.round((done / total) * 100) : 100;
    return Math.round(participation * 0.4 + engagement * 0.3 + followThrough * 0.3);
  }

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
  async function getUserOptions(scope) {
    // scope: { team_id } | { program_id } | undefined
    const query = scope?.team_id ? `?team_id=${scope.team_id}`
      : scope?.program_id ? `?program_id=${scope.program_id}` : '';
    return Auth.api(`/users/options${query}`);
  }

  function userPickerHtml(id, placeholder) {
    return `
      <input class="org-user-search" id="${id}-search" type="text"
        placeholder="${esc(placeholder || t('org.searchUser'))}" autocomplete="off">
      <div class="org-user-list" id="${id}-list"></div>`;
  }

  function mountUserPicker(modal, id, users, onPick, emptyContext) {
    const search = modal.querySelector(`#${id}-search`);
    const list = modal.querySelector(`#${id}-list`);
    let selected = null;
    const render = () => {
      const q = (search.value || '').trim().toLowerCase();
      const matches = users.filter(u => !q || u.username.toLowerCase().includes(q)).slice(0, 8);
      list.innerHTML = matches.length
        ? matches.map(u => `<button type="button" class="org-user-item" data-id="${u.id}" data-username="${esc(u.username)}">👤 ${esc(u.username)}</button>`).join('')
        : `<div class="org-user-empty">${esc(q ? t('org.noUsersFound') : (emptyContext || t('org.noUsersFound')))}</div>`;
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
      let helpDismissed = false;
      try { helpDismissed = localStorage.getItem('orgHelpDismissed') === '1'; } catch (_) {}
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
            ${tm.program_name ? `<span class="badge org-badge-program">📋 ${esc(tm.program_name || '')}</span>` : ''}
          </p>
          <button class="btn small team-open" data-id="${tm.id}">${t('org.openTeam')}</button>
        </div>`).join('');

      const isEmpty = programs.length === 0 && teams.length === 0;
      const emptyState = `
        <div class="org-empty-guide">
          <span class="org-empty-emoji">🏢</span>
          <h3>${t('org.emptyTitle')}</h3>
          <p class="muted">${t('org.emptySubtitle')}</p>
          <div class="org-empty-steps">
            <div class="org-empty-step">
              <span class="guide-step-num">1</span>
              <div><strong>${t('org.emptyS1')}</strong><p class="muted">${t('org.emptyS1d')}</p></div>
              <button class="btn small" id="eg-new-program">${t('org.newProgram')}</button>
            </div>
            <div class="org-empty-step">
              <span class="guide-step-num">2</span>
              <div><strong>${t('org.emptyS2')}</strong><p class="muted">${t('org.emptyS2d')}</p></div>
              <button class="btn small" id="eg-new-team">${t('org.newTeam')}</button>
            </div>
            <div class="org-empty-step">
              <span class="guide-step-num">3</span>
              <div><strong>${t('org.emptyS3')}</strong><p class="muted">${t('org.emptyS3d')}</p></div>
            </div>
            <div class="org-empty-step">
              <span class="guide-step-num">4</span>
              <div><strong>${t('org.emptyS4')}</strong><p class="muted">${t('org.emptyS4d')}</p></div>
            </div>
          </div>
          <p class="muted org-empty-more">📖 <a href="/org-guide.html">${t('orgGuide.cta.orgGuide')}</a></p>
        </div>`;

      el.innerHTML = `
        <div class="org-help-banner" id="org-help-banner" ${helpDismissed ? 'hidden' : ''}>
          <span>💡 ${t('org.helpBanner')}</span>
          <a href="/org-guide.html">${t('orgGuide.cta.orgGuide')}</a>
          <button class="org-help-dismiss" id="org-help-dismiss" aria-label="Dismiss">✕</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn" id="btn-new-program">➕ ${t('org.newProgram')}</button>
          <button class="btn" id="btn-new-team">➕ ${t('org.newTeam')}</button>
        </div>
        ${isEmpty ? emptyState : `
        <h3>${t('org.programs')} <span class="org-count">${programs.length}</span></h3>
        <div class="retro-grid">${programCards || `<p class="muted">${t('org.noPrograms')}</p>`}</div>
        <h3 style="margin-top:20px">${t('org.teamsHeading')} <span class="org-count">${teams.length}</span></h3>
        <div class="retro-grid">${teamCards || `<p class="muted">${t('org.noTeams')}</p>`}</div>`}`;

      el.querySelector('#org-help-dismiss').onclick = () => {
        try { localStorage.setItem('orgHelpDismissed', '1'); } catch (_) {}
        el.querySelector('#org-help-banner').remove();
      };
      el.querySelector('#btn-new-program').onclick = () => showCreateProgram();
      el.querySelector('#btn-new-team').onclick = () => showCreateTeam(programs);
      el.querySelector('#eg-new-program')?.addEventListener('click', () => showCreateProgram());
      el.querySelector('#eg-new-team')?.addEventListener('click', () => showCreateTeam(programs));
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
          .then(program => { closeModal(); Auth.toast(t('org.programCreated')); showCreateTeam([program], program); })
          .catch(err => Auth.toast(err.message));
      };
      modal.querySelector('#np-save').onclick = save;
      modal.querySelector('#np-cancel').onclick = closeModal;
      modal.querySelector('#np-name').focus();
    });
  }

  function showCreateTeam(programs, preselectedProgram) {
    openModal('➕ ' + t('org.newTeam'), `
      <label class="org-field"><span>${t('org.teamName')}</span>
        <input id="nt-name" type="text" maxlength="60" placeholder="${esc(t('org.teamNamePh'))}"></label>
      <label class="org-field"><span>${t('org.assignProgram')}</span>
        <select id="nt-program">
          <option value="">— ${t('org.standalone')} —</option>
          ${programs.map(p => `<option value="${p.id}" ${preselectedProgram && preselectedProgram.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
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
          .then(team => { closeModal(); Auth.toast(t('org.teamCreated')); showAddTeamMember(team.id, [], team); })
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
          <td><a href="/retro.html?id=${r.id}&from=team">${esc(r.title)}</a></td>
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
        <div class="org-section-head">
          <h3>👥 ${esc(d.team.name)}</h3>
          <div>
            <button class="btn small secondary" id="btn-edit-team">✏️ ${t('org.edit')}</button>
            <button class="btn small danger" id="btn-delete-team">🗑 ${t('org.delete')}</button>
          </div>
        </div>
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
          <div class="org-section-head">
            <h4>${t('org.retrosHeading')}</h4>
            <button class="btn small" id="btn-new-retro">➕ ${t('org.newRetro')}</button>
          </div>
          <table><thead><tr><th>${t('org.title')}</th><th>${t('org.sprint')}</th><th>${t('org.status')}</th><th>${t('org.created')}</th></tr></thead>
          <tbody>${retroRows || `<tr><td colspan="4" class="muted">${t('org.noRetrosTeam')}</td></tr>`}</tbody></table>
        </div>
        <div class="org-section">
          <h4>${t('org.teamLeaderboard')}</h4>
          <table><thead><tr><th>#</th><th>${t('org.participant')}</th><th>${t('org.points')}</th><th>${t('org.completed')}</th></tr></thead>
          <tbody>${lbRows || `<tr><td colspan="4" class="muted">${t('org.noPoints')}</td></tr>`}</tbody></table>
        </div>
        <div class="org-section">
          <h4>📈 ${t('org.healthTrend')}</h4>
          ${d.healthTrend && d.healthTrend.length ? `
          <table><thead><tr><th>${t('org.retro')}</th><th>${t('org.sprint')}</th><th>${t('org.healthScore')}</th><th>🧑‍🤝‍🧑</th><th>🗂</th><th>🗳</th><th>✅</th></tr></thead>
          <tbody>${d.healthTrend.map(r => {
            const score = healthFromTrendRow(r);
            return `<tr>
              <td><a href="/retro.html?id=${r.id}&from=team">${esc(r.title)}</a></td>
              <td>${esc(r.sprint || '—')}</td>
              <td><strong class="${score >= 70 ? 'trend-good' : score >= 40 ? 'trend-mid' : 'trend-low'}">${score}</strong></td>
              <td>${r.participants}</td><td>${r.cards}</td><td>${r.votes}</td><td>${r.commitments_done}/${r.commitments_total}</td>
            </tr>`;
          }).join('')}</tbody></table>`
          : `<p class="muted">${t('org.noTrend')}</p>`}
        </div>
        <div class="org-section">
          <h4>⏰ ${t('org.overdueStats')}</h4>
          <p>${d.overdue && d.overdue.pending > 0
            ? `⚠️ ${d.overdue.overdue}/${d.overdue.pending} ${t('org.overdueOfPending')}`
            : `✅ ${t('org.noOverdue')}`}</p>
        </div>
        <div class="org-section">
          <h4>🧑‍🤝‍🧑 ${t('org.memberParticipation')}</h4>
          <table><thead><tr><th>${t('org.participant')}</th><th>${t('org.retrosAttended')}</th><th>🗂 ${t('org.cardsCreated')}</th><th>🗳 ${t('org.votesCast')}</th></tr></thead>
          <tbody>${(d.memberParticipation || []).map(m => `
            <tr><td>👤 ${esc(m.participant_name)}</td><td>${m.retros_attended}</td><td>${m.cards_created}</td><td>${m.votes_cast}</td></tr>`).join('')
            || `<tr><td colspan="4" class="muted">${t('org.noParticipation')}</td></tr>`}</tbody></table>
        </div>`;
      el.querySelector('#back-to-org').onclick = e => { e.preventDefault(); loadOverview(); };
      el.querySelector('#btn-add-member').onclick = () => showAddTeamMember(teamId, team.members || [], team);
      el.querySelectorAll('.member-remove').forEach(b => b.onclick = () => {
        if (!confirm(`${t('org.removeMemberConfirm')} ${b.dataset.user}?`)) return;
        Auth.api(`/teams/${teamId}/members/${encodeURIComponent(b.dataset.user)}`, { method: 'DELETE' })
          .then(() => { Auth.toast(t('org.memberRemoved')); openTeam(teamId); })
          .catch(err => Auth.toast(err.message));
      });
      el.querySelector('#btn-assign-program').onclick = () => showAssignProgram(teamId, team.program_id, programs);
      el.querySelector('#btn-edit-team').onclick = () => showEditTeam(teamId, d.team.name);
      el.querySelector('#btn-delete-team').onclick = () => {
        if (!confirm(`${t('org.deleteTeamConfirm')} "${d.team.name}"?`)) return;
        Auth.api(`/teams/${teamId}`, { method: 'DELETE' })
          .then(() => { Auth.toast(t('org.teamDeleted')); loadOverview(); })
          .catch(err => Auth.toast(err.message));
      };
      el.querySelector('#btn-new-retro').onclick = () => showNewRetro(teamId, team.program_id, programs, d.team.name);
    } catch (err) {
      el.innerHTML = `<p class="muted">🔒 ${esc(err.message)}</p>`;
    }
  }

  // Add team member: modal with searchable user dropdown.
  // Scope: if the team belongs to a program, only offer users already in a
  // team of that program; standalone teams get the full user list.
  async function showAddTeamMember(teamId, currentMembers, team) {
    let users;
    try { users = await getUserOptions(team?.program_id ? { team_id: teamId } : undefined); }
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
      }, t('org.noUsersInTeam'));
      modal.querySelector('#tm-cancel').onclick = closeModal;
    });
  }

  // Edit team name: modal
  function showEditTeam(teamId, currentName) {
    openModal('✏️ ' + t('org.editTeam'), `
      <label class="org-field"><span>${t('org.teamName')}</span>
        <input id="et-name" type="text" maxlength="60" value="${esc(currentName)}"></label>
      <div class="org-modal-actions">
        <button class="btn secondary" id="et-cancel">${t('org.cancel')}</button>
        <button class="btn" id="et-save">${t('org.save')}</button>
      </div>`, modal => {
      modal.querySelector('#et-save').onclick = () => {
        const name = modal.querySelector('#et-name').value.trim();
        if (!name) { Auth.toast(t('org.nameRequired')); return; }
        Auth.api(`/teams/${teamId}`, { method: 'PUT', body: JSON.stringify({ name }) })
          .then(() => { closeModal(); Auth.toast(t('org.teamUpdated')); openTeam(teamId); })
          .catch(err => Auth.toast(err.message));
      };
      modal.querySelector('#et-cancel').onclick = closeModal;
    });
  }

  // Create a retro from the Organization page, assigned to this team
  // (and to the program's current PI if there is one).
  function showNewRetro(teamId, programId, programs, teamName) {
    const program = programs.find(p => p.id === programId);
    openModal('➕ ' + t('org.newRetro'), `
      <p class="muted">${t('org.newRetroFor')} <strong>👥 ${esc(program ? program.name + ' · ' : '')}${esc(teamName)}</strong></p>
      <label class="org-field"><span>${t('org.retroTitle')}</span>
        <input id="nr-title" type="text" maxlength="100" placeholder="${esc(t('org.retroTitlePh'))}"></label>
      <label class="org-field"><span>${t('org.sprint')}</span>
        <input id="nr-sprint" type="text" maxlength="60" placeholder="${esc(t('org.sprintPh'))}"></label>
      <label class="org-field"><span>${t('org.template')}</span>
        <select id="nr-template">
          <option value="classic">${esc(I18N.t('tpl.classic.name'))}</option>
          <option value="ssc">${esc(I18N.t('tpl.ssc.title'))}</option>
          <option value="msg">${esc(I18N.t('tpl.msg.title'))}</option>
        </select></label>
      <div class="org-modal-actions">
        <button class="btn secondary" id="nr-cancel">${t('org.cancel')}</button>
        <button class="btn" id="nr-save">${t('org.create')}</button>
      </div>`, modal => {
      modal.querySelector('#nr-save').onclick = () => {
        const title = modal.querySelector('#nr-title').value.trim();
        if (!title) { Auth.toast(t('org.nameRequired')); return; }
        const sprint = modal.querySelector('#nr-sprint').value.trim();
        const template = modal.querySelector('#nr-template').value;
        Auth.api('/retros', { method: 'POST', body: JSON.stringify({ title, sprint, template }) })
          .then(retro => {
            // Assign the retro to the team (best-effort; the retro is already created)
            return Auth.api(`/retros/${retro.id}/team`, { method: 'PUT', body: JSON.stringify({ team_id: teamId }) })
              .catch(() => {})
              .then(() => retro);
          })
          .then(retro => {
            // If the team's program has a current PI, assign it too (best-effort)
            const piId = program?.current_pi_id || program?.active_pi_id;
            if (!piId) { closeModal(); Auth.toast(t('org.retroCreated')); openTeam(teamId); return; }
            return Auth.api(`/retros/${retro.id}/pi`, { method: 'PUT', body: JSON.stringify({ pi_id: piId }) })
              .catch(() => {})
              .then(() => { closeModal(); Auth.toast(t('org.retroCreated')); openTeam(teamId); });
          })
          .catch(err => Auth.toast(err.message));
      };
      modal.querySelector('#nr-cancel').onclick = closeModal;
      modal.querySelector('#nr-title').focus();
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
          <td><a href="#" class="team-link" data-id="${tm.team_id}">👥 ${esc(tm.team_name)}</a></td>
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
        <div class="org-section-head">
          <h3>📋 ${esc(d.program.name)}</h3>
          ${isRte ? `
          <div>
            <button class="btn small secondary" id="btn-edit-program">✏️ ${t('org.edit')}</button>
            <button class="btn small danger" id="btn-delete-program">🗑 ${t('org.delete')}</button>
          </div>` : ''}
        </div>
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
        </div>
        <div class="org-section">
          <h4>💚 ${t('org.teamHealthCompare')}</h4>
          <table><thead><tr><th>${t('org.team')}</th><th>${t('org.healthScore')}</th></tr></thead>
          <tbody>${(d.teamHealth || []).map(th => `
            <tr><td><a href="#" class="team-link" data-id="${th.team_id}">👥 ${esc(th.team_name)}</a></td>
            <td><strong class="${th.health == null ? '' : th.health >= 70 ? 'trend-good' : th.health >= 40 ? 'trend-mid' : 'trend-low'}">${th.health ?? '—'}</strong></td></tr>`).join('')
            || `<tr><td colspan="2" class="muted">${t('org.noTeamsProgram')}</td></tr>`}</tbody></table>
        </div>
        <div class="org-section">
          <h4>📈 ${t('org.programTrend')}</h4>
          ${d.programTrend && d.programTrend.length ? `
          <table><thead><tr><th>${t('org.retro')}</th><th>${t('org.team')}</th><th>${t('org.healthScore')}</th><th>🧑‍🤝‍🧑</th><th>🗂</th><th>🗳</th><th>✅</th></tr></thead>
          <tbody>${d.programTrend.map(r => {
            const score = healthFromTrendRow(r);
            return `<tr>
              <td><a href="/retro.html?id=${r.id}&from=team">${esc(r.title)}</a></td>
              <td>🏷 ${esc(r.team_name)}</td>
              <td><strong class="${score >= 70 ? 'trend-good' : score >= 40 ? 'trend-mid' : 'trend-low'}">${score}</strong></td>
              <td>${r.participants}</td><td>${r.cards}</td><td>${r.votes}</td><td>${r.commitments_done}/${r.commitments_total}</td>
            </tr>`;
          }).join('')}</tbody></table>`
          : `<p class="muted">${t('org.noTrend')}</p>`}
        </div>`;
      el.querySelector('#back-to-org').onclick = e => { e.preventDefault(); loadOverview(); };
      el.querySelectorAll('.team-link').forEach(a => a.onclick = e => { e.preventDefault(); openTeam(a.dataset.id); });
      if (isRte) {
        el.querySelector('#btn-add-pm').onclick = () => showAddProgramMember(programId, members);
        el.querySelector('#btn-edit-program').onclick = () => showEditProgram(programId, d.program.name, d.program.description);
        el.querySelector('#btn-delete-program').onclick = () => {
          if (!confirm(`${t('org.deleteProgramConfirm')} "${d.program.name}"?`)) return;
          Auth.api(`/programs/${programId}`, { method: 'DELETE' })
            .then(() => { Auth.toast(t('org.programDeleted')); loadOverview(); })
            .catch(err => Auth.toast(err.message));
        };
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

  // Edit program: modal
  function showEditProgram(programId, currentName, currentDescription) {
    openModal('✏️ ' + t('org.editProgram'), `
      <label class="org-field"><span>${t('org.programName')}</span>
        <input id="ep-name" type="text" maxlength="60" value="${esc(currentName)}"></label>
      <label class="org-field"><span>${t('org.programDesc')}</span>
        <input id="ep-desc" type="text" maxlength="200" value="${esc(currentDescription || '')}"></label>
      <div class="org-modal-actions">
        <button class="btn secondary" id="ep-cancel">${t('org.cancel')}</button>
        <button class="btn" id="ep-save">${t('org.save')}</button>
      </div>`, modal => {
      modal.querySelector('#ep-save').onclick = () => {
        const name = modal.querySelector('#ep-name').value.trim();
        if (!name) { Auth.toast(t('org.nameRequired')); return; }
        const description = modal.querySelector('#ep-desc').value.trim();
        Auth.api(`/programs/${programId}`, { method: 'PUT', body: JSON.stringify({ name, description }) })
          .then(() => { closeModal(); Auth.toast(t('org.programUpdated')); openProgram(programId); })
          .catch(err => Auth.toast(err.message));
      };
      modal.querySelector('#ep-cancel').onclick = closeModal;
    });
  }

  // Add program member: modal with searchable user dropdown + role select.
  // Scope: only users already in a team of this program.
  async function showAddProgramMember(programId, currentMembers) {
    let users;
    try { users = await getUserOptions({ program_id: programId }); }
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
      }, t('org.noUsersInProgram'));
      modal.querySelector('#pm-cancel').onclick = closeModal;
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
