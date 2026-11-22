import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line, Rect, Text, Group, Arc, Circle } from 'react-konva';
import Konva from 'konva';
import {
  Hand,
  MousePointer2,
  PenLine,
  Square,
  DoorOpen,
  AppWindow,
  Armchair,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  Trash2,
  RotateCw,
  Layers,
  Plus,
  Ruler,
  BookOpen,
  Shapes,
  Sparkles,
  ShoppingBag,
  ArrowLeftRight,
  Wand2,
  Check,
  X,
  Settings2,
  ArrowLeft,
  Compass,
  ArrowRight,
  Trees,
} from 'lucide-react';
import { NumericInput } from './NumericInput';
import type {
  ArchShape,
  Floor,
  FloorMaterial,
  FurnitureItem,
  Opening,
  OpeningType,
  Point,
  RoomZone,
  Wall,
} from '../types';
import { uid } from '../db';
import {
  cleanAndAlignWalls,
  computeInterWallDimensions,
  detectRoomsFromWalls,
  formatAreaM2,
  formatCm,
  formatMeters,
  getCleanWallRenderPoints,
  getFacingWallsForWall,
  getOpeningCornerDistancesCm,
  polygonAreaM2,
  polygonBounds,
  polygonCentroid,
  polygonPerimeterM,
  projectPointOnWall,
  roundCm,
  shiftWallInFloor,
  snapPointToWalls,
  snapValue,
  updateDistanceBetweenWallsCascade,
  updateOpeningCornerDistanceCm,
  updateWallLengthInFloor,
  wallLengthCm,
  type InterWallDimension,
} from '../utils/geometry';
import {
  ARCH_SHAPE_LABELS,
  FLOOR_MATERIAL_LABELS,
  FURNITURE_CATALOG,
  OPENING_TYPE_LABELS,
} from '../data/furnitureCatalog';
import { FloorTutorialModal } from './FloorTutorialModal';
import { AIPlanGeneratorModal } from './AIPlanGeneratorModal';
import { WebCatalogModal } from './WebCatalogModal';
import { useEscapeKey } from '../utils/useEscapeKey';
import type { ExtractedWebProduct, GeneratedFloorPlanData } from '../utils/aiService';

interface FloorPlanEditorProps {
  floor: Floor;
  allFloors: Floor[];
  onUpdateFloor: (updated: Floor) => void;
  onSelectFloor: (floorId: string) => void;
  onAddFloor: (name: string, isExterior: boolean) => void;
  onRenameFloor: (floorId: string, newName: string) => void;
  onDeleteFloor: (floorId: string) => void;
  onReorderFloor: (floorId: string, direction: 'left' | 'right') => void;
  onOpenAISettings?: () => void;
  onAddShoppingItemFromWeb?: (product: ExtractedWebProduct, floorName: string) => void;
}

type ToolMode =
  | 'select'
  | 'pan'
  | 'wall-ext'
  | 'wall-int'
  | 'room'
  | 'room-poly'
  | 'door'
  | 'window'
  | 'sliding-door'
  | 'arch-passage';

type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'furniture'; id: string }
  | null;

type InlineDimensionEdit =
  | {
      kind: 'wall-length';
      wallId: string;
      valueCm: number;
      worldX: number;
      worldY: number;
      label: string;
    }
  | {
      kind: 'inter-wall';
      pairKey?: string;
      movingWallId: string;
      referenceWallId: string;
      valueCm: number;
      worldX: number;
      worldY: number;
      label: string;
    }
  | null;

const PX_PER_CM = 0.5; // 100 cm (1 m) = 50 px at zoom 1

export const FloorPlanEditor: React.FC<FloorPlanEditorProps> = ({
  floor,
  allFloors,
  onUpdateFloor,
  onSelectFloor,
  onAddFloor,
  onRenameFloor,
  onDeleteFloor,
  onReorderFloor,
  onOpenAISettings,
  onAddShoppingItemFromWeb,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const [stageSize, setStageSize] = useState({ width: 900, height: 600 });
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 140, y: 60 });

  const [tool, setTool] = useState<ToolMode>('select');
  const [selection, setSelection] = useState<Selection>(null);

  // Wall creation settings
  const [extWallMode, setExtWallMode] = useState<'segment' | 'rect'>('segment');
  const [extWallThicknessCm, setExtWallThicknessCm] = useState<number>(20);
  const [intWallThicknessCm, setIntWallThicknessCm] = useState<number>(10);
  const [freeAngleWall, setFreeAngleWall] = useState<boolean>(false);

  // Dimension display & spacing cascade settings
  const [showInterWallDims, setShowInterWallDims] = useState<boolean>(true);
  const [cascadeSpacingMode, setCascadeSpacingMode] = useState<boolean>(true);
  const [unitMode, setUnitMode] = useState<'cm' | 'auto'>('cm');
  const [inlineEdit, setInlineEdit] = useState<InlineDimensionEdit>(null);

  // Layer controls
  const [showStructure, setShowStructure] = useState(true);
  const [lockStructure, setLockStructure] = useState(false);
  const [showFurniture, setShowFurniture] = useState(true);
  const [lockFurniture, setLockFurniture] = useState(false);
  const [showGhostBelow, setShowGhostBelow] = useState(false);

  // Furniture drawer
  const [showFurnitureDrawer, setShowFurnitureDrawer] = useState(false);
  const [showCompassPanel, setShowCompassPanel] = useState(false);
  const [furnitureCategory, setFurnitureCategory] = useState<string>('Salon');

  // New floor modal
  const [showNewFloorModal, setShowNewFloorModal] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');
  const [newFloorExterior, setNewFloorExterior] = useState(false);

  // Drawing state
  const [wallStart, setWallStart] = useState<Point | null>(null);
  const [wallPreview, setWallPreview] = useState<Point | null>(null);
  const [roomStart, setRoomStart] = useState<Point | null>(null);
  const [roomPreview, setRoomPreview] = useState<Point | null>(null);
  const [polyPoints, setPolyPoints] = useState<Point[]>([]);
  const [polyPreview, setPolyPreview] = useState<Point | null>(null);

  // Undo & Redo history
  const [history, setHistory] = useState<Floor[]>([]);
  const [redoHistory, setRedoHistory] = useState<Floor[]>([]);

  // Modals & Feedback
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [showAIPlanModal, setShowAIPlanModal] = useState(false);
  const [showWebCatalogModal, setShowWebCatalogModal] = useState(false);
  const [showManageFloorModal, setShowManageFloorModal] = useState(false);
  const [manageFloorName, setManageFloorName] = useState('');
  const [confirmDeleteFloor, setConfirmDeleteFloor] = useState(false);
  const [showLockedToast, setShowLockedToast] = useState<string | null>(null);

  useEscapeKey(showManageFloorModal, () => setShowManageFloorModal(false));
  useEscapeKey(showNewFloorModal, () => setShowNewFloorModal(false));

  // Pinch zoom & two-finger pan state
  const lastTouchDist = useRef<number | null>(null);
  const lastTouchCenter = useRef<Point | null>(null);
  const isTwoFingerGesture = useRef(false);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      setStageSize({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    };
    updateSize();
    const obs = new ResizeObserver(updateSize);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Reset drawing state when switching floor
  useEffect(() => {
    setSelection(null);
    setInlineEdit(null);
    setWallStart(null);
    setWallPreview(null);
    setRoomStart(null);
    setRoomPreview(null);
    setPolyPoints([]);
    setPolyPreview(null);
    setHistory([]);
    setRedoHistory([]);
  }, [floor.id]);

  const commitFloor = (next: Floor) => {
    setHistory((prev) => [...prev.slice(-19), floor]);
    setRedoHistory([]);
    onUpdateFloor(next);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoHistory((r) => [...r, floor]);
    setHistory((h) => h.slice(0, -1));
    onUpdateFloor(prev);
    setSelection(null);
    setInlineEdit(null);
  };

  const handleRedo = () => {
    if (redoHistory.length === 0) return;
    const next = redoHistory[redoHistory.length - 1];
    setRedoHistory((r) => r.slice(0, -1));
    setHistory((h) => [...h, floor]);
    onUpdateFloor(next);
    setSelection(null);
    setInlineEdit(null);
  };

  // Floor below for ghosting
  const floorBelow = useMemo(() => {
    const sorted = [...allFloors].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === floor.id);
    return idx > 0 ? sorted[idx - 1] : null;
  }, [allFloors, floor.id]);

  // Computed metrics for the floor
  const metrics = useMemo(() => {
    const totalFloorAreaM2 = floor.rooms.reduce((acc, r) => acc + polygonAreaM2(r.points), 0);
    const totalWallLengthM = floor.walls.reduce((acc, w) => acc + wallLengthCm(w) / 100, 0);
    const totalWallSurfaceM2 = floor.walls.reduce((acc, w) => {
      const lenM = wallLengthCm(w) / 100;
      const hM = (w.heightCm ?? floor.defaultWallHeightCm) / 100;
      return acc + lenM * hM;
    }, 0);
    return { totalFloorAreaM2, totalWallLengthM, totalWallSurfaceM2 };
  }, [floor]);

  // Plan outer bounding box (for placing outer wall labels outside the building)
  const planBounds = useMemo(() => {
    if (floor.walls.length === 0) {
      return { minX: 0, maxX: 1000, minY: 0, maxY: 800, centerX: 500, centerY: 400 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const w of floor.walls) {
      minX = Math.min(minX, w.x1, w.x2);
      maxX = Math.max(maxX, w.x1, w.x2);
      minY = Math.min(minY, w.y1, w.y2);
      maxY = Math.max(maxY, w.y1, w.y2);
    }
    return {
      minX,
      maxX,
      minY,
      maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }, [floor.walls]);

  // Selected entity data for inspector panel
  const selectedWall = selection?.kind === 'wall' ? floor.walls.find((w) => w.id === selection.id) : null;
  const selectedRoom = selection?.kind === 'room' ? floor.rooms.find((r) => r.id === selection.id) : null;
  const selectedFurniture = selection?.kind === 'furniture' ? floor.furniture.find((f) => f.id === selection.id) : null;
  const selectedOpening = selection?.kind === 'opening' ? floor.openings.find((o) => o.id === selection.id) : null;

  // Facing walls for the currently selected wall
  const selectedWallFacings = useMemo(() => {
    if (!selectedWall) return [];
    return getFacingWallsForWall(selectedWall, floor.walls);
  }, [selectedWall, floor.walls]);

  // All inter-wall dimensions for canvas rendering
  const allInterWallDimensions = useMemo(() => {
    return computeInterWallDimensions(floor.walls);
  }, [floor.walls]);

  // Live preview inter-wall distances while drawing a wall
  const livePreviewFacings = useMemo(() => {
    if (!wallStart || !wallPreview) return [];
    const len = Math.hypot(wallPreview.x - wallStart.x, wallPreview.y - wallStart.y);
    if (len < 10) return [];
    const tempWall: Wall = {
      id: '__preview__',
      x1: wallStart.x,
      y1: wallStart.y,
      x2: wallPreview.x,
      y2: wallPreview.y,
      thicknessCm: tool === 'wall-int' ? intWallThicknessCm : extWallThicknessCm,
      wallType: tool === 'wall-int' ? 'interior' : 'exterior',
    };
    return getFacingWallsForWall(tempWall, floor.walls);
  }, [wallStart, wallPreview, floor.walls, tool, intWallThicknessCm, extWallThicknessCm]);

  // Convert screen pointer to cm coordinates
  const getPointerCm = (): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    const xCm = (pointer.x - pan.x) / (zoom * PX_PER_CM);
    const yCm = (pointer.y - pan.y) / (zoom * PX_PER_CM);
    return { x: xCm, y: yCm };
  };

  const handleStagePointerDown = (e: Konva.KonvaEventObject<PointerEvent | MouseEvent | TouchEvent>) => {
    if (isTwoFingerGesture.current) return;
    if ('touches' in e.evt && e.evt.touches.length >= 2) return;
    if (tool === 'pan') return;

    const pt = getPointerCm();
    if (!pt) return;

    const shiftPressed = 'shiftKey' in e.evt && Boolean(e.evt.shiftKey);

    // If clicking empty stage in select mode, clear selection and inline edit
    if (tool === 'select') {
      if (e.target === e.target.getStage()) {
        setSelection(null);
        setInlineEdit(null);
      }
      return;
    }

    if (
      lockStructure &&
      (tool === 'wall-ext' ||
        tool === 'wall-int' ||
        tool === 'room' ||
        tool === 'room-poly' ||
        tool === 'door' ||
        tool === 'window' ||
        tool === 'sliding-door')
    ) {
      return;
    }

    // Exterior Wall Rectangle mode (4 outer walls in 2 clicks)
    if (tool === 'wall-ext' && extWallMode === 'rect') {
      const snapped = snapPointToWalls(pt.x, pt.y, floor.walls, 18, 1);
      if (!wallStart) {
        setWallStart(snapped);
        setWallPreview(snapped);
      } else {
        const xMin = roundCm(Math.min(wallStart.x, snapped.x), 2);
        const xMax = roundCm(Math.max(wallStart.x, snapped.x), 2);
        const yMin = roundCm(Math.min(wallStart.y, snapped.y), 2);
        const yMax = roundCm(Math.max(wallStart.y, snapped.y), 2);
        if (xMax - xMin >= 10 && yMax - yMin >= 10) {
          const thick = extWallThicknessCm;
          const wTop: Wall = { id: uid('w'), x1: xMin, y1: yMin, x2: xMax, y2: yMin, thicknessCm: thick, wallType: 'exterior' };
          const wRight: Wall = { id: uid('w'), x1: xMax, y1: yMin, x2: xMax, y2: yMax, thicknessCm: thick, wallType: 'exterior' };
          const wBottom: Wall = { id: uid('w'), x1: xMax, y1: yMax, x2: xMin, y2: yMax, thicknessCm: thick, wallType: 'exterior' };
          const wLeft: Wall = { id: uid('w'), x1: xMin, y1: yMax, x2: xMin, y2: yMin, thicknessCm: thick, wallType: 'exterior' };
          commitFloor({
            ...floor,
            walls: [...floor.walls, wTop, wRight, wBottom, wLeft],
          });
          setSelection({ kind: 'wall', id: wTop.id });
        }
        setWallStart(null);
        setWallPreview(null);
      }
      return;
    }

    // Wall drawing (Exterior segment OR Unrestricted Interior wall)
    if (tool === 'wall-ext' || tool === 'wall-int') {
      const isInterior = tool === 'wall-int';
      const snapped = snapPointToWalls(
        pt.x,
        pt.y,
        floor.walls,
        isInterior ? 16 : 20,
        isInterior ? 0.5 : 1,
        {
          startPoint: wallStart,
          freeAngle: freeAngleWall || shiftPressed,
        }
      );
      if (!wallStart) {
        setWallStart(snapped);
        setWallPreview(snapped);
      } else {
        // Unrestricted minimum length (2 cm) so even short returns of 12,5 cm can be drawn freely!
        if (Math.hypot(snapped.x - wallStart.x, snapped.y - wallStart.y) >= 2) {
          const newWall: Wall = {
            id: uid('w'),
            x1: roundCm(wallStart.x, 2),
            y1: roundCm(wallStart.y, 2),
            x2: roundCm(snapped.x, 2),
            y2: roundCm(snapped.y, 2),
            thicknessCm: isInterior ? intWallThicknessCm : extWallThicknessCm,
            wallType: isInterior ? 'interior' : 'exterior',
          };
          commitFloor({ ...floor, walls: [...floor.walls, newWall] });
          setSelection({ kind: 'wall', id: newWall.id });
        }
        setWallStart(null);
        setWallPreview(null);
      }
      return;
    }

    if (tool === 'room') {
      const snapped = snapPointToWalls(pt.x, pt.y, floor.walls, 18, 1);
      if (!roomStart) {
        setRoomStart(snapped);
        setRoomPreview(snapped);
      } else {
        const xMin = roundCm(Math.min(roomStart.x, snapped.x), 2);
        const xMax = roundCm(Math.max(roomStart.x, snapped.x), 2);
        const yMin = roundCm(Math.min(roomStart.y, snapped.y), 2);
        const yMax = roundCm(Math.max(roomStart.y, snapped.y), 2);
        if (xMax - xMin >= 20 && yMax - yMin >= 20) {
          const newRoom: RoomZone = {
            id: uid('rm'),
            name: floor.isExterior ? 'Terrasse / Zone' : `Pièce ${floor.rooms.length + 1}`,
            points: [
              { x: xMin, y: yMin },
              { x: xMax, y: yMin },
              { x: xMax, y: yMax },
              { x: xMin, y: yMax },
            ],
            floorType: floor.isExterior ? 'deck' : 'tile',
          };
          commitFloor({ ...floor, rooms: [...floor.rooms, newRoom] });
          setSelection({ kind: 'room', id: newRoom.id });
        }
        setRoomStart(null);
        setRoomPreview(null);
      }
      return;
    }

    if (tool === 'room-poly') {
      const snapped = snapPointToWalls(pt.x, pt.y, floor.walls, 20, 1);
      if (polyPoints.length >= 3) {
        const dist = Math.hypot(snapped.x - polyPoints[0].x, snapped.y - polyPoints[0].y);
        if (dist <= 25) {
          finishPolyRoom();
          return;
        }
      }
      setPolyPoints((prev) => [...prev, snapped]);
      return;
    }

    if (tool === 'door' || tool === 'window' || tool === 'sliding-door' || tool === 'arch-passage') {
      let closestWall: Wall | null = null;
      let bestDist = 45;
      let bestRatio = 0.5;
      for (const w of floor.walls) {
        const proj = projectPointOnWall(pt.x, pt.y, w);
        if (proj.dist < bestDist) {
          bestDist = proj.dist;
          closestWall = w;
          bestRatio = proj.ratio;
        }
      }
      if (closestWall) {
        const openingType: OpeningType = tool;
        const widthCm =
          openingType === 'sliding-door'
            ? 180
            : openingType === 'arch-passage'
            ? 140
            : openingType === 'window'
            ? 120
            : 90;
        const heightCm = openingType === 'window' ? 120 : 215;
        const newOpening: Opening = {
          id: uid('op'),
          wallId: closestWall.id,
          type: openingType,
          offsetRatio: bestRatio,
          widthCm,
          heightCm,
          flip: false,
          hinge: 'left',
          archShape: openingType === 'arch-passage' ? 'half-circle' : 'flat',
          hasFrame: openingType !== 'arch-passage',
        };
        commitFloor({ ...floor, openings: [...floor.openings, newOpening] });
        setSelection({ kind: 'opening', id: newOpening.id });
      }
    }
  };

  const handleStagePointerMove = (e: Konva.KonvaEventObject<PointerEvent | MouseEvent | TouchEvent>) => {
    if (isTwoFingerGesture.current) return;
    const pt = getPointerCm();
    if (!pt) return;
    const shiftPressed = 'shiftKey' in e.evt && Boolean(e.evt.shiftKey);

    if ((tool === 'wall-ext' || tool === 'wall-int') && wallStart) {
      const isInterior = tool === 'wall-int';
      if (tool === 'wall-ext' && extWallMode === 'rect') {
        setWallPreview(snapPointToWalls(pt.x, pt.y, floor.walls, 18, 1));
      } else {
        setWallPreview(
          snapPointToWalls(pt.x, pt.y, floor.walls, isInterior ? 16 : 20, isInterior ? 0.5 : 1, {
            startPoint: wallStart,
            freeAngle: freeAngleWall || shiftPressed,
          })
        );
      }
    }
    if (tool === 'room' && roomStart) {
      setRoomPreview(snapPointToWalls(pt.x, pt.y, floor.walls, 18, 1));
    }
    if (tool === 'room-poly' && polyPoints.length > 0) {
      setPolyPreview(snapPointToWalls(pt.x, pt.y, floor.walls, 20, 1));
    }
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.08;
    const newScale = e.evt.deltaY < 0 ? Math.min(3.0, oldScale * scaleBy) : Math.max(0.25, oldScale / scaleBy);
    const mousePointTo = {
      x: (pointer.x - pan.x) / oldScale,
      y: (pointer.y - pan.y) / oldScale,
    };
    setZoom(newScale);
    setPan({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const getTouchMidAndDist = (touches: TouchList): { center: Point; dist: number } | null => {
    const stage = stageRef.current;
    if (!stage || touches.length < 2) return null;
    const rect = stage.container().getBoundingClientRect();
    const t0 = touches[0];
    const t1 = touches[1];
    const center = {
      x: (t0.clientX + t1.clientX) / 2 - rect.left,
      y: (t0.clientY + t1.clientY) / 2 - rect.top,
    };
    const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    return { center, dist };
  };

  const handleTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length >= 2) {
      e.evt.preventDefault();
      isTwoFingerGesture.current = true;
      if (Konva.DD.node) {
        Konva.DD.node.stopDrag();
      }
      const info = getTouchMidAndDist(touches);
      if (info) {
        lastTouchDist.current = info.dist;
        lastTouchCenter.current = info.center;
      }
    }
  };

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length === 2) {
      e.evt.preventDefault();
      isTwoFingerGesture.current = true;
      const info = getTouchMidAndDist(touches);
      if (!info) return;

      if (lastTouchDist.current !== null && lastTouchCenter.current !== null) {
        const oldScale = zoomRef.current;
        const oldPan = panRef.current;
        const scaleFactor = lastTouchDist.current > 0 ? info.dist / lastTouchDist.current : 1;
        const newScale = Math.max(0.25, Math.min(3.0, oldScale * scaleFactor));

        const worldPoint = {
          x: (lastTouchCenter.current.x - oldPan.x) / oldScale,
          y: (lastTouchCenter.current.y - oldPan.y) / oldScale,
        };
        const newPan = {
          x: info.center.x - worldPoint.x * newScale,
          y: info.center.y - worldPoint.y * newScale,
        };

        zoomRef.current = newScale;
        panRef.current = newPan;
        setZoom(newScale);
        setPan(newPan);
      }
      lastTouchDist.current = info.dist;
      lastTouchCenter.current = info.center;
    }
  };

  const handleTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length < 2) {
      lastTouchDist.current = null;
      lastTouchCenter.current = null;
    }
    if (touches.length === 0) {
      isTwoFingerGesture.current = false;
    }
  };

  const addFurnitureFromCatalog = (entry: (typeof FURNITURE_CATALOG)[number]) => {
    const centerXCm = (stageSize.width / 2 - pan.x) / (zoom * PX_PER_CM);
    const centerYCm = (stageSize.height / 2 - pan.y) / (zoom * PX_PER_CM);
    const item: FurnitureItem = {
      id: uid('f'),
      type: entry.type,
      label: entry.label,
      x: snapValue(centerXCm, 1),
      y: snapValue(centerYCm, 1),
      widthCm: entry.widthCm,
      depthCm: entry.depthCm,
      rotation: 0,
      color: entry.color,
    };
    commitFloor({ ...floor, furniture: [...floor.furniture, item] });
    setSelection({ kind: 'furniture', id: item.id });
    setShowFurniture(true);
    setLockFurniture(false);
    setTool('select');
    setShowFurnitureDrawer(false);
  };

  const addWebProductToPlan = (product: ExtractedWebProduct, alsoAddToShopping: boolean) => {
    const centerXCm = (stageSize.width / 2 - pan.x) / (zoom * PX_PER_CM);
    const centerYCm = (stageSize.height / 2 - pan.y) / (zoom * PX_PER_CM);
    const item: FurnitureItem = {
      id: uid('f'),
      type: product.type,
      label: product.label,
      x: snapValue(centerXCm, 1),
      y: snapValue(centerYCm, 1),
      widthCm: product.widthCm,
      depthCm: product.depthCm,
      heightCm: product.heightCm,
      rotation: 0,
      color: product.color,
      price: product.price,
      store: product.store,
      productUrl: product.productUrl,
      imageUrl: product.imageUrl,
      cutoutDataUrl: product.cutoutDataUrl,
      variant: product.variant,
      materialType: product.materialType,
      renderMode3D: product.renderMode3D,
      glbDataUrl: product.glbDataUrl,
    };
    commitFloor({ ...floor, furniture: [...floor.furniture, item] });
    setSelection({ kind: 'furniture', id: item.id });
    setShowFurniture(true);
    setLockFurniture(false);
    setTool('select');
    if (alsoAddToShopping && onAddShoppingItemFromWeb) {
      onAddShoppingItemFromWeb(product, floor.name);
    }
  };

  const applyGeneratedAIPlan = (data: GeneratedFloorPlanData, mode: 'replace' | 'append') => {
    const nextFloor: Floor =
      mode === 'replace'
        ? {
            ...floor,
            walls: data.walls,
            openings: data.openings,
            rooms: data.rooms,
            furniture: data.furniture,
          }
        : {
            ...floor,
            walls: [...floor.walls, ...data.walls],
            openings: [...floor.openings, ...data.openings],
            rooms: [...floor.rooms, ...data.rooms],
            furniture: [...floor.furniture, ...data.furniture],
          };
    commitFloor(cleanAndAlignWalls(nextFloor));
    setSelection(null);
    setTool('select');
  };

  const finishPolyRoom = () => {
    if (polyPoints.length < 3) return;
    const newRoom: RoomZone = {
      id: uid('rm'),
      name: floor.isExterior ? 'Terrasse / Zone' : `Pièce ${floor.rooms.length + 1}`,
      points: [...polyPoints],
      floorType: floor.isExterior ? 'deck' : 'tile',
    };
    commitFloor({ ...floor, rooms: [...floor.rooms, newRoom] });
    setSelection({ kind: 'room', id: newRoom.id });
    setPolyPoints([]);
    setPolyPreview(null);
    setTool('select');
  };

  const handleUpdateWallLength = (wallId: string, newLenCm: number) => {
    if (lockStructure || newLenCm < 0.5) return;
    commitFloor(updateWallLengthInFloor(floor, wallId, roundCm(newLenCm, 2), 'start'));
  };

  const handleUpdateInterWallDistance = (
    movingWallId: string,
    referenceWallId: string,
    newClearDistanceCm: number,
    lockDim?: boolean
  ): Floor => {
    if (lockStructure || newClearDistanceCm < 0.1) return floor;
    const next = updateDistanceBetweenWallsCascade(
      floor,
      movingWallId,
      referenceWallId,
      roundCm(newClearDistanceCm, 2),
      { cascade: cascadeSpacingMode, lockDimension: lockDim }
    );
    commitFloor(next);
    return next;
  };

  const handleToggleLockDimension = (pairKey?: string) => {
    if (!pairKey || lockStructure) return;
    const current = floor.lockedDimensionIds ?? [];
    const nextLocked = current.includes(pairKey)
      ? current.filter((k) => k !== pairKey)
      : [...current, pairKey];
    commitFloor({ ...floor, lockedDimensionIds: nextLocked });
  };

  const handleDetectRooms = () => {
    if (lockStructure) return;
    const next = detectRoomsFromWalls(floor);
    commitFloor(next);
  };

  const handleCleanWalls = () => {
    if (lockStructure) return;
    commitFloor(cleanAndAlignWalls(floor));
  };

  const isSelectionLocked = useMemo(() => {
    if (!selection) return false;
    if (selection.kind === 'wall' || selection.kind === 'opening' || selection.kind === 'room') {
      return lockStructure;
    }
    if (selection.kind === 'furniture') {
      return lockFurniture;
    }
    return false;
  }, [selection, lockStructure, lockFurniture]);

  const deleteSelected = () => {
    if (!selection) return;
    if (isSelectionLocked) {
      setShowLockedToast('Action impossible : cet élément est verrouillé par le cadenas !');
      setTimeout(() => setShowLockedToast(null), 3000);
      return;
    }
    if (selection.kind === 'wall') {
      commitFloor({
        ...floor,
        walls: floor.walls.filter((w) => w.id !== selection.id),
        openings: floor.openings.filter((o) => o.wallId !== selection.id),
      });
    } else if (selection.kind === 'opening') {
      commitFloor({ ...floor, openings: floor.openings.filter((o) => o.id !== selection.id) });
    } else if (selection.kind === 'room') {
      commitFloor({ ...floor, rooms: floor.rooms.filter((r) => r.id !== selection.id) });
    } else if (selection.kind === 'furniture') {
      commitFloor({ ...floor, furniture: floor.furniture.filter((f) => f.id !== selection.id) });
    }
    setSelection(null);
    setInlineEdit(null);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Del' || e.key === 'Backspace') {
        if (selection) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (
        ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
        ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && e.shiftKey)
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.key === 'Escape') {
        setWallStart(null);
        setWallPreview(null);
        setRoomStart(null);
        setRoomPreview(null);
        setPolyPoints([]);
        setPolyPreview(null);
        setSelection(null);
        setInlineEdit(null);
        setTool('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, history, redoHistory, floor, isSelectionLocked]);

  // Decide which wall moves when clicking an inter-wall dimension badge on canvas
  const pickMovingAndReferenceWall = (dim: InterWallDimension): { movingWallId: string; referenceWallId: string } => {
    if (selectedWall) {
      if (selectedWall.id === dim.wallAId) {
        return { movingWallId: dim.wallAId, referenceWallId: dim.wallBId };
      }
      if (selectedWall.id === dim.wallBId) {
        return { movingWallId: dim.wallBId, referenceWallId: dim.wallAId };
      }
    }
    const wA = floor.walls.find((w) => w.id === dim.wallAId);
    const wB = floor.walls.find((w) => w.id === dim.wallBId);
    if (wA && wB) {
      // Prefer moving interior / thinner wall over exterior perimeter wall
      const aIsInt = wA.wallType === 'interior' || wA.thicknessCm < wB.thicknessCm;
      const bIsInt = wB.wallType === 'interior' || wB.thicknessCm < wA.thicknessCm;
      if (bIsInt && !aIsInt) {
        return { movingWallId: wB.id, referenceWallId: wA.id };
      }
      if (aIsInt && !bIsInt) {
        return { movingWallId: wA.id, referenceWallId: wB.id };
      }
    }
    return { movingWallId: dim.wallBId, referenceWallId: dim.wallAId };
  };

  // Pre-compute non-overlapping label positions in world pixel coordinates
  const labelLayout = useMemo(() => {
    type Box = { x: number; y: number; w: number; h: number };
    const occupied: Box[] = [];

    const overlaps = (a: Box, b: Box, pad = 3) => {
      return !(
        a.x + a.w + pad < b.x ||
        b.x + b.w + pad < a.x ||
        a.y + a.h + pad < b.y ||
        b.y + b.h + pad < a.y
      );
    };

    // 1. Room labels (constrained inside each room's inner bounding box!)
    const roomLabels = new Map<
      string,
      {
        cxPx: number;
        cyPx: number;
        boxW: number;
        boxH: number;
        fontSize: number;
        showWallArea: boolean;
        visible: boolean;
      }
    >();

    for (const room of floor.rooms) {
      const bounds = polygonBounds(room.points);
      const centroid = polygonCentroid(room.points);
      const cxPx = centroid.x * PX_PER_CM;
      const cyPx = centroid.y * PX_PER_CM;

      // Shrink by ~22 cm for wall thicknesses so text never spills over walls
      const innerWPx = Math.max(24, (bounds.width - 24) * PX_PER_CM);
      const innerHPx = Math.max(18, (bounds.height - 24) * PX_PER_CM);
      const isRoomSelected = selection?.kind === 'room' && selection.id === room.id;

      if (innerWPx < 26 || innerHPx < 18) {
        roomLabels.set(room.id, {
          cxPx,
          cyPx,
          boxW: innerWPx,
          boxH: innerHPx,
          fontSize: 8,
          showWallArea: false,
          visible: isRoomSelected,
        });
        continue;
      }

      const fontSize = innerWPx < 56 ? 8.5 : innerWPx < 85 ? 10 : 11.5;
      const boxW = Math.min(126, Math.max(36, innerWPx - 6));
      const showWallArea = isRoomSelected || (innerWPx >= 88 && innerHPx >= 68);
      const estNameLines = Math.ceil((room.name.length * (fontSize * 0.58)) / Math.max(28, boxW - 8));
      const lineCount = Math.min(3, Math.max(1, estNameLines)) + 1 + (showWallArea ? 1 : 0);
      const boxH = Math.min(innerHPx - 4, lineCount * (fontSize + 3) + 6);

      const box: Box = {
        x: cxPx - boxW / 2,
        y: cyPx - boxH / 2,
        w: boxW,
        h: boxH,
      };
      occupied.push(box);

      roomLabels.set(room.id, {
        cxPx,
        cyPx,
        boxW,
        boxH,
        fontSize,
        showWallArea,
        visible: true,
      });
    }

    // 2. Wall length badges (smart offset: outside perimeter for outer walls, on-axis for interior walls)
    const wallBadges = new Map<
      string,
      {
        xPx: number;
        yPx: number;
        rotation: number;
        badgeW: number;
        badgeH: number;
        text: string;
        visible: boolean;
      }
    >();

    // Deduplicate collinear overlapping wall labels
    const seenWallLabelSpots: Point[] = [];

    for (const w of floor.walls) {
      const len = wallLengthCm(w);
      const isWallSelected = selection?.kind === 'wall' && selection.id === w.id;
      if (len < 12 && !isWallSelected) {
        wallBadges.set(w.id, { xPx: 0, yPx: 0, rotation: 0, badgeW: 0, badgeH: 0, text: '', visible: false });
        continue;
      }

      const midXCm = (w.x1 + w.x2) / 2;
      const midYCm = (w.y1 + w.y2) / 2;

      // Skip if another wall already placed a label at this exact spot (unless selected)
      const dupSpot = seenWallLabelSpots.some((p) => Math.hypot(p.x - midXCm, p.y - midYCm) < 18);
      if (dupSpot && !isWallSelected) {
        wallBadges.set(w.id, { xPx: 0, yPx: 0, rotation: 0, badgeW: 0, badgeH: 0, text: '', visible: false });
        continue;
      }
      seenWallLabelSpots.push({ x: midXCm, y: midYCm });

      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const displayAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
      const rad = (displayAngle * Math.PI) / 180;
      const nx = -Math.sin(rad);
      const ny = Math.cos(rad);

      const text = formatMeters(len, unitMode);
      const badgeW = Math.max(42, text.length * 5.8 + 10);
      const badgeH = 14;
      const wallThickPx = Math.max(4, w.thicknessCm * PX_PER_CM);

      // Determine if this wall is on the outer perimeter of the floor plan
      const isTopPerimeter = Math.abs(midYCm - planBounds.minY) < 25 && Math.abs(dy) < 15;
      const isBottomPerimeter = Math.abs(midYCm - planBounds.maxY) < 25 && Math.abs(dy) < 15;
      const isLeftPerimeter = Math.abs(midXCm - planBounds.minX) < 25 && Math.abs(dx) < 15;
      const isRightPerimeter = Math.abs(midXCm - planBounds.maxX) < 25 && Math.abs(dx) < 15;
      const isOuterPerimeter = isTopPerimeter || isBottomPerimeter || isLeftPerimeter || isRightPerimeter;

      // Candidate normal offsets in px:
      // - Outer perimeter walls: prefer outside the building so they never clutter rooms!
      // - Interior walls: prefer 0 (directly centered on the wall axis!) or slight offset away from occupied room text
      const outDirSign =
        (midXCm - planBounds.centerX) * nx + (midYCm - planBounds.centerY) * ny >= 0 ? 1 : -1;
      const outerOffsetPx = outDirSign * (wallThickPx / 2 + 11);

      const candidateOffsets = isOuterPerimeter
        ? [outerOffsetPx, 0, -outerOffsetPx]
        : [0, wallThickPx / 2 + 10, -(wallThickPx / 2 + 10)];

      let chosenXPx = midXCm * PX_PER_CM;
      let chosenYPx = midYCm * PX_PER_CM;
      let foundNonOverlapping = false;

      for (const off of candidateOffsets) {
        const cx = midXCm * PX_PER_CM + nx * off;
        const cy = midYCm * PX_PER_CM + ny * off;
        const isVert = Math.abs(Math.sin(rad)) > 0.7;
        const aabb: Box = {
          x: cx - (isVert ? badgeH : badgeW) / 2,
          y: cy - (isVert ? badgeW : badgeH) / 2,
          w: isVert ? badgeH : badgeW,
          h: isVert ? badgeW : badgeH,
        };
        if (!occupied.some((b) => overlaps(aabb, b, 2))) {
          chosenXPx = cx;
          chosenYPx = cy;
          occupied.push(aabb);
          foundNonOverlapping = true;
          break;
        }
      }

      if (!foundNonOverlapping && isWallSelected) {
        chosenXPx = midXCm * PX_PER_CM + nx * candidateOffsets[0];
        chosenYPx = midYCm * PX_PER_CM + ny * candidateOffsets[0];
        foundNonOverlapping = true;
      }

      wallBadges.set(w.id, {
        xPx: chosenXPx,
        yPx: chosenYPx,
        rotation: displayAngle,
        badgeW,
        badgeH,
        text,
        visible: foundNonOverlapping || isWallSelected,
      });
    }

    // 3. Inter-wall dimension lines: slide along wall tangent so badge never overlaps room names or wall badges!
    const interWallPlacements = new Map<
      string,
      {
        x1Px: number;
        y1Px: number;
        x2Px: number;
        y2Px: number;
        midXPx: number;
        midYPx: number;
        visible: boolean;
      }
    >();

    for (const dim of allInterWallDimensions) {
      const isRelatedToSelected =
        Boolean(selectedWall) && (dim.wallAId === selectedWall?.id || dim.wallBId === selectedWall?.id);
      const text = formatMeters(dim.clearDistanceCm, unitMode);
      const pillW = Math.max(46, text.length * 5.8 + 12);
      const pillH = 15;
      const displayAngle = dim.angleDeg > 90 || dim.angleDeg < -90 ? dim.angleDeg + 180 : dim.angleDeg;
      const rad = (displayAngle * Math.PI) / 180;
      const isVert = Math.abs(Math.sin(rad)) > 0.7;

      const maxSlideCm = Math.max(0, dim.overlapLenCm * 0.34);
      const candidateRatios = [0, -0.26, 0.26, -0.36, 0.36, -0.15, 0.15];

      let chosenShiftCm = 0;
      let foundSpot = false;

      for (const r of candidateRatios) {
        const shiftCm = r * dim.overlapLenCm;
        if (Math.abs(shiftCm) > maxSlideCm && r !== 0) continue;
        const cxPx = (dim.midX + dim.tx * shiftCm) * PX_PER_CM;
        const cyPx = (dim.midY + dim.ty * shiftCm) * PX_PER_CM;
        const aabb: Box = {
          x: cxPx - (isVert ? pillH : pillW) / 2,
          y: cyPx - (isVert ? pillW : pillH) / 2,
          w: isVert ? pillH : pillW,
          h: isVert ? pillW : pillH,
        };
        if (!occupied.some((b) => overlaps(aabb, b, 3))) {
          chosenShiftCm = shiftCm;
          occupied.push(aabb);
          foundSpot = true;
          break;
        }
      }

      if (!foundSpot && isRelatedToSelected) {
        chosenShiftCm = -maxSlideCm * 0.7;
        foundSpot = true;
      }

      const sxPx = dim.tx * chosenShiftCm * PX_PER_CM;
      const syPx = dim.ty * chosenShiftCm * PX_PER_CM;

      interWallPlacements.set(dim.id, {
        x1Px: dim.x1 * PX_PER_CM + sxPx,
        y1Px: dim.y1 * PX_PER_CM + syPx,
        x2Px: dim.x2 * PX_PER_CM + sxPx,
        y2Px: dim.y2 * PX_PER_CM + syPx,
        midXPx: dim.midX * PX_PER_CM + sxPx,
        midYPx: dim.midY * PX_PER_CM + syPx,
        visible: foundSpot || isRelatedToSelected,
      });
    }

    return { roomLabels, wallBadges, interWallPlacements };
  }, [floor.rooms, floor.walls, selection, unitMode, planBounds, allInterWallDimensions, selectedWall]);

  // Render crisp architectural furniture shapes in Konva
  const renderFurnitureShape = (item: FurnitureItem, isSelected: boolean) => {
    const w = item.widthCm * PX_PER_CM;
    const h = item.depthCm * PX_PER_CM;
    const stroke = isSelected ? '#2563eb' : '#334155';
    const strokeWidth = isSelected ? 2.5 : 1.2;

    return (
      <Group
        key={item.id}
        x={item.x * PX_PER_CM}
        y={item.y * PX_PER_CM}
        rotation={item.rotation}
        draggable={tool === 'select' && !lockFurniture}
        onClick={(e) => {
          e.cancelBubble = true;
          if (tool === 'select') {
            setSelection({ kind: 'furniture', id: item.id });
            setInlineEdit(null);
          }
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          if (tool === 'select') {
            setSelection({ kind: 'furniture', id: item.id });
            setInlineEdit(null);
          }
        }}
        onDragEnd={(e) => {
          const newX = snapValue(e.target.x() / PX_PER_CM, 1);
          const newY = snapValue(e.target.y() / PX_PER_CM, 1);
          commitFloor({
            ...floor,
            furniture: floor.furniture.map((f) =>
              f.id === item.id ? { ...f, x: newX, y: newY } : f
            ),
          });
        }}
      >
        {(() => {
          const isGate = item.type === 'gate' || item.type === 'sliding-gate' || item.type === 'wicket-gate';
          return (
            <Rect
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              fill={isGate ? 'rgba(148, 163, 184, 0.08)' : (item.color ?? '#cbd5e1')}
              stroke={isGate && !isSelected ? 'transparent' : stroke}
              strokeWidth={strokeWidth}
              cornerRadius={
                item.type === 'plant' || item.type === 'tree' || item.type === 'fireplace'
                  ? Math.min(w, h) / 2
                  : item.type === 'hedge'
                    ? Math.min(w, h) * 0.35
                    : 3
              }
            />
          );
        })()}

        {(item.type === 'sofa' || item.type === 'corner-sofa' || item.type === 'armchair') && (
          <>
            <Rect x={-w / 2 + 2} y={-h / 2 + 2} width={w - 4} height={Math.max(8, h * 0.22)} fill="#94a3b8" cornerRadius={2} />
            <Rect x={-w / 2 + 2} y={-h / 2 + 2} width={Math.max(7, w * 0.1)} height={h - 4} fill="#94a3b8" cornerRadius={2} />
            <Rect x={w / 2 - Math.max(7, w * 0.1) - 2} y={-h / 2 + 2} width={Math.max(7, w * 0.1)} height={h - 4} fill="#94a3b8" cornerRadius={2} />
          </>
        )}

        {(item.type === 'bed-double' || item.type === 'bed-single') && (
          <>
            <Rect x={-w / 2 + 3} y={-h / 2 + 3} width={w - 6} height={h * 0.22} fill="#eff6ff" stroke="#64748b" strokeWidth={0.8} cornerRadius={2} />
            <Rect x={-w / 2 + 3} y={-h / 2 + h * 0.28} width={w - 6} height={h * 0.68} fill="#93c5fd" cornerRadius={2} />
          </>
        )}

        {item.type === 'stairs' && (
          <>
            {Array.from({ length: Math.max(4, Math.floor(w / 14)) }).map((_, idx, arr) => {
              const stepW = w / arr.length;
              return (
                <Line
                  key={idx}
                  points={[-w / 2 + idx * stepW, -h / 2, -w / 2 + idx * stepW, h / 2]}
                  stroke="#475569"
                  strokeWidth={1}
                />
              );
            })}
            <Line points={[-w / 2 + 8, 0, w / 2 - 8, 0]} stroke="#0f172a" strokeWidth={1.5} />
            <Line points={[w / 2 - 15, -5, w / 2 - 8, 0, w / 2 - 15, 5]} stroke="#0f172a" strokeWidth={1.5} />
          </>
        )}

        {item.type === 'dining-table' && (
          <>
            {[-w * 0.3, 0, w * 0.3].map((cx, i) => (
              <React.Fragment key={i}>
                <Rect x={cx - 8} y={-h / 2 - 7} width={16} height={6} fill="#e2e8f0" stroke="#475569" strokeWidth={0.8} cornerRadius={1} />
                <Rect x={cx - 8} y={h / 2 + 1} width={16} height={6} fill="#e2e8f0" stroke="#475569" strokeWidth={0.8} cornerRadius={1} />
              </React.Fragment>
            ))}
          </>
        )}

        {item.type === 'fireplace' && (
          <Circle x={0} y={0} radius={Math.min(w, h) * 0.28} fill="#f97316" />
        )}

        {item.type === 'shower' && (
          <>
            <Line points={[-w / 2 + 4, -h / 2 + 4, w / 2 - 4, h / 2 - 4]} stroke="#0284c7" strokeWidth={0.8} />
            <Circle x={0} y={0} radius={3} fill="#0284c7" />
          </>
        )}

        {(item.type === 'plant' || item.type === 'tree') && (
          <>
            <Circle x={0} y={0} radius={Math.min(w, h) * 0.34} fill="#16a34a" opacity={0.35} />
            <Circle x={0} y={0} radius={Math.max(2.5, Math.min(w, h) * 0.09)} fill="#15803d" />
          </>
        )}

        {item.type === 'flower-bed' && (
          <>
            <Rect
              x={-w / 2 + 3}
              y={-h / 2 + 3}
              width={Math.max(4, w - 6)}
              height={Math.max(4, h - 6)}
              stroke="#15803d"
              strokeWidth={0.8}
              cornerRadius={2}
            />
            {Array.from({ length: Math.max(3, Math.floor(w / 22)) }).map((_, idx, arr) => {
              const step = w / (arr.length + 1);
              const cx = -w / 2 + step * (idx + 1);
              const cy = idx % 2 === 0 ? -h * 0.12 : h * 0.12;
              return (
                <React.Fragment key={idx}>
                  <Circle x={cx} y={cy} radius={Math.min(h * 0.28, 7)} fill="#16a34a" opacity={0.6} />
                  <Circle x={cx} y={cy} radius={2.2} fill={idx % 2 === 0 ? '#f472b6' : '#facc15'} />
                </React.Fragment>
              );
            })}
          </>
        )}

        {item.type === 'hedge' && (
          <>
            {Array.from({ length: Math.max(3, Math.round(w / Math.max(14, h * 0.75))) }).map((_, idx, arr) => {
              const cx = -w / 2 + (w / arr.length) * (idx + 0.5);
              return (
                <Circle
                  key={idx}
                  x={cx}
                  y={0}
                  radius={Math.min(h * 0.44, (w / arr.length) * 0.62)}
                  fill="#16a34a"
                  opacity={0.45}
                  stroke="#15803d"
                  strokeWidth={0.8}
                />
              );
            })}
          </>
        )}

        {item.type === 'low-wall' && (
          <>
            <Line points={[-w / 2, -h / 2 + 2, w / 2, -h / 2 + 2]} stroke="#64748b" strokeWidth={0.8} />
            <Line points={[-w / 2, h / 2 - 2, w / 2, h / 2 - 2]} stroke="#64748b" strokeWidth={0.8} />
            {Array.from({ length: Math.max(2, Math.floor(w / 24)) }).map((_, idx, arr) => {
              const step = w / arr.length;
              const xPos = -w / 2 + idx * step;
              return idx === 0 ? null : (
                <Line key={idx} points={[xPos, -h / 2 + 2, xPos, h / 2 - 2]} stroke="#94a3b8" strokeWidth={0.9} />
              );
            })}
          </>
        )}

        {item.type === 'gate' && (() => {
          const pillar = Math.max(6, Math.min(h, w * 0.12));
          const leafLen = Math.max(8, (w - pillar * 2) / 2);
          return (
            <>
              <Rect x={-w / 2} y={-h / 2} width={pillar} height={h} fill="#94a3b8" stroke="#334155" strokeWidth={1} />
              <Rect x={w / 2 - pillar} y={-h / 2} width={pillar} height={h} fill="#94a3b8" stroke="#334155" strokeWidth={1} />
              <Rect x={-w / 2 + pillar} y={-2} width={leafLen} height={4} fill="#475569" />
              <Rect x={0} y={-2} width={leafLen} height={4} fill="#475569" />
              <Arc
                x={-w / 2 + pillar}
                y={0}
                innerRadius={leafLen}
                outerRadius={leafLen}
                angle={90}
                rotation={0}
                stroke="#64748b"
                strokeWidth={0.9}
                dash={[4, 3]}
              />
              <Arc
                x={w / 2 - pillar}
                y={0}
                innerRadius={leafLen}
                outerRadius={leafLen}
                angle={90}
                rotation={90}
                stroke="#64748b"
                strokeWidth={0.9}
                dash={[4, 3]}
              />
            </>
          );
        })()}

        {item.type === 'sliding-gate' && (() => {
          const pillar = Math.max(6, Math.min(h, w * 0.12));
          const span = Math.max(12, w - pillar * 2);
          return (
            <>
              <Rect x={-w / 2} y={-h / 2} width={pillar} height={h} fill="#94a3b8" stroke="#334155" strokeWidth={1} />
              <Rect x={w / 2 - pillar} y={-h / 2} width={pillar} height={h} fill="#94a3b8" stroke="#334155" strokeWidth={1} />
              <Line points={[-w / 2 + pillar, 4, w / 2 + span * 0.35, 4]} stroke="#94a3b8" strokeWidth={1.2} dash={[4, 2]} />
              <Rect x={-w / 2 + pillar} y={-2.5} width={span} height={5} fill="#334155" cornerRadius={1} />
              <Line points={[-10, -h / 2 - 4, 12, -h / 2 - 4]} stroke="#334155" strokeWidth={1.1} />
              <Line points={[7, -h / 2 - 7, 12, -h / 2 - 4, 7, -h / 2 - 1]} stroke="#334155" strokeWidth={1.1} />
            </>
          );
        })()}

        {item.type === 'wicket-gate' && (() => {
          const pillar = Math.max(5, Math.min(h, w * 0.16));
          const leafLen = Math.max(8, w - pillar * 2);
          return (
            <>
              <Rect x={-w / 2} y={-h / 2} width={pillar} height={h} fill="#94a3b8" stroke="#334155" strokeWidth={1} />
              <Rect x={w / 2 - pillar} y={-h / 2} width={pillar} height={h} fill="#94a3b8" stroke="#334155" strokeWidth={1} />
              <Rect x={-w / 2 + pillar} y={-2} width={leafLen} height={4} fill="#475569" />
              <Arc
                x={-w / 2 + pillar}
                y={0}
                innerRadius={leafLen}
                outerRadius={leafLen}
                angle={90}
                rotation={0}
                stroke="#64748b"
                strokeWidth={0.9}
                dash={[4, 3]}
              />
            </>
          );
        })()}

        <Text
          x={-w / 2}
          y={h / 2 + 3}
          width={w}
          text={item.label}
          fontSize={9}
          fill="#334155"
          align="center"
          listening={false}
        />
      </Group>
    );
  };

  // Grid lines (every 100 cm = 1 m)
  const gridLines = useMemo(() => {
    const lines: number[][] = [];
    const extent = 3000;
    for (let x = -600; x <= extent; x += 100) {
      lines.push([x * PX_PER_CM, -600 * PX_PER_CM, x * PX_PER_CM, extent * PX_PER_CM]);
    }
    for (let y = -600; y <= extent; y += 100) {
      lines.push([-600 * PX_PER_CM, y * PX_PER_CM, extent * PX_PER_CM, y * PX_PER_CM]);
    }
    return lines;
  }, []);

  const categories = ['Salon', 'Cuisine', 'Chambre', 'Salle de bain', 'Extérieur', 'Structure'];

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden">
      {/* Top Bar: Floors + Metrics + Layer Controls */}
      <div className="bg-white border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 z-10">
        {/* Floor tabs */}
        <div className="flex items-center gap-1.5 max-w-full min-w-0">
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 min-w-0">
            {[...allFloors]
              .sort((a, b) => a.order - b.order)
              .map((f) => (
                <button
                  key={f.id}
                  onClick={() => onSelectFloor(f.id)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors min-h-[40px] shrink-0 inline-flex items-center gap-1.5 ${
                    f.id === floor.id
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {f.isExterior && <Trees className="w-3.5 h-3.5 shrink-0" />}
                  {f.name}
                </button>
              ))}
          </div>
          <button
            onClick={() => setShowNewFloorModal(true)}
            className="px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 flex items-center gap-1 min-h-[40px] shrink-0 whitespace-nowrap"
            title="Ajouter un étage ou extérieur"
          >
            <Plus className="w-4 h-4" /> Étage
          </button>
          <button
            onClick={() => {
              setManageFloorName(floor.name);
              setConfirmDeleteFloor(false);
              setShowManageFloorModal(true);
            }}
            className="p-2 rounded-xl text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center justify-center min-h-[40px] min-w-[40px] shrink-0"
            title={`Gérer l'étage « ${floor.name} » (renommer, réordonner, supprimer)`}
            aria-label="Gérer l'étage actif"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>

        {/* Live Floor Metrics */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:text-sm text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 max-w-full">
          <span title="Surface au sol totale des pièces">
            Sol : <strong className="text-slate-900">{formatAreaM2(metrics.totalFloorAreaM2)}</strong>
          </span>
          <span className="text-slate-300">|</span>
          <span title="Hauteur par défaut des murs de cet étage" className="flex items-center gap-1">
            Hauteur :
            <NumericInput
              min={1}
              max={600}
              step={0.5}
              value={floor.defaultWallHeightCm}
              onCommit={(val) => commitFloor({ ...floor, defaultWallHeightCm: val })}
              className="w-16 px-1.5 py-0.5 bg-white border border-slate-300 rounded text-center font-semibold text-slate-900"
            />
            cm
          </span>
          <span className="text-slate-300">|</span>
          <span title="Surface totale des murs (linéaire × hauteur)">
            Murs : <strong className="text-slate-900">{formatAreaM2(metrics.totalWallSurfaceM2)}</strong>
          </span>
        </div>

        {/* Layers & Readability Controls */}
        <div className="flex items-center flex-wrap gap-1.5">
          {/* Toggle Inter-Wall Dimensions & Units */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1 border border-slate-200">
            <button
              onClick={() => setShowInterWallDims((v) => !v)}
              className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
                showInterWallDims ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-white'
              }`}
              title="Afficher / masquer les cotes entre les murs (cliquables pour modifier avec un input number)"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Cotes murs
            </button>
            <button
              onClick={() => setUnitMode((u) => (u === 'cm' ? 'auto' : 'cm'))}
              className="px-2 py-1 rounded-lg text-xs font-semibold bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
              title="Basculer l'affichage des cotes entre centimètres (ex: 110,5 cm) et mètres (ex: 1,10 m)"
            >
              {unitMode === 'cm' ? 'Unité: cm' : 'Unité: m'}
            </button>
          </div>

          <button
            onClick={handleCleanWalls}
            disabled={lockStructure || floor.walls.length === 0}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-40 flex items-center gap-1 min-h-[36px]"
            title="Aligner proprement les jonctions et couper les murs qui dépassent"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Aligner jonctions</span>
          </button>

          <button
            onClick={handleDetectRooms}
            disabled={lockStructure || floor.walls.length < 3}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 disabled:opacity-40 flex items-center gap-1 min-h-[36px]"
            title="Détecter automatiquement les pièces fermées depuis les murs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Détecter pièces</span>
          </button>

          {/* Layer 1: Structure */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1 border border-slate-200">
            <span className="text-xs font-semibold text-slate-700 px-1.5 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              Murs
            </span>
            <button
              onClick={() => setShowStructure((s) => !s)}
              className={`p-1.5 rounded-lg ${showStructure ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-400'}`}
              title={showStructure ? 'Masquer calque murs' : 'Afficher calque murs'}
            >
              {showStructure ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setLockStructure((l) => !l)}
              className={`p-1.5 rounded-lg ${lockStructure ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-700'}`}
              title={lockStructure ? 'Déverrouiller murs' : 'Verrouiller murs'}
            >
              {lockStructure ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>
          </div>

          {/* Layer 2: Furniture */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1 border border-slate-200">
            <span className="text-xs font-semibold text-slate-700 px-1.5 flex items-center gap-1">
              <Armchair className="w-3.5 h-3.5 text-slate-500" />
              Meubles
            </span>
            <button
              onClick={() => setShowFurniture((s) => !s)}
              className={`p-1.5 rounded-lg ${showFurniture ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-400'}`}
              title={showFurniture ? 'Masquer meubles' : 'Afficher meubles'}
            >
              {showFurniture ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setLockFurniture((l) => !l)}
              className={`p-1.5 rounded-lg ${lockFurniture ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-700'}`}
              title={lockFurniture ? 'Déverrouiller meubles' : 'Verrouiller meubles'}
            >
              {lockFurniture ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>
          </div>

          {floorBelow && (
            <button
              onClick={() => setShowGhostBelow((g) => !g)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border min-h-[36px] ${
                showGhostBelow
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                  : 'bg-white border-slate-200 text-slate-600'
              }`}
              title="Afficher l'étage inférieur en transparence"
            >
              Calque dessous
            </button>
          )}

          <button
            onClick={() => setShowAIPlanModal(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-xs flex items-center gap-1.5 min-h-[36px] transition-colors"
            title="Générer un plan 2D/3D par IA (depuis photo de croquis ou description)"
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Plan IA</span>
          </button>

          <button
            onClick={() => setShowTutorialModal(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs flex items-center gap-1.5 min-h-[36px] transition-colors"
            title="Guide & Tutoriel : Créer un étage de A à Z (Murs vs Pièces)"
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Guide</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="relative flex-1 overflow-hidden touch-none" ref={containerRef}>
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          scaleX={zoom}
          scaleY={zoom}
          x={pan.x}
          y={pan.y}
          draggable={tool === 'pan'}
          onDragEnd={(e) => {
            if (e.target === stageRef.current) {
              setPan({ x: e.target.x(), y: e.target.y() });
            }
          }}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}
        >
          {/* Background Grid Layer */}
          <Layer listening={false}>
            {gridLines.map((pts, i) => (
              <Line key={i} points={pts} stroke="#e2e8f0" strokeWidth={1 / zoom} />
            ))}
          </Layer>

          {/* Ghost Layer from floor below */}
          {showGhostBelow && floorBelow && (
            <Layer listening={false} opacity={0.25}>
              {floorBelow.walls.map((w) => (
                <Line
                  key={w.id}
                  points={[w.x1 * PX_PER_CM, w.y1 * PX_PER_CM, w.x2 * PX_PER_CM, w.y2 * PX_PER_CM]}
                  stroke="#6366f1"
                  strokeWidth={w.thicknessCm * PX_PER_CM}
                  dash={[6, 6]}
                />
              ))}
            </Layer>
          )}

          {/* CALQUE 1: Structure, Rooms, Walls, Openings & Dimensions */}
          <Layer visible={showStructure}>
            {/* 1. Rooms / Exterior Zones */}
            {floor.rooms.map((room) => {
              const area = polygonAreaM2(room.points);
              const perim = polygonPerimeterM(room.points);
              const wallH = (room.wallHeightCm ?? floor.defaultWallHeightCm) / 100;
              const wallSurface = perim * wallH;
              const isSelected = selection?.kind === 'room' && selection.id === room.id;
              const flatPts = room.points.flatMap((p) => [p.x * PX_PER_CM, p.y * PX_PER_CM]);
              const fill = room.color ?? FLOOR_MATERIAL_LABELS[room.floorType]?.color ?? '#f8fafc';
              const rl = labelLayout.roomLabels.get(room.id);

              return (
                <Group
                  key={room.id}
                  onClick={(e) => {
                    if (tool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'room', id: room.id });
                      setInlineEdit(null);
                    }
                  }}
                  onTap={(e) => {
                    if (tool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'room', id: room.id });
                      setInlineEdit(null);
                    }
                  }}
                >
                  <Line
                    points={flatPts}
                    closed
                    fill={fill}
                    stroke={isSelected ? '#2563eb' : '#cbd5e1'}
                    strokeWidth={isSelected ? 2.5 : 1}
                  />
                  {rl && rl.visible && (
                    <Group x={rl.cxPx} y={rl.cyPx} listening={false}>
                      <Rect
                        x={-rl.boxW / 2}
                        y={-rl.boxH / 2}
                        width={rl.boxW}
                        height={rl.boxH}
                        fill="rgba(255, 255, 255, 0.84)"
                        stroke={isSelected ? '#93c5fd' : 'rgba(203, 213, 225, 0.7)'}
                        strokeWidth={0.8}
                        cornerRadius={4}
                      />
                      <Text
                        x={-rl.boxW / 2 + 3}
                        y={-rl.boxH / 2 + 3}
                        width={rl.boxW - 6}
                        height={rl.boxH - 6}
                        text={
                          rl.showWallArea
                            ? `${room.name}\n${formatAreaM2(area)}\nMurs: ${formatAreaM2(wallSurface)}`
                            : `${room.name}\n${formatAreaM2(area)}`
                        }
                        fontSize={rl.fontSize}
                        lineHeight={1.2}
                        fontStyle="bold"
                        fill="#1e293b"
                        align="center"
                        verticalAlign="middle"
                        ellipsis={true}
                      />
                    </Group>
                  )}
                </Group>
              );
            })}

            {/* 2. Walls (Trimmed cleanly at corners and T-junctions so walls NEVER overshoot!) */}
            {floor.walls.map((w) => {
              const isSelected = selection?.kind === 'wall' && selection.id === w.id;
              const cleanPts = getCleanWallRenderPoints(w, floor.walls);
              const isInterior = w.wallType === 'interior' || w.thicknessCm <= 14;
              const baseColor = isSelected ? '#2563eb' : isInterior ? '#1e293b' : '#0f172a';

              return (
                <Group
                  key={w.id}
                  onClick={(e) => {
                    if (tool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'wall', id: w.id });
                      setInlineEdit(null);
                    }
                  }}
                  onTap={(e) => {
                    if (tool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'wall', id: w.id });
                      setInlineEdit(null);
                    }
                  }}
                >
                  <Line
                    points={[
                      cleanPts.x1 * PX_PER_CM,
                      cleanPts.y1 * PX_PER_CM,
                      cleanPts.x2 * PX_PER_CM,
                      cleanPts.y2 * PX_PER_CM,
                    ]}
                    stroke={baseColor}
                    strokeWidth={Math.max(3, w.thicknessCm * PX_PER_CM)}
                    lineCap="butt"
                    hitStrokeWidth={Math.max(14, w.thicknessCm * PX_PER_CM + 8)}
                  />
                </Group>
              );
            })}

            {/* 3. Openings (Doors, Windows, Sliding Doors) */}
            {floor.openings.map((op) => {
              const wall = floor.walls.find((w) => w.id === op.wallId);
              if (!wall) return null;
              const cx = (wall.x1 + (wall.x2 - wall.x1) * op.offsetRatio) * PX_PER_CM;
              const cy = (wall.y1 + (wall.y2 - wall.y1) * op.offsetRatio) * PX_PER_CM;
              const angle = (Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1) * 180) / Math.PI;
              const opW = op.widthCm * PX_PER_CM;
              const wallThick = Math.max(4, wall.thicknessCm * PX_PER_CM);
              const isSelected = selection?.kind === 'opening' && selection.id === op.id;

              return (
                <Group
                  key={op.id}
                  x={cx}
                  y={cy}
                  rotation={angle}
                  onClick={(e) => {
                    if (tool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'opening', id: op.id });
                      setInlineEdit(null);
                    }
                  }}
                  onTap={(e) => {
                    if (tool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'opening', id: op.id });
                      setInlineEdit(null);
                    }
                  }}
                >
                  <Rect x={-opW / 2} y={-wallThick / 2 - 1} width={opW} height={wallThick + 2} fill="#ffffff" />
                  {op.type === 'window' && (
                    <>
                      <Rect
                        x={-opW / 2}
                        y={-wallThick / 2}
                        width={opW}
                        height={wallThick}
                        fill="#e0f2fe"
                        stroke={isSelected ? '#2563eb' : '#0284c7'}
                        strokeWidth={1.5}
                      />
                      <Line points={[-opW / 2, 0, opW / 2, 0]} stroke="#0284c7" strokeWidth={1} />
                    </>
                  )}
                  {op.type === 'sliding-door' && (
                    <>
                      <Rect
                        x={-opW / 2}
                        y={-wallThick / 2}
                        width={opW}
                        height={wallThick}
                        fill="#dbeafe"
                        stroke={isSelected ? '#2563eb' : '#1d4ed8'}
                        strokeWidth={1.5}
                      />
                      <Line points={[-opW / 2, -1.5, 0, -1.5]} stroke="#1d4ed8" strokeWidth={2} />
                      <Line points={[0, 1.5, opW / 2, 1.5]} stroke="#1d4ed8" strokeWidth={2} />
                    </>
                  )}
                  {op.type === 'door' && (() => {
                    const isRight = op.hinge === 'right';
                    const hingeX = isRight ? opW / 2 : -opW / 2;
                    const leafEndY = op.flip ? -opW : opW;
                    const arcRotation = isRight ? (op.flip ? 180 : 90) : (op.flip ? -90 : 0);
                    return (
                      <>
                        <Line
                          points={[hingeX, 0, hingeX, leafEndY]}
                          stroke={isSelected ? '#2563eb' : '#334155'}
                          strokeWidth={2.5}
                        />
                        <Arc
                          x={hingeX}
                          y={0}
                          innerRadius={opW - 1}
                          outerRadius={opW}
                          angle={90}
                          rotation={arcRotation}
                          stroke="#64748b"
                          strokeWidth={1}
                          dash={[4, 3]}
                        />
                      </>
                    );
                  })()}
                  {op.type === 'double-door' && (
                    <>
                      <Line
                        points={[-opW / 2, 0, -opW / 2, op.flip ? -opW / 2 : opW / 2]}
                        stroke={isSelected ? '#2563eb' : '#334155'}
                        strokeWidth={2.5}
                      />
                      <Line
                        points={[opW / 2, 0, opW / 2, op.flip ? -opW / 2 : opW / 2]}
                        stroke={isSelected ? '#2563eb' : '#334155'}
                        strokeWidth={2.5}
                      />
                      <Arc
                        x={-opW / 2}
                        y={0}
                        innerRadius={opW / 2 - 1}
                        outerRadius={opW / 2}
                        angle={90}
                        rotation={op.flip ? -90 : 0}
                        stroke="#64748b"
                        strokeWidth={1}
                        dash={[4, 3]}
                      />
                      <Arc
                        x={opW / 2}
                        y={0}
                        innerRadius={opW / 2 - 1}
                        outerRadius={opW / 2}
                        angle={90}
                        rotation={op.flip ? 180 : 90}
                        stroke="#64748b"
                        strokeWidth={1}
                        dash={[4, 3]}
                      />
                    </>
                  )}
                  {op.type === 'pocket-door' && (
                    <>
                      <Rect
                        x={-opW / 2}
                        y={-wallThick / 4}
                        width={opW}
                        height={wallThick / 2}
                        fill="#f8fafc"
                        stroke={isSelected ? '#2563eb' : '#475569'}
                        strokeWidth={1.2}
                        dash={[3, 2]}
                      />
                      <Line
                        points={[op.flip ? -opW / 2 : 0, 0, op.flip ? 0 : opW / 2, 0]}
                        stroke={isSelected ? '#2563eb' : '#334155'}
                        strokeWidth={3}
                      />
                    </>
                  )}
                  {op.type === 'arch-passage' && (
                    <>
                      <Line
                        points={[-opW / 2, -wallThick / 2, -opW / 2, wallThick / 2]}
                        stroke={isSelected ? '#2563eb' : '#b45309'}
                        strokeWidth={2}
                      />
                      <Line
                        points={[opW / 2, -wallThick / 2, opW / 2, wallThick / 2]}
                        stroke={isSelected ? '#2563eb' : '#b45309'}
                        strokeWidth={2}
                      />
                      <Line
                        points={[-opW / 2, 0, opW / 2, 0]}
                        stroke={isSelected ? '#2563eb' : '#d97706'}
                        strokeWidth={1.5}
                        dash={[5, 4]}
                      />
                      <Text
                        x={-opW / 2}
                        y={-5}
                        width={opW}
                        text={op.archShape && op.archShape !== 'flat' ? 'ARCHE' : 'OUV.'}
                        fontSize={8}
                        fontStyle="bold"
                        fill="#b45309"
                        align="center"
                      />
                    </>
                  )}
                  {op.type === 'interior-glass' && (
                    <>
                      <Rect
                        x={-opW / 2}
                        y={-wallThick / 2}
                        width={opW}
                        height={wallThick}
                        fill="#e0f2fe"
                        stroke={isSelected ? '#2563eb' : op.frameColor || '#1e293b'}
                        strokeWidth={2}
                      />
                      {Array.from({ length: Math.max(1, (op.glassMullions ?? 4) - 1) }).map((_, mIdx) => {
                        const mx = -opW / 2 + ((mIdx + 1) * opW) / Math.max(1, op.glassMullions ?? 4);
                        return (
                          <Line
                            key={mIdx}
                            points={[mx, -wallThick / 2, mx, wallThick / 2]}
                            stroke={op.frameColor || '#1e293b'}
                            strokeWidth={1.5}
                          />
                        );
                      })}
                    </>
                  )}
                  {op.type === 'pass-through' && (
                    <>
                      <Rect
                        x={-opW / 2}
                        y={-wallThick / 2}
                        width={opW}
                        height={wallThick}
                        fill="#fef3c7"
                        stroke={isSelected ? '#2563eb' : '#b45309'}
                        strokeWidth={1.5}
                        dash={[4, 2]}
                      />
                      <Text
                        x={-opW / 2}
                        y={-4}
                        width={opW}
                        text="NICHE"
                        fontSize={7.5}
                        fontStyle="bold"
                        fill="#92400e"
                        align="center"
                      />
                    </>
                  )}
                </Group>
              );
            })}

            {/* 4. Clickable Wall Length Badges (with collision avoidance) */}
            {floor.walls.map((w) => {
              const badge = labelLayout.wallBadges.get(w.id);
              if (!badge || !badge.visible) return null;
              const isSelected = selection?.kind === 'wall' && selection.id === w.id;
              const len = wallLengthCm(w);

              return (
                <Group
                  key={`wbadge_${w.id}`}
                  x={badge.xPx}
                  y={badge.yPx}
                  rotation={badge.rotation}
                  onClick={(e) => {
                    if (lockStructure) return;
                    e.cancelBubble = true;
                    setSelection({ kind: 'wall', id: w.id });
                    setInlineEdit({
                      kind: 'wall-length',
                      wallId: w.id,
                      valueCm: len,
                      worldX: badge.xPx / PX_PER_CM,
                      worldY: badge.yPx / PX_PER_CM,
                      label: 'Longueur du mur (cm)',
                    });
                  }}
                  onTap={(e) => {
                    if (lockStructure) return;
                    e.cancelBubble = true;
                    setSelection({ kind: 'wall', id: w.id });
                    setInlineEdit({
                      kind: 'wall-length',
                      wallId: w.id,
                      valueCm: len,
                      worldX: badge.xPx / PX_PER_CM,
                      worldY: badge.yPx / PX_PER_CM,
                      label: 'Longueur du mur (cm)',
                    });
                  }}
                >
                  <Rect
                    x={-badge.badgeW / 2}
                    y={-badge.badgeH / 2}
                    width={badge.badgeW}
                    height={badge.badgeH}
                    fill={isSelected ? '#eff6ff' : 'rgba(255,255,255,0.94)'}
                    stroke={isSelected ? '#2563eb' : '#cbd5e1'}
                    strokeWidth={isSelected ? 1.4 : 0.8}
                    cornerRadius={4}
                  />
                  <Text
                    x={-badge.badgeW / 2}
                    y={-badge.badgeH / 2 + 2.5}
                    width={badge.badgeW}
                    text={badge.text}
                    fontSize={9.5}
                    fontStyle="bold"
                    fill={isSelected ? '#1d4ed8' : '#0f172a'}
                    align="center"
                    listening={false}
                  />
                </Group>
              );
            })}

            {/* 5. Clickable Inter-Wall Dimension Lines (Cotes entre les murs) */}
            {showInterWallDims &&
              allInterWallDimensions.map((dim) => {
                const placement = labelLayout.interWallPlacements.get(dim.id);
                if (!placement || !placement.visible) return null;
                const isRelatedToSelected =
                  selectedWall && (dim.wallAId === selectedWall.id || dim.wallBId === selectedWall.id);
                const { x1Px, y1Px, x2Px, y2Px, midXPx, midYPx } = placement;

                const dx = x2Px - x1Px;
                const dy = y2Px - y1Px;
                const lenPx = Math.hypot(dx, dy);
                if (lenPx < 18 && !isRelatedToSelected) return null;

                const ux = lenPx > 0 ? dx / lenPx : 1;
                const uy = lenPx > 0 ? dy / lenPx : 0;
                const nx = -uy;
                const ny = ux;
                const arrowSize = Math.min(5, lenPx * 0.2);

                const displayAngle =
                  dim.angleDeg > 90 || dim.angleDeg < -90 ? dim.angleDeg + 180 : dim.angleDeg;
                const isLocked = Boolean(floor.lockedDimensionIds?.includes(dim.pairKey));
                const text = formatMeters(dim.clearDistanceCm, unitMode);
                const pillW = Math.max(48, text.length * 6.0 + (isLocked ? 22 : 14));
                const pillH = 15;
                const strokeColor = isLocked
                  ? '#d97706'
                  : isRelatedToSelected
                  ? '#4f46e5'
                  : '#6366f1';

                return (
                  <Group key={dim.id}>
                    {/* Dimension line with end ticks and arrows */}
                    <Line
                      points={[x1Px, y1Px, x2Px, y2Px]}
                      stroke={strokeColor}
                      strokeWidth={isRelatedToSelected ? 1.6 : 1.1}
                      dash={[4, 3]}
                      opacity={isRelatedToSelected ? 1 : 0.75}
                      listening={false}
                    />
                    {/* Tick & Arrow at start */}
                    <Line
                      points={[x1Px - nx * 4, y1Px - ny * 4, x1Px + nx * 4, y1Px + ny * 4]}
                      stroke={strokeColor}
                      strokeWidth={1.4}
                      listening={false}
                    />
                    <Line
                      points={[
                        x1Px + ux * arrowSize + nx * (arrowSize * 0.6),
                        y1Px + uy * arrowSize + ny * (arrowSize * 0.6),
                        x1Px,
                        y1Px,
                        x1Px + ux * arrowSize - nx * (arrowSize * 0.6),
                        y1Px + uy * arrowSize - ny * (arrowSize * 0.6),
                      ]}
                      stroke={strokeColor}
                      strokeWidth={1.3}
                      listening={false}
                    />
                    {/* Tick & Arrow at end */}
                    <Line
                      points={[x2Px - nx * 4, y2Px - ny * 4, x2Px + nx * 4, y2Px + ny * 4]}
                      stroke={strokeColor}
                      strokeWidth={1.4}
                      listening={false}
                    />
                    <Line
                      points={[
                        x2Px - ux * arrowSize + nx * (arrowSize * 0.6),
                        y2Px - uy * arrowSize + ny * (arrowSize * 0.6),
                        x2Px,
                        y2Px,
                        x2Px - ux * arrowSize - nx * (arrowSize * 0.6),
                        y2Px - uy * arrowSize - ny * (arrowSize * 0.6),
                      ]}
                      stroke={strokeColor}
                      strokeWidth={1.3}
                      listening={false}
                    />

                    {/* Clickable badge to edit distance between walls with input number */}
                    <Group
                      x={midXPx}
                      y={midYPx}
                      rotation={displayAngle}
                      onClick={(e) => {
                        if (lockStructure) return;
                        e.cancelBubble = true;
                        const { movingWallId, referenceWallId } = pickMovingAndReferenceWall(dim);
                        setSelection({ kind: 'wall', id: movingWallId });
                        setInlineEdit({
                          kind: 'inter-wall',
                          pairKey: dim.pairKey,
                          movingWallId,
                          referenceWallId,
                          valueCm: dim.clearDistanceCm,
                          worldX: midXPx / PX_PER_CM,
                          worldY: midYPx / PX_PER_CM,
                          label: 'Espacement entre murs (cm)',
                        });
                      }}
                      onTap={(e) => {
                        if (lockStructure) return;
                        e.cancelBubble = true;
                        const { movingWallId, referenceWallId } = pickMovingAndReferenceWall(dim);
                        setSelection({ kind: 'wall', id: movingWallId });
                        setInlineEdit({
                          kind: 'inter-wall',
                          pairKey: dim.pairKey,
                          movingWallId,
                          referenceWallId,
                          valueCm: dim.clearDistanceCm,
                          worldX: midXPx / PX_PER_CM,
                          worldY: midYPx / PX_PER_CM,
                          label: 'Espacement entre murs (cm)',
                        });
                      }}
                    >
                      <Rect
                        x={-pillW / 2}
                        y={-pillH / 2}
                        width={pillW}
                        height={pillH}
                        fill={
                          isLocked
                            ? '#fef3c7'
                            : isRelatedToSelected
                            ? '#eef2ff'
                            : 'rgba(255, 255, 255, 0.95)'
                        }
                        stroke={strokeColor}
                        strokeWidth={isRelatedToSelected || isLocked ? 1.5 : 1}
                        cornerRadius={5}
                      />
                      {isLocked && (
                        <>
                          <Arc
                            x={-pillW / 2 + 8}
                            y={-1}
                            innerRadius={1.5}
                            outerRadius={2.5}
                            angle={180}
                            rotation={180}
                            fill="#d97706"
                            listening={false}
                          />
                          <Rect
                            x={-pillW / 2 + 5}
                            y={-1}
                            width={6}
                            height={4.5}
                            fill="#d97706"
                            cornerRadius={1}
                            listening={false}
                          />
                        </>
                      )}
                      <Text
                        x={isLocked ? -pillW / 2 + 8 : -pillW / 2}
                        y={-pillH / 2 + 2.5}
                        width={isLocked ? pillW - 8 : pillW}
                        text={text}
                        fontSize={9.5}
                        fontStyle="bold"
                        fill={isLocked ? '#92400e' : '#3730a3'}
                        align="center"
                        listening={false}
                      />
                    </Group>
                  </Group>
                );
              })}

            {/* 6. Draggable Endpoint & Parallel-Slide Handles for Selected Wall */}
            {selectedWall && tool === 'select' && !lockStructure && (
              <Group>
                {/* Center Parallel-Slide Handle */}
                <Circle
                  x={((selectedWall.x1 + selectedWall.x2) / 2) * PX_PER_CM}
                  y={((selectedWall.y1 + selectedWall.y2) / 2) * PX_PER_CM}
                  radius={6.5}
                  fill="#4f46e5"
                  stroke="#ffffff"
                  strokeWidth={2}
                  draggable
                  onDragEnd={(e) => {
                    const midX = (selectedWall.x1 + selectedWall.x2) / 2;
                    const midY = (selectedWall.y1 + selectedWall.y2) / 2;
                    const rawX = e.target.x() / PX_PER_CM;
                    const rawY = e.target.y() / PX_PER_CM;
                    const shiftX = snapValue(rawX - midX, 0.5);
                    const shiftY = snapValue(rawY - midY, 0.5);
                    commitFloor(shiftWallInFloor(floor, selectedWall.id, shiftX, shiftY));
                  }}
                />
                {/* Endpoint 1 Handle */}
                <Circle
                  x={selectedWall.x1 * PX_PER_CM}
                  y={selectedWall.y1 * PX_PER_CM}
                  radius={6}
                  fill="#ffffff"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  draggable
                  onDragEnd={(e) => {
                    const rawX = e.target.x() / PX_PER_CM;
                    const rawY = e.target.y() / PX_PER_CM;
                    const otherWalls = floor.walls.filter((w) => w.id !== selectedWall.id);
                    const snapped = snapPointToWalls(rawX, rawY, otherWalls, 16, 0.5, {
                      startPoint: { x: selectedWall.x2, y: selectedWall.y2 },
                      freeAngle: freeAngleWall,
                    });
                    commitFloor({
                      ...floor,
                      walls: floor.walls.map((w) =>
                        w.id === selectedWall.id ? { ...w, x1: snapped.x, y1: snapped.y } : w
                      ),
                    });
                  }}
                />
                {/* Endpoint 2 Handle */}
                <Circle
                  x={selectedWall.x2 * PX_PER_CM}
                  y={selectedWall.y2 * PX_PER_CM}
                  radius={6}
                  fill="#ffffff"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  draggable
                  onDragEnd={(e) => {
                    const rawX = e.target.x() / PX_PER_CM;
                    const rawY = e.target.y() / PX_PER_CM;
                    const otherWalls = floor.walls.filter((w) => w.id !== selectedWall.id);
                    const snapped = snapPointToWalls(rawX, rawY, otherWalls, 16, 0.5, {
                      startPoint: { x: selectedWall.x1, y: selectedWall.y1 },
                      freeAngle: freeAngleWall,
                    });
                    commitFloor({
                      ...floor,
                      walls: floor.walls.map((w) =>
                        w.id === selectedWall.id ? { ...w, x2: snapped.x, y2: snapped.y } : w
                      ),
                    });
                  }}
                />
              </Group>
            )}

            {/* 7. Live Wall Drawing Preview (Segment or Exterior 4-Wall Rectangle + Live Inter-Wall Distances!) */}
            {wallStart && wallPreview && (
              <Group listening={false}>
                {tool === 'wall-ext' && extWallMode === 'rect' ? (
                  <>
                    <Rect
                      x={Math.min(wallStart.x, wallPreview.x) * PX_PER_CM}
                      y={Math.min(wallStart.y, wallPreview.y) * PX_PER_CM}
                      width={Math.abs(wallPreview.x - wallStart.x) * PX_PER_CM}
                      height={Math.abs(wallPreview.y - wallStart.y) * PX_PER_CM}
                      stroke="#0f172a"
                      strokeWidth={extWallThicknessCm * PX_PER_CM}
                      dash={[8, 4]}
                    />
                    <Text
                      x={((wallStart.x + wallPreview.x) / 2) * PX_PER_CM - 60}
                      y={((wallStart.y + wallPreview.y) / 2) * PX_PER_CM - 10}
                      width={120}
                      text={`${formatMeters(Math.abs(wallPreview.x - wallStart.x), unitMode)} × ${formatMeters(
                        Math.abs(wallPreview.y - wallStart.y),
                        unitMode
                      )}`}
                      fontSize={12}
                      fontStyle="bold"
                      fill="#1d4ed8"
                      align="center"
                    />
                  </>
                ) : (
                  <>
                    <Line
                      points={[
                        wallStart.x * PX_PER_CM,
                        wallStart.y * PX_PER_CM,
                        wallPreview.x * PX_PER_CM,
                        wallPreview.y * PX_PER_CM,
                      ]}
                      stroke={tool === 'wall-int' ? '#4f46e5' : '#2563eb'}
                      strokeWidth={Math.max(4, (tool === 'wall-int' ? intWallThicknessCm : extWallThicknessCm) * PX_PER_CM)}
                      dash={[6, 4]}
                    />
                    <Text
                      x={((wallStart.x + wallPreview.x) / 2) * PX_PER_CM - 45}
                      y={((wallStart.y + wallPreview.y) / 2) * PX_PER_CM - 24}
                      width={90}
                      text={formatMeters(
                        Math.hypot(wallPreview.x - wallStart.x, wallPreview.y - wallStart.y),
                        unitMode
                      )}
                      fontSize={11}
                      fontStyle="bold"
                      fill="#1d4ed8"
                      align="center"
                    />
                    {/* Live distances to facing walls while positioning an interior wall */}
                    {livePreviewFacings.map((f, idx) => (
                      <React.Fragment key={idx}>
                        <Line
                          points={[
                            f.x1 * PX_PER_CM,
                            f.y1 * PX_PER_CM,
                            f.x2 * PX_PER_CM,
                            f.y2 * PX_PER_CM,
                          ]}
                          stroke="#4f46e5"
                          strokeWidth={1.3}
                          dash={[3, 3]}
                        />
                        <Text
                          x={((f.x1 + f.x2) / 2) * PX_PER_CM - 35}
                          y={((f.y1 + f.y2) / 2) * PX_PER_CM - 14}
                          width={70}
                          text={formatCm(f.clearDistanceCm)}
                          fontSize={10}
                          fontStyle="bold"
                          fill="#4338ca"
                          align="center"
                        />
                      </React.Fragment>
                    ))}
                  </>
                )}
              </Group>
            )}

            {/* Live Room Drawing Preview */}
            {roomStart && roomPreview && (
              <Rect
                x={Math.min(roomStart.x, roomPreview.x) * PX_PER_CM}
                y={Math.min(roomStart.y, roomPreview.y) * PX_PER_CM}
                width={Math.abs(roomPreview.x - roomStart.x) * PX_PER_CM}
                height={Math.abs(roomPreview.y - roomStart.y) * PX_PER_CM}
                fill="rgba(37, 99, 235, 0.12)"
                stroke="#2563eb"
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            )}

            {/* Live Polygon Room Preview */}
            {tool === 'room-poly' && polyPoints.length > 0 && (
              <Group listening={false}>
                {polyPoints.map((p, idx) => (
                  <Circle
                    key={idx}
                    x={p.x * PX_PER_CM}
                    y={p.y * PX_PER_CM}
                    radius={idx === 0 ? 6 : 4}
                    fill={idx === 0 ? '#16a34a' : '#2563eb'}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                ))}
                <Line
                  points={[
                    ...polyPoints.flatMap((p) => [p.x * PX_PER_CM, p.y * PX_PER_CM]),
                    ...(polyPreview ? [polyPreview.x * PX_PER_CM, polyPreview.y * PX_PER_CM] : []),
                  ]}
                  stroke="#2563eb"
                  strokeWidth={2}
                  dash={[6, 3]}
                />
              </Group>
            )}
          </Layer>

          {/* CALQUE 2: Furniture & Interior Design */}
          <Layer visible={showFurniture}>
            {floor.furniture.map((item) =>
              renderFurnitureShape(item, selection?.kind === 'furniture' && selection.id === item.id)
            )}
          </Layer>
        </Stage>

        {/* On-Canvas Floating Input Number Overlay when clicking any wall or inter-wall dimension badge */}
        {inlineEdit && (
          <div
            style={{
              left: `${Math.max(16, Math.min(stageSize.width - 280, pan.x + inlineEdit.worldX * PX_PER_CM * zoom - 125))}px`,
              top: `${Math.max(16, Math.min(stageSize.height - 165, pan.y + inlineEdit.worldY * PX_PER_CM * zoom - 55))}px`,
            }}
            className="absolute z-40 bg-white border-2 border-indigo-600 rounded-2xl shadow-2xl p-3 w-68 animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-indigo-950">{inlineEdit.label}</span>
              <button
                type="button"
                onClick={() => setInlineEdit(null)}
                className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <NumericInput
                key={
                  inlineEdit.kind === 'wall-length'
                    ? inlineEdit.wallId
                    : inlineEdit.pairKey ?? `${inlineEdit.movingWallId}-${inlineEdit.referenceWallId}`
                }
                autoFocus
                step={0.1}
                min={0.5}
                max={5000}
                value={inlineEdit.valueCm}
                onCommit={(val) => {
                  if (inlineEdit.kind === 'wall-length') {
                    handleUpdateWallLength(inlineEdit.wallId, val);
                  } else {
                    handleUpdateInterWallDistance(
                      inlineEdit.movingWallId,
                      inlineEdit.referenceWallId,
                      val
                    );
                  }
                  setInlineEdit(null);
                }}
                onTab={
                  inlineEdit.kind === 'inter-wall'
                    ? (shiftKey, committedVal) => {
                        const updatedFloor = handleUpdateInterWallDistance(
                          inlineEdit.movingWallId,
                          inlineEdit.referenceWallId,
                          committedVal
                        );
                        const nextDims = computeInterWallDimensions(updatedFloor.walls);
                        if (nextDims.length === 0) {
                          setInlineEdit(null);
                          return;
                        }
                        const currIdx = nextDims.findIndex(
                          (d) =>
                            (inlineEdit.pairKey && d.pairKey === inlineEdit.pairKey) ||
                            ((d.wallAId === inlineEdit.movingWallId &&
                              d.wallBId === inlineEdit.referenceWallId) ||
                              (d.wallBId === inlineEdit.movingWallId &&
                                d.wallAId === inlineEdit.referenceWallId))
                        );
                        const nextIdx =
                          currIdx === -1
                            ? 0
                            : (currIdx + (shiftKey ? -1 : 1) + nextDims.length) % nextDims.length;
                        const nextDim = nextDims[nextIdx];
                        const { movingWallId, referenceWallId } = pickMovingAndReferenceWall(nextDim);
                        setSelection({ kind: 'wall', id: movingWallId });
                        setInlineEdit({
                          kind: 'inter-wall',
                          pairKey: nextDim.pairKey,
                          movingWallId,
                          referenceWallId,
                          valueCm: nextDim.clearDistanceCm,
                          worldX: nextDim.midX,
                          worldY: nextDim.midY,
                          label: 'Espacement entre murs (cm)',
                        });
                      }
                    : undefined
                }
                onCancel={() => setInlineEdit(null)}
                className="w-full px-2.5 py-1.5 border border-indigo-300 rounded-lg text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-xs font-bold text-slate-600">cm</span>
              <button
                type="button"
                onClick={() => setInlineEdit(null)}
                className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                title="Valider (Entrée)"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>

            {inlineEdit.kind === 'inter-wall' && (
              <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCascadeSpacingMode((v) => !v)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                    cascadeSpacingMode
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                  title="Tout décaler en cascade ou déplacer uniquement ce mur"
                >
                  {cascadeSpacingMode ? 'Tout décaler (Cascade)' : 'Ce mur seul'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setInlineEdit({
                      ...inlineEdit,
                      movingWallId: inlineEdit.referenceWallId,
                      referenceWallId: inlineEdit.movingWallId,
                    })
                  }
                  className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1"
                  title="Inverser quel mur pousse l'autre"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  Inverser sens
                </button>
                {inlineEdit.pairKey && (
                  <button
                    type="button"
                    onClick={() => handleToggleLockDimension(inlineEdit.pairKey)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold border flex items-center gap-1 ${
                      floor.lockedDimensionIds?.includes(inlineEdit.pairKey)
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                    title="Verrouiller cette cote pour conserver son espacement"
                  >
                    {floor.lockedDimensionIds?.includes(inlineEdit.pairKey) ? (
                      <Lock className="w-3 h-3" />
                    ) : (
                      <Unlock className="w-3 h-3" />
                    )}
                    {floor.lockedDimensionIds?.includes(inlineEdit.pairKey) ? 'Figée' : 'Figer'}
                  </button>
                )}
              </div>
            )}

            <div className="text-[10px] text-slate-500 mt-1">
              {inlineEdit.kind === 'inter-wall'
                ? 'Entrée = valider · Tab = cote suivante · ex: 12,5'
                : 'Décimales acceptées (ex: 12,5 ou 12.5)'}
            </div>
          </div>
        )}

        {/* Contextual Banner for Exterior / Interior Wall Creation */}
        {(tool === 'wall-ext' || tool === 'wall-int') && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur border border-slate-200 shadow-lg rounded-2xl px-3.5 py-2 flex flex-wrap items-center gap-3 z-20 max-w-[95vw]">
            {tool === 'wall-ext' ? (
              <>
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Ruler className="w-4 h-4 text-blue-600" />
                  1. Murs Extérieurs :
                </span>
                <div className="flex items-center bg-slate-100 rounded-xl p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setExtWallMode('segment');
                      setWallStart(null);
                      setWallPreview(null);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      extWallMode === 'segment' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Mur par mur
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExtWallMode('rect');
                      setWallStart(null);
                      setWallPreview(null);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      extWallMode === 'rect' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Contour 4 murs (Rect.)
                  </button>
                </div>
                <label className="flex items-center gap-1 text-xs text-slate-700">
                  <span>Ép. :</span>
                  <NumericInput
                    step={0.5}
                    min={1}
                    max={100}
                    value={extWallThicknessCm}
                    onCommit={setExtWallThicknessCm}
                    className="w-14 px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-center text-slate-900"
                  />
                  <span>cm</span>
                </label>
              </>
            ) : (
              <>
                <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                  <Ruler className="w-4 h-4 text-indigo-600" />
                  2. Murs Intérieurs (sans restriction) :
                </span>
                <label className="flex items-center gap-1 text-xs text-slate-700">
                  <span>Ép. cloison :</span>
                  <NumericInput
                    step={0.1}
                    min={1}
                    max={100}
                    value={intWallThicknessCm}
                    onCommit={setIntWallThicknessCm}
                    className="w-16 px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-center text-slate-900"
                  />
                  <span>cm</span>
                </label>
                <button
                  type="button"
                  onClick={() => setFreeAngleWall((f) => !f)}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold border transition-colors ${
                    freeAngleWall
                      ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  }`}
                >
                  {freeAngleWall ? 'Angle 100% libre' : 'Aide 90° (ou Shift)'}
                </button>
              </>
            )}
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              {wallStart ? 'Cliquez le point de fin' : 'Cliquez le point de départ (sur un mur ou libre)'}
            </span>
          </div>
        )}

        {/* Helper Hint Banner for Room / Opening tools */}
        {(tool === 'room' ||
          tool === 'room-poly' ||
          tool === 'door' ||
          tool === 'window' ||
          tool === 'arch-passage') && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900/90 text-white text-xs sm:text-sm px-4 py-2 rounded-2xl sm:rounded-full shadow-md pointer-events-none flex items-center justify-center gap-2 z-20 max-w-[92vw] w-max text-center">
            <Ruler className="w-4 h-4 text-blue-400 shrink-0" />
            {tool === 'room' && (roomStart ? 'Touchez le coin opposé de la pièce' : 'Touchez le premier coin de la pièce')}
            {tool === 'room-poly' &&
              (polyPoints.length === 0
                ? 'Touchez le 1er coin de la pièce (couloir, en L...)'
                : 'Touchez le coin suivant, ou le 1er point vert pour fermer')}
            {(tool === 'door' || tool === 'window' || tool === 'arch-passage') &&
              "Touchez un mur existant pour y placer l'ouverture / arche"}
          </div>
        )}

        {/* Floating Polygon Control Banner */}
        {tool === 'room-poly' && polyPoints.length > 0 && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur border border-slate-200 shadow-xl rounded-2xl px-3 sm:px-4 py-2 flex flex-wrap items-center justify-center gap-2 sm:gap-3 z-30 max-w-[95vw] w-max">
            <span className="text-xs text-slate-800 font-medium">
              Pièce polygone : <strong>{polyPoints.length} point{polyPoints.length > 1 ? 's' : ''}</strong>
            </span>
            <button
              type="button"
              disabled={polyPoints.length < 3}
              onClick={finishPolyRoom}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40 shadow-xs"
            >
              Terminer la pièce (fermer)
            </button>
            <button
              type="button"
              onClick={() => {
                setPolyPoints([]);
                setPolyPreview(null);
                setTool('select');
              }}
              className="px-2.5 py-1.5 rounded-xl text-slate-500 hover:bg-slate-100 text-xs"
            >
              Annuler
            </button>
          </div>
        )}

        {/* Locked Toast Notification */}
        {showLockedToast && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-slate-900/90 text-white text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-xl z-50 flex items-center gap-2 border border-slate-700 animate-in fade-in max-w-[92vw] w-max">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{showLockedToast}</span>
          </div>
        )}

        {/* Bottom Floating Toolbar (Touch Friendly, with Mur Ext. & Mur Int.) */}
        <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur border border-slate-200 shadow-lg rounded-2xl p-1.5 flex items-center gap-1 max-w-[96vw] overflow-x-auto scrollbar-none z-20">
          <ToolButton
            active={tool === 'select'}
            onClick={() => setTool('select')}
            icon={<MousePointer2 className="w-5 h-5" />}
            label="Sélect."
          />
          <ToolButton
            active={tool === 'pan'}
            onClick={() => setTool('pan')}
            icon={<Hand className="w-5 h-5" />}
            label="Déplacer"
          />
          <div className="w-px h-8 bg-slate-200 mx-0.5" />
          <ToolButton
            active={tool === 'wall-ext'}
            onClick={() => {
              setTool('wall-ext');
              setLockStructure(false);
              setShowStructure(true);
              setWallStart(null);
              setWallPreview(null);
            }}
            icon={<PenLine className="w-5 h-5" />}
            label="Mur Ext."
            title="Étape 1 : Tracer les murs extérieurs (segment ou contour 4 murs)"
          />
          <ToolButton
            active={tool === 'wall-int'}
            onClick={() => {
              setTool('wall-int');
              setLockStructure(false);
              setShowStructure(true);
              setWallStart(null);
              setWallPreview(null);
            }}
            icon={<Ruler className="w-5 h-5" />}
            label="Mur Int."
            title="Étape 2 : Tracer les murs intérieurs / cloisons sans restriction"
          />
          <ToolButton
            active={tool === 'room'}
            onClick={() => {
              setTool('room');
              setLockStructure(false);
              setShowStructure(true);
            }}
            icon={<Square className="w-5 h-5" />}
            label="Pièce (Rect.)"
          />
          <ToolButton
            active={tool === 'room-poly'}
            onClick={() => {
              setTool('room-poly');
              setLockStructure(false);
              setShowStructure(true);
              setPolyPoints([]);
            }}
            icon={<Shapes className="w-5 h-5" />}
            label="Pièce (Poly.)"
          />
          <ToolButton
            active={tool === 'door'}
            onClick={() => {
              setTool('door');
              setLockStructure(false);
              setShowStructure(true);
            }}
            icon={<DoorOpen className="w-5 h-5" />}
            label="Porte"
          />
          <ToolButton
            active={tool === 'window'}
            onClick={() => {
              setTool('window');
              setLockStructure(false);
              setShowStructure(true);
            }}
            icon={<AppWindow className="w-5 h-5" />}
            label="Fenêtre"
          />
          <ToolButton
            active={tool === 'arch-passage'}
            onClick={() => {
              setTool('arch-passage');
              setLockStructure(false);
              setShowStructure(true);
            }}
            icon={<Shapes className="w-5 h-5" />}
            label="Arche / Ouv."
          />
          <div className="w-px h-8 bg-slate-200 mx-0.5" />
          <ToolButton
            active={showFurnitureDrawer}
            onClick={() => setShowFurnitureDrawer((s) => !s)}
            icon={<Armchair className="w-5 h-5" />}
            label="Meubles"
          />
          <div className="w-px h-8 bg-slate-200 mx-0.5" />
          <ToolButton
            active={false}
            disabled={history.length === 0}
            onClick={handleUndo}
            icon={<Undo2 className="w-5 h-5" />}
            label="Annuler"
            title="Annuler (Ctrl + Z)"
          />
          <ToolButton
            active={false}
            disabled={redoHistory.length === 0}
            onClick={handleRedo}
            icon={<Redo2 className="w-5 h-5" />}
            label="Rétablir"
            title="Rétablir (Ctrl + Y)"
          />
        </div>

        {/* Zoom & Scale Bar (Bottom Right, shifted when inspector is open to prevent overlap) */}
        <div
          className={`absolute bottom-20 flex flex-col gap-2 transition-all z-10 ${
            selection ? 'left-4 items-start md:left-auto md:right-[21.5rem] md:items-end' : 'right-4 items-end'
          }`}
        >
          {/* Orientation Sud (Boussole 2D -> Soleil 3D) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCompassPanel((v) => !v)}
              title={`Orientation Sud : ${floor.southAngleDeg ?? 0}° (cliquer pour orienter le soleil 3D)`}
              className="bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-md px-2.5 py-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:border-amber-300"
            >
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-bold text-[10px] transition-transform"
                style={{ transform: `rotate(${floor.southAngleDeg ?? 0}deg)` }}
              >
                <Compass className="w-4 h-4" />
              </span>
              <span>Sud {floor.southAngleDeg ?? 0}°</span>
            </button>

            {showCompassPanel && (
              <div
                className={`absolute bottom-full mb-2 w-56 bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-xl p-3 space-y-2.5 z-30 ${
                  selection ? 'left-0 md:left-auto md:right-0' : 'right-0'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-amber-500" />
                    Orientation du Sud
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCompassPanel(false)}
                    aria-label="Fermer"
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex justify-center py-1">
                  <div className="relative w-16 h-16 rounded-full border-2 border-slate-200 bg-slate-50 flex items-center justify-center">
                    <div
                      className="w-full h-full flex flex-col items-center justify-between py-1 transition-transform"
                      style={{ transform: `rotate(${floor.southAngleDeg ?? 0}deg)` }}
                    >
                      <span className="text-[10px] font-bold text-slate-400">N</span>
                      <span className="text-xs font-extrabold text-amber-600">S ↓</span>
                    </div>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={355}
                  step={5}
                  value={floor.southAngleDeg ?? 0}
                  onChange={(e) => commitFloor({ ...floor, southAngleDeg: Number(e.target.value) })}
                  className="w-full accent-amber-500 h-1.5"
                />
                <div className="grid grid-cols-4 gap-1 text-[10px] font-semibold">
                  {[
                    ['Bas', 0],
                    ['Gauche', 90],
                    ['Haut', 180],
                    ['Droite', 270],
                  ].map(([lbl, deg]) => (
                    <button
                      key={String(lbl)}
                      type="button"
                      onClick={() => commitFloor({ ...floor, southAngleDeg: Number(deg) })}
                      className={`py-1 rounded-lg border ${
                        (floor.southAngleDeg ?? 0) === deg
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-md p-1 flex flex-col gap-1">
            <button
              onClick={() => setZoom((z) => Math.min(3.0, z * 1.2))}
              className="p-2.5 hover:bg-slate-100 rounded-lg text-slate-700"
              title="Zoom +"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))}
              className="p-2.5 hover:bg-slate-100 rounded-lg text-slate-700"
              title="Zoom -"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                setZoom(0.85);
                setPan({ x: 140, y: 60 });
              }}
              className="p-2.5 hover:bg-slate-100 rounded-lg text-slate-700"
              title="Recentrer"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-white/90 px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-xs text-[11px] font-medium text-slate-700 flex flex-col items-center">
            <div className="flex justify-between w-full mb-0.5 px-0.5">
              <span>0</span>
              <span>1</span>
              <span>2 m</span>
            </div>
            <div className="flex border border-slate-800 h-2" style={{ width: `${200 * PX_PER_CM * zoom}px` }}>
              <div className="w-1/2 bg-slate-800" />
              <div className="w-1/2 bg-white" />
            </div>
          </div>
        </div>

        {/* Properties Inspector (Top Right when something is selected) */}
        {selection && (
          <div className="absolute top-3 right-3 w-[calc(100vw-1.5rem)] sm:w-80 max-w-[calc(100%-1.5rem)] max-h-[55dvh] sm:max-h-[calc(100%-6rem)] overflow-y-auto bg-white/95 backdrop-blur border border-slate-200 rounded-2xl shadow-xl p-4 z-20">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm truncate min-w-0">
                {selectedWall &&
                  (selectedWall.wallType === 'interior' || selectedWall.thicknessCm <= 14
                    ? 'Mur intérieur (Cloison)'
                    : 'Mur extérieur / porteur')}
                {selectedRoom && 'Pièce / Zone'}
                {selectedFurniture && selectedFurniture.label}
                {selectedOpening && 'Ouverture'}
              </h3>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={deleteSelected}
                  disabled={isSelectionLocked}
                  className={`p-2 rounded-lg transition-colors ${
                    isSelectionLocked
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                  title={
                    isSelectionLocked
                      ? 'Élément verrouillé (déverrouillez le cadenas en haut pour supprimer)'
                      : 'Supprimer (Touche Suppr)'
                  }
                >
                  {isSelectionLocked ? <Lock className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setSelection(null)}
                  aria-label="Fermer l'inspecteur"
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {selectedWall && (
              <div className="space-y-3 text-sm">
                {/* 1. Distances ENTRE les murs (Espacement aux murs parallèles voisins) */}
                <div className="p-2.5 rounded-xl bg-indigo-50/80 border border-indigo-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-950 flex items-center gap-1">
                      <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-600" />
                      Dimensions entre les murs (cm)
                    </span>
                  </div>

                  {selectedWallFacings.length === 0 ? (
                    <p className="text-[11px] text-slate-500">
                      Aucun mur parallèle en face détecté pour ce mur.
                    </p>
                  ) : (
                    selectedWallFacings.map((facing) => (
                      <label key={facing.otherWall.id} className="block">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-slate-700 font-medium">
                            Vers mur <strong>{facing.directionLabel}</strong> :
                          </span>
                          <span className="text-xs font-bold text-indigo-700">
                            {formatCm(facing.clearDistanceCm)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <NumericInput
                            step={0.1}
                            min={0.5}
                            max={5000}
                            disabled={lockStructure}
                            value={facing.clearDistanceCm}
                            onCommit={(val) =>
                              handleUpdateInterWallDistance(selectedWall.id, facing.otherWall.id, val)
                            }
                            className="w-full px-2.5 py-1.5 bg-white border border-indigo-300 rounded-lg text-sm font-bold text-slate-900"
                          />
                          <span className="text-xs text-slate-600 font-semibold">cm</span>
                        </div>
                      </label>
                    ))
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cascadeSpacingMode}
                        onChange={(e) => setCascadeSpacingMode(e.target.checked)}
                        className="rounded border-indigo-300 text-indigo-600"
                      />
                      Tout décaler en cascade
                    </label>
                  </div>
                  <p className="text-[10px] text-indigo-700/80 leading-tight">
                    Modifiez cette valeur (ex: <strong>12,5</strong>) pour ajuster l’espacement : les murs et pièces suivants suivent automatiquement.
                  </p>
                </div>

                {/* 2. Longueur du mur (avec décimales ex: 12,5 cm) */}
                <label className="block">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-slate-600 font-semibold">Longueur du mur (cm)</span>
                    <span className="text-xs font-bold text-blue-600">
                      {formatCm(wallLengthCm(selectedWall))} ({formatMeters(wallLengthCm(selectedWall), 'm')})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <NumericInput
                      step={0.1}
                      min={0.5}
                      max={5000}
                      disabled={lockStructure}
                      value={wallLengthCm(selectedWall)}
                      onCommit={(val) => handleUpdateWallLength(selectedWall.id, val)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <span className="text-xs text-slate-500 font-semibold">cm</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1.5">
                    {[-10, -1, -0.5, +0.5, +1, +10].map((delta) => {
                      const cur = wallLengthCm(selectedWall);
                      return (
                        <button
                          key={delta}
                          type="button"
                          disabled={lockStructure || cur + delta < 0.5}
                          onClick={() => handleUpdateWallLength(selectedWall.id, Math.max(0.5, cur + delta))}
                          className="flex-1 py-1 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-30 rounded text-[10px] font-semibold transition-colors"
                        >
                          {delta > 0 ? `+${String(delta).replace('.', ',')}` : String(delta).replace('.', ',')}
                        </button>
                      );
                    })}
                  </div>
                </label>

                {/* 3. Type de mur & Épaisseur (avec décimales ex: 12,5 cm) */}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-slate-500">Type de mur</span>
                    <select
                      disabled={lockStructure}
                      value={selectedWall.wallType ?? (selectedWall.thicknessCm <= 14 ? 'interior' : 'exterior')}
                      onChange={(e) => {
                        const nextType = e.target.value as 'exterior' | 'interior';
                        commitFloor({
                          ...floor,
                          walls: floor.walls.map((w) =>
                            w.id === selectedWall.id
                              ? {
                                  ...w,
                                  wallType: nextType,
                                  thicknessCm: nextType === 'interior' ? 10 : 20,
                                }
                              : w
                          ),
                        });
                      }}
                      className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white text-xs font-medium"
                    >
                      <option value="exterior">Extérieur</option>
                      <option value="interior">Intérieur</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs text-slate-500">Épaisseur (cm)</span>
                    <NumericInput
                      step={0.1}
                      min={1}
                      max={200}
                      disabled={lockStructure}
                      value={selectedWall.thicknessCm}
                      onCommit={(val) =>
                        commitFloor({
                          ...floor,
                          walls: floor.walls.map((w) =>
                            w.id === selectedWall.id ? { ...w, thicknessCm: val } : w
                          ),
                        })
                      }
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs text-slate-500">Hauteur spécifique (cm)</span>
                  <NumericInput
                    step={0.5}
                    min={1}
                    max={600}
                    disabled={lockStructure}
                    value={selectedWall.heightCm ?? floor.defaultWallHeightCm}
                    onCommit={(val) =>
                      commitFloor({
                        ...floor,
                        walls: floor.walls.map((w) =>
                          w.id === selectedWall.id ? { ...w, heightCm: val } : w
                        ),
                      })
                    }
                    className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </label>

                <div className="flex justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
                  <span>Surface murale :</span>
                  <strong className="text-slate-800">
                    {formatAreaM2(
                      (wallLengthCm(selectedWall) / 100) *
                        ((selectedWall.heightCm ?? floor.defaultWallHeightCm) / 100)
                    )}
                  </strong>
                </div>
              </div>
            )}

            {selectedRoom && (
              <div className="space-y-2.5 text-sm">
                <label className="block">
                  <span className="text-xs text-slate-500">Nom de la pièce / zone</span>
                  <input
                    type="text"
                    disabled={lockStructure}
                    value={selectedRoom.name}
                    onChange={(e) =>
                      commitFloor({
                        ...floor,
                        rooms: floor.rooms.map((r) =>
                          r.id === selectedRoom.id ? { ...r, name: e.target.value } : r
                        ),
                      })
                    }
                    className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Revêtement / Sol</span>
                  <select
                    disabled={lockStructure}
                    value={selectedRoom.floorType}
                    onChange={(e) => {
                      const nextFloorType = e.target.value as FloorMaterial;
                      commitFloor({
                        ...floor,
                        rooms: floor.rooms.map((r) =>
                          r.id === selectedRoom.id
                            ? {
                                ...r,
                                floorType: nextFloorType,
                                color: FLOOR_MATERIAL_LABELS[nextFloorType]?.color,
                              }
                            : r
                        ),
                      });
                    }}
                    className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {Object.entries(FLOOR_MATERIAL_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pt-1 border-t border-slate-100 space-y-1 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>Surface au sol :</span>
                    <strong className="text-slate-900">{formatAreaM2(polygonAreaM2(selectedRoom.points))}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Surface des murs :</span>
                    <strong className="text-slate-900">
                      {formatAreaM2(
                        polygonPerimeterM(selectedRoom.points) *
                          ((selectedRoom.wallHeightCm ?? floor.defaultWallHeightCm) / 100)
                      )}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {selectedOpening && (() => {
              const parentWall = floor.walls.find((w) => w.id === selectedOpening.wallId);
              const cornerDists = parentWall
                ? getOpeningCornerDistancesCm(selectedOpening, parentWall)
                : null;
              const patchOpening = (patch: Partial<Opening>) =>
                commitFloor({
                  ...floor,
                  openings: floor.openings.map((o) =>
                    o.id === selectedOpening.id ? { ...o, ...patch } : o
                  ),
                });

              return (
                <div className="space-y-2.5 text-sm">
                  <label className="block">
                    <span className="text-xs text-slate-500">Type d’ouverture</span>
                    <select
                      disabled={lockStructure}
                      value={selectedOpening.type}
                      onChange={(e) => {
                        const nextType = e.target.value as OpeningType;
                        patchOpening({
                          type: nextType,
                          archShape:
                            nextType === 'arch-passage'
                              ? selectedOpening.archShape ?? 'half-circle'
                              : selectedOpening.archShape,
                          hasFrame: nextType === 'arch-passage' ? false : selectedOpening.hasFrame ?? true,
                          sillHeightCm:
                            nextType === 'window' || nextType === 'interior-glass' || nextType === 'pass-through'
                              ? selectedOpening.sillHeightCm ?? 100
                              : 0,
                          glassMullions:
                            nextType === 'interior-glass'
                              ? selectedOpening.glassMullions ?? 4
                              : selectedOpening.glassMullions,
                        });
                      }}
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-xs font-semibold"
                    >
                      {Object.entries(OPENING_TYPE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs text-slate-500">Largeur (cm)</span>
                      <NumericInput
                        step={0.5}
                        min={10}
                        max={1000}
                        disabled={lockStructure}
                        value={selectedOpening.widthCm}
                        onCommit={(val) => patchOpening({ widthCm: val })}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-500">Hauteur (cm)</span>
                      <NumericInput
                        step={0.5}
                        min={20}
                        max={400}
                        disabled={lockStructure}
                        value={selectedOpening.heightCm}
                        onCommit={(val) => patchOpening({ heightCm: val })}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold"
                      />
                    </label>
                  </div>

                  {(selectedOpening.type === 'window' ||
                    selectedOpening.type === 'interior-glass' ||
                    selectedOpening.type === 'pass-through') && (
                    <label className="block">
                      <span className="text-xs text-slate-500">Hauteur d’allège (bas depuis le sol, cm)</span>
                      <NumericInput
                        step={1}
                        min={0}
                        max={220}
                        disabled={lockStructure}
                        value={selectedOpening.sillHeightCm ?? 100}
                        onCommit={(val) => patchOpening({ sillHeightCm: val })}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold"
                      />
                    </label>
                  )}

                  <label className="block">
                    <span className="text-xs text-slate-500">Forme haute / Arche</span>
                    <select
                      disabled={lockStructure}
                      value={selectedOpening.archShape ?? 'flat'}
                      onChange={(e) =>
                        patchOpening({ archShape: e.target.value as ArchShape })
                      }
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-xs font-semibold"
                    >
                      {Object.entries(ARCH_SHAPE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedOpening.archShape && selectedOpening.archShape !== 'flat' && (
                    <label className="block">
                      <span className="text-xs text-slate-500">Flèche / Courbure arche (cm)</span>
                      <NumericInput
                        step={1}
                        min={5}
                        max={160}
                        disabled={lockStructure}
                        value={
                          selectedOpening.archRiseCm ??
                          Math.round(selectedOpening.widthCm / 2)
                        }
                        onCommit={(val) => patchOpening({ archRiseCm: val })}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold"
                      />
                    </label>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={lockStructure}
                        checked={selectedOpening.hasFrame ?? selectedOpening.type !== 'arch-passage'}
                        onChange={(e) => patchOpening({ hasFrame: e.target.checked })}
                      />
                      Cadre / Montants
                    </label>
                    {(selectedOpening.hasFrame ?? selectedOpening.type !== 'arch-passage') && (
                      <input
                        type="color"
                        disabled={lockStructure}
                        value={selectedOpening.frameColor ?? '#334155'}
                        onChange={(e) => patchOpening({ frameColor: e.target.value })}
                        className="w-8 h-7 rounded border border-slate-300 cursor-pointer"
                        title="Couleur du cadre / verrière"
                      />
                    )}
                  </div>

                  {(selectedOpening.type === 'interior-glass' || selectedOpening.type === 'window') && (
                    <label className="block">
                      <span className="text-xs text-slate-500">Nombre de carreaux / montants</span>
                      <NumericInput
                        step={1}
                        min={1}
                        max={12}
                        disabled={lockStructure}
                        value={selectedOpening.glassMullions ?? (selectedOpening.type === 'interior-glass' ? 4 : 2)}
                        onCommit={(val) => patchOpening({ glassMullions: Math.round(val) })}
                        className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold"
                      />
                    </label>
                  )}

                  {cornerDists && (
                    <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-2.5 space-y-2">
                      <div className="text-[11px] font-bold text-indigo-900">
                        Position exacte sur le mur ({formatCm(cornerDists.wallLengthCm)})
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-[10px] text-slate-600">Depuis début (cm)</span>
                          <NumericInput
                            step={0.5}
                            min={0}
                            max={cornerDists.wallLengthCm}
                            disabled={lockStructure}
                            value={cornerDists.distFromStartCm}
                            onCommit={(val) =>
                              commitFloor(
                                updateOpeningCornerDistanceCm(floor, selectedOpening.id, 'start', val)
                              )
                            }
                            className="mt-0.5 w-full px-2 py-1 border border-indigo-200 rounded-lg text-xs font-bold bg-white"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-slate-600">Depuis fin (cm)</span>
                          <NumericInput
                            step={0.5}
                            min={0}
                            max={cornerDists.wallLengthCm}
                            disabled={lockStructure}
                            value={cornerDists.distFromEndCm}
                            onCommit={(val) =>
                              commitFloor(
                                updateOpeningCornerDistanceCm(floor, selectedOpening.id, 'end', val)
                              )
                            }
                            className="mt-0.5 w-full px-2 py-1 border border-indigo-200 rounded-lg text-xs font-bold bg-white"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {selectedOpening.type === 'door' && (
                    <div className="space-y-2 pt-1">
                      <span className="text-xs font-semibold text-slate-600 block">
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
                              disabled={lockStructure}
                              onClick={() => patchOpening({ flip: opt.flip, hinge: opt.hinge })}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-40 ${
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
                          disabled={lockStructure}
                          onClick={() => patchOpening({ flip: !selectedOpening.flip })}
                          className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-medium text-slate-700 disabled:opacity-40"
                        >
                          Inverser Int. / Ext.
                        </button>
                        <button
                          type="button"
                          disabled={lockStructure}
                          onClick={() =>
                            patchOpening({
                              hinge: (selectedOpening.hinge ?? 'left') === 'left' ? 'right' : 'left',
                            })
                          }
                          className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-medium text-slate-700 disabled:opacity-40"
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
                      disabled={lockStructure}
                      onClick={() => patchOpening({ flip: !selectedOpening.flip })}
                      className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-medium disabled:opacity-40"
                    >
                      Inverser le sens d’ouverture
                    </button>
                  )}
                </div>
              );
            })()}

            {selectedFurniture && (
              <div className="space-y-2.5 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-slate-500">Largeur (cm)</span>
                    <NumericInput
                      step={0.5}
                      min={1}
                      max={2000}
                      disabled={lockFurniture}
                      value={selectedFurniture.widthCm}
                      onCommit={(val) =>
                        commitFloor({
                          ...floor,
                          furniture: floor.furniture.map((f) =>
                            f.id === selectedFurniture.id ? { ...f, widthCm: val } : f
                          ),
                        })
                      }
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">Profondeur (cm)</span>
                    <NumericInput
                      step={0.5}
                      min={1}
                      max={2000}
                      disabled={lockFurniture}
                      value={selectedFurniture.depthCm}
                      onCommit={(val) =>
                        commitFloor({
                          ...floor,
                          furniture: floor.furniture.map((f) =>
                            f.id === selectedFurniture.id ? { ...f, depthCm: val } : f
                          ),
                        })
                      }
                      className="mt-1 w-full px-2.5 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                </div>
                <button
                  disabled={lockFurniture}
                  onClick={() =>
                    commitFloor({
                      ...floor,
                      furniture: floor.furniture.map((f) =>
                        f.id === selectedFurniture.id ? { ...f, rotation: (f.rotation + 45) % 360 } : f
                      ),
                    })
                  }
                  className="w-full py-2.5 px-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <RotateCw className="w-4 h-4" /> Pivoter +45° ({selectedFurniture.rotation}°)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Furniture Catalog Drawer */}
        {showFurnitureDrawer && (
          <div
            className={`absolute bottom-20 -translate-x-1/2 w-[92vw] max-w-xl bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-30 transition-all ${
              selection ? 'left-1/2 lg:left-[calc(50%-10.5rem)]' : 'left-1/2'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm sm:text-base">Bibliothèque de Meubles & Équipements</h3>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    setShowFurnitureDrawer(false);
                    setShowWebCatalogModal(true);
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Importer du Web
                </button>
                <button
                  onClick={() => setShowFurnitureDrawer(false)}
                  className="text-sm text-slate-500 hover:text-slate-800 px-2 py-1"
                >
                  Fermer
                </button>
              </div>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFurnitureCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap ${
                    furnitureCategory === cat ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto">
              {FURNITURE_CATALOG.filter((c) => c.category === furnitureCategory).map((entry) => (
                <button
                  key={entry.type}
                  onClick={() => addFurnitureFromCatalog(entry)}
                  className="p-3 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 text-left transition-colors"
                >
                  <div className="font-medium text-sm text-slate-900">{entry.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {entry.widthCm} × {entry.depthCm} cm
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Manage Active Floor Modal (Rename, Reorder, Delete) */}
        {showManageFloorModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg text-slate-900">Gérer l’étage</h3>
                <button
                  type="button"
                  onClick={() => setShowManageFloorModal(false)}
                  aria-label="Fermer"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">Nom de l’étage</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={manageFloorName}
                    onChange={(e) => setManageFloorName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && manageFloorName.trim()) {
                        onRenameFloor(floor.id, manageFloorName.trim());
                        setShowManageFloorModal(false);
                      }
                    }}
                    className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-xl text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!manageFloorName.trim()) return;
                      onRenameFloor(floor.id, manageFloorName.trim());
                      setShowManageFloorModal(false);
                    }}
                    className="px-3.5 py-2 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
                  >
                    Renommer
                  </button>
                </div>
              </div>

              {allFloors.length > 1 && (
                <div className="space-y-1.5 pt-1 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-600">Ordre d’affichage</label>
                  <div className="flex gap-2">
                    {(() => {
                      const sorted = [...allFloors].sort((a, b) => a.order - b.order);
                      const idx = sorted.findIndex((f) => f.id === floor.id);
                      return (
                        <>
                          <button
                            type="button"
                            disabled={idx <= 0}
                            onClick={() => onReorderFloor(floor.id, 'left')}
                            className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40 flex items-center justify-center gap-1.5"
                          >
                            <ArrowLeft className="w-3.5 h-3.5" /> Déplacer à gauche
                          </button>
                          <button
                            type="button"
                            disabled={idx === -1 || idx >= sorted.length - 1}
                            onClick={() => onReorderFloor(floor.id, 'right')}
                            className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40 flex items-center justify-center gap-1.5"
                          >
                            Déplacer à droite <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {allFloors.length > 1 && (
                <div className="pt-2 border-t border-slate-100">
                  {!confirmDeleteFloor ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteFloor(true)}
                      className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Supprimer cet étage
                    </button>
                  ) : (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-rose-700 font-medium">
                        Supprimer « {floor.name} » et tous ses murs, pièces et meubles ?
                      </p>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteFloor(false)}
                          className="px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-white"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteFloor(floor.id);
                            setShowManageFloorModal(false);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
                        >
                          Confirmer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* New Floor Modal */}
        {showNewFloorModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto p-5 space-y-4">
              <h3 className="font-semibold text-lg text-slate-900">Ajouter un étage / extérieur</h3>
              <input
                type="text"
                placeholder="Ex: Étage 2, Combles, Jardin..."
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm"
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={newFloorExterior}
                  onChange={(e) => setNewFloorExterior(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                Zone extérieure (terrasse, jardin, façade)
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowNewFloorModal(false)}
                  className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    if (!newFloorName.trim()) return;
                    onAddFloor(newFloorName.trim(), newFloorExterior);
                    setNewFloorName('');
                    setNewFloorExterior(false);
                    setShowNewFloorModal(false);
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
                >
                  Créer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Floor Tutorial Modal */}
        <FloorTutorialModal isOpen={showTutorialModal} onClose={() => setShowTutorialModal(false)} />

        {/* AI Plan Generator Modal */}
        <AIPlanGeneratorModal
          isOpen={showAIPlanModal}
          currentFloor={floor}
          onClose={() => setShowAIPlanModal(false)}
          onOpenSettings={() => onOpenAISettings?.()}
          onApplyPlan={applyGeneratedAIPlan}
        />

        {/* Web Catalog Importer Modal */}
        <WebCatalogModal
          isOpen={showWebCatalogModal}
          onClose={() => setShowWebCatalogModal(false)}
          onAddFurnitureToPlan={addWebProductToPlan}
        />
      </div>
    </div>
  );
};

const ToolButton: React.FC<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
}> = ({ active, disabled, onClick, icon, label, title }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`flex flex-col items-center justify-center px-3 py-1.5 rounded-xl min-w-[56px] min-h-[48px] transition-colors ${
      disabled
        ? 'opacity-35 cursor-not-allowed text-slate-400'
        : active
        ? 'bg-slate-900 text-white shadow-xs'
        : 'text-slate-700 hover:bg-slate-100'
    }`}
  >
    {icon}
    <span className="text-[10px] font-medium mt-0.5">{label}</span>
  </button>
);
