#!/usr/bin/env node
// sync/publish-all.js
// Un solo comando para actualizar TODO:
//   1. (Opcional) Sync inventario LCR  — solo con --full
//   2. Reindex de imágenes (imagenes/ → catalogo.json)
//   3. Build enriquecidos (Excel → data/enriquecidos.json)
//   4. git add + commit + push de lo que cambió
//
// Uso:
//   node sync/publish-all.js                 # imágenes + enriquecidos (recomendado)
//   node sync/publish-all.js --proveedores   # actualiza proveedores (VINI/NRP/MEK/AXUS) SIN LCR
//   node sync/publish-all.js --full          # LCR + proveedores + imágenes + enriquecidos (requiere credenciales)
//   node sync/publish-all.js --dry-run       # muestra qué haría sin commitear
//   node sync/publish-all.js --no-push       # commit local, sin push

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FULL         = process.argv.includes('--full') || process.argv.includes('--sync');
const PROVEEDORES  = process.argv.includes('--proveedores') && !FULL;
const NO_PUSH      = process.argv.includes('--no-push');
const DRY_RUN      = process.argv.includes('--dry-run');

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}
function capture(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }).trim();
}
function safeCapture(cmd) { try { return capture(cmd); } catch { return ''; } }
function section(label) {
  const bar = '═'.repeat(60);
  console.log(`\n${bar}\n  ${label}\n${bar}`);
}

const flags = [DRY_RUN && 'DRY RUN', NO_PUSH && '--no-push', FULL && '--full', PROVEEDORES && '--proveedores']
  .filter(Boolean).join(' · ');
console.log(`Publish-all${flags ? '  (' + flags + ')' : ''}`);

const branch = capture('git rev-parse --abbrev-ref HEAD');
console.log(`→ Branch: ${branch}`);

let steps = 0;
const total = (FULL || PROVEEDORES) ? 3 : 2;

// ═══ 1. Sync LCR o solo proveedores (opcional) ═══════════════════
if (FULL || PROVEEDORES) {
  const label = FULL ? 'Sync inventario LCR + proveedores' : 'Sync solo proveedores (sin LCR)';
  section(`${++steps}/${total}  ${label}`);
  const syncCmd = `node "${path.join(__dirname, 'sync.js')}"${PROVEEDORES ? ' --sin-lcr' : ''}`;
  try {
    run(syncCmd);
  } catch (e) {
    console.error('\n✗ Falló el sync.');
    if (FULL) {
      console.error('  Causas comunes de --full:');
      console.error('    - No hay config.json ni env vars LCR_USER/LCR_PASS');
      console.error('    - Credenciales incorrectas');
      console.error('    - Red / servidor LCR caído');
      console.error('\n  Si no tenés credenciales LCR, usá:  npm run publish-all -- --proveedores');
    } else {
      console.error('  Revisá que catalogos-proveedores/ tenga los archivos correctos.');
    }
    process.exit(1);
  }
}

// ═══ 2. Reindex de imágenes ═══════════════════════════════════════
section(`${++steps}/${total}  Reindex de imágenes`);
run(`node "${path.join(__dirname, 'reindex-imagenes.js')}"`);

// ═══ 3. Build enriquecidos ════════════════════════════════════════
section(`${++steps}/${total}  Build enriquecidos (Excel → JSON)`);
const xlsxPath = path.join(__dirname, 'enriquecidos.xlsx');
if (fs.existsSync(xlsxPath)) {
  run(`node "${path.join(__dirname, 'build-enriquecidos.js')}"`);
} else {
  console.log(`ℹ No existe ${xlsxPath} — se omite este paso`);
  console.log('  (copiá enriquecidos-template.xlsx → enriquecidos.xlsx cuando lo necesites)');
}

// ═══ Estado git después de los 3 pasos ══════════════════════════
section('Cambios detectados');
const status = safeCapture('git status --porcelain');
if (!status) {
  console.log('✓ Nada cambió — no hay nada que publicar.');
  process.exit(0);
}
console.log(status);

// ═══ Staging y commit ═════════════════════════════════════════════
// Agregamos solo paths conocidos para evitar stagear archivos extraños.
const pathsToStage = [
  'catalogo.json',
  'data/enriquecidos.json',
  'imagenes',  // git add de directorio trackea cambios + nuevos
];
for (const p of pathsToStage) {
  try { execSync(`git add "${p}"`, { cwd: ROOT, stdio: 'pipe' }); } catch {}
}

const staged = safeCapture('git diff --cached --name-only');
if (!staged) {
  console.log('\n✓ Hubo cambios pero ninguno en paths trackeados. Nada que commitear.');
  process.exit(0);
}

// Resumen para el commit message
const stagedList = staged.split('\n').filter(Boolean);
const summary = [];
if (stagedList.includes('catalogo.json'))           summary.push('catálogo');
if (stagedList.some(f => f.startsWith('imagenes/'))) summary.push('imágenes');
if (stagedList.includes('data/enriquecidos.json'))  summary.push('enriquecidos');

const resumen = summary.join(' + ') || 'datos';
const includes = FULL ? ' (+ sync LCR)' : '';

if (DRY_RUN) {
  console.log('\n' + '─'.repeat(60));
  console.log(`DRY RUN — se commitearía: chore(publish): ${resumen}${includes}`);
  console.log('Paths:');
  stagedList.forEach(f => console.log('  · ' + f));
  console.log('\nNo se ejecuta commit/push por --dry-run');
  // Des-stagea para dejar la worktree como estaba
  execSync('git reset HEAD', { cwd: ROOT, stdio: 'pipe' });
  process.exit(0);
}

const user  = process.env.GIT_USER_NAME  || 'Cceren003';
const email = process.env.GIT_USER_EMAIL || 'cgceren10@gmail.com';
const msg = [
  `chore(publish): ${resumen}${includes}`,
  '',
  'Regenerado con sync/publish-all.js.',
  '',
  'Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>',
].join('\n');

try {
  execSync(
    `git -c user.name="${user}" -c user.email="${email}" commit -m "${msg.replace(/"/g, '\\"')}"`,
    { cwd: ROOT, stdio: 'pipe' }
  );
  const sha = capture('git rev-parse --short HEAD');
  console.log(`\n✓ Commit ${sha}: chore(publish): ${resumen}${includes}`);
} catch (e) {
  console.error('\n✗ Error al commitear:', e.stderr?.toString() || e.message);
  process.exit(1);
}

// ═══ Push ═════════════════════════════════════════════════════════
if (NO_PUSH) {
  console.log('\n⚠ --no-push activo — el commit está local.');
  console.log('   Para publicar:  git push');
  process.exit(0);
}

section(`Push a origin/${branch}`);

function tryPush() {
  execSync(`git push origin ${branch}`, { cwd: ROOT, stdio: 'inherit' });
}

// Si el cron automático commitea entre medio, el push falla por
// non-fast-forward. Rebase con -X theirs: en conflictos, NUESTRA versión
// gana (acabamos de regenerar catalogo.json/enriquecidos.json con los
// datos más frescos). Archivos que el cron tocó pero nosotros no (ej.
// otros archivos) se preservan sin cambio.
function rebaseAndRetry() {
  console.log('\n⚠ Push rechazado — intentando rebase automático con nuestros cambios...\n');
  try {
    execSync(`git fetch origin ${branch}`, { cwd: ROOT, stdio: 'inherit' });
    execSync(
      `git -c user.name="${user}" -c user.email="${email}" rebase -X theirs origin/${branch}`,
      { cwd: ROOT, stdio: 'inherit' }
    );
    console.log('\n✓ Rebase completado — reintentando push...\n');
    tryPush();
    return true;
  } catch {
    // Si el rebase se atoró (conflictos que -X theirs no resolvió), abortar
    try { execSync('git rebase --abort', { cwd: ROOT, stdio: 'pipe' }); } catch {}
    return false;
  }
}

try {
  tryPush();
  console.log('\n✓ Publicado. GitHub Pages redeploya en ~1-2 min.');
  if (branch !== 'main' && branch !== 'master') {
    console.log('');
    console.log(`ℹ Estás en rama "${branch}". Para publicar a producción hay que mergear a main.`);
  }
} catch (e) {
  if (rebaseAndRetry()) {
    console.log('\n✓ Publicado (tras rebase automático). GitHub Pages redeploya en ~1-2 min.');
  } else {
    console.error('\n✗ Push falló y el rebase automático no pudo resolverlo.');
    console.error('  El commit local quedó. Resolvé manualmente:');
    console.error(`    git pull --rebase -X theirs origin ${branch}`);
    console.error('    git push');
    process.exit(1);
  }
}
