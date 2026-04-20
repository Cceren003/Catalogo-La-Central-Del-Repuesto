#!/usr/bin/env python3
"""
Limpia "inner holes" de imágenes de producto:
1. Convierte a grayscale y detecta píxeles oscuros (< threshold).
2. Encuentra componentes conectados de píxeles oscuros.
3. Los componentes que NO tocan el borde de la imagen son regiones
   enceradas por el producto (trapped bg) → se pintan de blanco.
4. Respeta las regiones pequeñas (< min_area) que podrían ser detalles.

Uso:
   python clean_inner_holes.py <input_dir> [--sample-dir=<dir>]
   --sample-dir: genera 3 ejemplos "before" + "after" en ese dir.
"""
import sys, os, argparse, shutil
import cv2
import numpy as np
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

DARK_THRESHOLD = 60        # pixel < 60 = dark
MIN_HOLE_AREA_PCT = 0.005  # min 0.5% of image area to consider a "hole"
MIN_HOLE_AREA_ABS = 80     # at least 80 px
BORDER_PAD = 2             # if bbox within 2px of edge → edge-touching

def process_image(path: Path, sample_dir: Path = None, sample_idx: int = None):
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        return {"file": path.name, "err": "cannot read"}
    h, w = img.shape[:2]
    img_area = h * w
    min_area = max(MIN_HOLE_AREA_ABS, int(img_area * MIN_HOLE_AREA_PCT))

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Binary mask of dark pixels
    _, dark_mask = cv2.threshold(gray, DARK_THRESHOLD, 255, cv2.THRESH_BINARY_INV)
    # Morph close to join small gaps within holes (so they're detected as one component)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, kernel, iterations=1)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)

    filled = False
    holes_count = 0
    result = img.copy()
    for i in range(1, num_labels):  # skip label 0 = background of mask
        x, y, cw, ch, area = stats[i]
        # Check if bbox touches the image border
        touches_edge = (
            x <= BORDER_PAD or y <= BORDER_PAD or
            x + cw >= w - BORDER_PAD or y + ch >= h - BORDER_PAD
        )
        if touches_edge:
            continue  # this is the exterior product outline, keep it
        if area < min_area:
            continue  # tiny detail, preserve
        # This is an interior dark region = trapped bg → fill white
        result[labels == i] = [255, 255, 255]
        filled = True
        holes_count += 1

    # Save sample before/after
    if sample_dir and sample_idx is not None:
        cv2.imwrite(str(sample_dir / f"sample_{sample_idx:02d}_before_{path.name}"), img)
        cv2.imwrite(str(sample_dir / f"sample_{sample_idx:02d}_after_{path.name}"), result)

    if filled:
        cv2.imwrite(str(path), result, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return {"file": path.name, "holes": holes_count, "filled": filled}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_dir")
    ap.add_argument("--sample-dir", default=None)
    ap.add_argument("--sample-count", type=int, default=3)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    input_dir = Path(args.input_dir)
    sample_dir = Path(args.sample_dir) if args.sample_dir else None
    if sample_dir:
        sample_dir.mkdir(parents=True, exist_ok=True)

    files = sorted([p for p in input_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png")])
    print(f"→ {len(files)} imágenes en {input_dir}")

    stats = {"processed": 0, "filled": 0, "total_holes": 0, "errors": 0}
    samples_generated = 0
    sample_targets = []

    # Primero: pre-scan para identificar candidatos (imágenes CON agujeros internos)
    # para las muestras, tomamos los primeros N que tengan filled=True.
    # Procesamos sin guardar cambios primero para elegir samples.
    print("→ Pre-scan para elegir muestras (sin modificar archivos)...")
    candidates = []
    for p in files[:300]:  # busca en los primeros 300 buscando candidatos
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None:
            continue
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, dark_mask = cv2.threshold(gray, DARK_THRESHOLD, 255, cv2.THRESH_BINARY_INV)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_CLOSE, kernel, iterations=1)
        num_labels, labels, st, _ = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)
        min_area = max(MIN_HOLE_AREA_ABS, int(h * w * MIN_HOLE_AREA_PCT))
        for i in range(1, num_labels):
            x, y, cw, ch, area = st[i]
            if x > BORDER_PAD and y > BORDER_PAD and x + cw < w - BORDER_PAD and y + ch < h - BORDER_PAD and area >= min_area:
                candidates.append(p)
                break
        if len(candidates) >= args.sample_count:
            break
    sample_set = set(str(p) for p in candidates[:args.sample_count])
    print(f"  candidatos para muestra: {[p.name for p in candidates[:args.sample_count]]}")

    # Procesar — para muestras guarda before/after en sample_dir
    print("→ Procesando todas las imágenes...")
    sample_idx = 0
    results = []
    for p in files:
        s_idx = None
        if sample_dir and str(p) in sample_set:
            s_idx = sample_idx
            sample_idx += 1
        try:
            r = process_image(p, sample_dir=sample_dir, sample_idx=s_idx)
            results.append(r)
            stats["processed"] += 1
            if r.get("filled"):
                stats["filled"] += 1
                stats["total_holes"] += r.get("holes", 0)
            if stats["processed"] % 200 == 0:
                print(f"  {stats['processed']}/{len(files)} | filled: {stats['filled']}")
        except Exception as e:
            stats["errors"] += 1

    print(f"\n✓ Procesadas: {stats['processed']}")
    print(f"✓ Con huecos internos rellenados: {stats['filled']}")
    print(f"✓ Total huecos individuales: {stats['total_holes']}")
    print(f"✗ Errores: {stats['errors']}")
    if sample_dir:
        print(f"→ Muestras before/after en {sample_dir}")


if __name__ == "__main__":
    main()
