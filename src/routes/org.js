// Multi-team / SAFe routes: programs, teams, program increments (PIs),
// team & program dashboards with cross-team rollups.
const {
  db, ah, getUser, requireTeamAccess, requireProgramAccess, getTeamRole,
} = require('../helpers');

// Health score formula shared with insights.js: participation, engagement,
// follow-through — 0-100 composite per retro, averaged per team/program.
function healthFromRows(rows) {
  if (!rows.length) return null;
  const avg = key => rows.reduce((s, r) => s + Number(r[key] || 0), 0) / rows.length;
  const participation = Math.round(avg('participation'));
  const engagement = Math.round(avg('engagement'));
  const followThrough = Math.round(avg('follow_through'));
  return Math.round(participation * 0.4 + engagement * 0.3 + followThrough * 0.3);
}

function register(app) {
  // ---------- Programs ----------

  app.post('/api/programs', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to create a program' });
    const { name, description } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Program name is required' });
    const programName = String(name).trim().slice(0, 60);
    const info = await db.run(
      'INSERT INTO programs (name, description, created_by) VALUES ($1, $2, $3) RETURNING id',
      [programName, description ? String(description).trim().slice(0, 300) : null, user.username]);
    const programId = Number(info.lastInsertRowid);
    // Creator becomes the RTE (program admin)
    await db.run('INSERT INTO program_members (program_id, user_id, role) VALUES ($1, $2, $3)', [programId, user.id, 'rte']);
    const program = await db.get('SELECT * FROM programs WHERE id = $1', [programId]);
    res.status(201).json(program);
  }));

  // Programs the user belongs to
  app.get('/api/programs', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to see your programs' });
    const rows = await db.all(`
      SELECT p.*, pm.role,
        (SELECT COUNT(*) FROM teams t WHERE t.program_id = p.id) AS team_count
      FROM programs p
      JOIN program_members pm ON pm.program_id = p.id AND pm.user_id = $1
      ORDER BY p.created_at DESC`, [user.id]);
    res.json(rows);
  }));

  app.get('/api/programs/:id', ah(async (req, res) => {
    const access = await requireProgramAccess(req, res, req.params.id);
    if (!access) return;
    const teams = await db.all('SELECT id, name, created_at FROM teams WHERE program_id = $1 ORDER BY name', [access.program.id]);
    const pis = await db.all('SELECT * FROM program_increments WHERE program_id = $1 ORDER BY start_date NULLS LAST, id', [access.program.id]);
    res.json({ ...access.program, teams, program_increments: pis });
  }));

  // Add a member to a program (RTE only)
  app.post('/api/programs/:id/members', ah(async (req, res) => {
    const access = await requireProgramAccess(req, res, req.params.id);
    if (!access) return;
    if (access.role !== 'rte') return res.status(403).json({ error: 'Only the RTE can manage program members' });
    const { username, role: requestedRole } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });
    const target = await db.get('SELECT id FROM users WHERE username = $1', [String(username).trim().toLowerCase()]);
    if (!target) return res.status(404).json({ error: 'User not found (they must register first)' });
    const memberRole = requestedRole === 'rte' ? 'rte' : 'member';
    await db.run(
      'INSERT INTO program_members (program_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (program_id, user_id) DO UPDATE SET role = $3',
      [Number(req.params.id), target.id, memberRole]);
    res.json({ ok: true });
  }));

  // ---------- Teams ----------

  app.post('/api/teams', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to create a team' });
    const { name, program_id } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Team name is required' });
    const teamName = String(name).trim().slice(0, 60);
    let programId = null;
    if (program_id) {
      const access = await requireProgramAccess(req, res, Number(program_id));
      if (!access) return;
      if (access.role !== 'rte') return res.status(403).json({ error: 'Only the RTE can add teams to a program' });
      programId = access.program.id;
    }
    const info = await db.run(
      'INSERT INTO teams (program_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [programId, teamName, user.username]);
    const teamId = Number(info.lastInsertRowid);
    // Creator becomes the team lead
    await db.run('INSERT INTO team_members (team_id, username, role) VALUES ($1, $2, $3)', [teamId, user.username, 'lead']);
    const team = await db.get('SELECT * FROM teams WHERE id = $1', [teamId]);
    res.status(201).json(team);
  }));

  // Teams visible to the user: teams they belong to + teams in their programs
  app.get('/api/teams', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to see your teams' });
    const rows = await db.all(`
      SELECT DISTINCT t.*,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
        (SELECT COUNT(*) FROM retros r WHERE r.team_id = t.id) AS retro_count
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.username = $1
      LEFT JOIN teams pt ON pt.program_id IN (SELECT program_id FROM program_members WHERE user_id = $2)
      WHERE tm.username IS NOT NULL OR pt.id = t.id
      ORDER BY t.created_at DESC`, [user.username, user.id]);
    res.json(rows);
  }));

  app.get('/api/teams/:id', ah(async (req, res) => {
    const access = await requireTeamAccess(req, res, req.params.id);
    if (!access) return;
    const members = await db.all('SELECT username, role FROM team_members WHERE team_id = $1 ORDER BY role DESC, username', [access.team.id]);
    res.json({ ...access.team, members });
  }));

  // Add a team member (team lead or RTE)
  app.post('/api/teams/:id/members', ah(async (req, res) => {
    const access = await requireTeamAccess(req, res, req.params.id);
    if (!access) return;
    if (!['lead', 'rte'].includes(access.role)) return res.status(403).json({ error: 'Only the team lead or the RTE can add members' });
    const { username, role } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });
    const uname = String(username).trim().toLowerCase();
    const target = await db.get('SELECT id FROM users WHERE username = $1', [uname]);
    if (!target) return res.status(404).json({ error: 'User not found (they must register first)' });
    const memberRole = role === 'lead' ? 'lead' : 'member';
    await db.run(
      'INSERT INTO team_members (team_id, username, role) VALUES ($1, $2, $3) ON CONFLICT (team_id, username) DO UPDATE SET role = $3',
      [access.team.id, uname, memberRole]);
    res.json({ ok: true });
  }));

  // Remove a team member (team lead or RTE; cannot remove the last lead)
  app.delete('/api/teams/:id/members/:username', ah(async (req, res) => {
    const access = await requireTeamAccess(req, res, req.params.id);
    if (!access) return;
    if (!['lead', 'rte'].includes(access.role)) return res.status(403).json({ error: 'Only the team lead or the RTE can remove members' });
    const uname = String(req.params.username).toLowerCase();
    const leads = await db.get("SELECT COUNT(*) AS n FROM team_members WHERE team_id = $1 AND role = 'lead'", [access.team.id]);
    const target = await db.get('SELECT role FROM team_members WHERE team_id = $1 AND username = $2', [access.team.id, uname]);
    if (target?.role === 'lead' && Number(leads.n) <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last team lead' });
    }
    await db.run('DELETE FROM team_members WHERE team_id = $1 AND username = $2', [access.team.id, uname]);
    res.json({ ok: true });
  }));

  // ---------- Team dashboard ----------

  // Team retros + aggregated health + commitment stats
  app.get('/api/teams/:id/dashboard', ah(async (req, res) => {
    const access = await requireTeamAccess(req, res, req.params.id);
    if (!access) return;
    const teamId = access.team.id;
    const retros = await db.all('SELECT id, title, sprint, status, created_at, pi_id FROM retros WHERE team_id = $1 ORDER BY created_at DESC', [teamId]);
    const healthRows = await db.all(`
      SELECT r.id,
        (SELECT COUNT(DISTINCT p.id) FROM participants p WHERE p.retro_id = r.id) AS participants,
        (SELECT COUNT(*) FROM cards c WHERE c.retro_id = r.id) AS cards,
        (SELECT COUNT(*) FROM votes v WHERE v.retro_id = r.id) AS votes,
        (SELECT COUNT(*) FROM commitments cm WHERE cm.retro_id = r.id) AS commitments_total,
        (SELECT COUNT(*) FROM commitments cm WHERE cm.retro_id = r.id AND cm.status = 'done') AS commitments_done
      FROM retros r WHERE r.team_id = $1`, [teamId]);
    const health = healthFromRows(healthRows);
    const commitments = await db.get(`
      SELECT COUNT(*) FILTER (WHERE cm.status != 'done') AS pending,
        COUNT(*) FILTER (WHERE cm.status = 'done') AS done
      FROM commitments cm JOIN retros r ON r.id = cm.retro_id
      WHERE r.team_id = $1`, [teamId]);
    const leaderboard = await db.all(`
      SELECT p.participant_name, SUM(p.amount) AS total_points,
        COUNT(CASE WHEN p.reason = 'Commitment completed' THEN 1 END) AS completed_commitments
      FROM points p JOIN retros r ON r.id = p.retro_id
      WHERE r.team_id = $1
      GROUP BY p.participant_name ORDER BY total_points DESC LIMIT 10`, [teamId]);
    res.json({ team: access.team, retros, health, commitments, leaderboard });
  }));

  // ---------- Program dashboard (cross-team rollups) ----------

  app.get('/api/programs/:id/dashboard', ah(async (req, res) => {
    const access = await requireProgramAccess(req, res, req.params.id);
    if (!access) return;
    const programId = access.program.id;
    const teams = await db.all('SELECT id, name FROM teams WHERE program_id = $1 ORDER BY name', [programId]);
    const teamStats = [];
    for (const team of teams) {
      const stats = await db.get(`
        SELECT
          (SELECT COUNT(*) FROM retros r WHERE r.team_id = $1) AS retros,
          (SELECT COUNT(DISTINCT p.id) FROM participants p JOIN retros r2 ON r2.id = p.retro_id WHERE r2.team_id = $1) AS participants,
          (SELECT COUNT(*) FROM commitments cm JOIN retros r3 ON r3.id = cm.retro_id WHERE r3.team_id = $1) AS commitments_total,
          (SELECT COUNT(*) FROM commitments cm JOIN retros r3 ON r3.id = cm.retro_id WHERE r3.team_id = $1 AND cm.status = 'done') AS commitments_done,
          (SELECT COALESCE(SUM(p.amount), 0) FROM points p JOIN retros r4 ON r4.id = p.retro_id WHERE r4.team_id = $1) AS total_points`, [team.id]);
      teamStats.push({ team_id: team.id, team_name: team.name, ...stats });
    }
    // Inter-team leaderboard: total points per team
    const leaderboard = await db.all(`
      SELECT t.id AS team_id, t.name AS team_name, COALESCE(SUM(p.amount), 0) AS total_points
      FROM teams t
      LEFT JOIN retros r ON r.team_id = t.id
      LEFT JOIN points p ON p.retro_id = r.id
      WHERE t.program_id = $1
      GROUP BY t.id, t.name ORDER BY total_points DESC`, [programId]);
    // Cross-team dependencies (SAFe program board)
    const dependencies = await db.all(`
      SELECT cm.id, cm.description, cm.status, cm.assignee,
        cm.depends_on_team_id, dt.name AS depends_on_team_name,
        r.title AS retro_title, r.team_id AS owner_team_id, ot.name AS owner_team_name
      FROM commitments cm
      JOIN retros r ON r.id = cm.retro_id
      JOIN teams ot ON ot.id = r.team_id
      LEFT JOIN teams dt ON dt.id = cm.depends_on_team_id
      WHERE ot.program_id = $1 AND cm.depends_on_team_id IS NOT NULL
      ORDER BY cm.created_at DESC`, [programId]);
    res.json({ program: access.program, teamStats, leaderboard, dependencies });
  }));

  // ---------- Program Increments ----------

  app.post('/api/programs/:id/pis', ah(async (req, res) => {
    const access = await requireProgramAccess(req, res, req.params.id);
    if (!access) return;
    if (access.role !== 'rte') return res.status(403).json({ error: 'Only the RTE can create Program Increments' });
    const { name, start_date, end_date } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'PI name is required' });
    for (const d of [start_date, end_date]) {
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
    }
    const info = await db.run(
      'INSERT INTO program_increments (program_id, name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id',
      [access.program.id, String(name).trim().slice(0, 60), start_date || null, end_date || null]);
    const pi = await db.get('SELECT * FROM program_increments WHERE id = $1', [Number(info.lastInsertRowid)]);
    res.status(201).json(pi);
  }));

  app.get('/api/programs/:id/pis', ah(async (req, res) => {
    const access = await requireProgramAccess(req, res, req.params.id);
    if (!access) return;
    const pis = await db.all('SELECT * FROM program_increments WHERE program_id = $1 ORDER BY start_date NULLS LAST', [access.program.id]);
    res.json(pis);
  }));

  // PI dashboard: rollup of all retros in the increment, per team
  app.get('/api/pis/:id/dashboard', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in required' });
    const pi = await db.get(`
      SELECT pi.* FROM program_increments pi WHERE pi.id = $1`, [req.params.id]);
    if (!pi) return res.status(404).json({ error: 'PI not found' });
    const access = await requireProgramAccess(req, res, pi.program_id);
    if (!access) return;
    const retros = await db.all(`
      SELECT r.id, r.title, r.status, r.created_at, r.team_id, t.name AS team_name
      FROM retros r LEFT JOIN teams t ON t.id = r.team_id
      WHERE r.pi_id = $1 ORDER BY r.created_at DESC`, [pi.id]);
    const byTeam = await db.all(`
      SELECT t.name AS team_name,
        COUNT(DISTINCT r.id) AS retros,
        (SELECT COUNT(*) FROM commitments cm JOIN retros r2 ON r2.id = cm.retro_id WHERE r2.pi_id = $1) AS commitments_total,
        (SELECT COUNT(*) FROM commitments cm JOIN retros r3 ON r3.id = cm.retro_id WHERE r3.pi_id = $1 AND cm.status = 'done') AS commitments_done
      FROM teams t
      LEFT JOIN retros r ON r.team_id = t.id AND r.pi_id = $1
      WHERE t.program_id = $2
      GROUP BY t.name ORDER BY t.name`, [pi.id, pi.program_id]);
    res.json({ pi, retros, byTeam });
  }));

  // ---------- Retro <-> team/PI assignment ----------

  // Assign a retro to a team (retro admin or team lead)
  app.put('/api/retros/:id/team', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in required' });
    const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
    if (!retro) return res.status(404).json({ error: 'Retro not found' });
    const isCreator = retro.created_by === user.username;
    let allowed = isCreator;
    if (!allowed && retro.team_id) {
      const role = await getTeamRole(retro.team_id, user);
      allowed = role && ['lead', 'rte'].includes(role.role);
    }
    if (!allowed) return res.status(403).json({ error: 'Only the retro admin or a team lead can assign this retro' });
    const { team_id } = req.body;
    if (team_id === null || team_id === undefined || team_id === '') {
      await db.run('UPDATE retros SET team_id = NULL WHERE id = $1', [retro.id]);
      return res.json({ ok: true, team_id: null });
    }
    const teamAccess = await requireTeamAccess(req, res, Number(team_id));
    if (!teamAccess) return;
    await db.run('UPDATE retros SET team_id = $1 WHERE id = $2', [teamAccess.team.id, retro.id]);
    res.json({ ok: true, team_id: teamAccess.team.id });
  }));

  // Assign a retro to a PI (retro admin or RTE)
  app.put('/api/retros/:id/pi', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in required' });
    const retro = await db.get('SELECT * FROM retros WHERE id = $1', [req.params.id]);
    if (!retro) return res.status(404).json({ error: 'Retro not found' });
    const isCreator = retro.created_by === user.username;
    if (!isCreator) return res.status(403).json({ error: 'Only the retro admin can assign a PI' });
    const { pi_id } = req.body;
    if (pi_id === null || pi_id === undefined || pi_id === '') {
      await db.run('UPDATE retros SET pi_id = NULL WHERE id = $1', [retro.id]);
      return res.json({ ok: true, pi_id: null });
    }
    const pi = await db.get('SELECT * FROM program_increments WHERE id = $1', [Number(pi_id)]);
    if (!pi) return res.status(404).json({ error: 'PI not found' });
    const access = await requireProgramAccess(req, res, pi.program_id);
    if (!access) return;
    await db.run('UPDATE retros SET pi_id = $1 WHERE id = $2', [pi.id, retro.id]);
    res.json({ ok: true, pi_id: pi.id });
  }));

  // Set a cross-team dependency on a commitment (SAFe program board)
  app.put('/api/commitments/:id/dependency', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in required' });
    const commitment = await db.get('SELECT * FROM commitments WHERE id = $1', [req.params.id]);
    if (!commitment) return res.status(404).json({ error: 'Commitment not found' });
    const retro = await db.get('SELECT * FROM retros WHERE id = $1', [commitment.retro_id]);
    const isCreator = retro && retro.created_by === user.username;
    if (!isCreator) return res.status(403).json({ error: 'Only the retro admin can set dependencies' });
    const { depends_on_team_id } = req.body;
    if (depends_on_team_id === null || depends_on_team_id === undefined || depends_on_team_id === '') {
      await db.run('UPDATE commitments SET depends_on_team_id = NULL WHERE id = $1', [commitment.id]);
      return res.json({ ok: true, depends_on_team_id: null });
    }
    const team = await db.get('SELECT id FROM teams WHERE id = $1', [Number(depends_on_team_id)]);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    await db.run('UPDATE commitments SET depends_on_team_id = $1 WHERE id = $2', [team.id, commitment.id]);
    res.json({ ok: true, depends_on_team_id: team.id });
  }));
}

module.exports = { register };
