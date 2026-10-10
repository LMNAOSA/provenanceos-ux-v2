/**
 * CONSOL 2D Camera Metrology Service
 * Derives scientific specimen length estimates from a known planar reference.
 * Explicitly records 2D reference plane calibration metadata without guessing thickness.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface MetrologyResult {
  length_mm: number;
  reference_mm: number;
  reference_px: number;
  object_px: number;
  method: string;
}

export function distanceBetween(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function calculate2DMeasurement(
  refPoints: Point2D[],
  lenPoints: Point2D[],
  refMm: number
): MetrologyResult | null {
  if (
    refPoints.length < 2 ||
    lenPoints.length < 2 ||
    !Number.isFinite(refMm) ||
    refMm <= 0
  ) {
    return null;
  }

  const refPx = distanceBetween(refPoints[0], refPoints[1]);
  const objPx = distanceBetween(lenPoints[0], lenPoints[1]);

  if (!refPx || refPx <= 0) return null;

  const lengthMm = (objPx / refPx) * refMm;

  return {
    length_mm: lengthMm,
    reference_mm: refMm,
    reference_px: refPx,
    object_px: objPx,
    method: '2D camera calibration',
  };
}
