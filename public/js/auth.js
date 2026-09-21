// Shared auth state — included by every page before its own script
const Auth = {
  token: localStorage.getItem('retroToken') || null,
  username: localStorage.getItem('retroAuthUser') || null,
  initTheme() {
    // Move the pre-render class from <html> to <body> and keep it in sync
    if (document.documentElement.classList.contains('light-init')) {
      document.documentElement.classList.remove('light-init');
      document.body.classList.add('light-theme');
    }
  },
  set(token, username) {
    this.token = token;
    this.username = username;
    if (token) {
      localStorage.setItem('retroToken', token);
      localStorage.setItem('retroAuthUser', username);
    } else {
      localStorage.removeItem('retroToken');
      localStorage.removeItem('retroAuthUser');
    }
  },
  clear() { this.set(null, null); },
  // Fetch wrapper: adds the Bearer token and participant token when available
  async api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const participantToken = sessionStorage.getItem('retroParticipantToken');
    if (participantToken) headers['X-Participant-Token'] = participantToken;
    const res = await fetch(`/api${path}`, { ...options, headers });
    if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
    return res.json();
  },
  renderNav() {
    const nav = document.querySelector('header nav');
    if (!nav) return;
    const isGuest = sessionStorage.getItem('retroGuest') === '1' && !this.username;
    const authArea = this.username
      ? `<a href="/account.html">My Account</a><span class="nav-user">👤 ${Auth.esc(this.username)}</span><a href="#" id="nav-logout">Logout</a>`
      : isGuest
        ? `<span class="nav-user">👻 Guest</span><a href="#" id="nav-exit-guest">Exit guest mode</a><a href="#" id="nav-login">Login / Register</a>`
        : `<a href="#" id="nav-login">Login / Register</a>`;
    nav.innerHTML = `
      <a href="/">Home</a>
      <a href="/history.html">History</a>
      <a href="/leaderboard.html">Leaderboard</a>
      ${authArea}
      <button id="theme-toggle" class="theme-toggle" title="Toggle light/dark mode">🌙</button>`;
    const themeBtn = document.getElementById('theme-toggle');
    const syncThemeBtn = () => {
      themeBtn.textContent = document.body.classList.contains('light-theme') ? '🌙' : '☀️';
    };
    syncThemeBtn();
    themeBtn.onclick = () => {
      document.body.classList.toggle('light-theme');
      localStorage.setItem('retroTheme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
      syncThemeBtn();
    };
    const loginLink = document.getElementById('nav-login');
    if (loginLink) loginLink.onclick = e => { e.preventDefault(); this.openAuthModal(); };
    const logoutLink = document.getElementById('nav-logout');
    if (logoutLink) logoutLink.onclick = async e => {
      e.preventDefault();
      try { await this.api('/logout', { method: 'POST' }); } catch { /* ignore */ }
      this.clear();
      location.href = '/';
    };
    const exitGuestLink = document.getElementById('nav-exit-guest');
    if (exitGuestLink) exitGuestLink.onclick = e => {
      e.preventDefault();
      sessionStorage.removeItem('retroGuest');
      this.renderNav();
    };
  },
  esc(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // Toast notification (shared; falls back to alert if no #toast element)
  toast(message, cls = '') {
    const el = document.getElementById('toast');
    if (!el) { alert(message); return; }
    el.textContent = message;
    el.className = `toast ${cls}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  },
  openAuthModal(mode = 'login') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const isLogin = mode === 'login';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" aria-label="Close" title="Close">&times;</button>
        <h3>${isLogin ? 'Log In' : 'Create Account'}</h3>
        <p class="muted" style="font-size:0.85rem">Admins log in to create and manage their own retro spaces. Participants don't need an account.</p>
        <div class="form-group">
          <label>Username</label>
          <input id="auth-user" autocomplete="username">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="auth-pass" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
        </div>
        ${isLogin ? '' : `
        <div class="form-group">
          <label>Security question (to reset your password if you forget it)</label>
          <input id="auth-secq" placeholder="e.g. What is my favorite color?">
        </div>
        <div class="form-group">
          <label>Security answer</label>
          <input id="auth-seca" autocomplete="off">
        </div>`}
        <div class="modal-actions">
          <button class="btn secondary" id="auth-switch">${isLogin ? 'Need an account? Register' : 'Have an account? Log in'}</button>
          <button class="btn" id="auth-go">${isLogin ? 'Log In' : 'Register'}</button>
        </div>
        ${isLogin ? '<p class="muted" style="text-align:center;margin-top:12px"><a href="#" id="auth-forgot" style="color:var(--accent)">Forgot your password?</a> · <a href="#" id="auth-guest" style="color:var(--accent)">Continue as guest</a></p>' : ''}
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    // Click on the dark backdrop (not the modal itself) closes it
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    // Escape key closes it
    const escHandler = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    overlay.querySelector('#auth-switch').onclick = () => {
      document.removeEventListener('keydown', escHandler);
      close();
      this.openAuthModal(mode === 'login' ? 'register' : 'login');
    };
    overlay.querySelector('#auth-user').focus();
    const forgotLink = overlay.querySelector('#auth-forgot');
    if (forgotLink) forgotLink.onclick = e => { e.preventDefault(); close(); this.openForgotModal(); };
    const guestLink = overlay.querySelector('#auth-guest');
    if (guestLink) guestLink.onclick = e => {
      e.preventDefault();
      close();
      sessionStorage.setItem('retroGuest', '1');
      this.renderNav();
      location.reload();
    };
    const submit = async () => {
      const username = overlay.querySelector('#auth-user').value.trim();
      const password = overlay.querySelector('#auth-pass').value;
      if (!username || !password) return Auth.toast('Username and password are required');
      try {
        let body = { username, password };
        if (!isLogin) {
          const security_question = overlay.querySelector('#auth-secq').value.trim();
          const security_answer = overlay.querySelector('#auth-seca').value.trim();
          if (!security_question || !security_answer) {
            return Auth.toast('Security question and answer are required (they let you recover your password)');
          }
          body = { ...body, security_question, security_answer };
        }
        const result = await this.api(isLogin ? '/login' : '/register', {
          method: 'POST', body: JSON.stringify(body),
        });
        this.set(result.token, result.username);
        sessionStorage.removeItem('retroGuest');
        overlay.remove();
        this.renderNav();
        location.reload();
      } catch (err) {
        Auth.toast(err.message);
      }
    };
    overlay.querySelector('#auth-go').onclick = submit;
    overlay.addEventListener('keydown', e => e.key === 'Enter' && submit());
  },

  openForgotModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <button class="modal-close" aria-label="Close" title="Close">&times;</button>
        <h3>Reset Password</h3>
        <p class="muted" style="font-size:0.85rem">Step 1 of 2 — enter your username to see your security question.</p>
        <div class="form-group">
          <label>Username</label>
          <input id="fp-user" autocomplete="username">
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="fp-cancel">Cancel</button>
          <button class="btn" id="fp-next">Next</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').onclick = close;
    overlay.querySelector('#fp-cancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#fp-user').focus();
    overlay.querySelector('#fp-next').onclick = async () => {
      const username = overlay.querySelector('#fp-user').value.trim();
      if (!username) return Auth.toast('Please enter your username');
      try {
        const { security_question } = await this.api(`/forgot-password/${encodeURIComponent(username)}`);
        overlay.querySelector('.modal p.muted').textContent = 'Step 2 of 2 — answer your security question.';
        overlay.querySelector('.form-group').outerHTML = `
          <div class="form-group">
            <label>${Auth.esc(security_question)}</label>
            <input id="fp-answer" autocomplete="off">
          </div>
          <div class="form-group">
            <label>New password</label>
            <input type="password" id="fp-newpass" autocomplete="new-password">
          </div>`;
        const nextBtn = overlay.querySelector('#fp-next');
        nextBtn.textContent = 'Reset Password';
        nextBtn.onclick = async () => {
          const security_answer = overlay.querySelector('#fp-answer').value.trim();
          const new_password = overlay.querySelector('#fp-newpass').value;
          if (!security_answer || !new_password) return Auth.toast('Answer and new password are required');
          try {
            await this.api(`/forgot-password/${encodeURIComponent(username)}`, {
              method: 'POST',
              body: JSON.stringify({ security_answer, new_password }),
            });
            close();
            Auth.toast('Password updated! You can now log in with your new password.');
          } catch (err) {
            Auth.toast(err.message);
          }
        };
        overlay.querySelector('#fp-answer').focus();
      } catch (err) {
        Auth.toast(err.message);
      }
    };
  },
};
Auth.initTheme();
Auth.renderNav();
