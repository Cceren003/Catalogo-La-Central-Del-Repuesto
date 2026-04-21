// ═══════════════════════════════════════════
// Catálogo — load, filter, sort, render, detail modal
// Depende de: Carrito, Auth
// ═══════════════════════════════════════════

const CONFIG = {
  dataUrl: 'catalogo.json',
  pageSize: 60,
  motoBrands: ['HONDA','FREEDOM','AKT','TVS','DAYUN','HERO','KATANA','SERPENTO','BAJAJ','YAMAHA','SUZUKI','UM'],
  // Marcas que en realidad son items internos (fletes, servicios) — se ocultan del catálogo público
  brandBlacklist: ['FLETE'],
  // Números con código de país El Salvador (+503) para WhatsApp API
  whatsappVentas: '50370301941',   // Sala de Ventas
  whatsappTaller: '50368680177',   // Centro de Servicio / Instalación
  // TODO Fase 4: cuando haya data de cliente→vendedor asignado,
  // al estar logueado mostrar WhatsApp del vendedor del cliente en vez del general.
};

const state = {
  all: [],
  filtered: [],
  page: 1,
  cat: 'all',
  marcaRepuesto: 'all',
  dispo: 'all',         // 'all' | 'inmediato' | 'a_pedido'
  query: '',
  sort: 'relevance',
  mode: 'filters',      // 'filters' | 'search' — el último que el usuario tocó
};

// Al activar modo búsqueda, limpia categoría y marca del repuesto.
// Disponibilidad es MASTER filter y se respeta siempre, NO se toca.
function switchToSearchMode() {
  state.mode = 'search';
  state.cat = 'all';
  state.marcaRepuesto = 'all';
  document.querySelectorAll('#catPills .pill').forEach(p =>
    p.classList.toggle('active', p.dataset.cat === 'all')
  );
  document.querySelectorAll('#filterMarcaRepuesto .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.v === 'all')
  );
}

// Al activar modo filtros, limpia el query del buscador.
function switchToFiltersMode() {
  state.mode = 'filters';
  state.query = '';
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
}

// Deriva disponibilidad si el producto viene de un catalogo.json viejo sin el campo.
function dispoOf(p) {
  if (p.disponibilidad) return p.disponibilidad;
  if ((p.stock || 0) > 0) return 'inmediato';
  if (p.bodega_central) return 'a_pedido';
  return 'agotado';
}

// ═══════════════════════════════════════════
// LOAD
// ═══════════════════════════════════════════
async function loadCatalog() {
  try {
    // Carga catálogo (generado por sync) + enriquecidos (editable a mano) en paralelo.
    // cache: 'no-cache' fuerza revalidación con el servidor → el browser no
    // sirve una versión vieja después de actualizar el JSON.
    const [resCat, resEnr] = await Promise.all([
      fetch(CONFIG.dataUrl, { cache: 'no-cache' }),
      fetch('data/enriquecidos.json', { cache: 'no-cache' }).catch(() => null),
    ]);
    if (!resCat.ok) throw new Error('No se pudo cargar el catálogo');
    const data = await resCat.json();
    const raw = Array.isArray(data) ? data : (data.productos || []);
    const blacklist = new Set(CONFIG.brandBlacklist.map(s => s.toUpperCase()));
    state.all = raw.filter(p => !blacklist.has((p.marca || '').toUpperCase()));

    // Enriquecidos (compatibilidades, equivalencias, relacionados). Opcional.
    state.enriched = new Map();
    if (resEnr && resEnr.ok) {
      try {
        const enr = await resEnr.json();
        for (const [sku, ext] of Object.entries(enr)) {
          if (sku.startsWith('_')) continue; // metadata
          state.enriched.set(sku, ext);
        }
      } catch (e) { console.warn('enriquecidos.json inválido:', e.message); }
    }

    initUI();
  } catch (err) {
    document.getElementById('grid').innerHTML = `
      <div class="no-results">
        <h3>Error al cargar</h3>
        <p>${err.message}</p>
        <p style="margin-top:8px;font-size:12px;">Asegurate de servir este sitio por HTTP (no file://).</p>
      </div>`;
  }
}

function initUI() {
  renderCategoryPills();
  renderMarcaRepuestoFilter();
  renderStockFilter();
  populateCompatMarcaSelect();
  applyFilters();
  wireEvents();
}

// Pobla el <select> del hero con las marcas de moto (placeholder — aún no filtra)
function populateCompatMarcaSelect() {
  const sel = document.getElementById('compatMarca');
  if (!sel) return;
  const opts = CONFIG.motoBrands.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  sel.innerHTML = `<option value="">Selecciona la marca</option>` + opts;
}

// ═══════════════════════════════════════════
// FILTERS RENDERING
// ═══════════════════════════════════════════
function renderCategoryPills() {
  const counts = {};
  state.all.forEach(p => { if (p.categoria) counts[p.categoria] = (counts[p.categoria] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const el = document.getElementById('catPills');
  el.innerHTML =
    `<button class="pill active" data-cat="all">TODOS <span class="count">${state.all.length}</span></button>` +
    sorted.map(([c, n]) =>
      `<button class="pill" data-cat="${esc(c)}">${esc(c)} <span class="count">${n}</span></button>`
    ).join('');

  el.addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    switchToFiltersMode();           // al tocar filtro, limpia query
    state.cat = btn.dataset.cat;
    // Al cambiar de categoría, limpiamos el filtro de marca para evitar
    // combinaciones vacías (ej. "MOTUL" + "CABLES" = 0 resultados).
    state.marcaRepuesto = 'all';
    el.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p === btn));
    // Reset visual: marca "Todas" como activa en el filtro lateral
    const marcaEl = document.getElementById('filterMarcaRepuesto');
    if (marcaEl) {
      marcaEl.querySelectorAll('.chip').forEach(c =>
        c.classList.toggle('active', c.dataset.v === 'all')
      );
    }
    applyFilters();
  });

  // Flechas de desplazamiento horizontal (desktop)
  const btnLeft = document.getElementById('catPillsLeft');
  const btnRight = document.getElementById('catPillsRight');
  if (btnLeft && btnRight) {
    const scrollAmount = () => Math.round(el.clientWidth * 0.7);
    btnLeft.addEventListener('click', () => el.scrollBy({ left: -scrollAmount(), behavior: 'smooth' }));
    btnRight.addEventListener('click', () => el.scrollBy({ left: scrollAmount(), behavior: 'smooth' }));
    const updateArrows = () => {
      const max = el.scrollWidth - el.clientWidth;
      btnLeft.classList.toggle('hidden', el.scrollLeft <= 4);
      btnRight.classList.toggle('hidden', el.scrollLeft >= max - 4);
    };
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    // Initial state (siguiente tick para que el layout esté listo)
    requestAnimationFrame(updateArrows);
  }
}

function renderMarcaRepuestoFilter() {
  const brands = new Set();
  state.all.forEach(p => { if (p.marca) brands.add(p.marca); });
  const el = document.getElementById('filterMarcaRepuesto');
  el.innerHTML =
    `<button class="chip active" data-v="all">Todas</button>` +
    [...brands].sort().map(m =>
      `<button class="chip" data-v="${esc(m)}">${esc(m)}</button>`
    ).join('');
  chipGroupHandler(el, v => {
    state.marcaRepuesto = v;
    // Al cambiar de marca, limpiamos el filtro de categoría (pill del carrusel)
    // para evitar combinaciones vacías (ej. "CABLES" + "MOTUL" = 0 resultados).
    state.cat = 'all';
    const catEl = document.getElementById('catPills');
    if (catEl) {
      catEl.querySelectorAll('.pill').forEach(p =>
        p.classList.toggle('active', p.dataset.cat === 'all')
      );
    }
  });
}

function renderStockFilter() {
  const el = document.getElementById('filterStock');
  const inmediato = state.all.filter(p => dispoOf(p) === 'inmediato').length;
  const aPedido   = state.all.filter(p => dispoOf(p) === 'a_pedido').length;
  el.innerHTML = `
    <button class="chip active" data-v="all">Todos</button>
    <button class="chip" data-v="inmediato">Entrega inmediata <span class="chip-count">${inmediato}</span></button>
    <button class="chip" data-v="a_pedido">A pedido <span class="chip-count">${aPedido}</span></button>`;
  // Disponibilidad = master filter: NO cambia de modo, coexiste con todo
  chipGroupHandler(el, v => { state.dispo = v; }, { master: true });
}

function chipGroupHandler(root, onChange, opts = {}) {
  root.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    // Master filters (como disponibilidad) NO cambian el modo — coexisten
    // con texto o con otros filtros. Chips "normales" cambian a modo filtros.
    if (!opts.master) switchToFiltersMode();
    root.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === btn));
    onChange(btn.dataset.v);
    applyFilters();
  });
}

// ═══════════════════════════════════════════
// FILTER + SORT
// ═══════════════════════════════════════════
function applyFilters() {
  const q = state.query.trim().toLowerCase();
  state.filtered = state.all.filter(p => {
    // Agotados definitivos se ocultan siempre
    if (dispoOf(p) === 'agotado') return false;

    // Disponibilidad — MASTER filter: aplica siempre que no sea 'all',
    // independientemente del modo (search o filters).
    if (state.dispo !== 'all' && dispoOf(p) !== state.dispo) return false;

    if (state.mode === 'search') {
      // Modo búsqueda: SOLO texto (+ disponibilidad ya aplicada arriba)
      if (!q) return true;
      return (p.nombre || '').toLowerCase().includes(q)
          || (p.sku || '').toLowerCase().includes(q)
          || (p.marca || '').toLowerCase().includes(q);
    }

    // Modo filtros: categoría + marca (+ disponibilidad ya aplicada arriba)
    if (state.cat !== 'all' && p.categoria !== state.cat) return false;
    if (state.marcaRepuesto !== 'all' && p.marca !== state.marcaRepuesto) return false;
    return true;
  });
  sortFiltered();
  state.page = 1;
  renderGrid();
  updateCount();
}

function sortFiltered() {
  const s = state.sort;
  const key = p => pickPrice(p);
  if (s === 'price-asc') state.filtered.sort((a,b) => (key(a) ?? Infinity) - (key(b) ?? Infinity));
  else if (s === 'price-desc') state.filtered.sort((a,b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));
  else if (s === 'alpha') state.filtered.sort((a,b) => (a.nombre || '').localeCompare(b.nombre || ''));
  else {
    // 'relevance' (default):
    //   1) Productos con imagen, ordenados por imagen_size DESC (mejor resolución primero)
    //   2) Productos sin imagen al final
    const conImagen = state.filtered.filter(p => p.imagen)
      .sort((a, b) => (b.imagen_size || 0) - (a.imagen_size || 0));
    const sinImagen = state.filtered.filter(p => !p.imagen);
    state.filtered = [...conImagen, ...sinImagen];
  }
}

function updateCount() {
  document.getElementById('totalCount').textContent = state.filtered.length.toLocaleString('es-SV');
}

// ═══════════════════════════════════════════
// RENDER GRID + CARDS
// ═══════════════════════════════════════════
function renderGrid() {
  const grid = document.getElementById('grid');
  const items = state.filtered.slice(0, state.page * CONFIG.pageSize);

  if (items.length === 0) {
    grid.innerHTML = `
      <div class="no-results">
        <h3>Sin resultados</h3>
        <p>Probá con otros filtros o palabras clave.</p>
      </div>`;
    return;
  }

  grid.innerHTML = items.map(renderCard).join('');

  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-add')) return;
      showDetail(card.dataset.sku);
    });
  });
  grid.querySelectorAll('.card-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sku = btn.closest('.card').dataset.sku;
      const p = state.all.find(x => x.sku === sku);
      if (p) { Carrito.add(p, 1); btn.textContent = '✓'; setTimeout(() => btn.textContent = '+', 700); }
    });
  });
}

function renderCard(p) {
  const brandBadge = p.marca ? `<div class="brand-tag">${esc(p.marca)}</div>` : '';
  const img = p.imagen
    ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy"
           onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('beforeend','<span class=no-img>Sin imagen</span>')">`
    : `<span class="no-img">Sin imagen</span>`;

  const d = dispoOf(p);
  const badgeClass = d === 'inmediato'
    ? (p.stock_status === 'low_stock' ? 'low_stock' : 'in_stock')
    : (d === 'a_pedido' ? 'a_pedido' : 'out_of_stock');

  // Para productos "a pedido": ocultar precio y botón de carrito. El click abre detalle → WhatsApp.
  const footer = d === 'a_pedido'
    ? `<div class="card-footer a-pedido-footer">
         <span class="consultar-label">Consultar precio</span>
         <span class="card-cta">Ver detalle ›</span>
       </div>`
    : `<div class="card-footer">
         ${displayPrice(p)}
         <button class="card-add" title="Agregar al carrito">+</button>
       </div>`;

  return `
    <article class="card" data-sku="${esc(p.sku)}">
      <div class="card-img">
        <span class="stock-badge ${badgeClass}">${stockLabel(p)}</span>
        ${brandBadge}
        ${img}
      </div>
      <div class="card-body">
        <div class="card-ref">REF: ${esc(p.sku)}</div>
        <div class="card-name">${esc(p.nombre)}</div>
        <div class="card-meta">${esc(p.categoria || '')} ${p.presentacion ? ' · ' + esc(p.presentacion) : ''}</div>
        ${footer}
      </div>
    </article>`;
}

function stockLabel(p) {
  const d = dispoOf(p);
  if (d === 'a_pedido') return 'A pedido';
  if (d === 'agotado') return 'Agotado';
  if (p.stock_status === 'low_stock') return `Últimas ${p.stock}`;
  return 'En stock';
}

function pickPrice(p) {
  if (!p.precios) return null;
  const role = Auth.currentLevel;
  return p.precios[role] ?? p.precios.publico;
}

function displayPrice(p) {
  const v = pickPrice(p);
  if (v == null) return `<span class="card-price locked">Consultar</span>`;
  const [int, dec] = v.toFixed(2).split('.');
  return `<span class="card-price">$${int}<span class="cents">.${dec}</span></span>`;
}

// ═══════════════════════════════════════════
// DETAIL MODAL
// ═══════════════════════════════════════════
function showDetail(sku) {
  const p = state.all.find(x => x.sku === sku);
  if (!p) return;
  const overlay = document.getElementById('detailOverlay');
  const body = document.getElementById('detailBody');
  const imgBox = document.getElementById('detailImg');

  imgBox.innerHTML = p.imagen
    ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}"
           onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('beforeend','<span class=no-img style=color:#888;font-size:13px;>Foto referencial</span>')">`
    : `<span class="no-img" style="color:#888;font-size:13px;">Foto referencial</span>`;

  const role = Auth.currentLevel;
  const d = dispoOf(p);
  const isPedido = d === 'a_pedido';

  const dispoTag = d === 'inmediato'
    ? `<span class="detail-tag in_stock">${stockLabel(p)} · ${p.stock} ud.</span>`
    : (isPedido
        ? `<span class="detail-tag a_pedido">A pedido · bodega central</span>`
        : `<span class="detail-tag out_of_stock">Agotado</span>`);

  const aPedidoNotice = isPedido ? `
    <div class="pedido-notice">
      <div class="pedido-head">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
        <span>Producto a pedido</span>
      </div>
      <p class="pedido-text">No tenemos en entrega inmediata. Consulta precio, disponibilidad y tiempo de entrega y lo reservamos para vos.</p>
      <a class="btn btn-primary block" href="https://wa.me/${CONFIG.whatsappVentas}?text=${encodeURIComponent('Hola, quisiera consultar precio, disponibilidad y tiempo de entrega para:\n\n' + p.nombre + '\nSKU: ' + p.sku)}" target="_blank">
        Consultar por WhatsApp
      </a>
    </div>` : '';

  // Precios y carrito: solo para productos en stock inmediato.
  const pricesBlock = isPedido ? '' : `
    <div class="detail-prices">
      <div class="detail-price-row">
        <span class="detail-price-label">Precio público</span>
        <span class="detail-price-value">${fmtPrice(p.precios?.publico)}</span>
      </div>
      ${(role === 'taller' || role === 'distribuidor') ? detailPriceRow('Precio taller', p.precios?.taller, role === 'taller') : ''}
      ${role === 'distribuidor' ? detailPriceRow('Precio distribuidor', p.precios?.distribuidor, true) : ''}
    </div>
    <div class="detail-qty-row" style="display:flex;align-items:center;gap:12px;">
      <div class="detail-qty">
        <button id="qtyMinus">−</button>
        <input id="qtyInput" type="number" value="1" min="1">
        <button id="qtyPlus">+</button>
      </div>
      <button class="btn btn-primary" id="addToCartDetail" style="flex:1;">Agregar al carrito</button>
    </div>
    <div class="detail-actions" style="margin-top:4px;">
      <a class="btn btn-wa" href="https://wa.me/${CONFIG.whatsappVentas}?text=${encodeURIComponent('Hola, me interesa: ' + p.nombre + ' (' + p.sku + ')')}" target="_blank">
        WhatsApp ventas
      </a>
      <button class="btn btn-outline" id="copyLinkBtn">Copiar enlace</button>
    </div>`;

  // Para productos "a pedido": solo copiar enlace (no WhatsApp directo, eso lo cubre el notice)
  const pedidoActions = isPedido ? `
    <div class="detail-actions" style="margin-top:4px;">
      <button class="btn btn-outline block" id="copyLinkBtn">Copiar enlace</button>
    </div>` : '';

  body.innerHTML = `
    <div class="detail-breadcrumb">Catálogo › ${esc(p.categoria || '—')} › ${esc(p.marca || '—')}</div>
    <h2 class="detail-name">${esc(p.nombre)}</h2>
    <div class="detail-ref">SKU: ${esc(p.sku)}${p.presentacion ? ' · ' + esc(p.presentacion) : ''}</div>
    <div class="detail-tags">
      ${p.marca ? `<span class="detail-tag">${esc(p.marca)}</span>` : ''}
      ${p.categoria ? `<span class="detail-tag">${esc(p.categoria)}</span>` : ''}
      ${dispoTag}
    </div>
    ${aPedidoNotice}
    ${pricesBlock}
    ${pedidoActions}
    <div class="install-card">
      <div class="install-card-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
        <span>Servicio de instalación (opcional)</span>
      </div>
      <p class="install-card-text">
        El precio mostrado corresponde solo al repuesto y <strong>no incluye instalación</strong>.
        Si querés que la instalemos nosotros, solicita la cotización del servicio y agendá tu cita en nuestro centro de servicio.
      </p>
      <a class="btn btn-primary block" href="https://wa.me/${CONFIG.whatsappTaller}?text=${encodeURIComponent('Hola, quisiera cotizar la instalación y agendar una cita para:\n\n' + p.nombre + '\nSKU: ' + p.sku)}" target="_blank">
        Cotizar y agendar instalación
      </a>
    </div>
    ${renderEspecificaciones(p)}
    ${renderCompatibilidades(p)}
    ${renderEquivalencias(p)}
    ${renderRelacionados(p)}`;

  // Click handlers en las secciones enriquecidas (equivalencias + relacionados):
  // al clickear un producto, cierra el modal actual y abre el otro.
  body.querySelectorAll('.equiv-chip[data-sku], .related-card[data-sku]').forEach(el => {
    el.onclick = (ev) => {
      const targetSku = ev.currentTarget.dataset.sku;
      if (!targetSku) return;
      closeDetail();
      // Delay breve para que el modal cierre suave antes de reabrir con otro producto
      setTimeout(() => showDetail(targetSku), 120);
    };
  });

  // Quantity handlers (solo para productos en stock inmediato)
  const qtyInput = body.querySelector('#qtyInput');
  if (qtyInput) {
    body.querySelector('#qtyMinus').onclick = () => qtyInput.value = Math.max(1, (+qtyInput.value || 1) - 1);
    body.querySelector('#qtyPlus').onclick = () => qtyInput.value = (+qtyInput.value || 1) + 1;
    body.querySelector('#addToCartDetail').onclick = () => {
      Carrito.add(p, +qtyInput.value || 1);
      closeDetail();
    };
  }
  body.querySelector('#copyLinkBtn').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const url = `${location.origin}${location.pathname}?sku=${encodeURIComponent(p.sku)}`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Fallback: selection + execCommand
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    const original = btn.textContent;
    btn.textContent = ok ? '✓ Enlace copiado' : '✗ No se pudo copiar';
    btn.classList.add(ok ? 'copied' : 'failed');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied', 'failed');
    }, 1800);
  };

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('active');
  document.body.style.overflow = '';
}
function detailPriceRow(label, value, highlight) {
  if (value == null) return '';
  return `
    <div class="detail-price-row">
      <span class="detail-price-label">${label}</span>
      <span class="detail-price-value${highlight ? ' highlight' : ''}">${fmtPrice(value)}</span>
    </div>`;
}
function fmtPrice(v) { return v != null ? '$' + (+v).toFixed(2) : '—'; }

// ═══════════════════════════════════════════
// ENRICHED SECTIONS (compatibilidades, equivalencias, relacionados)
// Datos vienen de data/enriquecidos.json (editable a mano por el admin)
// ═══════════════════════════════════════════
function getEnrichment(sku) {
  return (state.enriched && state.enriched.get(sku)) || {};
}

// Orden y label legible de las specs técnicas. Solo se renderizan las que tienen
// valor — se omiten silenciosamente los campos vacíos.
const SPEC_LABELS = [
  ['dientes',                'Dientes'],
  ['diametro_centro',        'Diámetro centro'],
  ['pernos_cantidad',        'Cantidad de pernos'],
  ['diametro_perno',         'Diámetro perno'],
  ['diametro_perno_a_perno', 'Diámetro perno a perno'],
  ['tipo_de_paso',           'Tipo de paso'],
];
function renderEspecificaciones(p) {
  const specs = getEnrichment(p.sku).especificaciones;
  if (!specs || typeof specs !== 'object') return '';
  const cards = SPEC_LABELS
    .filter(([key]) => specs[key] != null && specs[key] !== '')
    .map(([key, label]) => `
      <div class="spec-card">
        <div class="spec-label">${esc(label)}</div>
        <div class="spec-value">${esc(specs[key])}</div>
      </div>`)
    .join('');
  if (!cards) return '';
  return `
    <div class="detail-section">
      <div class="detail-section-title">Especificaciones técnicas</div>
      <div class="specs-grid">${cards}</div>
    </div>`;
}

function renderCompatibilidades(p) {
  const list = getEnrichment(p.sku).compatibilidades;
  if (!Array.isArray(list) || list.length === 0) return '';
  const cards = list.map(c => {
    const modelo = `${c.marca || ''} ${c.modelo || ''}`.trim();
    const anios = Array.isArray(c.anios) && c.anios.length > 0 ? c.anios.join(' · ') : '';
    return `
      <div class="compat-card">
        <div class="compat-card-body">
          <div class="compat-card-modelo">${esc(modelo || '—')}</div>
          ${anios ? `<div class="compat-card-anios">${esc(anios)}</div>` : ''}
        </div>
      </div>`;
  }).join('');
  return `
    <div class="detail-section">
      <div class="detail-section-title">Compatibilidades verificadas</div>
      <div class="compat-grid">${cards}</div>
    </div>`;
}

function renderEquivalencias(p) {
  const raw = getEnrichment(p.sku).equivalencias;
  if (!Array.isArray(raw) || raw.length === 0) return '';
  // Soporta 2 formatos:
  //   - Array de strings:  ["SKU1", "SKU2"]
  //   - Array de objetos:  [{ sku: "SKU1", nota: "..." }, { sku: "SKU2" }]
  const items = raw
    .map(x => typeof x === 'string' ? { sku: x } : x)
    .filter(x => x && x.sku);
  const chips = items.map(({ sku, nota }) => {
    const eq = state.all.find(x => x.sku === sku);
    if (!eq) return '';
    const tooltip = nota ? `${eq.nombre}\n\n${nota}` : eq.nombre;
    return `
      <button type="button" class="equiv-chip" data-sku="${esc(sku)}" title="${esc(tooltip)}">
        <span class="equiv-chip-sku">${esc(sku)}</span>
        <span class="equiv-chip-name">${esc(eq.nombre)}</span>
        ${nota ? '<span class="equiv-chip-note" aria-label="Ver nota">ⓘ</span>' : ''}
      </button>`;
  }).filter(Boolean).join('');
  if (!chips) return '';
  return `
    <div class="detail-section">
      <div class="detail-section-title">Equivalencias</div>
      <div class="equiv-list">${chips}</div>
    </div>`;
}

function renderRelacionados(p) {
  const manual = getEnrichment(p.sku).relacionados;
  let items = [];
  if (Array.isArray(manual) && manual.length > 0) {
    items = manual.map(sku => state.all.find(x => x.sku === sku)).filter(Boolean).slice(0, 4);
  }
  // Auto-fill: completa hasta 4 con productos de la misma categoría (priorizados por imagen)
  if (items.length < 4 && p.categoria) {
    const seen = new Set([p.sku, ...items.map(x => x.sku)]);
    const auto = state.all
      .filter(x => !seen.has(x.sku) && x.categoria === p.categoria && dispoOf(x) !== 'agotado')
      .sort((a, b) => (b.imagen_size || 0) - (a.imagen_size || 0))
      .slice(0, 4 - items.length);
    items = [...items, ...auto];
  }
  if (items.length === 0) return '';
  const role = Auth.currentLevel;
  const cards = items.map(r => {
    const precio = r.precios?.[role] ?? r.precios?.publico;
    const img = r.imagen
      ? `<img class="related-card-img" src="${esc(r.imagen)}" alt="${esc(r.nombre)}" loading="lazy">`
      : `<div class="related-card-img related-card-img-ph">Sin imagen</div>`;
    return `
      <button type="button" class="related-card" data-sku="${esc(r.sku)}" title="${esc(r.nombre)}">
        ${img}
        <div class="related-card-name">${esc(r.nombre)}</div>
        <div class="related-card-price">${precio != null ? fmtPrice(precio) : '<span class="related-card-consult">Consultar</span>'}</div>
      </button>`;
  }).join('');
  return `
    <div class="detail-section">
      <div class="detail-section-title">Productos relacionados</div>
      <div class="related-grid">${cards}</div>
    </div>`;
}

// ═══════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════
function wireEvents() {
  // Search — al escribir, entra en modo 'search' y limpia TODOS los filtros
  const searchInput = document.getElementById('searchInput');
  let t;
  searchInput.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      switchToSearchMode();          // desactiva filtros, activa 'Todos' en UI
      state.query = searchInput.value;
      applyFilters();
    }, 150);
  });

  // Sort
  document.getElementById('sortBy').addEventListener('change', e => {
    state.sort = e.target.value;
    sortFiltered();
    state.page = 1;
    renderGrid();
  });

  // Detail modal close
  const overlay = document.getElementById('detailOverlay');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeDetail();
  });
  document.getElementById('detailClose').onclick = closeDetail;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  // Infinite scroll
  let loading = false;
  window.addEventListener('scroll', () => {
    const st = document.getElementById('scrollTop');
    st.classList.toggle('visible', window.scrollY > 400);
    if (loading) return;
    if (state.page * CONFIG.pageSize >= state.filtered.length) return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) {
      loading = true;
      state.page++;
      renderGrid();
      loading = false;
    }
  });
  document.getElementById('scrollTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  // Hero compat — por ahora solo muestra mensaje
  const btn = document.getElementById('compatBtn');
  if (btn) btn.onclick = () => {
    alert('Próximamente: búsqueda por compatibilidad de moto. Mientras tanto, usá el buscador o los filtros laterales.');
  };

  // Deep-link ?sku=XXX
  const params = new URLSearchParams(location.search);
  if (params.get('sku')) setTimeout(() => showDetail(params.get('sku')), 300);
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  loadCatalog();
  wireCart();
  wireAuth();
});

// ─── CART PANEL UI ───
function wireCart() {
  const itemsEl = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const countEl = document.getElementById('cartCount');

  Carrito.subscribe(items => {
    countEl.textContent = Carrito.count();
    countEl.classList.toggle('zero', Carrito.count() === 0);

    if (items.length === 0) {
      itemsEl.innerHTML = `<div class="cart-empty">Tu carrito está vacío. Agregá productos desde el catálogo.</div>`;
    } else {
      itemsEl.innerHTML = items.map(i => `
        <div class="cart-item" data-sku="${esc(i.sku)}">
          <div>
            <div class="cart-item-name">${esc(i.nombre)}</div>
            <div class="cart-item-qty">
              <button class="qty-btn" data-act="dec">−</button>
              <span>${i.qty}</span>
              <button class="qty-btn" data-act="inc">+</button>
              <button class="cart-item-remove" data-act="rm" title="Quitar">×</button>
            </div>
          </div>
          <div class="cart-item-total">
            <div class="cart-item-price">$${(i.precio * i.qty).toFixed(2)}</div>
            <div class="cart-item-meta">$${i.precio.toFixed(2)} c/u</div>
          </div>
        </div>`).join('');
    }
    totalEl.textContent = '$' + Carrito.total().toFixed(2);
  });

  itemsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const sku = btn.closest('.cart-item').dataset.sku;
    const it = Carrito.items.find(i => i.sku === sku);
    if (!it) return;
    if (btn.dataset.act === 'inc') Carrito.setQty(sku, it.qty + 1);
    else if (btn.dataset.act === 'dec') Carrito.setQty(sku, it.qty - 1);
    else if (btn.dataset.act === 'rm') Carrito.remove(sku);
  });

  document.getElementById('cartWaBtn').onclick = () => {
    const items = Carrito.items;
    if (!items.length) return;
    const lines = items.map(i => `• ${i.qty}× ${i.nombre} (${i.sku}) — $${(i.precio*i.qty).toFixed(2)}`).join('\n');
    const msg = encodeURIComponent(`Hola, me interesa este pedido:\n\n${lines}\n\nTotal: $${Carrito.total().toFixed(2)}`);
    window.open(`https://wa.me/${CONFIG.whatsappVentas}?text=${msg}`, '_blank');
  };
  document.getElementById('cartClearBtn').onclick = () => {
    if (confirm('¿Vaciar el carrito?')) Carrito.clear();
  };
}

// ─── AUTH UI ───
function wireAuth() {
  const loginBtn = document.getElementById('loginBtn');
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const loginPass = document.getElementById('loginPass');
  const loginError = document.getElementById('loginError');
  const loginClose = document.getElementById('loginClose');

  Auth.subscribe(session => {
    if (session) {
      loginBtn.textContent = `${session.label.toUpperCase()} ✕`;
      loginBtn.title = 'Cerrar sesión';
    } else {
      loginBtn.textContent = 'INICIAR SESIÓN';
      loginBtn.title = '';
    }
    // Re-render para actualizar precios segun rol
    if (state.all.length) { applyFilters(); }
  });

  loginBtn.onclick = () => {
    if (Auth.currentRole) { Auth.logout(); return; }
    loginError.textContent = '';
    loginPass.value = '';
    loginModal.classList.add('active');
    setTimeout(() => loginPass.focus(), 50);
  };
  loginClose.onclick = () => loginModal.classList.remove('active');
  loginModal.addEventListener('click', e => { if (e.target === loginModal) loginModal.classList.remove('active'); });

  loginForm.onsubmit = e => {
    e.preventDefault();
    const r = Auth.login(loginPass.value);
    if (r.ok) loginModal.classList.remove('active');
    else loginError.textContent = r.error;
  };

  // Toggle ojito: mostrar / ocultar contraseña
  const passToggle = document.getElementById('loginPassToggle');
  if (passToggle) {
    passToggle.onclick = () => {
      const showing = loginPass.type === 'password';
      loginPass.type = showing ? 'text' : 'password';
      passToggle.classList.toggle('visible', showing);
      passToggle.setAttribute('aria-label', showing ? 'Ocultar contraseña' : 'Mostrar contraseña');
      loginPass.focus();
    };
  }
}
