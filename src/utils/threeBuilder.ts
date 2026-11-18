import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Floor, FloorMaterial, FurnitureItem, Opening, RoomZone, Wall } from '../types';
import { FLOOR_MATERIAL_LABELS, OPENING_TYPE_LABELS } from '../data/furnitureCatalog';
import { pointInPolygon, polygonAreaM2, polygonBounds, polygonCentroid, wallLengthCm } from './geometry';
import {
  createCroppedFabricTextureFromPhoto,
  getProceduralFloorTextures,
  getProceduralFurnitureTextures,
  getProceduralWallTextures,
  loadExternalOrDataUrlTexture,
  traceAlphaContourPoints,
} from './textures3d';

export interface PickableMetadata {
  kind: 'wall' | 'room' | 'ceiling' | 'furniture' | 'opening';
  id: string;
  label: string;
  details: string;
  wallSide?: 'front' | 'back';
}

const CM_TO_M = 0.01;

const FLOOR_COLORS: Record<FloorMaterial, string> = {
  tile: '#e2e8f0',
  'tile-marble': '#f8fafc',
  terrazzo: '#f1f5f9',
  'cement-tile': '#dce3ea',
  wood: '#d9a973',
  'wood-herringbone': '#cfa06b',
  'wood-dark': '#8c6239',
  carpet: '#c4b5fd',
  concrete: '#cbd5e1',
  deck: '#c29563',
  grass: '#86efac',
};

const gltfLoader = new GLTFLoader();

function parseHexColor(hex?: string, fallback = 0xe2e8f0): number {
  if (!hex || !hex.startsWith('#')) return fallback;
  const clean = hex.slice(1).trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const parsed = Number.parseInt(full, 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function tagPickable(obj: THREE.Object3D, meta: PickableMetadata): void {
  obj.userData.pickable = meta;
  obj.traverse((child) => {
    child.userData.pickable = meta;
  });
}

function createWallFaceMaterials(
  wall: Wall,
  wallLenM: number,
  wallHeightM: number,
  realisticMode: boolean
): {
  frontMat: THREE.MeshStandardMaterial;
  backMat: THREE.MeshStandardMaterial;
  edgeMat: THREE.MeshStandardMaterial;
  boxMaterials: THREE.Material[];
} {
  const frontHex = wall.colorFront ?? '#f1f5f9';
  const backHex = wall.colorBack ?? '#f1f5f9';

  const makeFaceMat = (
    matType: Wall['materialFront'],
    hex: string,
    texUrl?: string
  ): THREE.MeshStandardMaterial => {
    if (texUrl) {
      const map = loadExternalOrDataUrlTexture(texUrl);
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(Math.max(1, wallLenM / 1.5), Math.max(1, wallHeightM / 1.5));
      return new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map,
        roughness: 0.72,
        metalness: 0.04,
      });
    }
    const proc = getProceduralWallTextures(matType, hex, realisticMode, wallLenM, wallHeightM);
    return new THREE.MeshStandardMaterial({
      color: proc.map ? 0xffffff : parseHexColor(hex, 0xf1f5f9),
      map: proc.map,
      bumpMap: proc.bumpMap,
      bumpScale: proc.bumpScale,
      roughness: proc.roughness,
      metalness: proc.metalness,
    });
  };

  const frontMat = makeFaceMat(wall.materialFront, frontHex, wall.textureUrlFront);
  const backMat = makeFaceMat(wall.materialBack, backHex, wall.textureUrlBack);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: parseHexColor(frontHex, 0xe2e8f0),
    roughness: 0.85,
    metalness: 0.02,
  });

  // BoxGeometry faces: 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z(front), 5:-Z(back)
  const boxMaterials = [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat];
  return { frontMat, backMat, edgeMat, boxMaterials };
}

function createWallSegmentMesh(
  lengthM: number,
  heightM: number,
  thicknessM: number,
  centerX: number,
  centerY: number,
  materials: THREE.Material | THREE.Material[]
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(lengthM, heightM, thicknessM);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.position.set(centerX, centerY, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function sampleArchHeightRatio(shape: Opening['archShape'], u: number, flip: boolean): number {
  const t = flip ? 1 - u : u;
  switch (shape) {
    case 'half-circle':
    case 'segmental': {
      const x = 2 * t - 1;
      return Math.sqrt(Math.max(0, 1 - x * x));
    }
    case 'rounded-corners': {
      const cornerSpan = 0.25;
      if (t < cornerSpan) {
        const k = 1 - t / cornerSpan;
        return Math.sqrt(Math.max(0, 1 - k * k));
      }
      if (t > 1 - cornerSpan) {
        const k = (t - (1 - cornerSpan)) / cornerSpan;
        return Math.sqrt(Math.max(0, 1 - k * k));
      }
      return 1;
    }
    case 'asymmetric': {
      return Math.sqrt(Math.max(0, t));
    }
    case 'pointed': {
      const d = Math.abs(2 * t - 1);
      return Math.pow(Math.max(0, 1 - d), 0.72);
    }
    default:
      return 0;
  }
}

function buildArchedLintelGroup(
  segWidthM: number,
  sillHeightM: number,
  opHeightM: number,
  wallHeightM: number,
  thicknessM: number,
  centerX: number,
  opening: Opening,
  frontMat: THREE.Material,
  backMat: THREE.Material,
  edgeMat: THREE.Material,
  wallMeta: PickableMetadata,
  openingMeta: PickableMetadata
): THREE.Group {
  const group = new THREE.Group();
  const shapeType = opening.archShape ?? 'flat';
  const topY = sillHeightM + opHeightM;
  const maxRise = Math.min(opHeightM * 0.75, segWidthM * 0.55);

  let riseM = 0;
  if (shapeType === 'half-circle') {
    riseM = Math.min(segWidthM / 2, opHeightM * 0.75);
  } else if (shapeType !== 'flat') {
    const requestedRise = (opening.archRiseCm ?? (shapeType === 'pointed' ? opening.widthCm * 0.42 : 26)) * CM_TO_M;
    riseM = Math.max(0.05, Math.min(maxRise, requestedRise));
  }

  if (riseM <= 0.01) {
    const lintelHeightM = wallHeightM - topY;
    if (lintelHeightM > 0.01) {
      const box = createWallSegmentMesh(
        segWidthM,
        lintelHeightM,
        thicknessM,
        centerX,
        topY + lintelHeightM / 2,
        [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat]
      );
      tagPickable(box, wallMeta);
      group.add(box);
    }
    return group;
  }

  const springY = topY - riseM;
  const halfW = segWidthM / 2;
  const segments = 24;

  const shape = new THREE.Shape();
  shape.moveTo(-halfW, wallHeightM);
  shape.lineTo(halfW, wallHeightM);
  shape.lineTo(halfW, springY);

  const curvePts: Array<{ x: number; y: number }> = [];
  for (let i = segments; i >= 0; i--) {
    const u = i / segments;
    const x = -halfW + u * segWidthM;
    const y = Math.min(wallHeightM - 0.01, springY + riseM * sampleArchHeightRatio(shapeType, u, opening.flip));
    curvePts.push({ x, y });
    shape.lineTo(x, y);
  }
  shape.closePath();

  const halfThick = thicknessM / 2;
  // Front half extrusion (+Z)
  const frontGeo = new THREE.ExtrudeGeometry(shape, { depth: halfThick, bevelEnabled: false });
  const frontMesh = new THREE.Mesh(frontGeo, [frontMat, edgeMat]);
  frontMesh.position.set(centerX, 0, 0);
  frontMesh.castShadow = true;
  frontMesh.receiveShadow = true;
  tagPickable(frontMesh, { ...wallMeta, wallSide: 'front' });

  // Back half extrusion (-Z)
  const backGeo = new THREE.ExtrudeGeometry(shape, { depth: halfThick, bevelEnabled: false });
  const backMesh = new THREE.Mesh(backGeo, [backMat, edgeMat]);
  backMesh.position.set(centerX, 0, -halfThick);
  backMesh.castShadow = true;
  backMesh.receiveShadow = true;
  tagPickable(backMesh, { ...wallMeta, wallSide: 'back' });

  group.add(frontMesh, backMesh);

  // Build thin arch soffit / trim along the underside of the arch so it's crisp & clickable as an opening
  const hasFrame = opening.hasFrame ?? opening.type !== 'arch-passage';
  const soffitMat = hasFrame
    ? new THREE.MeshStandardMaterial({
        color: parseHexColor(opening.frameColor, 0x78553a),
        roughness: 0.55,
      })
    : edgeMat;
  const soffitDepth = hasFrame ? thicknessM + 0.025 : thicknessM + 0.002;
  const soffitThick = hasFrame ? 0.035 : 0.012;

  for (let i = 0; i < curvePts.length - 1; i++) {
    const p1 = curvePts[i];
    const p2 = curvePts[i + 1];
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (segLen < 0.005) continue;
    const midX = centerX + (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(segLen + 0.008, soffitThick, soffitDepth),
      soffitMat
    );
    bar.position.set(midX, midY, 0);
    bar.rotation.z = ang;
    bar.castShadow = true;
    bar.receiveShadow = true;
    tagPickable(bar, openingMeta);
    group.add(bar);
  }

  return group;
}

function buildOpeningVisuals(
  opening: Opening,
  segWidthM: number,
  wallHeightM: number,
  thicknessM: number,
  centerX: number,
  wallMatBundle: ReturnType<typeof createWallFaceMaterials>,
  wallMeta: PickableMetadata
): THREE.Group {
  const group = new THREE.Group();
  const defaultSillCm =
    opening.type === 'window'
      ? 90
      : opening.type === 'interior-glass' || opening.type === 'pass-through'
        ? 100
        : 0;
  const sillHeightM = Math.max(
    0,
    Math.min(wallHeightM - 0.3, (opening.sillHeightCm ?? defaultSillCm) * CM_TO_M)
  );
  const opHeightM = Math.min(opening.heightCm * CM_TO_M, Math.max(0.2, wallHeightM - sillHeightM));

  const defaultFrameColor =
    opening.type === 'interior-glass'
      ? '#1e293b'
      : opening.type === 'sliding-door'
        ? '#334155'
        : '#78553a';
  const hasFrame = opening.hasFrame ?? opening.type !== 'arch-passage';
  const frameDepth = thicknessM + 0.022;
  const frameThick = Math.max(0.02, (opening.frameThicknessCm ?? 4) * CM_TO_M);

  const frameMat = new THREE.MeshStandardMaterial({
    color: parseHexColor(opening.frameColor ?? defaultFrameColor, 0x78553a),
    roughness: opening.type === 'interior-glass' || opening.type === 'sliding-door' ? 0.42 : 0.6,
    metalness: opening.type === 'interior-glass' || opening.type === 'sliding-door' ? 0.35 : 0.05,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xcbeafe,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    metalness: 0.08,
  });

  const opLabel = OPENING_TYPE_LABELS[opening.type] ?? 'Ouverture';
  const openingMeta: PickableMetadata = {
    kind: 'opening',
    id: opening.id,
    label: opLabel,
    details: `${Math.round(opening.widthCm)} × ${Math.round(opening.heightCm)} cm`,
  };

  // 1. Sill wall below opening if sillHeightM > 0
  if (sillHeightM > 0.01) {
    const sillWall = createWallSegmentMesh(
      segWidthM,
      sillHeightM,
      thicknessM,
      centerX,
      sillHeightM / 2,
      wallMatBundle.boxMaterials
    );
    tagPickable(sillWall, wallMeta);
    group.add(sillWall);
  }

  // 2. Arched or flat lintel above opening
  group.add(
    buildArchedLintelGroup(
      segWidthM,
      sillHeightM,
      opHeightM,
      wallHeightM,
      thicknessM,
      centerX,
      opening,
      wallMatBundle.frontMat,
      wallMatBundle.backMat,
      wallMatBundle.edgeMat,
      wallMeta,
      openingMeta
    )
  );

  // 3. Side jambs & top lintel frame (when hasFrame) or subtle inner reveal for clickability
  const archShape = opening.archShape ?? 'flat';
  const isFlatTop = archShape === 'flat';
  const riseM =
    archShape === 'half-circle'
      ? Math.min(segWidthM / 2, opHeightM * 0.75)
      : archShape !== 'flat'
        ? Math.min(opHeightM * 0.75, segWidthM * 0.55, (opening.archRiseCm ?? 26) * CM_TO_M)
        : 0;
  const sideJambH = Math.max(0.1, opHeightM - riseM);
  const sideJambMidY = sillHeightM + sideJambH / 2;

  const openingVisualsGroup = new THREE.Group();

  if (hasFrame) {
    const leftBar = new THREE.Mesh(
      new THREE.BoxGeometry(frameThick, sideJambH, frameDepth),
      frameMat
    );
    leftBar.position.set(centerX - segWidthM / 2 + frameThick / 2, sideJambMidY, 0);
    const rightBar = new THREE.Mesh(
      new THREE.BoxGeometry(frameThick, sideJambH, frameDepth),
      frameMat
    );
    rightBar.position.set(centerX + segWidthM / 2 - frameThick / 2, sideJambMidY, 0);
    openingVisualsGroup.add(leftBar, rightBar);

    if (isFlatTop) {
      const topBar = new THREE.Mesh(
        new THREE.BoxGeometry(segWidthM, frameThick, frameDepth),
        frameMat
      );
      topBar.position.set(centerX, sillHeightM + opHeightM - frameThick / 2, 0);
      openingVisualsGroup.add(topBar);
    }

    if (sillHeightM > 0.01) {
      const botBar = new THREE.Mesh(
        new THREE.BoxGeometry(segWidthM, frameThick, frameDepth + (opening.type === 'pass-through' ? 0.08 : 0)),
        frameMat
      );
      botBar.position.set(centerX, sillHeightM + frameThick / 2, 0);
      openingVisualsGroup.add(botBar);
    }
  } else {
    // Smooth plaster jamb lining (allows clicking the opening in 3D without altering wall look)
    const jambMat = wallMatBundle.edgeMat;
    const leftJamb = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, sideJambH, thicknessM + 0.002),
      jambMat
    );
    leftJamb.position.set(centerX - segWidthM / 2 + 0.007, sideJambMidY, 0);
    const rightJamb = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, sideJambH, thicknessM + 0.002),
      jambMat
    );
    rightJamb.position.set(centerX + segWidthM / 2 - 0.007, sideJambMidY, 0);
    openingVisualsGroup.add(leftJamb, rightJamb);
  }

  // 4. Interior fill depending on opening type
  const innerW = Math.max(0.08, segWidthM - (hasFrame ? frameThick * 2 : 0.02));
  const innerH = Math.max(0.1, opHeightM - (hasFrame ? frameThick : 0.02) - (sillHeightM > 0.01 && hasFrame ? frameThick : 0));
  const innerMidY = sillHeightM + (sillHeightM > 0.01 && hasFrame ? frameThick : 0) + innerH / 2;

  if (opening.type === 'window') {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(innerW, innerH, 0.02), glassMat);
    glass.position.set(centerX, innerMidY, 0);
    openingVisualsGroup.add(glass);
  } else if (opening.type === 'interior-glass') {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(innerW, innerH, 0.018), glassMat);
    glass.position.set(centerX, innerMidY, 0);
    openingVisualsGroup.add(glass);

    const mullions = Math.max(1, Math.min(8, opening.glassMullions ?? 3));
    for (let m = 1; m <= mullions; m++) {
      const mx = centerX - innerW / 2 + (innerW * m) / (mullions + 1);
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, sideJambH, frameDepth * 0.72),
        frameMat
      );
      bar.position.set(mx, sideJambMidY, 0);
      openingVisualsGroup.add(bar);
    }
  } else if (opening.type === 'sliding-door') {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(innerW, innerH, 0.03), glassMat);
    panel.position.set(centerX, innerMidY, 0);
    const centerBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, innerH, 0.045), frameMat);
    centerBar.position.set(centerX, innerMidY, 0);
    openingVisualsGroup.add(panel, centerBar);
  } else if (opening.type === 'pocket-door') {
    const leafW = innerW * 0.45;
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(leafW, innerH, 0.038),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 })
    );
    leaf.position.set(
      centerX + (opening.flip ? innerW / 2 - leafW / 2 : -innerW / 2 + leafW / 2),
      innerMidY,
      0
    );
    leaf.castShadow = true;
    openingVisualsGroup.add(leaf);
  } else if (opening.type === 'double-door') {
    const leafW = innerW * 0.49;
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55 });
    const leftHinge = new THREE.Group();
    leftHinge.position.set(centerX - innerW / 2, innerMidY, 0);
    const leftLeaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, innerH, 0.038), leafMat);
    leftLeaf.position.set(leafW / 2, 0, 0);
    leftLeaf.castShadow = true;
    leftHinge.add(leftLeaf);
    leftHinge.rotation.y = opening.flip ? 0.55 : -0.55;

    const rightHinge = new THREE.Group();
    rightHinge.position.set(centerX + innerW / 2, innerMidY, 0);
    const rightLeaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, innerH, 0.038), leafMat);
    rightLeaf.position.set(-leafW / 2, 0, 0);
    rightLeaf.castShadow = true;
    rightHinge.add(rightLeaf);
    rightHinge.rotation.y = opening.flip ? -0.55 : 0.55;

    openingVisualsGroup.add(leftHinge, rightHinge);
  } else if (opening.type === 'door') {
    const isRightHinge = opening.hinge === 'right';
    const doorLeaf = new THREE.Mesh(
      new THREE.BoxGeometry(innerW, innerH, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55 })
    );
    doorLeaf.castShadow = true;
    doorLeaf.position.set(isRightHinge ? -innerW / 2 : innerW / 2, 0, 0);

    const handleInset = Math.min(0.07, innerW * 0.25);
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.022, 0.09),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.6 })
    );
    handle.position.set(isRightHinge ? -innerW + handleInset : innerW - handleInset, -0.04, 0);

    const hingeGroup = new THREE.Group();
    hingeGroup.position.set(centerX + (isRightHinge ? innerW / 2 : -innerW / 2), innerMidY, 0);
    hingeGroup.add(doorLeaf, handle);
    const swingSign = (opening.flip ? 1 : -1) * (isRightHinge ? -1 : 1);
    hingeGroup.rotation.y = swingSign * 0.55;
    openingVisualsGroup.add(hingeGroup);
  }
  // 'arch-passage' and 'pass-through' intentionally keep the center open!

  tagPickable(openingVisualsGroup, openingMeta);
  group.add(openingVisualsGroup);
  return group;
}

function buildWallGroup(
  wall: Wall,
  openings: Opening[],
  defaultWallHeightCm: number,
  realisticMode: boolean
): THREE.Group {
  const lengthCm = wallLengthCm(wall);
  const group = new THREE.Group();
  if (lengthCm < 1) return group;

  const lengthM = lengthCm * CM_TO_M;
  const thicknessM = Math.max(0.01, wall.thicknessCm * CM_TO_M);
  const effectiveHeightCm = wall.isLowWall
    ? wall.heightCm ?? 110
    : wall.heightCm ?? defaultWallHeightCm;
  const wallHeightM = Math.max(0.01, effectiveHeightCm * CM_TO_M);

  const wallMatBundle = createWallFaceMaterials(wall, lengthM, wallHeightM, realisticMode);
  const wallMeta: PickableMetadata = {
    kind: 'wall',
    id: wall.id,
    label: wall.isLowWall ? 'Demi-mur / Bar' : wall.wallType === 'interior' ? 'Cloison' : 'Mur',
    details: `Longueur ${(lengthCm / 100).toFixed(2)} m · Hauteur ${wallHeightM.toFixed(2)} m · Ép. ${wall.thicknessCm} cm`,
  };

  const dx = (wall.x2 - wall.x1) * CM_TO_M;
  const dz = (wall.y2 - wall.y1) * CM_TO_M;
  group.position.set(wall.x1 * CM_TO_M, 0, wall.y1 * CM_TO_M);
  group.rotation.y = -Math.atan2(dz, dx);

  const isClaustra =
    wall.materialFront === 'claustra' || wall.materialBack === 'claustra';

  const addSolidSpan = (startM: number, segLenM: number) => {
    if (isClaustra) {
      const slatColor = parseHexColor(wall.colorFront ?? '#c89b68', 0xc89b68);
      const slatMat = new THREE.MeshStandardMaterial({
        color: slatColor,
        roughness: 0.6,
        metalness: 0.04,
      });
      const pitch = 0.085;
      const count = Math.max(2, Math.floor(segLenM / pitch));
      for (let i = 0; i < count; i++) {
        const sx = startM + (i + 0.5) * (segLenM / count);
        const slat = new THREE.Mesh(
          new THREE.BoxGeometry(0.036, wallHeightM, thicknessM),
          slatMat
        );
        slat.position.set(sx, wallHeightM / 2, 0);
        slat.castShadow = true;
        slat.receiveShadow = true;
        tagPickable(slat, wallMeta);
        group.add(slat);
      }
      // Top and bottom slim rails
      const railH = 0.03;
      const topRail = createWallSegmentMesh(
        segLenM,
        railH,
        thicknessM,
        startM + segLenM / 2,
        wallHeightM - railH / 2,
        slatMat
      );
      const botRail = createWallSegmentMesh(
        segLenM,
        railH,
        thicknessM,
        startM + segLenM / 2,
        railH / 2,
        slatMat
      );
      tagPickable(topRail, wallMeta);
      tagPickable(botRail, wallMeta);
      group.add(topRail, botRail);
      return;
    }

    const seg = createWallSegmentMesh(
      segLenM,
      wallHeightM,
      thicknessM,
      startM + segLenM / 2,
      wallHeightM / 2,
      wallMatBundle.boxMaterials
    );
    tagPickable(seg, wallMeta);
    group.add(seg);

    if (wall.isLowWall) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(segLenM, 0.035, thicknessM + 0.04),
        new THREE.MeshStandardMaterial({ color: 0xb48454, roughness: 0.55 })
      );
      cap.position.set(startM + segLenM / 2, wallHeightM + 0.0175, 0);
      cap.castShadow = true;
      cap.receiveShadow = true;
      tagPickable(cap, wallMeta);
      group.add(cap);
    }
  };

  const sortedOpenings = [...openings].sort((a, b) => a.offsetRatio - b.offsetRatio);
  let cursor = 0;

  for (const op of sortedOpenings) {
    const halfW = Math.min((op.widthCm * CM_TO_M) / 2, lengthM * 0.47);
    const center = op.offsetRatio * lengthM;
    const start = Math.max(cursor, center - halfW);
    const end = Math.min(lengthM, center + halfW);

    if (start - cursor > 0.01) {
      addSolidSpan(cursor, start - cursor);
    }

    if (end - start > 0.05) {
      group.add(
        buildOpeningVisuals(
          op,
          end - start,
          wallHeightM,
          thicknessM,
          (start + end) / 2,
          wallMatBundle,
          wallMeta
        )
      );
    }
    cursor = Math.max(cursor, end);
  }

  if (lengthM - cursor > 0.01) {
    addSolidSpan(cursor, lengthM - cursor);
  }

  return group;
}

function buildRoomFloorMesh(room: RoomZone, realisticMode: boolean): THREE.Mesh | null {
  if (room.points.length < 3) return null;
  const shape = new THREE.Shape();
  room.points.forEach((p, idx) => {
    const sx = p.x * CM_TO_M;
    const sy = -p.y * CM_TO_M; // rotateX(-PI/2) maps +Y_shape to -Z_world
    if (idx === 0) shape.moveTo(sx, sy);
    else shape.lineTo(sx, sy);
  });
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);

  const hexColor = room.color ?? FLOOR_COLORS[room.floorType] ?? '#e2e8f0';
  const proc = getProceduralFloorTextures(
    room.floorType,
    hexColor,
    realisticMode,
    room.floorScale ?? 1,
    room.floorOrientationDeg ?? 0
  );

  const mat = new THREE.MeshStandardMaterial({
    color: proc.map ? 0xffffff : parseHexColor(hexColor),
    map: proc.map,
    bumpMap: proc.bumpMap,
    bumpScale: proc.bumpScale,
    roughness: proc.roughness,
    metalness: proc.metalness,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.005;
  mesh.receiveShadow = true;

  const area = polygonAreaM2(room.points);
  const matLabel = FLOOR_MATERIAL_LABELS[room.floorType]?.label ?? room.floorType;
  tagPickable(mesh, {
    kind: 'room',
    id: room.id,
    label: room.name,
    details: `${area.toFixed(2)} m² · Sol : ${matLabel}`,
  });

  return mesh;
}

function buildRoomCeilingMesh(room: RoomZone, heightM: number): THREE.Group | null {
  if (room.points.length < 3) return null;
  const group = new THREE.Group();

  const shape = new THREE.Shape();
  room.points.forEach((pt, idx) => {
    const sx = pt.x * CM_TO_M;
    const sy = -pt.y * CM_TO_M;
    if (idx === 0) shape.moveTo(sx, sy);
    else shape.lineTo(sx, sy);
  });
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshStandardMaterial({
    color: parseHexColor(room.ceilingColor, 0xf8fafc),
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = heightM;
  mesh.receiveShadow = true;
  group.add(mesh);

  if (room.ceilingBeams) {
    const bounds = polygonBounds(room.points);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x8b5e34, roughness: 0.72 });
    const wM = bounds.width * CM_TO_M;
    const hM = bounds.height * CM_TO_M;
    const alongX = wM <= hM;
    const span = alongX ? wM : hM;
    const perp = alongX ? hM : wM;
    const spacing = 0.95;
    const count = Math.max(1, Math.floor(perp / spacing));
    for (let i = 0; i < count; i++) {
      const offset = (i + 0.5) * (perp / count);
      const bx = alongX ? (bounds.minX + bounds.maxX) * 0.5 * CM_TO_M : bounds.minX * CM_TO_M + offset;
      const bz = alongX ? bounds.minY * CM_TO_M + offset : (bounds.minY + bounds.maxY) * 0.5 * CM_TO_M;
      if (!pointInPolygon(bx / CM_TO_M, bz / CM_TO_M, room.points)) continue;
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? Math.max(0.2, span - 0.1) : 0.12, 0.12, alongX ? 0.12 : Math.max(0.2, span - 0.1)),
        beamMat
      );
      beam.position.set(bx, heightM - 0.06, bz);
      beam.castShadow = true;
      group.add(beam);
    }
  }

  tagPickable(group, {
    kind: 'ceiling',
    id: room.id,
    label: `Plafond — ${room.name}`,
    details: `Hauteur ${heightM.toFixed(2)} m${room.ceilingBeams ? ' · Poutres apparentes' : ''}`,
  });

  return group;
}

function createSoftContactShadow(w: number, d: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w * 1.06, d * 1.06);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.009;
  return m;
}

function buildFurnitureGroup(item: FurnitureItem, realisticMode: boolean): THREE.Group {
  const group = new THREE.Group();
  const w = Math.max(0.01, item.widthCm * CM_TO_M);
  const d = Math.max(0.01, item.depthCm * CM_TO_M);
  const customH = item.heightCm ? Math.max(0.1, item.heightCm * CM_TO_M) : undefined;
  const colorHex = item.color ?? '#cbd5e1';
  const colorNum = parseHexColor(colorHex, 0xcbd5e1);
  const secondaryHex = item.secondaryColor ?? '#334155';
  const secondaryNum = parseHexColor(secondaryHex, 0x334155);

  const procMain = getProceduralFurnitureTextures(item.materialType, colorHex, realisticMode);
  const mainMat = new THREE.MeshStandardMaterial({
    color: procMain.map ? 0xffffff : colorNum,
    map: procMain.map,
    bumpMap: procMain.bumpMap,
    bumpScale: procMain.bumpScale,
    roughness: procMain.roughness,
    metalness: procMain.metalness,
  });
  const secMat = new THREE.MeshStandardMaterial({ color: secondaryNum, roughness: 0.45, metalness: 0.25 });
  const cushionColor = new THREE.Color(colorNum).lerp(new THREE.Color(0xf5f0e6), 0.35);
  const cushionMat = new THREE.MeshStandardMaterial({
    color: cushionColor,
    bumpMap: procMain.bumpMap,
    bumpScale: procMain.bumpScale * 0.8,
    roughness: Math.min(0.95, procMain.roughness + 0.08),
    metalness: 0.02,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.42, metalness: 0.35 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb48454, roughness: 0.65 });

  const addBox = (
    bw: number,
    bh: number,
    bd: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const addRoundedBox = (
    bw: number,
    bh: number,
    bd: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    radius = 0.035,
    rotX = 0,
    rotY = 0,
    rotZ = 0
  ) => {
    const safeB = Math.max(0.015, bw);
    const safeH = Math.max(0.015, bh);
    const safeD = Math.max(0.015, bd);
    const r = Math.min(radius, safeB * 0.28, safeH * 0.28, safeD * 0.28);
    const geo = new RoundedBoxGeometry(safeB, safeH, safeD, 4, r);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rotX || rotY || rotZ) {
      m.rotation.set(rotX, rotY, rotZ);
    }
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const addTaperedLeg = (
    topR: number,
    botR: number,
    h: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    tiltX = 0,
    tiltZ = 0
  ) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(topR, botR, h, 12), mat);
    m.position.set(x, y, z);
    if (tiltX || tiltZ) {
      m.rotation.set(tiltX, 0, tiltZ);
    }
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const extraInfo = [
    `${item.widthCm} × ${item.depthCm}${item.heightCm ? ` × ${item.heightCm}` : ''} cm`,
    item.store ? item.store : null,
    item.price ? `${item.price} €` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const meta: PickableMetadata = {
    kind: 'furniture',
    id: item.id,
    label: item.label,
    details: extraInfo,
  };

  // Mode 1: Custom GLB 3D Model
  if (item.glbDataUrl && (item.renderMode3D === 'glb' || !item.renderMode3D)) {
    const placeholder = addRoundedBox(w, customH ?? 0.8, d, 0, (customH ?? 0.8) / 2, 0, mainMat, 0.05);
    placeholder.material = new THREE.MeshStandardMaterial({
      color: colorNum,
      transparent: true,
      opacity: 0.25,
      wireframe: true,
    });
    gltfLoader.load(
      item.glbDataUrl,
      (gltf) => {
        group.remove(placeholder);
        placeholder.geometry.dispose();
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const targetH = customH ?? Math.max(0.4, (size.y / Math.max(0.01, size.x)) * w);
        const sx = size.x > 0.001 ? w / size.x : 1;
        const sy = size.y > 0.001 ? targetH / size.y : 1;
        const sz = size.z > 0.001 ? d / size.z : 1;
        model.scale.set(sx, sy, sz);
        model.position.set(-center.x * sx, -box.min.y * sy, -center.z * sz);
        model.traverse((ch) => {
          if (ch instanceof THREE.Mesh) {
            ch.castShadow = true;
            ch.receiveShadow = true;
          }
        });
        tagPickable(model, meta);
        group.add(model);
      },
      undefined,
      () => {
        placeholder.material = mainMat;
      }
    );
  } else if (item.renderMode3D === 'photo-volumetric' && (item.cutoutDataUrl || item.imageUrl)) {
    // Mode 2: Real closed 3D Extruded Volume from product cutout silhouette (no crossed 2D planes)
    const src = item.cutoutDataUrl || item.imageUrl!;
    const targetH = customH ?? 0.85;
    const placeholder = addRoundedBox(w, targetH, d, 0, targetH / 2, 0, mainMat, 0.06);

    traceAlphaContourPoints(src, 36)
      .then((pts) => {
        if (pts.length < 6) return;
        group.remove(placeholder);
        placeholder.geometry.dispose();

        const shape = new THREE.Shape();
        pts.forEach((p, idx) => {
          const sx = p.x * w * 0.92;
          const sy = p.y * targetH * 0.94;
          if (idx === 0) shape.moveTo(sx, sy);
          else shape.lineTo(sx, sy);
        });
        shape.closePath();

        const bevelT = Math.min(d * 0.16, 0.08);
        const extrudeDepth = Math.max(0.08, d * 0.82 - bevelT * 2);
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: extrudeDepth,
          bevelEnabled: true,
          bevelThickness: bevelT,
          bevelSize: Math.min(w * 0.05, 0.04),
          bevelSegments: 5,
        });
        geo.translate(0, 0, -extrudeDepth / 2);

        const volMesh = new THREE.Mesh(geo, mainMat);
        volMesh.castShadow = true;
        volMesh.receiveShadow = true;
        tagPickable(volMesh, meta);
        group.add(volMesh);
      })
      .catch(() => undefined);
  } else {
    // Mode 3: Sculpted HD 3D Models (automatically upgrades legacy 'photo-billboard' items too!)
    const photoTex =
      item.renderMode3D === 'photo-texture' && (item.cutoutDataUrl || item.imageUrl)
        ? loadExternalOrDataUrlTexture(item.cutoutDataUrl || item.imageUrl!)
        : null;

    if (
      item.renderMode3D === 'photo-texture' &&
      item.type !== 'tv-stand' &&
      (item.cutoutDataUrl || item.imageUrl)
    ) {
      createCroppedFabricTextureFromPhoto(item.cutoutDataUrl || item.imageUrl!)
        .then((swatchUrl) => {
          const tex = loadExternalOrDataUrlTexture(swatchUrl);
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(2, 2);
          mainMat.map = tex;
          mainMat.color.setHex(0xffffff);
          mainMat.needsUpdate = true;
        })
        .catch(() => undefined);
    }

    switch (item.type) {
      case 'sofa':
      case 'corner-sofa':
      case 'armchair': {
        const variant = item.variant ?? 'modern';
        const isArmchair = item.type === 'armchair';
        const legH = variant === 'scandinavian' ? 0.16 : 0.12;
        const armW = isArmchair ? Math.min(0.14, w * 0.16) : Math.min(0.18, w * 0.1);
        const seatBaseY = legH;

        // 4 tapered angled legs
        const lx = w / 2 - 0.11;
        const lz = d / 2 - 0.11;
        const legMat = variant === 'scandinavian' ? woodMat : secMat;
        addTaperedLeg(0.02, 0.011, legH, -lx, legH / 2, -lz, legMat, -0.1, 0.1);
        addTaperedLeg(0.02, 0.011, legH, lx, legH / 2, -lz, legMat, -0.1, -0.1);
        addTaperedLeg(0.02, 0.011, legH, -lx, legH / 2, lz, legMat, 0.1, 0.1);
        addTaperedLeg(0.02, 0.011, legH, lx, legH / 2, lz, legMat, 0.1, -0.1);

        if (item.type === 'corner-sofa') {
          const chaiseRight = variant === 'chaise-right';
          const mainDepth = Math.min(d * 0.56, 0.98);
          const mainZ = -d / 2 + mainDepth / 2;
          const chaiseW = Math.min(w * 0.4, 1.02);
          const chaiseX = chaiseRight ? w / 2 - chaiseW / 2 : -w / 2 + chaiseW / 2;

          // Base chassis (main span + chaise span)
          addRoundedBox(w - 0.04, 0.11, mainDepth - 0.04, 0, seatBaseY + 0.055, mainZ, mainMat, 0.03);
          addRoundedBox(chaiseW - 0.04, 0.11, d - 0.04, chaiseX, seatBaseY + 0.055, 0, mainMat, 0.03);

          // Main bench seat cushions (2 or 3 separate cushions beside chaise)
          const restW = w - armW * 2 - chaiseW;
          const benchCushions = restW > 1.25 ? 2 : 1;
          const restStart = chaiseRight ? -w / 2 + armW : -w / 2 + armW + chaiseW;
          const cushW = Math.max(0.35, restW / benchCushions - 0.014);
          for (let i = 0; i < benchCushions; i++) {
            const cx = restStart + (i + 0.5) * (restW / benchCushions);
            addRoundedBox(cushW, 0.16, mainDepth - 0.12, cx, seatBaseY + 0.18, mainZ + 0.04, mainMat, 0.055);
            addRoundedBox(cushW, 0.42, 0.18, cx, seatBaseY + 0.42, mainZ - mainDepth * 0.36, mainMat, 0.06, -0.16, 0, 0);
          }

          // Chaise lounge deep cushion + backrest
          addRoundedBox(chaiseW - 0.08, 0.16, d - 0.12, chaiseX, seatBaseY + 0.18, 0.04, mainMat, 0.055);
          addRoundedBox(chaiseW - 0.08, 0.42, 0.18, chaiseX, seatBaseY + 0.42, -d / 2 + 0.14, mainMat, 0.06, -0.16, 0, 0);

          // Flared plush armrests on left & right ends
          for (const side of [-1, 1]) {
            const armDepth = (side === 1 && chaiseRight) || (side === -1 && !chaiseRight) ? d * 0.65 : mainDepth;
            const armZ = -d / 2 + armDepth / 2;
            addRoundedBox(armW, 0.4, armDepth * 0.96, side * (w / 2 - armW / 2), seatBaseY + 0.24, armZ, mainMat, 0.07, 0, 0, -side * 0.16);
          }

          // Throw pillows
          addRoundedBox(0.38, 0.34, 0.13, -w / 2 + armW + 0.14, seatBaseY + 0.36, mainZ - mainDepth * 0.16, cushionMat, 0.05, -0.2, 0.35, -0.15);
          addRoundedBox(0.38, 0.34, 0.13, w / 2 - armW - 0.14, seatBaseY + 0.36, mainZ - mainDepth * 0.16, cushionMat, 0.05, -0.2, -0.35, 0.15);
          addRoundedBox(0.36, 0.32, 0.12, chaiseX, seatBaseY + 0.36, -d / 2 + 0.28, secMat, 0.05, -0.24, 0.08, 0);
        } else {
          // Straight Sofa / Lounge-Curved Poltronesofà / Armchair
          const seatCount = isArmchair ? 1 : w < 1.75 ? 2 : 3;
          const innerW = Math.max(0.4, w - armW * 2);
          const slotW = innerW / seatCount;
          const cushW = Math.max(0.3, slotW - 0.015);
          const seatH = 0.165;
          const totalH = customH ?? 0.84;
          const backH = Math.max(0.34, totalH - legH - 0.24);

          if (variant === 'scandinavian') {
            // Exposed oak base frame under cushions
            addRoundedBox(w - 0.04, 0.06, d - 0.06, 0, seatBaseY + 0.03, 0, woodMat, 0.02);
          } else {
            // Upholstered lower plinth
            addRoundedBox(w - 0.03, 0.11, d * 0.9, 0, seatBaseY + 0.055, 0.01, mainMat, 0.035);
          }

          // Seat cushions + Backrest cushions per seat
          for (let i = 0; i < seatCount; i++) {
            const cx = -innerW / 2 + (i + 0.5) * slotW;
            const seatY = variant === 'scandinavian' ? seatBaseY + 0.135 : seatBaseY + 0.185;
            addRoundedBox(cushW, seatH, d * 0.78, cx, seatY, 0.06, mainMat, 0.055);
            addRoundedBox(
              cushW,
              backH,
              0.19,
              cx,
              seatY + seatH * 0.45 + backH * 0.38,
              -d * 0.33,
              mainMat,
              0.065,
              -0.17,
              0,
              0
            );
            if (variant === 'scandinavian') {
              // Tufted button detail on backrest
              for (const bx of [-cushW * 0.22, cushW * 0.22]) {
                const btn = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), secMat);
                btn.position.set(cx + bx, seatY + backH * 0.52, -d * 0.235);
                group.add(btn);
              }
            }
          }

          // Upholstered solid back shell behind cushions
          addRoundedBox(w - 0.04, backH * 0.92, 0.12, 0, seatBaseY + 0.09 + backH * 0.46, -d * 0.41, mainMat, 0.045, -0.06, 0, 0);

          // Left & Right Armrests
          if (variant === 'lounge-curved') {
            // Iconic Poltronesofà / Albignano flared padded armrests + bolster cushions
            for (const side of [-1, 1]) {
              addRoundedBox(
                armW * 0.95,
                0.38,
                d * 0.88,
                side * (w / 2 - armW * 0.46),
                seatBaseY + 0.24,
                0.01,
                mainMat,
                0.07,
                0,
                0,
                -side * 0.22
              );
              addRoundedBox(
                armW * 0.65,
                0.22,
                d * 0.72,
                side * (w / 2 - armW * 0.82),
                seatBaseY + 0.3,
                0.02,
                mainMat,
                0.06,
                0,
                0,
                -side * 0.38
              );
            }
          } else {
            // Clean tapered / rounded modern armrests
            for (const side of [-1, 1]) {
              addRoundedBox(
                armW * 0.92,
                0.36,
                d * 0.9,
                side * (w / 2 - armW * 0.46),
                seatBaseY + 0.22,
                0,
                mainMat,
                0.05
              );
            }
          }

          // Decorative angled throw pillows
          if (!isArmchair) {
            addRoundedBox(
              0.36,
              0.33,
              0.12,
              -innerW / 2 + 0.14,
              seatBaseY + 0.36,
              -d * 0.12,
              cushionMat,
              0.05,
              -0.18,
              0.42,
              -0.16
            );
            addRoundedBox(
              0.36,
              0.33,
              0.12,
              innerW / 2 - 0.14,
              seatBaseY + 0.36,
              -d * 0.12,
              cushionMat,
              0.05,
              -0.18,
              -0.42,
              0.16
            );
          }
        }
        break;
      }
      case 'bed-double':
      case 'bed-single': {
        const legH = 0.12;
        const headH = customH ?? 1.05;
        // 4 legs
        addTaperedLeg(0.025, 0.015, legH, -w / 2 + 0.08, legH / 2, -d / 2 + 0.08, woodMat);
        addTaperedLeg(0.025, 0.015, legH, w / 2 - 0.08, legH / 2, -d / 2 + 0.08, woodMat);
        addTaperedLeg(0.025, 0.015, legH, -w / 2 + 0.08, legH / 2, d / 2 - 0.08, woodMat);
        addTaperedLeg(0.025, 0.015, legH, w / 2 - 0.08, legH / 2, d / 2 - 0.08, woodMat);

        // Upholstered bed frame & white mattress
        addRoundedBox(w, 0.18, d, 0, legH + 0.09, 0, secMat, 0.04);
        addRoundedBox(w * 0.93, 0.21, d * 0.93, 0, legH + 0.24, 0.02, whiteMat, 0.06);

        // Thick draped duvet over bottom 68% of mattress
        addRoundedBox(w * 0.97, 0.14, d * 0.66, 0, legH + 0.31, d * 0.16, mainMat, 0.06);

        // Channel-tufted headboard
        const panels = item.type === 'bed-double' ? 4 : 2;
        const pw = (w - 0.08) / panels;
        addRoundedBox(w + 0.06, headH, 0.06, 0, headH / 2, -d / 2 + 0.03, secMat, 0.03);
        for (let i = 0; i < panels; i++) {
          const px = -w / 2 + 0.04 + (i + 0.5) * pw;
          addRoundedBox(pw - 0.012, headH - 0.18, 0.06, px, (headH + 0.14) / 2, -d / 2 + 0.065, mainMat, 0.025);
        }

        // Plump pillows
        if (item.type === 'bed-double') {
          for (const px of [-w * 0.23, w * 0.23]) {
            addRoundedBox(w * 0.36, 0.12, 0.34, px, legH + 0.39, -d / 2 + 0.28, whiteMat, 0.05, 0.22, 0, 0);
            addRoundedBox(w * 0.3, 0.1, 0.24, px, legH + 0.42, -d / 2 + 0.38, cushionMat, 0.045, 0.35, 0, 0);
          }
        } else {
          addRoundedBox(w * 0.65, 0.12, 0.34, 0, legH + 0.39, -d / 2 + 0.28, whiteMat, 0.05, 0.22, 0, 0);
        }
        break;
      }
      case 'coffee-table':
      case 'dining-table':
      case 'outdoor-table':
      case 'desk': {
        const h = customH ?? (item.type === 'coffee-table' ? 0.42 : 0.75);
        const variant = item.variant ?? 'rect';
        if (variant === 'round' || variant === 'oval') {
          const radius = Math.min(w, d) / 2;
          const topMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius * 0.96, 0.045, 32),
            mainMat
          );
          if (variant === 'oval') {
            topMesh.scale.set(w / Math.min(w, d), 1, d / Math.min(w, d));
          }
          topMesh.position.y = h - 0.0225;
          topMesh.castShadow = true;
          topMesh.receiveShadow = true;
          group.add(topMesh);

          const ped = new THREE.Mesh(
            new THREE.CylinderGeometry(radius * 0.28, radius * 0.38, h - 0.045, 24),
            secMat
          );
          ped.position.y = (h - 0.045) / 2;
          ped.castShadow = true;
          group.add(ped);
        } else {
          addRoundedBox(w, 0.045, d, 0, h - 0.0225, 0, mainMat, 0.015);
          // Inset apron rail
          addBox(w - 0.14, 0.04, d - 0.14, 0, h - 0.06, 0, secMat);
          const legOffsetW = w / 2 - 0.09;
          const legOffsetD = d / 2 - 0.09;
          const legH = h - 0.045;
          const splay = variant === 'scandinavian' ? 0.08 : 0.03;
          addTaperedLeg(0.024, 0.014, legH, -legOffsetW, legH / 2, -legOffsetD, secMat, -splay, splay);
          addTaperedLeg(0.024, 0.014, legH, legOffsetW, legH / 2, -legOffsetD, secMat, -splay, -splay);
          addTaperedLeg(0.024, 0.014, legH, -legOffsetW, legH / 2, legOffsetD, secMat, splay, splay);
          addTaperedLeg(0.024, 0.014, legH, legOffsetW, legH / 2, legOffsetD, secMat, splay, -splay);
        }
        break;
      }
      case 'kitchen-counter':
      case 'kitchen-island':
      case 'sink':
      case 'stove': {
        const h = customH ?? 0.9;
        addRoundedBox(w, h - 0.04, d, 0, (h - 0.04) / 2, 0, mainMat, 0.015);
        addRoundedBox(w + 0.02, 0.04, d + 0.02, 0, h - 0.02, 0, secMat, 0.012);
        // Cabinet door grooves
        const doors = Math.max(2, Math.round(w / 0.6));
        const dw = (w - 0.04) / doors;
        for (let i = 0; i < doors; i++) {
          addBox(dw - 0.016, h - 0.12, 0.01, -w / 2 + 0.02 + (i + 0.5) * dw, (h - 0.04) / 2, d / 2 + 0.004, cushionMat);
        }
        break;
      }
      case 'fridge':
      case 'wardrobe': {
        const h = customH ?? (item.type === 'fridge' ? 1.85 : 2.1);
        addRoundedBox(w, h, d, 0, h / 2, 0, mainMat, 0.02);
        addBox(0.025, h * 0.45, 0.025, -0.05, h * 0.62, d / 2 + 0.015, secMat);
        addBox(0.025, h * 0.45, 0.025, 0.05, h * 0.62, d / 2 + 0.015, secMat);
        break;
      }
      case 'tv-stand': {
        const variant = item.variant ?? 'stand';
        const screenW = variant === 'wall-mounted' ? w : w * 0.85;
        const screenH = customH ? Math.max(0.45, customH * 0.6) : screenW * 0.56;
        const screenMat = photoTex
          ? new THREE.MeshStandardMaterial({
              color: 0xffffff,
              map: photoTex,
              roughness: 0.12,
              metalness: 0.2,
            })
          : new THREE.MeshStandardMaterial({
              color: 0x0f172a,
              roughness: 0.1,
              metalness: 0.45,
            });

        if (variant === 'wall-mounted') {
          const baseY = item.elevationCm ? 0 : 0.95;
          addRoundedBox(screenW, screenH, 0.032, 0, baseY + screenH / 2, 0, darkMat, 0.008);
          const screenFace = new THREE.Mesh(
            new THREE.PlaneGeometry(screenW - 0.025, screenH - 0.025),
            screenMat
          );
          screenFace.position.set(0, baseY + screenH / 2, 0.017);
          group.add(screenFace);
        } else if (variant === 'easel') {
          const standY = 0.65;
          addTaperedLeg(0.018, 0.012, standY + 0.25, -screenW * 0.25, (standY + 0.25) / 2, 0.08, woodMat);
          addTaperedLeg(0.018, 0.012, standY + 0.25, screenW * 0.25, (standY + 0.25) / 2, 0.08, woodMat);
          addTaperedLeg(0.018, 0.012, standY + 0.25, 0, (standY + 0.25) / 2, -0.18, woodMat);
          addRoundedBox(screenW, screenH, 0.032, 0, standY + screenH / 2, 0, darkMat, 0.008);
          const screenFace = new THREE.Mesh(
            new THREE.PlaneGeometry(screenW - 0.025, screenH - 0.025),
            screenMat
          );
          screenFace.position.set(0, standY + screenH / 2, 0.017);
          group.add(screenFace);
        } else {
          const legH = 0.12;
          const bodyH = 0.36;
          const standH = legH + bodyH;
          addTaperedLeg(0.018, 0.01, legH, -w / 2 + 0.1, legH / 2, -d / 2 + 0.08, secMat);
          addTaperedLeg(0.018, 0.01, legH, w / 2 - 0.1, legH / 2, -d / 2 + 0.08, secMat);
          addTaperedLeg(0.018, 0.01, legH, -w / 2 + 0.1, legH / 2, d / 2 - 0.08, secMat);
          addTaperedLeg(0.018, 0.01, legH, w / 2 - 0.1, legH / 2, d / 2 - 0.08, secMat);
          addRoundedBox(w, bodyH, d, 0, legH + bodyH / 2, 0, mainMat, 0.02);

          // Center TV foot & slim TV
          addBox(0.28, 0.015, 0.18, 0, standH + 0.007, 0, darkMat);
          addBox(0.05, 0.09, 0.04, 0, standH + 0.045, -0.02, darkMat);
          addRoundedBox(screenW, screenH, 0.032, 0, standH + 0.08 + screenH / 2, 0, darkMat, 0.008);
          const screenFace = new THREE.Mesh(
            new THREE.PlaneGeometry(screenW - 0.025, screenH - 0.025),
            screenMat
          );
          screenFace.position.set(0, standH + 0.08 + screenH / 2, 0.018);
          group.add(screenFace);
        }
        break;
      }
      case 'shower': {
        addRoundedBox(w, 0.08, d, 0, 0.04, 0, whiteMat, 0.02);
        const glassMat = new THREE.MeshPhysicalMaterial({
          color: 0xbae6fd,
          transparent: true,
          opacity: 0.35,
          roughness: 0.08,
        });
        addBox(0.02, 2.0, d, -w / 2 + 0.01, 1.0, 0, glassMat);
        addBox(w, 2.0, 0.02, 0, 1.0, d / 2 - 0.01, glassMat);
        break;
      }
      case 'bathtub': {
        addRoundedBox(w, customH ?? 0.56, d, 0, (customH ?? 0.56) / 2, 0, whiteMat, 0.12);
        break;
      }
      case 'toilet': {
        addRoundedBox(w * 0.78, 0.4, d * 0.7, 0, 0.2, d * 0.12, whiteMat, 0.08);
        addRoundedBox(w * 0.85, 0.8, d * 0.25, 0, 0.4, -d * 0.35, whiteMat, 0.04);
        break;
      }
      case 'stairs': {
        const steps = 10;
        const totalH = customH ?? 2.6;
        const stepW = w / steps;
        const stepH = totalH / steps;
        for (let i = 0; i < steps; i++) {
          const h = (i + 1) * stepH;
          addRoundedBox(stepW, h, d, -w / 2 + stepW * (i + 0.5), h / 2, 0, woodMat, 0.015);
        }
        break;
      }
      case 'tree':
      case 'plant': {
        const isTree = item.type === 'tree';
        const variant = item.variant ?? (isTree ? 'olive' : 'monstera');
        const potH = isTree ? 0.38 : 0.3;
        const potR = Math.min(w, d) * 0.34;
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(potR, potR * 0.72, potH, 18), secMat);
        pot.position.y = potH / 2;
        pot.castShadow = true;
        pot.receiveShadow = true;
        group.add(pot);

        // Designer rim & soil disk
        const rim = new THREE.Mesh(new THREE.TorusGeometry(potR, 0.02, 10, 20), secMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = potH - 0.01;
        group.add(rim);

        const soil = new THREE.Mesh(
          new THREE.CylinderGeometry(potR * 0.9, potR * 0.9, 0.02, 16),
          new THREE.MeshStandardMaterial({ color: 0x3b2818, roughness: 0.95 })
        );
        soil.position.y = potH - 0.03;
        group.add(soil);

        const leafHex =
          item.color && item.color !== '#cbd5e1' && item.color !== '#86efac'
            ? parseHexColor(item.color, 0x2f6f3e)
            : variant === 'olive'
            ? 0x6b8e6b
            : 0x2d6a4f;

        const leafMat = new THREE.MeshStandardMaterial({
          color: leafHex,
          roughness: 0.65,
          side: THREE.DoubleSide,
        });

        const totalH = customH ?? (isTree ? 2.1 : 1.35);

        if (variant === 'monstera' || variant === 'palm') {
          const stemCount = variant === 'palm' ? 11 : 8;
          const rSpan = Math.min(w, d) * 0.48;
          for (let i = 0; i < stemCount; i++) {
            const ang = (i / stemCount) * Math.PI * 2 + (i % 2) * 0.25;
            const heightFrac = 0.55 + (i % 3) * 0.18;
            const tipY = potH + (totalH - potH) * heightFrac;
            const tipR = rSpan * (0.45 + (i % 2) * 0.35);
            const midR = tipR * 0.45;
            const curve = new THREE.CatmullRomCurve3([
              new THREE.Vector3(0, potH - 0.02, 0),
              new THREE.Vector3(Math.cos(ang) * midR, (potH + tipY) * 0.58, Math.sin(ang) * midR),
              new THREE.Vector3(Math.cos(ang) * tipR, tipY, Math.sin(ang) * tipR),
            ]);
            const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.01, 6, false), leafMat);
            stem.castShadow = true;
            group.add(stem);

            // Broad sculpted leaf lobe
            const leafGeo = new THREE.SphereGeometry(rSpan * 0.34, 10, 8);
            leafGeo.scale(1.0, 0.12, 1.45);
            const leaf = new THREE.Mesh(leafGeo, leafMat);
            leaf.position.set(Math.cos(ang) * tipR, tipY, Math.sin(ang) * tipR);
            leaf.rotation.set(0.35, -ang + Math.PI / 2, 0);
            leaf.castShadow = true;
            group.add(leaf);
          }
        } else {
          // Olive / Ficus trunk curve + organic multi-cluster 3D foliage canopy
          const trunkTopY = potH + (totalH - potH) * 0.52;
          const trunkCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, potH - 0.02, 0),
            new THREE.Vector3(0.03, (potH + trunkTopY) * 0.5, -0.02),
            new THREE.Vector3(0, trunkTopY, 0),
          ]);
          const trunk = new THREE.Mesh(
            new THREE.TubeGeometry(trunkCurve, 10, isTree ? 0.055 : 0.03, 8, false),
            woodMat
          );
          trunk.castShadow = true;
          group.add(trunk);

          const crownR = Math.min(w, d) * 0.34;
          const clusterOffsets = [
            [0, trunkTopY + crownR * 0.55, 0, 1.0],
            [-crownR * 0.48, trunkTopY + crownR * 0.2, crownR * 0.28, 0.72],
            [crownR * 0.45, trunkTopY + crownR * 0.25, -crownR * 0.25, 0.75],
            [0.05, trunkTopY + crownR * 0.3, crownR * 0.48, 0.68],
            [-0.08, trunkTopY + crownR * 0.35, -crownR * 0.46, 0.7],
          ];
          for (const [ox, oy, oz, scale] of clusterOffsets) {
            const clump = new THREE.Mesh(new THREE.SphereGeometry(crownR * scale, 12, 10), leafMat);
            clump.position.set(ox, oy, oz);
            clump.castShadow = true;
            group.add(clump);
          }
        }
        break;
      }
      case 'hedge':
      case 'flower-bed': {
        const h = customH ?? (item.type === 'hedge' ? 1.4 : 0.4);
        addRoundedBox(w, h, d, 0, h / 2, 0, mainMat, 0.06);
        break;
      }
      case 'low-wall':
      case 'gate':
      case 'sliding-gate':
      case 'wicket-gate': {
        const h = customH ?? (item.type === 'low-wall' ? 0.9 : 1.5);
        addRoundedBox(w, h, d, 0, h / 2, 0, mainMat, 0.02);
        break;
      }
      case 'fireplace': {
        addRoundedBox(w, 1.1, d, 0, 0.55, 0, darkMat, 0.04);
        const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5, 16), darkMat);
        flue.position.y = 1.85;
        flue.castShadow = true;
        group.add(flue);
        break;
      }
      case 'lounger': {
        addRoundedBox(w, 0.22, d * 0.7, 0, 0.14, d * 0.15, mainMat, 0.06);
        addRoundedBox(w, 0.18, d * 0.36, 0, 0.28, -d * 0.32, mainMat, 0.05, 0.45, 0, 0);
        break;
      }
      default: {
        const h = customH ?? 0.75;
        addRoundedBox(w, h, d, 0, h / 2, 0, mainMat, 0.03);
      }
    }
  }

  if (realisticMode && (item.elevationCm ?? 0) < 5) {
    group.add(createSoftContactShadow(w, d));
  }

  group.position.set(item.x * CM_TO_M, (item.elevationCm ?? 0) * CM_TO_M, item.y * CM_TO_M);
  group.rotation.y = -THREE.MathUtils.degToRad(item.rotation);

  tagPickable(group, meta);
  return group;
}

export interface CollisionSegmentM {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  halfThick: number;
}

const PASSABLE_OPENINGS = new Set<Opening['type']>([
  'door',
  'sliding-door',
  'arch-passage',
  'pocket-door',
  'double-door',
]);

/**
 * Extracts solid wall collision segments in meters for FPS walkthrough,
 * automatically leaving doorways & open arches passable to walk through.
 */
export function extractWalkCollisionSegments(floor: Floor): CollisionSegmentM[] {
  const segments: CollisionSegmentM[] = [];
  for (const wall of floor.walls) {
    const lengthCm = wallLengthCm(wall);
    if (lengthCm < 1) continue;
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    const halfThick = Math.max(0.06, (wall.thicknessCm * CM_TO_M) / 2);

    const passableOpenings = floor.openings
      .filter((o) => o.wallId === wall.id && PASSABLE_OPENINGS.has(o.type))
      .map((op) => {
        const halfR = op.widthCm / lengthCm / 2;
        return {
          start: Math.max(0, op.offsetRatio - halfR),
          end: Math.min(1, op.offsetRatio + halfR),
        };
      })
      .sort((a, b) => a.start - b.start);

    let cursor = 0;
    for (const op of passableOpenings) {
      if (op.start > cursor + 0.01) {
        segments.push({
          x1: (wall.x1 + dx * cursor) * CM_TO_M,
          z1: (wall.y1 + dy * cursor) * CM_TO_M,
          x2: (wall.x1 + dx * op.start) * CM_TO_M,
          z2: (wall.y1 + dy * op.start) * CM_TO_M,
          halfThick,
        });
      }
      cursor = Math.max(cursor, op.end);
    }
    if (cursor < 0.99) {
      segments.push({
        x1: (wall.x1 + dx * cursor) * CM_TO_M,
        z1: (wall.y1 + dy * cursor) * CM_TO_M,
        x2: wall.x2 * CM_TO_M,
        z2: wall.y2 * CM_TO_M,
        halfThick,
      });
    }
  }
  return segments;
}

export interface BuildFloorOptions {
  showFurniture: boolean;
  elevationM?: number;
  showCeiling?: boolean;
  clippingPlane?: THREE.Plane | null;
  realisticMode?: boolean;
}

export function buildFloor3DGroup(floor: Floor, options: BuildFloorOptions): THREE.Group {
  const floorGroup = new THREE.Group();
  floorGroup.position.y = options.elevationM ?? 0;
  const realisticMode = options.realisticMode ?? false;

  for (const room of floor.rooms) {
    const roomMesh = buildRoomFloorMesh(room, realisticMode);
    if (roomMesh) floorGroup.add(roomMesh);

    const hM = (room.wallHeightCm ?? floor.defaultWallHeightCm ?? 250) * CM_TO_M;
    if (options.showCeiling && !floor.isExterior) {
      const ceiling = buildRoomCeilingMesh(room, hM);
      if (ceiling) floorGroup.add(ceiling);
    }

    // Warm ambient ceiling lights inside each room in Realistic Mode
    if (realisticMode && !floor.isExterior && room.points.length >= 3) {
      const c = polygonCentroid(room.points);
      const cx = c.x * CM_TO_M;
      const cz = c.y * CM_TO_M;
      const roomLight = new THREE.PointLight(0xfff0dd, 0.55, 8.5, 1.5);
      roomLight.position.set(cx, hM - 0.16, cz);
      floorGroup.add(roomLight);

      if (options.showCeiling) {
        const disc = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.14, 0.025, 16),
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xfff3d6,
            emissiveIntensity: 0.7,
            roughness: 0.2,
          })
        );
        disc.position.set(cx, hM - 0.02, cz);
        floorGroup.add(disc);
      }
    }
  }

  for (const wall of floor.walls) {
    const wallOpenings = floor.openings.filter((o) => o.wallId === wall.id);
    floorGroup.add(buildWallGroup(wall, wallOpenings, floor.defaultWallHeightCm, realisticMode));
  }

  if (options.showFurniture) {
    for (const item of floor.furniture) {
      floorGroup.add(buildFurnitureGroup(item, realisticMode));
    }
  }

  if (floor.importedGlbUrl) {
    gltfLoader.load(floor.importedGlbUrl, (gltf) => {
      const imported = gltf.scene;
      imported.traverse((ch) => {
        if (ch instanceof THREE.Mesh) {
          ch.castShadow = true;
          ch.receiveShadow = true;
        }
      });
      floorGroup.add(imported);
    });
  }

  if (options.clippingPlane) {
    const plane = options.clippingPlane;
    floorGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => {
            m.clippingPlanes = [plane];
          });
        } else {
          obj.material.clippingPlanes = [plane];
        }
      }
    });
  }

  return floorGroup;
}

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}
