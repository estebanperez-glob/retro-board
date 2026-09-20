// My Account page — change password and security question (requires login)
const app = document.getElementById('app');

function renderLoginRequired() {
  app.innerHTML = `
    <div class="auth-required">
      <h2>🔒 My Account</h2>
      <p class="muted" style="margin:12px 0">You need to log in to manage your account.</p>
      <button class="btn" id="acct-login">Log In / Register</button>
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
      <h2>👤 My Account</h2>
      <p class="muted">Logged in as <strong>${Auth.esc(account.username)}</strong></p>

      <div class="account-card">
        <h3>Change Password</h3>
        <div class="form-group">
          <label>Current password</label>
          <input type="password" id="acc-curpass" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label>New password (min 6 characters)</label>
          <input type="password" id="acc-newpass" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label>Repeat new password</label>
          <input type="password" id="acc-newpass2" autocomplete="new-password">
        </div>
        <button class="btn" id="acc-savepass">Change Password</button>
      </div>

      <div class="account-card">
        <h3>Security Question</h3>
        <p class="muted" style="font-size:0.85rem">
          ${account.security_question
            ? `Current question: “${Auth.esc(account.security_question)}”`
            : 'You have no security question yet — set one so you can recover your password if you forget it.'}
        </p>
        <div class="form-group">
          <label>Current password (to confirm it's you)</label>
          <input type="password" id="acc-secpass" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label>New security question</label>
          <input id="acc-secq" placeholder="e.g. What is my favorite color?">
        </div>
        <div class="form-group">
          <label>New security answer</label>
          <input id="acc-seca" autocomplete="off">
        </div>
        <button class="btn" id="acc-savesec">Save Security Question</button>
      </div>
    </div>`;

  document.getElementById('acc-savepass').onclick = async () => {
    const current_password = document.getElementById('acc-curpass').value;
    const new_password = document.getElementById('acc-newpass').value;
    const repeat = document.getElementById('acc-newpass2').value;
    if (!current_password || !new_password) return alert('Please fill in all fields');
    if (new_password !== repeat) return alert('New passwords do not match');
    try {
      await Auth.api('/account/password', {
        method: 'PUT', body: JSON.stringify({ current_password, new_password }),
      });
      alert('Password changed successfully ✅');
      document.getElementById('acc-curpass').value = '';
      document.getElementById('acc-newpass').value = '';
      document.getElementById('acc-newpass2').value = '';
    } catch (err) {
      alert(err.message);
    }
  };

  document.getElementById('acc-savesec').onclick = async () => {
    const current_password = document.getElementById('acc-secpass').value;
    const security_question = document.getElementById('acc-secq').value.trim();
    const security_answer = document.getElementById('acc-seca').value.trim();
    if (!current_password || !security_question || !security_answer) {
      return alert('Please fill in all fields');
    }
    try {
      await Auth.api('/account/security-question', {
        method: 'PUT',
        body: JSON.stringify({ current_password, security_question, security_answer }),
      });
      alert('Security question updated ✅');
      renderAccount();
    } catch (err) {
      alert(err.message);
    }
  };
}

renderAccount();
