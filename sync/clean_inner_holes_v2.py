#!/usr/bin/env python3
"""
V2: rellena únicamente "inner holes" que son FONDO (uniformes) —
preserva detalles oscuros del producto (cables, goma, metal negro con textura).

Criterios (AND):
  a) componente oscuro no toca el borde (región encerrada)
  b) área >= MIN_HOLE_AREA (80px) y >= 0.5% del área total
  c) std dev de intensidad dentro del componente < UNIFORMITY_THRESH (fondo plano)
  d) densidad: > 70% de los pixeles del bbox caen dentro del componente
     (filtra formas muy irregulares que suelen ser detalles, no fondos)
"""
import sys, argparse
import cv2
import numpy as np
from pathlib import Path

DARK_THRESHOLD = 60
MIN_HOLE_AREA_PCT = 0.005
MIN_HOLE_AREA_ABS = 80
BORDER_PAD = 2
UNIFORMITY_STD = 20        # píxeles con stddev >= 20 = textura → producto
DENSITY_MIN = 0.55         # área / bbox_area ≥ 55%


def process_image(path: Path, sample_dir: Path = None, sample_idx: int = None):
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        return {"file": path.name, "err": "cannot read"}
    h, w = img.shape[:2]
    img_area = h * w
    min_area = max(MIN_HOLE_AREA_ABS, int(img_area * MIN_HOLE_AREA_PCT))

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, dark_mask = cv2.threshold(gray, DARK_THRESHOLD, 255, cv2.THRESH_BINARY_INV)
    # Sin morph close — evitamos bridgear el producto con su hueco interno

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)

    filled = False
    holes_count = 0
    skipped_texture = 0
    skipped_irregular = 0
    result = img.copy()

    for i in range(1, num_labels):
        x, y, cw, ch, area = stats[i]
        # (a) no toca borde
        touches_edge = (
            x <= BORDER_PAD or y <= BORDER_PAD or
            x + cw >= w - BORDER_PAD or y + ch >= h - BORDER_PAD
        )
        if touches_edge:
            continue
        # (b) área mínima
        if area < min_area:
            continue

        # Extract mask + region
        mask_region = labels[y:y + ch, x:x + cw] == i
        gray_region = gray[y:y + ch, x:x + cw]
        pixels = gray_region[mask_region]

        # (c) uniformidad: std dev de los pixeles del componente
        std = float(pixels.std())
        if std >= UNIFORMITY_STD:
            skipped_texture += 1
            continue

        # (d) densidad: el componente ocupa la mayoría de su bbox
        bbox_area = cw * ch
        density = area / bbox_area if bbox_area > 0 else 0
        if density < DENSITY_MIN:
            skipped_irregular += 1
            continue

        # Pasa todos los filtros → es fondo uniforme encerrado → pintar blanco
        result[labels == i] = [255, 255, 255]
        filled = True
        holes_count += 1

    if sample_dir and sample_idx is not None:
        cv2.imwrite(str(sample_dir / f"sample_{sample_idx:02d}_before_{path.name}"), img)
        cv2.imwrite(str(sample_dir / f"sample_{sample_idx:02d}_after_{path.name}"), result)

    if filled:
        cv2.imwrite(str(path), result, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return {
        "file": path.name, "holes": holes_count, "filled": filled,
        "skipped_texture": skipped_texture, "skipped_irregular": skipped_irregular,
    }


def find_samples(files, count=3):
    """Busca imágenes candidatas con enclosed holes — incluye al menos una pieza redonda si posible."""
    candidates = []
    round_found = False
    for p in files[:600]:
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None:
            continue
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, dark_mask = cv2.threshold(gray, DARK_THRESHOLD, 255, cv2.THRESH_BINARY_INV)
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)
        min_area = max(MIN_HOLE_AREA_ABS, int(h * w * MIN_HOLE_AREA_PCT))

        hole_found = False
        aspect_ratios = []
        for i in range(1, num_labels):
            x, y, cw, ch, area = stats[i]
            if x > BORDER_PAD and y > BORDER_PAD and x + cw < w - BORDER_PAD and y + ch < h - BORDER_PAD and area >= min_area:
                hole_found = True
                if cw > 0 and ch > 0:
                    aspect_ratios.append(cw / ch)

        if hole_found:
            # Si el aspect ratio del hueco es cercano a 1 (redondo), priorizar
            is_roundish = any(0.75 < ar < 1.33 for ar in aspect_ratios)
            if is_roundish and not round_found:
                candidates.insert(0, p)
                round_found = True
            else:
                candidates.append(p)
        if len(candidates) >= count:
            break
    return candidates[:count]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_dir")
    ap.add_argument("--sample-dir", default=None)
    ap.add_argument("--sample-count", type=int, default=3)
    args = ap.parse_args()

    input_dir = Path(args.input_dir)
    sample_dir = Path(args.sample_dir) if args.sample_dir else None
    if sample_dir:
        sample_dir.mkdir(parents=True, exist_ok=True)

    files = sorted([p for p in input_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png")])
    print(f"→ {len(files)} imágenes en {input_dir}")

    # Pre-scan para elegir samples (incluye pieza redonda si existe)
    print("→ Buscando candidatos para muestras...")
    candidates = find_samples(files, count=args.sample_count)
    sample_set = {str(p) for p in candidates}
    print(f"  muestras: {[p.name for p in candidates]}")

    # Procesar
    print("→ Procesando (criterios: no-borde + área ≥0.5% + stddev<20 + densidad≥55%)...")
    stats_tot = {"processed": 0, "filled": 0, "total_holes": 0, "sk_texture": 0, "sk_irreg": 0, "errors": 0}
    sample_idx = 0
    for p in files:
        s_idx = None
        if sample_dir and str(p) in sample_set:
            s_idx = sample_idx
            sample_idx += 1
        try:
            r = process_image(p, sample_dir=sample_dir, sample_idx=s_idx)
            stats_tot["processed"] += 1
            if r.get("filled"):
                stats_tot["filled"] += 1
                stats_tot["total_holes"] += r.get("holes", 0)
            stats_tot["sk_texture"] += r.get("skipped_texture", 0)
            stats_tot["sk_irreg"] += r.get("skipped_irregular", 0)
            if stats_tot["processed"] % 200 == 0:
                print(f"  {stats_tot['processed']}/{len(files)} | filled: {stats_tot['filled']} | skipped por textura: {stats_tot['sk_texture']} | por forma irregular: {stats_tot['sk_irreg']}")
        except Exception:
            stats_tot["errors"] += 1

    print(f"\n✓ Procesadas: {stats_tot['processed']}")
    print(f"✓ Con huecos de FONDO rellenados: {stats_tot['filled']}")
    print(f"✓ Huecos individuales rellenados: {stats_tot['total_holes']}")
    print(f"→ Preservados por ser textura (producto): {stats_tot['sk_texture']}")
    print(f"→ Preservados por forma irregular: {stats_tot['sk_irreg']}")
    print(f"✗ Errores: {stats_tot['errors']}")


if __name__ == "__main__":
    main()
