# CLAUDE.md — Catálogo La Central del Repuesto

## Contexto del proyecto

Catálogo profesional de repuestos para motos de La Central del Repuesto (LCR), El Salvador.
- **URL producción:** https://cceren003.github.io/Catalogo-La-Central-Del-Repuesto
- **Repo GitHub:** https://github.com/cceren003/Catalogo-La-Central-Del-Repuesto
- **Sistema de inventario:** https://dev.oss.com.sv/central_repuestos/dashboard.php
- **Stack:** HTML + CSS + JavaScript vanilla (GitHub Pages — sin servidor backend)
- **Sincronización:** Script Node.js que corre externamente y genera JSON estático

---

## Identidad visual (NO modificar sin autorización)

```
--lcr-black:    #0D0D0D   /* fondo principal */
--lcr-red:      #C0192A   /* acciones, botones primarios, acentos */
--lcr-red-dark: #8B1120   /* hover, badges */
--lcr-white:    #FFFFFF   /* texto principal */
--lcr-gray:     #1A1A1A   /* superficies secundarias */
--lcr-gray2:    #2A2A2A   /* bordes, controles */
--lcr-gray3:    #3D3D3D   /* bordes hover */
--lcr-muted:    #888780   /* texto secundario */
--lcr-surface:  #141414   /* tarjetas de producto */
```

**Logos disponibles en `/assets/logos/`:**
- `logo-dark.png` — horizontal, fondo negro (navbar)
- `logo-light.png` — horizontal, fondo blanco (PDFs, documentos)
- `logo-pill.png` — pastilla negra redondeada (favicon, apps)

**Tipografía:** System font stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
**Estilo:** Oscuro, industrial, bold. Sin gradientes decorativos. Bordes 0.5–1px.

---

## Estructura del repositorio

```
/
├── CLAUDE.md
├── index.html                  # página principal — catálogo
├── producto.html               # ficha de producto detallada
├── login.html                  # login de clientes/distribuidores
├── cotizacion.html             # generador de cotización PDF
│
├── assets/
│   ├── logos/                  # logos en sus variantes
│   ├── img/productos/          # imágenes de productos (webp, 800×800)
│   └── img/marcas/             # logos de marcas de motos
│
├── data/
│   ├── catalogo.json           # ← ARCHIVO MAESTRO (generado por sync)
│   ├── modelos.json            # marcas → modelos → años → piezas compatibles
│   └── precios.json            # estructura de los 7 niveles de precio
│
├── css/
│   ├── base.css                # reset, variables, tipografía
│   ├── components.css          # navbar, cards, botones, badges
│   └── pages.css               # layouts específicos por página
│
├── js/
│   ├── catalogo.js             # renderizado grid, filtros, búsqueda
│   ├── producto.js             # ficha de producto, galería
│   ├── carrito.js              # carrito (localStorage), contador
│   ├── auth.js                 # login/sesión (JWT local), nivel de precio
│   ├── cotizacion.js           # generador PDF (jsPDF)
│   └── sync-check.js           # verifica si catalogo.json está actualizado
│
└── sync/                       # script externo (Node.js, NO se sube a GitHub Pages)
    ├── sync.js                 # descarga inventario del sistema LCR y genera JSON
    ├── config.json             # credenciales y endpoints (en .gitignore)
    └── README.md               # instrucciones para correr el sync manualmente
```

---

## Modelo de datos — catalogo.json

Cada producto tiene esta estructura:

```json
{
  "id": "LCR-0847",
  "sku": "DSC-HON-220-DL",
  "nombre": "Disco de freno delantero 220mm",
  "descripcion": "Disco flotante ventilado de acero inoxidable...",
  "categoria": "frenos",
  "subcategoria": "discos",
  "marca_repuesto": "Honda",
  "tipo": "original",
  "specs": {
    "diametro": "220mm",
    "espesor": "3.5mm",
    "agujeros": "5 pernos",
    "material": "Acero inoxidable",
    "peso": "420g",
    "posicion": "delantera",
    "garantia": "6 meses"
  },
  "compatibilidades": [
    { "marca": "Honda", "modelo": "CB 150", "años": [2018,2019,2020,2021,2022,2023] },
    { "marca": "Honda", "modelo": "XR 150L", "años": [2019,2020,2021,2022] }
  ],
  "precios": {
    "publico": 18.50,
    "taller": 25.00,
    "distribuidor": 31.00
  },
  "stock": 24,
  "stock_status": "in_stock",
  "imagenes": ["LCR-0847-1.webp", "LCR-0847-2.webp"],
  "relacionados": ["LCR-0848", "LCR-0312", "LCR-1780"],
  "activo": true,
  "ultima_sync": "2025-04-17T10:30:00Z"
}
```

**stock_status:** `"in_stock"` (>5) | `"low_stock"` (1–5) | `"out_of_stock"` (0)

---

## Sistema de precios — 3 niveles visibles

El sistema LCR maneja 7 precios de venta internos + costo. En el catálogo web **solo se exponen 3** (los otros 4 son descuentos/operativos y nunca viajan al cliente).

| Nivel web      | Campo LCR origen      | Visible para               | Notas                                          |
|----------------|-----------------------|----------------------------|------------------------------------------------|
| `publico`      | `publico_para_llevar` | Todos (sin login)          | Precio default. Precio 2 del sistema LCR.      |
| `taller`       | `taller_4`            | Login tipo: taller         | Taller/mayorista. Precio 4 del sistema LCR.    |
| `distribuidor` | `taller_6`            | Login tipo: distribuidor   | Distribuidor. Precio 6 del sistema LCR.        |

### Precios del sistema LCR que NO van al catálogo web

- **Precio 1** (`publico_servicio`): incluye mano de obra, no aplica online.
- **Precio 3** (`descuento_publico`): descuento ya contemplado en el precio público.
- **Precio 5** (`taller_5`): descuento interno para mayorista.
- **Precio 7** (`mayoreo`): descuento interno para distribuidor.
- **Costo**: nunca sale del sistema LCR. No está en `catalogo.json`, ni público ni admin.

El sync **descarta estos campos al momento de generar `catalogo.json`**. Nunca aparecen en el JSON que se sube a GitHub Pages.

### Lógica de auth en `auth.js`

```javascript
// Tipos de usuario (guardados en localStorage tras login)
const ROLES = {
  publico:      { nivel: 'publico',      label: 'Precio público' },
  taller:       { nivel: 'taller',       label: 'Precio taller' },
  distribuidor: { nivel: 'distribuidor', label: 'Precio distribuidor' },
};

function getPrecio(producto) {
  const rol = getSession()?.rol || 'publico';
  const nivel = ROLES[rol].nivel;
  return producto.precios[nivel];
}
```

---

## Funcionalidades por página

### index.html — catálogo principal

- **Navbar:** logo, buscador en tiempo real, contador carrito, botón login/perfil
- **Hero:** título, selector de compatibilidad (marca → modelo → año)
- **Categorías:** pills horizontales (Todos, Motor, Frenos, Eléctrico, Transmisión, Carrocería, Aceites, Llantas)
- **Grid de productos:** 3 columnas desktop, 2 tablet, 1 mobile
- **Sidebar filtros:** marca moto, categoría, stock, rango de precio
- **Carrito flotante:** resumen lateral, total, botones PDF y pedido
- **Búsqueda:** filtra por nombre, SKU, referencia en tiempo real (sin server)
- **URL params:** `?categoria=frenos&marca=honda` para links directos y compartir

### producto.html — ficha de producto

- **Galería:** imagen principal + thumbs (hasta 6 imágenes por producto)
- **Breadcrumb:** Catálogo › Categoría › Marca › Nombre producto
- **Especificaciones técnicas:** grid de specs del JSON
- **Compatibilidades:** cards por modelo de moto con años verificados
- **Precio según rol:** muestra el precio del nivel del usuario logueado
- **Stock en tiempo real:** badge in_stock / low_stock / out_of_stock
- **Carrito:** cantidad + botón agregar, actualiza contador navbar
- **Servicio de instalación:** card verde con botón "Agendar instalación" (abre WhatsApp)
- **Compartir:** WhatsApp (con URL del producto), copiar link, PDF ficha
- **Relacionados:** 4 productos del mismo sistema/categoría

### login.html — autenticación

- Formulario simple: usuario + contraseña
- **Usuarios hardcoded en `config.js`** (para v1, sin backend real)
- Guarda sesión en `localStorage`: `{ rol, nombre, email, token }`
- Redirige a la página anterior tras login
- Botón "Solicitar acceso" abre WhatsApp con mensaje predefinido

### cotizacion.html — generador PDF

- Lista de productos del carrito actual
- Campo para nombre del cliente, empresa, fecha
- Vista previa de la cotización con logo LCR
- Botón generar PDF (usa **jsPDF** + **jsPDF-AutoTable**)
- PDF incluye: logo, datos cliente, tabla productos, totales, pie de página LCR
- Botón compartir por WhatsApp con mensaje + adjunto

---

## Sync engine — sync/sync.js

El sync corre fuera de GitHub Pages (en la PC del administrador o un cron job).

### Lo que hace:
1. Hace login al sistema LCR en `dev.oss.com.sv` (POST a `login.php`)
2. Descarga el Excel consolidado desde `ver_reporte_inventario.php` (POST con `sucursal=0&submit2=EXCEL`) — incluye todos los productos con stock consolidado entre sucursales y los 7 precios de venta
3. Parsea el Excel y mapea: `publico_para_llevar→publico`, `taller_4→taller`, `taller_6→distribuidor`. Descarta costo, precio 1, 3, 5, 7.
4. Preserva los campos enriquecidos manualmente (compatibilidades, imágenes, descripción larga) haciendo merge con el `catalogo.json` anterior
5. Genera `data/catalogo.json` actualizado
6. Hace commit + push automático a GitHub (GitHub Pages redeploya en ~30 segundos)

### Frecuencia:
- Cron job: 3 veces al día (7am, 1pm, 7pm)
- Manual: `node sync/sync.js` desde terminal

### Dependencias del sync (NO van a GitHub Pages):
```
node-fetch, cheerio (o puppeteer si el sistema requiere JS),
simple-git, dotenv
```

---

## Reglas de desarrollo

1. **Sin frameworks pesados.** Vanilla JS únicamente. Sin React, Vue, Angular.
2. **Sin backend propio.** Todo es estático — GitHub Pages no soporta servidor.
3. **Mobile-first.** Diseñar para 375px primero, luego escalar.
4. **Performance.** Imágenes en WebP. Lazy loading en el grid. catalogo.json se carga una vez y se filtra en memoria.
5. **Carrito en localStorage.** Persiste entre páginas y sesiones.
6. **URLs limpias con params.** `producto.html?id=LCR-0847` para compartir fichas.
7. **Sin romper el sync.** Nunca modificar manualmente `data/catalogo.json` — es sobreescrito por el sync.
8. **Imágenes en `/assets/img/productos/`** nombradas por ID de producto: `LCR-0847-1.webp`.

---

## Librerías permitidas (via CDN)

```html
<!-- Generación de PDF -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>

<!-- Íconos (SVG inline preferido, Lucide como fallback) -->
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
```

---

## Fases de desarrollo

### Fase 1 — Exploración del sistema LCR *(hacer primero)*
- [ ] Explorar `https://dev.oss.com.sv/central_repuestos/dashboard.php`
- [ ] Identificar endpoints o páginas de exportación de inventario
- [ ] Documentar estructura de campos disponibles (nombre, precio, stock, código)
- [ ] Identificar los 7 campos de precio en el sistema
- [ ] Escribir `sync/sync.js` básico que descargue y loguee el JSON crudo

### Fase 2 — Datos y estructura
- [ ] Definir schema final de `catalogo.json` basado en campos reales del sistema
- [ ] Crear `data/modelos.json` con marcas y modelos de motos que maneja LCR
- [ ] Crear 5–10 productos de muestra con todos los campos completos
- [ ] Subir logos a `/assets/logos/`

### Fase 3 — Frontend base
- [ ] `css/base.css` — variables LCR, reset, tipografía
- [ ] `css/components.css` — navbar, cards, botones, badges de stock
- [ ] `index.html` + `js/catalogo.js` — grid, filtros, búsqueda, categorías
- [ ] `js/carrito.js` — carrito en localStorage, contador, resumen

### Fase 4 — Páginas secundarias
- [ ] `producto.html` + `js/producto.js` — ficha completa con galería y compatibilidades
- [ ] `login.html` + `js/auth.js` — autenticación y niveles de precio
- [ ] `cotizacion.html` + `js/cotizacion.js` — generador PDF con jsPDF

### Fase 5 — Sync automático
- [ ] `sync/sync.js` completo con mapeo de campos
- [ ] GitHub Actions workflow `.github/workflows/sync.yml` (cron 3×/día)
- [ ] Monitor de última sincronización visible en el admin

### Fase 6 — Pulido y deploy
- [ ] Responsive completo (mobile, tablet, desktop)
- [ ] Performance: lazy loading imágenes, compresión JSON
- [ ] SEO básico: meta tags, og:image por producto
- [ ] README.md del repo con instrucciones de setup

---

## Comandos útiles

```bash
# Instalar dependencias del sync
cd sync && npm install

# Correr sync manualmente
node sync/sync.js

# Servir localmente para desarrollo
npx serve . -p 3000

# Ver el sitio en producción
open https://cceren003.github.io/Catalogo-La-Central-Del-Repuesto
```

---

## Contacto y acceso

- **Repo:** https://github.com/cceren003/Catalogo-La-Central-Del-Repuesto
- **Sistema LCR:** https://dev.oss.com.sv/central_repuestos/dashboard.php
- **GitHub Pages URL:** https://cceren003.github.io/Catalogo-La-Central-Del-Repuesto
