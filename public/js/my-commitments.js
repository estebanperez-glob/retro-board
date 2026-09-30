// My Commitments page — requires login (shows commitments assigned to the logged-in user)
async function loadMyCommitments() {
  const list = document.getElementById('commitments-list');
  if (!Auth.token) {
    list.innerHTML = `
      <div class="auth-required">
        <p>🔒 <strong>Log in to see your commitments.</strong></p>
        <p class="muted">Your commitments are tied to your account — each user sees only what is assigned to them.</p>
        <button class="btn" onclick="Auth.openAuthModal('login')">Log In / Register</button>
      </div>`;
    return;
  }
  let items;
  try {
    items = await Auth.api('/my-commitments');
  } catch (err) {
    list.innerHTML = `<p class="muted">Could not load your commitments: ${Auth.esc(err.message)}</p>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = '<p class="muted">Nothing assigned to you yet. When a commitment is assigned to your username, it will show up here. 🎉</p>';
    return;
  }
  const open = items.filter(i => i.status !== 'done');
  const done = items.filter(i => i.status === 'done');
  const overdue = open.filter(i => i.is_overdue);
  const onTrack = open.filter(i => !i.is_overdue);

  const renderItem = cm => `
    <div class="dash-item ${cm.is_overdue ? 'overdue' : ''} ${cm.status === 'done' ? 'done' : ''}">
      <div class="dash-desc">${cm.is_overdue ? '⚠️ ' : ''}${cm.status === 'done' ? '✅ ' : ''}${Auth.esc(cm.description)}</div>
      <div class="dash-meta">
        ${cm.due_date ? `<span class="due">📅 ${cm.due_date}</span>` : ''}
        <span class="badge status-${cm.retro_status}">${cm.retro_status === 'closed' ? '✅ Retro closed' : '🟢 Retro open'}</span>
        <a href="/retro.html?id=${cm.retro_id}" class="dash-retro">${Auth.esc(cm.retro_title)}</a>
      </div>
    </div>`;

  list.innerHTML = `
    <div class="dashboard">
      <div class="dashboard-header">
        <h3 style="margin:0">Open <span class="badge">${open.length}</span></h3>
      </div>
      ${overdue.length ? `<h3 class="overdue-title">⚠️ Overdue (${overdue.length})</h3>${overdue.map(renderItem).join('')}` : ''}
      ${onTrack.length ? `<h3>On Track (${onTrack.length})</h3>${onTrack.map(renderItem).join('')}` : ''}
      ${done.length ? `<h3>✅ Completed (${done.length})</h3>${done.map(renderItem).join('')}` : ''}
    </div>`;
}

loadMyCommitments();
