#!/usr/bin/env node
// ═══════════════════════════════════════════
// CLI para administrar usuarios mayoristas.
// Corre contra D1 usando `wrangler d1 execute` (requiere wrangler login).
//
// Uso:
//   node sync/admin.js list
//   node sync/admin.js create TAL-DURAN taller "Duran Motos" 70301941
//   node sync/admin.js revoke TAL-DURAN
//   node sync/admin.js activate TAL-DURAN
//   node sync/admin.js reset-password TAL-DURAN
//   node sync/admin.js show TAL-DURAN
//   node sync/admin.js log           (últimas 50 acciones)
//   node sync/admin.js log TAL-DURAN (del usuario)
//
// Variables:
//   DB_NAME (default: 'lcr-auth')
//   LOCAL=1 para correr contra DB local en vez de --remote
// ═══════════════════════════════════════════

const { execSync } = require('child_process');
const { randomBytes, createHash } = require('crypto');
const readline = require('readline');

const DB_NAME = process.env.DB_NAME || 'lcr-auth';
const REMOTE = process.env.LOCAL ? '' : '--remote';

function run(sql) {
  const cmd = `wrangler d1 execute ${DB_NAME} ${REMOTE} --json --command=${JSON.stringify(sql)}`;
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    const parsed = JSON.parse(out);
    return parsed[0]?.results || [];
  } catch (e) {
    console.error('✗ Error ejecutando wrangler d1:');
    console.error(e.stderr?.toString() || e.message);
    process.exit(1);
  }
}

function esc(s) {
  if (s == null) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// ─── PBKDF2 hash (mismo formato que functions/_lib/password.js) ────────
// Node NO usa Web Crypto por default: usamos node:crypto con pbkdf2Sync.
async function hashPassword(password) {
  if (!password || password.length < 8) throw new Error('password muy corta');
  const ITERS = 210000;
  const SALT_LEN = 16;
  const HASH_LEN = 32;
  const { pbkdf2Sync } = require('crypto');
  const salt = randomBytes(SALT_LEN);
  const key = pbkdf2Sync(password, salt, ITERS, HASH_LEN, 'sha256');
  return `pbkdf2$${ITERS}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function genRandomPassword() {
  // Lee 15 bytes y los pasa a base32 sin ambigüedad (sin 0/O/1/I).
  const b = randomBytes(15);
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const byte of b) s += abc[byte % abc.length];
  return s.slice(0, 12).match(/.{1,4}/g).join('-'); // ej. "K3PX-9MVT-7HJQ"
}

function promptPassword(label = 'Contraseña: ') {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(label, answer => { rl.close(); resolve(answer); });
  });
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ═══════════════════════════════════════════
// COMANDOS
// ═══════════════════════════════════════════

const CMD = process.argv[2];
const ARGS = process.argv.slice(3);

async function cmdList() {
  const rows = run('SELECT id, codigo, nivel, activo, nombre, telefono, creado_en, ultimo_acceso FROM users ORDER BY creado_en DESC');
  if (rows.length === 0) {
    console.log('(sin usuarios registrados — usá `admin.js create` para dar de alta)');
    return;
  }
  console.log(`\n${rows.length} usuario(s):\n`);
  for (const u of rows) {
    const estado = u.activo ? '✓ ACTIVO' : '✗ DESACTIVADO';
    console.log(`  ${u.codigo.padEnd(20)} [${u.nivel.padEnd(12)}] ${estado}`);
    if (u.nombre)    console.log(`    nombre:  ${u.nombre}`);
    if (u.telefono)  console.log(`    tel:     ${u.telefono}`);
    console.log(`    creado:  ${fmtTs(u.creado_en)}`);
    console.log(`    último:  ${fmtTs(u.ultimo_acceso)}`);
    console.log('');
  }
}

async function cmdCreate() {
  const [codigo, nivel, nombre, telefono, notas] = ARGS;
  if (!codigo || !nivel) {
    console.error('Uso: admin.js create <CODIGO> <nivel> [nombre] [telefono] [notas]');
    console.error('  nivel: taller | distribuidor | admin');
    process.exit(1);
  }
  if (!['taller', 'distribuidor', 'admin'].includes(nivel)) {
    console.error(`Nivel inválido: "${nivel}". Debe ser taller, distribuidor o admin.`);
    process.exit(1);
  }
  const codigoUp = codigo.toUpperCase();
  const existing = run(`SELECT id FROM users WHERE codigo = ${esc(codigoUp)}`);
  if (existing.length > 0) {
    console.error(`✗ El código "${codigoUp}" ya existe. Usá otro o 'reset-password' para cambiarle la contraseña.`);
    process.exit(1);
  }
  const password = genRandomPassword();
  const hash = await hashPassword(password);
  run(
    `INSERT INTO users (codigo, password_hash, nivel, nombre, telefono, notas) VALUES (` +
    `${esc(codigoUp)}, ${esc(hash)}, ${esc(nivel)}, ${esc(nombre)}, ${esc(telefono)}, ${esc(notas)})`
  );
  console.log('');
  console.log(`✓ Usuario creado:`);
  console.log(`  Código:     ${codigoUp}`);
  console.log(`  Nivel:      ${nivel}`);
  console.log(`  Contraseña: ${password}`);
  console.log('');
  console.log(`⚠ GUARDÁ ESTA CONTRASEÑA AHORA — no se puede recuperar.`);
  console.log(`  Si se pierde: usá \`admin.js reset-password ${codigoUp}\` para generar una nueva.`);
  console.log('');
  console.log(`Mensaje sugerido para el cliente por WhatsApp:`);
  console.log(`  Tu acceso al sitio mayorista:`);
  console.log(`  https://lacentraldelrepuesto.com`);
  console.log(`  Código: ${codigoUp}`);
  console.log(`  Contraseña: ${password}`);
  console.log('');
}

async function cmdRevoke() {
  const [codigo] = ARGS;
  if (!codigo) { console.error('Uso: admin.js revoke <CODIGO>'); process.exit(1); }
  const codigoUp = codigo.toUpperCase();
  run(`UPDATE users SET activo = 0, actualizado_en = unixepoch() WHERE codigo = ${esc(codigoUp)}`);
  console.log(`✓ ${codigoUp} desactivado. No podrá loguear hasta ejecutar \`admin.js activate ${codigoUp}\`.`);
}

async function cmdActivate() {
  const [codigo] = ARGS;
  if (!codigo) { console.error('Uso: admin.js activate <CODIGO>'); process.exit(1); }
  const codigoUp = codigo.toUpperCase();
  run(`UPDATE users SET activo = 1, actualizado_en = unixepoch() WHERE codigo = ${esc(codigoUp)}`);
  console.log(`✓ ${codigoUp} reactivado.`);
}

async function cmdResetPassword() {
  const [codigo] = ARGS;
  if (!codigo) { console.error('Uso: admin.js reset-password <CODIGO>'); process.exit(1); }
  const codigoUp = codigo.toUpperCase();
  const existing = run(`SELECT id, nivel FROM users WHERE codigo = ${esc(codigoUp)}`);
  if (existing.length === 0) { console.error(`✗ ${codigoUp} no existe`); process.exit(1); }
  const password = genRandomPassword();
  const hash = await hashPassword(password);
  run(`UPDATE users SET password_hash = ${esc(hash)}, actualizado_en = unixepoch() WHERE codigo = ${esc(codigoUp)}`);
  console.log('');
  console.log(`✓ Password reseteada para ${codigoUp}`);
  console.log(`  Nueva contraseña: ${password}`);
  console.log('');
  console.log(`  Mandale al cliente este mensaje:`);
  console.log(`    Tu nueva contraseña del sitio mayorista:`);
  console.log(`    Código: ${codigoUp}`);
  console.log(`    Contraseña: ${password}`);
  console.log('');
}

async function cmdShow() {
  const [codigo] = ARGS;
  if (!codigo) { console.error('Uso: admin.js show <CODIGO>'); process.exit(1); }
  const codigoUp = codigo.toUpperCase();
  const rows = run(`SELECT id, codigo, nivel, activo, nombre, telefono, notas, creado_en, actualizado_en, ultimo_acceso FROM users WHERE codigo = ${esc(codigoUp)}`);
  if (rows.length === 0) { console.error(`✗ ${codigoUp} no existe`); process.exit(1); }
  const u = rows[0];
  console.log('');
  console.log(`  Código:         ${u.codigo}`);
  console.log(`  Nivel:          ${u.nivel}`);
  console.log(`  Estado:         ${u.activo ? 'ACTIVO' : 'DESACTIVADO'}`);
  console.log(`  Nombre:         ${u.nombre || '—'}`);
  console.log(`  Teléfono:       ${u.telefono || '—'}`);
  console.log(`  Notas:          ${u.notas || '—'}`);
  console.log(`  Creado:         ${fmtTs(u.creado_en)}`);
  console.log(`  Actualizado:    ${fmtTs(u.actualizado_en)}`);
  console.log(`  Último acceso:  ${fmtTs(u.ultimo_acceso)}`);
  console.log('');
}

async function cmdLog() {
  const [codigo] = ARGS;
  const limit = 50;
  const where = codigo ? `WHERE codigo = ${esc(codigo.toUpperCase())}` : '';
  const rows = run(`SELECT codigo, ip, accion, ok, detalle, ts FROM access_log ${where} ORDER BY ts DESC LIMIT ${limit}`);
  if (rows.length === 0) { console.log('(sin registros)'); return; }
  console.log('');
  for (const l of rows) {
    const ok = l.ok ? '✓' : '✗';
    console.log(`  ${fmtTs(l.ts)}  ${ok} ${l.accion.padEnd(16)} ${(l.codigo||'').padEnd(20)} ${l.ip || ''} ${l.detalle ? '· ' + l.detalle : ''}`);
  }
  console.log('');
}

async function cmdHelp() {
  console.log(`
Admin CLI para usuarios mayoristas (D1: ${DB_NAME})

  list                                  Listar todos los usuarios
  create <CODIGO> <nivel> [nombre] [tel] [notas]
                                        Crear usuario con contraseña random
                                        (nivel = taller|distribuidor|admin)
  revoke <CODIGO>                       Desactivar (bloquea login)
  activate <CODIGO>                     Reactivar
  reset-password <CODIGO>               Nueva contraseña aleatoria
  show <CODIGO>                         Ver detalle
  log [CODIGO]                          Access log (últimos 50)

Variables:
  DB_NAME                               Nombre de la DB (default: lcr-auth)
  LOCAL=1                               Usar DB local (dev) en vez de --remote
`);
}

(async () => {
  switch (CMD) {
    case 'list':           await cmdList(); break;
    case 'create':         await cmdCreate(); break;
    case 'revoke':         await cmdRevoke(); break;
    case 'activate':       await cmdActivate(); break;
    case 'reset-password': await cmdResetPassword(); break;
    case 'show':           await cmdShow(); break;
    case 'log':            await cmdLog(); break;
    default:               await cmdHelp();
  }
})().catch(e => { console.error(e); process.exit(1); });
