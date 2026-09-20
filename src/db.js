require('dotenv').config(); // loads .env from the project root (local dev convenience)

const { Pool } = require('pg');

// Neon / Postgres connection — DATABASE_URL is required
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (e.g. postgres://user:pass@host/db?sslmode=require)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required by Neon
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS retros (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  sprint TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT,
  template TEXT NOT NULL DEFAULT 'classic',
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  retro_id INTEGER NOT NULL REFERENCES retros(id),
  name TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  access_token TEXT UNIQUE,
  UNIQUE(retro_id, name)
);

CREATE TABLE IF NOT EXISTS cards (
  id SERIAL PRIMARY KEY,
  retro_id INTEGER NOT NULL REFERENCES retros(id),
  column_type TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS votes (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id),
  voter TEXT NOT NULL,
  retro_id INTEGER NOT NULL REFERENCES retros(id),
  UNIQUE(card_id, voter)
);

CREATE TABLE IF NOT EXISTS commitments (
  id SERIAL PRIMARY KEY,
  retro_id INTEGER NOT NULL REFERENCES retros(id),
  description TEXT NOT NULL,
  assignee TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS points (
  id SERIAL PRIMARY KEY,
  participant_name TEXT NOT NULL,
  retro_id INTEGER NOT NULL REFERENCES retros(id),
  commitment_id INTEGER REFERENCES commitments(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
`;

async function initSchema() {
  await pool.query(SCHEMA);
  // Migrations: add columns to existing tables (CREATE TABLE IF NOT EXISTS won't)
  const migrations = [
    'ALTER TABLE retros ADD COLUMN IF NOT EXISTS created_by TEXT',
    'ALTER TABLE retros ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT \'classic\'',
    'ALTER TABLE retros ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE',
    'ALTER TABLE retros ADD COLUMN IF NOT EXISTS join_code TEXT',
    'ALTER TABLE participants ADD COLUMN IF NOT EXISTS access_token TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS security_question TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer_hash TEXT',
    // Backfill: generate join codes and participant tokens for existing rows
    `UPDATE retros SET join_code = substr(md5(random()::text || clock_timestamp()::text), 1, 10) WHERE join_code IS NULL`,
    `UPDATE participants SET access_token = md5(random()::text || clock_timestamp()::text || id::text) WHERE access_token IS NULL`,
  ];
  for (const sql of migrations) {
    await pool.query(sql);
  }
}

// Query helper: returns rows array (like better-sqlite3 .all())
async function all(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

// Query helper: returns single row or undefined (like .get())
async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0];
}

// Query helper: returns { lastInsertRowid } for INSERTs (like SQLite)
async function run(sql, params = []) {
  const res = await pool.query(sql, params);
  return { lastInsertRowid: res.rows[0]?.id ?? null, rowCount: res.rowCount };
}

module.exports = { pool, initSchema, all, get, run };
