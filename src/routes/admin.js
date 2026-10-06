// Master-only routes: usage stats and user management.
const {
  db, ah, requireMaster, hashPassword,
} = require('../helpers');

function register(app) {
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
}

module.exports = { register };
