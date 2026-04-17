# Fase 1 — Exploración del sistema LCR

**Fecha:** 2026-04-17
**Sistema:** https://dev.oss.com.sv/central_repuestos/
**Usuario explorando:** CESAR GUILLERMO CEREN ECHEVERRIA
**Sucursal activa:** LA CENTRAL DEL REPUESTO
**Plataforma origen:** OpenSolutionSystems (ERP PHP multi-sucursal con DataTables jQuery)

---

## 1. Exportación del inventario

### Endpoint principal: `ver_reporte_inventario.php`

Es el reporte listo para consumo externo. Form POST con dos botones (`submit1`, `submit2`):

| Campo         | Tipo        | Valores                                                       |
|---------------|-------------|---------------------------------------------------------------|
| `sucursal`    | select      | `0` = General, `1` = LA CENTRAL DEL REPUESTO, `2` = VEHICULO #1 N300 |
| `submit1`     | button/PDF  | Genera PDF del inventario                                     |
| `submit2`     | button/EXCEL| Genera archivo Excel (.xls/.xlsx) del inventario **← usable para sync** |

**Cómo se usaría en `sync/sync.js`:** login (cookie PHPSESSID) → POST a `ver_reporte_inventario.php` con `sucursal=0&submit2=EXCEL` → parsear Excel con `xlsx` o `exceljs` → mapear a `catalogo.json`.

### Endpoints alternativos (revisados, descartados como fuente primaria)

- `admin_producto.php` — grid DataTables con columnas `Id, Stock, Barcode, Descripcion, Categoria, Proveedor, Exento, Estado`. Sin botones de export nativos.
- `admin_stock.php` ("Consultar Existencias") — grid con `Código, Producto, Categoría, Ubicación, Presentación, Descripción, Precios, Existencia`. Muestra **solo 4 precios** concatenados en una sola celda ("$12.00, $11.00, $10.00, $9.16"). Sin export.
- `ver_producto_precios.php` ("Reporte Productos y Precios") — genera PDF filtrado por tipo (Exento/Gravado) y **muestra hasta 4 precios** (Precio 1-4). No cubre los 7 niveles. Solo tiene botón "Imprimir PDF".
- `reporte_inventario_fecha.php` — inventario a una fecha histórica (útil a futuro, no para sync diario).
- `reporte_kardex.php` / `reporte_kardex_general.php` — movimientos, no snapshot de stock.
- `backup.php` — respaldo de BD (sin explorar por privilegios).

**Conclusión export:** el único endpoint que trae **todos los productos con stock y todos los precios en formato máquina** es el Excel de `ver_reporte_inventario.php`. Confirmar columnas reales del Excel descargando uno de prueba antes de cablear el parser.

---

## 2. Los 7 campos de precio — CONFIRMADOS

En el formulario `editar_producto.php?id_producto=<ID>` aparecen los 7 inputs numéricos de precio en el orden mostrado abajo. Cada uno corresponde a uno de los 7 tipos de cliente configurados en `admin_tipo_cliente.php`.

### Mapa: `tipo_cliente` ↔ campo de precio

| # | Tipo de cliente (ID)               | Campo en producto       | Nombre en UI              |
|---|------------------------------------|-------------------------|---------------------------|
| 1 | B2C CLIENTE INTEGRAL (id 2)        | `publico_servicio`      | "PUBLICO + SERVICIO"      |
| 2 | B2C CLIENTE MOSTRADOR (id 3)       | `publico_para_llevar`   | "PUBLICO PARA LLEVAR"     |
| 3 | B2C CLIENTE EN LINEA (id 4)        | `descuento_publico`     | "10% DESCUENTO PUBLICO"   |
| 4 | B2B TALLER (id 5)                  | `taller_4`              | "TALLER 4"                |
| 5 | B2B ALIADOS COMERCIALES (id 6)     | `taller_5`              | "TALLER 5"                |
| 6 | VENTA EN RUTA (id 7)               | `taller_6`              | "TALLER 5" (label duplicado, name único) |
| 7 | GRANDES MAYORISTAS (id 8)          | `mayoreo`               | "MAYOREO"                 |

### Mapeo FINAL al schema de `catalogo.json` (decisión 2026-04-17)

De los 7 precios del sistema LCR, solo **3 entran al catálogo web**. Los otros 4 son descuentos u operativos internos y se descartan en el sync. El costo nunca sale del sistema LCR.

| Precio web        | Campo LCR origen      | Tipo de cliente            | ¿Va al JSON? |
|-------------------|-----------------------|----------------------------|--------------|
| `publico`         | `publico_para_llevar` | Público (sin login)        | ✅ sí        |
| (oculto)          | `publico_servicio`    | incluye mano de obra       | ❌ no        |
| (oculto)          | `descuento_publico`   | descuento ya contemplado   | ❌ no        |
| `taller`          | `taller_4`            | Taller / mayorista         | ✅ sí        |
| (oculto)          | `taller_5`            | descuento mayorista interno| ❌ no        |
| `distribuidor`    | `taller_6`            | Distribuidor               | ✅ sí        |
| (oculto)          | `mayoreo`             | descuento distribuidor     | ❌ no        |
| (ninguno)         | `costo`               | interno LCR                | ❌ nunca     |

**Estructura resultante en `catalogo.json`:**

```json
"precios": {
  "publico": 12.00,
  "taller": 10.00,
  "distribuidor": 9.16
}
```

**Auth.js — 3 roles únicamente:** `publico` (default sin login), `taller`, `distribuidor`.

---

## 3. Estructura de campos disponibles (producto)

### Campos editables en `editar_producto.php`

| Campo              | Tipo        | Notas                                         |
|--------------------|-------------|-----------------------------------------------|
| `id_producto`      | int (PK)    | ID interno LCR (ej. 6)                        |
| `barcode`          | string      | Código de barra (ej. `3374650263717`)         |
| `descripcion`      | string      | Nombre/descripción corta del producto         |
| `marca`            | FK → `admin_marca`       | Marca del repuesto                 |
| `id_categoria`     | FK → `admin_categoria`   | Categoría                          |
| `id_presentacion`  | FK → `admin_presentacion`| Unidad/presentación (UNIDAD, etc.) |
| `proveedor`        | FK → `admin_proveedor`   |                                    |
| `minimo`           | int         | Stock mínimo para alerta                      |
| `exento`           | bool        | Exento de IVA                                 |
| `perecedero`       | bool        |                                               |
| `activo`           | bool        | Producto visible/activo                       |
| `decimal`          | bool        | Permite cantidades decimales                  |
| `exclusivo_pedido` | bool        | Solo por pedido (¿no mostrar stock?)          |
| `aplica_dif`       | bool        | Aplica diferenciación (¿por sala/sucursal?)   |
| `composicion`      | textarea    | Máximo 4 líneas — buen candidato para `specs` |
| `logo`             | file        | Imagen del producto                           |
| **7 precios**      | number      | Ver sección 2                                 |

### Campos adicionales en `admin_stock.php` (por producto+sucursal)

- `codigo` (alias SKU) — ej. `LM120106`
- `ubicacion` — CONSOLIDADO, LOCAL DE VENTA, PELDAÑO 1, ESTANTE UNO, etc.
- `existencia` — stock actual (int)
- `precios` — string concatenado (se reconstruye desde los 7 campos)

### Stock / Existencias — multi-sucursal

El stock NO está en `editar_producto.php`, vive en `admin_stock.php` por sucursal:
- `LA CENTRAL DEL REPUESTO` (sucursal 1) — tienda física principal
- `VEHICULO #1 N300` (sucursal 2) — ventas en ruta

**Decisión pendiente:** el JSON público debe mostrar stock consolidado o solo el de la tienda principal. Recomiendo **consolidado (sucursal=0)** para que el cliente web vea "sí hay" aunque esté en la camioneta.

---

## 4. Recursos laterales útiles para el sync

- `admin_categoria.php` → maestro de categorías (para filtros del catálogo web)
- `admin_marca.php` → maestro de marcas de repuesto
- `admin_presentacion.php` → unidades (para mostrar "$X por UNIDAD/GALON/LITRO")
- `admin_tipo_cliente.php` → confirmación del mapeo de precios
- `ver_reporte_utilidad.php` → si en algún momento se necesita el costo interno (p1)

---

## 5. Riesgos y observaciones

1. **El label "TALLER 5" está duplicado** en el form de edición (aparece dos veces — uno mapea a `taller_5` y otro a `taller_6`). Bug cosmético del sistema, no bloquea. Usar el `name` del input, no el label.
2. **Los tipos de cliente ID 2-8 ocupan los 7 slots**; no hay ID 1 ni 9+. Si en el futuro agregan un 8° tipo, el schema necesita extenderse.
3. **Sin endpoint JSON/API** visible — el ERP es PHP tradicional + DataTables server-side. El sync necesita **scraping con sesión autenticada** (cookie PHPSESSID) + parseo del Excel exportado.
4. **Puppeteer probablemente necesario**: el login es formulario clásico, pero DataTables usan JS. Para el Excel de `ver_reporte_inventario.php` bastaría `node-fetch` + submit de form. Para admin_producto.php (si en algún momento lo necesitamos) requeriría Puppeteer o llamar directo al endpoint AJAX de DataTables.
5. **Sin rate-limit visible**, pero el sync de 3×/día sugerido en CLAUDE.md no debería causar problemas.
6. **Imágenes de producto**: el campo `logo` acepta upload, pero no hay endpoint listado para descargarlas en bulk. Posiblemente se sirvan desde `/central_repuestos/img/productos/<id>.ext` — hay que inspeccionar una ficha para confirmar URL.

---

## 6. Estructura real del Excel descargado

**Archivo de muestra:** `sync/reporte_inventario_sample.xls` (descargado 2026-04-17, sucursal=0/General)
**Nombre que genera el sistema:** `reporte_inventario_DDMMYYYY.xls` (formato Excel 97-2003 con OLE header, pero internamente OpenXML-compatible generado por PHPExcel)
**Hoja:** 1 sola, llamada `Reporte inventario`
**Dimensiones:** 1978 filas × 17 columnas

### Layout del archivo

| Fila(s)   | Contenido                                       | Uso en el parser |
|-----------|-------------------------------------------------|------------------|
| 1         | `LA CENTRAL DEL REPUESTO` (razón social)        | Saltar           |
| 2         | Dirección                                        | Saltar           |
| 3         | `REPORTE INVENTARIO`                             | Saltar           |
| 4         | `AL DD DE MES DE YYYY` (fecha de corte)         | **Capturar** → `ultima_sync` |
| 5         | **Encabezados de columna**                      | Validar headers  |
| 6 — N-1   | Filas de producto (1 por SKU)                   | **Parsear**      |
| N (última)| `TOTALES` + suma en col J                       | **Saltar** (filtrar por `codigo === 'TOTALES'`) |

En la muestra: **1972 productos reales** (filas 6 → 1977). Row 1978 = `TOTALES`.

### Columnas exactas (fila 5) y mapeo al `catalogo.json`

| Col | Header Excel | Tipo  | Ejemplo              | Campo `catalogo.json`    | Nota |
|-----|--------------|-------|----------------------|--------------------------|------|
| A   | `CODIGO`     | str   | `LM120106`           | `sku`                    | Código interno LCR |
| B   | `PRODUCTO`   | str   | `ACEITE 20W50 SEMISINTETICO 5100 MOTUL` | `nombre` | |
| C   | `MARCA`      | str   | `MOTUL`              | `marca_repuesto`         | |
| D   | `CATEGORIA`  | str   | `ACEITES`            | `categoria`              | Normalizar a slug lowercase |
| E   | `PRESENTACION` | str | `UNIDAD`             | `specs.presentacion`     | Unidad de venta |
| F   | `DESCRIPCION`| str   | `1*1`                | `specs.empaque` (?)      | Formato tipo "1*1" — aclarar con cliente qué significa |
| G   | `UBICACION`  | str   | `CR ESTANTE 7, P: 4` / `NO ASIGNADO` | — | **Descartar** (interno) |
| H   | `COSTO`      | num   | `8.125039`           | —                        | **Descartar** (decisión del usuario) |
| I   | `EXISTENCIA` | int   | `61`                 | `stock`                  | Entero. Deriva `stock_status` |
| J   | `TOTAL($)`   | num   | `438.6083`           | —                        | **Descartar** (stock × costo, expone costo) |
| K   | `PRECIO 1`   | num   | `12`                 | —                        | **Descartar** (incluye mano de obra) |
| L   | `PRECIO 2`   | num   | `11`                 | `precios.publico` ✅     | |
| M   | `PRECIO 3`   | num   | `10`                 | —                        | **Descartar** (descuento público) |
| N   | `PRECIO 4`   | num   | `9.1666`             | `precios.taller` ✅      | |
| O   | `PRECIO 5`   | num   | `8.75`               | —                        | **Descartar** (descuento mayorista) |
| P   | `PRECIO 6`   | num   | `8.666`              | `precios.distribuidor` ✅| |
| Q   | `PRECIO 7`   | num   | `8.666`              | —                        | **Descartar** (descuento distribuidor) |

**Verificado con fila 6 (`LM120106` — ACEITE 20W50 MOTUL):**
- stock: 61
- precios.publico (L/P2): $11.00
- precios.taller (N/P4): $9.1666 (redondear a 2 decimales → $9.17)
- precios.distribuidor (P/P6): $8.666 (redondear a 2 decimales → $8.67)

### Observaciones para el parser

1. **Precios con decimales variables** (ej. `9.1666`, `8.666`): redondear a 2 decimales al generar el JSON.
2. **Productos sin precio** (todos los "PRECIO N" vacíos) pueden existir — el parser debe manejar celdas vacías como `null` o `0`, y marcarlos con `activo: false` o filtrarlos.
3. **Categorías en mayúsculas** (`ACEITES`, `FRENOS`, `FRICCION`, `ACCESORIOS`): normalizar a slug lowercase + acentos. Generar un maestro de categorías para el filtro del catálogo.
4. **Presentación** generalmente es `UNIDAD`, pero pueden aparecer `GALON`, `LITRO`, etc. — construir enum desde el primer sync.
5. **`CODIGO` no es `barcode`** — es el código interno LCR (ej. `LM120106`, `HRO-VISOR-511`, `BS013`). El barcode EAN/UPC (ej. `3374650263717`) está en otro campo del sistema (`editar_producto.php` → `barcode`) que **no aparece en este Excel**. Si lo necesitamos para el catálogo web, hay que tomarlo de otra fuente o agregarlo manualmente.
6. **Imágenes de producto**: tampoco vienen en el Excel. Hay que descargarlas aparte (endpoint por confirmar en Fase 2).

---

## 7. Siguientes pasos (Fase 1 → Fase 2)

- [x] Descargar el Excel de prueba y documentar columnas reales → hecho (§6).
- [ ] Confirmar URL pública de las imágenes de producto (abrir una ficha con `ver_producto.php` y capturar el src del `<img>`).
- [ ] Decidir si necesitamos `barcode` en el catálogo (si sí, segundo request al sistema por cada producto o solución alterna).
- [ ] Escribir `sync/sync.js` básico: login → descargar Excel → parsear (usando `xlsx` de Node o similar) → generar `catalogo.json`.
- [ ] Capturar credenciales de sync en `sync/config.json` (en `.gitignore`, nunca al repo).
