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

export async function getOrCreateAppleUser(appleUserId, email, name) {
  const existing = await query('SELECT * FROM users WHERE apple_user_id = $1', [appleUserId]);
  if (existing.length) return existing[0];

  const id = newId();
  const rows = await query(
    'INSERT INTO users (id, apple_user_id, email, name) VALUES ($1, $2, $3, $4) RETURNING *',
    [id, appleUserId, email, name || 'User']
  );
  return rows[0];
}

export async function requireUser(userId) {
  if (!userId) throw Object.assign(new Error('User not found'), { status: 401 });
  const rows = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (rows.length) return rows[0];
  throw Object.assign(new Error('User not found'), { status: 401 });
}

// ─── Credits ───

export async function getUserCredits(userId) {
  const rows = await query('SELECT free_credits, paid_credits FROM users WHERE id = $1', [userId]);
  if (!rows.length) return { free: 0, paid: 0, total: 0 };
  const { free_credits, paid_credits } = rows[0];
  return { free: free_credits, paid: paid_credits, total: free_credits + paid_credits };
}

export async function consumeCredit(userId) {
  // Atomic: try free first, then paid
  const freeRows = await query(
    'UPDATE users SET free_credits = free_credits - 1 WHERE id = $1 AND free_credits > 0 RETURNING id',
    [userId]
  );
  if (freeRows.length) return 'free';

  const paidRows = await query(
    'UPDATE users SET paid_credits = paid_credits - 1 WHERE id = $1 AND paid_credits > 0 RETURNING id',
    [userId]
  );
  if (paidRows.length) return 'paid';

  throw Object.assign(new Error('识别次数已用完，请购买年卡继续使用'), { status: 403 });
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
      (SELECT count(DISTINCT ir.item_id) FROM item_records ir WHERE ir.position_id = p.id) AS item_count,
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

  // Collect all distinct photos for this position
  const photoSet = new Set();
  const photos = [];
  for (const r of records) {
    if (r.photo_url && !photoSet.has(r.photo_url)) {
      photoSet.add(r.photo_url);
      photos.push({ url: r.photo_url, recorded_at: r.recorded_at });
    }
  }

  return {
    position: pos, space,
    photo_url: photos[0]?.url || null,
    photos,
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

// ─── Conversations & Messages ───

export async function initConversationTables() {
  await query(`CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id),
    last_response_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY, conversation_id UUID NOT NULL REFERENCES conversations(id),
    user_id UUID NOT NULL, role VARCHAR(10) NOT NULL, type VARCHAR(10) NOT NULL,
    content TEXT, blob_url TEXT, suggestion JSONB, media_asset_id UUID,
    confirmed BOOLEAN DEFAULT FALSE, source VARCHAR(20) DEFAULT 'assistant',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  // Add source column if table already exists
  await query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'assistant'`).catch(() => {});
}

export async function getOrCreateConversation(userId) {
  const existing = await query(
    'SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1', [userId]
  );
  if (existing.length) return existing[0];
  const id = newId();
  const rows = await query('INSERT INTO conversations (id, user_id) VALUES ($1, $2) RETURNING *', [id, userId]);
  return rows[0];
}

export async function createConversation(userId) {
  const id = newId();
  const rows = await query('INSERT INTO conversations (id, user_id) VALUES ($1, $2) RETURNING *', [id, userId]);
  return rows[0];
}

export async function getConversationMessages(conversationId, { limit = 50, source } = {}) {
  if (source) {
    return query(`
      SELECT * FROM (
        SELECT * FROM messages WHERE conversation_id = $1 AND source = $3 ORDER BY created_at DESC LIMIT $2
      ) recent ORDER BY created_at ASC
    `, [conversationId, limit, source]);
  }
  return query(`
    SELECT * FROM (
      SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2
    ) recent ORDER BY created_at ASC
  `, [conversationId, limit]);
}

export async function createMessage(conversationId, userId, { role, type, content, blobUrl, suggestion, mediaAssetId, confirmed, source }) {
  const id = newId();
  const rows = await query(
    `INSERT INTO messages (id, conversation_id, user_id, role, type, content, blob_url, suggestion, media_asset_id, confirmed, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [id, conversationId, userId, role, type, content || null, blobUrl || null,
     suggestion ? JSON.stringify(suggestion) : null, mediaAssetId || null, confirmed || false, source || 'assistant']
  );
  return rows[0];
}

export async function updateMessageConfirmed(messageId, userId) {
  await query('UPDATE messages SET confirmed = true WHERE id = $1 AND user_id = $2', [messageId, userId]);
}

export async function updateMessageSuggestion(messageId, suggestion) {
  await query('UPDATE messages SET suggestion = $1 WHERE id = $2', [JSON.stringify(suggestion), messageId]);
}

export async function updateConversationResponseId(conversationId, responseId) {
  await query('UPDATE conversations SET last_response_id = $1, updated_at = NOW() WHERE id = $2', [responseId, conversationId]);
}

// ─── Update & Delete Items ───

export async function updateItem(userId, itemName, updates) {
  // Find the item
  const items = await query('SELECT * FROM items WHERE user_id = $1 AND name = $2', [userId, itemName]);
  if (!items.length) return { error: `没有找到物品"${itemName}"` };
  const item = items[0];

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
      'UPDATE item_records SET position_id = $1, container = $2 WHERE item_id = $3 AND user_id = $4',
      [position.id, updates.container || null, item.id, userId]
    );
  } else if (updates.container !== undefined) {
    // Just update container within same position
    await query(
      'UPDATE item_records SET container = $1 WHERE item_id = $2 AND user_id = $3',
      [updates.container || null, item.id, userId]
    );
  }

  return { success: true, item_name: updates.new_name || itemName };
}

export async function deleteItem(userId, itemName) {
  const items = await query('SELECT * FROM items WHERE user_id = $1 AND name = $2', [userId, itemName]);
  if (!items.length) return { error: `没有找到物品"${itemName}"` };
  const item = items[0];

  await query('DELETE FROM item_records WHERE item_id = $1 AND user_id = $2', [item.id, userId]);
  await query('DELETE FROM items WHERE id = $1 AND user_id = $2', [item.id, userId]);
  return { success: true, deleted: itemName };
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

    const allItems = [
      ...(suggestion.containers || []).flatMap((c) => c.items.map((i) => ({ ...i, container: c.name }))),
      ...(suggestion.loose_items || []).map((i) => ({ ...i, container: null }))
    ];

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
        'INSERT INTO item_records (id, user_id, item_id, position_id, media_asset_id, container, note) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [recordId, userId, item.id, position.id, mediaAssetId || null, input.container || null, input.note || '']
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
