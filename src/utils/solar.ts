export interface SunPosition3D {
  x: number;
  y: number;
  z: number;
  elevationDeg: number;
  azimuthLabel: string;
}

/**
 * Computes the 3D sun position relative to `center` for a given `sunHour` (6..20)
 * and `southAngleDeg` (0 = South at +Z / bottom of 2D plan, rotating clockwise).
 */
export function computeSunPosition(
  center: { x: number; y: number; z: number },
  sunHour: number,
  southAngleDeg = 0,
  dist = 28
): SunPosition3D {
  const clampedHour = Math.max(6, Math.min(20, sunHour));
  const t = (clampedHour - 6) / 14;
  const southRad = (southAngleDeg * Math.PI) / 180;

  // Map-aligned basis: at 0 deg, South = (0, +1) [+Z], East = (+1, 0) [+X]
  const southX = -Math.sin(southRad);
  const southZ = Math.cos(southRad);
  const eastX = Math.cos(southRad);
  const eastZ = Math.sin(southRad);

  const elevationRad = Math.max(0.14, Math.sin(t * Math.PI) * (Math.PI * 0.38));
  const azimuthFromSouth = (t - 0.5) * Math.PI; // -pi/2 (East) -> 0 (South) -> +pi/2 (West)

  const cosAz = Math.cos(azimuthFromSouth);
  const sinAz = Math.sin(azimuthFromSouth);
  const horizX = southX * cosAz - eastX * sinAz;
  const horizZ = southZ * cosAz - eastZ * sinAz;

  const cosEl = Math.cos(elevationRad);
  const x = center.x + horizX * cosEl * dist;
  const y = center.y + Math.sin(elevationRad) * dist;
  const z = center.z + horizZ * cosEl * dist;

  let azimuthLabel = 'Sud';
  if (t < 0.28) azimuthLabel = 'Est';
  else if (t < 0.44) azimuthLabel = 'Sud-Est';
  else if (t <= 0.56) azimuthLabel = 'Sud';
  else if (t <= 0.72) azimuthLabel = 'Sud-Ouest';
  else azimuthLabel = 'Ouest';

  return {
    x,
    y,
    z,
    elevationDeg: Math.round((elevationRad * 180) / Math.PI),
    azimuthLabel,
  };
}
