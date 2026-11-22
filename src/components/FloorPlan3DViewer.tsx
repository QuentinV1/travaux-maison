import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  Box,
  Compass,
  Footprints,
  Grid,
  Layers,
  Moon,
  RotateCcw,
  Scissors,
  Sofa,
  Sun,
  X,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Home,
  Palette,
  Sparkles,
  ShoppingBag,
  Wand2,
  Eye,
  Upload,
  Trash2,
  Camera,
} from 'lucide-react';
import type {
  ArchShape,
  Floor,
  FloorMaterial,
  FurnitureItem,
  FurnitureMaterialType,
  Opening,
  OpeningType,
  RoomZone,
  SurfacePattern,
  Wall,
  WallMaterial,
} from '../types';
import {
  buildFloor3DGroup,
  disposeObject3D,
  extractWalkCollisionSegments,
  type CollisionSegmentM,
  type PickableMetadata,
} from '../utils/threeBuilder';
import { polygonAreaM2, polygonCentroid } from '../utils/geometry';
import {
  ARCH_SHAPE_LABELS,
  FLOOR_MATERIAL_LABELS,
  FURNITURE_MATERIAL_LABELS,
  FURNITURE_VARIANTS_BY_TYPE,
  OPENING_TYPE_LABELS,
  WALL_COLOR_SWATCHES,
  WALL_MATERIAL_LABELS,
} from '../data/furnitureCatalog';
import { removeImageBackground } from '../utils/textures3d';
import { computeSunPosition } from '../utils/solar';
import { Studio3DExportAIModal } from './Studio3DExportAIModal';
import { SurfacePatternControls } from './SurfacePatternControls';
import { useEscapeKey } from '../utils/useEscapeKey';

interface FloorPlan3DViewerProps {
  floors: Floor[];
  activeFloorId: string;
  onSelectFloor: (floorId: string) => void;
  onUpdateFloor?: (updated: Floor) => void;
  onOpenWebCatalog?: () => void;
  onOpenAISettings?: () => void;
}

type ViewScope = 'current' | 'all';
type LightingMode = 'day' | 'evening';
type NavMode = 'orbit' | 'fps';

function pointInPolygon(xCm: number, yCm: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect = yi > yCm !== yj > yCm && xCm < ((xj - xi) * (yCm - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distancePointToSegment(px: number, pz: number, s: CollisionSegmentM): number {
  const vx = s.x2 - s.x1;
  const vz = s.z2 - s.z1;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-6) return Math.hypot(px - s.x1, pz - s.z1);
  const t = Math.max(0, Math.min(1, ((px - s.x1) * vx + (pz - s.z1) * vz) / lenSq));
  return Math.hypot(px - (s.x1 + t * vx), pz - (s.z1 + t * vz));
}

export const FloorPlan3DViewer: React.FC<FloorPlan3DViewerProps> = ({
  floors,
  activeFloorId,
  onSelectFloor,
  onUpdateFloor,
  onOpenWebCatalog,
  onOpenAISettings,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewScope, setViewScope] = useState<ViewScope>('current');
  const [navMode, setNavMode] = useState<NavMode>('orbit');
  const [showFurniture, setShowFurniture] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showCeiling, setShowCeiling] = useState(false);
  const [lighting, setLighting] = useState<LightingMode>('day');
  const [sunHour, setSunHour] = useState<number>(14);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipHeightM, setClipHeightM] = useState<number>(2.1);
  const [selectedInfo, setSelectedInfo] = useState<PickableMetadata | null>(null);
  const [currentRoomInfo, setCurrentRoomInfo] = useState<{ name: string; areaM2: number } | null>(null);
  const [customizeMode, setCustomizeMode] = useState<boolean>(Boolean(onUpdateFloor));
  const [realisticMode, setRealisticMode] = useState<boolean>(false);
  const [wallApplyScope, setWallApplyScope] = useState<'face' | 'both' | 'room'>('face');
  const [showStudioModal, setShowStudioModal] = useState<boolean>(false);
  const [cuttingFurnitureImg, setCuttingFurnitureImg] = useState<boolean>(false);
  const [activeRenderViewer, setActiveRenderViewer] = useState<{
    url: string;
    is360: boolean;
    title: string;
  } | null>(null);

  useEscapeKey(activeRenderViewer !== null, () => setActiveRenderViewer(null));

  const lastFramedKeyRef = useRef<string>('');
  const pmremTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);

  const sortedFloors = useMemo(() => [...floors].sort((a, b) => a.order - b.order), [floors]);

  const activeFloor = useMemo(
    () => sortedFloors.find((f) => f.id === activeFloorId) ?? sortedFloors[0] ?? null,
    [sortedFloors, activeFloorId]
  );

  // Refs for FPS navigation loop
  const navModeRef = useRef<NavMode>(navMode);
  navModeRef.current = navMode;
  const keysPressedRef = useRef<Set<string>>(new Set());
  const touchMoveRef = useRef<{ forward: number; strafe: number }>({ forward: 0, strafe: 0 });
  const fpsStateRef = useRef<{ yaw: number; pitch: number; eyeY: number }>({
    yaw: 0,
    pitch: 0,
    eyeY: 1.68,
  });
  const collisionSegmentsRef = useRef<CollisionSegmentM[]>([]);
  const activeRoomsRef = useRef<RoomZone[]>([]);

  const sceneRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    modelRoot: THREE.Group;
    grid: THREE.GridHelper;
    ambient: THREE.AmbientLight;
    hemi: THREE.HemisphereLight;
    sun: THREE.DirectionalLight;
    center: THREE.Vector3;
    radius: number;
    clipPlane: THREE.Plane;
  } | null>(null);

  useEffect(() => {
    if (!activeFloor) {
      collisionSegmentsRef.current = [];
      activeRoomsRef.current = [];
      return;
    }
    collisionSegmentsRef.current = extractWalkCollisionSegments(activeFloor);
    activeRoomsRef.current = activeFloor.rooms;
  }, [activeFloor]);

  const applyCameraPreset = (preset: 'iso' | 'top' | 'eye') => {
    const refs = sceneRefs.current;
    if (!refs) return;
    setNavMode('orbit');
    const { camera, controls, center, radius } = refs;
    const dist = Math.max(radius * 1.65, 6);

    if (preset === 'iso') {
      camera.position.set(center.x + dist * 0.75, center.y + dist * 0.7, center.z + dist * 0.75);
      controls.target.copy(center);
    } else if (preset === 'top') {
      camera.position.set(center.x, center.y + dist * 1.5, center.z + 0.01);
      controls.target.copy(center);
    } else {
      camera.position.set(center.x, 1.68, center.z + Math.max(radius * 0.55, 3));
      controls.target.set(center.x, 1.45, center.z);
    }
    controls.update();
  };

  const enterFpsInRoom = (room?: RoomZone) => {
    const refs = sceneRefs.current;
    if (!refs) return;
    setViewScope('current');
    setNavMode('fps');

    const targetRoom = room ?? activeFloor?.rooms[0];
    if (targetRoom && targetRoom.points.length >= 3) {
      const c = polygonCentroid(targetRoom.points);
      refs.camera.position.set(c.x * 0.01, 1.68, c.y * 0.01);
    } else {
      refs.camera.position.set(refs.center.x, 1.68, refs.center.z);
    }
    fpsStateRef.current = { yaw: 0, pitch: 0, eyeY: 1.68 };
    refs.camera.rotation.order = 'YXZ';
    refs.camera.rotation.set(0, 0, 0);
  };

  // Initialize Three.js scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);

    const camera = new THREE.PerspectiveCamera(
      55,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.08,
      250
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 1.2;
    controls.maxDistance = 80;
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0xcbd5e1, 0.55);
    const sun = new THREE.DirectionalLight(0xfffbeb, 1.15);
    sun.position.set(18, 28, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    const d = 25;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.025;

    scene.add(ambient, hemi, sun, sun.target);

    const grid = new THREE.GridHelper(60, 60, 0x94a3b8, 0xcbd5e1);
    grid.position.y = -0.002;
    scene.add(grid);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.1);

    sceneRefs.current = {
      scene,
      camera,
      renderer,
      controls,
      modelRoot,
      grid,
      ambient,
      hemi,
      sun,
      center: new THREE.Vector3(6, 1, 5),
      radius: 10,
      clipPlane,
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!container || !sceneRefs.current) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // Keyboard listeners for FPS walkthrough
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      keysPressedRef.current.add(e.code);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressedRef.current.delete(e.code);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Pointer handling: raycast in orbit, drag-to-look in FPS
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };
    let isDraggingLook = false;
    let lastLook = { x: 0, y: 0 };

    const handlePointerDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
      if (navModeRef.current === 'fps') {
        isDraggingLook = true;
        lastLook = { x: e.clientX, y: e.clientY };
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (navModeRef.current !== 'fps' || !isDraggingLook) return;
      const dx = e.clientX - lastLook.x;
      const dy = e.clientY - lastLook.y;
      lastLook = { x: e.clientX, y: e.clientY };

      fpsStateRef.current.yaw -= dx * 0.0045;
      fpsStateRef.current.pitch = Math.max(
        -Math.PI / 2.4,
        Math.min(Math.PI / 2.4, fpsStateRef.current.pitch - dy * 0.0045)
      );
      camera.rotation.order = 'YXZ';
      camera.rotation.y = fpsStateRef.current.yaw;
      camera.rotation.x = fpsStateRef.current.pitch;
    };

    const handlePointerUp = (e: PointerEvent) => {
      isDraggingLook = false;
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(modelRoot.children, true);
      const hitWithMeta = hits.find((h) => h.object.userData?.pickable);
      if (hitWithMeta) {
        const meta = { ...(hitWithMeta.object.userData.pickable as PickableMetadata) };
        if (meta.kind === 'wall' && !meta.wallSide) {
          if (hitWithMeta.face?.materialIndex === 4) {
            meta.wallSide = 'front';
          } else if (hitWithMeta.face?.materialIndex === 5) {
            meta.wallSide = 'back';
          } else if (hitWithMeta.face?.normal) {
            meta.wallSide = hitWithMeta.face.normal.z < 0 ? 'back' : 'front';
          } else {
            meta.wallSide = 'front';
          }
        }
        setSelectedInfo(meta);
      } else {
        setSelectedInfo(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    let lastTime = performance.now();
    let rafId = 0;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (navModeRef.current === 'fps') {
        controls.enabled = false;
        const keys = keysPressedRef.current;
        let forwardInput = touchMoveRef.current.forward;
        let strafeInput = touchMoveRef.current.strafe;

        if (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp')) forwardInput += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) forwardInput -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) strafeInput += 1;
        if (keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft')) strafeInput -= 1;

        if (forwardInput !== 0 || strafeInput !== 0) {
          const speed = 3.2 * dt; // m/s walking speed
          const yaw = fpsStateRef.current.yaw;
          const forwardX = -Math.sin(yaw);
          const forwardZ = -Math.cos(yaw);
          const rightX = Math.cos(yaw);
          const rightZ = -Math.sin(yaw);

          const moveX = (forwardX * forwardInput + rightX * strafeInput) * speed;
          const moveZ = (forwardZ * forwardInput + rightZ * strafeInput) * speed;

          const playerRadius = 0.25;
          const segs = collisionSegmentsRef.current;
          const collides = (tx: number, tz: number) =>
            segs.some((s) => distancePointToSegment(tx, tz, s) < s.halfThick + playerRadius);

          if (!collides(camera.position.x + moveX, camera.position.z)) {
            camera.position.x += moveX;
          }
          if (!collides(camera.position.x, camera.position.z + moveZ)) {
            camera.position.z += moveZ;
          }
        }

        // Update current room HUD
        const xCm = camera.position.x * 100;
        const yCm = camera.position.z * 100;
        const room = activeRoomsRef.current.find((r) => pointInPolygon(xCm, yCm, r.points));
        if (room) {
          const area = polygonAreaM2(room.points);
          setCurrentRoomInfo((prev) =>
            prev?.name === room.name ? prev : { name: room.name, areaM2: area }
          );
        } else {
          setCurrentRoomInfo((prev) => (prev === null ? prev : null));
        }
      } else {
        controls.enabled = true;
        controls.update();
      }

      renderer.render(scene, camera);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      pmremTargetRef.current?.dispose();
      pmremTargetRef.current = null;
      disposeObject3D(modelRoot);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRefs.current = null;
    };
  }, []);

  // Rebuild 3D geometry when floors, active floor, scope, furniture, ceiling, clip or realisticMode change
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;

    let cancelled = false;

    while (refs.modelRoot.children.length > 0) {
      const child = refs.modelRoot.children[0];
      refs.modelRoot.remove(child);
      disposeObject3D(child);
    }

    const activeClip = clipEnabled ? refs.clipPlane : null;
    if (clipEnabled) {
      refs.clipPlane.constant = clipHeightM;
    }

    if (viewScope === 'current') {
      if (activeFloor) {
        refs.modelRoot.add(
          buildFloor3DGroup(activeFloor, {
            showFurniture,
            elevationM: 0,
            showCeiling,
            clippingPlane: activeClip,
            realisticMode,
          })
        );
        if (activeFloor.importedGlbUrl) {
          const loader = new GLTFLoader();
          loader.load(
            activeFloor.importedGlbUrl,
            (gltf) => {
              if (cancelled || !sceneRefs.current) return;
              gltf.scene.traverse((obj) => {
                if ((obj as THREE.Mesh).isMesh) {
                  obj.castShadow = true;
                  obj.receiveShadow = true;
                }
              });
              refs.modelRoot.add(gltf.scene);
            },
            undefined,
            () => undefined
          );
        }
      }
    } else {
      let currentElevationM = 0;
      const interiorFloors = sortedFloors.filter((f) => !f.isExterior);
      const exteriorFloors = sortedFloors.filter((f) => f.isExterior);

      for (const f of exteriorFloors) {
        refs.modelRoot.add(
          buildFloor3DGroup(f, {
            showFurniture,
            elevationM: 0,
            showCeiling,
            clippingPlane: activeClip,
            realisticMode,
          })
        );
      }
      for (const f of interiorFloors) {
        refs.modelRoot.add(
          buildFloor3DGroup(f, {
            showFurniture,
            elevationM: currentElevationM,
            showCeiling,
            clippingPlane: activeClip,
            realisticMode,
          })
        );
        currentElevationM += (f.defaultWallHeightCm || 250) / 100;
      }
    }

    const box = new THREE.Box3().setFromObject(refs.modelRoot);
    if (!box.isEmpty()) {
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      refs.center.copy(center);
      refs.radius = Math.max(size.length() / 2, 4);
      refs.grid.position.set(center.x, -0.002, center.z);
    }

    const frameKey = `${viewScope}:${viewScope === 'current' ? activeFloor?.id ?? '' : 'all'}`;
    if (navModeRef.current === 'orbit' && lastFramedKeyRef.current !== frameKey) {
      lastFramedKeyRef.current = frameKey;
      applyCameraPreset('iso');
    }

    return () => {
      cancelled = true;
    };
  }, [activeFloor, sortedFloors, viewScope, showFurniture, showCeiling, clipEnabled, realisticMode]);

  // Update clip plane constant smoothly without rebuilding meshes
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.clipPlane.constant = clipHeightM;
  }, [clipHeightM]);

  // Update grid, lighting mode, realistic toneMapping/IBL & sun hour without rebuilding geometry
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.grid.visible = showGrid;

    if (realisticMode) {
      if (!pmremTargetRef.current) {
        const pmrem = new THREE.PMREMGenerator(refs.renderer);
        const roomEnv = new RoomEnvironment();
        pmremTargetRef.current = pmrem.fromScene(roomEnv, 0.04);
        roomEnv.dispose();
        pmrem.dispose();
      }
      refs.scene.environment = pmremTargetRef.current.texture;
      refs.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      refs.renderer.toneMappingExposure = lighting === 'evening' ? 0.92 : 1.06;
    } else {
      refs.scene.environment = null;
      refs.renderer.toneMapping = THREE.NoToneMapping;
      refs.renderer.toneMappingExposure = 1.0;
    }

    if (lighting === 'day') {
      if (realisticMode) {
        const skyCanvas = document.createElement('canvas');
        skyCanvas.width = 4;
        skyCanvas.height = 128;
        const sctx = skyCanvas.getContext('2d');
        if (sctx) {
          const grad = sctx.createLinearGradient(0, 0, 0, 128);
          const warm = sunHour >= 18 || sunHour <= 9;
          grad.addColorStop(0, warm ? '#475569' : '#60a5fa');
          grad.addColorStop(0.55, warm ? '#fed7aa' : '#dbeafe');
          grad.addColorStop(1, '#f1f5f9');
          sctx.fillStyle = grad;
          sctx.fillRect(0, 0, 4, 128);
          const skyTex = new THREE.CanvasTexture(skyCanvas);
          skyTex.colorSpace = THREE.SRGBColorSpace;
          refs.scene.background = skyTex;
        } else {
          refs.scene.background = new THREE.Color(0xeef2f6);
        }
      } else {
        refs.scene.background = new THREE.Color(0xf1f5f9);
      }
      refs.ambient.intensity = realisticMode ? 0.38 : 0.52;
      refs.hemi.intensity = realisticMode ? 0.62 : 0.52;
      const sunPos = computeSunPosition(
        refs.center,
        sunHour,
        activeFloor?.southAngleDeg ?? 0,
        Math.max(24, refs.radius * 2.2)
      );
      refs.sun.position.set(sunPos.x, sunPos.y, sunPos.z);
      refs.sun.target.position.copy(refs.center);
      refs.sun.target.updateMatrixWorld();
      const frustum = Math.max(12, refs.radius * 1.4);
      refs.sun.shadow.camera.left = -frustum;
      refs.sun.shadow.camera.right = frustum;
      refs.sun.shadow.camera.top = frustum;
      refs.sun.shadow.camera.bottom = -frustum;
      refs.sun.shadow.camera.updateProjectionMatrix();
      const t = (sunHour - 6) / 14;
      const angle = t * Math.PI;
      refs.sun.intensity = (realisticMode ? 1.25 : 0.95) + Math.sin(angle) * 0.5;
      refs.sun.color.setHex(sunHour >= 18 || sunHour <= 9 ? 0xfed7aa : 0xfffbeb);
    } else {
      refs.scene.background = new THREE.Color(0x0f172a);
      refs.ambient.intensity = 0.28;
      refs.hemi.intensity = 0.24;
      refs.sun.intensity = 0.65;
      refs.sun.color.setHex(0xfde68a);
    }
  }, [showGrid, lighting, sunHour, realisticMode, activeFloor?.southAngleDeg]);

  const captureCanvasView = (): string | null => {
    const refs = sceneRefs.current;
    if (!refs) return null;
    refs.renderer.render(refs.scene, refs.camera);
    return refs.renderer.domElement.toDataURL('image/png');
  };

  const captureDepthView = (): string | null => {
    const refs = sceneRefs.current;
    if (!refs) return null;
    const prevOverride = refs.scene.overrideMaterial;
    const prevBg = refs.scene.background;
    const prevGridVis = refs.grid.visible;
    const depthMat = new THREE.MeshDepthMaterial();
    refs.scene.background = new THREE.Color(0x000000);
    refs.scene.overrideMaterial = depthMat;
    refs.grid.visible = false;
    refs.renderer.render(refs.scene, refs.camera);
    const dataUrl = refs.renderer.domElement.toDataURL('image/png');
    refs.scene.overrideMaterial = prevOverride;
    refs.scene.background = prevBg;
    refs.grid.visible = prevGridVis;
    depthMat.dispose();
    refs.renderer.render(refs.scene, refs.camera);
    return dataUrl;
  };

  const selectedWall: Wall | undefined =
    selectedInfo?.kind === 'wall' && activeFloor
      ? activeFloor.walls.find((w) => w.id === selectedInfo.id)
      : undefined;
  const selectedRoom: RoomZone | undefined =
    (selectedInfo?.kind === 'room' || selectedInfo?.kind === 'ceiling') && activeFloor
      ? activeFloor.rooms.find((r) => r.id === selectedInfo.id)
      : undefined;
  const selectedOpening: Opening | undefined =
    selectedInfo?.kind === 'opening' && activeFloor
      ? activeFloor.openings.find((o) => o.id === selectedInfo.id)
      : undefined;
  const selectedFurniture: FurnitureItem | undefined =
    selectedInfo?.kind === 'furniture' && activeFloor
      ? activeFloor.furniture.find((f) => f.id === selectedInfo.id)
      : undefined;

  const updateWallStyle = (
    wall: Wall,
    side: 'front' | 'back',
    patch: {
      color?: string;
      material?: WallMaterial;
      pattern?: SurfacePattern | null;
      textureUrl?: string;
      clearTexture?: boolean;
      isLowWall?: boolean;
      heightCm?: number;
    }
  ) => {
    if (!activeFloor || !onUpdateFloor) return;

    if (patch.isLowWall !== undefined || patch.heightCm !== undefined) {
      onUpdateFloor({
        ...activeFloor,
        walls: activeFloor.walls.map((w) =>
          w.id === wall.id
            ? {
                ...w,
                isLowWall: patch.isLowWall ?? w.isLowWall,
                heightCm: patch.heightCm ?? w.heightCm,
              }
            : w
        ),
      });
      return;
    }

    if (wallApplyScope === 'room') {
      const dx = wall.x2 - wall.x1;
      const dy = wall.y2 - wall.y1;
      const len = Math.hypot(dx, dy) || 1;
      const midX = (wall.x1 + wall.x2) / 2;
      const midY = (wall.y1 + wall.y2) / 2;
      const nx = side === 'front' ? -dy / len : dy / len;
      const ny = side === 'front' ? dx / len : -dx / len;
      const probeX = midX + nx * 28;
      const probeY = midY + ny * 28;
      const targetRoom = activeFloor.rooms.find((r) => pointInPolygon(probeX, probeY, r.points));

      if (targetRoom) {
        onUpdateFloor({
          ...activeFloor,
          walls: activeFloor.walls.map((w) => {
            const wDx = w.x2 - w.x1;
            const wDy = w.y2 - w.y1;
            const wLen = Math.hypot(wDx, wDy) || 1;
            const wMidX = (w.x1 + w.x2) / 2;
            const wMidY = (w.y1 + w.y2) / 2;
            const frontInRoom = pointInPolygon(
              wMidX + (-wDy / wLen) * 28,
              wMidY + (wDx / wLen) * 28,
              targetRoom.points
            );
            const backInRoom = pointInPolygon(
              wMidX + (wDy / wLen) * 28,
              wMidY + (-wDx / wLen) * 28,
              targetRoom.points
            );
            if (!frontInRoom && !backInRoom) return w;
            const next = { ...w };
            if (frontInRoom) {
              if (patch.color !== undefined) next.colorFront = patch.color;
              if (patch.material !== undefined) next.materialFront = patch.material;
              if (patch.pattern !== undefined) next.patternFront = patch.pattern ?? undefined;
              if (patch.textureUrl !== undefined) next.textureUrlFront = patch.textureUrl;
              if (patch.clearTexture) next.textureUrlFront = undefined;
            }
            if (backInRoom) {
              if (patch.color !== undefined) next.colorBack = patch.color;
              if (patch.material !== undefined) next.materialBack = patch.material;
              if (patch.pattern !== undefined) next.patternBack = patch.pattern ?? undefined;
              if (patch.textureUrl !== undefined) next.textureUrlBack = patch.textureUrl;
              if (patch.clearTexture) next.textureUrlBack = undefined;
            }
            return next;
          }),
        });
        return;
      }
    }

    onUpdateFloor({
      ...activeFloor,
      walls: activeFloor.walls.map((w) => {
        if (w.id !== wall.id) return w;
        const applyFront = wallApplyScope === 'both' || side === 'front';
        const applyBack = wallApplyScope === 'both' || side === 'back';
        const next = { ...w };
        if (applyFront) {
          if (patch.color !== undefined) next.colorFront = patch.color;
          if (patch.material !== undefined) next.materialFront = patch.material;
          if (patch.pattern !== undefined) next.patternFront = patch.pattern ?? undefined;
          if (patch.textureUrl !== undefined) next.textureUrlFront = patch.textureUrl;
          if (patch.clearTexture) next.textureUrlFront = undefined;
        }
        if (applyBack) {
          if (patch.color !== undefined) next.colorBack = patch.color;
          if (patch.material !== undefined) next.materialBack = patch.material;
          if (patch.pattern !== undefined) next.patternBack = patch.pattern ?? undefined;
          if (patch.textureUrl !== undefined) next.textureUrlBack = patch.textureUrl;
          if (patch.clearTexture) next.textureUrlBack = undefined;
        }
        return next;
      }),
    });
  };

  const patchRoom = (roomId: string, patch: Partial<RoomZone>) => {
    if (!activeFloor || !onUpdateFloor) return;
    onUpdateFloor({
      ...activeFloor,
      rooms: activeFloor.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
    });
  };

  const patchOpening = (openingId: string, patch: Partial<Opening>) => {
    if (!activeFloor || !onUpdateFloor) return;
    onUpdateFloor({
      ...activeFloor,
      openings: activeFloor.openings.map((o) => (o.id === openingId ? { ...o, ...patch } : o)),
    });
  };

  const patchFurniture = (furnId: string, patch: Partial<FurnitureItem>) => {
    if (!activeFloor || !onUpdateFloor) return;
    onUpdateFloor({
      ...activeFloor,
      furniture: activeFloor.furniture.map((f) => (f.id === furnId ? { ...f, ...patch } : f)),
    });
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-100 select-none">
      {/* 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full touch-none" />

      {/* Top Bar: Floor/Scope Controls (left) & Camera Presets (right) */}
      <div className="absolute top-3 left-3 right-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 pointer-events-none z-10">
        {/* Top Left: Floor & Scope Controls */}
        <div className="flex flex-wrap items-center gap-2 pointer-events-none min-w-0">
          <div className="pointer-events-auto flex items-center gap-1 bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl p-1 shadow-sm">
            <button
              onClick={() => setViewScope('current')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors ${
                viewScope === 'current'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              Étage actif
            </button>
            <button
              onClick={() => {
                setNavMode('orbit');
                setViewScope('all');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors ${
                viewScope === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Maison complète
            </button>
          </div>

          {viewScope === 'current' && sortedFloors.length > 1 && (
            <div className="pointer-events-auto flex items-center gap-1 bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl p-1 shadow-sm overflow-x-auto max-w-full">
              {sortedFloors.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onSelectFloor(f.id)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                    activeFloor?.id === f.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}

          {/* FPS Current Room HUD & Teleport */}
          {navMode === 'fps' && (
            <div className="pointer-events-auto flex flex-wrap items-center gap-2 bg-slate-900/90 text-white backdrop-blur-md rounded-2xl px-3 py-1.5 shadow-md text-xs max-w-full">
              <Footprints className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {currentRoomInfo
                  ? `${currentRoomInfo.name} (${currentRoomInfo.areaM2.toFixed(1)} m²)`
                  : 'En déplacement'}
              </span>
              {activeFloor && activeFloor.rooms.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const r = activeFloor.rooms.find((rm) => rm.id === e.target.value);
                    if (r) enterFpsInRoom(r);
                  }}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white"
                >
                  <option value="">Aller dans une pièce...</option>
                  {activeFloor.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Top Right: Camera Presets, FPS Mode & Scene Toggles */}
        <div className="flex flex-col gap-2 pointer-events-none items-end self-end sm:self-auto shrink-0 max-w-full">
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1 bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl p-1 shadow-sm max-w-full">
          <button
            onClick={() => applyCameraPreset('iso')}
            title="Vue 3D isométrique"
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 ${
              navMode === 'orbit' ? 'text-slate-800 hover:bg-slate-100' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Orbite</span>
          </button>
          <button
            onClick={() => applyCameraPreset('top')}
            title="Vue de dessus"
            className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1"
          >
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Dessus</span>
          </button>
          <button
            onClick={() => (navMode === 'fps' ? applyCameraPreset('iso') : enterFpsInRoom())}
            title="Visite virtuelle à la 1ère personne (ZQSD / Tactile)"
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors ${
              navMode === 'fps'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Footprints className="w-3.5 h-3.5" />
            <span>Visite FPS</span>
          </button>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1 bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl p-1 shadow-sm max-w-full">
          {onUpdateFloor && (
            <button
              onClick={() => setCustomizeMode((v) => !v)}
              title="Mode Personnalisation au clic (murs, sols, plafonds, meubles)"
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors ${
                customizeMode
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Personnaliser</span>
            </button>
          )}
          <button
            onClick={() => setRealisticMode((v) => !v)}
            title="Activer le rendu réel PBR (lumières pièces, ombres douces, textures détaillées)"
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors ${
              realisticMode
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Rendu Réel</span>
          </button>
          {onOpenWebCatalog && (
            <button
              onClick={onOpenWebCatalog}
              title="Importer un article web (Darty, Poltronesofà, Truffaut...) dans la scène 3D"
              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 flex items-center gap-1"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Web → 3D</span>
            </button>
          )}
          {activeFloor && onUpdateFloor && (
            <>
              <button
                onClick={() => setShowStudioModal(true)}
                title="Prendre une photo de cette vue 3D et générer un rendu IA photoréaliste"
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-1 shadow-xs"
              >
                <Camera className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Photo IA</span>
              </button>
              <button
                onClick={() => setShowStudioModal(true)}
                title="Studio IA, Rendu photo, Export .GLB/.OBJ, Google Flow & Ré-import 360°"
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 flex items-center gap-1 shadow-xs"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Studio IA / Export</span>
              </button>
            </>
          )}

          <div className="w-px h-5 bg-slate-200 mx-0.5" />

          <button
            onClick={() => setShowFurniture((v) => !v)}
            title="Afficher / masquer les meubles"
            className={`p-2 rounded-xl transition-colors ${
              showFurniture ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Sofa className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCeiling((v) => !v)}
            title="Afficher / masquer les plafonds"
            className={`p-2 rounded-xl transition-colors ${
              showCeiling ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Home className="w-4 h-4" />
          </button>
          <button
            onClick={() => setClipEnabled((v) => !v)}
            title="Coupe verticale (Maison de poupée)"
            className={`p-2 rounded-xl transition-colors ${
              clipEnabled ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Scissors className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowGrid((v) => !v)}
            title="Afficher / masquer la grille"
            className={`p-2 rounded-xl transition-colors ${
              showGrid ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLighting((m) => (m === 'day' ? 'evening' : 'day'))}
            title={lighting === 'day' ? 'Passer en mode soirée' : 'Passer en mode jour'}
            className={`p-2 rounded-xl transition-colors ${
              lighting === 'evening' ? 'bg-amber-50 text-amber-600' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {lighting === 'day' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Sliders: Coupe verticale & Heure du soleil */}
        {(clipEnabled || lighting === 'day') && (
          <div className="pointer-events-auto bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl p-2.5 shadow-sm space-y-2 w-48">
            {lighting === 'day' && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-medium text-slate-700">
                  <span>Soleil</span>
                  <span>{sunHour}h00</span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={20}
                  step={1}
                  value={sunHour}
                  onChange={(e) => setSunHour(Number(e.target.value))}
                  className="w-full accent-amber-500 h-1.5"
                />
              </div>
            )}
            {clipEnabled && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-medium text-slate-700">
                  <span>Hauteur coupe</span>
                  <span>{clipHeightM.toFixed(2)} m</span>
                </div>
                <input
                  type="range"
                  min={0.4}
                  max={3.2}
                  step={0.1}
                  value={clipHeightM}
                  onChange={(e) => setClipHeightM(Number(e.target.value))}
                  className="w-full accent-indigo-600 h-1.5"
                />
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Bottom Left: Tactile D-pad in FPS mode OR navigation hint */}
      {navMode === 'fps' ? (
        <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 flex flex-col items-center gap-1 bg-white/85 backdrop-blur-md border border-slate-200 rounded-2xl p-2 shadow-lg z-10">
          <button
            onPointerDown={() => (touchMoveRef.current.forward = 1)}
            onPointerUp={() => (touchMoveRef.current.forward = 0)}
            onPointerLeave={() => (touchMoveRef.current.forward = 0)}
            className="w-10 h-10 rounded-xl bg-slate-100 active:bg-emerald-600 active:text-white flex items-center justify-center"
            title="Avancer (Z / W / ↑)"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
          <div className="flex gap-1">
            <button
              onPointerDown={() => (touchMoveRef.current.strafe = -1)}
              onPointerUp={() => (touchMoveRef.current.strafe = 0)}
              onPointerLeave={() => (touchMoveRef.current.strafe = 0)}
              className="w-10 h-10 rounded-xl bg-slate-100 active:bg-emerald-600 active:text-white flex items-center justify-center"
              title="Gauche (Q / A / ←)"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button
              onPointerDown={() => (touchMoveRef.current.forward = -1)}
              onPointerUp={() => (touchMoveRef.current.forward = 0)}
              onPointerLeave={() => (touchMoveRef.current.forward = 0)}
              className="w-10 h-10 rounded-xl bg-slate-100 active:bg-emerald-600 active:text-white flex items-center justify-center"
              title="Reculer (S / ↓)"
            >
              <ArrowDown className="w-5 h-5" />
            </button>
            <button
              onPointerDown={() => (touchMoveRef.current.strafe = 1)}
              onPointerUp={() => (touchMoveRef.current.strafe = 0)}
              onPointerLeave={() => (touchMoveRef.current.strafe = 0)}
              className="w-10 h-10 rounded-xl bg-slate-100 active:bg-emerald-600 active:text-white flex items-center justify-center"
              title="Droite (D / →)"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
          <span className="text-[10px] text-slate-500 pt-0.5">ZQSD · Glisser pour regarder</span>
        </div>
      ) : (
        <div className="absolute bottom-3 left-3 pointer-events-none hidden sm:block">
          <div className="bg-white/85 backdrop-blur-md border border-slate-200 rounded-xl px-3 py-1.5 text-[11px] text-slate-600 shadow-sm">
            1 doigt / clic gauche : pivoter · 2 doigts / molette : zoomer · Cliquez sur « Visite FPS » pour marcher dedans
          </div>
        </div>
      )}

      {/* Bottom Right / Side: Interactive 3D Customization Panel OR Info Card */}
      {selectedInfo && (
        <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 w-[calc(100vw-1.5rem)] sm:w-80 max-w-[92vw] max-h-[55dvh] sm:max-h-[75vh] overflow-y-auto bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-3.5 shadow-2xl space-y-3 z-20">
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                {selectedInfo.kind === 'room'
                  ? 'Sol & Pièce'
                  : selectedInfo.kind === 'ceiling'
                  ? 'Plafond'
                  : selectedInfo.kind === 'wall'
                  ? `Mur (${selectedInfo.wallSide === 'back' ? 'Face B' : 'Face A'})`
                  : selectedInfo.kind === 'opening'
                  ? 'Ouverture / Arche'
                  : 'Meuble 3D'}
              </span>
              <h4 className="text-sm font-bold text-slate-900 truncate">{selectedInfo.label}</h4>
              <p className="text-[11px] text-slate-500">{selectedInfo.details}</p>
            </div>
            <button
              onClick={() => setSelectedInfo(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {customizeMode && activeFloor && onUpdateFloor && (
            <>
              {/* WALL CUSTOMIZER */}
              {selectedWall && (() => {
                const side: 'front' | 'back' = selectedInfo.wallSide === 'back' ? 'back' : 'front';
                const currentColor =
                  (side === 'front' ? selectedWall.colorFront : selectedWall.colorBack) ?? '#f1f5f9';
                const currentMat =
                  (side === 'front' ? selectedWall.materialFront : selectedWall.materialBack) ?? 'paint-matte';
                const currentTex =
                  side === 'front' ? selectedWall.textureUrlFront : selectedWall.textureUrlBack;
                const currentPattern =
                  side === 'front' ? selectedWall.patternFront : selectedWall.patternBack;

                return (
                  <div className="space-y-3 text-xs">
                    {/* Face switcher + Scope */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-600">Zone d’application :</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedInfo({
                              ...selectedInfo,
                              wallSide: side === 'front' ? 'back' : 'front',
                            })
                          }
                          className="text-[11px] font-semibold text-indigo-600 hover:underline"
                        >
                          Basculer Face {side === 'front' ? 'A → B' : 'B → A'}
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl">
                        {(
                          [
                            ['face', 'Cette face'],
                            ['both', '2 faces'],
                            ['room', 'Toute la pièce'],
                          ] as const
                        ).map(([k, lbl]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setWallApplyScope(k)}
                            className={`py-1 px-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                              wallApplyScope === k
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-600 hover:bg-white'
                            }`}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Swatches + Color picker */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-600">Couleur / Teinte</span>
                        <input
                          type="color"
                          value={currentColor}
                          onChange={(e) => updateWallStyle(selectedWall, side, { color: e.target.value })}
                          className="w-7 h-6 rounded border border-slate-300 cursor-pointer"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {WALL_COLOR_SWATCHES.map((sw) => (
                          <button
                            key={sw.hex}
                            type="button"
                            title={sw.name}
                            onClick={() => updateWallStyle(selectedWall, side, { color: sw.hex })}
                            style={{ backgroundColor: sw.hex }}
                            className={`w-6 h-6 rounded-full border transition-transform hover:scale-110 ${
                              currentColor.toLowerCase() === sw.hex.toLowerCase()
                                ? 'border-indigo-600 ring-2 ring-indigo-300'
                                : 'border-slate-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Wall Material */}
                    <label className="block">
                      <span className="font-semibold text-slate-600">Revêtement mural 3D</span>
                      <select
                        value={currentMat}
                        onChange={(e) => {
                          const nextMat = e.target.value as WallMaterial;
                          updateWallStyle(selectedWall, side, {
                            material: nextMat,
                            color:
                              WALL_MATERIAL_LABELS[nextMat]?.defaultColor && currentColor === '#f1f5f9'
                                ? WALL_MATERIAL_LABELS[nextMat].defaultColor
                                : undefined,
                          });
                        }}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-xl bg-white font-semibold"
                      >
                        {Object.entries(WALL_MATERIAL_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {/* Photo wallpaper upload */}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer flex items-center gap-1">
                        <Upload className="w-3.5 h-3.5" />
                        Photo / Papier peint
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () =>
                              updateWallStyle(selectedWall, side, {
                                textureUrl: String(reader.result),
                              });
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                      {currentTex && (
                        <button
                          type="button"
                          onClick={() => updateWallStyle(selectedWall, side, { clearTexture: true })}
                          className="px-2 py-1.5 rounded-xl bg-rose-50 text-rose-700 text-[11px] font-semibold"
                        >
                          Retirer photo
                        </button>
                      )}
                    </div>

                    {/* Wall Pattern (Damier / Papier peint) */}
                    <SurfacePatternControls
                      label="Motif mural (Damier, Papier peint…)"
                      pattern={currentPattern}
                      defaultPrimary={currentColor}
                      defaultSecondary="#334155"
                      onChange={(nextPattern) =>
                        updateWallStyle(selectedWall, side, { pattern: nextPattern ?? null })
                      }
                    />

                    {/* Low wall / Height */}
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="font-semibold text-slate-700">Muret / Demi-cloison (Bar)</span>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedWall.isLowWall)}
                          onChange={(e) =>
                            updateWallStyle(selectedWall, side, {
                              isLowWall: e.target.checked,
                              heightCm: e.target.checked ? selectedWall.heightCm ?? 110 : undefined,
                            })
                          }
                        />
                      </label>
                      <label className="block">
                        <div className="flex justify-between text-[11px] text-slate-500">
                          <span>Hauteur mur</span>
                          <strong>{selectedWall.heightCm ?? activeFloor.defaultWallHeightCm} cm</strong>
                        </div>
                        <input
                          type="range"
                          min={60}
                          max={360}
                          step={5}
                          value={selectedWall.heightCm ?? activeFloor.defaultWallHeightCm}
                          onChange={(e) =>
                            updateWallStyle(selectedWall, side, { heightCm: Number(e.target.value) })
                          }
                          className="w-full accent-indigo-600 h-1.5"
                        />
                      </label>
                    </div>
                  </div>
                );
              })()}

              {/* ROOM / FLOOR / CEILING CUSTOMIZER */}
              {selectedRoom && (
                <div className="space-y-3 text-xs">
                  {selectedRoom.aiRenderUrl && (
                    <div className="bg-violet-50 border border-violet-200 rounded-xl p-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveRenderViewer({
                            url: selectedRoom.aiRenderUrl!,
                            is360: Boolean(selectedRoom.aiRenderIs360),
                            title: selectedRoom.name,
                          })
                        }
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-violet-600 text-white font-bold flex items-center justify-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Voir Rendu {selectedRoom.aiRenderIs360 ? '360°' : 'Photo Réel'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patchRoom(selectedRoom.id, { aiRenderUrl: undefined, aiRenderIs360: false })
                        }
                        className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-100"
                        title="Supprimer le rendu épinglé"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <label className="block">
                    <span className="font-semibold text-slate-600">Revêtement de sol</span>
                    <select
                      value={selectedRoom.floorType}
                      onChange={(e) => {
                        const nextMat = e.target.value as FloorMaterial;
                        patchRoom(selectedRoom.id, {
                          floorType: nextMat,
                          color: FLOOR_MATERIAL_LABELS[nextMat]?.color,
                        });
                      }}
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-xl bg-white font-semibold"
                    >
                      {Object.entries(FLOOR_MATERIAL_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[11px] text-slate-500">Teinte sol</span>
                      <input
                        type="color"
                        value={
                          selectedRoom.color ??
                          FLOOR_MATERIAL_LABELS[selectedRoom.floorType]?.color ??
                          '#f1f5f9'
                        }
                        onChange={(e) => patchRoom(selectedRoom.id, { color: e.target.value })}
                        className="mt-1 w-full h-7 rounded border border-slate-300 cursor-pointer"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-500">Sens lames / pose</span>
                      <select
                        value={selectedRoom.floorOrientationDeg ?? 0}
                        onChange={(e) =>
                          patchRoom(selectedRoom.id, { floorOrientationDeg: Number(e.target.value) })
                        }
                        className="mt-1 w-full px-2 py-1 border border-slate-300 rounded-lg bg-white font-semibold"
                      >
                        <option value={0}>0° (Horizontal)</option>
                        <option value={45}>45° (Diagonale)</option>
                        <option value={90}>90° (Vertical)</option>
                      </select>
                    </label>
                  </div>

                  <label className="block">
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>Échelle motif / carreaux</span>
                      <strong>{(selectedRoom.floorScale ?? 1).toFixed(1)}×</strong>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.1}
                      value={selectedRoom.floorScale ?? 1}
                      onChange={(e) =>
                        patchRoom(selectedRoom.id, { floorScale: Number(e.target.value) })
                      }
                      className="w-full accent-indigo-600 h-1.5"
                    />
                  </label>

                  {/* Ceiling Options */}
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Plafond</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500">Couleur</span>
                        <input
                          type="color"
                          value={selectedRoom.ceilingColor ?? '#ffffff'}
                          onChange={(e) =>
                            patchRoom(selectedRoom.id, { ceilingColor: e.target.value })
                          }
                          className="w-7 h-6 rounded border border-slate-300 cursor-pointer"
                        />
                      </div>
                    </div>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-slate-700 font-medium">Poutres chêne apparentes</span>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedRoom.ceilingBeams)}
                        onChange={(e) => {
                          if (e.target.checked && !showCeiling) setShowCeiling(true);
                          patchRoom(selectedRoom.id, { ceilingBeams: e.target.checked });
                        }}
                      />
                    </label>
                    <SurfacePatternControls
                      label="Motif du plafond (Damier, Papier peint…)"
                      pattern={selectedRoom.ceilingPattern}
                      defaultPrimary={selectedRoom.ceilingColor ?? '#f8fafc'}
                      defaultSecondary="#334155"
                      onChange={(nextPattern) => {
                        if (nextPattern && !showCeiling) setShowCeiling(true);
                        patchRoom(selectedRoom.id, { ceilingPattern: nextPattern });
                      }}
                    />
                  </div>
                </div>
              )}

              {/* OPENING CUSTOMIZER */}
              {selectedOpening && (
                <div className="space-y-2.5 text-xs">
                  <label className="block">
                    <span className="font-semibold text-slate-600">Type d’ouverture</span>
                    <select
                      value={selectedOpening.type}
                      onChange={(e) => {
                        const t = e.target.value as OpeningType;
                        patchOpening(selectedOpening.id, {
                          type: t,
                          archShape:
                            t === 'arch-passage'
                              ? selectedOpening.archShape ?? 'half-circle'
                              : selectedOpening.archShape,
                          hasFrame: t === 'arch-passage' ? false : selectedOpening.hasFrame ?? true,
                          sillHeightCm:
                            t === 'window' || t === 'interior-glass' || t === 'pass-through'
                              ? selectedOpening.sillHeightCm ?? 100
                              : 0,
                        });
                      }}
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-xl bg-white font-semibold"
                    >
                      {Object.entries(OPENING_TYPE_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="font-semibold text-slate-600">Forme haute / Arche</span>
                    <select
                      value={selectedOpening.archShape ?? 'flat'}
                      onChange={(e) =>
                        patchOpening(selectedOpening.id, { archShape: e.target.value as ArchShape })
                      }
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-xl bg-white font-semibold"
                    >
                      {Object.entries(ARCH_SHAPE_LABELS).map(([k, lbl]) => (
                        <option key={k} value={k}>
                          {lbl}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedOpening.archShape && selectedOpening.archShape !== 'flat' && (
                    <label className="block">
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>Courbure / Flèche</span>
                        <strong>
                          {selectedOpening.archRiseCm ?? Math.round(selectedOpening.widthCm / 2)} cm
                        </strong>
                      </div>
                      <input
                        type="range"
                        min={8}
                        max={120}
                        value={
                          selectedOpening.archRiseCm ?? Math.round(selectedOpening.widthCm / 2)
                        }
                        onChange={(e) =>
                          patchOpening(selectedOpening.id, { archRiseCm: Number(e.target.value) })
                        }
                        className="w-full accent-indigo-600 h-1.5"
                      />
                    </label>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[11px] text-slate-500">Largeur (cm)</span>
                      <input
                        type="number"
                        min={20}
                        max={500}
                        value={selectedOpening.widthCm}
                        onChange={(e) =>
                          patchOpening(selectedOpening.id, {
                            widthCm: Math.max(20, Number(e.target.value) || 90),
                          })
                        }
                        className="mt-0.5 w-full px-2 py-1 border border-slate-300 rounded-lg font-bold"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-500">Hauteur (cm)</span>
                      <input
                        type="number"
                        min={30}
                        max={320}
                        value={selectedOpening.heightCm}
                        onChange={(e) =>
                          patchOpening(selectedOpening.id, {
                            heightCm: Math.max(30, Number(e.target.value) || 210),
                          })
                        }
                        className="mt-0.5 w-full px-2 py-1 border border-slate-300 rounded-lg font-bold"
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedOpening.hasFrame ?? selectedOpening.type !== 'arch-passage'}
                        onChange={(e) =>
                          patchOpening(selectedOpening.id, { hasFrame: e.target.checked })
                        }
                      />
                      <span>Cadre / Montants</span>
                    </label>
                    <input
                      type="color"
                      value={selectedOpening.frameColor ?? '#334155'}
                      onChange={(e) =>
                        patchOpening(selectedOpening.id, { frameColor: e.target.value })
                      }
                      className="w-7 h-6 rounded border border-slate-300 cursor-pointer"
                    />
                  </div>

                  {selectedOpening.type === 'door' && (
                    <div className="space-y-2 pt-1 border-t border-slate-100">
                      <span className="font-semibold text-slate-600 block">
                        Sens d’ouverture (4 sens)
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          { label: '↖ Intérieur · Gauche', flip: false, hinge: 'left' as const },
                          { label: '↗ Intérieur · Droite', flip: false, hinge: 'right' as const },
                          { label: '↙ Extérieur · Gauche', flip: true, hinge: 'left' as const },
                          { label: '↘ Extérieur · Droite', flip: true, hinge: 'right' as const },
                        ]).map((opt) => {
                          const isActive =
                            Boolean(selectedOpening.flip) === opt.flip &&
                            (selectedOpening.hinge ?? 'left') === opt.hinge;
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() =>
                                patchOpening(selectedOpening.id, {
                                  flip: opt.flip,
                                  hinge: opt.hinge,
                                })
                              }
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors ${
                                isActive
                                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            patchOpening(selectedOpening.id, { flip: !selectedOpening.flip })
                          }
                          className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-medium text-slate-700"
                        >
                          Inverser Int. / Ext.
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            patchOpening(selectedOpening.id, {
                              hinge: (selectedOpening.hinge ?? 'left') === 'left' ? 'right' : 'left',
                            })
                          }
                          className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-medium text-slate-700"
                        >
                          Inverser Gauche / Droite
                        </button>
                      </div>
                    </div>
                  )}

                  {(selectedOpening.type === 'double-door' ||
                    selectedOpening.type === 'pocket-door') && (
                    <button
                      type="button"
                      onClick={() =>
                        patchOpening(selectedOpening.id, { flip: !selectedOpening.flip })
                      }
                      className="w-full py-1.5 px-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-[11px] font-semibold text-slate-700"
                    >
                      Inverser le sens d’ouverture
                    </button>
                  )}
                </div>
              )}

              {/* FURNITURE CUSTOMIZER */}
              {selectedFurniture && (() => {
                const variants = FURNITURE_VARIANTS_BY_TYPE[selectedFurniture.type] ?? [];
                return (
                  <div className="space-y-2.5 text-xs">
                    {variants.length > 0 && (
                      <label className="block">
                        <span className="font-semibold text-slate-600">Design / Modèle 3D</span>
                        <select
                          value={selectedFurniture.variant ?? variants[0].id}
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, { variant: e.target.value })
                          }
                          className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-xl bg-white font-semibold"
                        >
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="block">
                      <span className="font-semibold text-slate-600">Tissu / Matériau</span>
                      <select
                        value={selectedFurniture.materialType ?? ''}
                        onChange={(e) => {
                          const mat = e.target.value
                            ? (e.target.value as FurnitureMaterialType)
                            : undefined;
                          patchFurniture(selectedFurniture.id, {
                            materialType: mat,
                            color:
                              mat && FURNITURE_MATERIAL_LABELS[mat]
                                ? FURNITURE_MATERIAL_LABELS[mat].defaultColor
                                : selectedFurniture.color,
                          });
                        }}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-xl bg-white font-semibold"
                      >
                        <option value="">Matière par défaut</option>
                        {Object.entries(FURNITURE_MATERIAL_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] text-slate-500">Couleur principale</span>
                        <input
                          type="color"
                          value={selectedFurniture.color ?? '#cbd5e1'}
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, { color: e.target.value })
                          }
                          className="mt-1 w-full h-7 rounded border border-slate-300 cursor-pointer"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-slate-500">Piètement / Détail</span>
                        <input
                          type="color"
                          value={selectedFurniture.secondaryColor ?? '#1e293b'}
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, {
                              secondaryColor: e.target.value,
                            })
                          }
                          className="mt-1 w-full h-7 rounded border border-slate-300 cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Elevation (Wall TV, Shelf), Rotation & Scale */}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] text-slate-500">Hauteur du sol (cm)</span>
                        <input
                          type="number"
                          min={0}
                          max={240}
                          step={5}
                          value={selectedFurniture.elevationCm ?? 0}
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, {
                              elevationCm: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 border border-slate-300 rounded-lg font-bold"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-slate-500">Rotation (°)</span>
                        <input
                          type="number"
                          step={15}
                          value={selectedFurniture.rotation}
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, {
                              rotation: Number(e.target.value) || 0,
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 border border-slate-300 rounded-lg font-bold"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <label className="block">
                        <span className="text-[10px] text-slate-500">Larg. cm</span>
                        <input
                          type="number"
                          min={10}
                          value={selectedFurniture.widthCm}
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, {
                              widthCm: Math.max(10, Number(e.target.value) || 100),
                            })
                          }
                          className="w-full px-1.5 py-1 border border-slate-300 rounded-lg font-bold"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-slate-500">Prof. cm</span>
                        <input
                          type="number"
                          min={5}
                          value={selectedFurniture.depthCm}
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, {
                              depthCm: Math.max(5, Number(e.target.value) || 60),
                            })
                          }
                          className="w-full px-1.5 py-1 border border-slate-300 rounded-lg font-bold"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-slate-500">Haut. cm</span>
                        <input
                          type="number"
                          min={10}
                          value={selectedFurniture.heightCm ?? 80}
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, {
                              heightCm: Math.max(10, Number(e.target.value) || 80),
                            })
                          }
                          className="w-full px-1.5 py-1 border border-slate-300 rounded-lg font-bold"
                        />
                      </label>
                    </div>

                    {/* Photo / GLB Web Product 3D modes */}
                    {(selectedFurniture.imageUrl || selectedFurniture.glbDataUrl) && (
                      <div className="pt-2 border-t border-slate-100 space-y-1.5">
                        <span className="font-semibold text-slate-600">Affichage Produit Web / 3D</span>
                        <select
                          value={
                            selectedFurniture.renderMode3D === 'photo-billboard'
                              ? 'parametric'
                              : (selectedFurniture.renderMode3D ?? 'parametric')
                          }
                          onChange={(e) =>
                            patchFurniture(selectedFurniture.id, {
                              renderMode3D: e.target.value as FurnitureItem['renderMode3D'],
                            })
                          }
                          className="w-full px-2 py-1 border border-slate-300 rounded-lg bg-white font-semibold"
                        >
                          <option value="parametric">Modèle 3D sculpté HD (Recommandé)</option>
                          <option value="photo-texture">Modèle 3D + Photo plaquée (TV / Tissu)</option>
                          <option value="photo-volumetric">Volume 3D extrudé depuis photo</option>
                          {selectedFurniture.glbDataUrl && (
                            <option value="glb">Modèle 3D .GLB importé</option>
                          )}
                        </select>
                        {selectedFurniture.imageUrl && (
                          <button
                            type="button"
                            disabled={cuttingFurnitureImg}
                            onClick={async () => {
                              setCuttingFurnitureImg(true);
                              try {
                                const res = await removeImageBackground(selectedFurniture.imageUrl!, 42);
                                patchFurniture(selectedFurniture.id, {
                                  cutoutDataUrl: res.cutoutDataUrl,
                                  color: res.dominantHex,
                                  renderMode3D:
                                    selectedFurniture.type === 'tv-stand' ? 'photo-texture' : 'parametric',
                                });
                              } finally {
                                setCuttingFurnitureImg(false);
                              }
                            }}
                            className="w-full py-1.5 px-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            {cuttingFurnitureImg ? (
                              'Analyse de la photo...'
                            ) : (
                              <>
                                <Palette className="w-3.5 h-3.5 shrink-0" />
                                Extraire la couleur de la photo sur le modèle 3D
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-50 text-indigo-800 font-semibold cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      Charger un modèle .GLB pour ce meuble
                      <input
                        type="file"
                        accept=".glb,.gltf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file || file.size > 15 * 1024 * 1024) return;
                          const reader = new FileReader();
                          reader.onload = () =>
                            patchFurniture(selectedFurniture.id, {
                              glbDataUrl: String(reader.result),
                              renderMode3D: 'glb',
                            });
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Studio IA & Export 3D Modal */}
      {activeFloor && onUpdateFloor && (
        <Studio3DExportAIModal
          isOpen={showStudioModal}
          floor={activeFloor}
          initialRoomName={currentRoomInfo?.name}
          onClose={() => setShowStudioModal(false)}
          onUpdateFloor={onUpdateFloor}
          onOpenAISettings={onOpenAISettings}
          onCaptureCanvasView={captureCanvasView}
          onCaptureDepthView={captureDepthView}
          onGetModelRoot={() => sceneRefs.current?.modelRoot ?? null}
        />
      )}

      {/* Photorealistic / 360° Room Render Viewer Overlay */}
      {activeRenderViewer && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex flex-col p-4">
          <div className="flex items-center justify-between text-white pb-3">
            <div>
              <h3 className="text-sm sm:text-base font-bold">
                Rendu Photoréaliste {activeRenderViewer.is360 ? '360° Interactif' : ''} — {activeRenderViewer.title}
              </h3>
              <p className="text-xs text-slate-300">
                {activeRenderViewer.is360
                  ? 'Cliquez-glissez pour regarder autour de vous à 360°'
                  : 'Vue générée / importée pour cette pièce'}
              </p>
            </div>
            <button
              onClick={() => setActiveRenderViewer(null)}
              aria-label="Fermer"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 rounded-2xl overflow-hidden border border-white/15 bg-black flex items-center justify-center">
            {activeRenderViewer.is360 ? (
              <Panorama360Canvas imageUrl={activeRenderViewer.url} />
            ) : (
              <img
                src={activeRenderViewer.url}
                alt={activeRenderViewer.title}
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Panorama360Canvas: React.FC<{ imageUrl: string }> = ({ imageUrl }) => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      72,
      Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
      0.1,
      200
    );
    camera.position.set(0, 0, 0.1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = -0.35;

    const geo = new THREE.SphereGeometry(50, 48, 32);
    geo.scale(-1, 1, 1);
    const tex = new THREE.TextureLoader().load(imageUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);

    const resizeObserver = new ResizeObserver(() => {
      if (!host) return;
      camera.aspect = Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    });
    resizeObserver.observe(host);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      geo.dispose();
      mat.dispose();
      tex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [imageUrl]);

  return <div ref={hostRef} className="w-full h-full cursor-grab active:cursor-grabbing" />;
};
