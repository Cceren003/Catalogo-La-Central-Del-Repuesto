// Cloudflare Pages Function: GET /producto.html
// Intercepta el request, lee ?sku=<SKU>, busca el producto en catalogo.json
// y reemplaza los meta OG genéricos del HTML por los del producto específico.
// Así WhatsApp/Facebook/Twitter/Slack muestran preview rico por producto.
//
// El catálogo se cachea en memoria durante 5 min por edge node — los bots de
// preview (que hacen 1 request y se van) no golpean repetidamente el origin.

const CATALOG_CACHE_TTL = 5 * 60 * 1000; // 5 min
let _catalogCache = null; // { fetchedAt, products, enrichment }

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtPrice(v) {
  return v != null ? '$' + (+v).toFixed(2) : null;
}

function dispoOf(p) {
  if (p.disponibilidad) return p.disponibilidad;
  if ((p.stock || 0) > 0) return 'inmediato';
  if (p.bodega_central) return 'a_pedido';
  return 'agotado';
}

async function loadCatalog(origin) {
  const now = Date.now();
  if (_catalogCache && (now - _catalogCache.fetchedAt) < CATALOG_CACHE_TTL) {
    return _catalogCache;
  }
  const [catRes, enrRes] = await Promise.all([
    fetch(origin + '/catalogo.json'),
    fetch(origin + '/data/enriquecidos.json').catch(() => null),
  ]);
  if (!catRes.ok) throw new Error('No se pudo cargar catalogo.json');
  const catData = await catRes.json();
  const products = Array.isArray(catData) ? catData : (catData.productos || []);
  let enrichment = {};
  if (enrRes && enrRes.ok) {
    try { enrichment = await enrRes.json(); } catch {}
  }
  _catalogCache = { fetchedAt: now, products, enrichment };
  return _catalogCache;
}

function buildOgTags(p, origin) {
  const title = `${p.nombre} — La Central del Repuesto`;
  const precio = fmtPrice(p.precios?.publico);
  const isPedido = dispoOf(p) === 'a_pedido';
  // Si el producto tiene descripción custom (override del Excel), la usamos en
  // el preview. Si no, armamos fallback con nombre/marca/categoría/precio.
  let description;
  if (p.descripcion) {
    description = p.descripcion;
  } else {
    description = [
      p.nombre,
      p.marca ? `Marca: ${p.marca}` : null,
      p.categoria ? `Categoría: ${p.categoria}` : null,
      isPedido ? 'Disponible a pedido' : (precio ? `Precio: ${precio}` : 'Consultar precio'),
    ].filter(Boolean).join(' · ');
  }
  const imagePath = p.imagen
    ? `${origin}/${p.imagen}?v=${p.imagen_size || 0}`
    : `${origin}/assets/logo-dark.png`;
  const canonicalUrl = `${origin}/producto.html?sku=${encodeURIComponent(p.sku)}`;

  // Etiquetas OG + Twitter Card. Las ponemos como string listo para inyectar.
  // NOTA: estas reemplazan las genéricas que tiene producto.html en estático.
  return {
    title,
    description,
    image: imagePath,
    url: canonicalUrl,
  };
}

function injectMetaTags(html, og) {
  // Reemplazar cada meta OG genérico por el específico del producto.
  // Usamos regex sobre el HTML estático — los patrones están en producto.html
  // con valores por defecto que reemplazamos.
  const titleRx = /<title>[^<]*<\/title>/;
  const ogTitleRx = /<meta property="og:title"[^>]*>/;
  const ogDescRx = /<meta property="og:description"[^>]*>/;
  const ogImageRx = /<meta property="og:image"[^>]*>/;
  const ogUrlRx = /<meta property="og:url"[^>]*>/;
  const twTitleRx = /<meta name="twitter:title"[^>]*>/;
  const twDescRx = /<meta name="twitter:description"[^>]*>/;
  const twImageRx = /<meta name="twitter:image"[^>]*>/;
  const descRx = /<meta name="description"[^>]*>/;

  return html
    .replace(titleRx, `<title>${esc(og.title)}</title>`)
    .replace(descRx, `<meta name="description" content="${esc(og.description)}">`)
    .replace(ogTitleRx, `<meta property="og:title" content="${esc(og.title)}">`)
    .replace(ogDescRx, `<meta property="og:description" content="${esc(og.description)}">`)
    .replace(ogImageRx, `<meta property="og:image" content="${esc(og.image)}">\n  <meta property="og:url" content="${esc(og.url)}">`)
    .replace(ogUrlRx, '') // ya inyectado junto con og:image
    .replace(twTitleRx, `<meta name="twitter:title" content="${esc(og.title)}">`)
    .replace(twDescRx, `<meta name="twitter:description" content="${esc(og.description)}">`)
    .replace(twImageRx, `<meta name="twitter:image" content="${esc(og.image)}">`);
}

export async function onRequestGet(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const sku = url.searchParams.get('sku');

  // Sin ?sku=, delegamos al asset estático (producto.html por defecto muestra error "sin SKU")
  if (!sku) return next();

  try {
    const origin = url.origin;
    const cat = await loadCatalog(origin);
    const p = cat.products.find(x => String(x.sku) === String(sku));
    if (!p) return next(); // SKU no existe → que el JS del cliente muestre error

    // Fetch del HTML estático y modificarlo
    const assetRes = await next();
    const html = await assetRes.text();
    const og = buildOgTags(p, origin);
    const modified = injectMetaTags(html, og);

    return new Response(modified, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Cache corto: permite actualizar meta cuando cambia el producto
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (err) {
    // Si algo falla, servimos el HTML estático sin modificar
    return next();
  }
}
