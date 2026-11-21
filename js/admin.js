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

const state = { users: [], log: [], cotizaciones: [] };

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
      if (t.dataset.section === 'cotizaciones') loadCotizaciones();
    };
  });

  // Cotizaciones filter wiring
  $('#cotSearch').addEventListener('input', debounce(() => loadCotizaciones(), 400));
  $('#cotNivel').addEventListener('change', () => loadCotizaciones());
  $('#cotRefreshBtn').onclick = () => loadCotizaciones();

  // Modal detalle cotización
  const cotModal = $('#cotDetailModal');
  $('#cotDetailClose').onclick = () => cotModal.classList.remove('active');
  cotModal.onclick = e => { if (e.target === cotModal) cotModal.classList.remove('active'); };

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
// Cotizaciones
// ═══════════════════════════════════════════

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + (+n).toFixed(2);
}

async function loadCotizaciones() {
  const wrap = $('#cotTableWrap');
  wrap.innerHTML = '<div class="empty">Cargando…</div>';
  const search = $('#cotSearch').value.trim();
  const nivel = $('#cotNivel').value;
  const params = new URLSearchParams();
  params.set('limit', '200');
  if (search) params.set('search', search);
  if (nivel)  params.set('nivel', nivel);
  try {
    const r = await fetch(`/api/admin/cotizaciones?${params}`, { credentials: 'include' });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    state.cotizaciones = data.cotizaciones || [];
    renderCotizaciones();
  } catch (e) {
    wrap.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

function renderCotizaciones() {
  const wrap = $('#cotTableWrap');
  if (state.cotizaciones.length === 0) {
    wrap.innerHTML = '<div class="empty">Sin cotizaciones en el rango (últimos 30 días).</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="data">
      <thead>
        <tr>
          <th>N°</th>
          <th>Fecha</th>
          <th>Cliente</th>
          <th class="hide-mobile">Tel</th>
          <th>Nivel</th>
          <th class="hide-mobile">Tipo</th>
          <th style="text-align:right;">Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${state.cotizaciones.map(c => `
          <tr data-numero="${esc(c.numero)}">
            <td><span class="codigo">${esc(c.numero)}</span></td>
            <td style="white-space:nowrap;">${fmtTs(c.ts)}</td>
            <td>${esc(c.cliente_nombre)}</td>
            <td class="hide-mobile">${esc(c.cliente_tel || '—')}</td>
            <td>
              ${c.session_codigo
                ? `<span class="badge badge-nivel-${c.session_nivel}">${esc(c.session_nivel)}</span> <span style="color:var(--lcr-muted);font-size:11px;">${esc(c.session_codigo)}</span>`
                : `<span class="badge badge-inactive">público</span>`}
            </td>
            <td class="hide-mobile" style="font-size:11px;">${esc(c.cliente_tipo)}</td>
            <td style="text-align:right;font-weight:700;">${fmtMoney(c.total_con_iva)}</td>
            <td style="text-align:right;">
              <button class="btn-xs" data-action="detail">Ver</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('tr[data-numero]').forEach(tr => {
    const numero = tr.dataset.numero;
    tr.querySelector('[data-action="detail"]').onclick = () => openCotizacionDetail(numero);
  });
}

async function openCotizacionDetail(numero) {
  const modal = $('#cotDetailModal');
  const body = $('#cotDetailBody');
  body.innerHTML = '<div class="empty">Cargando…</div>';
  modal.classList.add('active');
  try {
    const r = await fetch(`/api/admin/cotizaciones/${encodeURIComponent(numero)}`, { credentials: 'include' });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    renderCotizacionDetail(data);
  } catch (e) {
    body.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

function renderCotizacionDetail(c) {
  const body = $('#cotDetailBody');
  const cliente = c.cliente || {};
  const items = c.items || [];
  const nivelBadge = c.session_codigo
    ? `<span class="badge badge-nivel-${c.nivel}">${esc(c.nivel)}</span> · ${esc(c.session_codigo)}`
    : `<span class="badge badge-inactive">público (sin login)</span>`;

  body.innerHTML = `
    <h2 style="margin:0 0 6px;">Cotización <span class="codigo" style="color:var(--lcr-red);">${esc(c.numero)}</span></h2>
    <div style="color:var(--lcr-muted);font-size:12px;margin-bottom:16px;">
      Emitida el ${fmtTs(c.emitida_en)} · Sesión: ${nivelBadge}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
      <div>
        <div style="font-size:11px;color:var(--lcr-muted);text-transform:uppercase;letter-spacing:0.5px;">Cliente</div>
        <div style="font-weight:700;font-size:14px;margin-top:4px;">${esc(cliente.nombre)}</div>
        <div style="font-size:12px;color:var(--lcr-muted);">Tel: ${esc(cliente.tel || '—')}</div>
        ${cliente.email ? `<div style="font-size:12px;color:var(--lcr-muted);">Email: ${esc(cliente.email)}</div>` : ''}
      </div>
      <div>
        <div style="font-size:11px;color:var(--lcr-muted);text-transform:uppercase;letter-spacing:0.5px;">Comprobante</div>
        <div style="font-weight:700;font-size:14px;margin-top:4px;">${esc(cliente.tipo)}</div>
        ${cliente.tipo === 'Crédito Fiscal' ? `
          <div style="font-size:12px;color:var(--lcr-muted);">NIT: ${esc(cliente.nit)} · NRC: ${esc(cliente.nrc)}</div>
          <div style="font-size:12px;color:var(--lcr-muted);">Giro: ${esc(cliente.giro)}</div>
          <div style="font-size:12px;color:var(--lcr-muted);">${esc(cliente.dir)}</div>
        ` : ''}
      </div>
    </div>

    ${c.notas ? `
      <div style="padding:10px;background:var(--lcr-black);border-radius:6px;margin-bottom:16px;font-size:13px;">
        <strong style="color:var(--lcr-muted);font-size:11px;text-transform:uppercase;">Notas del cliente:</strong><br>${esc(c.notas)}
      </div>` : ''}

    <table class="data" style="margin-bottom:16px;">
      <thead><tr><th>SKU</th><th>Descripción</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">P. Unit.</th><th style="text-align:right;">Subtotal</th></tr></thead>
      <tbody>
        ${items.map(i => `
          <tr>
            <td><span class="codigo">${esc(i.sku)}</span></td>
            <td>${esc(i.nombre)}${i.marca ? ` <span style="color:var(--lcr-muted);font-size:11px;">(${esc(i.marca)})</span>` : ''}</td>
            <td style="text-align:center;">${esc(i.qty)}</td>
            <td style="text-align:right;">${fmtMoney(i.precio_unit)}</td>
            <td style="text-align:right;font-weight:700;">${fmtMoney(i.subtotal)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="background:var(--lcr-black);padding:14px;border-radius:8px;border:1px solid var(--admin-border);">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--lcr-muted);margin-bottom:6px;">
        <span>Subtotal (sin IVA)</span><span>${fmtMoney(c.totales.subtotal_sin_iva)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--lcr-muted);margin-bottom:10px;">
        <span>IVA 13%</span><span>${fmtMoney(c.totales.iva)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;padding-top:10px;border-top:1px solid var(--admin-border);">
        <span>TOTAL</span><span style="color:var(--lcr-red);">${fmtMoney(c.totales.total_con_iva)}</span>
      </div>
    </div>

    <div style="margin-top:20px;font-size:11px;color:var(--lcr-muted);background:var(--lcr-black);padding:10px;border-radius:6px;">
      <strong>Verificación:</strong> Si el cliente llega con un PDF con este número, los valores DE ARRIBA son los que el sistema emitió. No confíes en montos del PDF — confía en estos.
      ${c.metadata?.ip ? `<br><br>IP: ${esc(c.metadata.ip)}` : ''}
      ${c.metadata?.user_agent ? `<br>User-Agent: ${esc(c.metadata.user_agent.slice(0, 120))}${c.metadata.user_agent.length > 120 ? '…' : ''}` : ''}
    </div>
  `;
}

// ═══════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', boot);
