import Dexie, { type EntityTable } from 'dexie';
import type {
  House,
  Floor,
  TaskItem,
  ShoppingItem,
  RoomPhoto,
  MaintenanceEquipment,
  ServiceProvider,
  MaintenanceIntervention,
  MaintenanceDocument,
  HouseSyncConfig,
} from './types';

class TravauxMaisonDB extends Dexie {
  houses!: EntityTable<House, 'id'>;
  floors!: EntityTable<Floor, 'id'>;
  tasks!: EntityTable<TaskItem, 'id'>;
  shoppingItems!: EntityTable<ShoppingItem, 'id'>;
  photos!: EntityTable<RoomPhoto, 'id'>;
  maintenanceEquipments!: EntityTable<MaintenanceEquipment, 'id'>;
  maintenanceProviders!: EntityTable<ServiceProvider, 'id'>;
  maintenanceInterventions!: EntityTable<MaintenanceIntervention, 'id'>;
  maintenanceDocuments!: EntityTable<MaintenanceDocument, 'id'>;
  houseSyncConfigs!: EntityTable<HouseSyncConfig, 'houseId'>;

  constructor() {
    super('TravauxMaisonDB');
    this.version(1).stores({
      houses: 'id, name, createdAt',
      floors: 'id, houseId, order',
      tasks: 'id, houseId, floorId, status, dueDate',
      shoppingItems: 'id, taskId, houseId, checked',
      photos: 'id, houseId, floorId, roomName, phase, createdAt',
    });
    this.version(2).stores({
      houses: 'id, name, createdAt',
      floors: 'id, houseId, order',
      tasks: 'id, houseId, floorId, status, dueDate',
      shoppingItems: 'id, taskId, houseId, checked',
      photos: 'id, houseId, floorId, roomName, phase, createdAt',
      maintenanceEquipments: 'id, houseId, category, nextServiceDate, providerId',
      maintenanceProviders: 'id, houseId, companyName',
      maintenanceInterventions: 'id, houseId, equipmentId, providerId, date',
      maintenanceDocuments: 'id, houseId, equipmentId, interventionId, docType, date',
      houseSyncConfigs: 'houseId, workspaceId, enabled',
    });
  }
}

export const db = new TravauxMaisonDB();

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
