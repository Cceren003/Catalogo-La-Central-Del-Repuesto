#!/usr/bin/env python3
"""
Extrae imágenes de un PDF catálogo usando PyMuPDF (fitz):
  - Compone correctamente el alpha channel sobre fondo BLANCO al extraer.
  - Matchea cada imagen a su SKU por orden en la página (top→bottom, left→right).
  - Normaliza: trim whitespace → centrar en canvas 800x800 blanco → WebP q=90.

NO usa rembg/IA. NO modifica colores del producto.

Uso:
  python extract_fitz.py <pdf_path> <output_dir> [--sku-regex=\\d{12}]
                         [--size=800] [--pad-pct=0.125] [--quality=90]
                         [--limit-pages=N] [--min-img-area=8000]
"""
import argparse, re
from pathlib import Path
from io import BytesIO

import fitz  # PyMuPDF
import numpy as np
from PIL import Image


# ═══════════════════════════════════════════
# EXTRACCIÓN con fitz — alpha → blanco
# ═══════════════════════════════════════════
def extract_image_from_xref(doc: fitz.Document, xref: int) -> bytes:
    """
    Extrae xref como PNG con alpha compuesto sobre fondo blanco.
    Maneja CMYK, alpha, smask automáticamente.
    """
    pix = fitz.Pixmap(doc, xref)
    # CMYK → RGB
    if pix.n > 3 and not pix.alpha:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    # Con alpha → componer sobre blanco
    if pix.alpha:
        # Crear pixmap blanco del mismo tamaño SIN alpha
        bg = fitz.Pixmap(fitz.csRGB, pix.irect, False)
        bg.set_rect(bg.irect, (255, 255, 255))
        # Componer pix sobre bg (pix.alpha se usa para blending)
        pix = fitz.Pixmap(bg, pix)
    # Si acaso aún tiene CMYK → RGB
    if pix.n > 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    return pix.tobytes("png")


# ═══════════════════════════════════════════
# NORMALIZACIÓN: trim + center + 800x800 WebP
# ═══════════════════════════════════════════
def normalize_to_canvas(png_bytes: bytes, output_path: Path,
                        canvas_size: int = 800, pad_pct: float = 0.125,
                        quality: int = 90) -> dict:
    img = Image.open(BytesIO(png_bytes)).convert("RGB")
    arr = np.asarray(img)

    # Detectar fondo auto (debería ser blanco post-extract, pero por seguridad)
    h, w = arr.shape[:2]
    corners = np.concatenate([
        arr[:10, :10].reshape(-1, 3),
        arr[:10, -10:].reshape(-1, 3),
        arr[-10:, :10].reshape(-1, 3),
        arr[-10:, -10:].reshape(-1, 3),
    ])
    avg_brightness = corners.mean()
    bg_kind = "dark" if avg_brightness < 100 else "light"

    # Máscara del producto
    if bg_kind == "dark":
        mask = np.any(arr > 30, axis=-1)
    else:
        mask = np.any(arr < 245, axis=-1)

    if not mask.any():
        canvas = Image.new("RGB", (canvas_size, canvas_size), (255, 255, 255))
        canvas.save(output_path, "WEBP", quality=quality, method=6)
        return {"empty": True, "bg": bg_kind}

    # BBox
    rows_any = np.any(mask, axis=1)
    cols_any = np.any(mask, axis=0)
    rmin, rmax = np.where(rows_any)[0][[0, -1]]
    cmin, cmax = np.where(cols_any)[0][[0, -1]]
    bbox = (int(cmin), int(rmin), int(cmax) + 1, int(rmax) + 1)

    # Si bg oscuro, reemplazar bg con blanco antes de crop
    if bg_kind == "dark":
        arr_clean = arr.copy()
        arr_clean[~mask] = [255, 255, 255]
        img = Image.fromarray(arr_clean)

    cropped = img.crop(bbox)
    cw, ch = cropped.size

    # Padding 12.5% → producto ~80% del canvas
    pad = int(max(cw, ch) * pad_pct)
    padded_w = cw + 2 * pad
    padded_h = ch + 2 * pad
    scale = min(canvas_size / padded_w, canvas_size / padded_h)
    new_w = max(1, int(cw * scale))
    new_h = max(1, int(ch * scale))
    if (new_w, new_h) != cropped.size:
        cropped = cropped.resize((new_w, new_h), Image.LANCZOS)

    # Canvas 800x800 blanco + paste centrado
    canvas = Image.new("RGB", (canvas_size, canvas_size), (255, 255, 255))
    px = (canvas_size - new_w) // 2
    py = (canvas_size - new_h) // 2
    canvas.paste(cropped, (px, py))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, "WEBP", quality=quality, method=6)
    return {"bg": bg_kind, "placed": (new_w, new_h)}


# ═══════════════════════════════════════════
# MATCHING: image bbox ↔ SKU (top→bottom, left→right)
# ═══════════════════════════════════════════
def match_images_to_skus(page: fitz.Page, sku_regex: re.Pattern, min_img_area: int):
    """
    Retorna lista de (sku, xref) pareados por orden de lectura.
    """
    # 1) SKUs con posiciones (texto)
    text_dict = page.get_text("dict")
    skus = []
    for block in text_dict.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                txt = span.get("text", "").strip()
                if sku_regex.match(txt):
                    bbox = span.get("bbox")  # (x0, y0, x1, y1)
                    if bbox:
                        skus.append({
                            "sku": txt, "x": bbox[0], "y": bbox[1],
                        })
    if not skus:
        return []

    # Ordenar SKUs por filas aproximadas (banda de 30pt) y luego por x
    skus.sort(key=lambda s: (int(s["y"] // 30), s["x"]))

    # 2) Imágenes con bbox — filtrar las pequeñas/decorativas
    imgs_info = page.get_image_info(xrefs=True)  # retorna bbox on page + xref
    products = []
    for info in imgs_info:
        w, h = info["width"], info["height"]
        if w * h < min_img_area:
            continue
        ar = w / h if h > 0 else 0
        if ar > 4 or ar < 0.25:
            continue
        bbox = info.get("bbox")
        if not bbox:
            continue
        xref = info.get("xref", 0)
        if xref <= 0:
            continue
        products.append({
            "xref": xref, "x": bbox[0], "y": bbox[1],
            "x_center": (bbox[0] + bbox[2]) / 2,
            "y_center": (bbox[1] + bbox[3]) / 2,
            "w": w, "h": h,
        })

    if len(products) != len(skus):
        return None  # mismatch — skip esta página

    # Ordenar imágenes igual que SKUs (por fila, luego x)
    products.sort(key=lambda p: (int(p["y_center"] // 30), p["x_center"]))

    return list(zip([s["sku"] for s in skus], [p["xref"] for p in products]))


# ═══════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf_path")
    ap.add_argument("output_dir")
    ap.add_argument("--sku-regex", default=r"\d{12}")
    ap.add_argument("--size", type=int, default=800)
    ap.add_argument("--pad-pct", type=float, default=0.125)
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--limit-pages", type=int, default=None)
    ap.add_argument("--min-img-area", type=int, default=8000)
    ap.add_argument("--only-skus", nargs="*", default=None,
                    help="Procesar SOLO estos SKUs (para test)")
    args = ap.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    sku_regex = re.compile(f"^{args.sku_regex}$")
    only_skus = set(args.only_skus) if args.only_skus else None

    doc = fitz.open(args.pdf_path)
    total_pages = doc.page_count
    limit = args.limit_pages or total_pages
    print(f"PDF: {Path(args.pdf_path).name} — {total_pages} pages (procesando hasta {limit})")
    if only_skus:
        print(f"  FILTRO: solo SKUs {only_skus}")

    stats = {"saved": 0, "mismatch": 0, "errors": 0, "pages_done": 0}
    for page_idx in range(min(limit, total_pages)):
        page = doc.load_page(page_idx)
        pairs = match_images_to_skus(page, sku_regex, args.min_img_area)
        if pairs is None:
            stats["mismatch"] += 1
            continue
        for sku, xref in pairs:
            if only_skus and sku not in only_skus:
                continue
            try:
                png_bytes = extract_image_from_xref(doc, xref)
                out = output_dir / f"{sku}.webp"
                normalize_to_canvas(png_bytes, out, args.size, args.pad_pct, args.quality)
                stats["saved"] += 1
            except Exception as e:
                stats["errors"] += 1
                print(f"  ERR page {page_idx+1} sku {sku}: {str(e)[:100]}")
        stats["pages_done"] += 1
        if stats["pages_done"] % 50 == 0:
            print(f"  {stats['pages_done']}/{limit} páginas | saved: {stats['saved']} | mismatch: {stats['mismatch']}")
        if only_skus and stats["saved"] >= len(only_skus):
            break  # early exit si ya tenemos todos los samples pedidos

    doc.close()
    print(f"\n=== RESULTADO ===")
    print(f"Páginas procesadas: {stats['pages_done']}")
    print(f"Imágenes guardadas: {stats['saved']}")
    print(f"Páginas con mismatch imagen↔SKU: {stats['mismatch']}")
    print(f"Errores: {stats['errors']}")
    print(f"→ Output: {output_dir}")


if __name__ == "__main__":
    main()
