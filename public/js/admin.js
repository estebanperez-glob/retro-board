// Usage Stats admin panel — visible only to the master user (users.is_master)
async function loadStats() {
  const el = document.getElementById('stats-content');
  if (!Auth.token) {
    el.innerHTML = `
      <div class="auth-required">
        <p>🔒 <strong>Log in required.</strong></p>
        <button class="btn" onclick="Auth.openAuthModal('login')">Log In</button>
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
    : '<p class="muted">No page views recorded yet.</p>';

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><span class="stat-value">${t.registered_users}</span><span class="stat-label">Registered users</span></div>
      <div class="stat-card"><span class="stat-value">${t.unique_participants}</span><span class="stat-label">Unique participants</span></div>
      <div class="stat-card"><span class="stat-value">${t.total_retros}</span><span class="stat-label">Retros created</span></div>
      <div class="stat-card"><span class="stat-value">${t.open_retros}</span><span class="stat-label">Open retros</span></div>
      <div class="stat-card"><span class="stat-value">${t.total_cards}</span><span class="stat-label">Cards</span></div>
      <div class="stat-card"><span class="stat-value">${t.total_commitments}</span><span class="stat-label">Commitments</span></div>
      <div class="stat-card"><span class="stat-value">${completionRate}%</span><span class="stat-label">Commitment completion</span></div>
      <div class="stat-card"><span class="stat-value">${t.total_page_views}</span><span class="stat-label">Page views</span></div>
    </div>

    <h3>Page views — last 30 days</h3>
    <div class="activity-chart">${activityBars}</div>

    <div class="stats-columns">
      <div>
        <h3>Top pages</h3>
        ${data.topPages.length ? data.topPages.map(p => `
          <div class="dash-item"><div class="dash-desc">${Auth.esc(p.page)}</div>
          <div class="dash-meta"><span class="badge">${p.views} views</span></div></div>`).join('')
        : '<p class="muted">No data yet.</p>'}
      </div>
      <div>
        <h3>Most engaged users</h3>
        ${data.topUsers.length ? data.topUsers.map(u => `
          <div class="dash-item"><div class="dash-desc">👤 ${Auth.esc(u.name)}</div>
          <div class="dash-meta">
            <span class="badge">${u.retros_participated} retros</span>
            <span class="badge">${u.commitments_done} ✅ done</span>
            <span class="badge">${u.points} pts</span>
          </div></div>`).join('')
        : '<p class="muted">No participants yet.</p>'}
      </div>
    </div>`;
}

// ---------- Users tab ----------
async function loadUsers() {
  const el = document.getElementById('users-content');
  el.innerHTML = '<p class="muted">Loading…</p>';
  let users;
  try {
    users = await Auth.api('/admin/users');
  } catch (err) {
    el.innerHTML = `<p class="muted">🔒 ${Auth.esc(err.message)}</p>`;
    return;
  }
  el.innerHTML = `
    <table class="users-table">
      <thead><tr>
        <th>Username</th><th>Email</th><th>Master</th><th>Retros</th><th>Registered</th><th>Actions</th>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td>👤 ${Auth.esc(u.username)}${u.is_master ? ' ⭐' : ''}</td>
            <td>${Auth.esc(u.email || '—')}</td>
            <td>${u.is_master ? '⭐' : ''}</td>
            <td>${u.retros_created}</td>
            <td>${(u.created_at || '').slice(0, 10)}</td>
            <td class="users-actions">
              <button class="btn btn-small" onclick="editUser(${u.id}, '${Auth.esc(u.username)}', '${Auth.esc(u.email || '')}', ${u.is_master})">Edit</button>
              <button class="btn btn-small btn-danger" onclick="deleteUser(${u.id}, '${Auth.esc(u.username)}')">Delete</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function editUser(id, username, email) {
  const newPassword = prompt(`New password for ${username} (leave empty to keep current):`);
  if (newPassword === null) return;
  if (newPassword && newPassword.length < 8) return alert('Password must be at least 8 characters');
  const newEmail = prompt(`Email for ${username}:`, email || '');
  if (newEmail === null) return;
  const body = {};
  if (newPassword) body.password = newPassword;
  if (newEmail !== email) body.email = newEmail.trim();
  if (!Object.keys(body).length) return;
  Auth.api(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) })
    .then(() => { Auth.toast('User updated ✅'); loadUsers(); })
    .catch(err => Auth.toast(err.message));
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? Their retros will be reassigned to you so history is kept.`)) return;
  try {
    await Auth.api(`/admin/users/${id}`, { method: 'DELETE' });
    Auth.toast('User deleted — their retros are now yours');
    loadUsers();
  } catch (err) {
    Auth.toast(err.message);
  }
}

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
