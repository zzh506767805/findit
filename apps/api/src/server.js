import { createServer } from 'node:http';
import { createHmac, timingSafeEqual, createPublicKey } from 'node:crypto';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBlobUrl, getBlobSasUrl, uploadToBlob } from './blob.js';

const execFileAsync = promisify(execFile);
import { runAgent, getAzureConfigStatus } from './agent.js';
import {
  getOrCreateDemoUser, getOrCreateAppleUser, requireUser, newId, nowIso,
  listSpaces, createSpace, updateSpace, deleteSpace,
  listPositions, createPosition, updatePosition, deletePosition,
  getPositionDetail,
  createMediaAsset,
  getUserCredits, consumeCredit, refundCredit, addCredits,
  confirmAndSave,
  initConversationTables, getOrCreateConversation, createConversation,
  getConversationMessages, createMessage, updateMessageConfirmed,
  updateMessageSuggestion, updateConversationResponseId
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

// ─── Auth Token (HMAC-SHA256) ───

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET must be set in production');
    process.exit(1);
  }
  console.warn('WARNING: JWT_SECRET not set, using dev fallback (DO NOT use in production)');
}
const JWT_SECRET_KEY = JWT_SECRET || 'findit-dev-secret-change-in-production';

function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Date.now() })).toString('base64url');
  const sig = createHmac('sha256', JWT_SECRET_KEY).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function verifyToken(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = createHmac('sha256', JWT_SECRET_KEY).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() - data.iat > TOKEN_MAX_AGE_MS) return null;
    return data.sub;
  } catch { return null; }
}

// ─── Apple Sign In Token Verification ───

const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_BUNDLE_ID = 'top.fangnale';
let appleKeysCache = null;
let appleKeysCacheTime = 0;

async function getApplePublicKeys() {
  if (appleKeysCache && Date.now() - appleKeysCacheTime < 3600_000) return appleKeysCache;
  const res = await fetch(APPLE_KEYS_URL);
  if (!res.ok) throw new Error('Failed to fetch Apple public keys');
  const { keys } = await res.json();
  appleKeysCache = keys;
  appleKeysCacheTime = Date.now();
  return keys;
}

function base64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

async function verifyAppleIdentityToken(identityToken) {
  const parts = identityToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const header = JSON.parse(base64urlDecode(parts[0]).toString());
  const payload = JSON.parse(base64urlDecode(parts[1]).toString());

  // Find matching key
  const keys = await getApplePublicKeys();
  const key = keys.find(k => k.kid === header.kid);
  if (!key) throw new Error('Apple key not found');

  // Build public key and verify signature
  const publicKey = createPublicKey({ key, format: 'jwk' });
  const { createVerify } = await import('node:crypto');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  const valid = verifier.verify(publicKey, parts[2], 'base64url');
  if (!valid) throw new Error('Invalid signature');

  // Verify claims
  if (payload.iss !== APPLE_ISSUER) throw new Error('Invalid issuer');
  if (payload.aud !== APPLE_BUNDLE_ID) throw new Error('Invalid audience');
  if (payload.exp * 1000 < Date.now()) throw new Error('Token expired');

  return payload; // { sub, email, ... }
}

// ─── Apple IAP Receipt Verification ───

const APPLE_VERIFY_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_VERIFY_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';
const IAP_SHARED_SECRET = process.env.APPLE_IAP_SHARED_SECRET || '';

const PRODUCT_CREDITS = {
  fangnale_yearly: 500,
  fangnale_topup: 120
};

async function verifyAppleReceipt(receiptData) {
  const body = JSON.stringify({ 'receipt-data': receiptData, password: IAP_SHARED_SECRET });

  let res = await fetch(APPLE_VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  let result = await res.json();

  // Status 21007 means it's a sandbox receipt
  if (result.status === 21007) {
    res = await fetch(APPLE_SANDBOX_VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    result = await res.json();
  }

  if (result.status !== 0) throw new Error(`Receipt verification failed: status ${result.status}`);

  // Get the latest transaction
  const latestReceipt = result.latest_receipt_info || result.receipt?.in_app || [];
  const latest = Array.isArray(latestReceipt) ? latestReceipt[latestReceipt.length - 1] : null;
  if (!latest) throw new Error('No purchase found in receipt');

  return {
    productId: latest.product_id,
    transactionId: latest.transaction_id,
    originalTransactionId: latest.original_transaction_id
  };
}

function addSasToUrls(data) {
  if (!process.env.AZURE_STORAGE_KEY) return data;
  const json = JSON.stringify(data);
  const blobBase = `https://${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/`;
  if (!json.includes(blobBase)) return data;
  // Replace all bare blob URLs with SAS-signed URLs
  const replaced = json.replace(
    new RegExp(`${blobBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"?]+`, 'g'),
    (url) => getBlobSasUrl(url)
  );
  return JSON.parse(replaced);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
  res.end(JSON.stringify(addSasToUrls(data)));
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
  if (auth.startsWith('Bearer ')) return verifyToken(auth.slice(7));
  return null;
}

// ─── Azure Blob Storage (see blob.js) ───

async function saveBase64Image({ imageBase64, mimeType }) {
  const mediaId = newId();
  const extension = mimeType?.includes('png') ? 'png' : 'jpg';
  const blobName = `${mediaId}.${extension}`;
  const buffer = Buffer.from(imageBase64, 'base64');

  if (process.env.AZURE_STORAGE_ACCOUNT) {
    await uploadToBlob(buffer, blobName, mimeType || 'image/jpeg');
    return { mediaId, blobUrl: getBlobUrl(blobName) }; // permanent URL for DB
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, blobName), buffer);
  return { mediaId, blobUrl: `/uploads/${blobName}` };
}

// ─── Multipart parser (minimal, no deps) ───

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_MIME_RE = /^(image\/(jpeg|png|gif|webp|heic|heif)|video\/(mp4|quicktime|x-m4v))$/i;

async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) throw Object.assign(new Error('No multipart boundary'), { status: 400 });
  const boundary = boundaryMatch[1];

  const chunks = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_UPLOAD_BYTES) throw Object.assign(new Error('File too large (max 50MB)'), { status: 413 });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const parts = {};
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter) + delimiter.length;

  while (start < body.length) {
    const nextDelim = body.indexOf(delimiter, start);
    if (nextDelim === -1) break;
    const part = body.slice(start, nextDelim);
    start = nextDelim + delimiter.length;

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const content = part.slice(headerEnd + 4, part.length - 2); // trim trailing \r\n

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const fileNameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    if (fileNameMatch) {
      parts[name] = { buffer: content, fileName: fileNameMatch[1], contentType: ctMatch?.[1]?.trim() };
    } else {
      parts[name] = content.toString('utf8');
    }
  }
  return parts;
}

// ─── Video frame extraction ───

async function extractVideoFrames(videoBuffer, maxFrames = 10) {
  const { tmpdir } = await import('node:os');
  const tempDir = path.join(tmpdir(), `findit_frames_${newId()}`);
  await mkdir(tempDir, { recursive: true });
  const videoPath = path.join(tempDir, 'input.mp4');
  await writeFile(videoPath, videoBuffer);

  // Get video duration
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', videoPath
  ]);
  const duration = Math.min(parseFloat(stdout) || 10, 10);
  const fps = Math.min(maxFrames, Math.ceil(duration)) / duration;

  await execFileAsync('ffmpeg', [
    '-i', videoPath, '-vf', `fps=${fps}`, '-frames:v', String(maxFrames),
    '-q:v', '2', path.join(tempDir, 'frame_%03d.jpg')
  ]);

  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(tempDir)).filter(f => f.endsWith('.jpg')).sort();
  const frames = [];
  for (const f of files) {
    const data = await readFile(path.join(tempDir, f));
    frames.push(data.toString('base64'));
  }

  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  return frames;
}

async function saveUploadedFile(fileData) {
  const mediaId = newId();
  const ct = fileData.contentType || '';
  const isVideo = ct.startsWith('video/');
  const ext = isVideo ? 'mp4' : (ct.includes('png') ? 'png' : 'jpg');
  const blobName = `${mediaId}.${ext}`;

  if (process.env.AZURE_STORAGE_ACCOUNT) {
    await uploadToBlob(fileData.buffer, blobName, ct || 'application/octet-stream');
    return { mediaId, blobUrl: getBlobUrl(blobName), contentType: ct, isVideo, buffer: fileData.buffer };
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, blobName), fileData.buffer);
  return { mediaId, blobUrl: `/uploads/${blobName}`, contentType: ct, isVideo, buffer: fileData.buffer };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || 'GET';
  const startTime = Date.now();
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${method} ${url.pathname} - ${msg} (${Date.now() - startTime}ms)`);
  if (url.pathname !== '/health') log('start');

  if (method === 'OPTIONS') return sendJson(res, 200, {});

  if (method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, time: nowIso(), azure: getAzureConfigStatus() });
  }

  if (method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const fileName = path.basename(url.pathname);
    const filePath = path.join(UPLOAD_DIR, fileName);
    try {
      const file = await readFile(filePath);
      const contentType = fileName.endsWith('.png') ? 'image/png'
        : fileName.endsWith('.mp4') ? 'video/mp4'
        : 'image/jpeg';
      return sendFile(res, 200, file, contentType);
    } catch {
      return sendJson(res, 404, { error: 'File not found' });
    }
  }

  if (method === 'POST' && url.pathname === '/auth/login') {
    const body = await readJson(req);
    const user = await getOrCreateDemoUser(body.email || 'demo@findit.local');
    const credits = await getUserCredits(user.id);
    return sendJson(res, 200, { user, token: signToken(user.id), credits });
  }

  if (method === 'POST' && url.pathname === '/auth/apple') {
    const body = await readJson(req);
    const { appleUserId, email, fullName, identityToken } = body;
    if (!appleUserId) return sendJson(res, 400, { error: 'appleUserId is required' });

    // 验证 identityToken（生产环境强制，开发环境可跳过）
    if (identityToken) {
      try {
        const applePayload = await verifyAppleIdentityToken(identityToken);
        if (applePayload.sub !== appleUserId) {
          return sendJson(res, 401, { error: 'Token subject mismatch' });
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'production') {
          return sendJson(res, 401, { error: `Apple token verification failed: ${err.message}` });
        }
        console.warn('[auth] Apple token verification skipped in dev:', err.message);
      }
    } else if (process.env.NODE_ENV === 'production') {
      return sendJson(res, 400, { error: 'identityToken is required' });
    }

    const name = fullName || (email ? email.split('@')[0] : 'User');
    const user = await getOrCreateAppleUser(appleUserId, email, name);
    const credits = await getUserCredits(user.id);
    return sendJson(res, 200, { user, token: signToken(user.id), credits });
  }

  const user = await requireUser(getUserId(req));

  if (method === 'GET' && url.pathname === '/user/credits') {
    const credits = await getUserCredits(user.id);
    return sendJson(res, 200, credits);
  }

  if (method === 'POST' && url.pathname === '/user/add-credits') {
    const body = await readJson(req);

    // 开发模式：直接加次数
    if (process.env.NODE_ENV === 'development' && body.amount) {
      await addCredits(user.id, body.amount);
      const credits = await getUserCredits(user.id);
      return sendJson(res, 200, credits);
    }

    // 生产模式：验证 Apple receipt
    if (!body.receiptData) return sendJson(res, 400, { error: 'receiptData is required' });
    try {
      const { productId, transactionId } = await verifyAppleReceipt(body.receiptData);
      const creditsToAdd = PRODUCT_CREDITS[productId];
      if (!creditsToAdd) return sendJson(res, 400, { error: `Unknown product: ${productId}` });
      await addCredits(user.id, creditsToAdd);
      const credits = await getUserCredits(user.id);
      console.log(`[iap] user=${user.id} product=${productId} tx=${transactionId} credits=+${creditsToAdd}`);
      return sendJson(res, 200, { ...credits, productId, transactionId });
    } catch (err) {
      console.error('[iap] verification failed:', err.message);
      return sendJson(res, 403, { error: err.message });
    }
  }

  // ─── Conversation ───

  if (method === 'GET' && url.pathname === '/conversation') {
    const conv = await getOrCreateConversation(user.id);
    const source = url.searchParams.get('source') || undefined;
    const messages = await getConversationMessages(conv.id, { source });
    return sendJson(res, 200, { conversation: conv, messages });
  }

  if (method === 'POST' && url.pathname === '/conversation/new') {
    const conv = await createConversation(user.id);
    return sendJson(res, 200, { conversation: conv, messages: [] });
  }

  // ─── Spaces ───

  if (method === 'GET' && url.pathname === '/spaces') {
    const spaces = await listSpaces(user.id);
    const totalItems = spaces.reduce((n, s) => n + Number(s.item_count || 0), 0);
    return sendJson(res, 200, { spaces, total_spaces: spaces.length, total_items: totalItems });
  }

  if (method === 'POST' && url.pathname === '/spaces') {
    const body = await readJson(req);
    if (!body.name?.trim()) return sendJson(res, 400, { error: '空间名称不能为空' });
    const space = await createSpace(user.id, body.name.trim());
    return sendJson(res, 200, space);
  }

  if (method === 'PUT' && /^\/spaces\/[^/]+$/.test(url.pathname)) {
    const spaceId = url.pathname.split('/')[2];
    const body = await readJson(req);
    if (!body.name?.trim()) return sendJson(res, 400, { error: '空间名称不能为空' });
    const space = await updateSpace(user.id, spaceId, body.name.trim());
    if (!space) return sendJson(res, 404, { error: 'Space not found' });
    return sendJson(res, 200, space);
  }

  if (method === 'DELETE' && /^\/spaces\/[^/]+$/.test(url.pathname)) {
    const spaceId = url.pathname.split('/')[2];
    await deleteSpace(user.id, spaceId);
    return sendJson(res, 200, { success: true });
  }

  if (method === 'GET' && /^\/spaces\/[^/]+\/positions$/.test(url.pathname)) {
    const spaceId = url.pathname.split('/')[2];
    const positions = await listPositions(spaceId, user.id);
    return sendJson(res, 200, { positions });
  }

  if (method === 'POST' && /^\/spaces\/[^/]+\/positions$/.test(url.pathname)) {
    const spaceId = url.pathname.split('/')[2];
    const body = await readJson(req);
    if (!body.name?.trim()) return sendJson(res, 400, { error: '位置名称不能为空' });
    const position = await createPosition(spaceId, user.id, body.name.trim());
    return sendJson(res, 200, position);
  }

  if (method === 'PUT' && /^\/positions\/[^/]+$/.test(url.pathname)) {
    const posId = url.pathname.split('/')[2];
    const body = await readJson(req);
    if (!body.name?.trim()) return sendJson(res, 400, { error: '位置名称不能为空' });
    const pos = await updatePosition(user.id, posId, body.name.trim());
    if (!pos) return sendJson(res, 404, { error: 'Position not found' });
    return sendJson(res, 200, pos);
  }

  if (method === 'DELETE' && /^\/positions\/[^/]+$/.test(url.pathname)) {
    const posId = url.pathname.split('/')[2];
    await deletePosition(user.id, posId);
    return sendJson(res, 200, { success: true });
  }

  if (method === 'GET' && /^\/positions\/[^/]+\/detail$/.test(url.pathname)) {
    const posId = url.pathname.split('/')[2];
    const detail = await getPositionDetail(posId, user.id);
    if (!detail) return sendJson(res, 404, { error: 'Position not found' });
    return sendJson(res, 200, detail);
  }

  // ─── Agent (SSE) ───

  if (method === 'POST' && url.pathname === '/agent/analyze') {
    const ct = req.headers['content-type'] || '';
    let imageBase64, mimeType, videoFrames, saved;

    if (ct.includes('multipart/form-data')) {
      const parts = await parseMultipart(req);
      log('multipart parsed');
      const file = parts.file;
      if (!file?.buffer) return sendJson(res, 400, { error: 'file is required' });
      if (file.contentType && !ALLOWED_MIME_RE.test(file.contentType)) {
        return sendJson(res, 400, { error: 'Unsupported file type' });
      }

      saved = await saveUploadedFile(file);
      log(`blob uploaded (${(file.buffer.length / 1024).toFixed(0)}KB, ${saved.isVideo ? 'video' : 'image'})`);

      if (saved.isVideo) {
        videoFrames = await extractVideoFrames(saved.buffer);
        log(`video frames extracted: ${videoFrames.length}`);
        if (!videoFrames.length) return sendJson(res, 400, { error: 'Failed to extract frames from video' });
        mimeType = 'image/jpeg';
      } else {
        imageBase64 = file.buffer.toString('base64');
        mimeType = saved.contentType || 'image/jpeg';
      }
    } else {
      // Legacy: JSON base64 upload
      const body = await readJson(req);
      if (!body.imageBase64) return sendJson(res, 400, { error: 'imageBase64 is required' });
      imageBase64 = body.imageBase64;
      mimeType = body.mimeType || 'image/jpeg';
      saved = await saveBase64Image({ imageBase64, mimeType });
    }

    const source = url.searchParams.get('source') || 'assistant';
    const spaceHint = url.searchParams.get('space_hint') || '';

    const creditType = await consumeCredit(user.id);
    await createMediaAsset(saved.mediaId, user.id, saved.blobUrl, saved.contentType || mimeType);

    const conv = await getOrCreateConversation(user.id);
    await createMessage(conv.id, user.id, {
      role: 'user', type: saved.isVideo ? 'video' : 'photo',
      blobUrl: saved.blobUrl, mediaAssetId: saved.mediaId, source
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders()
    });

    const sasUrl = saved.blobUrl.startsWith('https://') ? getBlobSasUrl(saved.blobUrl) : saved.blobUrl;
    sendSse(res, 'media', { media_asset_id: saved.mediaId, blob_url: sasUrl });

    let agentAnswer = '';
    let agentSuggestion = null;
    const agentSteps = [];
    log(`starting AI agent (source=${source})`);

    try {
      const result = await runAgent({
        mode: 'analyze',
        imageBase64,
        blobUrl: sasUrl,
        videoFrames,
        mimeType,
        userId: user.id,
        uploadDir: UPLOAD_DIR,
        previousResponseId: conv.last_response_id,
        spaceHint,
        onEvent: (event) => {
          sendSse(res, event.type, event);
          if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'answer') agentSteps.push(event);
          if (event.type === 'answer') agentAnswer = event.text || '';
          if (event.type === 'done' && event.suggestion) agentSuggestion = event.suggestion;
        }
      });

      log('AI agent done');
      const agentMsg = await createMessage(conv.id, user.id, {
        role: 'agent', type: 'answer', content: agentAnswer,
        suggestion: agentSuggestion, mediaAssetId: saved.mediaId, source, steps: agentSteps
      });
      if (result.responseId) await updateConversationResponseId(conv.id, result.responseId);
      sendSse(res, 'message_saved', { message_id: agentMsg.id });
    } catch (err) {
      await refundCredit(user.id, creditType).catch(() => {});
      sendSse(res, 'error', { error: err.message || 'Agent failed' });
      res.end();
      return;
    }

    res.end();
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/query') {
    const body = await readJson(req);
    const queryText = String(body.query || '');

    const conv = await getOrCreateConversation(user.id);
    await createMessage(conv.id, user.id, { role: 'user', type: 'text', content: queryText });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders()
    });

    let agentAnswer = '';
    let agentSuggestion = null;
    const agentSteps = [];

    const result = await runAgent({
      mode: 'query',
      query: queryText,
      userId: user.id,
      uploadDir: UPLOAD_DIR,
      previousResponseId: conv.last_response_id,
      onEvent: (event) => {
        sendSse(res, event.type, event);
        if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'answer') agentSteps.push(event);
        if (event.type === 'answer') agentAnswer = event.text || '';
        if (event.type === 'done' && event.suggestion) agentSuggestion = event.suggestion;
      }
    });

    const agentMsg = await createMessage(conv.id, user.id, {
      role: 'agent', type: 'answer', content: agentAnswer,
      suggestion: agentSuggestion, steps: agentSteps
    });
    if (result.responseId) await updateConversationResponseId(conv.id, result.responseId);
    sendSse(res, 'message_saved', { message_id: agentMsg.id });

    res.end();
    return;
  }

  // ─── Confirm ───

  if (method === 'POST' && url.pathname === '/agent/confirm') {
    const body = await readJson(req);
    const { suggestion, media_asset_id, message_id } = body;
    if (!suggestion) return sendJson(res, 400, { error: 'suggestion is required' });

    const result = await confirmAndSave(user.id, suggestion, media_asset_id);
    if (message_id) await updateMessageConfirmed(message_id, user.id);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: 'Not found' });
}

await loadEnvFile();
await initConversationTables().catch(err => console.warn('DB table init:', err.message));

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
