import Dexie, { type EntityTable } from 'dexie';
import type { House, Floor, TaskItem, ShoppingItem, RoomPhoto } from './types';

class TravauxMaisonDB extends Dexie {
  houses!: EntityTable<House, 'id'>;
  floors!: EntityTable<Floor, 'id'>;
  tasks!: EntityTable<TaskItem, 'id'>;
  shoppingItems!: EntityTable<ShoppingItem, 'id'>;
  photos!: EntityTable<RoomPhoto, 'id'>;

  constructor() {
    super('TravauxMaisonDB');
    this.version(1).stores({
      houses: 'id, name, createdAt',
      floors: 'id, houseId, order',
      tasks: 'id, houseId, floorId, status, dueDate',
      shoppingItems: 'id, taskId, houseId, checked',
      photos: 'id, houseId, floorId, roomName, phase, createdAt',
    });
  }
}

export const db = new TravauxMaisonDB();

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

let seedPromise: Promise<void> | null = null;

/**
 * Seeds a realistic example house inspired by a standard floor plan
 * on first launch so the user can immediately explore and edit.
 */
export function seedInitialDataIfEmpty(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeedInitialDataIfEmpty().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeedInitialDataIfEmpty(): Promise<void> {
  const count = await db.houses.count();
  if (count > 0) return;

  const houseId = 'house_demo';
  const rdcId = 'floor_rdc';
  const etage1Id = 'floor_etage1';
  const extId = 'floor_ext';

  await db.houses.add({
    id: houseId,
    name: 'Ma Maison (Exemple)',
    address: '12 Rue des Lilas',
    notes: 'Rénovation séjour, cuisine et terrasse.',
    createdAt: new Date().toISOString(),
  });

  // Main RDC walls (in cm) — 11.4m x 8.8m footprint
  const walls = [
    // Outer shell
    { id: 'w1', x1: 200, y1: 100, x2: 1340, y2: 100, thicknessCm: 25 },
    { id: 'w2', x1: 1340, y1: 100, x2: 1340, y2: 980, thicknessCm: 25 },
    { id: 'w3', x1: 1340, y1: 980, x2: 200, y2: 980, thicknessCm: 25 },
    { id: 'w4', x1: 200, y1: 980, x2: 200, y2: 100, thicknessCm: 25 },
    // Interior partitions
    { id: 'w5', x1: 740, y1: 100, x2: 740, y2: 380, thicknessCm: 12 }, // Séjour / Cuisine
    { id: 'w6', x1: 740, y1: 380, x2: 1180, y2: 380, thicknessCm: 12 }, // Cuisine / Escalier
    { id: 'w7', x1: 740, y1: 380, x2: 740, y2: 980, thicknessCm: 12 }, // Séjour / Entrée-WC-SdE
    { id: 'w8', x1: 740, y1: 620, x2: 1340, y2: 620, thicknessCm: 12 }, // Entrée / Ch1-WC
    { id: 'w9', x1: 880, y1: 620, x2: 880, y2: 980, thicknessCm: 10 }, // WC-SdE / Ch1
    { id: 'w10', x1: 740, y1: 780, x2: 880, y2: 780, thicknessCm: 10 }, // WC / SdE
  ];

  const openings = [
    { id: 'op1', wallId: 'w2', type: 'door' as const, offsetRatio: 0.52, widthCm: 95, heightCm: 215, flip: false },
    { id: 'op2', wallId: 'w4', type: 'sliding-door' as const, offsetRatio: 0.25, widthCm: 180, heightCm: 215, flip: false },
    { id: 'op3', wallId: 'w4', type: 'sliding-door' as const, offsetRatio: 0.65, widthCm: 180, heightCm: 215, flip: false },
    { id: 'op4', wallId: 'w1', type: 'window' as const, offsetRatio: 0.78, widthCm: 140, heightCm: 120, flip: false },
    { id: 'op5', wallId: 'w2', type: 'window' as const, offsetRatio: 0.82, widthCm: 120, heightCm: 120, flip: false },
    { id: 'op6', wallId: 'w7', type: 'door' as const, offsetRatio: 0.22, widthCm: 85, heightCm: 205, flip: true },
    { id: 'op7', wallId: 'w8', type: 'door' as const, offsetRatio: 0.65, widthCm: 85, heightCm: 205, flip: false },
  ];

  const rooms = [
    {
      id: 'rm1',
      name: 'Séjour Salon',
      points: [
        { x: 200, y: 100 },
        { x: 740, y: 100 },
        { x: 740, y: 980 },
        { x: 200, y: 980 },
      ],
      floorType: 'tile' as const,
      color: '#f1f5f9',
    },
    {
      id: 'rm2',
      name: 'Cuisine',
      points: [
        { x: 740, y: 100 },
        { x: 1340, y: 100 },
        { x: 1340, y: 380 },
        { x: 740, y: 380 },
      ],
      floorType: 'tile' as const,
      color: '#ecfeff',
    },
    {
      id: 'rm3',
      name: 'Entrée',
      points: [
        { x: 740, y: 380 },
        { x: 1340, y: 380 },
        { x: 1340, y: 620 },
        { x: 740, y: 620 },
      ],
      floorType: 'tile' as const,
      color: '#f8fafc',
    },
    {
      id: 'rm4',
      name: 'Ch. 1',
      points: [
        { x: 880, y: 620 },
        { x: 1340, y: 620 },
        { x: 1340, y: 980 },
        { x: 880, y: 980 },
      ],
      floorType: 'wood' as const,
      color: '#fef3c7',
    },
    {
      id: 'rm5',
      name: 'WC',
      points: [
        { x: 740, y: 620 },
        { x: 880, y: 620 },
        { x: 880, y: 780 },
        { x: 740, y: 780 },
      ],
      floorType: 'tile' as const,
      color: '#f1f5f9',
    },
    {
      id: 'rm6',
      name: 'SdE',
      points: [
        { x: 740, y: 780 },
        { x: 880, y: 780 },
        { x: 880, y: 980 },
        { x: 740, y: 980 },
      ],
      floorType: 'tile' as const,
      color: '#e0f2fe',
    },
    {
      id: 'rm7',
      name: 'Terrasse',
      points: [
        { x: -120, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 980 },
        { x: -120, y: 980 },
      ],
      floorType: 'deck' as const,
      color: '#fef9c3',
    },
  ];

  const furniture = [
    { id: 'f1', type: 'dining-table' as const, label: 'Table à manger', x: 440, y: 260, widthCm: 180, depthCm: 100, rotation: 0 },
    { id: 'f2', type: 'sofa' as const, label: 'Canapé 3p', x: 420, y: 560, widthCm: 210, depthCm: 95, rotation: 0 },
    { id: 'f3', type: 'coffee-table' as const, label: 'Table basse', x: 420, y: 700, widthCm: 110, depthCm: 65, rotation: 0 },
    { id: 'f4', type: 'tv-stand' as const, label: 'Meuble TV', x: 690, y: 840, widthCm: 160, depthCm: 45, rotation: 90 },
    { id: 'f5', type: 'fireplace' as const, label: 'Poêle à bois', x: 660, y: 660, widthCm: 60, depthCm: 60, rotation: 0 },
    { id: 'f6', type: 'kitchen-counter' as const, label: 'Plan de travail', x: 1040, y: 140, widthCm: 520, depthCm: 65, rotation: 0 },
    { id: 'f7', type: 'kitchen-island' as const, label: 'Îlot central', x: 1020, y: 290, widthCm: 160, depthCm: 80, rotation: 0 },
    { id: 'f8', type: 'stairs' as const, label: 'Escalier', x: 960, y: 445, widthCm: 360, depthCm: 110, rotation: 0 },
    { id: 'f9', type: 'bed-double' as const, label: 'Lit Double', x: 1140, y: 830, widthCm: 160, depthCm: 200, rotation: 0 },
    { id: 'f10', type: 'toilet' as const, label: 'WC', x: 810, y: 720, widthCm: 45, depthCm: 65, rotation: 0 },
    { id: 'f11', type: 'shower' as const, label: 'Douche', x: 810, y: 850, widthCm: 90, depthCm: 90, rotation: 0 },
    { id: 'f12', type: 'outdoor-table' as const, label: 'Table jardin', x: 40, y: 480, widthCm: 160, depthCm: 95, rotation: 90 },
    { id: 'f13', type: 'lounger' as const, label: 'Transat', x: 80, y: 200, widthCm: 75, depthCm: 185, rotation: 15 },
    { id: 'f14', type: 'plant' as const, label: 'Plante', x: 255, y: 920, widthCm: 60, depthCm: 60, rotation: 0 },
  ];

  await db.floors.bulkAdd([
    {
      id: rdcId,
      houseId,
      name: 'Rez-de-chaussée',
      order: 1,
      isExterior: false,
      defaultWallHeightCm: 250,
      walls,
      openings,
      rooms,
      furniture,
    },
    {
      id: etage1Id,
      houseId,
      name: 'Étage 1',
      order: 2,
      isExterior: false,
      defaultWallHeightCm: 240,
      walls: [],
      openings: [],
      rooms: [],
      furniture: [],
    },
    {
      id: extId,
      houseId,
      name: 'Extérieur & Jardin',
      order: 0,
      isExterior: true,
      defaultWallHeightCm: 120,
      walls: [],
      openings: [],
      rooms: [],
      furniture: [],
    },
  ]);

  const task1Id = 'task_peinture';
  const task2Id = 'task_terrasse';

  await db.tasks.bulkAdd([
    {
      id: task1Id,
      houseId,
      floorId: rdcId,
      roomName: 'Séjour Salon',
      title: 'Peindre les murs du Séjour en blanc mat',
      description: '2 couches + sous-couche sur les murs périphériques.',
      status: 'in_progress',
      priority: 'high',
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    },
    {
      id: task2Id,
      houseId,
      floorId: rdcId,
      roomName: 'Terrasse',
      title: 'Poser les lames de terrasse bois',
      status: 'todo',
      priority: 'medium',
      createdAt: new Date().toISOString(),
    },
  ]);

  await db.shoppingItems.bulkAdd([
    { id: 'shop1', taskId: task1Id, houseId, name: 'Peinture Blanc Mat 10L', quantity: 2, unit: 'pots', store: 'Leroy Merlin', checked: false, estimatedPrice: 65 },
    { id: 'shop2', taskId: task1Id, houseId, name: 'Ruban de masquage 50m', quantity: 3, unit: 'rouleaux', store: 'Leroy Merlin', checked: true, estimatedPrice: 6 },
    { id: 'shop3', taskId: task1Id, houseId, name: 'Rouleau anti-goutte 180mm', quantity: 2, unit: 'pièces', store: 'Leroy Merlin', checked: false, estimatedPrice: 12 },
    { id: 'shop4', taskId: task2Id, houseId, name: 'Lames Pin classe 4 (2.4m)', quantity: 45, unit: 'lames', store: 'Castorama', checked: false, estimatedPrice: 14 },
    { id: 'shop5', taskId: task2Id, houseId, name: 'Vis inox terrasse (boîte 200)', quantity: 3, unit: 'boîtes', store: 'Castorama', checked: false, estimatedPrice: 24 },
  ]);
}
