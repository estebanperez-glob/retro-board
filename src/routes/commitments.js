// Commitment routes: CRUD, dashboards, my-commitments, overdue badge.
const {
  db, ah, getUser, requireRetroAccess,
} = require('../helpers');
const { broadcast } = require('../ws');
const { notifyWebhook } = require('./insights');

function register(app) {
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

  // --- Overdue badge: count of overdue commitments for the logged-in user ---
  app.get('/api/my-overdue-count', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to see your overdue commitments' });
    const row = await db.get(`
      SELECT COUNT(*) AS count
      FROM commitments cm JOIN retros r ON r.id = cm.retro_id
      WHERE cm.assignee = $1 AND r.created_by = $2
        AND cm.status != 'done'
        AND cm.due_date IS NOT NULL
        AND cm.due_date < to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      [user.username, user.username]);
    res.json({ count: Number(row.count) });
  }));
}

module.exports = { register };
