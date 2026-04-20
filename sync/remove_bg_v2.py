#!/usr/bin/env python3
"""
Pipeline rembg mejorado:
  1) Pre: CLAHE en canal L (Lab) → contraste de bordes sin alterar color
  2) rembg con alpha_matting → bordes suaves, no se come partes negras
  3) Refine alpha: bilateral filter + morph cleanup
  4) Inner holes: llena regiones transparentes uniformes encerradas (fondo)
  5) Soft shadow: sombra suave debajo del producto
  6) Composite final sobre blanco

Uso:
  python remove_bg_v2.py <input_dir> <output_dir> [--model=u2net|isnet-general-use]
                         [--limit=N] [--workers=2] [--no-shadow]
"""
import argparse, io
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

# ═══════════════════════════════════════════
# 1) PREPROCESADO — CLAHE sobre canal L
# ═══════════════════════════════════════════
def preprocess(img_bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8))
    l = clahe.apply(l)
    merged = cv2.merge([l, a, b])
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)

# ═══════════════════════════════════════════
# 2) REMBG — con alpha matting para bordes suaves
# ═══════════════════════════════════════════
def run_rembg(img_bgr: np.ndarray, session) -> np.ndarray:
    """Retorna RGBA (BGR+A) después de rembg."""
    # rembg acepta PIL Image o bytes. Usamos bytes PNG.
    _, buf = cv2.imencode('.png', img_bgr)
    out_bytes = remove(
        buf.tobytes(),
        session=session,
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=20,
        alpha_matting_erode_size=5,
    )
    arr = np.frombuffer(out_bytes, dtype=np.uint8)
    rgba = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)  # BGRA
    if rgba is None:
        raise RuntimeError("rembg no retornó imagen válida")
    if rgba.shape[2] == 3:
        # Agregar alpha 255 si no vino
        alpha = np.full(rgba.shape[:2], 255, dtype=np.uint8)
        rgba = np.dstack([rgba, alpha])
    return rgba

# ═══════════════════════════════════════════
# 3) REFINE ALPHA — smoothing + morph cleanup
# ═══════════════════════════════════════════
def refine_alpha(rgba: np.ndarray) -> np.ndarray:
    alpha = rgba[:, :, 3].copy()
    # Bilateral edge-aware smoothing para bordes suaves sin perder detalle
    alpha = cv2.bilateralFilter(alpha, d=5, sigmaColor=40, sigmaSpace=40)
    # Morph close pequeño para cerrar micro-huecos en el producto (1 px)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, kernel, iterations=1)
    rgba = rgba.copy()
    rgba[:, :, 3] = alpha
    return rgba

# ═══════════════════════════════════════════
# 4) INNER HOLES — llena transparencias encerradas si son uniformes
# ═══════════════════════════════════════════
def fill_enclosed_holes(rgba: np.ndarray, original_bgr: np.ndarray,
                        min_area_pct: float = 0.005, uniformity_std: float = 20.0,
                        density_min: float = 0.55) -> np.ndarray:
    """
    Una región 'hueco' en alpha (transparente) que NO toca el borde de la imagen
    y que corresponde a fondo uniforme en la imagen original → queda transparente
    (i.e., se muestra blanco cuando componeemos sobre fondo blanco).

    Pero SI encontramos regiones del ORIGINAL que la máscara dejó como producto (alpha>0)
    pero son fondo (muy oscuras y uniformes), las convertimos a alpha=0.

    En la práctica con alpha matting esto es raro: rembg ya detecta el fondo. Esta
    función atrapa casos donde rembg dejó bg dentro de lazos cerrados.
    """
    h, w = rgba.shape[:2]
    img_area = h * w
    min_area = max(80, int(img_area * min_area_pct))
    border_pad = 2

    alpha = rgba[:, :, 3]
    # Pixels que rembg marcó como producto (alpha > 128)
    product_mask = (alpha > 128).astype(np.uint8) * 255
    # Dentro del producto, buscar regiones OSCURAS uniformes (candidatas a bg atrapado)
    gray = cv2.cvtColor(original_bgr, cv2.COLOR_BGR2GRAY)
    dark_in_product = ((gray < 60) & (alpha > 128)).astype(np.uint8) * 255

    num, labels, stats, _ = cv2.connectedComponentsWithStats(dark_in_product, connectivity=8)
    result = rgba.copy()
    for i in range(1, num):
        x, y, cw, ch, area = stats[i]
        if area < min_area:
            continue
        # No debe tocar el borde de la imagen
        if x <= border_pad or y <= border_pad or x + cw >= w - border_pad or y + ch >= h - border_pad:
            continue
        # Uniformidad: stddev de intensidad
        region_mask = labels[y:y+ch, x:x+cw] == i
        pixels = gray[y:y+ch, x:x+cw][region_mask]
        if pixels.std() >= uniformity_std:
            continue
        # Densidad
        if area / max(cw * ch, 1) < density_min:
            continue
        # Es fondo atrapado → alpha = 0
        result[:, :, 3][labels == i] = 0
    return result

# ═══════════════════════════════════════════
# 5) SOFT SHADOW — sombra natural debajo del producto
# ═══════════════════════════════════════════
def add_soft_shadow(rgba: np.ndarray, offset: int = 6, blur: int = 25,
                    opacity: float = 0.35) -> np.ndarray:
    """Crea un shadow layer gris difuso desplazado hacia abajo, con opacidad baja."""
    h, w = rgba.shape[:2]
    alpha = rgba[:, :, 3]
    # Shadow = alpha original desplazada + blur
    M = np.array([[1, 0, 0], [0, 1, offset]], dtype=np.float32)
    shadow_alpha = cv2.warpAffine(alpha, M, (w, h), borderValue=0)
    shadow_alpha = cv2.GaussianBlur(shadow_alpha, (0, 0), sigmaX=blur / 3, sigmaY=blur / 3)
    shadow_alpha = (shadow_alpha * opacity).astype(np.uint8)

    # Componer sombra gris (no negra) en canvas blanco
    canvas = np.full((h, w, 3), 255, dtype=np.uint8)  # white bg
    shadow_rgb = np.full((h, w, 3), 60, dtype=np.uint8)  # dark gray shadow

    # Composite shadow sobre canvas
    shadow_alpha_f = shadow_alpha.astype(np.float32) / 255.0
    for c in range(3):
        canvas[:, :, c] = (shadow_rgb[:, :, c] * shadow_alpha_f + canvas[:, :, c] * (1 - shadow_alpha_f)).astype(np.uint8)

    # Ahora componer el producto encima
    product_alpha_f = alpha.astype(np.float32) / 255.0
    for c in range(3):
        canvas[:, :, c] = (rgba[:, :, c] * product_alpha_f + canvas[:, :, c] * (1 - product_alpha_f)).astype(np.uint8)

    return canvas

# ═══════════════════════════════════════════
# 6) SIMPLE COMPOSITE — sin sombra
# ═══════════════════════════════════════════
def composite_on_white(rgba: np.ndarray) -> np.ndarray:
    h, w = rgba.shape[:2]
    canvas = np.full((h, w, 3), 255, dtype=np.uint8)
    alpha_f = rgba[:, :, 3].astype(np.float32) / 255.0
    for c in range(3):
        canvas[:, :, c] = (rgba[:, :, c] * alpha_f + canvas[:, :, c] * (1 - alpha_f)).astype(np.uint8)
    return canvas

# ═══════════════════════════════════════════
# PIPELINE PRINCIPAL
# ═══════════════════════════════════════════
def process_image(input_path: Path, output_path: Path, session, use_shadow: bool = True):
    img = cv2.imread(str(input_path))
    if img is None:
        raise ValueError(f"no se pudo leer {input_path}")
    # 1) Pre
    enhanced = preprocess(img)
    # 2) rembg
    rgba = run_rembg(enhanced, session)
    # 3) Refine alpha
    rgba = refine_alpha(rgba)
    # 4) Inner holes
    rgba = fill_enclosed_holes(rgba, img)
    # 5) Composite con o sin sombra
    if use_shadow:
        out = add_soft_shadow(rgba, offset=5, blur=20, opacity=0.3)
    else:
        out = composite_on_white(rgba)
    cv2.imwrite(str(output_path), out, [cv2.IMWRITE_JPEG_QUALITY, 92])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_dir")
    ap.add_argument("output_dir")
    ap.add_argument("--model", default="u2net")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--no-shadow", action="store_true")
    ap.add_argument("--files", nargs="*", default=None, help="Lista específica de nombres de archivo")
    args = ap.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.files:
        files = [input_dir / f for f in args.files if (input_dir / f).exists()]
    else:
        files = sorted([p for p in input_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png")])
    if args.limit:
        files = files[:args.limit]

    print(f"→ {len(files)} archivos con modelo {args.model} (shadow={'sí' if not args.no_shadow else 'no'})")
    session = new_session(args.model)

    done = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process_image, p, output_dir / p.name, session, not args.no_shadow): p for p in files}
        for fut in as_completed(futures):
            p = futures[fut]
            try:
                fut.result()
                done += 1
            except Exception as e:
                errors += 1
                print(f"  ERR {p.name}: {str(e)[:100]}")
            if (done + errors) % 10 == 0 or (done + errors) == len(files):
                print(f"  {done+errors}/{len(files)} | ok {done} | err {errors}")

    print(f"\n✓ Procesadas: {done}")
    print(f"✗ Errores: {errors}")

if __name__ == "__main__":
    main()
