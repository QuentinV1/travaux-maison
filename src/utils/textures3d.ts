import * as THREE from 'three';
import type { FloorMaterial, FurnitureMaterialType, SurfacePattern, WallMaterial } from '../types';

export interface MaterialTextureResult {
  map?: THREE.Texture;
  bumpMap?: THREE.Texture;
  roughness: number;
  metalness: number;
  bumpScale: number;
}

const proceduralCache = new Map<string, { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture }>();
const externalTextureCache = new Map<string, THREE.Texture>();

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 226, g: 232, b: 240 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbCss(r: number, g: number, b: number, alpha = 1): string {
  return alpha < 1
    ? `rgba(${clampByte(r)},${clampByte(g)},${clampByte(b)},${alpha})`
    : `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
}

function createCanvasPair(size = 256): {
  cColor: HTMLCanvasElement;
  ctxC: CanvasRenderingContext2D;
  cBump: HTMLCanvasElement;
  ctxB: CanvasRenderingContext2D;
} {
  const cColor = document.createElement('canvas');
  cColor.width = size;
  cColor.height = size;
  const ctxC = cColor.getContext('2d')!;

  const cBump = document.createElement('canvas');
  cBump.width = size;
  cBump.height = size;
  const ctxB = cBump.getContext('2d')!;

  return { cColor, ctxC, cBump, ctxB };
}

function finalizeTexture(canvas: HTMLCanvasElement, isSRGB: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (isSRGB) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.needsUpdate = true;
  return tex;
}

function cloneWithRepeat(
  tex: THREE.Texture,
  repeatX: number,
  repeatY: number,
  rotationRad = 0
): THREE.Texture {
  const cloned = tex.clone();
  cloned.wrapS = THREE.RepeatWrapping;
  cloned.wrapT = THREE.RepeatWrapping;
  cloned.repeat.set(repeatX, repeatY);
  if (rotationRad !== 0) {
    cloned.center.set(0.5, 0.5);
    cloned.rotation = rotationRad;
  }
  cloned.needsUpdate = true;
  return cloned;
}

function addSubtleGrain(
  ctxC: CanvasRenderingContext2D,
  ctxB: CanvasRenderingContext2D,
  size: number,
  intensity: number,
  seed = 1
): void {
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < 1600; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const w = 1 + Math.floor(rand() * 3);
    const delta = (rand() - 0.5) * intensity;
    ctxC.fillStyle = delta > 0 ? `rgba(255,255,255,${delta})` : `rgba(0,0,0,${-delta})`;
    ctxC.fillRect(x, y, w, w);
    const bVal = clampByte(128 + delta * 180);
    ctxB.fillStyle = rgbCss(bVal, bVal, bVal);
    ctxB.fillRect(x, y, w, w);
  }
}

export function getProceduralWallTextures(
  material: WallMaterial | undefined,
  hexColor: string,
  realisticMode: boolean,
  wallLenM = 2,
  wallHeightM = 2.5
): MaterialTextureResult {
  const mat = material ?? 'paint-matte';
  const base = hexToRgb(hexColor);

  let roughness = 0.85;
  let metalness = 0.02;
  let bumpScale = realisticMode ? 0.015 : 0.006;

  if (mat === 'paint-matte') {
    roughness = 0.92;
  } else if (mat === 'paint-velvet') {
    roughness = 0.72;
  } else if (mat === 'paint-satin') {
    roughness = 0.45;
  } else if (mat === 'plaster-concrete') {
    roughness = 0.78;
    bumpScale = realisticMode ? 0.025 : 0.01;
  } else if (mat === 'brick-red' || mat === 'brick-white') {
    roughness = 0.88;
    bumpScale = realisticMode ? 0.045 : 0.02;
  } else if (mat === 'stone') {
    roughness = 0.9;
    bumpScale = realisticMode ? 0.05 : 0.022;
  } else if (mat === 'wood-slats' || mat === 'wood-slats-walnut' || mat === 'claustra') {
    roughness = 0.65;
    bumpScale = realisticMode ? 0.055 : 0.025;
  } else if (mat === 'tile-subway' || mat === 'tile-zellige') {
    roughness = 0.25;
    metalness = 0.06;
    bumpScale = realisticMode ? 0.025 : 0.012;
  } else if (mat === 'tile-marble') {
    roughness = 0.22;
    metalness = 0.08;
    bumpScale = realisticMode ? 0.012 : 0.005;
  }

  // Pure flat paint in non-realistic mode needs minimal overhead
  if (!realisticMode && (mat === 'paint-matte' || mat === 'paint-velvet' || mat === 'paint-satin')) {
    return { roughness, metalness, bumpScale: 0 };
  }

  const key = `wall_${mat}_${hexColor.toLowerCase()}`;
  let pair = proceduralCache.get(key);

  if (!pair) {
    const size = 256;
    const { cColor, ctxC, cBump, ctxB } = createCanvasPair(size);
    ctxC.fillStyle = rgbCss(base.r, base.g, base.b);
    ctxC.fillRect(0, 0, size, size);
    ctxB.fillStyle = 'rgb(128,128,128)';
    ctxB.fillRect(0, 0, size, size);

    if (mat === 'paint-matte' || mat === 'paint-velvet' || mat === 'paint-satin') {
      addSubtleGrain(ctxC, ctxB, size, 0.04, 11);
    } else if (mat === 'plaster-concrete') {
      for (let i = 0; i < 65; i++) {
        const x = (i * 47) % size;
        const y = (i * 83) % size;
        const rad = 18 + (i % 4) * 14;
        const shade = (i % 2 === 0 ? 1 : -1) * 12;
        ctxC.fillStyle = rgbCss(base.r + shade, base.g + shade, base.b + shade, 0.22);
        ctxC.beginPath();
        ctxC.arc(x, y, rad, 0, Math.PI * 2);
        ctxC.fill();
        const bv = clampByte(128 + shade * 2);
        ctxB.fillStyle = rgbCss(bv, bv, bv, 0.35);
        ctxB.beginPath();
        ctxB.arc(x, y, rad, 0, Math.PI * 2);
        ctxB.fill();
      }
    } else if (mat === 'brick-red' || mat === 'brick-white') {
      const mortar = mat === 'brick-red' ? { r: 215, g: 210, b: 202 } : { r: 210, g: 214, b: 220 };
      ctxC.fillStyle = rgbCss(mortar.r, mortar.g, mortar.b);
      ctxC.fillRect(0, 0, size, size);
      ctxB.fillStyle = 'rgb(60,60,60)';
      ctxB.fillRect(0, 0, size, size);

      const rows = 8;
      const cols = 4;
      const bh = size / rows;
      const bw = size / cols;
      const gap = 4;
      for (let r = 0; r < rows; r++) {
        const offset = r % 2 === 1 ? bw / 2 : 0;
        for (let c = -1; c <= cols; c++) {
          const x = c * bw + offset;
          const y = r * bh;
          const v = ((r * 7 + c * 13) % 19) - 9;
          ctxC.fillStyle = rgbCss(base.r + v, base.g + v * 0.7, base.b + v * 0.5);
          ctxC.fillRect(x + gap / 2, y + gap / 2, bw - gap, bh - gap);
          ctxB.fillStyle = rgbCss(200 + v * 2, 200 + v * 2, 200 + v * 2);
          ctxB.fillRect(x + gap / 2, y + gap / 2, bw - gap, bh - gap);
        }
      }
      addSubtleGrain(ctxC, ctxB, size, 0.08, 22);
    } else if (mat === 'stone') {
      ctxC.fillStyle = rgbCss(base.r - 32, base.g - 32, base.b - 30);
      ctxC.fillRect(0, 0, size, size);
      ctxB.fillStyle = 'rgb(55,55,55)';
      ctxB.fillRect(0, 0, size, size);
      const rowH = 32;
      for (let r = 0; r < size / rowH; r++) {
        let curX = -(r * 29) % 48;
        while (curX < size) {
          const w = 44 + ((curX + r * 31) % 40);
          const tone = ((curX * 3 + r * 17) % 28) - 14;
          ctxC.fillStyle = rgbCss(base.r + tone, base.g + tone, base.b + tone - 3);
          ctxC.fillRect(curX + 2, r * rowH + 2, w - 4, rowH - 4);
          const bv = clampByte(190 + tone * 2);
          ctxB.fillStyle = rgbCss(bv, bv, bv);
          ctxB.fillRect(curX + 2, r * rowH + 2, w - 4, rowH - 4);
          curX += w;
        }
      }
    } else if (mat === 'wood-slats' || mat === 'wood-slats-walnut' || mat === 'claustra') {
      // Acoustic felt dark background + vertical wood slats
      ctxC.fillStyle = 'rgb(28, 30, 34)';
      ctxC.fillRect(0, 0, size, size);
      ctxB.fillStyle = 'rgb(30, 30, 30)';
      ctxB.fillRect(0, 0, size, size);
      const slats = 10;
      const pitch = size / slats;
      const slatW = pitch * 0.62;
      for (let i = 0; i < slats; i++) {
        const x = i * pitch + (pitch - slatW) / 2;
        const tone = ((i * 19) % 16) - 8;
        ctxC.fillStyle = rgbCss(base.r + tone, base.g + tone * 0.8, base.b + tone * 0.5);
        ctxC.fillRect(x, 0, slatW, size);
        // Subtle wood fiber
        ctxC.fillStyle = rgbCss(base.r - 18, base.g - 18, base.b - 18, 0.22);
        ctxC.fillRect(x + slatW * 0.3, 0, 1.5, size);
        ctxB.fillStyle = 'rgb(235, 235, 235)';
        ctxB.fillRect(x, 0, slatW, size);
      }
    } else if (mat === 'tile-subway' || mat === 'tile-zellige') {
      ctxC.fillStyle = 'rgb(215, 220, 226)';
      ctxC.fillRect(0, 0, size, size);
      ctxB.fillStyle = 'rgb(70, 70, 70)';
      ctxB.fillRect(0, 0, size, size);
      const rows = mat === 'tile-zellige' ? 8 : 6;
      const cols = mat === 'tile-zellige' ? 8 : 3;
      const th = size / rows;
      const tw = size / cols;
      for (let r = 0; r < rows; r++) {
        const off = mat === 'tile-subway' && r % 2 === 1 ? tw / 2 : 0;
        for (let c = -1; c <= cols; c++) {
          const x = c * tw + off;
          const y = r * th;
          const v = mat === 'tile-zellige' ? ((r * 11 + c * 17) % 18) - 9 : ((r + c) % 4) - 2;
          ctxC.fillStyle = rgbCss(base.r + v, base.g + v, base.b + v);
          ctxC.fillRect(x + 2, y + 2, tw - 4, th - 4);
          ctxB.fillStyle = 'rgb(220, 220, 220)';
          ctxB.fillRect(x + 2, y + 2, tw - 4, th - 4);
        }
      }
    } else if (mat === 'tile-marble') {
      // Soft veined marble slabs
      ctxC.fillStyle = rgbCss(base.r, base.g, base.b);
      ctxC.fillRect(0, 0, size, size);
      ctxC.strokeStyle = rgbCss(base.r - 45, base.g - 45, base.b - 42, 0.38);
      ctxC.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        ctxC.beginPath();
        ctxC.moveTo(0, (i * 45) % size);
        ctxC.bezierCurveTo(size * 0.3, (i * 71) % size, size * 0.7, (i * 33) % size, size, ((i + 2) * 53) % size);
        ctxC.stroke();
      }
      ctxC.strokeStyle = 'rgba(180,185,190,0.45)';
      ctxC.lineWidth = 2;
      ctxC.strokeRect(1, 1, size - 2, size - 2);
      ctxB.fillStyle = 'rgb(190,190,190)';
      ctxB.fillRect(2, 2, size - 4, size - 4);
    } else {
      // Wallpaper or generic subtle vertical texture
      for (let x = 0; x < size; x += 16) {
        ctxC.fillStyle = x % 32 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
        ctxC.fillRect(x, 0, 8, size);
      }
      addSubtleGrain(ctxC, ctxB, size, 0.05, 7);
    }

    pair = {
      map: finalizeTexture(cColor, true),
      bumpMap: finalizeTexture(cBump, false),
    };
    proceduralCache.set(key, pair);
  }

  const repX = Math.max(1, wallLenM / 1.2);
  const repY = Math.max(1, wallHeightM / 1.2);

  return {
    map: cloneWithRepeat(pair.map, repX, repY),
    bumpMap: cloneWithRepeat(pair.bumpMap, repX, repY),
    roughness,
    metalness,
    bumpScale,
  };
}

export function getProceduralPatternTextures(
  pattern: SurfacePattern,
  realisticMode: boolean,
  surfaceWidthM = 1,
  surfaceHeightM = 1
): MaterialTextureResult {
  const c1 = hexToRgb(pattern.primaryColor || '#f8fafc');
  const c2 = hexToRgb(pattern.secondaryColor || '#334155');
  const key = `pattern_${pattern.type}_${pattern.primaryColor.toLowerCase()}_${pattern.secondaryColor.toLowerCase()}`;
  let pair = proceduralCache.get(key);

  if (!pair) {
    const size = 256;
    const { cColor, ctxC, cBump, ctxB } = createCanvasPair(size);
    ctxC.fillStyle = rgbCss(c1.r, c1.g, c1.b);
    ctxC.fillRect(0, 0, size, size);
    ctxB.fillStyle = 'rgb(128,128,128)';
    ctxB.fillRect(0, 0, size, size);

    if (pattern.type === 'checkerboard') {
      const half = size / 2;
      ctxC.fillStyle = rgbCss(c2.r, c2.g, c2.b);
      ctxC.fillRect(0, 0, half, half);
      ctxC.fillRect(half, half, half, half);
      ctxB.fillStyle = 'rgb(142,142,142)';
      ctxB.fillRect(0, 0, half, half);
      ctxB.fillRect(half, half, half, half);
      ctxB.strokeStyle = 'rgb(95,95,95)';
      ctxB.lineWidth = 2;
      ctxB.strokeRect(0, 0, half, half);
      ctxB.strokeRect(half, half, half, half);
    } else if (pattern.type === 'stripes-vertical') {
      ctxC.fillStyle = rgbCss(c2.r, c2.g, c2.b);
      ctxB.fillStyle = 'rgb(140,140,140)';
      for (let i = 0; i < 4; i++) {
        ctxC.fillRect(i * 64, 0, 32, size);
        ctxB.fillRect(i * 64, 0, 32, size);
      }
    } else if (pattern.type === 'stripes-horizontal') {
      ctxC.fillStyle = rgbCss(c2.r, c2.g, c2.b);
      ctxB.fillStyle = 'rgb(140,140,140)';
      for (let i = 0; i < 4; i++) {
        ctxC.fillRect(0, i * 64, size, 32);
        ctxB.fillRect(0, i * 64, size, 32);
      }
    } else if (pattern.type === 'herringbone-wallpaper') {
      ctxC.strokeStyle = rgbCss(c2.r, c2.g, c2.b, 0.85);
      ctxC.lineWidth = 6;
      ctxB.strokeStyle = 'rgb(165,165,165)';
      ctxB.lineWidth = 6;
      const step = 32;
      for (let y = -step; y <= size + step; y += step) {
        ctxC.beginPath();
        ctxB.beginPath();
        for (let x = 0; x <= size; x += 64) {
          ctxC.moveTo(x, y);
          ctxC.lineTo(x + 32, y + 24);
          ctxC.lineTo(x + 64, y);
          ctxB.moveTo(x, y);
          ctxB.lineTo(x + 32, y + 24);
          ctxB.lineTo(x + 64, y);
        }
        ctxC.stroke();
        ctxB.stroke();
      }
    } else if (pattern.type === 'terrazzo-dots') {
      let s = 4219;
      const rand = () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
      };
      for (let i = 0; i < 42; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const r = 4 + rand() * 9;
        ctxC.fillStyle = rgbCss(c2.r, c2.g, c2.b, 0.75 + rand() * 0.25);
        ctxC.beginPath();
        ctxC.arc(x, y, r, 0, Math.PI * 2);
        ctxC.fill();
        ctxB.fillStyle = 'rgb(148,148,148)';
        ctxB.beginPath();
        ctxB.arc(x, y, r, 0, Math.PI * 2);
        ctxB.fill();
      }
    } else if (pattern.type === 'geometric-diamond') {
      ctxC.strokeStyle = rgbCss(c2.r, c2.g, c2.b, 0.9);
      ctxC.lineWidth = 4;
      ctxB.strokeStyle = 'rgb(160,160,160)';
      ctxB.lineWidth = 4;
      const cell = 64;
      for (let y = 0; y < size; y += cell) {
        for (let x = 0; x < size; x += cell) {
          const cx = x + cell / 2;
          const cy = y + cell / 2;
          ctxC.beginPath();
          ctxC.moveTo(cx, y);
          ctxC.lineTo(x + cell, cy);
          ctxC.lineTo(cx, y + cell);
          ctxC.lineTo(x, cy);
          ctxC.closePath();
          ctxC.stroke();

          ctxB.beginPath();
          ctxB.moveTo(cx, y);
          ctxB.lineTo(x + cell, cy);
          ctxB.lineTo(cx, y + cell);
          ctxB.lineTo(x, cy);
          ctxB.closePath();
          ctxB.stroke();
        }
      }
    }

    if (realisticMode) {
      addSubtleGrain(ctxC, ctxB, size, 0.03, 73);
    }

    pair = {
      map: finalizeTexture(cColor, true),
      bumpMap: finalizeTexture(cBump, false),
    };
    proceduralCache.set(key, pair);
  }

  const tileM = Math.max(0.15, (pattern.scaleCm ?? 40) / 100);
  const repX = surfaceWidthM / tileM;
  const repY = surfaceHeightM / tileM;

  return {
    map: cloneWithRepeat(pair.map, repX, repY),
    bumpMap: cloneWithRepeat(pair.bumpMap, repX, repY),
    roughness: 0.72,
    metalness: 0.02,
    bumpScale: realisticMode ? 0.014 : 0.005,
  };
}

export function getProceduralFloorTextures(
  material: FloorMaterial,
  hexColor: string,
  realisticMode: boolean,
  scale = 1,
  orientationDeg = 0
): MaterialTextureResult {
  const base = hexToRgb(hexColor);
  let roughness = 0.65;
  let metalness = 0.04;
  let bumpScale = realisticMode ? 0.02 : 0.008;

  if (material === 'tile' || material === 'tile-marble') {
    roughness = 0.28;
    metalness = 0.08;
  } else if (material === 'terrazzo' || material === 'cement-tile') {
    roughness = 0.42;
  } else if (material === 'wood' || material === 'wood-herringbone' || material === 'wood-dark') {
    roughness = 0.56;
  } else if (material === 'carpet' || material === 'grass') {
    roughness = 0.95;
    bumpScale = realisticMode ? 0.035 : 0.012;
  } else if (material === 'concrete') {
    roughness = 0.72;
  } else if (material === 'deck') {
    roughness = 0.75;
    bumpScale = realisticMode ? 0.035 : 0.015;
  }

  const key = `floor_${material}_${hexColor.toLowerCase()}`;
  let pair = proceduralCache.get(key);

  if (!pair) {
    const size = 256;
    const { cColor, ctxC, cBump, ctxB } = createCanvasPair(size);
    ctxC.fillStyle = rgbCss(base.r, base.g, base.b);
    ctxC.fillRect(0, 0, size, size);
    ctxB.fillStyle = 'rgb(160,160,160)';
    ctxB.fillRect(0, 0, size, size);

    if (material === 'wood' || material === 'wood-dark' || material === 'deck') {
      const planks = material === 'deck' ? 6 : 4;
      const pw = size / planks;
      for (let i = 0; i < planks; i++) {
        const tone = ((i * 19) % 16) - 8;
        ctxC.fillStyle = rgbCss(base.r + tone, base.g + tone * 0.85, base.b + tone * 0.6);
        ctxC.fillRect(i * pw + 1, 0, pw - 2, size);
        // Wood grain streaks
        ctxC.fillStyle = rgbCss(base.r - 22, base.g - 24, base.b - 24, 0.2);
        for (let g = 0; g < 6; g++) {
          const gx = i * pw + 4 + ((g * 11) % Math.max(6, pw - 8));
          ctxC.fillRect(gx, 0, 1.2, size);
        }
        // Horizontal plank joint
        const jy = ((i * 97) % (size - 40)) + 20;
        ctxC.fillStyle = 'rgba(0,0,0,0.22)';
        ctxC.fillRect(i * pw, jy, pw, 2);
        ctxB.fillStyle = 'rgb(70,70,70)';
        ctxB.fillRect(i * pw, 0, 2, size);
        ctxB.fillRect(i * pw, jy, pw, 2);
      }
    } else if (material === 'wood-herringbone') {
      const step = 32;
      for (let y = -size; y < size * 2; y += step) {
        for (let x = -size; x < size * 2; x += step) {
          const tone = (((x + y) / step) * 7) % 18 - 9;
          ctxC.fillStyle = rgbCss(base.r + tone, base.g + tone * 0.8, base.b + tone * 0.6);
          ctxC.save();
          ctxC.translate(x, y);
          ctxC.rotate(((x / step + y / step) % 2 === 0 ? 45 : -45) * (Math.PI / 180));
          ctxC.fillRect(-step * 0.7, -step * 0.25, step * 1.4, step * 0.5);
          ctxC.strokeStyle = 'rgba(0,0,0,0.18)';
          ctxC.strokeRect(-step * 0.7, -step * 0.25, step * 1.4, step * 0.5);
          ctxC.restore();
        }
      }
      addSubtleGrain(ctxC, ctxB, size, 0.06, 33);
    } else if (material === 'tile' || material === 'tile-marble') {
      const cells = material === 'tile-marble' ? 2 : 4;
      const cw = size / cells;
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          const tone = ((r * 7 + c * 13) % 8) - 4;
          ctxC.fillStyle = rgbCss(base.r + tone, base.g + tone, base.b + tone);
          ctxC.fillRect(c * cw + 2, r * cw + 2, cw - 4, cw - 4);
          if (material === 'tile-marble') {
            ctxC.strokeStyle = rgbCss(base.r - 40, base.g - 40, base.b - 38, 0.3);
            ctxC.lineWidth = 1.5;
            ctxC.beginPath();
            ctxC.moveTo(c * cw + 4, r * cw + cw * 0.3);
            ctxC.lineTo(c * cw + cw - 4, r * cw + cw * 0.75);
            ctxC.stroke();
          }
          ctxB.fillStyle = 'rgb(215,215,215)';
          ctxB.fillRect(c * cw + 2, r * cw + 2, cw - 4, cw - 4);
        }
      }
      // Grout lines in bump
      ctxB.strokeStyle = 'rgb(65,65,65)';
      ctxB.lineWidth = 3;
      for (let i = 0; i <= cells; i++) {
        ctxB.beginPath();
        ctxB.moveTo(i * cw, 0);
        ctxB.lineTo(i * cw, size);
        ctxB.stroke();
        ctxB.beginPath();
        ctxB.moveTo(0, i * cw);
        ctxB.lineTo(size, i * cw);
        ctxB.stroke();
      }
    } else if (material === 'terrazzo') {
      const flecks = ['#64748b', '#d97706', '#94a3b8', '#cbd5e1', '#475569'];
      for (let i = 0; i < 160; i++) {
        const fx = (i * 73) % size;
        const fy = (i * 137) % size;
        const fr = 2 + (i % 5);
        ctxC.fillStyle = flecks[i % flecks.length];
        ctxC.beginPath();
        ctxC.moveTo(fx, fy);
        ctxC.lineTo(fx + fr, fy + fr * 0.6);
        ctxC.lineTo(fx - fr * 0.4, fy + fr * 1.2);
        ctxC.closePath();
        ctxC.fill();
      }
      addSubtleGrain(ctxC, ctxB, size, 0.04, 41);
    } else if (material === 'cement-tile') {
      const cells = 2;
      const cw = size / cells;
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          const cx = c * cw + cw / 2;
          const cy = r * cw + cw / 2;
          ctxC.strokeStyle = rgbCss(base.r - 45, base.g - 45, base.b - 45, 0.6);
          ctxC.lineWidth = 2;
          ctxC.strokeRect(c * cw + 2, r * cw + 2, cw - 4, cw - 4);
          ctxC.fillStyle = rgbCss(base.r - 55, base.g - 50, base.b - 35, 0.45);
          ctxC.beginPath();
          ctxC.arc(cx, cy, cw * 0.25, 0, Math.PI * 2);
          ctxC.fill();
        }
      }
    } else {
      addSubtleGrain(ctxC, ctxB, size, material === 'carpet' || material === 'grass' ? 0.14 : 0.06, 55);
    }

    pair = {
      map: finalizeTexture(cColor, true),
      bumpMap: finalizeTexture(cBump, false),
    };
    proceduralCache.set(key, pair);
  }

  // ShapeGeometry generated from cm*0.01 coords uses world-meter UVs directly!
  const repeatFactor = 0.85 / Math.max(0.25, scale);
  const rotRad = (orientationDeg * Math.PI) / 180;

  return {
    map: cloneWithRepeat(pair.map, repeatFactor, repeatFactor, rotRad),
    bumpMap: cloneWithRepeat(pair.bumpMap, repeatFactor, repeatFactor, rotRad),
    roughness,
    metalness,
    bumpScale,
  };
}

export function getProceduralFurnitureTextures(
  materialType: FurnitureMaterialType | undefined,
  hexColor: string,
  realisticMode: boolean
): MaterialTextureResult {
  if (!materialType) {
    return {
      roughness: 0.65,
      metalness: 0.05,
      bumpScale: 0,
    };
  }

  let roughness = 0.65;
  let metalness = 0.05;
  let bumpScale = realisticMode ? 0.025 : 0.01;

  if (materialType === 'boucle') roughness = 0.95;
  else if (materialType === 'linen') roughness = 0.88;
  else if (materialType === 'velvet') roughness = 0.78;
  else if (materialType === 'corduroy') {
    roughness = 0.85;
    bumpScale = realisticMode ? 0.04 : 0.018;
  } else if (materialType === 'leather') {
    roughness = 0.42;
    metalness = 0.06;
  } else if (materialType === 'wood-oak' || materialType === 'wood-walnut' || materialType === 'wood-black') {
    roughness = 0.55;
  } else if (materialType === 'marble-white' || materialType === 'marble-black') {
    roughness = 0.18;
    metalness = 0.08;
    bumpScale = 0.005;
  } else if (materialType === 'metal-black' || materialType === 'metal-brass' || materialType === 'metal-chrome') {
    roughness = materialType === 'metal-black' ? 0.38 : 0.22;
    metalness = 0.85;
    bumpScale = 0.004;
  } else if (materialType === 'glass') {
    roughness = 0.08;
    metalness = 0.1;
    bumpScale = 0;
  }

  const key = `furn_${materialType}_${hexColor.toLowerCase()}`;
  let pair = proceduralCache.get(key);
  if (!pair) {
    const size = 256;
    const { cColor, ctxC, cBump, ctxB } = createCanvasPair(size);
    const base = hexToRgb(hexColor);
    ctxC.fillStyle = rgbCss(base.r, base.g, base.b);
    ctxC.fillRect(0, 0, size, size);
    ctxB.fillStyle = 'rgb(128,128,128)';
    ctxB.fillRect(0, 0, size, size);

    if (materialType === 'boucle') {
      for (let i = 0; i < 1200; i++) {
        const x = (i * 53) % size;
        const y = (i * 97) % size;
        const shade = (i % 3 === 0 ? 1 : -1) * 14;
        ctxC.fillStyle = rgbCss(base.r + shade, base.g + shade, base.b + shade, 0.55);
        ctxC.beginPath();
        ctxC.arc(x, y, 2.2, 0, Math.PI * 2);
        ctxC.fill();
        const bv = clampByte(128 + shade * 4);
        ctxB.fillStyle = rgbCss(bv, bv, bv);
        ctxB.beginPath();
        ctxB.arc(x, y, 2.2, 0, Math.PI * 2);
        ctxB.fill();
      }
    } else if (materialType === 'corduroy') {
      for (let x = 0; x < size; x += 6) {
        ctxC.fillStyle = 'rgba(0,0,0,0.12)';
        ctxC.fillRect(x, 0, 2, size);
        ctxB.fillStyle = 'rgb(70,70,70)';
        ctxB.fillRect(x, 0, 2, size);
        ctxB.fillStyle = 'rgb(210,210,210)';
        ctxB.fillRect(x + 2, 0, 4, size);
      }
    } else if (materialType === 'linen') {
      for (let i = 0; i < size; i += 4) {
        ctxC.fillStyle = i % 8 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
        ctxC.fillRect(i, 0, 1, size);
        ctxC.fillRect(0, i, size, 1);
      }
      addSubtleGrain(ctxC, ctxB, size, 0.08, 77);
    } else if (materialType === 'wood-oak' || materialType === 'wood-walnut' || materialType === 'wood-black') {
      for (let i = 0; i < 24; i++) {
        const y = (i * 11) % size;
        ctxC.fillStyle = rgbCss(base.r - 18, base.g - 18, base.b - 18, 0.2);
        ctxC.fillRect(0, y, size, 2);
      }
      addSubtleGrain(ctxC, ctxB, size, 0.05, 88);
    } else if (materialType === 'marble-white' || materialType === 'marble-black') {
      ctxC.strokeStyle =
        materialType === 'marble-black' ? 'rgba(255,255,255,0.3)' : 'rgba(100,116,139,0.28)';
      ctxC.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        ctxC.beginPath();
        ctxC.moveTo(0, (i * 51) % size);
        ctxC.bezierCurveTo(90, (i * 87) % size, 170, (i * 23) % size, size, (i * 63) % size);
        ctxC.stroke();
      }
    } else {
      addSubtleGrain(ctxC, ctxB, size, 0.06, 99);
    }

    pair = {
      map: finalizeTexture(cColor, true),
      bumpMap: finalizeTexture(cBump, false),
    };
    proceduralCache.set(key, pair);
  }

  return {
    map: cloneWithRepeat(pair.map, 2, 2),
    bumpMap: cloneWithRepeat(pair.bumpMap, 2, 2),
    roughness,
    metalness,
    bumpScale,
  };
}

export function loadExternalOrDataUrlTexture(url: string): THREE.Texture {
  const existing = externalTextureCache.get(url);
  if (existing) return existing;

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const tex = loader.load(
    url,
    (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.needsUpdate = true;
    },
    undefined,
    () => {
      // Fallback via weserv proxy if external domain blocks CORS
      if (url.startsWith('http') && !url.includes('images.weserv.nl')) {
        const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}`;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          tex.image = img;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
        };
        img.src = proxied;
      }
    }
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  externalTextureCache.set(url, tex);
  return tex;
}

function loadCorsImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Impossible de charger cette image'));
    img.src = src;
  });
}

/**
 * Automatically removes light/uniform backgrounds (typically white product studio backgrounds)
 * via edge flood-fill and extracts the dominant object color in HEX.
 */
export async function removeImageBackground(
  imageSource: string,
  tolerance = 40
): Promise<{ cutoutDataUrl: string; dominantHex: string }> {
  let img: HTMLImageElement;
  try {
    img = await loadCorsImage(imageSource);
  } catch {
    if (imageSource.startsWith('http')) {
      const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(imageSource.replace(/^https?:\/\//, ''))}&output=png`;
      img = await loadCorsImage(proxied);
    } else {
      throw new Error("Impossible de charger l'image pour le détourage.");
    }
  }

  const maxDim = 560;
  let w = img.naturalWidth || img.width || 400;
  let h = img.naturalHeight || img.height || 400;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.max(1, Math.round((h * maxDim) / w));
      w = maxDim;
    } else {
      w = Math.max(1, Math.round((w * maxDim) / h));
      h = maxDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { cutoutDataUrl: imageSource, dominantHex: '#94a3b8' };
  }

  ctx.drawImage(img, 0, 0, w, h);
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    // Tainted canvas fallback: retry via weserv proxy
    if (imageSource.startsWith('http') && !imageSource.includes('images.weserv.nl')) {
      const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(imageSource.replace(/^https?:\/\//, ''))}&output=png`;
      return removeImageBackground(proxied, tolerance);
    }
    return { cutoutDataUrl: imageSource, dominantHex: '#94a3b8' };
  }

  const data = imageData.data;
  const corners = [
    0,
    (w - 1) * 4,
    (h - 1) * w * 4,
    ((h - 1) * w + (w - 1)) * 4,
  ];
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  for (const idx of corners) {
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
  }
  bgR /= 4;
  bgG /= 4;
  bgB /= 4;

  const isBgLike = (idx: number) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (a < 20) return true;
    const dist = Math.hypot(r - bgR, g - bgG, b - bgB);
    return dist <= tolerance;
  };

  // Flood-fill from image borders so interior white highlights inside the product aren't erased
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const pushIfBg = (x: number, y: number) => {
    const pos = y * w + x;
    if (visited[pos]) return;
    if (isBgLike(pos * 4)) {
      visited[pos] = 1;
      queue[tail++] = pos;
    }
  };

  for (let x = 0; x < w; x++) {
    pushIfBg(x, 0);
    pushIfBg(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIfBg(0, y);
    pushIfBg(w - 1, y);
  }

  while (head < tail) {
    const pos = queue[head++];
    data[pos * 4 + 3] = 0;
    const x = pos % w;
    const y = (pos - x) / w;
    if (x > 0) pushIfBg(x - 1, y);
    if (x < w - 1) pushIfBg(x + 1, y);
    if (y > 0) pushIfBg(x, y - 1);
    if (y < h - 1) pushIfBg(x, y + 1);
  }

  // Feather boundary pixels slightly
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const pos = y * w + x;
      if (data[pos * 4 + 3] === 0) continue;
      const hasTransparentNeighbor =
        data[(pos - 1) * 4 + 3] === 0 ||
        data[(pos + 1) * 4 + 3] === 0 ||
        data[(pos - w) * 4 + 3] === 0 ||
        data[(pos + w) * 4 + 3] === 0;
      if (hasTransparentNeighbor) {
        const idx = pos * 4;
        const dist = Math.hypot(data[idx] - bgR, data[idx + 1] - bgG, data[idx + 2] - bgB);
        if (dist < tolerance * 1.4) {
          data[idx + 3] = Math.round(data[idx + 3] * 0.45);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Compute dominant non-transparent color from central body (histogram-weighted to avoid shadow/glare skew)
  const buckets = new Map<string, { rSum: number; gSum: number; bSum: number; weight: number }>();
  for (let y = Math.floor(h * 0.22); y < Math.floor(h * 0.78); y += 2) {
    for (let x = Math.floor(w * 0.22); x < Math.floor(w * 0.78); x += 2) {
      const idx = (y * w + x) * 4;
      if (data[idx + 3] < 200) continue;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 16 || lum > 242) continue;

      const distFromCenter = Math.hypot((x - w * 0.5) / w, (y - h * 0.5) / h);
      const centerWeight = Math.max(0.2, 1.3 - distFromCenter * 1.6);
      const bucketKey = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.rSum += r * centerWeight;
        existing.gSum += g * centerWeight;
        existing.bSum += b * centerWeight;
        existing.weight += centerWeight;
      } else {
        buckets.set(bucketKey, {
          rSum: r * centerWeight,
          gSum: g * centerWeight,
          bSum: b * centerWeight,
          weight: centerWeight,
        });
      }
    }
  }

  let bestBucket: { rSum: number; gSum: number; bSum: number; weight: number } | null = null;
  for (const b of buckets.values()) {
    if (!bestBucket || b.weight > bestBucket.weight) {
      bestBucket = b;
    }
  }

  const dominantHex =
    bestBucket && bestBucket.weight > 0
      ? `#${clampByte(bestBucket.rSum / bestBucket.weight)
          .toString(16)
          .padStart(2, '0')}${clampByte(bestBucket.gSum / bestBucket.weight)
          .toString(16)
          .padStart(2, '0')}${clampByte(bestBucket.bSum / bestBucket.weight)
          .toString(16)
          .padStart(2, '0')}`
      : '#94a3b8';

  return {
    cutoutDataUrl: canvas.toDataURL('image/png'),
    dominantHex,
  };
}

export async function createCroppedFabricTextureFromPhoto(imageSource: string): Promise<string> {
  const img = await loadCorsImage(imageSource);
  const iw = img.naturalWidth || img.width || 300;
  const ih = img.naturalHeight || img.height || 300;
  const sx = Math.floor(iw * 0.35);
  const sy = Math.floor(ih * 0.35);
  const sw = Math.max(24, Math.floor(iw * 0.3));
  const sh = Math.max(24, Math.floor(ih * 0.3));

  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 192;
  const ctx = c.getContext('2d');
  if (!ctx) return imageSource;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 192, 192);
  return c.toDataURL('image/jpeg', 0.88);
}

export async function traceAlphaContourPoints(
  imageSource: string,
  rayCount = 36
): Promise<Array<{ x: number; y: number }>> {
  const img = await loadCorsImage(imageSource);
  const grid = 64;
  const c = document.createElement('canvas');
  c.width = grid;
  c.height = grid;
  const ctx = c.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, grid, grid);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, grid, grid).data;
  } catch {
    return [];
  }

  let minX = grid;
  let maxX = 0;
  let minY = grid;
  let maxY = 0;
  let fgCount = 0;

  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const a = data[(y * grid + x) * 4 + 3];
      if (a > 110) {
        fgCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (fgCount < 16 || maxX <= minX || maxY <= minY) return [];

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const maxStep = Math.hypot(spanX, spanY) * 0.65;

  const rawPts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < rayCount; i++) {
    const ang = (i / rayCount) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let lastHitR = Math.min(spanX, spanY) * 0.15;

    for (let r = 1; r <= maxStep; r += 0.75) {
      const px = Math.round(cx + dx * r);
      const py = Math.round(cy + dy * r);
      if (px < 0 || px >= grid || py < 0 || py >= grid) break;
      if (data[(py * grid + px) * 4 + 3] > 110) {
        lastHitR = r;
      }
    }

    const wx = cx + dx * lastHitR;
    const wy = cy + dy * lastHitR;
    rawPts.push({
      x: (wx - cx) / spanX,
      y: (maxY - wy) / spanY,
    });
  }

  // Smooth contour slightly for clean extrusion
  return rawPts.map((pt, i) => {
    const prev = rawPts[(i - 1 + rawPts.length) % rawPts.length];
    const next = rawPts[(i + 1) % rawPts.length];
    return {
      x: Number(((prev.x + pt.x * 2 + next.x) * 0.25).toFixed(4)),
      y: Math.max(0, Number(((prev.y + pt.y * 2 + next.y) * 0.25).toFixed(4))),
    };
  });
}
