// Cloudflare Pages Function: GET /sitemap.xml
// Genera el sitemap dinámicamente leyendo catalogo.json. Google, Bing y
// demás crawlers lo consumen para indexar todos los productos individualmente.
//
// Se cachea 1 hora por edge node — no golpea el origin en cada request.

const CACHE_TTL = 60 * 60; // 1 hora

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const origin = url.origin;

  try {
    const res = await fetch(origin + '/catalogo.json');
    if (!res.ok) throw new Error('No se pudo cargar catalogo.json');
    const data = await res.json();
    const productos = Array.isArray(data) ? data : (data.productos || []);
    const lastMod = data.generated_at
      ? new Date(data.generated_at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const urls = [];

    // Home
    urls.push(`<url><loc>${origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`);

    // Una URL por cada producto del catálogo
    for (const p of productos) {
      if (!p.sku || p.activo === false) continue;
      const loc = `${origin}/producto.html?sku=${encodeURIComponent(p.sku)}`;
      urls.push([
        '<url>',
        `<loc>${esc(loc)}</loc>`,
        `<lastmod>${lastMod}</lastmod>`,
        '<changefreq>weekly</changefreq>',
        '<priority>0.8</priority>',
        p.imagen ? `<image:image><image:loc>${esc(origin + '/' + p.imagen)}</image:loc><image:title>${esc(p.nombre)}</image:title></image:image>` : '',
        '</url>'
      ].filter(Boolean).join(''));
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
      },
    });
  } catch (err) {
    return new Response(`<!-- Error: ${err.message} -->`, {
      status: 500,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  }
}
