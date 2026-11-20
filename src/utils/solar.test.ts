import { describe, expect, it } from 'vitest';
import { computeSunPosition } from './solar';

describe('solar.ts', () => {
  const center = { x: 0, y: 0, z: 0 };

  it('places sun in the South (+Z) at solar noon (13h) when southAngleDeg=0', () => {
    const sun = computeSunPosition(center, 13, 0, 20);
    expect(sun.z).toBeGreaterThan(5);
    expect(Math.abs(sun.x)).toBeLessThan(1e-6);
    expect(sun.y).toBeGreaterThan(15);
    expect(sun.azimuthLabel).toBe('Sud');
  });

  it('rotates South orientation when southAngleDeg=90 (South on -X / left)', () => {
    const sun = computeSunPosition(center, 13, 90, 20);
    expect(sun.x).toBeLessThan(-5);
    expect(Math.abs(sun.z)).toBeLessThan(1e-6);
  });

  it('moves sun from East (+X) at 6h to West (-X) at 20h when southAngleDeg=0', () => {
    const morning = computeSunPosition(center, 6, 0, 20);
    const evening = computeSunPosition(center, 20, 0, 20);
    expect(morning.x).toBeGreaterThan(15);
    expect(morning.azimuthLabel).toBe('Est');
    expect(evening.x).toBeLessThan(-15);
    expect(evening.azimuthLabel).toBe('Ouest');
  });
});
