import type { Floor, Opening, Point, RoomZone, Wall } from '../types';

export function roundCm(val: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export function wallLengthCm(wall: Pick<Wall, 'x1' | 'y1' | 'x2' | 'y2'>): number {
  return roundCm(Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1), 2);
}

export function formatCm(cm: number): string {
  const rounded = roundCm(cm, 2);
  const str = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  return `${str} cm`;
}

export function formatMeters(cm: number, unitMode: 'auto' | 'cm' | 'm' = 'auto'): string {
  const roundedCm = roundCm(cm, 2);
  if (unitMode === 'cm' || (unitMode === 'auto' && Math.abs(roundedCm) < 100)) {
    return formatCm(roundedCm);
  }
  const meters = roundedCm / 100;
  // Preserve decimal centimeters (e.g. 112.5 cm -> 1,125 m; 110 cm -> 1,10 m)
  const hasSubCm = Math.abs(roundedCm % 1) > 1e-3;
  const formatted = hasSubCm
    ? meters.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')
    : meters.toFixed(2).replace('.', ',');
  return `${formatted} m`;
}

export function formatAreaM2(m2: number): string {
  return `${m2.toFixed(2).replace('.', ',')} m²`;
}

export function polygonAreaM2(points: Point[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  // points are in cm, so divide by 10_000 for m²
  return Math.abs(area) / 20000;
}

export function polygonPerimeterM(points: Point[]): number {
  if (points.length < 2) return 0;
  let perimCm = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    perimCm += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
  }
  return perimCm / 100;
}

export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export function polygonBounds(points: Point[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function snapValue(val: number, gridCm = 1): number {
  if (gridCm <= 0) return roundCm(val, 2);
  return roundCm(Math.round(val / gridCm) * gridCm, 2);
}

export function projectPointOnSegmentUnclamped(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { t: number; dist: number; x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return { t: 0, dist: Math.hypot(px - x1, py - y1), x: x1, y: y1 };
  }
  const rawT = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return {
    t,
    dist: Math.hypot(px - projX, py - projY),
    x: roundCm(projX, 2),
    y: roundCm(projY, 2),
  };
}

/**
 * Smart snapping for exterior & interior walls:
 * 1. Snaps to existing wall endpoints (corners)
 * 2. Snaps onto existing wall segments (T-junctions!) so interior walls can start/end anywhere on any wall without restriction
 * 3. Applies gentle orthogonal alignment (0°/90°) from startPoint unless freeAngle is enabled
 * 4. Fine precision (default 0.5 cm / 1 cm) instead of rigid 10 cm blocks
 */
export function snapPointToWalls(
  x: number,
  y: number,
  walls: Wall[],
  thresholdCm = 18,
  gridCm = 1,
  options?: {
    startPoint?: Point | null;
    freeAngle?: boolean;
  }
): Point {
  const startPoint = options?.startPoint ?? null;
  const freeAngle = options?.freeAngle ?? false;

  let targetX = x;
  let targetY = y;

  // Gentle ortho alignment relative to startPoint when within ~14cm or 5 degrees
  if (startPoint && !freeAngle) {
    const dx = Math.abs(x - startPoint.x);
    const dy = Math.abs(y - startPoint.y);
    const dist = Math.hypot(dx, dy);
    if (dist > 5) {
      if (dx < Math.min(16, dist * 0.12)) {
        targetX = startPoint.x;
      } else if (dy < Math.min(16, dist * 0.12)) {
        targetY = startPoint.y;
      }
    }
  }

  // 1. Check snap to wall endpoints first
  let bestEndpoint: Point | null = null;
  let bestEndpointDist = thresholdCm;

  for (const w of walls) {
    const d1 = Math.hypot(w.x1 - targetX, w.y1 - targetY);
    if (d1 < bestEndpointDist) {
      bestEndpointDist = d1;
      bestEndpoint = { x: w.x1, y: w.y1 };
    }
    const d2 = Math.hypot(w.x2 - targetX, w.y2 - targetY);
    if (d2 < bestEndpointDist) {
      bestEndpointDist = d2;
      bestEndpoint = { x: w.x2, y: w.y2 };
    }
  }

  if (bestEndpoint) {
    return { x: roundCm(bestEndpoint.x, 2), y: roundCm(bestEndpoint.y, 2) };
  }

  // 2. Check snap onto wall segments (T-junctions anywhere along a wall!)
  let bestSegPoint: Point | null = null;
  let bestSegDist = thresholdCm;

  for (const w of walls) {
    const proj = projectPointOnSegmentUnclamped(targetX, targetY, w.x1, w.y1, w.x2, w.y2);
    if (proj.dist < bestSegDist) {
      bestSegDist = proj.dist;
      let sx = proj.x;
      let sy = proj.y;

      // If drawing from startPoint and nearly horizontal/vertical, intersect the ortho line with this wall segment
      if (startPoint && !freeAngle) {
        const wdx = w.x2 - w.x1;
        const wdy = w.y2 - w.y1;
        // If wall is horizontal, lock y to wall and x to targetX
        if (Math.abs(wdy) < 0.5) {
          sy = w.y1;
          sx = Math.max(Math.min(w.x1, w.x2), Math.min(Math.max(w.x1, w.x2), snapValue(targetX, gridCm)));
        } else if (Math.abs(wdx) < 0.5) {
          // If wall is vertical, lock x to wall and y to targetY
          sx = w.x1;
          sy = Math.max(Math.min(w.y1, w.y2), Math.min(Math.max(w.y1, w.y2), snapValue(targetY, gridCm)));
        }
      }
      bestSegPoint = { x: roundCm(sx, 2), y: roundCm(sy, 2) };
    }
  }

  if (bestSegPoint) {
    return bestSegPoint;
  }

  // 3. Free space with optional ortho lock
  return {
    x: startPoint && !freeAngle && targetX === startPoint.x ? roundCm(startPoint.x, 2) : snapValue(targetX, gridCm),
    y: startPoint && !freeAngle && targetY === startPoint.y ? roundCm(startPoint.y, 2) : snapValue(targetY, gridCm),
  };
}

export function projectPointOnWall(
  px: number,
  py: number,
  wall: Wall
): { ratio: number; dist: number; x: number; y: number } {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { ratio: 0.5, dist: Math.hypot(px - wall.x1, py - wall.y1), x: wall.x1, y: wall.y1 };
  let t = ((px - wall.x1) * dx + (py - wall.y1) * dy) / lenSq;
  t = Math.max(0.05, Math.min(0.95, t));
  const projX = wall.x1 + t * dx;
  const projY = wall.y1 + t * dy;
  return {
    ratio: t,
    dist: Math.hypot(px - projX, py - projY),
    x: projX,
    y: projY,
  };
}

/**
 * Computes exact rendered start/end coordinates for a wall so that:
 * - L-corners flush cleanly with the perpendicular wall's outer face (zero step, zero notch)
 * - T-junctions stop cleanly inside the host wall (never poking through the back!)
 * - Accidental small overshoots past a crossing perpendicular wall are visually trimmed
 */
export function getCleanWallRenderPoints(
  wall: Wall,
  allWalls: Wall[]
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = wall.x2 - wall.x1;
  const dy = wall.y2 - wall.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) {
    return { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 };
  }
  const ux = dx / len;
  const uy = dy / len;

  const adjustEndpoint = (px: number, py: number, outX: number, outY: number): Point => {
    // 1. Check if this endpoint meets another wall's endpoint (L-corner or collinear continuation)
    let cornerPerpHalfThick = 0;
    let hasCollinearContinuation = false;
    let isTJunctionOnOtherWall = false;
    let tJunctionPullback = 0;

    for (const other of allWalls) {
      if (other.id === wall.id) continue;
      const odx = other.x2 - other.x1;
      const ody = other.y2 - other.y1;
      const olen = Math.hypot(odx, ody);
      if (olen < 1) continue;
      const oux = odx / olen;
      const ouy = ody / olen;
      const dot = Math.abs(ux * oux + uy * ouy);

      const d1 = Math.hypot(px - other.x1, py - other.y1);
      const d2 = Math.hypot(px - other.x2, py - other.y2);
      const cornerTol = 3.5;

      if (d1 <= cornerTol || d2 <= cornerTol) {
        if (dot > 0.92) {
          // Check if the other wall continues outward in the same direction (outX, outY)
          const otherPointingX = d1 <= cornerTol ? oux : -oux;
          const otherPointingY = d1 <= cornerTol ? ouy : -ouy;
          if (otherPointingX * outX + otherPointingY * outY > 0.5) {
            hasCollinearContinuation = true;
          }
        } else if (dot < 0.35) {
          // Perpendicular corner (L-junction): extend by half of the OTHER wall's thickness
          cornerPerpHalfThick = Math.max(cornerPerpHalfThick, other.thicknessCm / 2);
        }
        continue;
      }

      // 2. Check if endpoint lies on the interior of `other` (T-junction)
      const proj = projectPointOnSegmentUnclamped(px, py, other.x1, other.y1, other.x2, other.y2);
      if (proj.dist <= Math.max(4, other.thicknessCm * 0.55) && proj.t > 0.02 && proj.t < 0.98) {
        isTJunctionOnOtherWall = true;
        // Snap the endpoint right onto `other`'s centerline and pull back if `wall` is thicker than `other`
        px = proj.x;
        py = proj.y;
        if (wall.thicknessCm > other.thicknessCm) {
          tJunctionPullback = Math.max(tJunctionPullback, (wall.thicknessCm - other.thicknessCm) / 2);
        }
      } else if (dot < 0.35 && len > 35) {
        // 3. Check if `other` crosses `wall` just inside this endpoint (dangling overshoot <= 25 cm)
        const denom = ux * ouy - uy * oux;
        if (Math.abs(denom) > 0.5) {
          const rx = other.x1 - px;
          const ry = other.y1 - py;
          // tAlongInward is distance from (px, py) going inward (-outX, -outY) along `wall`
          const tInward = (rx * ouy - ry * oux) / (-outX * ouy - -outY * oux);
          const uOther = (rx * -outY - ry * -outX) / (-outX * ouy - -outY * oux);
          const maxOvershoot = Math.min(28, len * 0.3);
          if (tInward > 0 && tInward <= maxOvershoot && uOther >= -4 && uOther <= olen + 4) {
            // Trim the dangling overshoot back to the intersection with `other`!
            px = px - outX * tInward;
            py = py - outY * tInward;
            isTJunctionOnOtherWall = true;
          }
        }
      }
    }

    if (isTJunctionOnOtherWall) {
      return {
        x: px - outX * tJunctionPullback,
        y: py - outY * tJunctionPullback,
      };
    }

    if (hasCollinearContinuation) {
      return { x: px, y: py };
    }

    if (cornerPerpHalfThick > 0) {
      return {
        x: px + outX * cornerPerpHalfThick,
        y: py + outY * cornerPerpHalfThick,
      };
    }

    return { x: px, y: py };
  };

  const p1 = adjustEndpoint(wall.x1, wall.y1, -ux, -uy);
  const p2 = adjustEndpoint(wall.x2, wall.y2, ux, uy);

  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

export interface InterWallDimension {
  id: string;
  pairKey: string;
  wallAId: string; // First wall
  wallBId: string; // Second wall
  clearDistanceCm: number; // Interior face-to-face distance in cm
  centerDistanceCm: number; // Centerline-to-centerline distance in cm
  x1: number; // Face point on Wall A (cm)
  y1: number;
  x2: number; // Face point on Wall B (cm)
  y2: number;
  midX: number; // Midpoint for badge (cm)
  midY: number;
  tx: number; // Wall tangent unit X
  ty: number; // Wall tangent unit Y
  overlapLenCm: number; // Length of overlap along tangent (cm)
  angleDeg: number; // Orientation of the dimension line
  directionLabelFromA: 'Gauche' | 'Droite' | 'Haut' | 'Bas';
}

/**
 * Computes the clear interior distances (cotes entre les murs) between facing parallel walls.
 */
export function computeInterWallDimensions(walls: Wall[]): InterWallDimension[] {
  const results: InterWallDimension[] = [];
  const seenPairs = new Set<string>();

  for (const wA of walls) {
    const dxA = wA.x2 - wA.x1;
    const dyA = wA.y2 - wA.y1;
    const lenA = Math.hypot(dxA, dyA);
    if (lenA < 15) continue;

    // Canonical tangent & normal for wA
    const tx = dxA / lenA;
    const ty = dyA / lenA;
    const nx = -ty;
    const ny = tx;

    // We look for the closest facing parallel wall on the negative normal side (-1) and positive normal side (+1)
    const candidatesBySide: Record<
      '-1' | '1',
      {
        other: Wall;
        clearDist: number;
        centerDist: number;
        signedDist: number;
        sMid: number;
        overlapLen: number;
      } | null
    > = {
      '-1': null,
      '1': null,
    };

    for (const wB of walls) {
      if (wB.id === wA.id) continue;
      const dxB = wB.x2 - wB.x1;
      const dyB = wB.y2 - wB.y1;
      const lenB = Math.hypot(dxB, dyB);
      if (lenB < 15) continue;

      const txB = dxB / lenB;
      const tyB = dyB / lenB;
      // Check parallel (within ~5 degrees)
      if (Math.abs(tx * txB + ty * tyB) < 0.995) continue;

      // Project wB endpoints onto wA's tangent axis [0, lenA]
      const s1 = (wB.x1 - wA.x1) * tx + (wB.y1 - wA.y1) * ty;
      const s2 = (wB.x2 - wA.x1) * tx + (wB.y2 - wA.y1) * ty;
      const bMin = Math.min(s1, s2);
      const bMax = Math.max(s1, s2);

      const overlapStart = Math.max(0, bMin);
      const overlapEnd = Math.min(lenA, bMax);
      const overlapLen = overlapEnd - overlapStart;
      if (overlapLen < 12) continue;

      const sMid = (overlapStart + overlapEnd) / 2;
      const px = wA.x1 + sMid * tx;
      const py = wA.y1 + sMid * ty;

      // Project (px, py) onto wB's infinite line to get exact perpendicular distance
      const signedDist = (wB.x1 - px) * nx + (wB.y1 - py) * ny;
      const centerDist = Math.abs(signedDist);
      const clearDist = roundCm(centerDist - wA.thicknessCm / 2 - wB.thicknessCm / 2, 2);

      // Ignore overlapping/collinear duplicate walls
      if (clearDist < 2) continue;

      const sideKey: '-1' | '1' = signedDist < 0 ? '-1' : '1';
      const currentBest = candidatesBySide[sideKey];
      if (!currentBest || clearDist < currentBest.clearDist) {
        candidatesBySide[sideKey] = {
          other: wB,
          clearDist,
          centerDist,
          signedDist,
          sMid,
          overlapLen,
        };
      }
    }

    for (const sideKey of ['-1', '1'] as const) {
      const cand = candidatesBySide[sideKey];
      if (!cand) continue;

      const pairKey = [wA.id, cand.other.id].sort().join('__');
      // Still record directional info if needed, or deduplicate for global canvas rendering
      const sign = cand.signedDist < 0 ? -1 : 1;
      const dirX = sign * nx;
      const dirY = sign * ny;

      const directionLabelFromA: 'Gauche' | 'Droite' | 'Haut' | 'Bas' =
        Math.abs(dirX) >= Math.abs(dirY)
          ? dirX < 0
            ? 'Gauche'
            : 'Droite'
          : dirY < 0
          ? 'Haut'
          : 'Bas';

      const px = wA.x1 + cand.sMid * tx;
      const py = wA.y1 + cand.sMid * ty;

      const x1 = roundCm(px + dirX * (wA.thicknessCm / 2), 2);
      const y1 = roundCm(py + dirY * (wA.thicknessCm / 2), 2);
      const x2 = roundCm(px + dirX * (cand.centerDist - cand.other.thicknessCm / 2), 2);
      const y2 = roundCm(py + dirY * (cand.centerDist - cand.other.thicknessCm / 2), 2);

      const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        results.push({
          id: `dim_${wA.id}_${cand.other.id}`,
          pairKey,
          wallAId: wA.id,
          wallBId: cand.other.id,
          clearDistanceCm: cand.clearDist,
          centerDistanceCm: roundCm(cand.centerDist, 2),
          x1,
          y1,
          x2,
          y2,
          midX: roundCm((x1 + x2) / 2, 2),
          midY: roundCm((y1 + y2) / 2, 2),
          tx,
          ty,
          overlapLenCm: roundCm(cand.overlapLen, 2),
          angleDeg,
          directionLabelFromA,
        });
      }
    }
  }

  return results.sort((a, b) => {
    const aHorizDim = Math.abs(a.tx) < Math.abs(a.ty) ? 0 : 1;
    const bHorizDim = Math.abs(b.tx) < Math.abs(b.ty) ? 0 : 1;
    if (aHorizDim !== bHorizDim) return aHorizDim - bHorizDim;
    if (aHorizDim === 0) {
      return Math.abs(a.midX - b.midX) > 10 ? a.midX - b.midX : a.midY - b.midY;
    }
    return Math.abs(a.midY - b.midY) > 10 ? a.midY - b.midY : a.midX - b.midX;
  });
}

/**
 * Computes the direct facing walls on both sides of a specific wall `targetWall`,
 * so the Inspector can always show "Distance mur Gauche/Haut" and "Distance mur Droit/Bas".
 */
export function getFacingWallsForWall(
  targetWall: Wall,
  allWalls: Wall[]
): Array<{
  otherWall: Wall;
  clearDistanceCm: number;
  directionLabel: 'Gauche' | 'Droite' | 'Haut' | 'Bas';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}> {
  const dxA = targetWall.x2 - targetWall.x1;
  const dyA = targetWall.y2 - targetWall.y1;
  const lenA = Math.hypot(dxA, dyA);
  if (lenA < 5) return [];

  const tx = dxA / lenA;
  const ty = dyA / lenA;
  const nx = -ty;
  const ny = tx;

  const bestBySide: Record<
    '-1' | '1',
    {
      otherWall: Wall;
      clearDistanceCm: number;
      directionLabel: 'Gauche' | 'Droite' | 'Haut' | 'Bas';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    } | null
  > = { '-1': null, '1': null };

  for (const wB of allWalls) {
    if (wB.id === targetWall.id) continue;
    const dxB = wB.x2 - wB.x1;
    const dyB = wB.y2 - wB.y1;
    const lenB = Math.hypot(dxB, dyB);
    if (lenB < 5) continue;

    const txB = dxB / lenB;
    const tyB = dyB / lenB;
    if (Math.abs(tx * txB + ty * tyB) < 0.99) continue;

    const s1 = (wB.x1 - targetWall.x1) * tx + (wB.y1 - targetWall.y1) * ty;
    const s2 = (wB.x2 - targetWall.x1) * tx + (wB.y2 - targetWall.y1) * ty;
    const overlapStart = Math.max(0, Math.min(s1, s2));
    const overlapEnd = Math.min(lenA, Math.max(s1, s2));
    if (overlapEnd - overlapStart < 5) continue;

    const sMid = (overlapStart + overlapEnd) / 2;
    const px = targetWall.x1 + sMid * tx;
    const py = targetWall.y1 + sMid * ty;

    const signedDist = (wB.x1 - px) * nx + (wB.y1 - py) * ny;
    const centerDist = Math.abs(signedDist);
    const clearDist = roundCm(centerDist - targetWall.thicknessCm / 2 - wB.thicknessCm / 2, 2);
    if (clearDist < 1) continue;

    const sideKey: '-1' | '1' = signedDist < 0 ? '-1' : '1';
    const sign = signedDist < 0 ? -1 : 1;
    const dirX = sign * nx;
    const dirY = sign * ny;

    const directionLabel: 'Gauche' | 'Droite' | 'Haut' | 'Bas' =
      Math.abs(dirX) >= Math.abs(dirY)
        ? dirX < 0
          ? 'Gauche'
          : 'Droite'
        : dirY < 0
        ? 'Haut'
        : 'Bas';

    const x1 = roundCm(px + dirX * (targetWall.thicknessCm / 2), 2);
    const y1 = roundCm(py + dirY * (targetWall.thicknessCm / 2), 2);
    const x2 = roundCm(px + dirX * (centerDist - wB.thicknessCm / 2), 2);
    const y2 = roundCm(py + dirY * (centerDist - wB.thicknessCm / 2), 2);

    const existing = bestBySide[sideKey];
    if (!existing || clearDist < existing.clearDistanceCm) {
      bestBySide[sideKey] = {
        otherWall: wB,
        clearDistanceCm: clearDist,
        directionLabel,
        x1,
        y1,
        x2,
        y2,
      };
    }
  }

  return [bestBySide['-1'], bestBySide['1']].filter(
    (x): x is NonNullable<typeof x> => x !== null
  );
}

/**
 * Shifts a wall parallel to itself by (shiftX, shiftY), while keeping connected perpendicular walls
 * and adjacent RoomZone vertices attached so no wall disconnects or overshoots.
 */
export function shiftWallInFloor(
  floor: Floor,
  movingWallId: string,
  shiftX: number,
  shiftY: number
): Floor {
  const movingWall = floor.walls.find((w) => w.id === movingWallId);
  if (!movingWall || (Math.abs(shiftX) < 1e-4 && Math.abs(shiftY) < 1e-4)) {
    return floor;
  }

  const wDx = movingWall.x2 - movingWall.x1;
  const wDy = movingWall.y2 - movingWall.y1;
  const wLen = Math.hypot(wDx, wDy);
  const tx = wLen > 0 ? wDx / wLen : 1;
  const ty = wLen > 0 ? wDy / wLen : 0;

  const isPointOnMovingWall = (px: number, py: number, tol = 4) => {
    const proj = projectPointOnSegmentUnclamped(px, py, movingWall.x1, movingWall.y1, movingWall.x2, movingWall.y2);
    return proj.dist <= tol;
  };

  const updatedWalls = floor.walls.map((w) => {
    if (w.id === movingWall.id) {
      return {
        ...w,
        x1: roundCm(w.x1 + shiftX, 2),
        y1: roundCm(w.y1 + shiftY, 2),
        x2: roundCm(w.x2 + shiftX, 2),
        y2: roundCm(w.y2 + shiftY, 2),
      };
    }

    // Check if w is a perpendicular/angled wall that starts or ends on movingWall
    const oDx = w.x2 - w.x1;
    const oDy = w.y2 - w.y1;
    const oLen = Math.hypot(oDx, oDy);
    if (oLen < 1) return w;
    const otx = oDx / oLen;
    const oty = oDy / oLen;
    const dot = Math.abs(tx * otx + ty * oty);

    // Only stretch/shrink walls that are not parallel to movingWall, and only when the endpoint is in the interior of movingWall (T-junction) or is an interior wall attached to movingWall
    if (dot < 0.7) {
      const p1OnWall = isPointOnMovingWall(w.x1, w.y1, 4);
      const p2OnWall = isPointOnMovingWall(w.x2, w.y2, 4);

      // Avoid deforming outer perimeter walls along which movingWall itself is sliding!
      // If `movingWall`'s own endpoint (x1,y1) or (x2,y2) lies in the middle of `w`, then `movingWall` is sliding along `w`, so `w` does NOT move!
      const movingEndsOnW =
        projectPointOnSegmentUnclamped(movingWall.x1, movingWall.y1, w.x1, w.y1, w.x2, w.y2).dist <= 4 &&
        projectPointOnSegmentUnclamped(movingWall.x1, movingWall.y1, w.x1, w.y1, w.x2, w.y2).t > 0.03 &&
        projectPointOnSegmentUnclamped(movingWall.x1, movingWall.y1, w.x1, w.y1, w.x2, w.y2).t < 0.97;
      const movingEnd2OnW =
        projectPointOnSegmentUnclamped(movingWall.x2, movingWall.y2, w.x1, w.y1, w.x2, w.y2).dist <= 4 &&
        projectPointOnSegmentUnclamped(movingWall.x2, movingWall.y2, w.x1, w.y1, w.x2, w.y2).t > 0.03 &&
        projectPointOnSegmentUnclamped(movingWall.x2, movingWall.y2, w.x1, w.y1, w.x2, w.y2).t < 0.97;

      if (movingEndsOnW || movingEnd2OnW) {
        return w;
      }

      if (p1OnWall && !p2OnWall) {
        return {
          ...w,
          x1: roundCm(w.x1 + shiftX, 2),
          y1: roundCm(w.y1 + shiftY, 2),
        };
      }
      if (p2OnWall && !p1OnWall) {
        return {
          ...w,
          x2: roundCm(w.x2 + shiftX, 2),
          y2: roundCm(w.y2 + shiftY, 2),
        };
      }
    }

    return w;
  });

  // Also update RoomZone vertices that lie on movingWall
  const updatedRooms: RoomZone[] = floor.rooms.map((room) => ({
    ...room,
    points: room.points.map((pt) => {
      if (isPointOnMovingWall(pt.x, pt.y, 5)) {
        return {
          x: roundCm(pt.x + shiftX, 2),
          y: roundCm(pt.y + shiftY, 2),
        };
      }
      return pt;
    }),
  }));

  return {
    ...floor,
    walls: updatedWalls,
    rooms: updatedRooms,
  };
}

/**
 * Updates the clear distance between `movingWallId` and `referenceWallId` to `newClearDistanceCm`,
 * shifting `movingWallId` perpendicular to `referenceWallId`.
 */
export function updateDistanceBetweenWalls(
  floor: Floor,
  movingWallId: string,
  referenceWallId: string,
  newClearDistanceCm: number
): Floor {
  return updateDistanceBetweenWallsCascade(floor, movingWallId, referenceWallId, newClearDistanceCm, {
    cascade: false,
    lockDimension: false,
  });
}

/**
 * Updates the clear distance between `movingWallId` and `referenceWallId` to `newClearDistanceCm`.
 * When `cascade` is true (default), all walls, partitions, openings, room vertices and furniture
 * beyond `movingWall` shift together as a whole, and perpendicular exterior walls stretch/shrink
 * automatically so spacings drive the building footprint.
 */
export function updateDistanceBetweenWallsCascade(
  floor: Floor,
  movingWallId: string,
  referenceWallId: string,
  newClearDistanceCm: number,
  options?: {
    cascade?: boolean;
    lockDimension?: boolean;
  }
): Floor {
  const movingWall = floor.walls.find((w) => w.id === movingWallId);
  const refWall = floor.walls.find((w) => w.id === referenceWallId);
  if (!movingWall || !refWall) return floor;

  const cascade = options?.cascade ?? true;
  const lockDimension = options?.lockDimension ?? true;

  const dxR = refWall.x2 - refWall.x1;
  const dyR = refWall.y2 - refWall.y1;
  const lenR = Math.hypot(dxR, dyR);
  if (lenR < 1) return floor;

  // Normal of reference wall
  const nx = -dyR / lenR;
  const ny = dxR / lenR;

  const midMx = (movingWall.x1 + movingWall.x2) / 2;
  const midMy = (movingWall.y1 + movingWall.y2) / 2;

  const signedDist = (midMx - refWall.x1) * nx + (midMy - refWall.y1) * ny;
  const sign = signedDist >= 0 ? 1 : -1;
  const pushDirX = sign * nx;
  const pushDirY = sign * ny;

  const curCenterDist = Math.abs(signedDist);
  const targetCenterDist =
    Math.max(0.1, newClearDistanceCm) + movingWall.thicknessCm / 2 + refWall.thicknessCm / 2;
  const delta = targetCenterDist - curCenterDist;

  const shiftX = pushDirX * delta;
  const shiftY = pushDirY * delta;

  const pairKey = [movingWallId, referenceWallId].sort().join('__');
  const nextLocked = lockDimension
    ? Array.from(new Set([...(floor.lockedDimensionIds ?? []), pairKey]))
    : floor.lockedDimensionIds;

  if (Math.abs(delta) < 1e-4) {
    return nextLocked !== floor.lockedDimensionIds
      ? { ...floor, lockedDimensionIds: nextLocked }
      : floor;
  }

  if (!cascade) {
    const shifted = shiftWallInFloor(floor, movingWallId, shiftX, shiftY);
    return {
      ...shifted,
      lockedDimensionIds: nextLocked,
    };
  }

  const projAlongPush = (px: number, py: number) => px * pushDirX + py * pushDirY;
  const sMove = projAlongPush(midMx, midMy);
  const wallThreshold = sMove - Math.min(2, Math.max(0.1, curCenterDist * 0.4));
  const epThreshold = sMove - Math.min(4, Math.max(0.1, curCenterDist * 0.4));

  const mDx = movingWall.x2 - movingWall.x1;
  const mDy = movingWall.y2 - movingWall.y1;
  const mLen = Math.hypot(mDx, mDy) || 1;
  const mUx = mDx / mLen;
  const mUy = mDy / mLen;

  // Snapshot old opening world coordinates before wall endpoints move
  const openingSnapshots = floor.openings.map((op) => {
    const host = floor.walls.find((w) => w.id === op.wallId);
    if (!host) return { op, wx: 0, wy: 0, valid: false };
    return {
      op,
      wx: host.x1 + (host.x2 - host.x1) * op.offsetRatio,
      wy: host.y1 + (host.y2 - host.y1) * op.offsetRatio,
      valid: true,
    };
  });

  const wholeShiftedWallIds = new Set<string>();

  const updatedWalls = floor.walls.map((w) => {
    if (w.id === referenceWallId) return w;

    if (w.id === movingWallId) {
      wholeShiftedWallIds.add(w.id);
      return {
        ...w,
        x1: roundCm(w.x1 + shiftX, 2),
        y1: roundCm(w.y1 + shiftY, 2),
        x2: roundCm(w.x2 + shiftX, 2),
        y2: roundCm(w.y2 + shiftY, 2),
      };
    }

    const wDx = w.x2 - w.x1;
    const wDy = w.y2 - w.y1;
    const wLen = Math.hypot(wDx, wDy);
    if (wLen < 0.5) return w;
    const wUx = wDx / wLen;
    const wUy = wDy / wLen;
    const isParallel = Math.abs(wUx * mUx + wUy * mUy) > 0.92;

    if (isParallel) {
      const sW = projAlongPush((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2);
      if (sW >= wallThreshold) {
        wholeShiftedWallIds.add(w.id);
        return {
          ...w,
          x1: roundCm(w.x1 + shiftX, 2),
          y1: roundCm(w.y1 + shiftY, 2),
          x2: roundCm(w.x2 + shiftX, 2),
          y2: roundCm(w.y2 + shiftY, 2),
        };
      }
      return w;
    }

    // Non-parallel (perpendicular / angled): shift endpoints beyond or on movingWall
    const p1Shift = projAlongPush(w.x1, w.y1) >= epThreshold;
    const p2Shift = projAlongPush(w.x2, w.y2) >= epThreshold;
    if (p1Shift && p2Shift) {
      wholeShiftedWallIds.add(w.id);
    }
    if (!p1Shift && !p2Shift) return w;

    return {
      ...w,
      x1: p1Shift ? roundCm(w.x1 + shiftX, 2) : w.x1,
      y1: p1Shift ? roundCm(w.y1 + shiftY, 2) : w.y1,
      x2: p2Shift ? roundCm(w.x2 + shiftX, 2) : w.x2,
      y2: p2Shift ? roundCm(w.y2 + shiftY, 2) : w.y2,
    };
  });

  // Update openings so they remain anchored accurately on stretched/shifted walls
  const updatedOpenings: Opening[] = openingSnapshots.map(({ op, wx, wy, valid }) => {
    if (!valid || wholeShiftedWallIds.has(op.wallId)) return op;
    const newHost = updatedWalls.find((w) => w.id === op.wallId);
    if (!newHost) return op;
    const opBeyond = projAlongPush(wx, wy) >= wallThreshold;
    const tx = opBeyond ? wx + shiftX : wx;
    const ty = opBeyond ? wy + shiftY : wy;
    const proj = projectPointOnWall(tx, ty, newHost);
    return {
      ...op,
      offsetRatio: roundCm(proj.ratio, 4),
    };
  });

  // Update rooms
  const updatedRooms: RoomZone[] = floor.rooms.map((room) => ({
    ...room,
    points: room.points.map((pt) => {
      if (projAlongPush(pt.x, pt.y) >= epThreshold) {
        return {
          x: roundCm(pt.x + shiftX, 2),
          y: roundCm(pt.y + shiftY, 2),
        };
      }
      return pt;
    }),
  }));

  // Update furniture
  const updatedFurniture = floor.furniture.map((item) => {
    if (projAlongPush(item.x, item.y) >= wallThreshold) {
      return {
        ...item,
        x: roundCm(item.x + shiftX, 2),
        y: roundCm(item.y + shiftY, 2),
      };
    }
    return item;
  });

  return {
    ...floor,
    walls: updatedWalls,
    openings: updatedOpenings,
    rooms: updatedRooms,
    furniture: updatedFurniture,
    lockedDimensionIds: nextLocked,
  };
}

export function getOpeningCornerDistancesCm(
  opening: Opening,
  wall: Wall
): { distFromStartCm: number; distFromEndCm: number; wallLengthCm: number } {
  const lenCm = wallLengthCm(wall);
  const centerCm = opening.offsetRatio * lenCm;
  const halfW = opening.widthCm / 2;
  return {
    distFromStartCm: roundCm(Math.max(0, centerCm - halfW), 2),
    distFromEndCm: roundCm(Math.max(0, lenCm - (centerCm + halfW)), 2),
    wallLengthCm: lenCm,
  };
}

export function updateOpeningCornerDistanceCm(
  floor: Floor,
  openingId: string,
  side: 'start' | 'end',
  distanceCm: number
): Floor {
  const op = floor.openings.find((o) => o.id === openingId);
  if (!op) return floor;
  const wall = floor.walls.find((w) => w.id === op.wallId);
  if (!wall) return floor;
  const lenCm = wallLengthCm(wall);
  if (lenCm < 1) return floor;

  const halfW = op.widthCm / 2;
  const clampedDist = Math.max(0, distanceCm);
  const newCenterCm =
    side === 'start'
      ? Math.max(halfW, Math.min(lenCm - halfW, clampedDist + halfW))
      : Math.max(halfW, Math.min(lenCm - halfW, lenCm - clampedDist - halfW));
  const nextRatio = Math.max(0.01, Math.min(0.99, roundCm(newCenterCm / lenCm, 4)));

  return {
    ...floor,
    openings: floor.openings.map((o) =>
      o.id === openingId ? { ...o, offsetRatio: nextRatio } : o
    ),
  };
}

/**
 * Updates the length of `wallId` to `newLenCm` while moving any connected corner endpoints
 * and room vertices so walls never overshoot or disconnect.
 */
export function updateWallLengthInFloor(
  floor: Floor,
  wallId: string,
  newLenCm: number,
  anchor: 'start' | 'end' | 'center' = 'start'
): Floor {
  const target = floor.walls.find((w) => w.id === wallId);
  if (!target) return floor;
  const curLen = wallLengthCm(target);
  if (curLen <= 0 || newLenCm < 0.5) return floor;

  const ux = (target.x2 - target.x1) / curLen;
  const uy = (target.y2 - target.y1) / curLen;
  const deltaLen = newLenCm - curLen;

  let newX1 = target.x1;
  let newY1 = target.y1;
  let newX2 = target.x2;
  let newY2 = target.y2;

  if (anchor === 'start') {
    newX2 = roundCm(target.x1 + ux * newLenCm, 2);
    newY2 = roundCm(target.y1 + uy * newLenCm, 2);
  } else if (anchor === 'end') {
    newX1 = roundCm(target.x2 - ux * newLenCm, 2);
    newY1 = roundCm(target.y2 - uy * newLenCm, 2);
  } else {
    newX1 = roundCm(target.x1 - (ux * deltaLen) / 2, 2);
    newY1 = roundCm(target.y1 - (uy * deltaLen) / 2, 2);
    newX2 = roundCm(target.x2 + (ux * deltaLen) / 2, 2);
    newY2 = roundCm(target.y2 + (uy * deltaLen) / 2, 2);
  }

  const shift1X = newX1 - target.x1;
  const shift1Y = newY1 - target.y1;
  const shift2X = newX2 - target.x2;
  const shift2Y = newY2 - target.y2;

  const tol = 4;

  const updatedWalls = floor.walls.map((w) => {
    if (w.id === target.id) {
      return { ...w, x1: newX1, y1: newY1, x2: newX2, y2: newY2 };
    }
    let { x1, y1, x2, y2 } = w;
    if (Math.hypot(x1 - target.x1, y1 - target.y1) <= tol) {
      x1 = roundCm(x1 + shift1X, 2);
      y1 = roundCm(y1 + shift1Y, 2);
    } else if (Math.hypot(x1 - target.x2, y1 - target.y2) <= tol) {
      x1 = roundCm(x1 + shift2X, 2);
      y1 = roundCm(y1 + shift2Y, 2);
    }
    if (Math.hypot(x2 - target.x1, y2 - target.y1) <= tol) {
      x2 = roundCm(x2 + shift1X, 2);
      y2 = roundCm(y2 + shift1Y, 2);
    } else if (Math.hypot(x2 - target.x2, y2 - target.y2) <= tol) {
      x2 = roundCm(x2 + shift2X, 2);
      y2 = roundCm(y2 + shift2Y, 2);
    }
    return { ...w, x1, y1, x2, y2 };
  });

  const updatedRooms = floor.rooms.map((r) => ({
    ...r,
    points: r.points.map((pt) => {
      if (Math.hypot(pt.x - target.x1, pt.y - target.y1) <= tol) {
        return { x: roundCm(pt.x + shift1X, 2), y: roundCm(pt.y + shift1Y, 2) };
      }
      if (Math.hypot(pt.x - target.x2, pt.y - target.y2) <= tol) {
        return { x: roundCm(pt.x + shift2X, 2), y: roundCm(pt.y + shift2Y, 2) };
      }
      return pt;
    }),
  }));

  return {
    ...floor,
    walls: updatedWalls,
    rooms: updatedRooms,
  };
}

/**
 * Cleans up a floor's walls by:
 * 1. Snapping nearly-horizontal / nearly-vertical walls (< 1.5 deg) to exact ortho
 * 2. Merging duplicate or partially overlapping collinear walls (common in AI-generated plans where adjacent rooms each create a wall)
 * 3. Snapping dangling endpoints that slightly overshoot or undershoot (<= 28 cm) a perpendicular wall
 * 4. Inferring wallType ('exterior' | 'interior') if not already set
 */
export function cleanAndAlignWalls(floor: Floor): Floor {
  let walls = floor.walls
    .map((w) => ({
      ...w,
      x1: roundCm(w.x1, 2),
      y1: roundCm(w.y1, 2),
      x2: roundCm(w.x2, 2),
      y2: roundCm(w.y2, 2),
      thicknessCm: roundCm(w.thicknessCm, 2),
    }))
    .filter((w) => wallLengthCm(w) >= 2);

  // 1. Snap nearly-horizontal / nearly-vertical walls (< 1.5 deg) to exact ortho
  walls = walls.map((w) => {
    const dx = Math.abs(w.x2 - w.x1);
    const dy = Math.abs(w.y2 - w.y1);
    if (dx > 10 && dy > 0 && dy / dx < 0.025) {
      const avgY = roundCm((w.y1 + w.y2) / 2, 2);
      return { ...w, y1: avgY, y2: avgY };
    }
    if (dy > 10 && dx > 0 && dx / dy < 0.025) {
      const avgX = roundCm((w.x1 + w.x2) / 2, 2);
      return { ...w, x1: avgX, x2: avgX };
    }
    return w;
  });

  // 2. Merge duplicate or partially overlapping collinear walls & preserve openings
  const openingWorldPositions = floor.openings.map((op) => {
    const host = walls.find((w) => w.id === op.wallId);
    if (!host) return { op, wx: 0, wy: 0, valid: false };
    return {
      op,
      wx: host.x1 + (host.x2 - host.x1) * op.offsetRatio,
      wy: host.y1 + (host.y2 - host.y1) * op.offsetRatio,
      valid: true,
    };
  });

  const mergedWalls: Wall[] = [];
  const replacedWallMap = new Map<string, string>(); // oldWallId -> survivingWallId

  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    let mergedIntoExisting = false;

    for (let i = 0; i < mergedWalls.length; i++) {
      const k = mergedWalls[i];
      const kdx = k.x2 - k.x1;
      const kdy = k.y2 - k.y1;
      const klen = Math.hypot(kdx, kdy);
      if (klen < 2) continue;
      const kux = kdx / klen;
      const kuy = kdy / klen;

      // Parallel check
      if (Math.abs(ux * kux + uy * kuy) < 0.995) continue;

      // Perpendicular distance between the two wall centerlines
      const perpDist = Math.abs((w.x1 - k.x1) * nx + (w.y1 - k.y1) * ny);
      const maxCollinearOffset = Math.max(8, Math.min(w.thicknessCm, k.thicknessCm) * 0.75);
      if (perpDist > maxCollinearOffset) continue;

      // Project w's endpoints onto k's tangent axis [0, klen]
      const s1 = (w.x1 - k.x1) * kux + (w.y1 - k.y1) * kuy;
      const s2 = (w.x2 - k.x1) * kux + (w.y2 - k.y1) * kuy;
      const wMin = Math.min(s1, s2);
      const wMax = Math.max(s1, s2);

      // Check if segments overlap or touch within 4 cm
      const overlap = Math.min(klen, wMax) - Math.max(0, wMin);
      if (overlap >= -4) {
        const unionMin = Math.min(0, wMin);
        const unionMax = Math.max(klen, wMax);
        const newX1 = roundCm(k.x1 + kux * unionMin, 2);
        const newY1 = roundCm(k.y1 + kuy * unionMin, 2);
        const newX2 = roundCm(k.x1 + kux * unionMax, 2);
        const newY2 = roundCm(k.y1 + kuy * unionMax, 2);
        const isExt = k.wallType === 'exterior' || w.wallType === 'exterior';

        mergedWalls[i] = {
          ...k,
          x1: newX1,
          y1: newY1,
          x2: newX2,
          y2: newY2,
          thicknessCm: Math.max(k.thicknessCm, w.thicknessCm),
          wallType: isExt ? 'exterior' : k.wallType ?? w.wallType,
        };
        replacedWallMap.set(w.id, k.id);
        mergedIntoExisting = true;
        break;
      }
    }

    if (!mergedIntoExisting) {
      mergedWalls.push(w);
    }
  }

  // 3. Trim dangling overshoots or close small gaps (<= 28 cm) to perpendicular walls
  const alignedWalls = mergedWalls.map((w) => {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy);
    if (len < 20) return w;
    const ux = dx / len;
    const uy = dy / len;

    let { x1, y1, x2, y2 } = w;

    for (const other of mergedWalls) {
      if (other.id === w.id) continue;
      const odx = other.x2 - other.x1;
      const ody = other.y2 - other.y1;
      const olen = Math.hypot(odx, ody);
      if (olen < 20) continue;
      const oux = odx / olen;
      const ouy = ody / olen;

      // Only perpendicular walls
      if (Math.abs(ux * oux + uy * ouy) > 0.25) continue;

      const proj1 = projectPointOnSegmentUnclamped(x1, y1, other.x1, other.y1, other.x2, other.y2);
      if (proj1.dist > 0.05 && proj1.dist <= 28) {
        x1 = proj1.x;
        y1 = proj1.y;
      }

      const proj2 = projectPointOnSegmentUnclamped(x2, y2, other.x1, other.y1, other.x2, other.y2);
      if (proj2.dist > 0.05 && proj2.dist <= 28) {
        x2 = proj2.x;
        y2 = proj2.y;
      }
    }

    return { ...w, x1: roundCm(x1, 2), y1: roundCm(y1, 2), x2: roundCm(x2, 2), y2: roundCm(y2, 2) };
  });

  // 4. Infer wallType ('exterior' | 'interior') on perimeter if missing
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const w of alignedWalls) {
    minX = Math.min(minX, w.x1, w.x2);
    maxX = Math.max(maxX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2);
    maxY = Math.max(maxY, w.y1, w.y2);
  }

  const finalWalls: Wall[] = alignedWalls.map((w) => {
    if (w.wallType) return w;
    const midX = (w.x1 + w.x2) / 2;
    const midY = (w.y1 + w.y2) / 2;
    const dx = Math.abs(w.x2 - w.x1);
    const dy = Math.abs(w.y2 - w.y1);
    const onOuterPerimeter =
      (dy < 10 && (Math.abs(midY - minY) < 20 || Math.abs(midY - maxY) < 20)) ||
      (dx < 10 && (Math.abs(midX - minX) < 20 || Math.abs(midX - maxX) < 20));
    return {
      ...w,
      wallType: onOuterPerimeter || w.thicknessCm >= 18 ? 'exterior' : 'interior',
    };
  });

  // 5. Re-attach openings to surviving/aligned walls at their exact world coordinates
  const finalOpenings = openingWorldPositions
    .map(({ op, wx, wy, valid }) => {
      if (!valid) return null;
      let targetWallId = op.wallId;
      while (replacedWallMap.has(targetWallId)) {
        targetWallId = replacedWallMap.get(targetWallId)!;
      }
      const host = finalWalls.find((w) => w.id === targetWallId);
      if (!host) return null;
      const proj = projectPointOnWall(wx, wy, host);
      return {
        ...op,
        wallId: host.id,
        offsetRatio: roundCm(proj.ratio, 3),
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return {
    ...floor,
    walls: finalWalls,
    openings: finalOpenings,
  };
}

export function pointInPolygon(x: number, y: number, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Automatically detects closed interior rooms from wall segments using planar half-edge face extraction,
 * preserving existing room metadata (name, floorType, ceilingColor, aiRenderUrl...) and exterior/unwalled zones.
 */
export function detectRoomsFromWalls(floor: Floor): Floor {
  const validWalls = floor.walls.filter((w) => wallLengthCm(w) >= 5);
  if (validWalls.length < 3) return floor;

  // 1. Collect all endpoints, T-junctions and segment intersections
  const rawPoints: Point[] = [];
  for (const w of validWalls) {
    rawPoints.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
  }

  for (let i = 0; i < validWalls.length; i++) {
    const a = validWalls[i];
    for (let j = i + 1; j < validWalls.length; j++) {
      const b = validWalls[j];
      const dax = a.x2 - a.x1;
      const day = a.y2 - a.y1;
      const dbx = b.x2 - b.x1;
      const dby = b.y2 - b.y1;
      const denom = dax * dby - day * dbx;
      if (Math.abs(denom) > 1e-4) {
        const dx = b.x1 - a.x1;
        const dy = b.y1 - a.y1;
        const t = (dx * dby - dy * dbx) / denom;
        const u = (dx * day - dy * dax) / denom;
        if (t >= -0.02 && t <= 1.02 && u >= -0.02 && u <= 1.02) {
          rawPoints.push({
            x: roundCm(a.x1 + Math.max(0, Math.min(1, t)) * dax, 2),
            y: roundCm(a.y1 + Math.max(0, Math.min(1, t)) * day, 2),
          });
        }
      }
      // T-junction projections
      for (const pt of [
        { x: a.x1, y: a.y1 },
        { x: a.x2, y: a.y2 },
      ]) {
        const proj = projectPointOnSegmentUnclamped(pt.x, pt.y, b.x1, b.y1, b.x2, b.y2);
        if (proj.dist <= 5) rawPoints.push({ x: proj.x, y: proj.y });
      }
      for (const pt of [
        { x: b.x1, y: b.y1 },
        { x: b.x2, y: b.y2 },
      ]) {
        const proj = projectPointOnSegmentUnclamped(pt.x, pt.y, a.x1, a.y1, a.x2, a.y2);
        if (proj.dist <= 5) rawPoints.push({ x: proj.x, y: proj.y });
      }
    }
  }

  // 2. Merge close points into canonical graph nodes (<= 4.5 cm tolerance)
  const nodes: Point[] = [];
  const snapTol = 4.5;
  const getOrCreateNode = (pt: Point): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - pt.x, nodes[i].y - pt.y) <= snapTol) {
        return i;
      }
    }
    nodes.push({ x: roundCm(pt.x, 2), y: roundCm(pt.y, 2) });
    return nodes.length - 1;
  };
  for (const pt of rawPoints) {
    getOrCreateNode(pt);
  }

  // 3. Split each wall at all nodes lying on it to form planar edges
  const adj = new Map<number, Set<number>>();
  const addEdge = (u: number, v: number) => {
    if (u === v) return;
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  };

  for (const w of validWalls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 4) continue;
    const onSeg: Array<{ nodeId: number; t: number }> = [];
    for (let idx = 0; idx < nodes.length; idx++) {
      const n = nodes[idx];
      const proj = projectPointOnSegmentUnclamped(n.x, n.y, w.x1, w.y1, w.x2, w.y2);
      if (proj.dist <= 5) {
        const rawT = ((n.x - w.x1) * dx + (n.y - w.y1) * dy) / lenSq;
        if (rawT >= -0.03 && rawT <= 1.03) {
          onSeg.push({ nodeId: idx, t: rawT });
        }
      }
    }
    onSeg.sort((a, b) => a.t - b.t);
    for (let k = 0; k < onSeg.length - 1; k++) {
      addEdge(onSeg[k].nodeId, onSeg[k + 1].nodeId);
    }
  }

  // 4. Iteratively peel dangling spurs (degree <= 1)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [u, neighbors] of Array.from(adj.entries())) {
      if (neighbors.size <= 1) {
        for (const v of neighbors) {
          adj.get(v)?.delete(u);
        }
        adj.delete(u);
        changed = true;
      }
    }
  }

  // 5. Sort outgoing half-edges at each node by angle atan2(dy, dx)
  const sortedNeighbors = new Map<number, number[]>();
  for (const [u, neighbors] of adj.entries()) {
    const nu = nodes[u];
    const list = Array.from(neighbors).sort((a, b) => {
      const angA = Math.atan2(nodes[a].y - nu.y, nodes[a].x - nu.x);
      const angB = Math.atan2(nodes[b].y - nu.y, nodes[b].x - nu.x);
      return angA - angB;
    });
    sortedNeighbors.set(u, list);
  }

  // 6. Walk minimal faces using half-edge traversal
  const usedHalfEdges = new Set<string>();
  const detectedPolygons: Point[][] = [];

  for (const [u, list] of sortedNeighbors.entries()) {
    for (const v of list) {
      const startKey = `${u}->${v}`;
      if (usedHalfEdges.has(startKey)) continue;

      const cycleNodeIds: number[] = [];
      let currU = u;
      let currV = v;
      let guard = 0;
      let closed = false;

      while (guard++ < 200) {
        const key = `${currU}->${currV}`;
        if (usedHalfEdges.has(key)) break;
        usedHalfEdges.add(key);
        cycleNodeIds.push(currU);

        const nextList = sortedNeighbors.get(currV);
        if (!nextList || nextList.length === 0) break;
        const backIdx = nextList.indexOf(currU);
        if (backIdx === -1) break;
        const nextW = nextList[(backIdx - 1 + nextList.length) % nextList.length];
        currU = currV;
        currV = nextW;
        if (currU === u && currV === v) {
          closed = true;
          break;
        }
      }

      if (!closed || cycleNodeIds.length < 3) continue;

      const rawPoly = cycleNodeIds.map((id) => nodes[id]);
      let signedArea2 = 0;
      for (let i = 0; i < rawPoly.length; i++) {
        const p1 = rawPoly[i];
        const p2 = rawPoly[(i + 1) % rawPoly.length];
        signedArea2 += p1.x * p2.y - p2.x * p1.y;
      }

      // In screen coordinates (+X right, +Y down), interior rooms have positive shoelace area (> 0.25 m²)
      if (signedArea2 <= 5000) continue;

      // Simplify collinear points
      const simplified: Point[] = [];
      for (let i = 0; i < rawPoly.length; i++) {
        const prev = rawPoly[(i - 1 + rawPoly.length) % rawPoly.length];
        const curr = rawPoly[i];
        const next = rawPoly[(i + 1) % rawPoly.length];
        const proj = projectPointOnSegmentUnclamped(curr.x, curr.y, prev.x, prev.y, next.x, next.y);
        if (proj.dist > 0.8) {
          simplified.push(curr);
        }
      }

      if (simplified.length >= 3 && polygonAreaM2(simplified) >= 0.3) {
        detectedPolygons.push(simplified);
      }
    }
  }

  if (detectedPolygons.length === 0) return floor;

  // 7. Match detected rooms against existing rooms to preserve names, materials, colors & AI renders
  const matchedExistingIds = new Set<string>();
  const nextRooms: RoomZone[] = detectedPolygons.map((poly, idx) => {
    const centroid = polygonCentroid(poly);
    let bestMatch: RoomZone | undefined;
    for (const existing of floor.rooms) {
      if (matchedExistingIds.has(existing.id)) continue;
      const exCentroid = polygonCentroid(existing.points);
      if (pointInPolygon(exCentroid.x, exCentroid.y, poly) || pointInPolygon(centroid.x, centroid.y, existing.points)) {
        bestMatch = existing;
        break;
      }
    }

    if (bestMatch) {
      matchedExistingIds.add(bestMatch.id);
      return {
        ...bestMatch,
        points: poly,
      };
    }

    return {
      id: `rm_${Date.now().toString(36)}_${idx}`,
      name: floor.isExterior ? `Zone ${idx + 1}` : `Pièce ${idx + 1}`,
      points: poly,
      floorType: floor.isExterior ? 'deck' : 'tile',
    };
  });

  // Preserve unmatched unwalled zones (e.g. an exterior terrace outside the building)
  for (const existing of floor.rooms) {
    if (matchedExistingIds.has(existing.id)) continue;
    const exCentroid = polygonCentroid(existing.points);
    const fallsInsideDetected = detectedPolygons.some((poly) =>
      pointInPolygon(exCentroid.x, exCentroid.y, poly)
    );
    if (!fallsInsideDetected) {
      nextRooms.push(existing);
    }
  }

  return {
    ...floor,
    rooms: nextRooms,
  };
}

export async function compressImageToWebP(
  file: File,
  maxDimension = 1280,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image invalide'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const webp = canvas.toDataURL('image/webp', quality);
        resolve(webp);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
