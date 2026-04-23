// ═══════════════════════════════════════════
// Producto — página dedicada por SKU
// Depende de: Auth, Carrito
// ═══════════════════════════════════════════

const CONFIG = {
  dataUrl: 'catalogo.json',
  whatsappVentas: '50370301941',
  whatsappTaller: '50368680177',
};

const state = {
  all: [],
  enriched: null,
  product: null,
};

// ─── Helpers (espejo de catalogo.js) ────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtPrice = (v) => v != null ? '$' + (+v).toFixed(2) : '—';

function dispoOf(p) {
  if (p.disponibilidad) return p.disponibilidad;
  if ((p.stock || 0) > 0) return 'inmediato';
  if (p.bodega_central) return 'a_pedido';
  return 'agotado';
}

function stockLabel(p) {
  const s = p.stock_status || (p.stock > 5 ? 'in_stock' : p.stock > 0 ? 'low_stock' : 'out_of_stock');
  return { in_stock: 'En stock', low_stock: 'Poco stock', out_of_stock: 'Agotado' }[s] || '—';
}

function detailPriceRow(label, value, highlight) {
  if (value == null) return '';
  return `
    <div class="detail-price-row">
      <span class="detail-price-label">${label}</span>
      <span class="detail-price-value${highlight ? ' highlight' : ''}">${fmtPrice(value)}</span>
    </div>`;
}

function getEnrichment(sku) {
  return (state.enriched && state.enriched.get(sku)) || {};
}

// ─── Render secciones enriquecidas ──────────────────────────────────
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
  const items = raw.map(x => typeof x === 'string' ? { sku: x } : x).filter(x => x && x.sku);
  const chips = items.map(({ sku, nota }) => {
    const eq = state.all.find(x => x.sku === sku);
    if (!eq) return '';
    const tooltip = nota ? `${eq.nombre}\n\n${nota}` : eq.nombre;
    return `
      <a class="equiv-chip" href="producto.html?sku=${encodeURIComponent(sku)}" title="${esc(tooltip)}">
        <span class="equiv-chip-sku">${esc(sku)}</span>
        <span class="equiv-chip-name">${esc(eq.nombre)}</span>
        ${nota ? '<span class="equiv-chip-note" aria-label="Ver nota">ⓘ</span>' : ''}
      </a>`;
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
      ? `<img class="related-card-img" src="${esc(r.imagen)}?v=${r.imagen_size || 0}" alt="${esc(r.nombre)}" loading="lazy">`
      : `<div class="related-card-img related-card-img-ph">Sin imagen</div>`;
    return `
      <a class="related-card" href="producto.html?sku=${encodeURIComponent(r.sku)}" title="${esc(r.nombre)}">
        ${img}
        <div class="related-card-name">${esc(r.nombre)}</div>
        <div class="related-card-price">${precio != null ? fmtPrice(precio) : '<span class="related-card-consult">Consultar</span>'}</div>
      </a>`;
  }).join('');
  return `
    <div class="detail-section">
      <div class="detail-section-title">Productos relacionados</div>
      <div class="related-grid">${cards}</div>
    </div>`;
}

// ─── Meta OG dinámicos ───────────────────────────────────────────────
function updateMetaTags(p) {
  const title = `${p.nombre} — La Central del Repuesto`;
  const role = Auth.currentLevel;
  const precio = p.precios?.[role] ?? p.precios?.publico;
  const isPedido = dispoOf(p) === 'a_pedido';
  const descBits = [
    p.nombre,
    p.marca ? `Marca: ${p.marca}` : '',
    p.categoria ? `Categoría: ${p.categoria}` : '',
    isPedido ? 'Disponible a pedido' : (precio != null ? `Precio: ${fmtPrice(precio)}` : 'Consultar precio'),
  ].filter(Boolean).join(' · ');
  // URL completa de la imagen (OG necesita URL absoluta o path absoluto, con ?v= para cache-bust)
  const imageUrl = p.imagen
    ? `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/${p.imagen}?v=${p.imagen_size || 0}`
    : `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/assets/logo-dark.png`;
  const canonicalUrl = `${location.origin}${location.pathname}?sku=${encodeURIComponent(p.sku)}`;

  document.title = title;
  setMeta('description', descBits);
  setMeta('og:title', title, true);
  setMeta('og:description', descBits, true);
  setMeta('og:image', imageUrl, true);
  setMeta('og:url', canonicalUrl, true);
  setMeta('twitter:title', title);
  setMeta('twitter:description', descBits);
  setMeta('twitter:image', imageUrl);
}

function setMeta(key, content, isProperty = false) {
  const attr = isProperty ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

// ─── Render principal ────────────────────────────────────────────────
function renderProduct(p) {
  const role = Auth.currentLevel;
  const d = dispoOf(p);
  const isPedido = d === 'a_pedido';
  const isAgotado = d === 'agotado';

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

  const pedidoActions = isPedido ? `
    <div class="detail-actions" style="margin-top:4px;">
      <button class="btn btn-outline block" id="copyLinkBtn">Copiar enlace</button>
    </div>` : '';

  const imgHtml = p.imagen
    ? `<img src="${esc(p.imagen)}?v=${p.imagen_size || 0}" alt="${esc(p.nombre)}"
           onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('beforeend','<span class=no-img style=color:#888;font-size:13px;>Foto referencial</span>')">`
    : `<span class="no-img" style="color:#888;font-size:13px;">Foto referencial</span>`;

  // Layout similar al modal pero en página. Reusa clases .detail-* del modal
  // y las envuelve en .producto-page / .producto-main.
  const root = document.getElementById('productoRoot');
  root.innerHTML = `
    <nav class="producto-breadcrumb">
      <a href="index.html">Catálogo</a>
      <span>›</span>
      <a href="index.html?categoria=${encodeURIComponent(p.categoria || '')}">${esc(p.categoria || '—')}</a>
      <span>›</span>
      <span>${esc(p.nombre)}</span>
    </nav>

    <div class="producto-card modal-detail">
      <div class="detail-img" id="detailImg">${imgHtml}</div>
      <div class="detail-body" id="detailBody">
        <h1 class="detail-name">${esc(p.nombre)}</h1>
        <div class="detail-ref">SKU: ${esc(p.sku)}${p.presentacion ? ' · ' + esc(p.presentacion) : ''}</div>
        <div class="detail-tags">
          ${p.marca ? `<span class="detail-tag">${esc(p.marca)}</span>` : ''}
          ${p.categoria ? `<span class="detail-tag">${esc(p.categoria)}</span>` : ''}
          ${dispoTag}
        </div>
        ${p.descripcion ? `<p class="detail-descripcion">${esc(p.descripcion)}</p>` : ''}
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
      </div>
      <div class="detail-extras" id="detailExtras">
        ${renderEspecificaciones(p)}
        ${renderCompatibilidades(p)}
        ${renderEquivalencias(p)}
        ${renderRelacionados(p)}
      </div>
    </div>`;

  // Wire handlers (carrito, copiar)
  const qtyInput = root.querySelector('#qtyInput');
  if (qtyInput) {
    root.querySelector('#qtyMinus').onclick = () => qtyInput.value = Math.max(1, (+qtyInput.value || 1) - 1);
    root.querySelector('#qtyPlus').onclick = () => qtyInput.value = (+qtyInput.value || 1) + 1;
    root.querySelector('#addToCartDetail').onclick = () => {
      Carrito.add(p, +qtyInput.value || 1);
    };
  }

  const copyBtn = root.querySelector('#copyLinkBtn');
  if (copyBtn) {
    copyBtn.onclick = async (ev) => {
      const btn = ev.currentTarget;
      const url = `${location.origin}${location.pathname}?sku=${encodeURIComponent(p.sku)}`;
      let ok = false;
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch {
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
  }
}

function renderError(message, detail = '') {
  const root = document.getElementById('productoRoot');
  root.innerHTML = `
    <div class="producto-error">
      <h2>Producto no encontrado</h2>
      <p>${esc(message)}</p>
      ${detail ? `<p style="color:var(--lcr-muted);font-size:13px;margin-top:6px;">${esc(detail)}</p>` : ''}
      <a class="btn btn-primary" href="index.html" style="margin-top:16px;display:inline-block;">Volver al catálogo</a>
    </div>`;
}

// ─── Búsqueda en navbar (redirige a index.html con ?q=) ──────────────
function wireSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const q = input.value.trim();
      if (q) location.href = `index.html?q=${encodeURIComponent(q)}`;
    }
  });
}

// ─── Load + init ─────────────────────────────────────────────────────
async function loadAndRender() {
  const params = new URLSearchParams(location.search);
  const sku = params.get('sku');
  if (!sku) {
    renderError('No se especificó un SKU en la URL.',
      'Usá el formato: producto.html?sku=XXXXX');
    return;
  }

  try {
    const [resCat, resEnr] = await Promise.all([
      fetch(CONFIG.dataUrl, { cache: 'no-cache' }),
      fetch('data/enriquecidos.json', { cache: 'no-cache' }).catch(() => null),
    ]);
    if (!resCat.ok) throw new Error('No se pudo cargar el catálogo.');
    const data = await resCat.json();
    const raw = Array.isArray(data) ? data : (data.productos || []);
    state.all = raw;

    state.enriched = new Map();
    if (resEnr && resEnr.ok) {
      try {
        const enr = await resEnr.json();
        for (const [s, ext] of Object.entries(enr)) {
          if (s.startsWith('_')) continue;
          state.enriched.set(s, ext);
        }
      } catch {}
    }

    const p = state.all.find(x => String(x.sku) === String(sku));
    if (!p) {
      renderError(`El producto ${sku} no existe o fue dado de baja.`);
      return;
    }

    state.product = p;
    updateMetaTags(p);
    renderProduct(p);
  } catch (err) {
    renderError('Error al cargar el producto.', err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  wireSearch();
  loadAndRender();
});
