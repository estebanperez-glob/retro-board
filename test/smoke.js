/**
 * E2E smoke test for Retro Board.
 *
 * Usage:
 *   npm test                          # against http://localhost:3000
 *   BASE_URL=https://... npm test     # against any deployed instance
 *
 * Creates a temporary user (smoke_<ts>) and a sailboat retro, exercises the
 * main API flows, then deletes the retro. The smoke user is left behind on
 * purpose when running against production DBs is NOT desired — set
 * CLEANUP_USER=true to also delete the user at the end (local default).
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CLEANUP_USER = process.env.CLEANUP_USER !== 'false';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra || ''); }
}
async function req(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  const ts = Date.now();
  const username = 'smoke_' + ts;
  const password = 'SmokeTest123!';

  // 1. Register + login
  let r = await req('POST', '/api/register', { username, password, security_question: 'x', security_answer: 'x' });
  check('POST /api/register', r.status === 200 || r.status === 201, JSON.stringify(r.data).slice(0, 120));
  r = await req('POST', '/api/login', { username, password });
  const token = r.data?.token;
  check('POST /api/login', r.status === 200 && !!token, JSON.stringify(r.data).slice(0, 120));
  const auth = { Authorization: 'Bearer ' + token };

  // Grant org-manager flag to the smoke user (direct DB, like cleanup below)
  if (CLEANUP_USER) {
    try {
      require('dotenv').config();
      const { Pool } = require('pg');
      const cs = process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&' : '?') + 'uselibpqcompat=true';
      const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });
      await pool.query('UPDATE users SET can_manage_org = TRUE WHERE username = $1', [username]);
      await pool.end();
    } catch (e) {
      console.log('org grant skipped:', e.message);
    }
  }

  // 2. Create retro (sailboat)
  r = await req('POST', '/api/retros', { title: 'Smoke Retro ' + ts, template: 'sailboat' }, auth);
  const retroId = r.data?.id;
  check('POST /api/retros (sailboat)', (r.status === 200 || r.status === 201) && !!retroId, JSON.stringify(r.data).slice(0, 120));

  // 3. Get retro + join code
  r = await req('GET', '/api/retros/' + retroId, null, auth);
  const joinCode = r.data?.join_code;
  check('GET /api/retros/:id', r.status === 200 && !!joinCode, 'joinCode=' + joinCode);

  // 4. Join as participant
  r = await req('POST', '/api/retros/' + retroId + '/join', { name: 'Guest Participant', join_code: joinCode });
  const pToken = r.data?.access_token;
  check('POST join', (r.status === 200 || r.status === 201) && !!pToken, JSON.stringify(r.data).slice(0, 120));

  // 5. Add cards
  r = await req('POST', '/api/retros/' + retroId + '/cards', { column_type: 'wind', content: 'Great sprint, team synced well' }, auth);
  const cardId = r.data?.id;
  check('POST card (wind)', r.status === 201 && !!cardId, JSON.stringify(r.data).slice(0, 120));
  r = await req('POST', '/api/retros/' + retroId + '/cards', { column_type: 'anchors', content: 'Too many meetings drained focus' }, auth);
  check('POST card (anchors)', r.status === 201, JSON.stringify(r.data).slice(0, 120));
  r = await req('POST', '/api/retros/' + retroId + '/cards', { column_type: 'wind', content: 'Nice demo day' }, { 'X-Participant-Token': pToken });
  check('POST card as participant', r.status === 201, JSON.stringify(r.data).slice(0, 120));

  // 6. Votes
  r = await req('POST', '/api/cards/' + cardId + '/vote', {}, auth);
  check('POST vote (admin)', r.status === 200 || r.status === 201, JSON.stringify(r.data).slice(0, 120));
  r = await req('POST', '/api/cards/' + cardId + '/vote', {}, { 'X-Participant-Token': pToken });
  check('POST vote (participant)', r.status === 200 || r.status === 201, JSON.stringify(r.data).slice(0, 120));

  // 7. Commitment + complete
  r = await req('POST', '/api/retros/' + retroId + '/commitments', { description: 'Reduce weekly meetings', assignee: 'Smoke Tester', due_date: '2026-10-30' }, auth);
  const commitId = r.data?.id;
  check('POST commitment', r.status === 201 && !!commitId, JSON.stringify(r.data).slice(0, 120));
  r = await req('PUT', '/api/commitments/' + commitId, { status: 'done' }, auth);
  check('PUT commitment done', r.status === 200, JSON.stringify(r.data).slice(0, 120));

  // 8. Insights
  r = await req('GET', '/api/health-score?retro_id=' + retroId, null, auth);
  check('GET health-score', r.status === 200, JSON.stringify(r.data).slice(0, 120));
  r = await req('GET', '/api/evolution', null, auth);
  check('GET /api/evolution', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/retros/' + retroId + '/summary', null, auth);
  check('GET summary', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req('POST', '/api/retros/' + retroId + '/auto-group', {}, auth);
  check('POST auto-group', r.status === 200, JSON.stringify(r.data).slice(0, 80));

  // 9. Exports
  for (const p of ['/api/retros/' + retroId + '/acta', '/api/retros/' + retroId + '/commitments.csv', '/api/backup.json']) {
    const res = await fetch(BASE + p, { headers: auth });
    const txt = await res.text();
    check('GET ' + p, res.status === 200 && txt.length > 20, 'status ' + res.status);
  }

  // 10. Templates, leaderboard, my commitments
  r = await req('GET', '/api/templates', null, auth);
  check('GET /api/templates', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/leaderboard', null, auth);
  check('GET /api/leaderboard', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/my-commitments', null, auth);
  check('GET /api/my-commitments', r.status === 200, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/my-overdue-count', null, auth);
  check('GET /api/my-overdue-count', r.status === 200, JSON.stringify(r.data).slice(0, 80));

  // 11. Organization: program -> team -> PI -> retro assignment
  r = await req('POST', '/api/programs', { name: 'Smoke Program' }, auth);
  const programId = r.data?.id;
  check('POST /api/programs', (r.status === 200 || r.status === 201) && !!programId, JSON.stringify(r.data).slice(0, 120));
  r = await req('POST', '/api/teams', { name: 'Smoke Team', program_id: programId }, auth);
  const teamId = r.data?.id;
  check('POST /api/teams', (r.status === 200 || r.status === 201) && !!teamId, JSON.stringify(r.data).slice(0, 120));
  r = await req('POST', '/api/programs/' + programId + '/pis', { name: 'PI-1' }, auth);
  const piId = r.data?.id;
  check('POST /api/programs/:id/pis', (r.status === 200 || r.status === 201) && !!piId, JSON.stringify(r.data).slice(0, 120));
  r = await req('PUT', '/api/retros/' + retroId + '/team', { team_id: teamId }, auth);
  check('PUT retro team', r.status === 200 && r.data?.team_id === teamId, JSON.stringify(r.data).slice(0, 80));
  r = await req('PUT', '/api/retros/' + retroId + '/pi', { pi_id: piId }, auth);
  check('PUT retro pi', r.status === 200 && r.data?.pi_id === piId, JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/teams/' + teamId + '/dashboard', null, auth);
  check('GET team dashboard', r.status === 200 && Array.isArray(r.data?.retros) && r.data.retros.some(x => x.id === retroId), JSON.stringify(r.data).slice(0, 100));
  r = await req('GET', '/api/programs/' + programId + '/dashboard', null, auth);
  check('GET program dashboard', r.status === 200 && Array.isArray(r.data?.teamStats), JSON.stringify(r.data).slice(0, 80));
  r = await req('GET', '/api/pis/' + piId + '/dashboard', null, auth);
  check('GET PI dashboard', r.status === 200 && Array.isArray(r.data?.byTeam), JSON.stringify(r.data).slice(0, 80));
  // Access control: another user must NOT see the smoke program
  r = await req('GET', '/api/programs/' + programId + '/dashboard');
  check('program dashboard denies stranger', r.status === 401 || r.status === 403, 'status ' + r.status);

  // 12. Duplicate + delete
  r = await req('POST', '/api/retros/' + retroId + '/duplicate', {}, auth);
  const dupId = r.data?.id;
  check('POST duplicate', (r.status === 200 || r.status === 201) && !!dupId, JSON.stringify(r.data).slice(0, 120));
  if (dupId) await req('DELETE', '/api/retros/' + dupId, null, auth);
  r = await req('DELETE', '/api/retros/' + retroId, null, auth);
  check('DELETE retro', r.status === 200 || r.status === 204, 'status ' + r.status);

  // 12. Optional user cleanup (direct DB; only sensible locally)
  if (CLEANUP_USER) {
    try {
      require('dotenv').config();
      const { Pool } = require('pg');
      const cs = process.env.DATABASE_URL + (process.env.DATABASE_URL.includes('?') ? '&' : '?') + 'uselibpqcompat=true';
      const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });
      await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', [username]);
      const u = await pool.query('DELETE FROM users WHERE username = $1', [username]);
      console.log('cleanup: removed', u.rowCount, 'smoke user(s)');
      await pool.end();
    } catch (e) {
      console.log('cleanup skipped:', e.message);
    }
  }

  console.log('---');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
