const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Auth: scrypt password hashing + Bearer token sessions ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// Resolves the logged-in user from the Authorization header (or null).
// Sessions expire after 30 days.
async function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const row = await db.get(
    `SELECT u.id, u.username, u.is_master FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.created_at >= to_char(now() AT TIME ZONE 'UTC' - interval '30 days', 'YYYY-MM-DD HH24:MI:SS')`,
    [token]);
  return row || null;
}

// Resolves a retro participant from the X-Participant-Token header (or null).
// Participants join with the retro's invitation link and get their own token.
async function getParticipant(req, retroId) {
  const token = req.headers['x-participant-token'];
  if (!token) return null;
  return db.get(
    'SELECT id, name FROM participants WHERE access_token = $1 AND retro_id = $2',
    [token, retroId]) || null;
}

// Access check for retro content: the admin (logged-in creator) or a member
// (participant with valid token). Responds 401/403 and returns null when denied.
async function requireRetroAccess(req, res, retro) {
  if (!retro) { res.status(404).json({ error: 'Retro not found' }); return null; }
  const user = await getUser(req);
  if (user && user.username === retro.created_by) return { role: 'admin', name: user.username };
  const participant = await getParticipant(req, retro.id);
  if (participant) return { role: 'participant', name: participant.name };
  if (!user && !participant) {
    res.status(401).json({ error: 'Access denied: join this retro with its invitation link or log in as its admin' });
  } else {
    res.status(403).json({ error: 'You are not a member of this retro' });
  }
  return null;
}

// Async route wrapper: forwards errors to Express error handler
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// Simple in-memory rate limiter (no external deps): max N requests per window per IP
const rateBuckets = new Map();
function rateLimit({ windowMs = 60000, max = 20 } = {}) {
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests — try again in a minute' });
    }
    next();
  };
}
// Periodically clean expired buckets to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  }
}, 5 * 60000).unref();

const authRateLimit = rateLimit({ windowMs: 60000, max: 10 });
const trackRateLimit = rateLimit({ windowMs: 60000, max: 60 }); // page loads are infrequent; generous cap

// --- Freemium plan limits ---
const FREE_MAX_RETROS = 5;        // total retros a free user can create
const FREE_MAX_PARTICIPANTS = 25; // participants per retro on the free plan

// Validate that :id route params are numeric retro/card/commitment IDs.
// Non-numeric IDs (e.g. /retro.html?id=test) would otherwise hit Postgres
// with an invalid integer and surface as a 500 "Internal server error".
function validateNumericId(param = 'id') {
  return (req, res, next) => {
    const value = Number(req.params[param]);
    if (!Number.isInteger(value) || value <= 0) {
      return res.status(404).json({ error: 'Retro not found' });
    }
    req.params[param] = value;
    next();
  };
}
app.use('/api/retros/:id', validateNumericId('id'));
app.use('/api/cards/:id', validateNumericId('id'));
app.use('/api/commitments/:id', validateNumericId('id'));

// --- Users ---
// Master user: sees the usage stats panel. The first registered user is NOT
// automatically master; promote via SQL: UPDATE users SET is_master = TRUE WHERE username = '...'
async function requireMaster(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Log in required' }); return null; }
  if (!user.is_master) { res.status(403).json({ error: 'Master access required' }); return null; }
  return user;
}

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

// --- WebSocket: broadcast changes to all clients in a retro room ---
const rooms = new Map(); // retroId -> Set<ws>

function broadcast(retroId, event, payload) {
  const room = rooms.get(Number(retroId));
  if (!room) return;
  const message = JSON.stringify({ event, payload });
  for (const client of room) {
    if (client.readyState === 1) client.send(message);
  }
}

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const retroId = Number(url.searchParams.get('retroId'));
  if (!retroId) { ws.close(); return; }
  // Only retro members (admin or participants with their token) can listen
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [retroId]);
  if (!retro) { ws.close(); return; }
  const userToken = url.searchParams.get('userToken');
  const participantToken = url.searchParams.get('participantToken');
  let allowed = false;
  if (userToken) {
    const row = await db.get(
      'SELECT u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [userToken]);
    allowed = !!row && row.username === retro.created_by;
  }
  if (!allowed && participantToken) {
    const row = await db.get(
      'SELECT id FROM participants WHERE access_token = $1 AND retro_id = $2', [participantToken, retroId]);
    allowed = !!row;
  }
  if (!allowed) { ws.close(); return; }
  if (!rooms.has(retroId)) rooms.set(retroId, new Set());
  rooms.get(retroId).add(ws);
  ws.on('close', () => rooms.get(retroId)?.delete(ws));
});

// --- Retros ---
app.get('/api/retros', ah(async (req, res) => {
  // History list: only for logged-in users (retro admins)
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to see your retros' });
  const retros = await db.all(`
    SELECT r.*,
      (SELECT COUNT(*) FROM cards c WHERE c.retro_id = r.id) AS card_count,
      (SELECT COUNT(*) FROM commitments cm WHERE cm.retro_id = r.id) AS commitment_count
    FROM retros r
    WHERE r.created_by = $1
    ORDER BY r.created_at DESC`, [user.username]);
  res.json(retros);
}));

app.post('/api/retros', ah(async (req, res) => {
  const { title, sprint, carry_over_from, template, is_anonymous, custom_columns } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (String(title).trim().length > 100) return res.status(400).json({ error: 'Title must be at most 100 characters' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to create a retro' });
  // Freemium limits: free plan caps total retros and participants per retro
  const plan = (await db.get('SELECT plan FROM users WHERE id = $1', [user.id]))?.plan || 'free';
  if (plan === 'free') {
    const count = Number((await db.get('SELECT COUNT(*) AS n FROM retros WHERE created_by = $1', [user.username])).n);
    if (count >= FREE_MAX_RETROS) {
      return res.status(402).json({ error: `Free plan limit reached (${FREE_MAX_RETROS} retros). Upgrade to Pro for unlimited retros.` });
    }
  }
  const validTemplates = ['classic', 'ssc', 'msg', '4ls'];
  const tpl = validTemplates.includes(template) ? template : 'classic';
  // Custom columns: JSON array of {key,label} (2-8 columns). Takes precedence over the template.
  let customColumnsJson = null;
  if (custom_columns !== undefined && custom_columns !== null && String(custom_columns).trim() !== '') {
    let parsed;
    try { parsed = JSON.parse(custom_columns); } catch { return res.status(400).json({ error: 'custom_columns must be a JSON array of {key,label}' }); }
    if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > 8 ||
        !parsed.every(c => c && typeof c.key === 'string' && c.key.trim() && typeof c.label === 'string' && c.label.trim())) {
      return res.status(400).json({ error: 'custom_columns must be an array of 2-8 {key,label} objects' });
    }
    customColumnsJson = JSON.stringify(parsed.map(c => ({ key: c.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30), label: String(c.label).trim().slice(0, 40) })));
  }
  const joinCode = crypto.randomBytes(5).toString('hex'); // 10-char invitation code
  const info = await db.run(
    'INSERT INTO retros (title, sprint, created_by, template, is_anonymous, join_code, custom_columns) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [title, sprint || null, user.username, tpl, !!is_anonymous, joinCode, customColumnsJson]);
  const retroId = Number(info.lastInsertRowid);

  // The admin automatically becomes a member so they can add cards and vote
  const adminToken = crypto.randomBytes(24).toString('hex');
  await db.run(
    'INSERT INTO participants (retro_id, name, access_token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [retroId, user.username, adminToken]);

  // Carry-over: copy pending commitments from a previous retro into this one
  if (carry_over_from) {
    const source = await db.get('SELECT id FROM retros WHERE id = $1', [carry_over_from]);
    if (source) {
      const pending = await db.all(
        "SELECT description, assignee, due_date FROM commitments WHERE retro_id = $1 AND status != 'done'",
        [carry_over_from]);
      for (const cm of pending) {
        await db.run(
          'INSERT INTO commitments (retro_id, description, assignee, due_date) VALUES ($1, $2, $3, $4)',
          [retroId, cm.description, cm.assignee, cm.due_date]);
      }
    }
  }
  res.status(201).json({ id: retroId, title, sprint: sprint || null, join_code: joinCode, participant_token: adminToken });
}));

// Pending commitments of a retro (for the carry-over offer in the home page)
app.get('/api/retros/:id/pending-commitments', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  const rows = await db.all(
    "SELECT id, description, assignee, due_date FROM commitments WHERE retro_id = $1 AND status != 'done' ORDER BY created_at",
    [req.params.id]);
  res.json(rows);
}));

// Public preview: minimal info so the join screen can show what you're joining
app.get('/api/retros/:id/preview', ah(async (req, res) => {
  const retro = await db.get('SELECT id, title, sprint, status, template, is_anonymous, created_by FROM retros WHERE id = $1', [req.params.id]);
  if (!retro) return res.status(404).json({ error: 'Retro not found' });
  res.json(retro);
}));

app.get('/api/retros/:id', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  const access = await requireRetroAccess(req, res, retro);
  if (!access) return;
  res.json({ ...retro, join_code: access.role === 'admin' ? retro.join_code : undefined, is_admin: access.role === 'admin', webhook_url: access.role === 'admin' ? retro.webhook_url : undefined });
}));

// Only the retro's creator (admin) can close, reopen or delete it
async function requireRetroAdmin(req, res) {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!retro) { res.status(404).json({ error: 'Retro not found' }); return null; }
  const user = await getUser(req);
  if (!user || user.username !== retro.created_by) {
    res.status(403).json({ error: 'Only the retro admin can do this' });
    return null;
  }
  return retro;
}

app.post('/api/retros/:id/close', ah(async (req, res) => {
  if (!(await requireRetroAdmin(req, res))) return;
  await db.run("UPDATE retros SET status = 'closed' WHERE id = $1", [req.params.id]);
  broadcast(req.params.id, 'retro_closed', {});
  res.json({ ok: true });
}));

app.post('/api/retros/:id/reopen', ah(async (req, res) => {
  if (!(await requireRetroAdmin(req, res))) return;
  await db.run("UPDATE retros SET status = 'open' WHERE id = $1", [req.params.id]);
  broadcast(req.params.id, 'retro_reopened', {});
  res.json({ ok: true });
}));

app.delete('/api/retros/:id', ah(async (req, res) => {
  const retro = await requireRetroAdmin(req, res);
  if (!retro) return;
  await db.run('DELETE FROM points WHERE retro_id = $1', [retro.id]);
  await db.run('DELETE FROM votes WHERE retro_id = $1', [retro.id]);
  await db.run('DELETE FROM cards WHERE retro_id = $1', [retro.id]);
  await db.run('DELETE FROM commitments WHERE retro_id = $1', [retro.id]);
  await db.run('DELETE FROM participants WHERE retro_id = $1', [retro.id]);
  await db.run('DELETE FROM retros WHERE id = $1', [retro.id]);
  broadcast(retro.id, 'retro_deleted', {});
  res.json({ ok: true });
}));

// --- Participants ---
app.post('/api/retros/:id/join', ah(async (req, res) => {
  const { name, join_code } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!retro) return res.status(404).json({ error: 'Retro not found' });
  if (!join_code || join_code.trim().toLowerCase() !== (retro.join_code || '').toLowerCase()) {
    return res.status(403).json({ error: 'Invalid invitation code. Ask the retro admin for the link.' });
  }
  const trimmed = name.trim();
  // Re-join: if the name already exists, hand back the existing token
  const existing = await db.get('SELECT access_token FROM participants WHERE retro_id = $1 AND name = $2', [retro.id, trimmed]);
  if (existing) {
    return res.json({ ok: true, name: trimmed, access_token: existing.access_token });
  }
  // Freemium limit: participants per retro on the free plan
  const adminPlan = (await db.get(
    "SELECT plan FROM users WHERE username = $1", [retro.created_by]))?.plan || 'free';
  if (adminPlan === 'free') {
    const count = Number((await db.get(
      'SELECT COUNT(*) AS n FROM participants WHERE retro_id = $1', [retro.id])).n);
    if (count >= FREE_MAX_PARTICIPANTS) {
      return res.status(402).json({ error: `Free plan limit reached (${FREE_MAX_PARTICIPANTS} participants per retro). Ask the admin to upgrade.` });
    }
  }
  const accessToken = crypto.randomBytes(24).toString('hex');
  await db.run(
    'INSERT INTO participants (retro_id, name, access_token) VALUES ($1, $2, $3)',
    [retro.id, trimmed, accessToken]);
  broadcast(retro.id, 'participants_changed', {});
  res.json({ ok: true, name: trimmed, access_token: accessToken });
}));

app.get('/api/retros/:id/participants', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  const rows = await db.all(
    'SELECT name, joined_at FROM participants WHERE retro_id = $1 ORDER BY joined_at', [req.params.id]);
  res.json(rows);
}));

// --- Cards ---
// Column layouts per retro template
const TEMPLATE_COLUMNS = {
  classic: ['went_well', 'didnt_go_well', 'action'],
  ssc: ['start_doing', 'stop_doing', 'continue_doing'],
  msg: ['mad', 'sad', 'glad'],
  '4ls': ['liked', 'learned', 'lacked', 'longed_for'],
};

// Human-readable labels for the built-in template columns (acta/summary exports)
const TEMPLATE_LABELS = {
  classic: { went_well: 'What Went Well', didnt_go_well: "What Didn't Go Well", action: 'Action Items' },
  ssc: { start_doing: 'Start Doing', stop_doing: 'Stop Doing', continue_doing: 'Continue Doing' },
  msg: { mad: 'Mad', sad: 'Sad', glad: 'Glad' },
  '4ls': { liked: 'Liked', learned: 'Learned', lacked: 'Lacked', longed_for: 'Longed For' },
};

// Parse the custom_columns JSON of a retro (array of {key,label}).
// Returns { columns, labels } when valid, or null when absent/invalid.
function parseCustomColumns(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 8 &&
        parsed.every(c => c && typeof c.key === 'string' && c.key && c.label)) {
      return {
        columns: parsed.map(p => String(p.key)),
        labels: Object.fromEntries(parsed.map(p => [String(p.key), String(p.label)])),
      };
    }
  } catch { /* invalid JSON → built-in */ }
  return null;
}

// Resolve the valid column types for a retro (custom columns take precedence)
function columnsOf(retro) {
  if (retro.custom_columns) {
    const parsed = parseCustomColumns(retro.custom_columns);
    if (parsed) return parsed.columns;
  }
  return TEMPLATE_COLUMNS[retro.template] || TEMPLATE_COLUMNS.classic;
}

// Resolve the column list + labels of a retro (custom columns take precedence)
function resolveColumns(retro) {
  if (retro.custom_columns) {
    const parsed = parseCustomColumns(retro.custom_columns);
    if (parsed) return parsed;
  }
  return { columns: TEMPLATE_COLUMNS[retro.template] || TEMPLATE_COLUMNS.classic, labels: null };
}

app.get('/api/retros/:id/cards', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  const cards = await db.all(`
    SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.card_id = c.id) AS votes
    FROM cards c WHERE c.retro_id = $1 ORDER BY c.created_at`, [req.params.id]);
  if (retro.is_anonymous) {
    res.json(cards.map(c => ({ ...c, author: 'Anonymous' })));
  } else {
    res.json(cards);
  }
}));

app.post('/api/retros/:id/cards', ah(async (req, res) => {
  const { column_type, content } = req.body;
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  const access = await requireRetroAccess(req, res, retro);
  if (!access) return;
  if (!columnsOf(retro).includes(column_type))
    return res.status(400).json({ error: 'Invalid column' });
  if (!content) return res.status(400).json({ error: 'Content is required' });
  if (String(content).trim().length > 500) return res.status(400).json({ error: 'Card content must be at most 500 characters' });
  // The author identity comes from the authenticated access (token), never from the body
  const author = access.name;
  const info = await db.run(
    'INSERT INTO cards (retro_id, column_type, content, author) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.params.id, column_type, content.trim(), author]);
  let card = await db.get('SELECT c.*, 0 AS votes FROM cards c WHERE c.id = $1', [info.lastInsertRowid]);
  if (retro.is_anonymous) card = { ...card, author: 'Anonymous' };
  broadcast(req.params.id, 'card_added', card);
  res.status(201).json(card);
}));

app.put('/api/cards/:id', ah(async (req, res) => {
  const { content, column_type, group_label } = req.body;
  const card = await db.get('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [card.retro_id]);
  const access = await requireRetroAccess(req, res, retro);
  if (!access) return;
  // Editing content: only the card's author or the retro admin.
  // Moving between columns: any participant can.
  const isContentEdit = content !== undefined && content.trim() !== card.content;
  if (isContentEdit && access.role !== 'admin' && card.author !== access.name) {
    return res.status(403).json({ error: 'Only the card author or the retro admin can edit this card' });
  }
  // Moving between columns is allowed for any participant; editing content only author/admin
  if (column_type !== undefined) {
    if (!columnsOf(retro).includes(column_type))
      return res.status(400).json({ error: 'Invalid column' });
  }
  const newColumn = column_type !== undefined ? column_type : card.column_type;
  const newGroup = group_label !== undefined ? (group_label ? String(group_label).trim().slice(0, 40) : null) : card.group_label;
  await db.run('UPDATE cards SET content = $1, column_type = $2, group_label = $3 WHERE id = $4',
    [content !== undefined ? content.trim() : card.content, newColumn, newGroup, req.params.id]);
  const updated = await db.get(`
    SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.card_id = c.id) AS votes FROM cards c WHERE c.id = $1`,
    [req.params.id]);
  broadcast(card.retro_id, 'card_updated', updated);
  res.json(updated);
}));

app.delete('/api/cards/:id', ah(async (req, res) => {
  const card = await db.get('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [card.retro_id]);
  const access = await requireRetroAccess(req, res, retro);
  if (!access) return;
  // Only the card's author or the retro admin can delete it
  if (access.role !== 'admin' && card.author !== access.name) {
    return res.status(403).json({ error: 'Only the card author or the retro admin can delete this card' });
  }
  await db.run('DELETE FROM votes WHERE card_id = $1', [req.params.id]);
  await db.run('DELETE FROM cards WHERE id = $1', [req.params.id]);
  broadcast(card.retro_id, 'card_deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

// --- Votes ---
const MAX_VOTES_PER_VOTER = 3;

app.post('/api/cards/:id/vote', ah(async (req, res) => {
  const card = await db.get('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [card.retro_id]);
  const access = await requireRetroAccess(req, res, retro);
  if (!access) return;
  // The voter identity comes from the authenticated access (token), never from the body
  const voter = access.name;
  const existing = await db.get('SELECT id FROM votes WHERE card_id = $1 AND voter = $2', [req.params.id, voter]);
  if (existing) {
    await db.run('DELETE FROM votes WHERE id = $1', [existing.id]);
  } else {
    // Enforce per-voter vote limit within this retro
    const used = Number((await db.get(
      'SELECT COUNT(*) AS n FROM votes WHERE retro_id = $1 AND voter = $2', [card.retro_id, voter])).n);
    if (used >= MAX_VOTES_PER_VOTER) {
      return res.status(400).json({ error: `Vote limit reached (${MAX_VOTES_PER_VOTER} per person). Remove a vote first.` });
    }
    await db.run('INSERT INTO votes (card_id, voter, retro_id) VALUES ($1, $2, $3)',
      [req.params.id, voter, card.retro_id]);
  }
  const votes = Number((await db.get('SELECT COUNT(*) AS n FROM votes WHERE card_id = $1', [req.params.id])).n);
  broadcast(card.retro_id, 'votes_changed', { cardId: Number(req.params.id), votes });
  res.json({ votes });
}));

// Votes cast by a voter in a retro (for the frontend counter)
app.get('/api/retros/:id/votes-used', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  const { voter } = req.query;
  if (!voter) return res.status(400).json({ error: 'voter is required' });
  const row = await db.get('SELECT COUNT(*) AS n FROM votes WHERE retro_id = $1 AND voter = $2', [req.params.id, voter]);
  res.json({ used: Number(row.n), max: MAX_VOTES_PER_VOTER });
}));

// --- Commitments ---
app.get('/api/retros/:id/commitments', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  const rows = await db.all(
    'SELECT * FROM commitments WHERE retro_id = $1 ORDER BY created_at', [req.params.id]);
  res.json(rows);
}));

app.post('/api/retros/:id/commitments', ah(async (req, res) => {
  const { description, assignee, due_date } = req.body;
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  if (!description || !assignee) return res.status(400).json({ error: 'Description and assignee are required' });
  const info = await db.run(
    'INSERT INTO commitments (retro_id, description, assignee, due_date) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.params.id, description.trim(), assignee, due_date || null]);
  const commitment = await db.get('SELECT * FROM commitments WHERE id = $1', [info.lastInsertRowid]);
  broadcast(req.params.id, 'commitment_added', commitment);
  notifyWebhook(retro.id, `📋 New commitment in "${retro.title}": ${commitment.description} — assigned to ${commitment.assignee}${commitment.due_date ? ` (due ${commitment.due_date})` : ''}`);
  res.status(201).json(commitment);
}));

app.put('/api/commitments/:id', ah(async (req, res) => {
  const { description, assignee, due_date, status } = req.body;
  const commitment = await db.get('SELECT * FROM commitments WHERE id = $1', [req.params.id]);
  if (!commitment) return res.status(404).json({ error: 'Commitment not found' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [commitment.retro_id]);
  const access = await requireRetroAccess(req, res, retro);
  if (!access) return;
  // Only the assignee or the retro admin can update a commitment
  if (access.role !== 'admin' && commitment.assignee !== access.name) {
    return res.status(403).json({ error: 'Only the assignee or the retro admin can update this commitment' });
  }
  const newStatus = status ?? commitment.status;
  await db.run(`UPDATE commitments SET description = $1, assignee = $2, due_date = $3, status = $4,
    completed_at = CASE WHEN $4 = 'done' AND completed_at IS NULL THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') ELSE completed_at END
    WHERE id = $5`,
    [description ?? commitment.description, assignee ?? commitment.assignee,
      due_date ?? commitment.due_date, newStatus, req.params.id]);
  const updated = await db.get('SELECT * FROM commitments WHERE id = $1', [req.params.id]);

  // Gamification: award points when a commitment transitions to done
  if (status === 'done' && commitment.status !== 'done') {
    await db.run(
      'INSERT INTO points (participant_name, retro_id, commitment_id, amount, reason) VALUES ($1, $2, $3, 10, $4)',
      [updated.assignee, updated.retro_id, updated.id, 'Commitment completed']);
    broadcast(updated.retro_id, 'points_awarded', { participant: updated.assignee, amount: 10 });
    notifyWebhook(retro.id, `✅ Commitment completed in "${retro.title}": ${updated.description} — kudos to ${updated.assignee} (+10 points) 🎉`);
  }
  // Remove points if it goes back from done
  if (status && status !== 'done' && commitment.status === 'done') {
    await db.run('DELETE FROM points WHERE commitment_id = $1', [updated.id]);
    broadcast(updated.retro_id, 'points_revoked', { participant: updated.assignee });
  }

  broadcast(updated.retro_id, 'commitment_updated', updated);
  res.json(updated);
}));

app.delete('/api/commitments/:id', ah(async (req, res) => {
  const commitment = await db.get('SELECT * FROM commitments WHERE id = $1', [req.params.id]);
  if (!commitment) return res.status(404).json({ error: 'Commitment not found' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [commitment.retro_id]);
  const access = await requireRetroAccess(req, res, retro);
  if (!access) return;
  // Only the assignee or the retro admin can delete a commitment
  if (access.role !== 'admin' && commitment.assignee !== access.name) {
    return res.status(403).json({ error: 'Only the assignee or the retro admin can delete this commitment' });
  }
  await db.run('DELETE FROM points WHERE commitment_id = $1', [req.params.id]);
  await db.run('DELETE FROM commitments WHERE id = $1', [req.params.id]);
  broadcast(commitment.retro_id, 'commitment_deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

// --- Commitments dashboard: all pending/overdue commitments across retros ---
app.get('/api/commitments-dashboard', ah(async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to see the commitments dashboard' });
  const rows = await db.all(`
    SELECT cm.id, cm.description, cm.assignee, cm.due_date, cm.status, cm.retro_id,
      r.title AS retro_title, r.status AS retro_status,
      CASE WHEN cm.due_date IS NOT NULL AND cm.status != 'done' AND cm.due_date < to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        THEN TRUE ELSE FALSE END AS is_overdue
    FROM commitments cm JOIN retros r ON r.id = cm.retro_id
    WHERE cm.status != 'done' AND r.created_by = $1
    ORDER BY is_overdue DESC, cm.due_date ASC NULLS LAST, cm.created_at ASC`, [user.username]);
  res.json(rows);
}));

// --- Usage stats (master only): product metrics + page views ---
app.get('/api/stats', ah(async (req, res) => {
  if (!(await requireMaster(req, res))) return;
  const [totals, activity, topPages, topUsers] = await Promise.all([
    db.get(`
      SELECT
        (SELECT COUNT(*) FROM users) AS registered_users,
        (SELECT COUNT(DISTINCT name) FROM participants) AS unique_participants,
        (SELECT COUNT(*) FROM retros) AS total_retros,
        (SELECT COUNT(*) FROM retros WHERE status = 'open') AS open_retros,
        (SELECT COUNT(*) FROM cards) AS total_cards,
        (SELECT COUNT(*) FROM commitments) AS total_commitments,
        (SELECT COUNT(*) FROM commitments WHERE status = 'done') AS done_commitments,
        (SELECT COALESCE(SUM(count), 0) FROM page_views) AS total_page_views`),
    db.all(`
      SELECT day, SUM(count)::int AS views FROM page_views
      WHERE day >= to_char(now() AT TIME ZONE 'UTC' - INTERVAL '30 days', 'YYYY-MM-DD')
      GROUP BY day ORDER BY day`),
    db.all(`
      SELECT page, SUM(count)::int AS views FROM page_views
      GROUP BY page ORDER BY views DESC LIMIT 10`),
    db.all(`
      SELECT p.name,
        COUNT(DISTINCT p.retro_id) AS retros_participated,
        (SELECT COUNT(*) FROM commitments cm WHERE cm.assignee = p.name AND cm.status = 'done') AS commitments_done,
        (SELECT COUNT(*) FROM points pt WHERE pt.participant_name = p.name) AS points
      FROM participants p
      GROUP BY p.name
      ORDER BY commitments_done DESC, retros_participated DESC
      LIMIT 10`),
  ]);
  res.json({ totals, activity, topPages, topUsers });
}));

// --- User management (master only) ---
// List all registered users with their usage footprint.
app.get('/api/admin/users', ah(async (req, res) => {
  if (!(await requireMaster(req, res))) return;
  const rows = await db.all(`
    SELECT u.id, u.username, u.email, u.is_master, u.plan, u.created_at,
      (SELECT COUNT(*) FROM retros r WHERE r.created_by = u.username) AS retros_created,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS active_sessions
    FROM users u
    ORDER BY u.created_at ASC`);
  res.json(rows);
}));

// Update a user: email, master flag, or password reset.
app.put('/api/admin/users/:id', ah(async (req, res) => {
  const master = await requireMaster(req, res);
  if (!master) return;
  const target = await db.get('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const { email, is_master, password } = req.body;
  if (email !== undefined && String(email).trim().length > 200)
    return res.status(400).json({ error: 'Email too long' });
  if (is_master === true && master.id === Number(req.params.id))
    return res.status(400).json({ error: 'You are already master' });
  if (password !== undefined && (typeof password !== 'string' || password.length < 8))
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (email !== undefined) {
    await db.run('UPDATE users SET email = $1 WHERE id = $2', [String(email).trim() || null, req.params.id]);
  }
  if (is_master !== undefined) {
    await db.run('UPDATE users SET is_master = $1 WHERE id = $2', [!!is_master, req.params.id]);
  }
  if (password !== undefined) {
    await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), req.params.id]);
    // Force re-login after a password reset
    await db.run('DELETE FROM sessions WHERE user_id = $1', [Number(req.params.id)]);
  }
  res.json({ ok: true });
}));

// Delete a user. Their retros are reassigned to the master so history is kept.
app.delete('/api/admin/users/:id', ah(async (req, res) => {
  const master = await requireMaster(req, res);
  if (!master) return;
  const target = await db.get('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === master.id)
    return res.status(400).json({ error: 'You cannot delete your own account' });
  // Reassign retros to the master so history/dashboard keep working
  await db.run('UPDATE retros SET created_by = $1 WHERE created_by = $2', [master.username, target.username]);
  await db.run('DELETE FROM users WHERE id = $1', [Number(req.params.id)]); // sessions CASCADE
  res.json({ ok: true });
}));

// --- My Commitments: all commitments assigned to the logged-in user across their retros ---
app.get('/api/my-commitments', ah(async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to see your commitments' });
  const rows = await db.all(`
    SELECT cm.id, cm.description, cm.assignee, cm.due_date, cm.status, cm.retro_id,
      r.title AS retro_title, r.status AS retro_status,
      CASE WHEN cm.due_date IS NOT NULL AND cm.status != 'done' AND cm.due_date < to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        THEN TRUE ELSE FALSE END AS is_overdue
    FROM commitments cm JOIN retros r ON r.id = cm.retro_id
    WHERE cm.assignee = $1 AND r.created_by = $2
    ORDER BY CASE cm.status WHEN 'done' THEN 1 ELSE 0 END, is_overdue DESC, cm.due_date ASC NULLS LAST, cm.created_at ASC`,
    [user.username, user.username]);
  res.json(rows);
}));

// --- Evolution: completed commitments per retro (for the history chart) ---
app.get('/api/evolution', ah(async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to see the evolution chart' });
  const rows = await db.all(`
    SELECT r.id, r.title, r.sprint, r.created_at,
      COUNT(CASE WHEN cm.status = 'done' THEN 1 END) AS completed,
      COUNT(*) AS total
    FROM retros r LEFT JOIN commitments cm ON cm.retro_id = r.id
    WHERE r.created_by = $1
    GROUP BY r.id ORDER BY r.created_at ASC`, [user.username]);
  res.json(rows);
}));

// --- Gamification / leaderboard ---
// Global leaderboard: only for logged-in users (points are per admin's retros)
app.get('/api/leaderboard', ah(async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to see the leaderboard' });
  const rows = await db.all(`
    SELECT p.participant_name, SUM(p.amount) AS total_points,
      COUNT(CASE WHEN p.reason = 'Commitment completed' THEN 1 END) AS completed_commitments
    FROM points p
    JOIN retros r ON r.id = p.retro_id
    WHERE r.created_by = $1
    GROUP BY p.participant_name ORDER BY total_points DESC`, [user.username]);
  res.json(rows);
}));

app.get('/api/retros/:id/leaderboard', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  const rows = await db.all(`
    SELECT participant_name, SUM(amount) AS total_points
    FROM points WHERE retro_id = $1 GROUP BY participant_name ORDER BY total_points DESC`, [req.params.id]);
  res.json(rows);
}));

// --- Acta (minutes) export ---
app.get('/api/retros/:id/acta', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!retro) return res.status(404).json({ error: 'Retro not found' });
  // Accept the participant token via query param (download links can't set headers)
  if (req.query.token) req.headers['x-participant-token'] = req.query.token;
  if (!(await requireRetroAccess(req, res, retro))) return;
  const cards = await db.all(`
    SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.card_id = c.id) AS votes
    FROM cards c WHERE c.retro_id = $1 ORDER BY votes DESC, c.created_at`, [req.params.id]);
  const commitments = await db.all(
    'SELECT * FROM commitments WHERE retro_id = $1 ORDER BY created_at', [req.params.id]);
  const participants = await db.all(
    'SELECT name FROM participants WHERE retro_id = $1 ORDER BY joined_at', [req.params.id]);

  const lines = [];
  lines.push(`# Retrospective Minutes — ${retro.title}`);
  if (retro.sprint) lines.push(`**Sprint:** ${retro.sprint}`);
  lines.push(`**Date:** ${retro.created_at}`);
  lines.push(`**Participants:** ${participants.map(p => p.name).join(', ') || '—'}`);
  lines.push('');
  // Iterate the retro's columns (custom or template) so no cards are left out
  const resolved = resolveColumns(retro);
  const columns = resolved.labels || TEMPLATE_LABELS[retro.template] || TEMPLATE_LABELS.classic;
  for (const [col, label] of Object.entries(columns)) {
    lines.push(`## ${label}`);
    for (const c of cards.filter(c => c.column_type === col)) {
      lines.push(`- ${c.content} _(${c.votes} 👍, by ${c.author})_`);
    }
    lines.push('');
  }
  lines.push('## Commitments');
  for (const cm of commitments) {
    const due = cm.due_date ? ` — due ${cm.due_date}` : '';
    lines.push(`- [${cm.status === 'done' ? 'x' : ' '}] ${cm.description} — **${cm.assignee}**${due} _(${cm.status})_`);
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="retro-${retro.id}-minutes.md"`);
  res.send(lines.join('\n'));
}));

// --- Team Health Score: composite 0-100 per retro (participation, engagement, follow-through) ---
app.get('/api/health-score', ah(async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to see the health score' });
  const retros = await db.all('SELECT id, title, sprint, created_at, status FROM retros WHERE created_by = $1 ORDER BY created_at ASC', [user.username]);
  const scores = [];
  for (const retro of retros) {
    const [participants, cards, votes, commitments] = await Promise.all([
      db.get('SELECT COUNT(*) AS n FROM participants WHERE retro_id = $1', [retro.id]),
      db.get('SELECT COUNT(*) AS n FROM cards WHERE retro_id = $1', [retro.id]),
      db.get('SELECT COUNT(*) AS n FROM votes WHERE retro_id = $1', [retro.id]),
      db.all('SELECT status FROM commitments WHERE retro_id = $1', [retro.id]),
    ]);
    const participantCount = Number(participants.n) || 0;
    const cardCount = Number(cards.n);
    const voteCount = Number(votes.n);
    const totalCm = commitments.length;
    const doneCm = commitments.filter(c => c.status === 'done').length;
    // Participation: cards per participant, saturating at 3 cards each
    const participation = Math.min(100, Math.round((participantCount ? cardCount / participantCount : 0) / 3 * 100));
    // Engagement: votes per card, saturating at 1 vote per card
    const engagement = Math.min(100, Math.round(cardCount ? (voteCount / cardCount) * 100 : 0));
    // Follow-through: % of commitments completed
    const followThrough = totalCm ? Math.round(doneCm / totalCm * 100) : 0;
    const score = Math.round(participation * 0.4 + engagement * 0.3 + followThrough * 0.3);
    scores.push({
      retro_id: retro.id, title: retro.title, sprint: retro.sprint, created_at: retro.created_at,
      participants: participantCount, cards: cardCount, votes: voteCount,
      commitments_total: totalCm, commitments_done: doneCm,
      participation, engagement, follow_through: followThrough, score,
    });
  }
  res.json(scores);
}));

// --- AI-assisted features (heuristic, no external API needed) ---
const STOP_WORDS = new Set(('a an and are as at be but by for from has have how i if in is it its of on or ' +
  'that the this to was we what when where which who will with you our your their they them he she not no yes ' +
  'very just so than then too can could should would will shall may might must do does did done get got make ' +
  'made really about into over under again more most some such only own same s t don now').split(' '));

const POSITIVE_WORDS = new Set(('good great well awesome love loved excellent happy glad nice amazing better best ' +
  'win winning success successful improve improved improvement fast smooth clear helpful productive fun easy ' +
  'solid strong proud enjoy enjoyed efficient reliable fantastic perfect thanks thank appreciate appreciated ' +
  'like liked useful valuable quick robust').split(' '));
const NEGATIVE_WORDS = new Set(('bad worse worst hate hated sad angry upset mad frustrated frustrating slow ' +
  'blocked blocker bug bugs broken fail failed failure issue issues problem problems unclear confusing confused ' +
  'difficult hard delay delayed late overdue missing lost stuck tedious painful annoying poor weak unstable ' +
  'crash crashed error errors wrong struggle struggled lack lacked lacking').split(' '));

function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9áéíóúüñ\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function sentimentOf(text) {
  const words = String(text).toLowerCase().split(/[^a-z]+/);
  let score = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) score += 1;
    if (NEGATIVE_WORDS.has(w)) score -= 1;
  }
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

// Auto-group: cluster cards by word-set similarity (Jaccard) and label groups by top keywords
app.post('/api/retros/:id/auto-group', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  const cards = await db.all('SELECT id, content, column_type FROM cards WHERE retro_id = $1', [req.params.id]);
  const tokenSets = cards.map(c => ({ id: c.id, column_type: c.column_type, tokens: new Set(tokenize(c.content)) }));
  // Greedy agglomerative clustering: merge cards sharing >= 0.25 Jaccard with any group member
  const JACCARD_THRESHOLD = 0.25;
  const groups = [];
  for (const item of tokenSets) {
    let placed = false;
    for (const group of groups) {
      const similar = group.some(member => {
        const union = new Set([...item.tokens, ...member.tokens]);
        if (!union.size) return false;
        let shared = 0;
        for (const t of item.tokens) if (member.tokens.has(t)) shared += 1;
        return shared / union.size >= JACCARD_THRESHOLD;
      });
      if (similar) { group.push(item); placed = true; break; }
    }
    if (!placed) groups.push([item]);
  }
  // Label each group with its most frequent keyword; singletons stay ungrouped
  let grouped = 0;
  for (const group of groups) {
    if (group.length < 2) continue;
    const freq = {};
    for (const item of group) for (const t of item.tokens) freq[t] = (freq[t] || 0) + 1;
    const label = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    for (const item of group) {
      await db.run('UPDATE cards SET group_label = $1 WHERE id = $2', [label, item.id]);
      grouped += 1;
    }
  }
  const cardsUpdated = await db.all(`
    SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.card_id = c.id) AS votes
    FROM cards c WHERE c.retro_id = $1 ORDER BY c.created_at`, [req.params.id]);
  broadcast(retro.id, 'cards_refresh', {});
  res.json({ grouped, groups: groups.filter(g => g.length >= 2).length, cards: cardsUpdated });
}));

// Executive summary: top cards per column, sentiment balance and commitment status
app.get('/api/retros/:id/summary', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  const cards = await db.all(`
    SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.card_id = c.id) AS votes
    FROM cards c WHERE c.retro_id = $1`, [req.params.id]);
  const commitments = await db.all('SELECT * FROM commitments WHERE retro_id = $1', [req.params.id]);
  const participants = await db.all('SELECT name FROM participants WHERE retro_id = $1', [req.params.id]);
  const resolved = resolveColumns(retro);
  const labels = resolved.labels || TEMPLATE_LABELS[retro.template] || TEMPLATE_LABELS.classic;
  const lines = [];
  lines.push(`# Executive Summary — ${retro.title}`);
  if (retro.sprint) lines.push(`Sprint: ${retro.sprint}`);
  lines.push(`Participants: ${participants.length} · Cards: ${cards.length} · Commitments: ${commitments.length} (${commitments.filter(c => c.status === 'done').length} done)`);
  lines.push('');
  for (const [col, label] of Object.entries(labels)) {
    const colCards = cards.filter(c => c.column_type === col).sort((a, b) => b.votes - a.votes);
    if (!colCards.length) continue;
    lines.push(`## ${col === 'action' ? 'Top Action Items' : label}`);
    for (const c of colCards.slice(0, 3)) {
      lines.push(`- ${c.content} (${c.votes} 👍)`);
    }
    lines.push('');
  }
  // Sentiment balance across all cards
  const sentiments = cards.map(c => sentimentOf(c.content));
  const pos = sentiments.filter(s => s === 'positive').length;
  const neg = sentiments.filter(c => c === 'negative').length;
  const mood = cards.length ? Math.round((pos - neg) / cards.length * 100) : 0;
  lines.push(`## Team Sentiment`);
  lines.push(`${pos} positive / ${neg} negative / ${sentiments.length - pos - neg} neutral cards → overall mood: ${mood >= 40 ? '😊 Positive' : mood <= -20 ? '😟 Needs attention' : '😐 Mixed'} (${mood > 0 ? '+' : ''}${mood})`);
  lines.push('');
  lines.push(`## Commitments`);
  for (const cm of commitments) {
    lines.push(`- [${cm.status === 'done' ? 'x' : ' '}] ${cm.description} — ${cm.assignee}${cm.due_date ? ` (due ${cm.due_date})` : ''}`);
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(lines.join('\n'));
}));

// --- Integrations: Slack/Teams webhook per retro ---
app.put('/api/retros/:id/webhook', ah(async (req, res) => {
  const retro = await requireRetroAdmin(req, res);
  if (!retro) return;
  const { webhook_url } = req.body;
  const url = webhook_url ? String(webhook_url).trim() : null;
  if (url && !/^https:\/\/(hooks\.slack\.com\/|outlook\.office\.com\/|webhook\.office\.com\/|.*\.office\.com\/)/.test(url)) {
    return res.status(400).json({ error: 'Use a Slack or Microsoft Teams webhook URL (https://hooks.slack.com/... or Teams workflow webhook)' });
  }
  await db.run('UPDATE retros SET webhook_url = $1 WHERE id = $2', [url, retro.id]);
  res.json({ ok: true, webhook_url: url });
}));

// Fire-and-forget webhook notification (Slack/Teams incoming webhook)
async function notifyWebhook(retroId, text) {
  const retro = await db.get('SELECT webhook_url FROM retros WHERE id = $1', [retroId]);
  if (!retro?.webhook_url) return;
  try {
    await fetch(retro.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error('Webhook notify error:', err.message);
  }
}

// --- Commitments CSV export (Jira/Azure DevOps import) ---
app.get('/api/retros/:id/commitments.csv', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!retro) return res.status(404).json({ error: 'Retro not found' });
  if (req.query.token) req.headers['x-participant-token'] = req.query.token;
  if (!(await requireRetroAccess(req, res, retro))) return;
  const rows = await db.all(
    'SELECT id, description, assignee, due_date, status, created_at, completed_at FROM commitments WHERE retro_id = $1 ORDER BY created_at', [req.params.id]);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Summary,Assignee,Due Date,Status,Created,Retro']
    .concat(rows.map(cm => [
      cm.description, cm.assignee, cm.due_date || '',
      cm.status === 'done' ? 'Done' : cm.status === 'in_progress' ? 'In Progress' : 'To Do',
      cm.created_at, retro.title,
    ].map(esc).join(',')))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="retro-${retro.id}-commitments.csv"`);
  res.send(csv);
}));

// --- Healthcheck (for Render and uptime monitors) ---
app.get('/api/health', ah(async (req, res) => {
  try {
    await db.get('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
}));

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// --- Overdue commitment email notifications (optional; needs SMTP env vars) ---
const nodemailer = require('nodemailer');

const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function getMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null; // not configured → disabled
  return {
    transporter: nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    }),
    from: SMTP_FROM || SMTP_USER,
  };
}

async function notifyOverdueCommitments() {
  const mailer = getMailer();
  if (!mailer) return;
  try {
    // Users who opted in and have open commitments past their due date
    const overdue = await db.all(`
      SELECT DISTINCT u.id AS user_id, u.username, u.email
      FROM users u
      JOIN commitments cm ON cm.assignee = u.username
      WHERE u.notify_overdue = TRUE AND u.email IS NOT NULL
        AND cm.status <> 'done' AND cm.due_date IS NOT NULL AND cm.due_date < to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);
    for (const user of overdue) {
      const items = await db.all(`
        SELECT cm.description, cm.due_date, r.title, r.id AS retro_id
        FROM commitments cm JOIN retros r ON r.id = cm.retro_id
        WHERE cm.assignee = $1 AND cm.status <> 'done'
          AND cm.due_date IS NOT NULL AND cm.due_date < to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        ORDER BY cm.due_date`, [user.username]);
      if (!items.length) continue;
      const list = items.map(i => `<li><strong>${escHtml(i.title)}</strong>: ${escHtml(i.description)} — due ${i.due_date}</li>`).join('');
      await mailer.transporter.sendMail({
        from: mailer.from,
        to: user.email,
        subject: `⏰ Retro Board: you have ${items.length} overdue commitment${items.length > 1 ? 's' : ''}`,
        html: `<p>Hi ${escHtml(user.username)},</p>
               <p>These commitments from your retros are past their due date:</p>
               <ul>${list}</ul>
               <p>Wrap them up and mark them as done 💪</p>`,
      });
    }
  } catch (err) {
    console.error('Overdue notification error:', err.message);
  }
}

(async () => {
  await db.initSchema();
  server.listen(PORT, () => console.log(`Retro Board running at http://localhost:${PORT}`));
  // Check every 6 hours; also run once shortly after boot
  setTimeout(notifyOverdueCommitments, 30 * 1000);
  setInterval(notifyOverdueCommitments, 6 * 60 * 60 * 1000);
  startKeepAlive();
})().catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

// --- Keep-alive: ping ourselves periodically so Render's free tier doesn't
// sleep after 15 min of inactivity (cold start ~30-50s). Enabled only when
// RENDER_EXTERNAL_URL is present (set automatically by Render) and not
// explicitly disabled with KEEP_ALIVE_DISABLED=true.
function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url || process.env.KEEP_ALIVE_DISABLED === 'true') return;
  const intervalMs = 10 * 60 * 1000; // every 10 min (well under the 15 min idle limit)
  setInterval(async () => {
    try {
      const res = await fetch(`${url}/api/health`);
      if (!res.ok) console.error(`Keep-alive ping got HTTP ${res.status}`);
    } catch (err) {
      console.error('Keep-alive ping failed:', err.message);
    }
  }, intervalMs);
  console.log(`Keep-alive enabled: pinging ${url}/api/health every 10 min`);
}

// --- Graceful shutdown (Render sends SIGTERM on deploys/restarts) ---
function shutdown(signal) {
  console.log(`${signal} received — closing server...`);
  server.close(() => {
    db.close().then(() => process.exit(0)).catch(() => process.exit(0));
  });
  // Force exit if connections don't drain in time
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
