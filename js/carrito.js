// ═══════════════════════════════════════════
// Carrito — localStorage, contador, totales
// API: window.Carrito.{add, remove, setQty, clear, items, total, subscribe}
//
// Cada item guarda el objeto `precios` completo (publico/taller/distribuidor)
// para poder resolver el precio en VIVO según el rol del usuario logueado.
// Al cambiar el rol (login/logout), se re-disparan los listeners para que el
// sidebar y la página de cotización se actualicen automáticamente.
// ═══════════════════════════════════════════

(() => {
  const KEY = 'lcr_cart_v1';
  const listeners = new Set();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }
  function persist() {
    localStorage.setItem(KEY, JSON.stringify(items));
  }
  function notify() {
    const view = items.map(viewItem);
    listeners.forEach(fn => fn(view));
  }
  function save() {
    persist();
    notify();
  }

  let items = load();

  function currentRole() {
    return (window.Auth && window.Auth.currentLevel) || 'publico';
  }

  // Resuelve el precio en VIVO para el rol actual.
  // - Items nuevos guardan precios:{publico,taller,distribuidor} → cambia con login/logout.
  // - Items viejos en localStorage solo tienen precio:N → fallback estático.
  function priceOf(item) {
    if (item && item.precios && typeof item.precios === 'object') {
      const r = currentRole();
      const v = item.precios[r];
      if (v != null) return v;
      if (item.precios.publico != null) return item.precios.publico;
    }
    return item && item.precio != null ? item.precio : null;
  }

  // Versión "consumible" del item: incluye `precio` ya resuelto al rol actual.
  // Así catalogo.js / cotizacion.js pueden seguir leyendo `i.precio` sin cambios.
  function viewItem(it) {
    return { ...it, precio: priceOf(it) ?? 0 };
  }

  function itemKey(sku) { return items.findIndex(i => i.sku === sku); }

  function add(product, qty = 1) {
    if (!product || !product.precios) return;
    const idx = itemKey(product.sku);
    if (idx >= 0) {
      items[idx].qty += qty;
      // Refresca el snapshot de precios por si cambió en el catálogo desde el último add
      items[idx].precios = { ...product.precios };
      delete items[idx].precio; // limpia el campo viejo (legacy)
    } else {
      items.push({
        sku: product.sku,
        nombre: product.nombre,
        marca: product.marca || '',
        precios: { ...product.precios },
        qty,
      });
    }
    save();
  }

  function setQty(sku, qty) {
    const idx = itemKey(sku);
    if (idx < 0) return;
    if (qty <= 0) items.splice(idx, 1);
    else items[idx].qty = qty;
    save();
  }

  function remove(sku) {
    items = items.filter(i => i.sku !== sku);
    save();
  }

  function clear() {
    items = [];
    save();
  }

  function total() {
    return items.reduce((s, i) => s + (priceOf(i) ?? 0) * i.qty, 0);
  }

  function count() {
    return items.reduce((s, i) => s + i.qty, 0);
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(items.map(viewItem));
    return () => listeners.delete(fn);
  }

  // Migra items legacy (con `precio:N` snapshot) al formato nuevo
  // (con objeto `precios` completo) usando la data del catálogo.
  // Lo llama catalogo.js / producto.js después de cargar `catalogo.json`.
  // Si no se llama, los items legacy siguen mostrando su precio estático
  // como fallback — no se rompe nada, solo no cambian con login/logout.
  function refreshFromCatalog(getProduct) {
    if (typeof getProduct !== 'function') return;
    let changed = false;
    for (const it of items) {
      if (it.precios) continue; // ya migrado
      const p = getProduct(it.sku);
      if (!p || !p.precios) continue;
      it.precios = { ...p.precios };
      delete it.precio;
      changed = true;
    }
    if (changed) save();
  }

  // Re-renderiza el carrito cuando cambia el rol del usuario (login/logout).
  // Sin esto los precios y el total muestran el snapshot del rol anterior.
  if (window.Auth && typeof window.Auth.subscribe === 'function') {
    window.Auth.subscribe(() => notify());
  }

  window.Carrito = {
    add, remove, setQty, clear,
    get items() { return items.map(viewItem); },
    total, count, subscribe, refreshFromCatalog,
  };
})();
