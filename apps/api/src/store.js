import pg from 'pg';
import { randomUUID } from 'node:crypto';

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

// ─── Users ───

export async function getOrCreateDemoUser(email = 'demo@findit.local') {
  const existing = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (existing.length) return existing[0];

  const id = newId();
  const rows = await query(
    'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING *',
    [id, email, email.split('@')[0]]
  );
  return rows[0];
}

export async function requireUser(userId) {
  if (!userId) throw Object.assign(new Error('User not found'), { status: 401 });
  const rows = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (rows.length) return rows[0];
  // fallback to first user
  const fallback = await query('SELECT * FROM users LIMIT 1');
  if (fallback.length) return fallback[0];
  throw Object.assign(new Error('User not found'), { status: 401 });
}

// ─── Spaces ───

export async function listSpaces(userId) {
  return query(`
    SELECT s.*,
      (SELECT count(*) FROM positions p WHERE p.space_id = s.id) AS position_count,
      (SELECT count(DISTINCT ir.item_id) FROM item_records ir
        JOIN positions p ON ir.position_id = p.id WHERE p.space_id = s.id) AS item_count,
      (SELECT array_agg(p.name ORDER BY p.name) FROM positions p WHERE p.space_id = s.id) AS positions
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

// ─── Positions ───

export async function listPositions(spaceId, userId) {
  return query(`
    SELECT p.*,
      (SELECT count(*) FROM item_records ir WHERE ir.position_id = p.id) AS item_count,
      (SELECT array_agg(DISTINCT i.name) FROM item_records ir JOIN items i ON ir.item_id = i.id WHERE ir.position_id = p.id) AS item_names,
      (SELECT ma.blob_url FROM item_records ir2 JOIN media_assets ma ON ir2.media_asset_id = ma.id
        WHERE ir2.position_id = p.id ORDER BY ir2.recorded_at DESC LIMIT 1) AS latest_photo_url,
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

// ─── Position Detail ───

export async function getPositionDetail(posId, userId) {
  const posRows = await query('SELECT * FROM positions WHERE id = $1 AND user_id = $2', [posId, userId]);
  if (!posRows.length) return null;
  const pos = posRows[0];

  const space = (await query('SELECT * FROM spaces WHERE id = $1', [pos.space_id]))[0];

  const records = await query(`
    SELECT ir.*, i.name AS item_name, i.description AS item_description, ma.blob_url AS photo_url
    FROM item_records ir
    JOIN items i ON ir.item_id = i.id
    LEFT JOIN media_assets ma ON ir.media_asset_id = ma.id
    WHERE ir.position_id = $1 AND ir.user_id = $2
    ORDER BY ir.recorded_at DESC
  `, [posId, userId]);

  // dedupe by item, keep latest
  const seen = new Set();
  const unique = [];
  for (const r of records) {
    if (seen.has(r.item_id)) continue;
    seen.add(r.item_id);
    unique.push(r);
  }

  const grouped = {};
  const loose = [];
  for (const r of unique) {
    const item = { item_id: r.item_id, item_name: r.item_name, description: r.item_description, container: r.container, note: r.note, recorded_at: r.recorded_at, photo_url: r.photo_url };
    if (r.container) {
      if (!grouped[r.container]) grouped[r.container] = [];
      grouped[r.container].push(item);
    } else {
      loose.push(item);
    }
  }

  const latestPhoto = records[0]?.photo_url || null;

  return {
    position: pos, space,
    photo_url: latestPhoto,
    containers: Object.entries(grouped).map(([name, items]) => ({ name, items })),
    loose_items: loose,
    total_items: unique.length
  };
}

// ─── Media Assets ───

export async function createMediaAsset(id, userId, blobUrl, contentType) {
  const rows = await query(
    'INSERT INTO media_assets (id, user_id, blob_url, content_type) VALUES ($1, $2, $3, $4) RETURNING *',
    [id, userId, blobUrl, contentType]
  );
  return rows[0];
}

export async function updateMediaAssetPosition(mediaId, positionId) {
  await query('UPDATE media_assets SET position_id = $1 WHERE id = $2', [positionId, mediaId]);
}

// ─── Items ───

export async function findOrCreateItem(userId, name, description) {
  const existing = await query('SELECT * FROM items WHERE user_id = $1 AND name = $2', [userId, name]);
  if (existing.length) {
    if (description && !existing[0].description) {
      await query('UPDATE items SET description = $1 WHERE id = $2', [description, existing[0].id]);
    }
    return existing[0];
  }
  const id = newId();
  const rows = await query(
    'INSERT INTO items (id, user_id, name, description) VALUES ($1, $2, $3, $4) RETURNING *',
    [id, userId, name, description || '']
  );
  return rows[0];
}

// ─── Item Records ───

export async function createItemRecord(userId, itemId, positionId, mediaAssetId, container, note) {
  const id = newId();
  const rows = await query(
    'INSERT INTO item_records (id, user_id, item_id, position_id, media_asset_id, container, note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [id, userId, itemId, positionId, mediaAssetId || null, container || null, note || '']
  );
  return rows[0];
}

// ─── Search (for agent tools) ───

export async function searchItems(userId, queryText) {
  const q = `%${queryText.toLowerCase()}%`;
  return query(`
    SELECT DISTINCT ON (i.id) i.name AS item_name, i.description,
      s.name || ' / ' || p.name AS location_path,
      ir.container, ir.recorded_at, ir.media_asset_id
    FROM item_records ir
    JOIN items i ON ir.item_id = i.id
    JOIN positions p ON ir.position_id = p.id
    JOIN spaces s ON p.space_id = s.id
    WHERE ir.user_id = $1 AND lower(i.name) LIKE $2
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

export async function getPositionsBySpaceName(userId, spaceName) {
  return query(`
    SELECT p.id, p.name, p.description,
      (SELECT count(*) FROM item_records ir WHERE ir.position_id = p.id) AS item_count,
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
  const unique = [];
  for (const r of records) {
    if (seen.has(r.item_id)) continue;
    seen.add(r.item_id);
    unique.push({ name: r.item_name, description: r.item_description, container: r.container, note: r.note, recorded_at: r.recorded_at, media_asset_id: r.media_asset_id });
  }

  const grouped = {};
  const loose = [];
  for (const item of unique) {
    if (item.container) {
      if (!grouped[item.container]) grouped[item.container] = [];
      grouped[item.container].push(item);
    } else {
      loose.push(item);
    }
  }

  return {
    containers: Object.entries(grouped).map(([name, items]) => ({ name, items })),
    loose_items: loose,
    latest_photo_id: records[0]?.media_asset_id || null
  };
}

export async function getMediaAsset(userId, mediaAssetId) {
  const rows = await query('SELECT * FROM media_assets WHERE id = $1 AND user_id = $2', [mediaAssetId, userId]);
  return rows[0] || null;
}

export function formatLocationPath(spaceName, positionName) {
  return [spaceName, positionName].filter(Boolean).join(' / ');
}
