// My Commitments page — requires login (shows commitments assigned to the logged-in user)
async function loadMyCommitments() {
  const list = document.getElementById('commitments-list');
  if (!Auth.token) {
    list.innerHTML = `
      <div class="auth-required">
        <p>🔒 <strong>${I18N.t('mc.loginRequired')}</strong></p>
        <p class="muted">${I18N.t('mc.private')}</p>
        <button class="btn" onclick="Auth.openAuthModal('login')">${I18N.t('mc.loginBtn')}</button>
      </div>`;
    return;
  }
  let items;
  try {
    items = await Auth.api('/my-commitments');
  } catch (err) {
    list.innerHTML = `<p class="muted">${I18N.t('mc.couldNotLoad')} ${Auth.esc(err.message)}</p>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `
      <div class="auth-required">
        <p>🎯 ${I18N.t('mc.empty')}</p>
        <p class="muted">${I18N.t('mc.emptyHint')}</p>
        <a class="btn" href="/">${I18N.t('mc.goToRetros')}</a>
      </div>`;
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
        ${cm.due_date ? `<span class="due">📅 ${Auth.esc(cm.due_date)}</span>` : ''}
        <span class="badge status-${cm.retro_status}">${cm.retro_status === 'closed' ? I18N.t('mc.retroClosed') : I18N.t('mc.retroOpen')}</span>
        <a href="/retro.html?id=${cm.retro_id}" class="dash-retro">${Auth.esc(cm.retro_title)}</a>
      </div>
    </div>`;

  list.innerHTML = `
    <div class="dashboard">
      <div class="dashboard-header">
        <h3 style="margin:0">${I18N.t('mc.open')} <span class="badge">${open.length}</span></h3>
      </div>
      ${overdue.length ? `<h3 class="overdue-title">${I18N.t('mc.overdue')} (${overdue.length})</h3>${overdue.map(renderItem).join('')}` : ''}
      ${onTrack.length ? `<h3>${I18N.t('mc.onTrack')} (${onTrack.length})</h3>${onTrack.map(renderItem).join('')}` : ''}
      ${done.length ? `<h3>${I18N.t('mc.completed')} (${done.length})</h3>${done.map(renderItem).join('')}` : ''}
    </div>`;
}

loadMyCommitments();
