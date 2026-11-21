// ═══════════════════════════════════════════
// Wrappers de D1 — queries tipadas que usan los endpoints.
// Toda escritura al access_log pasa por acá para mantener formato consistente.
// ═══════════════════════════════════════════

export async function getUserByCodigo(db, codigo) {
  if (!codigo) return null;
  return db.prepare(
    'SELECT id, codigo, password_hash, nivel, activo, nombre, telefono, notas, creado_en, ultimo_acceso FROM users WHERE codigo = ?'
  ).bind(codigo).first();
}

export async function updateLastAccess(db, userId) {
  if (!userId) return;
  return db.prepare(
    'UPDATE users SET ultimo_acceso = unixepoch() WHERE id = ?'
  ).bind(userId).run();
}

export async function logAccess(db, { userId, codigo, ip, ua, accion, ok, detalle }) {
  return db.prepare(
    'INSERT INTO access_log (user_id, codigo, ip, user_agent, accion, ok, detalle) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    userId ?? null,
    codigo ?? null,
    ip ?? null,
    ua ? ua.slice(0, 500) : null,
    accion,
    ok ? 1 : 0,
    detalle ?? null
  ).run();
}

export async function countRecentFailedLogins(db, ip, sinceSeconds = 900) {
  const since = Math.floor(Date.now() / 1000) - sinceSeconds;
  const r = await db.prepare(
    'SELECT COUNT(*) as n FROM login_attempts WHERE ip = ? AND ok = 0 AND ts > ?'
  ).bind(ip, since).first();
  return r?.n ?? 0;
}

export async function recordLoginAttempt(db, ip, codigo, ok) {
  return db.prepare(
    'INSERT INTO login_attempts (ip, codigo, ok) VALUES (?, ?, ?)'
  ).bind(ip || 'unknown', codigo ?? null, ok ? 1 : 0).run();
}

export async function listUsers(db, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? 'SELECT id, codigo, nivel, activo, nombre, telefono, notas, creado_en, ultimo_acceso FROM users ORDER BY creado_en DESC'
    : 'SELECT id, codigo, nivel, activo, nombre, telefono, notas, creado_en, ultimo_acceso FROM users WHERE activo = 1 ORDER BY creado_en DESC';
  const { results } = await db.prepare(sql).all();
  return results || [];
}

export async function createUser(db, { codigo, passwordHash, nivel, nombre, telefono, notas }) {
  return db.prepare(
    'INSERT INTO users (codigo, password_hash, nivel, nombre, telefono, notas) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
  ).bind(codigo, passwordHash, nivel, nombre ?? null, telefono ?? null, notas ?? null).first();
}

export async function updateUserActivo(db, id, activo) {
  return db.prepare(
    'UPDATE users SET activo = ?, actualizado_en = unixepoch() WHERE id = ?'
  ).bind(activo ? 1 : 0, id).run();
}

export async function updateUserPassword(db, id, newHash) {
  return db.prepare(
    'UPDATE users SET password_hash = ?, actualizado_en = unixepoch() WHERE id = ?'
  ).bind(newHash, id).run();
}
