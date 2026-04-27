import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent, getAzureConfigStatus } from './agent.js';
import {
  getOrCreateDemoUser, requireUser, newId, nowIso,
  listSpaces, listPositions, getPositionDetail,
  findOrCreateSpace, findOrCreatePosition,
  createMediaAsset, updateMediaAssetPosition,
  findOrCreateItem, createItemRecord
} from './store.js';

const PORT = Number(process.env.PORT || 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.join(API_DIR, 'data/uploads');

async function loadEnvFile() {
  const envPath = path.join(API_DIR, '.env');
  try {
    const raw = await readFile(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  } catch {}
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
  res.end(JSON.stringify(data));
}

function sendFile(res, status, body, contentType) {
  res.writeHead(status, { 'Content-Type': contentType, ...corsHeaders() });
  res.end(body);
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function getUserId(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}

async function saveBase64Image({ imageBase64, mimeType }) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(UPLOAD_DIR, { recursive: true });
  const mediaId = newId();
  const extension = mimeType?.includes('png') ? 'png' : 'jpg';
  const fileName = `${mediaId}.${extension}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  await writeFile(filePath, Buffer.from(imageBase64, 'base64'));
  return { mediaId, fileName, blobUrl: `/uploads/${fileName}` };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || 'GET';

  if (method === 'OPTIONS') return sendJson(res, 200, {});

  if (method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, time: nowIso(), azure: getAzureConfigStatus() });
  }

  if (method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const fileName = path.basename(url.pathname);
    const filePath = path.join(UPLOAD_DIR, fileName);
    try {
      const file = await readFile(filePath);
      const contentType = fileName.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return sendFile(res, 200, file, contentType);
    } catch {
      return sendJson(res, 404, { error: 'File not found' });
    }
  }

  if (method === 'POST' && url.pathname === '/auth/login') {
    const body = await readJson(req);
    const user = await getOrCreateDemoUser(body.email || 'demo@findit.local');
    return sendJson(res, 200, { user, token: user.id });
  }

  const user = await requireUser(getUserId(req));

  // ─── Spaces ───

  if (method === 'GET' && url.pathname === '/spaces') {
    const spaces = await listSpaces(user.id);
    const totalItems = spaces.reduce((n, s) => n + Number(s.item_count || 0), 0);
    return sendJson(res, 200, { spaces, total_spaces: spaces.length, total_items: totalItems });
  }

  if (method === 'GET' && /^\/spaces\/[^/]+\/positions$/.test(url.pathname)) {
    const spaceId = url.pathname.split('/')[2];
    const positions = await listPositions(spaceId, user.id);
    return sendJson(res, 200, { positions });
  }

  if (method === 'GET' && /^\/positions\/[^/]+\/detail$/.test(url.pathname)) {
    const posId = url.pathname.split('/')[2];
    const detail = await getPositionDetail(posId, user.id);
    if (!detail) return sendJson(res, 404, { error: 'Position not found' });
    return sendJson(res, 200, detail);
  }

  // ─── Agent (SSE) ───

  if (method === 'POST' && url.pathname === '/agent/analyze') {
    const body = await readJson(req);
    if (!body.imageBase64) return sendJson(res, 400, { error: 'imageBase64 is required' });

    const saved = await saveBase64Image({ imageBase64: body.imageBase64, mimeType: body.mimeType });
    await createMediaAsset(saved.mediaId, user.id, saved.blobUrl, body.mimeType || 'image/jpeg');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders()
    });

    sendSse(res, 'media', { media_asset_id: saved.mediaId, blob_url: saved.blobUrl });

    await runAgent({
      mode: 'analyze',
      imageBase64: body.imageBase64,
      mimeType: body.mimeType,
      userId: user.id,
      uploadDir: UPLOAD_DIR,
      onEvent: (event) => sendSse(res, event.type, event)
    });

    res.end();
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/query') {
    const body = await readJson(req);
    const queryText = String(body.query || '');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders()
    });

    await runAgent({
      mode: 'query',
      query: queryText,
      userId: user.id,
      uploadDir: UPLOAD_DIR,
      onEvent: (event) => sendSse(res, event.type, event)
    });

    res.end();
    return;
  }

  // ─── Confirm ───

  if (method === 'POST' && url.pathname === '/agent/confirm') {
    const body = await readJson(req);
    const { suggestion, media_asset_id } = body;
    if (!suggestion) return sendJson(res, 400, { error: 'suggestion is required' });

    const space = await findOrCreateSpace(user.id, suggestion.space.name);
    const position = await findOrCreatePosition(space.id, user.id, suggestion.position.name, suggestion.position.description);

    if (media_asset_id) {
      await updateMediaAssetPosition(media_asset_id, position.id);
    }

    const allItems = [
      ...(suggestion.containers || []).flatMap((c) => c.items.map((i) => ({ ...i, container: c.name }))),
      ...(suggestion.loose_items || []).map((i) => ({ ...i, container: null }))
    ];

    let savedCount = 0;
    for (const input of allItems) {
      if (input.status === 'missing') continue;
      const name = String(input.name || '').trim();
      if (!name) continue;

      const item = await findOrCreateItem(user.id, name, input.description);
      await createItemRecord(user.id, item.id, position.id, media_asset_id, input.container, input.note);
      savedCount++;
    }

    return sendJson(res, 200, { space, position, saved_count: savedCount });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

await loadEnvFile();

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    const status = error.status || 500;
    if (!res.headersSent) {
      sendJson(res, status, { error: error.message || 'Internal server error' });
    } else {
      try { sendSse(res, 'error', { error: error.message }); res.end(); } catch {}
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FindIt API listening on http://0.0.0.0:${PORT}`);
  console.log(`Azure config: ${JSON.stringify(getAzureConfigStatus())}`);
});
