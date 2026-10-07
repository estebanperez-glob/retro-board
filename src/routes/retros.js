// Retro routes: CRUD, join/participants, close/reopen, carry-over.
const crypto = require('crypto');
const {
  db, ah, FREE_MAX_RETROS, FREE_MAX_PARTICIPANTS,
  getUser, getParticipant, requireRetroAccess, requireRetroAdmin,
} = require('../helpers');
const { broadcast } = require('../ws');
const { resolveColumns } = require('./cards');

function register(app) {
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
    const validTemplates = ['classic', 'ssc', 'msg', '4ls', 'sailboat', 'starfish', 'daki', 'wellbeing'];
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

  // --- Saved custom templates ("Save as template") ---
  app.get('/api/templates', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to see your saved templates' });
    const rows = await db.all(
      'SELECT id, name, columns_json, created_at FROM custom_templates WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
    res.json(rows);
  }));

  app.post('/api/retros/:id/save-template', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in required' });
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Template name is required' });
    if (!(await requireRetroAdmin(req, res))) return;
    const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
    const resolved = resolveColumns(retro);
    const labels = resolved.labels || Object.fromEntries(resolved.columns.map(k => [k, k]));
    const columnsJson = JSON.stringify(resolved.columns.map(k => ({ key: k, label: labels[k] || k })));
    const trimmedName = String(name).trim().slice(0, 60);
    const existing = await db.get('SELECT id FROM custom_templates WHERE user_id = $1 AND name = $2', [user.id, trimmedName]);
    if (existing) {
      await db.run('UPDATE custom_templates SET columns_json = $1 WHERE id = $2', [columnsJson, existing.id]);
      return res.json({ ok: true, id: existing.id, updated: true });
    }
    const info = await db.run(
      'INSERT INTO custom_templates (user_id, name, columns_json) VALUES ($1, $2, $3) RETURNING id',
      [user.id, trimmedName, columnsJson]);
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  }));

  app.delete('/api/templates/:id', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in required' });
    const tpl = await db.get('SELECT id FROM custom_templates WHERE id = $1 AND user_id = $2', [req.params.id, user.id]);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    await db.run('DELETE FROM custom_templates WHERE id = $1', [tpl.id]);
    res.json({ ok: true });
  }));

  // --- Duplicate a retro (admin): same config, fresh board ---
  app.post('/api/retros/:id/duplicate', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in required' });
    if (!(await requireRetroAdmin(req, res))) return;
    const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
    const plan = (await db.get('SELECT plan FROM users WHERE id = $1', [user.id]))?.plan || 'free';
    if (plan === 'free') {
      const count = Number((await db.get('SELECT COUNT(*) AS n FROM retros WHERE created_by = $1', [user.username])).n);
      if (count >= FREE_MAX_RETROS) {
        return res.status(402).json({ error: `Free plan limit reached (${FREE_MAX_RETROS} retros). Upgrade to Pro for unlimited retros.` });
      }
    }
    const joinCode = crypto.randomBytes(5).toString('hex');
    const info = await db.run(
      'INSERT INTO retros (title, sprint, created_by, template, is_anonymous, join_code, custom_columns, webhook_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
      [`${retro.title} (copy)`, retro.sprint, retro.created_by, retro.template, retro.is_anonymous, joinCode, retro.custom_columns, retro.webhook_url]);
    const newId = Number(info.lastInsertRowid);
    const adminToken = crypto.randomBytes(24).toString('hex');
    await db.run(
      'INSERT INTO participants (retro_id, name, access_token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [newId, user.username, adminToken]);
    res.status(201).json({ id: newId, title: `${retro.title} (copy)`, join_code: joinCode, participant_token: adminToken });
  }));

  app.get('/api/retros/:id', ah(async (req, res) => {
    const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
    const access = await requireRetroAccess(req, res, retro);
    if (!access) return;
    res.json({ ...retro, join_code: access.role === 'admin' ? retro.join_code : undefined, is_admin: access.role === 'admin', webhook_url: access.role === 'admin' ? retro.webhook_url : undefined });
  }));

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
      'SELECT name, mood, joined_at FROM participants WHERE retro_id = $1 ORDER BY joined_at', [req.params.id]);
    res.json(rows);
  }));

  // --- Team mood ---
  const MOODS = ['thrilled', 'good', 'soso', 'tense', 'burned'];
  app.put('/api/retros/:id/mood', ah(async (req, res) => {
    const { mood } = req.body;
    if (!MOODS.includes(mood)) return res.status(400).json({ error: 'Invalid mood' });
    const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
    if (!retro) return res.status(404).json({ error: 'Retro not found' });
    const user = await getUser(req);
    let participant = null;
    if (user && user.username === retro.created_by) {
      // Admin sets mood on their own participant row (or a synthetic one)
      const existing = await db.get('SELECT id FROM participants WHERE retro_id = $1 AND name = $2', [retro.id, user.username]);
      if (existing) {
        await db.run('UPDATE participants SET mood = $1 WHERE id = $2', [mood, existing.id]);
      } else {
        await db.run('INSERT INTO participants (retro_id, name, mood) VALUES ($1, $2, $3)', [retro.id, user.username, mood]);
      }
    } else {
      participant = await getParticipant(req, retro.id);
      if (!participant) return res.status(401).json({ error: 'Join this retro first' });
      await db.run('UPDATE participants SET mood = $1 WHERE id = $2', [mood, participant.id]);
    }
    broadcast(retro.id, 'mood_changed', {});
    res.json({ ok: true, mood });
  }));
}

module.exports = { register };
