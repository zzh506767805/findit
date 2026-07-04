import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';

let _pool;
function pool() {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
  }
  return _pool;
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return randomUUID();
}

async function query(sql, params) {
  const result = await pool().query(sql, params);
  return result.rows;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_FREE_CREDITS = 3;
const WELCOME_TRIAL_PRODUCT_ID = 'welcome_trial';
const WELCOME_GIFT_DAYS = 15;
const INVITE_GIFT_DAYS = 15;
const WELCOME_GIFT_CREDITS = 30;
const INVITE_GIFT_CREDITS = INVITE_GIFT_DAYS;
const YEARLY_SUBSCRIPTION_DAYS = 365;

function isUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

function makeInviteCode() {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return code;
}

function normalizeInviteCode(code) {
  return String(code || '').trim().replace(/\s+/g, '').toUpperCase();
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asIso(value) {
  const date = asDate(value);
  return date ? date.toISOString() : null;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatCreditsRow(row) {
  const now = new Date();
  const free = Number(row?.free_credits || 0);
  const paidStored = Number(row?.paid_credits || 0);
  const expiresAt = asDate(row?.subscription_expires_at);
  const subscriptionActive = Boolean(expiresAt && expiresAt.getTime() > now.getTime());
  const paid = subscriptionActive ? paidStored : 0;

  return {
    free,
    paid,
    total: free + paid,
    subscription: {
      active: subscriptionActive,
      expired: Boolean(expiresAt && !subscriptionActive),
      expires_at: asIso(expiresAt),
      product_id: row?.subscription_product_id || null
    }
  };
}

async function ensureInviteCode(userId) {
  const current = await query('SELECT invite_code FROM users WHERE id = $1', [userId]);
  if (!current.length) throw Object.assign(new Error('User not found'), { status: 401 });
  if (current[0].invite_code) return current[0].invite_code;

  for (let i = 0; i < 8; i++) {
    const code = makeInviteCode();
    try {
      const rows = await query(
        'UPDATE users SET invite_code = $1 WHERE id = $2 AND invite_code IS NULL RETURNING invite_code',
        [code, userId]
      );
      if (rows.length) return rows[0].invite_code;
    } catch (err) {
      if (err.code !== '23505') throw err;
    }
  }

  throw Object.assign(new Error('邀请码生成失败，请稍后再试'), { status: 500 });
}

async function insertRewardEvent(client, { userId, source, credits, relatedUserId }) {
  await client.query(
    `INSERT INTO reward_events (id, user_id, source, credits, related_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [newId(), userId, source, credits, relatedUserId || null]
  ).catch((err) => {
    if (err.code !== '23505') throw err;
  });
}

// ─── Users ───

export async function getOrCreateDemoUser(email = 'demo@findit.local') {
  const existing = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (existing.length) {
    await ensureInviteCode(existing[0].id);
    return (await query('SELECT * FROM users WHERE id = $1', [existing[0].id]))[0];
  }

  const id = newId();
  const rows = await query(
    'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING *',
    [id, email, email.split('@')[0]]
  );
  await ensureInviteCode(rows[0].id);
  return (await query('SELECT * FROM users WHERE id = $1', [rows[0].id]))[0];
}

export async function getOrCreateAppleUser(appleUserId, email, name) {
  const id = newId();
  const rows = await query(
    `INSERT INTO users (id, apple_user_id, email, name) VALUES ($1, $2, $3, $4)
     ON CONFLICT (apple_user_id) DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email)
     RETURNING *`,
    [id, appleUserId, email, name || 'User']
  );
  await ensureInviteCode(rows[0].id);
  return (await query('SELECT * FROM users WHERE id = $1', [rows[0].id]))[0];
}

export async function requireUser(userId) {
  if (!userId) throw Object.assign(new Error('User not found'), { status: 401 });
  const rows = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (rows.length) return rows[0];
  throw Object.assign(new Error('User not found'), { status: 401 });
}

export async function deleteUserAccount(userId) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET referred_by_user_id = NULL WHERE referred_by_user_id = $1', [userId]).catch(() => {});
    await client.query('DELETE FROM reward_events WHERE user_id = $1 OR related_user_id = $1', [userId]).catch(() => {});
    await client.query('DELETE FROM iap_transactions WHERE user_id = $1', [userId]).catch(() => {});
    await client.query('DELETE FROM usage_daily WHERE user_id = $1', [userId]).catch(() => {});
    await client.query(
      'DELETE FROM messages WHERE user_id = $1 OR conversation_id IN (SELECT id FROM conversations WHERE user_id = $1)',
      [userId]
    ).catch(() => {});
    await client.query('DELETE FROM conversations WHERE user_id = $1', [userId]).catch(() => {});
    await client.query('DELETE FROM item_records WHERE user_id = $1', [userId]).catch(() => {});
    await client.query('DELETE FROM items WHERE user_id = $1', [userId]).catch(() => {});
    await client.query('DELETE FROM media_assets WHERE user_id = $1', [userId]).catch(() => {});
    await client.query('DELETE FROM positions WHERE user_id = $1', [userId]).catch(() => {});
    await client.query('DELETE FROM spaces WHERE user_id = $1', [userId]).catch(() => {});
    const result = await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    return { success: result.rowCount > 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getUserBenefits(userId) {
  const inviteCode = await ensureInviteCode(userId);
  const rows = await query(
    `SELECT welcome_claimed_at, invite_redeemed_at, referred_by_user_id
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows.length) throw Object.assign(new Error('User not found'), { status: 401 });
  const user = rows[0];

  return {
    invite_code: inviteCode,
    rewards: {
      welcome_days: WELCOME_GIFT_DAYS,
      invite_days: INVITE_GIFT_DAYS,
      welcome_credits: WELCOME_GIFT_CREDITS,
      invite_credits: INVITE_GIFT_CREDITS
    },
    welcome: {
      claimed: Boolean(user.welcome_claimed_at),
      claimed_at: user.welcome_claimed_at || null
    },
    invite: {
      redeemed: Boolean(user.invite_redeemed_at),
      redeemed_at: user.invite_redeemed_at || null,
      referred_by_user_id: user.referred_by_user_id || null
    }
  };
}

export async function claimWelcomeBenefit(userId) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const userRows = await client.query(
      `SELECT welcome_claimed_at, subscription_expires_at, subscription_product_id
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (!userRows.rows.length) throw Object.assign(new Error('User not found'), { status: 401 });

    let granted = false;
    if (!userRows.rows[0].welcome_claimed_at) {
      const currentExpiresAt = asDate(userRows.rows[0].subscription_expires_at);
      const currentActive = Boolean(currentExpiresAt && currentExpiresAt.getTime() > Date.now());
      const nextExpiresAt = addDays(currentActive ? currentExpiresAt : new Date(), WELCOME_GIFT_DAYS);
      const nextProductId = currentActive && userRows.rows[0].subscription_product_id
        ? userRows.rows[0].subscription_product_id
        : WELCOME_TRIAL_PRODUCT_ID;

      await client.query(
        `UPDATE users
         SET welcome_claimed_at = NOW(),
             paid_credits = paid_credits + $2,
             subscription_expires_at = $3,
             subscription_product_id = $4
         WHERE id = $1`,
        [userId, WELCOME_GIFT_CREDITS, nextExpiresAt.toISOString(), nextProductId]
      );
      await insertRewardEvent(client, {
        userId,
        source: 'welcome',
        credits: WELCOME_GIFT_CREDITS
      });
      granted = true;
    }
    await client.query('COMMIT');

    return {
      granted,
      credits: await getUserCredits(userId),
      benefits: await getUserBenefits(userId)
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function redeemInviteCode(userId, inviteCodeInput) {
  const inviteCode = normalizeInviteCode(inviteCodeInput);
  if (!inviteCode) throw Object.assign(new Error('请输入邀请码'), { status: 400 });

  await ensureInviteCode(userId);

  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    const userRows = await client.query(
      `SELECT id, invite_code, invite_redeemed_at
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (!userRows.rows.length) throw Object.assign(new Error('User not found'), { status: 401 });
    const currentUser = userRows.rows[0];
    if (currentUser.invite_redeemed_at) {
      throw Object.assign(new Error('你已经兑换过邀请码'), { status: 409 });
    }
    if (currentUser.invite_code === inviteCode) {
      throw Object.assign(new Error('不能填写自己的邀请码'), { status: 400 });
    }

    const inviterRows = await client.query(
      'SELECT id FROM users WHERE invite_code = $1 FOR UPDATE',
      [inviteCode]
    );
    if (!inviterRows.rows.length) {
      throw Object.assign(new Error('邀请码不存在'), { status: 404 });
    }
    const inviter = inviterRows.rows[0];

    await client.query(
      `UPDATE users
       SET referred_by_user_id = $2,
           invite_redeemed_at = NOW(),
           free_credits = free_credits + $3
       WHERE id = $1`,
      [userId, inviter.id, INVITE_GIFT_CREDITS]
    );
    await client.query(
      'UPDATE users SET free_credits = free_credits + $2 WHERE id = $1',
      [inviter.id, INVITE_GIFT_CREDITS]
    );
    await insertRewardEvent(client, {
      userId,
      source: 'invite_redeemee',
      credits: INVITE_GIFT_CREDITS,
      relatedUserId: inviter.id
    });
    await insertRewardEvent(client, {
      userId: inviter.id,
      source: 'invite_referrer',
      credits: INVITE_GIFT_CREDITS,
      relatedUserId: userId
    });

    await client.query('COMMIT');

    return {
      credits: await getUserCredits(userId),
      benefits: await getUserBenefits(userId)
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Credits ───

export async function getUserCredits(userId) {
  const rows = await query(
    `SELECT free_credits, paid_credits, subscription_expires_at, subscription_product_id
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows.length) return formatCreditsRow(null);
  return formatCreditsRow(rows[0]);
}

export async function consumeCredit(userId) {
  // Atomic: try free first, then paid
  const freeRows = await query(
    'UPDATE users SET free_credits = free_credits - 1 WHERE id = $1 AND free_credits > 0 RETURNING id',
    [userId]
  );
  if (freeRows.length) return 'free';

  const paidRows = await query(
    `UPDATE users
     SET paid_credits = paid_credits - 1
     WHERE id = $1 AND paid_credits > 0 AND subscription_expires_at > NOW()
     RETURNING id`,
    [userId]
  );
  if (paidRows.length) return 'paid';

  throw Object.assign(new Error('免费体验已用完，请开通会员继续使用'), { status: 403 });
}

export async function refundCredit(userId, type) {
  if (type === 'free') {
    await query('UPDATE users SET free_credits = free_credits + 1 WHERE id = $1', [userId]);
  } else {
    await query('UPDATE users SET paid_credits = paid_credits + 1 WHERE id = $1', [userId]);
  }
}

export async function addCredits(userId, amount) {
  await query('UPDATE users SET paid_credits = paid_credits + $1 WHERE id = $2', [amount, userId]);
}

// ─── Daily AI Quota (abuse guard, applies to query + analyze) ───

const DAILY_AI_LIMITS = {
  query: { free: 1, member: 50 },
  analyze: { free: 1, member: 50 }
};

// 业务时区固定为北京时间：线上 DB 是 UTC，直接用 CURRENT_DATE 会导致“今日”早上 8 点才重置
const QUOTA_DAY_SQL = `(now() AT TIME ZONE 'Asia/Shanghai')::date`;

export async function consumeDailyAiQuota(userId, kind) {
  const column = kind === 'analyze' ? 'analyze_count' : 'query_count';
  const rows = await query(
    `INSERT INTO usage_daily (user_id, day, ${column}) VALUES ($1, ${QUOTA_DAY_SQL}, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET ${column} = usage_daily.${column} + 1
     RETURNING ${column} AS count`,
    [userId]
  );
  const count = Number(rows[0]?.count || 0);

  const credits = await getUserCredits(userId);
  const isMember = credits.subscription.active;
  const limits = DAILY_AI_LIMITS[kind] || DAILY_AI_LIMITS.query;
  const limit = isMember ? limits.member : limits.free;

  if (count > limit) {
    const label = kind === 'analyze' ? '识别' : '对话';
    const hint = isMember ? '请明天再试' : '请明天再试，开通会员可提高上限';
    throw Object.assign(new Error(`今日${label}次数已达上限（${limit} 次/天），${hint}`), { status: 429 });
  }
  return { count, limit };
}

export async function refundDailyAiQuota(userId, kind) {
  const column = kind === 'analyze' ? 'analyze_count' : 'query_count';
  await query(
    `UPDATE usage_daily SET ${column} = GREATEST(${column} - 1, 0)
     WHERE user_id = $1 AND day = ${QUOTA_DAY_SQL}`,
    [userId]
  );
}

async function applyAnnualSubscription(client, userId, { credits, productId, expiresAt }) {
  const amount = Number(credits || 0);
  if (!amount || amount < 0) throw Object.assign(new Error('Invalid credits amount'), { status: 400 });

  const userRows = await client.query(
    `SELECT paid_credits, subscription_expires_at
     FROM users WHERE id = $1 FOR UPDATE`,
    [userId]
  );
  if (!userRows.rows.length) throw Object.assign(new Error('User not found'), { status: 401 });

  const now = new Date();
  const current = userRows.rows[0];
  const currentExpiresAt = asDate(current.subscription_expires_at);
  const currentActive = Boolean(currentExpiresAt && currentExpiresAt.getTime() > now.getTime());
  let nextExpiresAt = asDate(expiresAt);

  if (!nextExpiresAt || nextExpiresAt.getTime() <= now.getTime()) {
    nextExpiresAt = addDays(currentActive ? currentExpiresAt : now, YEARLY_SUBSCRIPTION_DAYS);
  } else if (currentActive && nextExpiresAt.getTime() < currentExpiresAt.getTime()) {
    nextExpiresAt = currentExpiresAt;
  }

  const paidCreditsSql = currentActive ? 'paid_credits + $2' : '$2';
  const updated = await client.query(
    `UPDATE users
     SET paid_credits = ${paidCreditsSql},
         subscription_expires_at = $3,
         subscription_product_id = $4
     WHERE id = $1
     RETURNING free_credits, paid_credits, subscription_expires_at, subscription_product_id`,
    [userId, amount, nextExpiresAt.toISOString(), productId || null]
  );

  return formatCreditsRow(updated.rows[0]);
}

export async function activateAnnualSubscription(userId, purchase) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const credits = await applyAnnualSubscription(client, userId, purchase);
    await client.query('COMMIT');
    return credits;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function recordIapAnnualPurchase(userId, purchase) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO iap_transactions (
         transaction_id, original_transaction_id, user_id, product_id, credits, subscription_expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING transaction_id`,
      [
        purchase.transactionId,
        purchase.originalTransactionId || null,
        userId,
        purchase.productId,
        Number(purchase.credits || 0),
        asIso(purchase.expiresAt)
      ]
    );

    if (!inserted.rows.length) {
      await client.query('COMMIT');
      return { alreadyProcessed: true, credits: await getUserCredits(userId) };
    }

    const credits = await applyAnnualSubscription(client, userId, purchase);
    await client.query('COMMIT');
    return { alreadyProcessed: false, credits };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Spaces ───

export async function listSpaces(userId) {
  return query(`
    SELECT s.*,
      (SELECT count(*) FROM positions p WHERE p.space_id = s.id) AS position_count,
      (SELECT count(DISTINCT ir.item_id) FROM item_records ir
        JOIN positions p ON ir.position_id = p.id WHERE p.space_id = s.id) AS item_count,
      (SELECT array_agg(p.name ORDER BY p.name) FROM positions p WHERE p.space_id = s.id) AS positions,
      (SELECT COALESCE(ma.thumbnail_url, ma.blob_url)
        FROM item_records ir2
        JOIN positions p2 ON ir2.position_id = p2.id
        JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE p2.space_id = s.id
        ORDER BY CASE WHEN p2.name LIKE '%待识别%' THEN 1 ELSE 0 END, ir2.recorded_at DESC LIMIT 1) AS latest_photo_url,
      (SELECT ma.thumbnail_url
        FROM item_records ir2
        JOIN positions p2 ON ir2.position_id = p2.id
        JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE p2.space_id = s.id
        ORDER BY CASE WHEN p2.name LIKE '%待识别%' THEN 1 ELSE 0 END, ir2.recorded_at DESC LIMIT 1) AS latest_thumbnail_url,
      (SELECT ma.id
        FROM item_records ir2
        JOIN positions p2 ON ir2.position_id = p2.id
        JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE p2.space_id = s.id
        ORDER BY CASE WHEN p2.name LIKE '%待识别%' THEN 1 ELSE 0 END, ir2.recorded_at DESC LIMIT 1) AS latest_media_asset_id,
      (SELECT ma.content_type
        FROM item_records ir2
        JOIN positions p2 ON ir2.position_id = p2.id
        JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE p2.space_id = s.id
        ORDER BY CASE WHEN p2.name LIKE '%待识别%' THEN 1 ELSE 0 END, ir2.recorded_at DESC LIMIT 1) AS latest_media_content_type
    FROM spaces s WHERE s.user_id = $1 ORDER BY s.name
  `, [userId]);
}

export async function findOrCreateSpace(userId, name) {
  const existing = await query('SELECT * FROM spaces WHERE user_id = $1 AND name = $2', [userId, name]);
  if (existing.length) return existing[0];
  const id = newId();
  const rows = await query('INSERT INTO spaces (id, user_id, name) VALUES ($1, $2, $3) RETURNING *', [id, userId, name]);
  return rows[0];
}

export async function createSpace(userId, name) {
  const id = newId();
  const rows = await query('INSERT INTO spaces (id, user_id, name) VALUES ($1, $2, $3) RETURNING *', [id, userId, name]);
  return rows[0];
}

export async function updateSpace(userId, spaceId, name) {
  const rows = await query('UPDATE spaces SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *', [name, spaceId, userId]);
  return rows[0] || null;
}

export async function deleteSpace(userId, spaceId) {
  // Delete all item_records under this space's positions
  await query(`DELETE FROM item_records WHERE position_id IN (SELECT id FROM positions WHERE space_id = $1 AND user_id = $2)`, [spaceId, userId]);
  await query('DELETE FROM positions WHERE space_id = $1 AND user_id = $2', [spaceId, userId]);
  await query('DELETE FROM spaces WHERE id = $1 AND user_id = $2', [spaceId, userId]);
}

// ─── Positions ───

export async function listPositions(spaceId, userId) {
  return query(`
    SELECT p.*,
      (SELECT count(DISTINCT ir.item_id) FROM item_records ir WHERE ir.position_id = p.id) AS item_count,
      (SELECT array_agg(DISTINCT i.name) FROM item_records ir JOIN items i ON ir.item_id = i.id WHERE ir.position_id = p.id) AS item_names,
      (SELECT COALESCE(ma.thumbnail_url, ma.blob_url) FROM item_records ir2 JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE ir2.position_id = p.id ORDER BY ir2.recorded_at DESC LIMIT 1) AS latest_photo_url,
      (SELECT ma.blob_url FROM item_records ir2 JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE ir2.position_id = p.id ORDER BY ir2.recorded_at DESC LIMIT 1) AS latest_media_url,
      (SELECT ma.thumbnail_url FROM item_records ir2 JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE ir2.position_id = p.id ORDER BY ir2.recorded_at DESC LIMIT 1) AS latest_thumbnail_url,
      (SELECT ma.id FROM item_records ir2 JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE ir2.position_id = p.id ORDER BY ir2.recorded_at DESC LIMIT 1) AS latest_media_asset_id,
      (SELECT ma.content_type FROM item_records ir2 JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE ir2.position_id = p.id ORDER BY ir2.recorded_at DESC LIMIT 1) AS latest_media_content_type,
      (SELECT ir3.recorded_at FROM item_records ir3 WHERE ir3.position_id = p.id ORDER BY ir3.recorded_at DESC LIMIT 1) AS latest_recorded_at
    FROM positions p WHERE p.space_id = $1 AND p.user_id = $2 ORDER BY p.name
  `, [spaceId, userId]);
}

export async function findOrCreatePosition(spaceId, userId, name, description) {
  const existing = await query('SELECT * FROM positions WHERE space_id = $1 AND name = $2', [spaceId, name]);
  if (existing.length) return existing[0];
  const id = newId();
  const rows = await query(
    'INSERT INTO positions (id, space_id, user_id, name, description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, spaceId, userId, name, description || '']
  );
  return rows[0];
}

export async function createPosition(spaceId, userId, name) {
  const id = newId();
  const rows = await query(
    'INSERT INTO positions (id, space_id, user_id, name) VALUES ($1, $2, $3, $4) RETURNING *',
    [id, spaceId, userId, name]
  );
  return rows[0];
}

export async function updatePosition(userId, posId, name) {
  const rows = await query('UPDATE positions SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *', [name, posId, userId]);
  return rows[0] || null;
}

export async function deletePosition(userId, posId) {
  await query('DELETE FROM item_records WHERE position_id = $1 AND user_id = $2', [posId, userId]);
  await query('DELETE FROM positions WHERE id = $1 AND user_id = $2', [posId, userId]);
}

// ─── Position Detail ───

export async function getPositionDetail(posId, userId) {
  const posRows = await query('SELECT * FROM positions WHERE id = $1 AND user_id = $2', [posId, userId]);
  if (!posRows.length) return null;
  const pos = posRows[0];

  const space = (await query('SELECT * FROM spaces WHERE id = $1', [pos.space_id]))[0];

  const records = await query(`
    SELECT ir.*, i.name AS item_name, i.description AS item_description,
      ma.blob_url AS photo_url,
      ma.thumbnail_url AS thumbnail_url,
      COALESCE(ma.thumbnail_url, ma.blob_url) AS preview_url,
      ma.content_type AS media_content_type
    FROM item_records ir
    JOIN items i ON ir.item_id = i.id
    LEFT JOIN media_assets ma ON ir.media_asset_id = ma.id
    WHERE ir.position_id = $1 AND ir.user_id = $2
    ORDER BY ir.recorded_at DESC
  `, [posId, userId]);

  // dedupe by item, keep latest
  const seen = new Set();
  const items = [];
  for (const r of records) {
    if (seen.has(r.item_id)) continue;
    seen.add(r.item_id);
    items.push({
      item_id: r.item_id,
      item_name: r.item_name,
      description: r.item_description,
      note: r.note,
      recorded_at: r.recorded_at,
      photo_url: r.photo_url,
      thumbnail_url: r.thumbnail_url,
      preview_url: r.preview_url,
      media_asset_id: r.media_asset_id,
      media_content_type: r.media_content_type
    });
  }

  // Collect all distinct photos for this position
  const photoSet = new Set();
  const photos = [];
  for (const r of records) {
    if (r.photo_url && !photoSet.has(r.photo_url)) {
      photoSet.add(r.photo_url);
      photos.push({
        url: r.photo_url,
        thumbnail_url: r.thumbnail_url,
        preview_url: r.preview_url,
        media_asset_id: r.media_asset_id,
        content_type: r.media_content_type,
        recorded_at: r.recorded_at
      });
    }
  }

  return {
    position: pos, space,
    photo_url: photos[0]?.url || null,
    photos,
    items,
    total_items: items.length
  };
}

// ─── Media Assets ───

export async function createMediaAsset(id, userId, blobUrl, contentType, thumbnailUrl = null) {
  const rows = await query(
    'INSERT INTO media_assets (id, user_id, blob_url, content_type, thumbnail_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, userId, blobUrl, contentType, thumbnailUrl]
  );
  return rows[0];
}

// ─── Search (for agent tools) ───

export async function searchItems(userId, queryText) {
  const q = `%${queryText.toLowerCase()}%`;
  return query(`
    SELECT DISTINCT ON (i.id) i.name AS item_name, i.description,
      s.name || ' / ' || p.name AS location_path,
      ir.recorded_at, ir.media_asset_id
    FROM item_records ir
    JOIN items i ON ir.item_id = i.id
    JOIN positions p ON ir.position_id = p.id
    JOIN spaces s ON p.space_id = s.id
    WHERE ir.user_id = $1 AND (lower(i.name) LIKE $2 OR lower(COALESCE(i.description,'')) LIKE $2)
    ORDER BY i.id, ir.recorded_at DESC
    LIMIT 10
  `, [userId, q]);
}

export async function getSpacesList(userId) {
  const spaces = await query(`
    SELECT s.id, s.name,
      (SELECT count(*) FROM positions p WHERE p.space_id = s.id) AS position_count,
      (SELECT count(DISTINCT ir.item_id) FROM item_records ir JOIN positions p ON ir.position_id = p.id WHERE p.space_id = s.id) AS item_count
    FROM spaces s WHERE s.user_id = $1 ORDER BY s.name
  `, [userId]);
  return spaces;
}

export async function getSpaceByName(userId, spaceName) {
  const rows = await query(
    'SELECT id, name FROM spaces WHERE user_id = $1 AND name = $2',
    [userId, spaceName]
  );
  return rows[0] || null;
}

export async function getPositionsBySpaceName(userId, spaceName) {
  return query(`
    SELECT p.id, p.name, p.description,
      (SELECT count(DISTINCT ir.item_id) FROM item_records ir WHERE ir.position_id = p.id) AS item_count,
      (SELECT ir2.media_asset_id FROM item_records ir2 WHERE ir2.position_id = p.id ORDER BY ir2.recorded_at DESC LIMIT 1) AS latest_photo_id
    FROM positions p
    JOIN spaces s ON p.space_id = s.id
    WHERE s.user_id = $1 AND s.name = $2
    ORDER BY p.name
  `, [userId, spaceName]);
}

export async function getPositionItems(userId, positionId) {
  const records = await query(`
    SELECT ir.*, i.name AS item_name, i.description AS item_description
    FROM item_records ir JOIN items i ON ir.item_id = i.id
    WHERE ir.position_id = $1 AND ir.user_id = $2
    ORDER BY ir.recorded_at DESC
  `, [positionId, userId]);

  const seen = new Set();
  const items = [];
  for (const r of records) {
    if (seen.has(r.item_id)) continue;
    seen.add(r.item_id);
    items.push({ name: r.item_name, description: r.item_description, note: r.note, recorded_at: r.recorded_at, media_asset_id: r.media_asset_id });
  }

  return {
    items,
    latest_photo_id: records[0]?.media_asset_id || null
  };
}

export async function getMediaAsset(userId, mediaAssetId) {
  const rows = await query('SELECT * FROM media_assets WHERE id = $1 AND user_id = $2', [mediaAssetId, userId]);
  return rows[0] || null;
}

export async function getLatestMediaAssetForPosition(userId, positionId) {
  const rows = await query(`
    SELECT ma.*
    FROM item_records ir
    JOIN media_assets ma ON ir.media_asset_id = ma.id
    WHERE ir.user_id = $1 AND ma.user_id = $1 AND ir.position_id = $2
    ORDER BY ir.recorded_at DESC
    LIMIT 1
  `, [userId, positionId]);
  return rows[0] || null;
}

export async function getMediaAssetById(mediaAssetId) {
  const rows = await query('SELECT * FROM media_assets WHERE id = $1', [mediaAssetId]);
  return rows[0] || null;
}

// ─── Conversations & Messages ───

export async function initConversationTables() {
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_credits INTEGER DEFAULT ${DEFAULT_FREE_CREDITS}`).catch(() => {});
  await query(`ALTER TABLE users ALTER COLUMN free_credits SET DEFAULT ${DEFAULT_FREE_CREDITS}`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_credits INTEGER DEFAULT 0`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_product_id TEXT`).catch(() => {});
  await query(`UPDATE users
    SET subscription_expires_at = NOW() + INTERVAL '365 days',
        subscription_product_id = COALESCE(subscription_product_id, 'fangnale_yearly')
    WHERE paid_credits > 0 AND subscription_expires_at IS NULL`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code TEXT`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_claimed_at TIMESTAMPTZ`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id UUID REFERENCES users(id)`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_redeemed_at TIMESTAMPTZ`).catch(() => {});
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS users_invite_code_unique ON users (invite_code) WHERE invite_code IS NOT NULL`).catch(() => {});
  await query(`CREATE TABLE IF NOT EXISTS reward_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    source TEXT NOT NULL,
    credits INTEGER NOT NULL,
    related_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS reward_events_welcome_unique
    ON reward_events (user_id, source) WHERE source = 'welcome'`).catch(() => {});
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS reward_events_invite_redeemee_unique
    ON reward_events (user_id, source) WHERE source = 'invite_redeemee'`).catch(() => {});
  await query(`CREATE TABLE IF NOT EXISTS iap_transactions (
    transaction_id TEXT PRIMARY KEY,
    original_transaction_id TEXT,
    user_id UUID NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    subscription_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS iap_transactions_user_created_idx
    ON iap_transactions (user_id, created_at DESC)`).catch(() => {});
  await query(`CREATE TABLE IF NOT EXISTS usage_daily (
    user_id UUID NOT NULL REFERENCES users(id),
    day DATE NOT NULL,
    query_count INTEGER NOT NULL DEFAULT 0,
    analyze_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`).catch((err) => console.warn('usage_daily init:', err.message));
  await query(`CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id),
    last_response_id TEXT, client_day TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY, conversation_id UUID NOT NULL REFERENCES conversations(id),
    user_id UUID NOT NULL, role VARCHAR(10) NOT NULL, type VARCHAR(10) NOT NULL,
    content TEXT, blob_url TEXT, suggestion JSONB, media_asset_id UUID,
    confirmed BOOLEAN DEFAULT FALSE, source VARCHAR(20) DEFAULT 'assistant',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  // Add columns if table already exists
  await query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS client_day TEXT`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS conversations_user_client_day_updated_idx
    ON conversations (user_id, client_day, updated_at DESC) WHERE client_day IS NOT NULL`).catch(() => {});
  await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'assistant'`).catch(() => {});
  await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS steps JSONB`).catch(() => {});
  await query(`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`).catch(() => {});
  // Unique constraint on apple_user_id
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS users_apple_user_id_unique ON users (apple_user_id) WHERE apple_user_id IS NOT NULL`).catch(() => {});
}

function conversationClientDay(options) {
  const value = typeof options === 'string' ? options : options?.clientDay;
  const day = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export async function getOrCreateConversation(userId, options = {}) {
  const clientDay = conversationClientDay(options);
  if (clientDay) {
    const existing = await query(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND client_day = $2
       ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      [userId, clientDay]
    );
    if (existing.length) return existing[0];
    const id = newId();
    const rows = await query(
      'INSERT INTO conversations (id, user_id, client_day) VALUES ($1, $2, $3) RETURNING *',
      [id, userId, clientDay]
    );
    return rows[0];
  }

  const existing = await query(
    'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1', [userId]
  );
  if (existing.length) return existing[0];
  const id = newId();
  const rows = await query('INSERT INTO conversations (id, user_id) VALUES ($1, $2) RETURNING *', [id, userId]);
  return rows[0];
}

export async function createConversation(userId, options = {}) {
  const clientDay = conversationClientDay(options);
  const id = newId();
  const rows = clientDay
    ? await query(
      'INSERT INTO conversations (id, user_id, client_day) VALUES ($1, $2, $3) RETURNING *',
      [id, userId, clientDay]
    )
    : await query('INSERT INTO conversations (id, user_id) VALUES ($1, $2) RETURNING *', [id, userId]);
  return rows[0];
}

export async function getConversationMessages(conversationId, { limit = 50, source } = {}) {
  if (source) {
    return query(`
      SELECT * FROM (
        SELECT m.*, COALESCE(ma.thumbnail_url, m.blob_url) AS preview_url,
          ma.thumbnail_url, ma.content_type AS media_content_type
        FROM messages m
        LEFT JOIN media_assets ma ON m.media_asset_id = ma.id
        WHERE m.conversation_id = $1 AND m.source = $3
        ORDER BY m.created_at DESC LIMIT $2
      ) recent ORDER BY created_at ASC
    `, [conversationId, limit, source]);
  }
  return query(`
    SELECT * FROM (
      SELECT m.*, COALESCE(ma.thumbnail_url, m.blob_url) AS preview_url,
        ma.thumbnail_url, ma.content_type AS media_content_type
      FROM messages m
      LEFT JOIN media_assets ma ON m.media_asset_id = ma.id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at DESC LIMIT $2
    ) recent ORDER BY created_at ASC
  `, [conversationId, limit]);
}

export async function createMessage(conversationId, userId, { role, type, content, blobUrl, suggestion, mediaAssetId, confirmed, source, steps }) {
  const id = newId();
  const rows = await query(
    `INSERT INTO messages (id, conversation_id, user_id, role, type, content, blob_url, suggestion, media_asset_id, confirmed, source, steps)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [id, conversationId, userId, role, type, content || null, blobUrl || null,
     suggestion ? JSON.stringify(suggestion) : null, mediaAssetId || null, confirmed || false, source || 'assistant',
     steps ? JSON.stringify(steps) : null]
  );
  return rows[0];
}

export async function updateMessageConfirmed(messageId, userId) {
  await query('UPDATE messages SET confirmed = true WHERE id = $1 AND user_id = $2', [messageId, userId]);
}

export async function updateConversationResponseId(conversationId, responseId) {
  await query('UPDATE conversations SET last_response_id = $1, updated_at = NOW() WHERE id = $2', [responseId, conversationId]);
}

// ─── Update & Delete Items ───

async function findItemByNameOrId(userId, itemNameOrId) {
  const value = String(itemNameOrId || '').trim();
  if (!value) return null;

  if (isUuid(value)) {
    const byId = await query('SELECT * FROM items WHERE user_id = $1 AND id = $2', [userId, value]);
    if (byId.length) return byId[0];
  }

  const byName = await query('SELECT * FROM items WHERE user_id = $1 AND name = $2', [userId, value]);
  return byName[0] || null;
}

export async function updateItem(userId, itemNameOrId, updates) {
  const lookupName = String(itemNameOrId || '').trim();
  const item = await findItemByNameOrId(userId, lookupName);
  if (!item) return { error: `没有找到物品"${lookupName}"` };

  // Update name/description on items table
  if (updates.new_name) {
    await query('UPDATE items SET name = $1 WHERE id = $2', [updates.new_name, item.id]);
  }
  if (updates.description) {
    await query('UPDATE items SET description = $1 WHERE id = $2', [updates.description, item.id]);
  }

  // Move to new position if specified
  if (updates.space_name && updates.position_name) {
    const space = await findOrCreateSpace(userId, updates.space_name);
    const position = await findOrCreatePosition(space.id, userId, updates.position_name);
    await query(
      'UPDATE item_records SET position_id = $1 WHERE item_id = $2 AND user_id = $3',
      [position.id, item.id, userId]
    );
  }

  return { success: true, item_name: updates.new_name || item.name };
}

export async function deleteItem(userId, itemNameOrId) {
  const lookupName = String(itemNameOrId || '').trim();
  const item = await findItemByNameOrId(userId, lookupName);
  if (!item) return { error: `没有找到物品"${lookupName}"` };

  await query('DELETE FROM item_records WHERE item_id = $1 AND user_id = $2', [item.id, userId]);
  await query('DELETE FROM items WHERE id = $1 AND user_id = $2', [item.id, userId]);
  return { success: true, deleted: item.name };
}

// ─── Transactional Confirm ───

export async function confirmAndSave(userId, suggestion, mediaAssetId) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    // findOrCreateSpace
    let space;
    const existingSpace = await client.query('SELECT * FROM spaces WHERE user_id = $1 AND name = $2', [userId, suggestion.space.name]);
    if (existingSpace.rows.length) {
      space = existingSpace.rows[0];
    } else {
      const id = newId();
      const r = await client.query('INSERT INTO spaces (id, user_id, name) VALUES ($1, $2, $3) RETURNING *', [id, userId, suggestion.space.name]);
      space = r.rows[0];
    }

    // findOrCreatePosition
    let position;
    const existingPos = await client.query('SELECT * FROM positions WHERE space_id = $1 AND name = $2', [space.id, suggestion.position.name]);
    if (existingPos.rows.length) {
      position = existingPos.rows[0];
    } else {
      const id = newId();
      const r = await client.query(
        'INSERT INTO positions (id, space_id, user_id, name, description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [id, space.id, userId, suggestion.position.name, suggestion.position.description || '']
      );
      position = r.rows[0];
    }

    if (mediaAssetId) {
      await client.query('UPDATE media_assets SET position_id = $1 WHERE id = $2', [position.id, mediaAssetId]);
    }

    const allItems = suggestion.items || [];

    let savedCount = 0;
    for (const input of allItems) {
      if (input.status === 'missing') continue;
      const name = String(input.name || '').trim();
      if (!name) continue;

      let item;
      const existingItem = await client.query('SELECT * FROM items WHERE user_id = $1 AND name = $2', [userId, name]);
      if (existingItem.rows.length) {
        item = existingItem.rows[0];
        if (input.description && !item.description) {
          await client.query('UPDATE items SET description = $1 WHERE id = $2', [input.description, item.id]);
        }
      } else {
        const id = newId();
        const r = await client.query(
          'INSERT INTO items (id, user_id, name, description) VALUES ($1, $2, $3, $4) RETURNING *',
          [id, userId, name, input.description || '']
        );
        item = r.rows[0];
      }

      const recordId = newId();
      await client.query(
        'INSERT INTO item_records (id, user_id, item_id, position_id, media_asset_id, note) VALUES ($1, $2, $3, $4, $5, $6)',
        [recordId, userId, item.id, position.id, mediaAssetId || null, input.note || '']
      );
      savedCount++;
    }

    await client.query('COMMIT');
    return { space, position, saved_count: savedCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
