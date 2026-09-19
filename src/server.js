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

// Resolves the logged-in user from the Authorization header (or null)
async function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const row = await db.get(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
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

// --- Users ---
app.post('/api/register', ah(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (username.trim().length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = await db.get('SELECT id FROM users WHERE username = $1', [username.trim().toLowerCase()]);
  if (existing) return res.status(409).json({ error: 'Username already taken' });
  const info = await db.run(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [username.trim().toLowerCase(), hashPassword(password)]);
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, Number(info.lastInsertRowid)]);
  res.status(201).json({ token, username: username.trim().toLowerCase() });
}));

app.post('/api/login', ah(async (req, res) => {
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
  const { title, sprint, carry_over_from, template, is_anonymous } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to create a retro' });
  const validTemplates = ['classic', 'ssc', 'msg', '4ls'];
  const tpl = validTemplates.includes(template) ? template : 'classic';
  const joinCode = crypto.randomBytes(5).toString('hex'); // 10-char invitation code
  const info = await db.run(
    'INSERT INTO retros (title, sprint, created_by, template, is_anonymous, join_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [title, sprint || null, user.username, tpl, !!is_anonymous, joinCode]);
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
  res.json({ ...retro, join_code: undefined, is_admin: access.role === 'admin' });
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
  const { column_type, content, author } = req.body;
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  const access = await requireRetroAccess(req, res, retro);
  if (!access) return;
  const validColumns = TEMPLATE_COLUMNS[retro.template] || TEMPLATE_COLUMNS.classic;
  if (!validColumns.includes(column_type))
    return res.status(400).json({ error: 'Invalid column' });
  if (!content || !author) return res.status(400).json({ error: 'Content and author are required' });
  const info = await db.run(
    'INSERT INTO cards (retro_id, column_type, content, author) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.params.id, column_type, content.trim(), author]);
  let card = await db.get('SELECT c.*, 0 AS votes FROM cards c WHERE c.id = $1', [info.lastInsertRowid]);
  if (retro.is_anonymous) card = { ...card, author: 'Anonymous' };
  broadcast(req.params.id, 'card_added', card);
  res.status(201).json(card);
}));

app.put('/api/cards/:id', ah(async (req, res) => {
  const { content } = req.body;
  const card = await db.get('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [card.retro_id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  await db.run('UPDATE cards SET content = $1 WHERE id = $2', [content.trim(), req.params.id]);
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
  if (!(await requireRetroAccess(req, res, retro))) return;
  await db.run('DELETE FROM votes WHERE card_id = $1', [req.params.id]);
  await db.run('DELETE FROM cards WHERE id = $1', [req.params.id]);
  broadcast(card.retro_id, 'card_deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

// --- Votes ---
const MAX_VOTES_PER_VOTER = 3;

app.post('/api/cards/:id/vote', ah(async (req, res) => {
  const { voter } = req.body;
  const card = await db.get('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [card.retro_id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
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
  res.status(201).json(commitment);
}));

app.put('/api/commitments/:id', ah(async (req, res) => {
  const { description, assignee, due_date, status } = req.body;
  const commitment = await db.get('SELECT * FROM commitments WHERE id = $1', [req.params.id]);
  if (!commitment) return res.status(404).json({ error: 'Commitment not found' });
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [commitment.retro_id]);
  if (!(await requireRetroAccess(req, res, retro))) return;
  await db.run(`UPDATE commitments SET description = $1, assignee = $2, due_date = $3, status = $4,
    completed_at = CASE WHEN status = 'done' AND completed_at IS NULL THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') ELSE completed_at END
    WHERE id = $5`,
    [description ?? commitment.description, assignee ?? commitment.assignee,
      due_date ?? commitment.due_date, status ?? commitment.status, req.params.id]);
  const updated = await db.get('SELECT * FROM commitments WHERE id = $1', [req.params.id]);

  // Gamification: award points when a commitment transitions to done
  if (status === 'done' && commitment.status !== 'done') {
    await db.run(
      'INSERT INTO points (participant_name, retro_id, commitment_id, amount, reason) VALUES ($1, $2, $3, 10, $4)',
      [updated.assignee, updated.retro_id, updated.id, 'Commitment completed']);
    broadcast(updated.retro_id, 'points_awarded', { participant: updated.assignee, amount: 10 });
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
  if (!(await requireRetroAccess(req, res, retro))) return;
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
app.get('/api/leaderboard', ah(async (req, res) => {
  const rows = await db.all(`
    SELECT participant_name, SUM(amount) AS total_points,
      COUNT(CASE WHEN reason = 'Commitment completed' THEN 1 END) AS completed_commitments
    FROM points GROUP BY participant_name ORDER BY total_points DESC`);
  res.json(rows);
}));

app.get('/api/retros/:id/leaderboard', ah(async (req, res) => {
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
  for (const col of ['went_well', 'didnt_go_well']) {
    const label = col === 'went_well' ? 'What Went Well' : "What Didn't Go Well";
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

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

(async () => {
  await db.initSchema();
  server.listen(PORT, () => console.log(`Retro Board running at http://localhost:${PORT}`));
})().catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
