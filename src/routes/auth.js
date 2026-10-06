// Auth & account routes: register, login, logout, password reset, account settings.
const crypto = require('crypto');
const {
  db, ah, authRateLimit, trackRateLimit,
  hashPassword, verifyPassword, getUser,
} = require('../helpers');

function register(app) {
  // Page-view tracking beacon: public, no cookies, no PII. Aggregates per page
  // per day via upsert so the table stays tiny.
  app.post('/api/track', trackRateLimit, ah(async (req, res) => {
    const page = String(req.body?.page || '').trim().slice(0, 60).replace(/[^a-z0-9_-]/gi, '') || 'home';
    await db.run(
      `INSERT INTO page_views (page, day, count) VALUES ($1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 1)
       ON CONFLICT (page, day) DO UPDATE SET count = page_views.count + 1`,
      [page]);
    res.status(204).end();
  }));

  app.post('/api/register', authRateLimit, ah(async (req, res) => {
    const { username, password, security_question, security_answer } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (username.trim().length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (username.trim().length > 40) return res.status(400).json({ error: 'Username must be at most 40 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (password.length > 100) return res.status(400).json({ error: 'Password must be at most 100 characters' });
    const existing = await db.get('SELECT id FROM users WHERE username = $1', [username.trim().toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Username already taken' });
    const info = await db.run(
      'INSERT INTO users (username, password_hash, security_question, security_answer_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [
        username.trim().toLowerCase(),
        hashPassword(password),
        security_question ? String(security_question).trim() : null,
        security_answer ? hashPassword(String(security_answer).trim().toLowerCase()) : null,
      ]);
    const token = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, Number(info.lastInsertRowid)]);
    res.status(201).json({ token, username: username.trim().toLowerCase() });
  }));

  // --- Password reset via security question (no email needed) ---
  app.get('/api/forgot-password/:username', ah(async (req, res) => {
    const user = await db.get('SELECT security_question FROM users WHERE username = $1', [req.params.username.trim().toLowerCase()]);
    if (!user || !user.security_question) {
      return res.status(404).json({ error: 'No security question found for this user' });
    }
    res.json({ security_question: user.security_question });
  }));

  app.post('/api/forgot-password/:username', authRateLimit, ah(async (req, res) => {
    const { security_answer, new_password } = req.body;
    if (!security_answer || !new_password) return res.status(400).json({ error: 'Answer and new password are required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = await db.get('SELECT id, security_answer_hash FROM users WHERE username = $1', [req.params.username.trim().toLowerCase()]);
    if (!user || !user.security_answer_hash || !verifyPassword(String(security_answer).trim().toLowerCase(), user.security_answer_hash)) {
      return res.status(401).json({ error: 'Incorrect answer to the security question' });
    }
    await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(new_password), user.id]);
    // Invalidate all existing sessions for safety
    await db.run('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    res.json({ ok: true });
  }));

  app.post('/api/login', authRateLimit, ah(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const user = await db.get('SELECT id, password_hash FROM users WHERE username = $1', [username.trim().toLowerCase()]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);
    res.json({ token, username: username.trim().toLowerCase() });
  }));

  app.post('/api/logout', ah(async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) await db.run('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ ok: true });
  }));

  app.get('/api/me', ah(async (req, res) => {
    const user = await getUser(req);
    res.json({ user });
  }));

  // --- Account management (requires login) ---
  app.get('/api/account', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    const row = await db.get('SELECT security_question, email, notify_overdue FROM users WHERE id = $1', [user.id]);
    res.json({
      username: user.username,
      security_question: row?.security_question || null,
      email: row?.email || '',
      notify_overdue: !!row?.notify_overdue,
    });
  }));

  app.put('/api/account/email', ah(async (req, res) => {
    const { email, notify_overdue } = req.body;
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    const emailTrimmed = email ? String(email).trim() : null;
    if (emailTrimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (notify_overdue && !emailTrimmed) {
      return res.status(400).json({ error: 'An email address is required to enable notifications' });
    }
    await db.run('UPDATE users SET email = $1, notify_overdue = $2 WHERE id = $3',
      [emailTrimmed, !!notify_overdue, user.id]);
    res.json({ ok: true });
  }));

  app.put('/api/account/password', ah(async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Current and new password are required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    const row = await db.get('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!row || !verifyPassword(current_password, row.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(new_password), user.id]);
    res.json({ ok: true });
  }));

  app.put('/api/account/security-question', ah(async (req, res) => {
    const { current_password, security_question, security_answer } = req.body;
    if (!security_question || !security_answer) return res.status(400).json({ error: 'Question and answer are required' });
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    const row = await db.get('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!row || !verifyPassword(current_password, row.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await db.run('UPDATE users SET security_question = $1, security_answer_hash = $2 WHERE id = $3',
      [String(security_question).trim(), hashPassword(String(security_answer).trim().toLowerCase()), user.id]);
    res.json({ ok: true });
  }));
}

module.exports = { register };
