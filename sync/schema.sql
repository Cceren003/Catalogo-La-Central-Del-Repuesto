-- ═══════════════════════════════════════════
-- Schema D1 — Auth + Access Log
-- lacentraldelrepuesto.com
-- Correr contra la DB con:
--   wrangler d1 execute lcr-auth --remote --file=sync/schema.sql
-- ═══════════════════════════════════════════

-- Usuarios con acceso mayorista.
-- codigo: identificador asignado por el admin (ej. "TAL-DURAN", "DIS-MOTOS-SV-001")
-- password_hash: formato "pbkdf2$<iters>$<salt_b64>$<hash_b64>"
-- nivel: 'taller' | 'distribuidor' | 'admin'
-- activo: 0 = desactivado (no puede loguear), 1 = activo
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo          TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  nivel           TEXT    NOT NULL CHECK(nivel IN ('taller', 'distribuidor', 'admin')),
  activo          INTEGER NOT NULL DEFAULT 1,
  nombre          TEXT,
  telefono        TEXT,
  notas           TEXT,
  creado_en       INTEGER NOT NULL DEFAULT (unixepoch()),
  actualizado_en  INTEGER NOT NULL DEFAULT (unixepoch()),
  ultimo_acceso   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_codigo ON users(codigo);
CREATE INDEX IF NOT EXISTS idx_users_activo ON users(activo);

-- Log de accesos (login + fetch de mayorista + admin ops).
-- Conserva últimos 180 días; el admin puede purgar manualmente.
CREATE TABLE IF NOT EXISTS access_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  codigo     TEXT,                      -- se guarda aunque el usuario se borre
  ip         TEXT,
  user_agent TEXT,
  accion     TEXT    NOT NULL,          -- 'login', 'login_fail', 'logout', 'fetch_mayorista', 'admin_create', 'admin_revoke', 'admin_edit'
  ok         INTEGER NOT NULL DEFAULT 1,-- 1 = exitoso, 0 = fallido
  detalle    TEXT,                      -- info opcional (ej. motivo de fallo)
  ts         INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_access_log_user ON access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_access_log_ts ON access_log(ts);
CREATE INDEX IF NOT EXISTS idx_access_log_codigo ON access_log(codigo);

-- Rate limit de intentos de login por IP.
-- Se consulta en cada POST /api/auth/login: si hay 5+ fallidos en los últimos 15 min, se rechaza.
CREATE TABLE IF NOT EXISTS login_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ip       TEXT    NOT NULL,
  codigo   TEXT,
  ok       INTEGER NOT NULL DEFAULT 0,
  ts       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_ts ON login_attempts(ip, ts);

-- Cotizaciones emitidas por el servidor (H5).
-- El PDF que se genera en el cliente lleva el `numero` de esta tabla, así que
-- si un cliente trae un PDF, el admin puede buscarlo por número y confirmar
-- qué precios resolvió el servidor (no los del PDF).
-- items_json guarda el array completo de items resueltos:
--   [{sku, nombre, marca, qty, precio_unit, subtotal}]
CREATE TABLE IF NOT EXISTS cotizaciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  numero          TEXT    NOT NULL UNIQUE,  -- ej. 261121-ABCD
  session_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  session_codigo  TEXT,                     -- NULL si fue guest (sin login)
  session_nivel   TEXT    NOT NULL,         -- 'publico' | 'taller' | 'distribuidor' | 'admin'
  cliente_nombre  TEXT    NOT NULL,
  cliente_tel     TEXT,
  cliente_email   TEXT,
  cliente_tipo    TEXT    NOT NULL,         -- 'Consumidor Final' | 'Crédito Fiscal'
  cliente_nit     TEXT,
  cliente_nrc     TEXT,
  cliente_giro    TEXT,
  cliente_dir     TEXT,
  notas           TEXT,
  items_json      TEXT    NOT NULL,         -- JSON array resuelto por el server
  subtotal_sin_iva REAL   NOT NULL,
  iva             REAL    NOT NULL,
  total_con_iva   REAL    NOT NULL,
  ip              TEXT,
  user_agent      TEXT,
  ts              INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_numero       ON cotizaciones(numero);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_ts           ON cotizaciones(ts);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente_nom  ON cotizaciones(cliente_nombre);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_session_cod  ON cotizaciones(session_codigo);
