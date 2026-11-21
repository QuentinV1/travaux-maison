export type FloorMaterial =
  | 'tile'
  | 'tile-marble'
  | 'terrazzo'
  | 'cement-tile'
  | 'wood'
  | 'wood-herringbone'
  | 'wood-dark'
  | 'carpet'
  | 'concrete'
  | 'grass'
  | 'deck';

export type WallMaterial =
  | 'paint-matte'
  | 'paint-velvet'
  | 'paint-satin'
  | 'plaster-concrete'
  | 'brick-red'
  | 'brick-white'
  | 'stone'
  | 'wood-slats'
  | 'wood-slats-walnut'
  | 'tile-subway'
  | 'tile-zellige'
  | 'tile-marble'
  | 'wallpaper'
  | 'claustra';

export type SurfacePatternType =
  | 'none'
  | 'checkerboard'
  | 'stripes-vertical'
  | 'stripes-horizontal'
  | 'herringbone-wallpaper'
  | 'terrazzo-dots'
  | 'geometric-diamond';

export interface SurfacePattern {
  type: SurfacePatternType;
  primaryColor: string;
  secondaryColor: string;
  scaleCm?: number; // repeat size in cm (default 40)
}

export interface Point {
  x: number; // in cm
  y: number; // in cm
}

export interface Wall {
  id: string;
  x1: number; // in cm
  y1: number; // in cm
  x2: number; // in cm
  y2: number; // in cm
  thicknessCm: number;
  heightCm?: number; // overrides floor.defaultWallHeightCm if set
  wallType?: 'exterior' | 'interior';
  colorFront?: string;
  colorBack?: string;
  materialFront?: WallMaterial;
  materialBack?: WallMaterial;
  patternFront?: SurfacePattern;
  patternBack?: SurfacePattern;
  textureUrlFront?: string;
  textureUrlBack?: string;
  isLowWall?: boolean;
}

export type OpeningType =
  | 'door'
  | 'window'
  | 'sliding-door'
  | 'arch-passage'
  | 'interior-glass'
  | 'pass-through'
  | 'pocket-door'
  | 'double-door';

export type ArchShape =
  | 'flat'
  | 'half-circle'
  | 'segmental'
  | 'rounded-corners'
  | 'asymmetric'
  | 'pointed';

export interface Opening {
  id: string;
  wallId: string;
  type: OpeningType;
  offsetRatio: number; // 0..1 along wall
  widthCm: number;
  heightCm: number;
  flip: boolean;
  hinge?: 'left' | 'right';
  archShape?: ArchShape;
  archRiseCm?: number;
  sillHeightCm?: number;
  hasFrame?: boolean;
  frameColor?: string;
  frameThicknessCm?: number;
  glassMullions?: number;
}

export interface RoomZone {
  id: string;
  name: string;
  points: Point[]; // polygon in cm
  floorType: FloorMaterial;
  wallHeightCm?: number;
  color?: string;
  floorOrientationDeg?: number;
  floorScale?: number;
  ceilingColor?: string;
  ceilingBeams?: boolean;
  ceilingPattern?: SurfacePattern;
  aiRenderUrl?: string;
  aiRenderIs360?: boolean;
  aiRenderPrompt?: string;
}

export type FurnitureMaterialType =
  | 'boucle'
  | 'linen'
  | 'velvet'
  | 'corduroy'
  | 'leather'
  | 'wood-oak'
  | 'wood-walnut'
  | 'wood-black'
  | 'marble-white'
  | 'marble-black'
  | 'metal-black'
  | 'metal-brass'
  | 'metal-chrome'
  | 'glass';

export type FurnitureType =
  | 'sofa'
  | 'corner-sofa'
  | 'armchair'
  | 'coffee-table'
  | 'tv-stand'
  | 'dining-table'
  | 'bed-double'
  | 'bed-single'
  | 'wardrobe'
  | 'desk'
  | 'kitchen-counter'
  | 'kitchen-island'
  | 'sink'
  | 'stove'
  | 'fridge'
  | 'shower'
  | 'bathtub'
  | 'toilet'
  | 'stairs'
  | 'fireplace'
  | 'plant'
  | 'tree'
  | 'flower-bed'
  | 'hedge'
  | 'low-wall'
  | 'gate'
  | 'sliding-gate'
  | 'wicket-gate'
  | 'outdoor-table'
  | 'lounger';

export interface FurnitureItem {
  id: string;
  type: FurnitureType;
  label: string;
  x: number; // center x in cm
  y: number; // center y in cm
  widthCm: number;
  depthCm: number;
  heightCm?: number; // optional custom 3D height in cm
  rotation: number; // degrees
  color?: string;
  price?: number; // estimated or web price in EUR
  store?: string; // e.g., Leroy Merlin, Maisons du Monde, Castorama, Brico Dépôt
  productUrl?: string; // link to product page
  imageUrl?: string; // optional product thumbnail
  variant?: string;
  materialType?: FurnitureMaterialType;
  secondaryColor?: string;
  elevationCm?: number;
  renderMode3D?: 'parametric' | 'photo-texture' | 'photo-billboard' | 'photo-volumetric' | 'glb';
  cutoutDataUrl?: string;
  glbDataUrl?: string;
}

export interface AppSettings {
  geminiApiKey: string;
  comfyUiUrl?: string;
}

export interface Floor {
  id: string;
  houseId: string;
  name: string;
  order: number;
  isExterior: boolean;
  defaultWallHeightCm: number;
  southAngleDeg?: number; // 0 = Sud en bas (+Y), 90 = Ouest/Gauche (-X), 180 = Haut (-Y), 270 = Est/Droite (+X)
  walls: Wall[];
  openings: Opening[];
  rooms: RoomZone[];
  furniture: FurnitureItem[];
  lockedDimensionIds?: string[];
  importedGlbUrl?: string;
}

export interface House {
  id: string;
  name: string;
  address?: string;
  notes?: string;
  createdAt: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskItem {
  id: string;
  houseId: string;
  floorId?: string;
  roomName?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  createdAt: string;
}

export interface ShoppingItem {
  id: string;
  taskId: string;
  houseId: string;
  name: string;
  quantity: number;
  unit: string;
  store?: string;
  checked: boolean;
  estimatedPrice?: number;
}

export type PhotoPhase = 'before' | 'during' | 'after';

export interface RoomPhoto {
  id: string;
  houseId: string;
  floorId: string;
  roomName: string;
  phase: PhotoPhase;
  caption: string;
  dataUrl: string;
  createdAt: string;
}

export type AppTab = 'plan' | 'tasks' | 'maintenance' | 'photos' | '3d';

export type EquipmentCategory =
  | 'heat_pump'
  | 'heating'
  | 'radiator'
  | 'electricity'
  | 'plumbing'
  | 'ventilation'
  | 'other';

export interface MaintenanceEquipment {
  id: string;
  houseId: string;
  name: string;
  category: EquipmentCategory;
  location?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  installedAt?: string;
  periodicityMonths: number;
  lastServiceDate?: string;
  nextServiceDate?: string;
  estimatedAnnualCost?: number;
  providerId?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ServiceProvider {
  id: string;
  houseId: string;
  companyName: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  specialty?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface MaintenanceIntervention {
  id: string;
  houseId: string;
  equipmentId: string;
  providerId?: string;
  date: string;
  title: string;
  cost?: number;
  nextDueDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export type MaintenanceDocType =
  | 'invoice'
  | 'quote'
  | 'certificate'
  | 'manual'
  | 'photo'
  | 'other';

export interface MaintenanceDocument {
  id: string;
  houseId: string;
  equipmentId?: string;
  interventionId?: string;
  providerId?: string;
  docType: MaintenanceDocType;
  title: string;
  date?: string;
  amount?: number;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  createdAt: string;
}

export interface HouseSyncConfig {
  houseId: string;
  workspaceId: string;
  enabled: boolean;
  lastSyncedAt?: string;
}

export type CloudSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface CloudSyncState {
  initialSyncDone: boolean;
  syncedCols: Record<string, boolean>;
  syncStatus: CloudSyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
}
