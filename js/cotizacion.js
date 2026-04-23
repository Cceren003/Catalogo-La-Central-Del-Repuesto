// ═══════════════════════════════════════════
// Cotización — genera PDF del carrito + WhatsApp
// Depende de: Carrito (localStorage), Auth (rol), jsPDF + AutoTable
// ═══════════════════════════════════════════

const WA_VENTAS = '50370301941';
const EMPRESA = {
  nombre: 'LA CENTRAL DEL REPUESTO',
  direccion: 'Block D, Lotif. Montemaría Lote 5, Sacacoyo, La Libertad',
  telVentas: '7030-1941',
  telTaller: '6868-0177',
  web: 'lacentraldelrepuesto.com',
};

function $(sel) { return document.querySelector(sel); }
function fmt(v) { return v != null ? '$' + (+v).toFixed(2) : '—'; }
function esc(s) { return String(s ?? ''); }

// ═══════════════════════════════════════════
// LOGO: precargar assets/logo.png como dataURL para embeberlo en el PDF.
// Usamos logo-light (fondo transparente, texto negro) porque el PDF es fondo blanco.
// Si falla la carga, buildPdf() cae de vuelta al render de texto.
// ═══════════════════════════════════════════
let LOGO_DATA = null; // { dataUrl, w, h } cuando cargó OK
function preloadLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        LOGO_DATA = { dataUrl: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
      } catch (e) { LOGO_DATA = null; }
      resolve();
    };
    img.onerror = () => { LOGO_DATA = null; resolve(); };
    img.src = 'assets/logo-light.png';
  });
}

// ═══════════════════════════════════════════
// STATE: leer carrito
// ═══════════════════════════════════════════
function renderCart() {
  const items = Carrito.items;
  const box = $('#cotItems');
  const cnt = $('#itemCount');
  cnt.textContent = `(${items.length})`;

  if (items.length === 0) {
    box.innerHTML = `
      <div class="cot-empty">
        Tu carrito está vacío.
        <a href="index.html" class="btn btn-primary" style="margin-left:12px;">Ir al catálogo</a>
      </div>`;
    $('#subtotal').textContent = '$0.00';
    $('#total').textContent = '$0.00';
    return;
  }

  box.innerHTML = items.map(i => `
    <div class="cot-item" data-sku="${esc(i.sku)}">
      <div>
        <div class="cot-item-name">${esc(i.nombre)}</div>
        <div class="cot-item-meta">SKU: ${esc(i.sku)} · ${esc(i.marca || '')}</div>
        <div class="cot-item-qty">
          <button class="qty-btn" data-act="dec">−</button>
          <input type="number" min="1" class="qty-input" value="${i.qty}">
          <button class="qty-btn" data-act="inc">+</button>
          <button class="cot-item-remove" data-act="rm" title="Quitar">×</button>
        </div>
      </div>
      <div class="cot-item-totals">
        <div class="cot-item-price">${fmt(i.precio * i.qty)}</div>
        <div class="cot-item-each">${fmt(i.precio)} c/u</div>
      </div>
    </div>`).join('');

  const total = Carrito.total();
  $('#subtotal').textContent = fmt(total);
  $('#total').textContent = fmt(total);

  box.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', e => {
      const row = btn.closest('.cot-item');
      const sku = row.dataset.sku;
      const it = Carrito.items.find(i => i.sku === sku);
      if (!it) return;
      if (btn.dataset.act === 'inc') Carrito.setQty(sku, it.qty + 1);
      else if (btn.dataset.act === 'dec') Carrito.setQty(sku, Math.max(1, it.qty - 1));
      else if (btn.dataset.act === 'rm') Carrito.remove(sku);
    });
  });
  box.querySelectorAll('.qty-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const sku = e.target.closest('.cot-item').dataset.sku;
      const v = Math.max(1, parseInt(e.target.value) || 1);
      Carrito.setQty(sku, v);
    });
  });
}

// ═══════════════════════════════════════════
// PDF GENERATION (jsPDF + AutoTable)
// ═══════════════════════════════════════════
function generarNumeroCotizacion() {
  const d = new Date();
  const yy = d.getFullYear().toString().slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${yy}${mm}${dd}-${rand}`;
}

function buildPdf() {
  const items = Carrito.items;
  if (items.length === 0) {
    alert('Tu carrito está vacío. Agregá productos desde el catálogo.');
    return null;
  }

  const cliente = {
    nombre: ($('#clienteNombre').value || '').trim(),
    tel: ($('#clienteTel').value || '').trim(),
    email: ($('#clienteEmail').value || '').trim(),
    tipo: ($('#tipoComprobante').value || '').trim(),
    nit: ($('#clienteNIT')?.value || '').trim(),
    nrc: ($('#clienteNRC')?.value || '').trim(),
    giro: ($('#clienteGiro')?.value || '').trim(),
    dir: ($('#clienteDir')?.value || '').trim(),
    fecha: $('#cotFecha').value || new Date().toISOString().slice(0, 10),
    notas: ($('#cotNotas').value || '').trim(),
  };
  if (!cliente.nombre) {
    alert('Por favor ingresá el nombre del cliente o empresa.');
    $('#clienteNombre').focus();
    return null;
  }
  if (!cliente.tel) {
    alert('El teléfono es obligatorio.');
    $('#clienteTel').focus();
    return null;
  }
  if (!cliente.tipo) {
    alert('Seleccioná el tipo de comprobante (Consumidor Final o Crédito Fiscal).');
    $('#tipoComprobante').focus();
    return null;
  }
  if (cliente.tipo === 'Crédito Fiscal') {
    const faltan = [];
    if (!cliente.nit)   faltan.push('NIT');
    if (!cliente.nrc)   faltan.push('NRC');
    if (!cliente.giro)  faltan.push('Giro');
    if (!cliente.dir)   faltan.push('Dirección fiscal');
    if (!cliente.email) faltan.push('Email');
    if (faltan.length) {
      alert(`Para Crédito Fiscal falta: ${faltan.join(', ')}.`);
      // Foco en el primer campo vacío
      const firstEmpty = { NIT: '#clienteNIT', NRC: '#clienteNRC', Giro: '#clienteGiro', 'Dirección fiscal': '#clienteDir', Email: '#clienteEmail' }[faltan[0]];
      if (firstEmpty) $(firstEmpty).focus();
      return null;
    }
    // Validación básica formato email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) {
      alert('El email no tiene formato válido.');
      $('#clienteEmail').focus();
      return null;
    }
  }

  const numero = generarNumeroCotizacion();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 40;
  let y = 40;

  // ═══ HEADER ═══
  // Banda roja izquierda (marca visual LCR)
  doc.setFillColor(192, 25, 42);
  doc.rect(0, 0, 8, pageH, 'F');

  // Logo imagen (si se precargó correctamente) o fallback a texto
  if (LOGO_DATA) {
    const maxW = 150; // máx. ancho según spec
    const maxH = 50;
    const ratio = LOGO_DATA.w / LOGO_DATA.h;
    let w = maxW, h = maxW / ratio;
    if (h > maxH) { h = maxH; w = maxH * ratio; }
    doc.addImage(LOGO_DATA.dataUrl, 'PNG', marginX, y - 22, w, h);
    y = y - 22 + h; // posicionar siguiente bloque debajo del logo
  } else {
    // Fallback: logo texto
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(13, 13, 13);
    doc.text('LA ', marginX, y);
    const xAfterLa = marginX + doc.getTextWidth('LA ');
    doc.setTextColor(192, 25, 42);
    doc.text('CENTRAL', xAfterLa, y);
    const xAfterCentral = xAfterLa + doc.getTextWidth('CENTRAL');
    doc.setTextColor(13, 13, 13);
    doc.text(' DEL REPUESTO', xAfterCentral, y);
  }

  // Dirección + contactos
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(EMPRESA.direccion, marginX, y);
  y += 12;
  doc.text(`Ventas: ${EMPRESA.telVentas} · Taller: ${EMPRESA.telTaller}`, marginX, y);

  // Título COTIZACIÓN (derecha)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(13, 13, 13);
  const titleX = pageW - marginX;
  doc.text('COTIZACIÓN', titleX, 40, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(`N° ${numero}`, titleX, 56, { align: 'right' });
  doc.text(`Fecha: ${formatFecha(cliente.fecha)}`, titleX, 70, { align: 'right' });

  // Línea separadora
  y += 15;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);

  // ═══ DATOS DEL CLIENTE ═══
  y += 22;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  // Encabezado con tipo de comprobante destacado a la derecha
  doc.text('CLIENTE', marginX, y);
  // Badge "CRÉDITO FISCAL" / "CONSUMIDOR FINAL"
  if (cliente.tipo === 'Crédito Fiscal') {
    doc.setTextColor(192, 25, 42);
  } else {
    doc.setTextColor(80, 80, 80);
  }
  doc.text(cliente.tipo.toUpperCase(), pageW - marginX, y, { align: 'right' });
  y += 14;
  // Nombre
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(13, 13, 13);
  doc.text(cliente.nombre, marginX, y);
  y += 14;
  // Teléfono
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(`Tel: ${cliente.tel}`, marginX, y); y += 12;

  // Bloque fiscal SOLO para Crédito Fiscal
  if (cliente.tipo === 'Crédito Fiscal') {
    doc.text(`NIT: ${cliente.nit}`, marginX, y); y += 12;
    doc.text(`NRC: ${cliente.nrc}`, marginX, y); y += 12;
    const giroLines = doc.splitTextToSize(`Giro / Actividad económica: ${cliente.giro}`, pageW - 2 * marginX);
    doc.text(giroLines, marginX, y); y += giroLines.length * 12;
    const dirLines = doc.splitTextToSize(`Dirección fiscal: ${cliente.dir}`, pageW - 2 * marginX);
    doc.text(dirLines, marginX, y); y += dirLines.length * 12;
    doc.text(`Email: ${cliente.email}`, marginX, y); y += 12;
  }
  // Consumidor Final: sin datos fiscales (email no va al header por decisión del diseño)

  // ═══ TABLA DE PRODUCTOS ═══
  y += 10;
  const tableRows = items.map((it, i) => [
    String(i + 1),
    it.sku,
    it.nombre + (it.marca ? ` (${it.marca})` : ''),
    String(it.qty),
    fmt(it.precio),
    fmt(it.precio * it.qty),
  ]);
  doc.autoTable({
    startY: y,
    head: [['#', 'SKU', 'Descripción', 'Cant.', 'P. Unit.', 'Subtotal']],
    body: tableRows,
    margin: { left: marginX, right: marginX },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 6,
      textColor: [40, 40, 40],
      lineColor: [230, 230, 230],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [13, 13, 13],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 88, overflow: 'visible' }, // ancho para SKUs EAN de 12 dígitos en 1 línea
      2: { cellWidth: 'auto' },
      3: { cellWidth: 40, halign: 'center' },
      4: { cellWidth: 60, halign: 'right' },
      5: { cellWidth: 70, halign: 'right', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    didDrawPage: (data) => {
      // Footer en cada página
      const h = doc.internal.pageSize.getHeight();
      const w = doc.internal.pageSize.getWidth();
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `${EMPRESA.nombre} · ${EMPRESA.web}`,
        w / 2, h - 24, { align: 'center' }
      );
      doc.text(
        `Cotización N° ${numero} · Página ${doc.internal.getNumberOfPages()}`,
        w / 2, h - 12, { align: 'center' }
      );
    },
  });

  // ═══ TOTALES ═══
  // Precios en el catálogo están con IVA incluido (retail).
  // Para Crédito Fiscal: desglosamos Subtotal (sin IVA) + IVA 13%.
  // Para Consumidor Final: solo Total.
  const totalConIva = Carrito.total();
  const IVA_RATE = 0.13;
  const subtotalSinIva = totalConIva / (1 + IVA_RATE);
  const ivaMonto = totalConIva - subtotalSinIva;

  const finalY = doc.lastAutoTable.finalY + 14;
  const totX = pageW - marginX;
  const totBoxX = pageW - marginX - 220;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(totBoxX, finalY, totX, finalY);

  let ty = finalY + 16;
  if (cliente.tipo === 'Crédito Fiscal') {
    // Subtotal (sin IVA)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text('Subtotal (sin IVA)', totBoxX, ty);
    doc.text(fmt(subtotalSinIva), totX, ty, { align: 'right' });
    // IVA 13%
    ty += 16;
    doc.text('IVA 13%', totBoxX, ty);
    doc.text(fmt(ivaMonto), totX, ty, { align: 'right' });
    // Total
    ty += 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(13, 13, 13);
    doc.text('TOTAL', totBoxX, ty);
    doc.setTextColor(192, 25, 42);
    doc.text(fmt(totalConIva), totX, ty, { align: 'right' });
  } else {
    // Consumidor Final: solo Total
    ty += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(13, 13, 13);
    doc.text('TOTAL', totBoxX, ty);
    doc.setTextColor(192, 25, 42);
    doc.text(fmt(totalConIva), totX, ty, { align: 'right' });
  }

  // ═══ NOTAS ═══
  if (cliente.notas) {
    ty += 30;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('NOTAS', marginX, ty);
    ty += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(cliente.notas, pageW - 2 * marginX);
    doc.text(lines, marginX, ty);
    ty += lines.length * 11;
  }

  // ═══ TÉRMINOS ═══
  ty = Math.max(ty, pageH - 80);
  doc.setDrawColor(220, 220, 220);
  doc.line(marginX, ty, pageW - marginX, ty);
  ty += 12;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(
    'Cotización válida por 15 días. Precios en USD. Sujeto a disponibilidad de inventario.',
    marginX, ty
  );

  return { doc, numero, cliente };
}

function formatFecha(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ═══════════════════════════════════════════
// ACCIONES
// ═══════════════════════════════════════════
function descargarPDF() {
  const r = buildPdf();
  if (!r) return;
  const filename = `cotizacion_${r.numero}_${r.cliente.nombre.replace(/[^\w\-]+/g, '-').slice(0, 30)}.pdf`;
  r.doc.save(filename);
}

function enviarWhatsApp() {
  const r = buildPdf();
  if (!r) return;
  // Descargar el PDF primero para que el usuario lo pueda adjuntar
  const filename = `cotizacion_${r.numero}.pdf`;
  r.doc.save(filename);

  const c = r.cliente;
  const items = Carrito.items;

  // ── Saludo inicial (solo nombre, sin tel — la línea de contacto va al final) ──
  const saludo = `Hola, soy ${c.nombre}. Quiero realizar el siguiente pedido.`;

  // ── Encabezado cliente ──
  const header = [
    saludo,
    '',
    `*Cotización N° ${r.numero}*`,
    '',
    `Cliente: ${c.nombre}`,
    `Teléfono: ${c.tel}`,
    `Tipo: ${c.tipo.toUpperCase()}`,
  ];
  if (c.tipo === 'Crédito Fiscal') {
    header.push(
      `NIT: ${c.nit}`,
      `NRC: ${c.nrc}`,
      `Giro: ${c.giro}`,
      `Dirección fiscal: ${c.dir}`,
      `Email: ${c.email}`,
    );
  }

  // ── Lista de productos ──
  const lineas = items.map(i => `• ${i.qty}× ${i.nombre} (${i.sku}) — ${fmt(i.precio * i.qty)}`);

  // ── Totales ──
  const totalConIva = Carrito.total();
  const totales = [];
  if (c.tipo === 'Crédito Fiscal') {
    const IVA_RATE = 0.13;
    const subtotalSinIva = totalConIva / (1 + IVA_RATE);
    const ivaMonto = totalConIva - subtotalSinIva;
    totales.push(
      `Subtotal (sin IVA): ${fmt(subtotalSinIva)}`,
      `IVA 13%: ${fmt(ivaMonto)}`,
      `*Total: ${fmt(totalConIva)}*`,
    );
  } else {
    totales.push(`*Total: ${fmt(totalConIva)}*`);
  }

  // ── Armado final ──
  const texto = [
    ...header,
    '',
    '*Productos:*',
    ...lineas,
    '',
    ...totales,
    '',
    'Puedes comunicarte conmigo?',
    '',
    '(PDF descargado en mi dispositivo, lo adjunto a continuación)',
  ].join('\n');

  window.open(`https://wa.me/${WA_VENTAS}?text=${encodeURIComponent(texto)}`, '_blank');
}

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Precargar logo en background (no bloquea render; si llega tarde, el 1er PDF usará fallback texto)
  preloadLogo();

  // Fecha default = hoy
  $('#cotFecha').value = new Date().toISOString().slice(0, 10);

  // Render inicial + subscribe a cambios
  renderCart();
  Carrito.subscribe(renderCart);

  // Toggle bloque fiscal con animación slide según tipo de comprobante
  const tipoSel = $('#tipoComprobante');
  const fiscalBlock = $('#fiscalBlock');
  function toggleFiscal() {
    const esCredito = tipoSel.value === 'Crédito Fiscal';
    fiscalBlock.classList.toggle('open', esCredito);
    fiscalBlock.setAttribute('aria-hidden', String(!esCredito));
    // required dinámico — sólo obligatorio cuando el bloque está abierto
    fiscalBlock.querySelectorAll('input').forEach(i => { i.required = esCredito; });
  }
  tipoSel.addEventListener('change', toggleFiscal);
  toggleFiscal(); // estado inicial

  $('#btnGenerar').addEventListener('click', descargarPDF);
  $('#btnWhatsApp').addEventListener('click', enviarWhatsApp);
  $('#btnVaciar').addEventListener('click', () => {
    if (confirm('¿Vaciar el carrito?')) Carrito.clear();
  });
});
