// Shared auth state — included by every page before its own script
const Auth = {
  token: localStorage.getItem('retroToken') || null,
  username: localStorage.getItem('retroAuthUser') || null,
  initTheme() {
    // Move the pre-render class from <html> to <body> and keep it in sync
    if (document.documentElement.classList.contains('dark-init')) {
      document.documentElement.classList.remove('dark-init');
      document.body.classList.add('dark-theme');
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
        ? `<span class="nav-user">${I18N.t('auth.guest')}</span><a href="#" id="nav-exit-guest">${I18N.t('auth.exitGuest')}</a><a href="#" id="nav-login">${I18N.t('auth.loginRegister')}</a>`
        : `<a href="#" id="nav-login">${I18N.t('auth.loginRegister')}</a>`;
    const page = location.pathname;
    const active = p => (p === '/' ? location.pathname === '/' || location.pathname === '/index.html' : location.pathname === p) ? ' class="active"' : '';
    nav.innerHTML = `
      <a href="/"${active('/')}>Home</a>
      <a href="/onboarding.html"${active('/onboarding.html')}>Guide</a>
      <a href="/history.html"${active('/history.html')}>History</a>
      <a href="/leaderboard.html"${active('/leaderboard.html')}>Leaderboard</a>
      ${this.username ? `<a href="/my-commitments.html"${active('/my-commitments.html')}>My Commitments</a>` : ''}
      ${this.username ? `<a href="/org.html"${active('/org.html')}>Organization</a>` : ''}
      ${authArea}
      <button id="theme-toggle" class="theme-toggle" title="Toggle light/dark mode">🌙</button>
      <button id="lang-toggle" class="lang-toggle" title="Toggle English/Español">${(localStorage.getItem('retroLang') || 'en') === 'es' ? 'EN' : 'ES'}</button>
      ${page === '/account.html' ? '<a class="btn small secondary" href="javascript:history.back()">← Back</a>' : ''}`;
    const themeBtn = document.getElementById('theme-toggle');
    const syncThemeBtn = () => {
      themeBtn.textContent = document.body.classList.contains('dark-theme') ? '☀️' : '🌙';
    };
    syncThemeBtn();
    themeBtn.onclick = () => {
      document.body.classList.toggle('dark-theme');
      localStorage.setItem('retroTheme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
      syncThemeBtn();
    };
    const langBtn = document.getElementById('lang-toggle');
    if (langBtn) langBtn.onclick = () => {
      const next = (localStorage.getItem('retroLang') || 'en') === 'es' ? 'en' : 'es';
      localStorage.setItem('retroLang', next);
      // Reload so all dynamically rendered content re-renders in the new language
      location.reload();
    };
    // Translate nav links according to the selected language
    if (window.I18N) {
      const langMap = [
        ['a[href="/"]', 'nav.home'],
        ['a[href="/history.html"]', 'nav.history'],
        ['a[href="/leaderboard.html"]', 'nav.leaderboard'],
        ['a[href="/onboarding.html"]', 'nav.guide'],
        ['a[href="/my-commitments.html"]', 'nav.myCommitments'],
        ['a[href="/org.html"]', 'nav.org'],
        ['a[href="/account.html"]', 'nav.account'],
        ['#nav-logout', 'nav.logout'],
        ['#nav-login', 'nav.login'],
        ['#nav-exit-guest', 'nav.exitGuest'],
      ];
      for (const [sel, key] of langMap) {
        const el = nav.querySelector(sel);
        if (el) el.textContent = window.I18N.t(key);
      }
    }
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
    // Escape &, <, >, quotes and backtick — safe for both HTML content and
    // double-quoted attributes (prevents attribute-injection XSS)
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;');
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
        <h3>${isLogin ? I18N.t('auth.loginTitle') : I18N.t('auth.registerTitle')}</h3>
        <p class="muted" style="font-size:0.85rem">${I18N.t('auth.adminsHint')}</p>
        <div class="form-group">
          <label>${I18N.t('auth.username')}</label>
          <input id="auth-user" autocomplete="username">
        </div>
        <div class="form-group">
          <label>${I18N.t('auth.password')}</label>
          <input type="password" id="auth-pass" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
        </div>
        ${isLogin ? '' : `
        <div class="form-group">
          <label>${I18N.t('auth.secQuestionLabel')}</label>
          <input id="auth-secq" placeholder="${I18N.t('auth.secQPh')}">
        </div>
        <div class="form-group">
          <label>${I18N.t('auth.secAnswerLabel')}</label>
          <input id="auth-seca" autocomplete="off">
        </div>`}
        <div class="modal-actions">
          <button class="btn secondary" id="auth-switch">${isLogin ? I18N.t('auth.needAccount') : I18N.t('auth.haveAccount')}</button>
          <button class="btn" id="auth-go">${isLogin ? I18N.t('auth.loginBtn') : I18N.t('auth.register')}</button>
        </div>
        ${isLogin ? `<p class="muted" style="text-align:center;margin-top:12px"><a href="#" id="auth-forgot" style="color:var(--accent)">${I18N.t('auth.forgotPass')}</a> · <a href="#" id="auth-guest" style="color:var(--accent)">${I18N.t('auth.continueGuest')}</a></p>` : ''}
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
      if (!username || !password) return Auth.toast(I18N.t('auth.userPassRequired'));
      try {
        let body = { username, password };
        if (!isLogin) {
          const security_question = overlay.querySelector('#auth-secq').value.trim();
          const security_answer = overlay.querySelector('#auth-seca').value.trim();
          if (!security_question || !security_answer) {
            return Auth.toast(I18N.t('auth.secQARRequired'));
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
        <h3>${I18N.t('auth.resetTitle')}</h3>
        <p class="muted" style="font-size:0.85rem">${I18N.t('auth.step1')}</p>
        <div class="form-group">
          <label>${I18N.t('auth.username')}</label>
          <input id="fp-user" autocomplete="username">
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="fp-cancel">${I18N.t('common.cancel')}</button>
          <button class="btn" id="fp-next">${I18N.t('auth.next')}</button>
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
      if (!username) return Auth.toast(I18N.t('auth.enterUsername'));
      try {
        const { security_question } = await this.api(`/forgot-password/${encodeURIComponent(username)}`);
        overlay.querySelector('.modal p.muted').textContent = I18N.t('auth.step2');
        overlay.querySelector('.form-group').outerHTML = `
          <div class="form-group">
            <label>${Auth.esc(security_question)}</label>
            <input id="fp-answer" autocomplete="off">
          </div>
          <div class="form-group">
            <label>${I18N.t('auth.newPassLabel')}</label>
            <input type="password" id="fp-newpass" autocomplete="new-password">
          </div>`;
        const nextBtn = overlay.querySelector('#fp-next');
        nextBtn.textContent = I18N.t('auth.resetBtn');
        nextBtn.onclick = async () => {
          const security_answer = overlay.querySelector('#fp-answer').value.trim();
          const new_password = overlay.querySelector('#fp-newpass').value;
          if (!security_answer || !new_password) return Auth.toast(I18N.t('auth.answerPassRequired'));
          try {
            await this.api(`/forgot-password/${encodeURIComponent(username)}`, {
              method: 'POST',
              body: JSON.stringify({ security_answer, new_password }),
            });
            close();
            Auth.toast(I18N.t('auth.passUpdated'));
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
// Translate page chrome (elements with data-i18n) after nav render
if (window.I18N) window.I18N.apply();

// Show the "Usage Stats" link only to the master user (users.is_master),
// and the overdue-commitments badge on "My Commitments" for every user.
(async () => {
  try {
    if (!Auth.token) return;
    const { user } = await Auth.api('/me');
    if (user?.is_master) {
      const nav = document.querySelector('header nav');
      if (nav && !nav.querySelector('a[href="/admin.html"]')) {
        const logout = nav.querySelector('#nav-logout');
        const link = document.createElement('a');
        link.href = '/admin.html';
        link.textContent = 'Usage Stats';
        logout ? logout.before(link) : nav.appendChild(link);
      }
    }
  } catch { /* nav link is cosmetic; ignore */ }

  // Overdue badge on the "My Commitments" nav link
  try {
    if (!Auth.token) return;
    const { count } = await Auth.api('/my-overdue-count');
    if (count > 0) {
      const link = document.querySelector('header nav a[href="/my-commitments.html"]');
      if (link && !link.querySelector('.nav-badge')) {
        const badge = document.createElement('span');
        badge.className = 'nav-badge';
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.title = `You have ${count} overdue commitment${count === 1 ? '' : 's'}`;
        link.appendChild(badge);
      }
    }
  } catch { /* badge is cosmetic; ignore */ }

  // Due-soon badge (orange) on the "My Commitments" nav link
  try {
    if (!Auth.token) return;
    const { count } = await Auth.api('/my-due-soon-count');
    if (count > 0) {
      const link = document.querySelector('header nav a[href="/my-commitments.html"]');
      if (link && !link.querySelector('.nav-badge-due')) {
        const badge = document.createElement('span');
        badge.className = 'nav-badge nav-badge-due';
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.title = `${count} commitment${count === 1 ? '' : 's'} due within 3 days`;
        link.appendChild(badge);
      }
    }
  } catch { /* badge is cosmetic; ignore */ }
})();

// Page-view tracking: fire-and-forget beacon, no cookies, no PII.
// The server aggregates per page per day (UNIQUE(page, day) upsert).
try {
  const page = location.pathname === '/' ? 'home' : location.pathname.replace(/^\//, '').replace(/\.html$/, '') || 'home';
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page }),
    keepalive: true,
  }).catch(() => {});
} catch { /* tracking must never break the page */ }
