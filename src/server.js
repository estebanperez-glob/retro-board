const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

wss.on('connection', (ws, req) => {
  const retroId = Number(new URL(req.url, 'http://x').searchParams.get('retroId'));
  if (!retroId) { ws.close(); return; }
  if (!rooms.has(retroId)) rooms.set(retroId, new Set());
  rooms.get(retroId).add(ws);
  ws.on('close', () => rooms.get(retroId)?.delete(ws));
});

// Async route wrapper: forwards errors to Express error handler
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// --- Retros ---
app.get('/api/retros', ah(async (req, res) => {
  const retros = await db.all(`
    SELECT r.*,
      (SELECT COUNT(*) FROM cards c WHERE c.retro_id = r.id) AS card_count,
      (SELECT COUNT(*) FROM commitments cm WHERE cm.retro_id = r.id) AS commitment_count
    FROM retros r ORDER BY r.created_at DESC`);
  res.json(retros);
}));

app.post('/api/retros', ah(async (req, res) => {
  const { title, sprint } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const info = await db.run(
    'INSERT INTO retros (title, sprint) VALUES ($1, $2) RETURNING id', [title, sprint || null]);
  res.status(201).json({ id: info.lastInsertRowid, title, sprint: sprint || null });
}));

app.get('/api/retros/:id', ah(async (req, res) => {
  const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
  if (!retro) return res.status(404).json({ error: 'Retro not found' });
  res.json(retro);
}));

app.post('/api/retros/:id/close', ah(async (req, res) => {
  await db.run("UPDATE retros SET status = 'closed' WHERE id = $1", [req.params.id]);
  broadcast(req.params.id, 'retro_closed', {});
  res.json({ ok: true });
}));

// --- Participants ---
app.post('/api/retros/:id/join', ah(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  await db.run(
    'INSERT INTO participants (retro_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.params.id, name.trim()]);
  broadcast(req.params.id, 'participants_changed', {});
  res.json({ ok: true });
}));

app.get('/api/retros/:id/participants', ah(async (req, res) => {
  const rows = await db.all(
    'SELECT name, joined_at FROM participants WHERE retro_id = $1 ORDER BY joined_at', [req.params.id]);
  res.json(rows);
}));

// --- Cards ---
app.get('/api/retros/:id/cards', ah(async (req, res) => {
  const cards = await db.all(`
    SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.card_id = c.id) AS votes
    FROM cards c WHERE c.retro_id = $1 ORDER BY c.created_at`, [req.params.id]);
  res.json(cards);
}));

app.post('/api/retros/:id/cards', ah(async (req, res) => {
  const { column_type, content, author } = req.body;
  if (!['went_well', 'didnt_go_well', 'action'].includes(column_type))
    return res.status(400).json({ error: 'Invalid column' });
  if (!content || !author) return res.status(400).json({ error: 'Content and author are required' });
  const info = await db.run(
    'INSERT INTO cards (retro_id, column_type, content, author) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.params.id, column_type, content.trim(), author]);
  const card = await db.get('SELECT c.*, 0 AS votes FROM cards c WHERE c.id = $1', [info.lastInsertRowid]);
  broadcast(req.params.id, 'card_added', card);
  res.status(201).json(card);
}));

app.put('/api/cards/:id', ah(async (req, res) => {
  const { content } = req.body;
  const card = await db.get('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Card not found' });
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
  await db.run('DELETE FROM votes WHERE card_id = $1', [req.params.id]);
  await db.run('DELETE FROM cards WHERE id = $1', [req.params.id]);
  broadcast(card.retro_id, 'card_deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

// --- Votes ---
app.post('/api/cards/:id/vote', ah(async (req, res) => {
  const { voter } = req.body;
  const card = await db.get('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const existing = await db.get('SELECT id FROM votes WHERE card_id = $1 AND voter = $2', [req.params.id, voter]);
  if (existing) {
    await db.run('DELETE FROM votes WHERE id = $1', [existing.id]);
  } else {
    await db.run('INSERT INTO votes (card_id, voter, retro_id) VALUES ($1, $2, $3)',
      [req.params.id, voter, card.retro_id]);
  }
  const votes = Number((await db.get('SELECT COUNT(*) AS n FROM votes WHERE card_id = $1', [req.params.id])).n);
  broadcast(card.retro_id, 'votes_changed', { cardId: Number(req.params.id), votes });
  res.json({ votes });
}));

// --- Commitments ---
app.get('/api/retros/:id/commitments', ah(async (req, res) => {
  const rows = await db.all(
    'SELECT * FROM commitments WHERE retro_id = $1 ORDER BY created_at', [req.params.id]);
  res.json(rows);
}));

app.post('/api/retros/:id/commitments', ah(async (req, res) => {
  const { description, assignee, due_date } = req.body;
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
  await db.run('DELETE FROM points WHERE commitment_id = $1', [req.params.id]);
  await db.run('DELETE FROM commitments WHERE id = $1', [req.params.id]);
  broadcast(commitment.retro_id, 'commitment_deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
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
