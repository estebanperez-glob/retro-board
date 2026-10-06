// WebSocket: broadcast changes to all clients in a retro room.
const { WebSocketServer } = require('ws');
const db = require('./db');

const rooms = new Map(); // retroId -> Set<ws>

function broadcast(retroId, event, payload) {
  const room = rooms.get(Number(retroId));
  if (!room) return;
  const message = JSON.stringify({ event, payload });
  for (const client of room) {
    if (client.readyState === 1) client.send(message);
  }
}

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const retroId = Number(url.searchParams.get('retroId'));
    if (!retroId) { ws.close(); return; }
    // Only retro members (admin or participants with their token) can listen
    const retro = await db.get('SELECT * FROM retros WHERE id = $1', [retroId]);
    if (!retro) { ws.close(); return; }
    const userToken = url.searchParams.get('userToken');
    const participantToken = url.searchParams.get('participantToken');
    let allowed = false;
    if (userToken) {
      const row = await db.get(
        'SELECT u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [userToken]);
      allowed = !!row && row.username === retro.created_by;
    }
    if (!allowed && participantToken) {
      const row = await db.get(
        'SELECT id FROM participants WHERE access_token = $1 AND retro_id = $2', [participantToken, retroId]);
      allowed = !!row;
    }
    if (!allowed) { ws.close(); return; }
    if (!rooms.has(retroId)) rooms.set(retroId, new Set());
    rooms.get(retroId).add(ws);
    ws.on('close', () => rooms.get(retroId)?.delete(ws));
  });
  return wss;
}

module.exports = { broadcast, setupWebSocket };
