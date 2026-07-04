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
  consumeDailyAiQuota, refundDailyAiQuota,
  activateAnnualSubscription, recordIapAnnualPurchase,
  getUserBenefits, claimWelcomeBenefit, redeemInviteCode, deleteUserAccount,
  confirmAndSave,
  initConversationTables, getOrCreateConversation, createConversation,
  getConversationMessages, createMessage, updateMessageConfirmed,
  updateConversationResponseId,
  updateItem, deleteItem, getMediaAssetById
} from './store.js';

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

await loadEnvFile();

const PORT = Number(process.env.PORT || 4000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
  if (IS_PRODUCTION) {
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

if (IS_PRODUCTION && !IAP_SHARED_SECRET) {
  console.error('FATAL: APPLE_IAP_SHARED_SECRET must be set in production');
  process.exit(1);
}

const ANNUAL_PRODUCTS = {
  fangnale_yearly: { credits: 1000, label: '标准年卡' },
  fangnale_yearly_large: { credits: 3000, label: '大户型年卡' }
};
const LEGACY_PRODUCT_CREDITS = { fangnale_topup: 120 };
const PRODUCT_CREDITS = Object.fromEntries([
  ...Object.entries(ANNUAL_PRODUCTS).map(([id, product]) => [id, product.credits]),
  ...Object.entries(LEGACY_PRODUCT_CREDITS)
]);
const IAP_PRODUCT_IDS = new Set(Object.keys(PRODUCT_CREDITS));

function getRuntimeConfigStatus() {
  return {
    nodeEnv: process.env.NODE_ENV || null,
    isProduction: IS_PRODUCTION,
    hasJwtSecret: Boolean(JWT_SECRET),
    hasIapSharedSecret: Boolean(IAP_SHARED_SECRET),
    appleBundleId: APPLE_BUNDLE_ID
  };
}

function receiptTimestamp(item) {
  return Number(item?.expires_date_ms || item?.purchase_date_ms || item?.original_purchase_date_ms || 0);
}

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

  // Get the latest known transaction for one of this app's products.
  const latestReceipt = result.latest_receipt_info || result.receipt?.in_app || [];
  const purchases = Array.isArray(latestReceipt)
    ? latestReceipt.filter(item => IAP_PRODUCT_IDS.has(item?.product_id))
    : [];
  const latest = purchases.sort((a, b) => receiptTimestamp(a) - receiptTimestamp(b)).at(-1) || null;
  if (!latest) throw new Error('No purchase found in receipt');

  const expiresMs = Number(latest.expires_date_ms || 0);
  const expiresAt = expiresMs > 0 ? new Date(expiresMs).toISOString() : null;

  return {
    productId: latest.product_id,
    transactionId: latest.transaction_id,
    originalTransactionId: latest.original_transaction_id,
    expiresAt
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

function sendFile(res, status, body, contentType, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...extraHeaders, ...corsHeaders() });
  res.end(body);
}

function sendHtml(res, title, body) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #202124; background: #fbfaf7; line-height: 1.7; }
    main { max-width: 760px; margin: 0 auto; padding: 44px 22px 72px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 32px 0 8px; }
    p, li { font-size: 15px; }
    .muted { color: #6f6a61; }
    a { color: #2f7d5b; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    ...corsHeaders()
  });
  res.end(html);
}

function sendSupportPage(res) {
  sendHtml(res, '放哪了—AI收纳师｜支持', `
    <h1>放哪了—AI收纳师支持</h1>
    <p class="muted">更新日期：2026年6月29日</p>
    <p>放哪了—AI收纳师用于通过拍照或录像记录家中物品位置，并在需要时帮助查询物品所在位置。</p>
    <h2>常见问题</h2>
    <ul>
      <li>如果识别结果不准确，可以在 App 内修改空间、位置或物品信息。</li>
      <li>拍照和录像识别需要可用会员权益，文字查询不受影响。</li>
      <li>会员或购买问题可以先在 App 内使用“恢复购买”。</li>
    </ul>
    <h2>联系我们</h2>
    <p>如需支持，请发送邮件至 <a href="mailto:zzh506767805@gmail.com">zzh506767805@gmail.com</a>，并附上你的设备型号、系统版本、问题描述和必要截图。</p>
    <h2>相关文档</h2>
    <p><a href="/privacy">隐私政策</a> · <a href="/terms">用户协议</a></p>
  `);
}

function sendPrivacyPage(res) {
  sendHtml(res, '放哪了—AI收纳师｜隐私政策', `
    <h1>隐私政策</h1>
    <p class="muted">更新日期：2026年5月17日</p>
    <p>本隐私政策说明“放哪了—AI收纳师”如何收集、使用和保护你的信息。</p>
    <h2>我们收集的信息</h2>
    <ul>
      <li>账号信息：使用 Apple 登录时产生的 Apple 用户标识、邮箱和名称（如 Apple 提供）。</li>
      <li>用户内容：你主动上传或拍摄的照片、视频，以及你创建的空间、位置、物品、描述和对话内容。</li>
      <li>购买和用量信息：App 内购买收据、会员状态和权益状态。</li>
      <li>技术信息：服务请求、错误日志和必要的设备/网络诊断信息。</li>
    </ul>
    <h2>我们如何使用信息</h2>
    <ul>
      <li>提供登录、物品识别、图片/视频存储、空间管理和物品查询功能。</li>
      <li>验证 App 内购买、发放会员权益和维护用量计费。</li>
      <li>改进稳定性、排查故障并保障服务安全。</li>
    </ul>
    <h2>第三方服务</h2>
    <p>为提供服务，我们会使用 Apple 登录和 App 内购买能力、云数据库与对象存储服务，以及 AI 图像/文本分析服务。你上传的内容可能会被发送至这些服务用于完成识别和查询。</p>
    <h2>数据共享</h2>
    <p>我们不会出售你的个人信息。除提供服务、遵守法律要求、处理安全风险或经你同意外，我们不会向无关第三方披露你的个人信息。</p>
    <h2>数据保存与删除</h2>
    <p>我们会在提供服务所需期间保存账号、照片/视频、物品记录和购买记录。你可以在 App 内“我的”页面发起删除账号和相关个人数据；依法需要保留的交易或安全记录可能会按法律要求保存。</p>
    <h2>权限说明</h2>
    <p>相机和照片权限仅用于拍摄、选择和上传你要记录的照片或视频。你可以在系统设置中关闭相关权限，但部分功能将无法使用。</p>
    <h2>联系我们</h2>
    <p>隐私相关问题请联系 <a href="mailto:zzh506767805@gmail.com">zzh506767805@gmail.com</a>。</p>
  `);
}

function sendTermsPage(res) {
  sendHtml(res, '放哪了—AI收纳师｜用户协议', `
    <h1>用户协议</h1>
    <p class="muted">更新日期：2026年6月29日</p>
    <p>使用放哪了—AI收纳师即表示你同意本协议。</p>
    <h2>服务说明</h2>
    <p>本 App 提供家庭物品拍照/录像记录、AI 识别、空间位置管理和物品查询功能。AI 结果可能存在错误，请以实际情况为准。</p>
    <h2>账号与内容</h2>
    <p>你应确保上传内容合法并拥有必要权利。请勿上传违法、侵权、敏感或与家庭收纳无关的内容。</p>
    <h2>会员与购买</h2>
    <p>App 内展示的会员或购买项目以 App Store 结算页为准。标准年卡和大户型年卡均为一年自动续订会员。购买完成后，系统会根据购买项目发放对应会员权益；标准版适合多数家庭，大户型版适合多房间或物品更多的家庭。如遇购买异常，可在 App 内恢复购买或联系支持。</p>
    <h2>限制与免责声明</h2>
    <p>本 App 不提供医疗、法律、金融或安全应急建议。由于网络、设备、第三方服务或 AI 判断限制，服务可能出现延迟、中断或识别错误。</p>
    <h2>联系我们</h2>
    <p>如对本协议有疑问，请联系 <a href="mailto:zzh506767805@gmail.com">zzh506767805@gmail.com</a>。</p>
  `);
}

function redirectMedia(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'public, max-age=1800',
    ...corsHeaders()
  });
  res.end();
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function normalizeClientDay(value) {
  const day = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function clientDayFromRequest(url, body) {
  return normalizeClientDay(url.searchParams.get('client_day') || body?.client_day);
}

function readLimit(value, fallback = 30, max = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
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

async function saveBufferWithName(buffer, blobName, contentType) {
  if (process.env.AZURE_STORAGE_ACCOUNT) {
    await uploadToBlob(buffer, blobName, contentType);
    return getBlobUrl(blobName); // permanent URL for DB
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, blobName), buffer);
  return `/uploads/${blobName}`;
}

function imageExtensionFromMime(contentType) {
  const mime = String(contentType || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic') || mime.includes('heif')) return 'heic';
  return 'jpg';
}

function detectImageMime(buffer, fallbackMime = 'image/jpeg') {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  if (buffer.length >= 16 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 40).toString('ascii').toLowerCase();
    if (/(heic|heix|hevc|hevx|heif|mif1|msf1)/.test(brand)) return 'image/heic';
  }
  return fallbackMime;
}

async function convertHeicToJpegBuffer(buffer, sourceMime) {
  const { tmpdir } = await import('node:os');
  const dir = path.join(tmpdir(), `findit_heic_${newId()}`);
  const inputPath = path.join(dir, `input.${imageExtensionFromMime(sourceMime)}`);
  const outputPath = path.join(dir, 'output.jpg');
  await mkdir(dir, { recursive: true });
  await writeFile(inputPath, buffer);
  try {
    await execFileAsync('heif-convert', ['-q', '95', inputPath, outputPath]);
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function normalizeImageForStorage(buffer, contentType) {
  const detectedMime = detectImageMime(buffer, contentType || 'image/jpeg');
  if (/image\/hei[cf]/i.test(detectedMime)) {
    return {
      buffer: await convertHeicToJpegBuffer(buffer, detectedMime),
      contentType: 'image/jpeg',
      extension: 'jpg',
      convertedFrom: detectedMime
    };
  }
  const normalizedMime = /image\/(jpeg|jpg|png|gif|webp)/i.test(detectedMime)
    ? detectedMime.replace('image/jpg', 'image/jpeg')
    : (contentType || 'image/jpeg');
  return {
    buffer,
    contentType: normalizedMime,
    extension: imageExtensionFromMime(normalizedMime),
    convertedFrom: null
  };
}

async function createImageThumbnailBuffer(buffer, contentType, maxDim = 720) {
  const { tmpdir } = await import('node:os');
  const dir = path.join(tmpdir(), `findit_thumb_${newId()}`);
  const ext = imageExtensionFromMime(contentType);
  const inPath = path.join(dir, `in.${ext}`);
  const outPath = path.join(dir, 'thumb.jpg');
  await mkdir(dir, { recursive: true });
  await writeFile(inPath, buffer);
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inPath,
      '-vf', `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease`,
      '-frames:v', '1',
      '-q:v', '6',
      outPath
    ]);
    return await readFile(outPath);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function saveImageThumbnail(buffer, mediaId, contentType) {
  const thumbnail = await createImageThumbnailBuffer(buffer, contentType);
  if (!thumbnail) return null;
  return saveBufferWithName(thumbnail, `${mediaId}_thumb.jpg`, 'image/jpeg');
}

async function saveBase64Image({ imageBase64, mimeType }) {
  const mediaId = newId();
  const normalized = await normalizeImageForStorage(Buffer.from(imageBase64, 'base64'), mimeType || 'image/jpeg');
  const blobName = `${mediaId}.${normalized.extension}`;
  const blobUrl = await saveBufferWithName(normalized.buffer, blobName, normalized.contentType);
  const thumbnailUrl = await saveImageThumbnail(normalized.buffer, mediaId, normalized.contentType);
  return { mediaId, blobUrl, contentType: normalized.contentType, isVideo: false, thumbnailUrl, buffer: normalized.buffer };
}

async function saveVideoThumbnail(frameBase64, mediaId) {
  if (!frameBase64) return null;
  const blobName = `${mediaId}_thumb.jpg`;
  const buffer = Buffer.from(frameBase64, 'base64');
  return saveBufferWithName(buffer, blobName, 'image/jpeg');
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
      const filePart = { buffer: content, fileName: fileNameMatch[1], contentType: ctMatch?.[1]?.trim() };
      if (parts[name]) {
        parts[name] = Array.isArray(parts[name]) ? [...parts[name], filePart] : [parts[name], filePart];
      } else {
        parts[name] = filePart;
      }
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
  const normalized = isVideo
    ? { buffer: fileData.buffer, contentType: ct || 'application/octet-stream', extension: 'mp4' }
    : await normalizeImageForStorage(fileData.buffer, ct || 'image/jpeg');
  const ext = isVideo ? 'mp4' : normalized.extension;
  const blobName = `${mediaId}.${ext}`;
  const blobUrl = await saveBufferWithName(normalized.buffer, blobName, normalized.contentType);
  const thumbnailUrl = isVideo ? null : await saveImageThumbnail(normalized.buffer, mediaId, normalized.contentType);
  return { mediaId, blobUrl, contentType: normalized.contentType, isVideo, buffer: normalized.buffer, thumbnailUrl };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || 'GET';
  const startTime = Date.now();
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${method} ${url.pathname} - ${msg} (${Date.now() - startTime}ms)`);
  if (url.pathname !== '/health') log('start');

  if (method === 'OPTIONS') return sendJson(res, 200, {});

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/support')) {
    return sendSupportPage(res);
  }

  if (method === 'GET' && url.pathname === '/privacy') {
    return sendPrivacyPage(res);
  }

  if (method === 'GET' && url.pathname === '/terms') {
    return sendTermsPage(res);
  }

  if (method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      time: nowIso(),
      azure: getAzureConfigStatus(),
      runtime: getRuntimeConfigStatus()
    });
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

  if (method === 'GET' && /^\/media\/[^/]+\/(thumb|original)$/.test(url.pathname)) {
    const [, mediaId, variant] = url.pathname.match(/^\/media\/([^/]+)\/(thumb|original)$/);
    const asset = await getMediaAssetById(mediaId);
    if (!asset) return sendJson(res, 404, { error: 'Media not found' });

    const mediaUrl = variant === 'thumb' ? asset.thumbnail_url : asset.blob_url;
    if (!mediaUrl) return sendJson(res, 404, { error: 'Media variant not found' });

    if (mediaUrl.startsWith('https://')) {
      return redirectMedia(res, getBlobSasUrl(mediaUrl));
    }

    if (mediaUrl.startsWith('/uploads/')) {
      const fileName = path.basename(mediaUrl);
      const filePath = path.join(UPLOAD_DIR, fileName);
      try {
        const file = await readFile(filePath);
        const contentType = fileName.endsWith('.png') ? 'image/png'
          : fileName.endsWith('.mp4') ? 'video/mp4'
          : 'image/jpeg';
        return sendFile(res, 200, file, contentType, {
          'Cache-Control': 'public, max-age=86400, immutable'
        });
      } catch {
        return sendJson(res, 404, { error: 'Media file not found' });
      }
    }

    return sendJson(res, 404, { error: 'Unsupported media URL' });
  }

  if (method === 'POST' && url.pathname === '/auth/login') {
    if (IS_PRODUCTION) {
      return sendJson(res, 404, { error: 'Not found' });
    }
    const body = await readJson(req);
    const user = await getOrCreateDemoUser(body.email || 'demo@findit.local');
    const credits = await getUserCredits(user.id);
    const benefits = await getUserBenefits(user.id);
    return sendJson(res, 200, { user, token: signToken(user.id), credits, benefits });
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
        if (IS_PRODUCTION) {
          return sendJson(res, 401, { error: `Apple token verification failed: ${err.message}` });
        }
        console.warn('[auth] Apple token verification skipped in dev:', err.message);
      }
    } else if (IS_PRODUCTION) {
      return sendJson(res, 400, { error: 'identityToken is required' });
    }

    const name = fullName || (email ? email.split('@')[0] : 'User');
    const user = await getOrCreateAppleUser(appleUserId, email, name);
    const credits = await getUserCredits(user.id);
    const benefits = await getUserBenefits(user.id);
    return sendJson(res, 200, { user, token: signToken(user.id), credits, benefits });
  }

  const user = await requireUser(getUserId(req));

  if (method === 'GET' && url.pathname === '/user/credits') {
    const credits = await getUserCredits(user.id);
    return sendJson(res, 200, credits);
  }

  if (method === 'GET' && url.pathname === '/user/benefits') {
    const benefits = await getUserBenefits(user.id);
    return sendJson(res, 200, benefits);
  }

  if (method === 'POST' && url.pathname === '/user/benefits/welcome/claim') {
    const result = await claimWelcomeBenefit(user.id);
    return sendJson(res, 200, result);
  }

  if (method === 'POST' && url.pathname === '/user/benefits/invite/redeem') {
    const body = await readJson(req);
    const result = await redeemInviteCode(user.id, body.invite_code || body.inviteCode);
    return sendJson(res, 200, result);
  }

  if (method === 'DELETE' && url.pathname === '/user/account') {
    await deleteUserAccount(user.id);
    return sendJson(res, 200, { success: true });
  }

  if (method === 'POST' && url.pathname === '/user/add-credits') {
    const body = await readJson(req);

    // 开发模式：按前端传入的产品模拟开通年卡；保留 amount 兜底给本地调试。
    if (!IS_PRODUCTION && body.amount) {
      const annualProduct = ANNUAL_PRODUCTS[body.productId];
      if (annualProduct) {
        const credits = await activateAnnualSubscription(user.id, {
          productId: body.productId,
          credits: annualProduct.credits
        });
        return sendJson(res, 200, { ...credits, productId: body.productId });
      }
      await addCredits(user.id, body.amount);
      const credits = await getUserCredits(user.id);
      return sendJson(res, 200, credits);
    }

    // 生产模式：验证 Apple receipt
    if (!body.receiptData) {
      console.warn('[iap] missing receiptData', {
        user: user.id,
        keys: Object.keys(body || {}),
        productId: body?.productId || null,
        transactionId: body?.transactionId || null
      });
      return sendJson(res, 400, { error: 'receiptData is required' });
    }
    try {
      const { productId, transactionId, originalTransactionId, expiresAt } = await verifyAppleReceipt(body.receiptData);
      const annualProduct = ANNUAL_PRODUCTS[productId];
      if (annualProduct) {
        if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
          return sendJson(res, 403, { error: '订阅已过期，请重新开通年卡' });
        }

        const result = await recordIapAnnualPurchase(user.id, {
          productId,
          transactionId,
          originalTransactionId,
          expiresAt,
          credits: annualProduct.credits
        });
        console.log(`[iap] user=${user.id} product=${productId} tx=${transactionId} credits=+${annualProduct.credits} expires=${result.credits.subscription.expires_at} duplicate=${result.alreadyProcessed}`);
        return sendJson(res, 200, {
          ...result.credits,
          productId,
          transactionId,
          alreadyProcessed: result.alreadyProcessed
        });
      }

      const creditsToAdd = LEGACY_PRODUCT_CREDITS[productId];
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
    const clientDay = clientDayFromRequest(url);
    const conv = await getOrCreateConversation(user.id, { clientDay });
    const source = url.searchParams.get('source') || undefined;
    const limit = readLimit(url.searchParams.get('limit'));
    const messages = await getConversationMessages(conv.id, { source, limit });
    return sendJson(res, 200, { conversation: conv, messages, client_day: clientDay });
  }

  if (method === 'POST' && url.pathname === '/conversation/new') {
    const clientDay = clientDayFromRequest(url);
    const conv = await createConversation(user.id, { clientDay });
    return sendJson(res, 200, { conversation: conv, messages: [], client_day: clientDay });
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

  // ─── Items ───

  if (method === 'PUT' && /^\/items\/[^/]+$/.test(url.pathname)) {
    const itemId = url.pathname.split('/')[2];
    const body = await readJson(req);
    const result = await updateItem(user.id, itemId, body);
    if (result.error) return sendJson(res, 404, result);
    return sendJson(res, 200, result);
  }

  if (method === 'DELETE' && /^\/items\/[^/]+$/.test(url.pathname)) {
    const itemId = url.pathname.split('/')[2];
    const result = await deleteItem(user.id, itemId);
    if (result.error) return sendJson(res, 404, result);
    return sendJson(res, 200, result);
  }

  // ─── Agent (SSE) ───

  if (method === 'POST' && url.pathname === '/agent/analyze') {
    // 在解析/上传文件之前先做额度检查：余额（只读预检，正式扣减仍在上传成功后）和每日配额，
    // 避免超限用户白白消耗上传和存储成本
    const preCredits = await getUserCredits(user.id);
    if (preCredits.total <= 0) return sendJson(res, 403, { error: '免费体验已用完，请开通会员继续使用' });
    await consumeDailyAiQuota(user.id, 'analyze');

    const ct = req.headers['content-type'] || '';
    let imageBase64, mimeType, videoFrames, saved;
    let queryText = '';
    const savedAssets = [];
    const mediaInputs = [];

    if (ct.includes('multipart/form-data')) {
      const parts = await parseMultipart(req);
      log('multipart parsed');
      queryText = String(parts.query || parts.text || '').trim();
      const files = Array.isArray(parts.file) ? parts.file : (parts.file ? [parts.file] : []);
      if (!files.length) return sendJson(res, 400, { error: 'file is required' });

      for (const file of files) {
        if (!file?.buffer) return sendJson(res, 400, { error: 'file is required' });
        if (file.contentType && !ALLOWED_MIME_RE.test(file.contentType)) {
          return sendJson(res, 400, { error: 'Unsupported file type' });
        }
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const item = await saveUploadedFile(file);
        log(`blob uploaded ${i + 1}/${files.length} (${(file.buffer.length / 1024).toFixed(0)}KB, ${item.isVideo ? 'video' : 'image'})`);

        if (item.isVideo) {
          const frames = await extractVideoFrames(item.buffer);
          log(`video frames extracted ${i + 1}/${files.length}: ${frames.length}`);
          if (!frames.length) return sendJson(res, 400, { error: 'Failed to extract frames from video' });
          item.thumbnailUrl = await saveVideoThumbnail(frames[0], item.mediaId);
          item.videoFrames = frames;
        } else {
          item.imageBase64 = item.buffer.toString('base64');
        }

        savedAssets.push(item);
        mediaInputs.push({
          kind: item.isVideo ? 'video' : 'image',
          imageBase64: item.imageBase64,
          blobUrl: item.blobUrl,
          videoFrames: item.videoFrames,
          mimeType: item.isVideo ? 'image/jpeg' : (item.contentType || 'image/jpeg')
        });
      }

      saved = savedAssets[0];
      imageBase64 = saved?.imageBase64;
      videoFrames = saved?.videoFrames;
      mimeType = saved?.isVideo ? 'image/jpeg' : (saved?.contentType || 'image/jpeg');
    } else {
      // Legacy: JSON base64 upload
      const body = await readJson(req);
      if (!body.imageBase64) return sendJson(res, 400, { error: 'imageBase64 is required' });
      queryText = String(body.query || body.text || '').trim();
      saved = await saveBase64Image({ imageBase64: body.imageBase64, mimeType: body.mimeType || 'image/jpeg' });
      imageBase64 = saved.buffer.toString('base64');
      mimeType = saved.contentType || 'image/jpeg';
      saved.imageBase64 = imageBase64;
      savedAssets.push(saved);
      mediaInputs.push({ kind: 'image', imageBase64, blobUrl: saved.blobUrl, mimeType });
    }

    const source = url.searchParams.get('source') || 'assistant';
    const spaceHint = url.searchParams.get('space_hint') || '';
    const clientDay = clientDayFromRequest(url);

    const creditType = await consumeCredit(user.id);
    for (const item of savedAssets) {
      await createMediaAsset(item.mediaId, user.id, item.blobUrl, item.contentType || mimeType, item.thumbnailUrl || null);
    }

    const conv = await getOrCreateConversation(user.id, { clientDay });
    if (queryText) {
      await createMessage(conv.id, user.id, {
        role: 'user', type: 'text', content: queryText, source
      });
    }
    for (const item of savedAssets) {
      await createMessage(conv.id, user.id, {
        role: 'user', type: item.isVideo ? 'video' : 'photo',
        blobUrl: item.blobUrl, mediaAssetId: item.mediaId, source
      });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...corsHeaders()
    });

    const mediaForAgent = mediaInputs.map((item, index) => {
      const asset = savedAssets[index];
      return {
        ...item,
        blobUrl: asset.blobUrl.startsWith('https://') ? getBlobSasUrl(asset.blobUrl) : asset.blobUrl
      };
    });

    savedAssets.forEach((item, index) => {
      const sasUrl = item.blobUrl.startsWith('https://') ? getBlobSasUrl(item.blobUrl) : item.blobUrl;
      const thumbnailUrl = item.thumbnailUrl
        ? (item.thumbnailUrl.startsWith('https://') ? getBlobSasUrl(item.thumbnailUrl) : item.thumbnailUrl)
        : null;
      sendSse(res, 'media', {
        index,
        total: savedAssets.length,
        media_asset_id: item.mediaId,
        blob_url: sasUrl,
        thumbnail_url: thumbnailUrl,
        preview_url: thumbnailUrl || (item.isVideo ? null : sasUrl),
        content_type: item.contentType || mimeType
      });
    });

    let agentAnswer = '';
    let agentSuggestion = null;
    const agentSteps = [];
    log(`starting AI agent (source=${source})`);

    try {
      const result = await runAgent({
        mode: 'analyze',
        imageBase64,
        blobUrl: mediaForAgent[0]?.blobUrl,
        videoFrames,
        mediaInputs: mediaForAgent,
        mimeType,
        query: queryText,
        userId: user.id,
        uploadDir: UPLOAD_DIR,
        previousResponseId: conv.last_response_id,
        spaceHint,
        onEvent: (event) => {
          sendSse(res, event.type, event);
          if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'answer') agentSteps.push(event);
          if (event.type === 'answer_delta') agentAnswer = event.text || agentAnswer;
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
      log(`AI agent failed: ${err.stack || err.message || err}`);
      await refundCredit(user.id, creditType).catch(() => {});
      await refundDailyAiQuota(user.id, 'analyze').catch(() => {});
      sendSse(res, 'error', { error: err.message || 'Agent failed' });
      res.end();
      return;
    }

    res.end();
    return;
  }

  if (method === 'POST' && url.pathname === '/agent/query') {
    const body = await readJson(req);
    const queryText = String(body.query || '').trim();
    if (!queryText) return sendJson(res, 400, { error: '请输入内容' });
    if (queryText.length > 500) return sendJson(res, 400, { error: '内容太长了，请精简到 500 字以内' });
    await consumeDailyAiQuota(user.id, 'query');
    const clientDay = clientDayFromRequest(url, body);

    const conv = await getOrCreateConversation(user.id, { clientDay });
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

    try {
      const result = await runAgent({
        mode: 'query',
        query: queryText,
        userId: user.id,
        uploadDir: UPLOAD_DIR,
        previousResponseId: conv.last_response_id,
        onEvent: (event) => {
          sendSse(res, event.type, event);
          if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'answer') agentSteps.push(event);
          if (event.type === 'answer_delta') agentAnswer = event.text || agentAnswer;
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
    } catch (err) {
      await refundDailyAiQuota(user.id, 'query').catch(() => {});
      sendSse(res, 'error', { error: err.message || 'Agent failed' });
      res.end();
      return;
    }

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
