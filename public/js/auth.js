// Shared auth state — included by every page before its own script
const Auth = {
  token: localStorage.getItem('retroToken') || null,
  username: localStorage.getItem('retroAuthUser') || null,
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
    const authArea = this.username
      ? `<span class="nav-user">👤 ${Auth.esc(this.username)}</span><a href="#" id="nav-logout">Logout</a>`
      : `<a href="#" id="nav-login">Login / Register</a>`;
    nav.innerHTML = `
      <a href="/">Home</a>
      <a href="/history.html">History</a>
      <a href="/leaderboard.html">Leaderboard</a>
      ${authArea}`;
    const loginLink = document.getElementById('nav-login');
    if (loginLink) loginLink.onclick = e => { e.preventDefault(); this.openAuthModal(); };
    const logoutLink = document.getElementById('nav-logout');
    if (logoutLink) logoutLink.onclick = async e => {
      e.preventDefault();
      try { await this.api('/logout', { method: 'POST' }); } catch { /* ignore */ }
      this.clear();
      location.href = '/';
    };
  },
  esc(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  openAuthModal(mode = 'login') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${mode === 'login' ? 'Log In' : 'Create Account'}</h3>
        <p class="muted" style="font-size:0.85rem">Admins log in to create and manage their own retro spaces. Participants don't need an account.</p>
        <div class="form-group">
          <label>Username</label>
          <input id="auth-user" autocomplete="username">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="auth-pass" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="auth-switch">${mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}</button>
          <button class="btn" id="auth-go">${mode === 'login' ? 'Log In' : 'Register'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#auth-switch').onclick = () => { overlay.remove(); this.openAuthModal(mode === 'login' ? 'register' : 'login'); };
    overlay.querySelector('#auth-user').focus();
    const submit = async () => {
      const username = overlay.querySelector('#auth-user').value.trim();
      const password = overlay.querySelector('#auth-pass').value;
      if (!username || !password) return alert('Username and password are required');
      try {
        const result = await this.api(mode === 'login' ? '/login' : '/register', {
          method: 'POST', body: JSON.stringify({ username, password }),
        });
        this.set(result.token, result.username);
        overlay.remove();
        this.renderNav();
        location.reload();
      } catch (err) {
        alert(err.message);
      }
    };
    overlay.querySelector('#auth-go').onclick = submit;
    overlay.addEventListener('keydown', e => e.key === 'Enter' && submit());
  },
};
Auth.renderNav();
