// My Account page — change password and security question (requires login)
const app = document.getElementById('app');

function renderLoginRequired() {
  app.innerHTML = `
    <div class="auth-required">
      <h2>🔒 ${I18N.t('account.title')}</h2>
      <p class="muted" style="margin:12px 0">${I18N.t('account.loginRequired')}</p>
      <button class="btn" id="acct-login">${I18N.t('mc.loginBtn')}</button>
    </div>`;
  document.getElementById('acct-login').onclick = () => Auth.openAuthModal();
}

async function renderAccount() {
  if (!Auth.token) return renderLoginRequired();

  let account;
  try {
    account = await Auth.api('/account');
  } catch (err) {
    if (err.message.includes('Login required')) return renderLoginRequired();
    app.innerHTML = `<div class="auth-required"><p class="muted">${Auth.esc(err.message)}</p></div>`;
    return;
  }

  app.innerHTML = `
    <div class="account-wrap">
      <h2>👤 ${I18N.t('account.title')}</h2>
      <p class="muted">${I18N.t('account.loggedInAs')} <strong>${Auth.esc(account.username)}</strong></p>

      <div class="account-card">
        <h3>${I18N.t('account.changePassword')}</h3>
        <div class="form-group">
          <label>${I18N.t('account.curPass')}</label>
          <input type="password" id="acc-curpass" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label>${I18N.t('account.newPass')}</label>
          <input type="password" id="acc-newpass" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label>${I18N.t('account.repeatNewPass')}</label>
          <input type="password" id="acc-newpass2" autocomplete="new-password">
        </div>
        <button class="btn" id="acc-savepass">${I18N.t('account.changePassword')}</button>
      </div>

      <div class="account-card">
        <h3>${I18N.t('account.backupTitle')}</h3>
        <p class="muted" style="font-size:0.85rem">${I18N.t('account.backupSub')}</p>
        <button class="btn secondary" id="acc-backup">${I18N.t('account.downloadBackup')}</button>
      </div>

      <div class="account-card">
        <h3>${I18N.t('account.securityQuestion')}</h3>
        <p class="muted" style="font-size:0.85rem">
          ${account.security_question
            ? `${I18N.t('account.curQ')} “${Auth.esc(account.security_question)}”`
            : I18N.t('account.noSecQ')}
        </p>
        <div class="form-group">
          <label>${I18N.t('account.curPassConfirm')}</label>
          <input type="password" id="acc-secpass" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label>${I18N.t('account.newSecQ')}</label>
          <input id="acc-secq" placeholder="${I18N.t('auth.secQPh')}">
        </div>
        <div class="form-group">
          <label>${I18N.t('account.newSecA')}</label>
          <input id="acc-seca" autocomplete="off">
        </div>
        <button class="btn" id="acc-savesec">${I18N.t('account.saveSecQ')}</button>
      </div>

      <div class="account-card">
        <h3>${I18N.t('account.emailNotifs')}</h3>
        <p class="muted" style="font-size:0.85rem">
          ${I18N.t('account.emailNotifsSub')}
        </p>
        <div class="form-group">
          <label>${I18N.t('account.emailLabel')}</label>
          <input type="email" id="acc-email" placeholder="you@example.com" value="${Auth.esc(account.email || '')}">
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="acc-notify" ${account.notify_overdue ? 'checked' : ''} style="width:auto">
            ${I18N.t('account.notifyOverdue')}
          </label>
        </div>
        <button class="btn" id="acc-saveemail">${I18N.t('account.saveEmail')}</button>
      </div>
    </div>`;

  document.getElementById('acc-backup').onclick = () => {
    // Auth.api adds the Authorization header; download via blob to keep auth
    Auth.api('/backup.json').then(data => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `retro-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      Auth.toast(I18N.t('account.backupDone'));
    }).catch(err => Auth.toast(err.message));
  };

  document.getElementById('acc-savepass').onclick = async () => {
    const current_password = document.getElementById('acc-curpass').value;
    const new_password = document.getElementById('acc-newpass').value;
    const repeat = document.getElementById('acc-newpass2').value;
    if (!current_password || !new_password) return Auth.toast(I18N.t('account.fillAll'));
    if (new_password !== repeat) return Auth.toast(I18N.t('account.passMismatch'));
    try {
      await Auth.api('/account/password', {
        method: 'PUT', body: JSON.stringify({ current_password, new_password }),
      });
      Auth.toast(I18N.t('account.passChanged'));
      document.getElementById('acc-curpass').value = '';
      document.getElementById('acc-newpass').value = '';
      document.getElementById('acc-newpass2').value = '';
    } catch (err) {
      Auth.toast(err.message);
    }
  };

  document.getElementById('acc-savesec').onclick = async () => {
    const current_password = document.getElementById('acc-secpass').value;
    const security_question = document.getElementById('acc-secq').value.trim();
    const security_answer = document.getElementById('acc-seca').value.trim();
    if (!current_password || !security_question || !security_answer) {
      return Auth.toast(I18N.t('account.fillAll'));
    }
    try {
      await Auth.api('/account/security-question', {
        method: 'PUT',
        body: JSON.stringify({ current_password, security_question, security_answer }),
      });
      Auth.toast(I18N.t('account.secQUpdated'));
      renderAccount();
    } catch (err) {
      Auth.toast(err.message);
    }
  };

  document.getElementById('acc-saveemail').onclick = async () => {
    const email = document.getElementById('acc-email').value.trim();
    const notify_overdue = document.getElementById('acc-notify').checked;
    if (notify_overdue && !email) return Auth.toast(I18N.t('account.emailNeeded'));
    try {
      await Auth.api('/account/email', {
        method: 'PUT', body: JSON.stringify({ email, notify_overdue }),
      });
      Auth.toast(I18N.t('account.emailSaved'));
    } catch (err) {
      Auth.toast(err.message);
    }
  };
}

renderAccount();
