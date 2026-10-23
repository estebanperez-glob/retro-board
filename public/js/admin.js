// Usage Stats admin panel — visible only to the master user (users.is_master)
async function loadStats() {
  const el = document.getElementById('stats-content');
  if (!Auth.token) {
    el.innerHTML = `
      <div class="auth-required">
        <p>🔒 <strong>${I18N.t('admin.loginRequired')}</strong></p>
        <button class="btn" onclick="Auth.openAuthModal('login')">${I18N.t('admin.loginBtn')}</button>
      </div>`;
    return;
  }
  let data;
  try {
    data = await Auth.api('/stats');
  } catch (err) {
    el.innerHTML = `<p class="muted">🔒 ${Auth.esc(err.message)}</p>`;
    return;
  }
  const t = data.totals;
  const completionRate = t.total_commitments
    ? Math.round((t.done_commitments / t.total_commitments) * 100)
    : 0;

  // Simple bar chart of the last 30 days (pure CSS, no libraries)
  const maxViews = Math.max(1, ...data.activity.map(a => a.views));
  const activityBars = data.activity.length
    ? data.activity.map(a => `
        <div class="bar-col" title="${a.day}: ${a.views} views">
          <div class="bar" style="height:${Math.max(4, Math.round((a.views / maxViews) * 100))}%"></div>
          <span class="bar-label">${a.day.slice(5)}</span>
        </div>`).join('')
    : `<p class="muted">${I18N.t('admin.noViews')}</p>`;

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><span class="stat-value">${t.registered_users}</span><span class="stat-label">${I18N.t('admin.registeredUsers')}</span></div>
      <div class="stat-card"><span class="stat-value">${t.unique_participants}</span><span class="stat-label">${I18N.t('admin.uniqueParticipants')}</span></div>
      <div class="stat-card"><span class="stat-value">${t.total_retros}</span><span class="stat-label">${I18N.t('admin.retrosCreated')}</span></div>
      <div class="stat-card"><span class="stat-value">${t.open_retros}</span><span class="stat-label">${I18N.t('admin.openRetros')}</span></div>
      <div class="stat-card"><span class="stat-value">${t.total_cards}</span><span class="stat-label">${I18N.t('admin.cards')}</span></div>
      <div class="stat-card"><span class="stat-value">${t.total_commitments}</span><span class="stat-label">${I18N.t('admin.commitments')}</span></div>
      <div class="stat-card"><span class="stat-value">${completionRate}%</span><span class="stat-label">${I18N.t('admin.completionRate')}</span></div>
      <div class="stat-card"><span class="stat-value">${t.total_page_views}</span><span class="stat-label">${I18N.t('admin.pageViews')}</span></div>
    </div>

    <h3>${I18N.t('admin.pageViews30')}</h3>
    <div class="activity-chart">${activityBars}</div>

    <div class="stats-columns">
      <div>
        <h3>${I18N.t('admin.topPages')}</h3>
        ${data.topPages.length ? data.topPages.map(p => `
          <div class="dash-item"><div class="dash-desc">${Auth.esc(p.page)}</div>
          <div class="dash-meta"><span class="badge">${p.views} ${I18N.t('admin.views')}</span></div></div>`).join('')
        : `<p class="muted">${I18N.t('admin.noData')}</p>`}
      </div>
      <div>
        <h3>${I18N.t('admin.topUsers')}</h3>
        ${data.topUsers.length ? data.topUsers.map(u => `
          <div class="dash-item"><div class="dash-desc">👤 ${Auth.esc(u.name)}</div>
          <div class="dash-meta">
            <span class="badge">${u.retros_participated} ${I18N.t('admin.retros')}</span>
            <span class="badge">${u.commitments_done} ${I18N.t('admin.done')}</span>
            <span class="badge">${u.points} ${I18N.t('admin.pts')}</span>
          </div></div>`).join('')
        : `<p class="muted">${I18N.t('admin.noParticipants')}</p>`}
      </div>
    </div>`;
}

// ---------- Users tab ----------
async function loadUsers() {
  const el = document.getElementById('users-content');
  el.innerHTML = `<p class="muted">${I18N.t('admin.loading')}</p>`;
  let users;
  try {
    users = await Auth.api('/admin/users');
  } catch (err) {
    el.innerHTML = `<p class="muted">🔒 ${Auth.esc(err.message)}</p>`;
    return;
  }
  el.innerHTML = `
    <div class="table-scroll">
    <table class="users-table">
      <thead><tr>
        <th>${I18N.t('admin.username')}</th><th>${I18N.t('admin.email')}</th><th>${I18N.t('admin.master')}</th><th>${I18N.t('admin.orgManager')}</th><th>${I18N.t('admin.retros')}</th><th>${I18N.t('admin.registered')}</th><th>${I18N.t('admin.actions')}</th>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td>👤 ${Auth.esc(u.username)}${u.is_master ? ' ⭐' : ''}</td>
            <td>${Auth.esc(u.email || '—')}</td>
            <td>${u.is_master ? '⭐' : ''}</td>
            <td>${u.can_manage_org ? '✅' : '—'}</td>
            <td>${u.retros_created}</td>
            <td>${(u.created_at || '').slice(0, 10)}</td>
            <td class="users-actions">
              <button class="btn btn-small user-edit" data-id="${u.id}" data-username="${Auth.esc(u.username)}" data-email="${Auth.esc(u.email || '')}" aria-label="${I18N.t('admin.edit')} ${Auth.esc(u.username)}">${I18N.t('admin.edit')}</button>
              <button class="btn btn-small org-toggle" data-id="${u.id}" data-username="${Auth.esc(u.username)}" data-value="${u.can_manage_org ? 1 : 0}" aria-label="${u.can_manage_org ? I18N.t('admin.revokeOrg') : I18N.t('admin.grantOrg')} — ${Auth.esc(u.username)}">${u.can_manage_org ? I18N.t('admin.revokeOrg') : I18N.t('admin.grantOrg')}</button>
              <button class="btn btn-small btn-danger user-delete" data-id="${u.id}" data-username="${Auth.esc(u.username)}" aria-label="${I18N.t('admin.delete')} ${Auth.esc(u.username)}">${I18N.t('admin.delete')}</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function editUser(id, username, email) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>${I18N.t('admin.editUserTitle').replace('{name}', username)}</h3>
      <div class="form-group">
        <label>${I18N.t('admin.emailPrompt').replace('{name}', username)}</label>
        <input id="au-email" type="email" value="${Auth.esc(email || '')}">
      </div>
      <div class="form-group">
        <label>${I18N.t('admin.newPassPrompt').replace('{name}', username)}</label>
        <input id="au-pass" type="password" autocomplete="new-password">
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="au-cancel">${I18N.t('common.cancel')}</button>
        <button class="btn" id="au-save">${I18N.t('common.save')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#au-email').focus();
  overlay.querySelector('#au-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#au-save').onclick = async () => {
    const saveBtn = overlay.querySelector('#au-save');
    const newEmail = overlay.querySelector('#au-email').value.trim();
    const newPassword = overlay.querySelector('#au-pass').value;
    if (newPassword && newPassword.length < 8) return Auth.toast(I18N.t('admin.passMinLength'));
    const body = {};
    if (newPassword) body.password = newPassword;
    if (newEmail !== (email || '')) body.email = newEmail;
    if (!Object.keys(body).length) return overlay.remove();
    saveBtn.disabled = true;
    saveBtn.textContent = I18N.t('common.saving');
    try {
      await Auth.api(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      overlay.remove();
      Auth.toast(I18N.t('admin.userUpdated'));
      loadUsers();
    } catch (err) {
      Auth.toast(err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = I18N.t('common.save');
    }
  };
}

function confirmModal(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <p>${message}</p>
      <div class="modal-actions">
        <button class="btn secondary" id="cf-cancel">${I18N.t('common.cancel')}</button>
        <button class="btn danger" id="cf-go">${I18N.t('common.delete')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#cf-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#cf-go').onclick = async () => {
    const goBtn = overlay.querySelector('#cf-go');
    goBtn.disabled = true;
    try {
      await onConfirm();
      overlay.remove();
    } catch (err) {
      Auth.toast(err.message);
      goBtn.disabled = false;
    }
  };
}

async function deleteUser(id, username) {
  confirmModal(I18N.t('admin.deleteUserConfirm').replace('{name}', username), async () => {
    await Auth.api(`/admin/users/${id}`, { method: 'DELETE' });
    Auth.toast(I18N.t('admin.userDeleted'));
    loadUsers();
  });
}

// Event delegation for user actions (avoids inline onclick — XSS-safe with
// untrusted usernames, since data attributes are never evaluated as JS)
document.getElementById('users-content')?.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.user-edit');
  if (editBtn) {
    editUser(Number(editBtn.dataset.id), editBtn.dataset.username, editBtn.dataset.email);
    return;
  }
  const delBtn = e.target.closest('.user-delete');
  if (delBtn) deleteUser(Number(delBtn.dataset.id), delBtn.dataset.username);
  // Grant/revoke org-manager (can create programs and teams)
  const orgBtn = e.target.closest('.org-toggle');
  if (orgBtn) {
    const grant = orgBtn.dataset.value !== '1';
    confirmModal(
      (grant ? I18N.t('admin.grantOrgConfirm') : I18N.t('admin.revokeOrgConfirm')).replace('{name}', orgBtn.dataset.username),
      async () => {
        await Auth.api(`/admin/users/${orgBtn.dataset.id}`, { method: 'PUT', body: JSON.stringify({ can_manage_org: grant }) });
        Auth.toast(I18N.t('admin.userUpdated'));
        loadUsers();
      }
    );
  }
});

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    const isStats = btn.dataset.tab === 'stats';
    document.getElementById('stats-content').classList.toggle('hidden', !isStats);
    document.getElementById('users-content').classList.toggle('hidden', isStats);
    if (!isStats) loadUsers();
  };
});

loadStats();
