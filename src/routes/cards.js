// Card & vote routes, plus column resolution for retro templates.
const {
  db, ah, getUser, requireRetroAccess,
} = require('../helpers');
const { broadcast } = require('../ws');

// Column layouts per retro template
const TEMPLATE_COLUMNS = {
  classic: ['went_well', 'didnt_go_well', 'action'],
  ssc: ['start_doing', 'stop_doing', 'continue_doing'],
  msg: ['mad', 'sad', 'glad'],
  '4ls': ['liked', 'learned', 'lacked', 'longed_for'],
  sailboat: ['wind', 'anchors', 'risks', 'island'],
  starfish: ['more', 'less', 'start', 'stop', 'keep'],
  daki: ['drop', 'add', 'keep', 'improve'],
  wellbeing: ['energized', 'drained', 'support_needed', 'suggestions'],
};

// Human-readable labels for the built-in template columns (acta/summary exports)
const TEMPLATE_LABELS = {
  classic: { went_well: 'What Went Well', didnt_go_well: "What Didn't Go Well", action: 'Action Items' },
  ssc: { start_doing: 'Start Doing', stop_doing: 'Stop Doing', continue_doing: 'Continue Doing' },
  msg: { mad: 'Mad', sad: 'Sad', glad: 'Glad' },
  '4ls': { liked: 'Liked', learned: 'Learned', lacked: 'Lacked', longed_for: 'Longed For' },
  sailboat: { wind: 'Wind (Propellers)', anchors: 'Anchors (Dragging Us)', risks: 'Risks Ahead', island: 'Island (Goals)' },
  starfish: { more: 'Keep Doing More', less: 'Do Less', start: 'Start Doing', stop: 'Stop Doing', keep: 'Keep Doing' },
  daki: { drop: 'Drop', add: 'Add', keep: 'Keep', improve: 'Improve' },
  wellbeing: { energized: 'Energized By', drained: 'Drained By', support_needed: 'Support Needed', suggestions: 'Ideas to Improve' },
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

function register(app) {
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
}

module.exports = { register, TEMPLATE_COLUMNS, TEMPLATE_LABELS, columnsOf, resolveColumns };
