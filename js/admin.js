// ═══════════════════════════════════════════
// Panel admin — gestión de usuarios + access log
// Solo accesible para sesiones con nivel 'admin'.
// Si la sesión no es admin: muestra login screen con mensaje.
// ═══════════════════════════════════════════

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ═══════════════════════════════════════════
// Estado + boot
// ═══════════════════════════════════════════

const state = { users: [], log: [] };

async function boot() {
  await Auth.ready;
  const session = Auth.currentSession;
  if (!session || session.nivel !== 'admin') {
    showLogin(session ? 'Esta cuenta no tiene permisos de admin.' : '');
    wireLoginForm();
    return;
  }
  showPanel(session);
}

function showLogin(errMsg) {
  $('#loginScreen').style.display = '';
  $('#adminShell').style.display = 'none';
  if (errMsg) $('#loginError').textContent = errMsg;
}

function showPanel(session) {
  $('#loginScreen').style.display = 'none';
  $('#adminShell').style.display = '';
  $('#whoami').textContent = `${session.codigo} · ${session.nivel}`;
  wirePanel();
  loadUsers();
}

// ═══════════════════════════════════════════
// Login form
// ═══════════════════════════════════════════

function wireLoginForm() {
  const form = $('#loginForm');
  const codigo = $('#loginCodigo');
  const pass = $('#loginPass');
  const errEl = $('#loginError');

  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Verificando…';
    errEl.textContent = '';
    try {
      const r = await Auth.login(codigo.value, pass.value);
      if (!r.ok) {
        errEl.textContent = r.error || 'Credenciales inválidas';
        return;
      }
      if (r.session.nivel !== 'admin') {
        errEl.textContent = 'Esta cuenta no tiene permisos de admin.';
        await Auth.logout();
        return;
      }
      showPanel(r.session);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  };
}

// ═══════════════════════════════════════════
// Panel — tabs + eventos
// ═══════════════════════════════════════════

function wirePanel() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      $(`#section-${t.dataset.section}`).classList.add('active');
      if (t.dataset.section === 'log') loadLog();
    };
  });

  // Logout
  $('#logoutBtn').onclick = async () => {
    if (!confirm('¿Cerrar sesión?')) return;
    await Auth.logout();
    showLogin('');
    wireLoginForm();
  };

  // New user modal
  const modal = $('#newUserModal');
  $('#newUserBtn').onclick = () => {
    $('#newUserForm').reset();
    $('#newUserError').textContent = '';
    $('#newUserResult').innerHTML = '';
    modal.classList.add('active');
    setTimeout(() => $('#newCodigo').focus(), 50);
  };
  $('#newUserClose').onclick = () => modal.classList.remove('active');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('active'); };
  $('#newUserForm').onsubmit = handleCreateUser;

  // Log filter
  $('#logFilter').addEventListener('input', debounce(() => loadLog($('#logFilter').value.trim()), 400));
  $('#logRefreshBtn').onclick = () => loadLog($('#logFilter').value.trim());
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ═══════════════════════════════════════════
// Usuarios
// ═══════════════════════════════════════════

async function loadUsers() {
  const wrap = $('#usersTableWrap');
  wrap.innerHTML = '<div class="empty">Cargando usuarios…</div>';
  try {
    const r = await fetch('/api/admin/users', { credentials: 'include' });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    state.users = data.users || [];
    renderUsers();
  } catch (e) {
    wrap.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

function renderUsers() {
  const wrap = $('#usersTableWrap');
  if (state.users.length === 0) {
    wrap.innerHTML = '<div class="empty">Sin usuarios. Click en + Nuevo usuario.</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="data">
      <thead>
        <tr>
          <th>Código</th>
          <th>Nivel</th>
          <th>Estado</th>
          <th class="hide-mobile">Nombre</th>
          <th class="hide-mobile">Teléfono</th>
          <th class="hide-mobile">Último acceso</th>
          <th class="hide-mobile">Creado</th>
          <th style="text-align:right;">Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${state.users.map(u => `
          <tr data-id="${u.id}">
            <td><span class="codigo">${esc(u.codigo)}</span></td>
            <td><span class="badge badge-nivel-${u.nivel}">${esc(u.nivel)}</span></td>
            <td>${u.activo ? '<span class="badge badge-ok">Activo</span>' : '<span class="badge badge-inactive">Inactivo</span>'}</td>
            <td class="hide-mobile">${esc(u.nombre || '—')}</td>
            <td class="hide-mobile">${esc(u.telefono || '—')}</td>
            <td class="hide-mobile">${fmtTs(u.ultimo_acceso)}</td>
            <td class="hide-mobile">${fmtTs(u.creado_en)}</td>
            <td>
              <div class="row-actions">
                <button class="btn-xs warn" data-action="reset">Reset pass</button>
                ${u.activo
                  ? '<button class="btn-xs danger" data-action="revoke">Desactivar</button>'
                  : '<button class="btn-xs" data-action="activate">Activar</button>'}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = parseInt(tr.dataset.id, 10);
    tr.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = () => handleRowAction(id, btn.dataset.action);
    });
  });
}

async function handleRowAction(id, action) {
  const user = state.users.find(u => u.id === id);
  if (!user) return;

  if (action === 'reset') {
    if (!confirm(`¿Resetear password de ${user.codigo}?\n\nSe generará una nueva y vas a tener que mandársela al cliente.`)) return;
    try {
      const data = await apiPatch(`/api/admin/users/${id}`, { reset_password: true });
      alert(`Nueva contraseña para ${user.codigo}:\n\n${data.password}\n\nGUARDALA y mándasela al cliente. No se vuelve a mostrar.`);
    } catch (e) { alert('Error: ' + e.message); }
    return;
  }

  if (action === 'revoke') {
    if (!confirm(`¿Desactivar a ${user.codigo}?\nNo podrá loguear hasta reactivarlo.`)) return;
    try { await apiPatch(`/api/admin/users/${id}`, { activo: false }); await loadUsers(); }
    catch (e) { alert('Error: ' + e.message); }
    return;
  }

  if (action === 'activate') {
    try { await apiPatch(`/api/admin/users/${id}`, { activo: true }); await loadUsers(); }
    catch (e) { alert('Error: ' + e.message); }
    return;
  }
}

async function apiPatch(url, body) {
  const r = await fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ error: 'respuesta_inválida' }));
  if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

async function handleCreateUser(e) {
  e.preventDefault();
  const codigo = $('#newCodigo').value.trim().toUpperCase();
  const nivel = $('#newNivel').value;
  const nombre = $('#newNombre').value.trim();
  const telefono = $('#newTelefono').value.trim();
  const notas = $('#newNotas').value.trim();
  const errEl = $('#newUserError');
  const resultEl = $('#newUserResult');
  errEl.textContent = '';
  resultEl.innerHTML = '';

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const r = await fetch('/api/admin/users', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, nivel, nombre, telefono, notas }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);

    resultEl.innerHTML = `
      <div class="result-box">
        <h4>✓ Usuario creado</h4>
        <div>Código: <strong>${esc(data.codigo)}</strong> · Nivel: <strong>${esc(data.nivel)}</strong></div>
        <div style="margin-top:10px;">Contraseña (click para copiar):</div>
        <div class="pwd" id="newPwdBox" title="Click para copiar">${esc(data.password)}</div>
        <small>⚠ Esta contraseña NO se vuelve a mostrar. Copiala y mandasela al cliente ahora mismo.</small>
        <div style="margin-top:12px;">
          <strong>Mensaje para WhatsApp:</strong>
          <div style="margin-top:6px;padding:10px;background:var(--lcr-black);border-radius:4px;font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:pre-wrap;">Tu acceso al sitio mayorista de La Central del Repuesto:

https://lacentraldelrepuesto.com

Código: ${esc(data.codigo)}
Contraseña: ${esc(data.password)}

(Click en INICIAR SESIÓN arriba a la derecha)</div>
        </div>
      </div>
    `;

    // Copy-on-click para la contraseña
    const pwdBox = $('#newPwdBox');
    if (pwdBox) {
      pwdBox.onclick = async () => {
        try {
          await navigator.clipboard.writeText(data.password);
          const orig = pwdBox.textContent;
          pwdBox.textContent = '✓ Copiado';
          setTimeout(() => { pwdBox.textContent = orig; }, 1500);
        } catch {}
      };
    }

    await loadUsers();
    $('#newUserForm').reset();
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════
// Access log
// ═══════════════════════════════════════════

async function loadLog(codigoFilter) {
  const wrap = $('#logTableWrap');
  wrap.innerHTML = '<div class="empty">Cargando…</div>';
  const url = codigoFilter
    ? `/api/admin/access-log?codigo=${encodeURIComponent(codigoFilter.toUpperCase())}&limit=200`
    : `/api/admin/access-log?limit=200`;
  try {
    const r = await fetch(url, { credentials: 'include' });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    state.log = data.entries || [];
    renderLog();
  } catch (e) {
    wrap.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

function renderLog() {
  const wrap = $('#logTableWrap');
  if (state.log.length === 0) {
    wrap.innerHTML = '<div class="empty">Sin registros.</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="data">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Acción</th>
          <th>Código</th>
          <th class="hide-mobile">IP</th>
          <th>Resultado</th>
          <th class="hide-mobile">Detalle</th>
        </tr>
      </thead>
      <tbody>
        ${state.log.map(l => `
          <tr>
            <td style="white-space:nowrap;">${fmtTs(l.ts)}</td>
            <td><span class="codigo" style="font-size:12px;">${esc(l.accion)}</span></td>
            <td>${esc(l.codigo || '—')}</td>
            <td class="hide-mobile">${esc(l.ip || '—')}</td>
            <td>${l.ok ? '<span class="badge badge-ok">OK</span>' : '<span class="badge badge-fail">FAIL</span>'}</td>
            <td class="hide-mobile" style="color:var(--lcr-muted);font-size:12px;">${esc(l.detalle || '—')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ═══════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', boot);
