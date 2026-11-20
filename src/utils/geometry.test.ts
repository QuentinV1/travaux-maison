import { describe, expect, it } from 'vitest';
import {
  detectRoomsFromWalls,
  formatAreaM2,
  formatCm,
  formatMeters,
  pointInPolygon,
  polygonAreaM2,
  polygonCentroid,
  polygonPerimeterM,
  roundCm,
  snapValue,
  wallLengthCm,
} from './geometry';
import type { Floor } from '../types';

describe('geometry.ts', () => {
  it('computes wallLengthCm and roundCm accurately', () => {
    expect(wallLengthCm({ x1: 0, y1: 0, x2: 300, y2: 400 })).toBe(500);
    expect(roundCm(12.3456)).toBe(12.35);
    expect(roundCm(12.3456, 1)).toBe(12.3);
  });

  it('formats dimensions and areas', () => {
    expect(formatCm(250)).toBe('250 cm');
    expect(formatMeters(250, 'm')).toBe('2,50 m');
    expect(formatMeters(85, 'auto')).toBe('85 cm');
    expect(formatMeters(250, 'auto')).toBe('2,50 m');
    expect(formatAreaM2(12.345)).toBe('12,35 m²');
  });

  it('computes polygon area, perimeter, centroid, and point-in-polygon', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    expect(polygonAreaM2(rect)).toBeCloseTo(12, 5);
    expect(polygonPerimeterM(rect)).toBeCloseTo(14, 5);
    expect(polygonCentroid(rect)).toEqual({ x: 200, y: 150 });
    expect(pointInPolygon(200, 150, rect)).toBe(true);
    expect(pointInPolygon(450, 150, rect)).toBe(false);
  });

  it('snaps values to grid', () => {
    expect(snapValue(12.4, 5)).toBe(10);
    expect(snapValue(12.6, 5)).toBe(15);
  });

  it('detects closed rooms from 4 connected walls', () => {
    const floor: Floor = {
      id: 'fl_1',
      houseId: 'h_1',
      name: 'RDC',
      order: 0,
      isExterior: false,
      defaultWallHeightCm: 250,
      walls: [
        { id: 'w1', x1: 0, y1: 0, x2: 400, y2: 0, thicknessCm: 20 },
        { id: 'w2', x1: 400, y1: 0, x2: 400, y2: 300, thicknessCm: 20 },
        { id: 'w3', x1: 400, y1: 300, x2: 0, y2: 300, thicknessCm: 20 },
        { id: 'w4', x1: 0, y1: 300, x2: 0, y2: 0, thicknessCm: 20 },
      ],
      openings: [],
      rooms: [],
      furniture: [],
    };
    const updated = detectRoomsFromWalls(floor);
    expect(updated.rooms.length).toBe(1);
    expect(polygonAreaM2(updated.rooms[0].points)).toBeCloseTo(12, 1);
  });
});
