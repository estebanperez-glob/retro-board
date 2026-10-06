const express = require('express');
const http = require('http');
const path = require('path');
const db = require('./db');
const { validateNumericId } = require('./helpers');
const { setupWebSocket } = require('./ws');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Validate :id params before the retro/card/commitment routes mount
app.use('/api/retros/:id', validateNumericId('id'));
app.use('/api/cards/:id', validateNumericId('id'));
app.use('/api/commitments/:id', validateNumericId('id'));

// Route modules (order preserved from the original monolith)
require('./routes/auth').register(app);
require('./routes/retros').register(app);
require('./routes/cards').register(app);
require('./routes/commitments').register(app);
require('./routes/admin').register(app);
require('./routes/insights').register(app);

// --- Health check ---
app.get('/api/health', (req, res) => {
  db.get('SELECT 1')
    .then(() => res.json({ ok: true }))
    .catch(() => res.status(503).json({ ok: false }));
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
setupWebSocket(server);

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
