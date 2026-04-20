#!/usr/bin/env python3
"""
Migra imágenes de proveedor a /imagenes/ del proyecto:
  1. Valida que cada imagen corresponda a un SKU del catalogo.json.
  2. Renombra con el SKU exacto (sin modificar contenido).
  3. Copia a /imagenes/ (se conserva la fuente original).
  4. Genera reporte: válidas, duplicadas, sin match, variantes secundarias,
     SKUs del catálogo SIN imagen.

Reglas de nombre→SKU:
  VINI: 741540xxxxxx.png → SKU tal cual
  MEK:  1000003.jpg → SKU tal cual (numérico)
  NRP:  420H-1CL.jpg → SKU tal cual
        420H-1CL_2.jpg → misma SKU, variante secundaria (se ignora por ahora)
  AXUS: LA1A-0601-22.png → probar como LA1A-0601-22 y LA1A-0601 (sin -22)

Uso:
  python migrate_images.py
"""
import json, shutil, re
from pathlib import Path
from collections import defaultdict

WORKTREE = Path(__file__).resolve().parent.parent
SOURCE_ROOT = Path(r"C:/Users/cgcer/IMAGENES CATALOGO")
DEST = WORKTREE / "imagenes"
CATALOG_JSON = WORKTREE / "catalogo.json"
REPORT_PATH = WORKTREE / "migration_report.md"

SUBFOLDERS = {
    "IMAGEN VINI": "VINI",
    "IMAGEN MEK":  "MEK",
    "IMAGEN NRP":  "NRP",
    "IMAGEN LLANTAS AXUS": "AXUS",
}


def load_catalog_skus():
    """Carga set de SKUs válidos desde catalogo.json (upper-case)."""
    with open(CATALOG_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    productos = data if isinstance(data, list) else data.get("productos", [])
    by_sku = {}
    for p in productos:
        sku = p.get("sku", "").strip()
        if sku:
            by_sku[sku.upper()] = p
    return by_sku


def candidate_skus_from_filename(filename: str, fuente: str) -> list[str]:
    """Genera candidatos de SKU a partir del nombre del archivo."""
    stem = Path(filename).stem.strip()
    candidates = [stem]
    # Variantes con _2, _3, _04, etc. al final → quitar
    m = re.match(r"^(.+?)_\d+$", stem)
    if m:
        candidates.append(m.group(1))
    # AXUS: "-22" al final suele ser medida/año, probar sin él
    if fuente == "AXUS":
        m2 = re.match(r"^(.+?)-\d+$", stem)
        if m2:
            candidates.append(m2.group(1))
    # Return únicos preservando orden
    seen = set()
    out = []
    for c in candidates:
        cu = c.upper()
        if cu not in seen:
            seen.add(cu)
            out.append(c)
    return out


def main():
    DEST.mkdir(exist_ok=True)
    catalog_by_sku = load_catalog_skus()
    print(f"→ catalogo.json: {len(catalog_by_sku)} SKUs únicos")

    # Estadísticas
    source_to_target = {}     # source_path → (sku, fuente, is_secondary)
    sku_to_sources = defaultdict(list)  # sku → list of source paths (para detectar duplicados)
    unmatched = []            # archivos sin SKU válido
    secondary_variants = []   # archivos con _2, _3 (ignorados)

    # Scan sources
    total = 0
    for folder, fuente in SUBFOLDERS.items():
        src = SOURCE_ROOT / folder
        if not src.is_dir():
            print(f"  ⚠ no existe {src}")
            continue
        for file in sorted(src.iterdir()):
            if not file.is_file():
                continue
            if file.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
                continue
            total += 1

            stem = file.stem
            is_secondary = bool(re.search(r"_\d+$", stem))

            # Buscar SKU válido
            matched_sku = None
            for cand in candidate_skus_from_filename(file.name, fuente):
                if cand.upper() in catalog_by_sku:
                    matched_sku = cand
                    break

            if matched_sku:
                if is_secondary:
                    secondary_variants.append((file, matched_sku, fuente))
                else:
                    sku_to_sources[matched_sku.upper()].append((file, fuente))
                    source_to_target[file] = (matched_sku, fuente)
            else:
                unmatched.append((file, fuente))

    print(f"→ total archivos escaneados: {total}")
    print(f"→ con SKU válido (primario): {len(source_to_target)}")
    print(f"→ variantes secundarias (_2, _3...): {len(secondary_variants)}")
    print(f"→ sin match en catálogo: {len(unmatched)}")

    # Copiar primarios (no secondaries por ahora)
    copied = 0
    duplicates = []  # SKUs con más de una fuente primaria
    for sku_upper, sources in sku_to_sources.items():
        if len(sources) > 1:
            duplicates.append((sku_upper, [(str(s[0]), s[1]) for s in sources]))
            # Usar el primero (puede ser heurística mejor: preferir mayor tamaño)
            sources_sorted = sorted(sources, key=lambda s: s[0].stat().st_size, reverse=True)
            file, fuente = sources_sorted[0]
        else:
            file, fuente = sources[0]
        # Preservar SKU exacto del catálogo (case correcto)
        real_sku = catalog_by_sku[sku_upper]["sku"]
        ext = file.suffix.lower()
        dest_file = DEST / f"{real_sku}{ext}"
        try:
            shutil.copy2(file, dest_file)
            copied += 1
        except Exception as e:
            print(f"  ERR copiando {file.name}: {e}")

    # SKUs del catálogo sin imagen
    matched_sku_set = {sku.upper() for sku in sku_to_sources.keys()}
    missing = []
    for sku_upper, prod in catalog_by_sku.items():
        if sku_upper not in matched_sku_set:
            missing.append((prod.get("sku"), prod.get("nombre", ""), prod.get("marca", "")))

    # ═══════════════════════════════════════════
    # REPORTE
    # ═══════════════════════════════════════════
    lines = []
    lines.append("# Reporte de migración de imágenes")
    lines.append("")
    lines.append(f"**Fuente:** `{SOURCE_ROOT}`")
    lines.append(f"**Destino:** `/imagenes/` (proyecto)")
    lines.append(f"**Catálogo:** {len(catalog_by_sku)} SKUs únicos")
    lines.append("")
    lines.append("## Resumen")
    lines.append("")
    lines.append(f"| Métrica | Cantidad |")
    lines.append(f"|---|---:|")
    lines.append(f"| Archivos fuente escaneados | {total} |")
    lines.append(f"| Con match en catálogo (primarios) | {len(source_to_target)} |")
    lines.append(f"| Variantes secundarias ignoradas (`_2`, `_3`, …) | {len(secondary_variants)} |")
    lines.append(f"| Sin match en catálogo | {len(unmatched)} |")
    lines.append(f"| **Copiados a `/imagenes/`** | **{copied}** |")
    lines.append(f"| SKUs con múltiples fuentes (duplicados) | {len(duplicates)} |")
    lines.append(f"| SKUs del catálogo SIN imagen | {len(missing)} |")
    lines.append("")

    # Desglose por fuente
    lines.append("## Desglose por proveedor")
    lines.append("")
    lines.append("| Proveedor | Archivos fuente | Con match | Sin match | Secundarios |")
    lines.append("|---|---:|---:|---:|---:|")
    for folder, fuente in SUBFOLDERS.items():
        src = SOURCE_ROOT / folder
        if not src.is_dir():
            continue
        total_f = len([f for f in src.iterdir() if f.is_file()
                        and f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
        matched_f = sum(1 for v in source_to_target.values() if v[1] == fuente)
        unmatched_f = sum(1 for u in unmatched if u[1] == fuente)
        sec_f = sum(1 for sv in secondary_variants if sv[2] == fuente)
        lines.append(f"| {fuente} | {total_f} | {matched_f} | {unmatched_f} | {sec_f} |")
    lines.append("")

    # Duplicados
    if duplicates:
        lines.append("## Duplicados (mismo SKU en múltiples archivos)")
        lines.append("")
        lines.append("Se eligió el archivo de mayor tamaño como primario.")
        lines.append("")
        for sku, sources in duplicates[:200]:
            lines.append(f"- **{sku}**")
            for path_str, fuente in sources:
                lines.append(f"  - `{Path(path_str).name}` ({fuente})")
        if len(duplicates) > 200:
            lines.append(f"\n… y {len(duplicates) - 200} más")
        lines.append("")

    # Sin match
    if unmatched:
        lines.append(f"## Sin match en catálogo ({len(unmatched)})")
        lines.append("")
        lines.append("Archivos cuyo nombre no coincide con ningún SKU del `catalogo.json`.")
        lines.append("")
        by_fuente = defaultdict(list)
        for f, fuente in unmatched:
            by_fuente[fuente].append(f.name)
        for fuente, names in by_fuente.items():
            lines.append(f"### {fuente} ({len(names)})")
            lines.append("")
            for name in names[:100]:
                lines.append(f"- `{name}`")
            if len(names) > 100:
                lines.append(f"- … y {len(names) - 100} más")
            lines.append("")

    # Missing en catálogo
    if missing:
        lines.append(f"## SKUs del catálogo SIN imagen ({len(missing)})")
        lines.append("")
        by_marca = defaultdict(list)
        for sku, nombre, marca in missing:
            by_marca[marca or "(sin marca)"].append((sku, nombre))
        for marca, items in sorted(by_marca.items(), key=lambda x: -len(x[1])):
            lines.append(f"### {marca} ({len(items)})")
            lines.append("")
            for sku, nombre in items[:50]:
                lines.append(f"- `{sku}` — {nombre}")
            if len(items) > 50:
                lines.append(f"- … y {len(items) - 50} más")
            lines.append("")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n✓ Copiados: {copied}")
    print(f"✓ Reporte: {REPORT_PATH}")


if __name__ == "__main__":
    main()
