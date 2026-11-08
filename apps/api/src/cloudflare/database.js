import { cloudflareEnv } from './runtime.js';
export function statement(sql, values = []) {
  const env = cloudflareEnv();
  if (!env?.DB) throw new Error('D1 binding unavailable');
  const bound = [];
  const converted = sql
    .replace(/\(now\(\) AT TIME ZONE 'Asia\/Shanghai'\)::date/gi, "date('now','+8 hours')")
    .replace(/\bnow\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    .replace(/array_agg\(p\.name ORDER BY p\.name\)/gi, 'json_group_array(p.name)')
    .replace(/array_agg\(DISTINCT i\.name\)/gi, 'json_group_array(DISTINCT i.name)')
    .replace(/\bGREATEST\(/gi, 'MAX(')
    .replace(/\$(\d+)/g, (_, n) => { const v = values[Number(n)-1]; bound.push(v === undefined ? null : typeof v === 'boolean' ? Number(v) : v instanceof Date ? v.toISOString() : v && typeof v === 'object' ? JSON.stringify(v) : v); return '?'; });
  return env.DB.prepare(converted).bind(...bound);
}
function normalize(row) {
  for (const key of ['positions','item_names','suggestion','steps']) {
    if (typeof row[key] === 'string') { try { row[key] = JSON.parse(row[key]); } catch {} }
  }
  if (row.confirmed !== undefined) row.confirmed = Boolean(row.confirmed);
  if (Array.isArray(row.positions)) row.positions.sort();
  return row;
}
export async function d1Query(sql, values) {
  try {
    const result = await statement(sql, values).all();
    return result.results.map(normalize);
  } catch (error) {
    if (/UNIQUE constraint/.test(error.message)) error.code = '23505';
    throw error;
  }
}
export async function batch(queries) {
  return cloudflareEnv().DB.batch(queries.map(([sql, values]) => statement(sql, values)));
}
export const dateNow = () => new Date().toISOString();
