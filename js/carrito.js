// ═══════════════════════════════════════════
// Carrito — localStorage, contador, totales
// API: window.Carrito.{add, remove, setQty, clear, items, total, subscribe}
// ═══════════════════════════════════════════

(() => {
  const KEY = 'lcr_cart_v1';
  const listeners = new Set();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }
  function save(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    listeners.forEach(fn => fn(items));
  }

  let items = load();

  function itemKey(sku) { return items.findIndex(i => i.sku === sku); }

  function add(product, qty = 1) {
    const price = resolvePrice(product);
    if (price == null) return;
    const idx = itemKey(product.sku);
    if (idx >= 0) items[idx].qty += qty;
    else items.push({
      sku: product.sku,
      nombre: product.nombre,
      marca: product.marca || '',
      precio: price,
      qty,
    });
    save(items);
  }

  function setQty(sku, qty) {
    const idx = itemKey(sku);
    if (idx < 0) return;
    if (qty <= 0) items.splice(idx, 1);
    else items[idx].qty = qty;
    save(items);
  }

  function remove(sku) {
    items = items.filter(i => i.sku !== sku);
    save(items);
  }

  function clear() {
    items = [];
    save(items);
  }

  function total() {
    return items.reduce((s, i) => s + i.precio * i.qty, 0);
  }

  function count() {
    return items.reduce((s, i) => s + i.qty, 0);
  }

  function resolvePrice(product) {
    if (!product.precios) return null;
    const role = (window.Auth && window.Auth.currentLevel) || 'publico';
    const v = product.precios[role];
    return v != null ? v : product.precios.publico;
  }

  function subscribe(fn) {
    listeners.add(fn);
    fn(items);
    return () => listeners.delete(fn);
  }

  window.Carrito = {
    add, remove, setQty, clear,
    get items() { return items.slice(); },
    total, count, subscribe,
  };
})();
