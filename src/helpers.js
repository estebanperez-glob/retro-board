// Shared helpers: auth primitives, access checks, rate limiting and constants.
const crypto = require('crypto');
const db = require('./db');

// --- Freemium plan limits ---
const FREE_MAX_RETROS = 5;        // total retros a free user can create
const FREE_MAX_PARTICIPANTS = 25; // participants per retro on the free plan

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

// Resolves the logged-in user from the Authorization header (or null).
// Sessions expire after 30 days.
async function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const row = await db.get(
    `SELECT u.id, u.username, u.is_master FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.created_at >= to_char(now() AT TIME ZONE 'UTC' - interval '30 days', 'YYYY-MM-DD HH24:MI:SS')`,
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

// Master user: sees the usage stats panel. The first registered user is NOT
// automatically master; promote via SQL: UPDATE users SET is_master = TRUE WHERE username = '...'
async function requireMaster(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Log in required' }); return null; }
  if (!user.is_master) { res.status(403).json({ error: 'Master access required' }); return null; }
  return user;
}

// Async route wrapper: forwards errors to Express error handler
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// Simple in-memory rate limiter (no external deps): max N requests per window per IP
const rateBuckets = new Map();
function rateLimit({ windowMs = 60000, max = 20 } = {}) {
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests — try again in a minute' });
    }
    next();
  };
}
// Periodically clean expired buckets to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  }
}, 5 * 60000).unref();

const authRateLimit = rateLimit({ windowMs: 60000, max: 10 });
const trackRateLimit = rateLimit({ windowMs: 60000, max: 60 }); // page loads are infrequent; generous cap

// Validate that :id route params are numeric retro/card/commitment IDs.
// Non-numeric IDs (e.g. /retro.html?id=test) would otherwise hit Postgres
// with an invalid integer and surface as a 500 "Internal server error".
function validateNumericId(param = 'id') {
  return (req, res, next) => {
    const value = Number(req.params[param]);
    if (!Number.isInteger(value) || value <= 0) {
      return res.status(404).json({ error: 'Retro not found' });
    }
    req.params[param] = value;
    next();
  };
}

module.exports = {
  db,
  FREE_MAX_RETROS,
  FREE_MAX_PARTICIPANTS,
  hashPassword,
  verifyPassword,
  getUser,
  getParticipant,
  requireRetroAccess,
  requireRetroAdmin,
  requireMaster,
  ah,
  rateLimit,
  authRateLimit,
  trackRateLimit,
  validateNumericId,
};
