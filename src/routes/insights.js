// Insights & integrations routes: evolution, leaderboard, acta, health score,
// auto-group, executive summary, Slack/Teams webhook, CSV export.
const {
  db, ah, getUser, requireRetroAccess, requireRetroAdmin,
} = require('../helpers');
const { broadcast } = require('../ws');
const { tokenize, sentimentOf } = require('../text');
const { TEMPLATE_LABELS, resolveColumns } = require('./cards');

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

function register(app) {
  // --- Evolution: completed commitments per retro (for the history chart) ---
  app.get('/api/evolution', ah(async (req, res) => {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Log in to see the evolution chart' });
    const rows = await db.all(`
      SELECT r.id, r.title, r.sprint, r.created_at,
        COUNT(CASE WHEN cm.status = 'done' THEN 1 END) AS completed,
        COUNT(*) AS total,
        (SELECT ROUND(AVG(CASE p.mood
            WHEN 'thrilled' THEN 5 WHEN 'good' THEN 4 WHEN 'soso' THEN 3
            WHEN 'tense' THEN 2 WHEN 'burned' THEN 1 END)::numeric, 2)
          FROM participants p WHERE p.retro_id = r.id AND p.mood IS NOT NULL) AS mood_avg
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
      const moodRow = await db.get(`
        SELECT ROUND(AVG(CASE mood
            WHEN 'thrilled' THEN 5 WHEN 'good' THEN 4 WHEN 'soso' THEN 3
            WHEN 'tense' THEN 2 WHEN 'burned' THEN 1 END)::numeric, 2) AS mood_avg
        FROM participants WHERE retro_id = $1 AND mood IS NOT NULL`, [retro.id]);
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
        mood_avg: moodRow?.mood_avg ? Number(moodRow.mood_avg) : null,
      });
    }
    res.json(scores);
  }));

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
}

module.exports = { register, notifyWebhook };
