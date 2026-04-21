#!/usr/bin/env node
// sync/publish-enriquecidos.js
// Flujo de un solo comando: build Excel → JSON, commit y push si hubo cambios.
//
// Uso:
//   node sync/publish-enriquecidos.js
//   npm run publish-enriquecidos (desde sync/)
//
// Flags:
//   --no-push   solo build y commit, no hace push (útil si no hay internet)
//   --dry-run   muestra qué haría sin ejecutar commit/push

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'data', 'enriquecidos.json');
const NO_PUSH = process.argv.includes('--no-push');
const DRY_RUN = process.argv.includes('--dry-run');

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}

function runInherit(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function git(args) {
  try { return run(`git ${args}`); }
  catch (e) { throw new Error(`git ${args} → ${e.stderr?.toString() || e.message}`); }
}

function main() {
  console.log(`Publish enriquecidos${DRY_RUN ? ' (DRY RUN)' : ''}${NO_PUSH ? ' (--no-push)' : ''}`);
  console.log('');

  // 1. Verificar que estamos en un repo git
  try { git('rev-parse --is-inside-work-tree'); }
  catch { console.error('✗ Este directorio no es un repo git'); process.exit(1); }

  const branch = git('rev-parse --abbrev-ref HEAD');
  console.log(`→ Branch: ${branch}`);

  // 2. Build: Excel → JSON
  console.log('→ Corriendo build-enriquecidos.js...');
  console.log('');
  runInherit(`node "${path.join(__dirname, 'build-enriquecidos.js')}"`);
  console.log('');

  // 3. Ver si el JSON cambió vs HEAD
  let diff;
  try { diff = git('diff --stat HEAD -- data/enriquecidos.json'); }
  catch { diff = ''; }

  if (!diff) {
    console.log('✓ data/enriquecidos.json está igual — no hay nada que publicar.');
    return;
  }

  console.log('→ Cambios detectados:');
  console.log('  ' + diff.split('\n').join('\n  '));
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN — se omite commit/push');
    console.log('Diff resumido:');
    runInherit('git --no-pager diff --stat HEAD -- data/enriquecidos.json');
    return;
  }

  // 4. Commit
  const msg = `datos(enriquecidos): actualizar desde sync/enriquecidos.xlsx\n\nRegenerado con sync/build-enriquecidos.js.\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`;
  git('add data/enriquecidos.json');
  try {
    run(`git -c user.name="${process.env.GIT_USER_NAME || 'Cceren003'}" -c user.email="${process.env.GIT_USER_EMAIL || 'cgceren10@gmail.com'}" commit -m "${msg.replace(/"/g, '\\"')}"`);
    const sha = git('rev-parse --short HEAD');
    console.log(`✓ Commit ${sha} creado en ${branch}`);
  } catch (e) {
    console.error('✗ Error al commitear:', e.message);
    process.exit(1);
  }

  // 5. Push
  if (NO_PUSH) {
    console.log('⚠ --no-push activo: saltando push');
    console.log('  Corré manualmente:  git push');
    return;
  }

  console.log('→ Pushing...');
  try {
    runInherit(`git push origin ${branch}`);
    console.log('');
    console.log('✓ Publicado. GitHub Pages redeploya en ~1-2 min.');
    if (branch !== 'main' && branch !== 'master') {
      console.log('');
      console.log('ℹ Estás en una rama de trabajo. Para que el cambio aparezca en producción,');
      console.log(`  hay que mergear "${branch}" → main y pushear main.`);
    }
  } catch (e) {
    console.error('✗ Error en push:', e.message);
    console.error('  El commit local quedó hecho. Corré manualmente:  git push');
    process.exit(1);
  }
}

try { main(); }
catch (err) {
  console.error('\n✗ ERROR:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}
