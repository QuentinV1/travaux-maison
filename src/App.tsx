import React, { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Home,
  Map,
  CheckSquare,
  Camera,
  Box,
  Plus,
  Download,
  Upload,
  Trash2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { db, seedInitialDataIfEmpty, uid } from './db';
import type { AppTab, Floor, House, RoomPhoto, ShoppingItem, TaskItem } from './types';
import { FloorPlanEditor } from './components/FloorPlanEditor';
import { TasksAndShopping } from './components/TasksAndShopping';
import { PhotosGallery } from './components/PhotosGallery';
import { AISettingsModal } from './components/AISettingsModal';
import { WebCatalogModal } from './components/WebCatalogModal';
import { hasGeminiKey } from './utils/settings';
import { useEscapeKey } from './utils/useEscapeKey';
import type { ExtractedWebProduct, SuggestedDecoItem } from './utils/aiService';

const FloorPlan3DViewer = React.lazy(() =>
  import('./components/FloorPlan3DViewer').then((m) => ({ default: m.FloorPlan3DViewer }))
);

export function App() {
  const [ready, setReady] = useState(false);
  const [activeHouseId, setActiveHouseId] = useState<string>('');
  const [activeFloorId, setActiveFloorId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<AppTab>('plan');

  // New House Modal
  const [showNewHouseModal, setShowNewHouseModal] = useState(false);
  const [newHouseName, setNewHouseName] = useState('');
  const [newHouseAddress, setNewHouseAddress] = useState('');

  // Delete House Modal
  const [showDeleteHouseModal, setShowDeleteHouseModal] = useState(false);
  const [showAISettingsModal, setShowAISettingsModal] = useState(false);
  const [showWebCatalogFrom3D, setShowWebCatalogFrom3D] = useState(false);
  const [aiReady, setAiReady] = useState(() => hasGeminiKey());
  const [backupError, setBackupError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(showNewHouseModal, () => setShowNewHouseModal(false));
  useEscapeKey(showDeleteHouseModal, () => setShowDeleteHouseModal(false));

  useEffect(() => {
    seedInitialDataIfEmpty()
      .catch((err) => {
        console.error('Erreur lors de l’initialisation des données:', err);
      })
      .finally(() => setReady(true));
  }, []);

  const houses = useLiveQuery(() => db.houses.toArray(), [], [] as House[]);

  useEffect(() => {
    if (houses.length > 0 && (!activeHouseId || !houses.some((h) => h.id === activeHouseId))) {
      setActiveHouseId(houses[0].id);
    }
  }, [houses, activeHouseId]);

  const activeHouse = houses.find((h) => h.id === activeHouseId) ?? null;

  const floors = useLiveQuery(
    () => (activeHouseId ? db.floors.where('houseId').equals(activeHouseId).toArray() : []),
    [activeHouseId],
    [] as Floor[]
  );

  useEffect(() => {
    if (floors.length > 0 && (!activeFloorId || !floors.some((f) => f.id === activeFloorId))) {
      const sorted = [...floors].sort((a, b) => a.order - b.order);
      const rdc = sorted.find((f) => !f.isExterior) ?? sorted[0];
      setActiveFloorId(rdc.id);
    }
  }, [floors, activeFloorId]);

  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? null;

  const tasks = useLiveQuery(
    () => (activeHouseId ? db.tasks.where('houseId').equals(activeHouseId).toArray() : []),
    [activeHouseId],
    [] as TaskItem[]
  );

  const shoppingItems = useLiveQuery(
    () => (activeHouseId ? db.shoppingItems.where('houseId').equals(activeHouseId).toArray() : []),
    [activeHouseId],
    [] as ShoppingItem[]
  );

  const photos = useLiveQuery(
    () => (activeHouseId ? db.photos.where('houseId').equals(activeHouseId).toArray() : []),
    [activeHouseId],
    [] as RoomPhoto[]
  );

  const handleCreateHouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHouseName.trim()) return;
    const houseId = uid('house');
    await db.houses.add({
      id: houseId,
      name: newHouseName.trim(),
      address: newHouseAddress.trim() || undefined,
      createdAt: new Date().toISOString(),
    });
    const rdcId = uid('floor');
    await db.floors.bulkAdd([
      {
        id: uid('floor'),
        houseId,
        name: 'Extérieur',
        order: 0,
        isExterior: true,
        defaultWallHeightCm: 120,
        walls: [],
        openings: [],
        rooms: [],
        furniture: [],
      },
      {
        id: rdcId,
        houseId,
        name: 'Rez-de-chaussée',
        order: 1,
        isExterior: false,
        defaultWallHeightCm: 250,
        walls: [],
        openings: [],
        rooms: [],
        furniture: [],
      },
      {
        id: uid('floor'),
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
    ]);
    setActiveHouseId(houseId);
    setActiveFloorId(rdcId);
    setNewHouseName('');
    setNewHouseAddress('');
    setShowNewHouseModal(false);
  };

  const handleDeleteHouse = async () => {
    if (!activeHouse) return;
    const idToDelete = activeHouse.id;
    await db.transaction('rw', [db.houses, db.floors, db.tasks, db.shoppingItems, db.photos], async () => {
      await db.houses.delete(idToDelete);
      await db.floors.where('houseId').equals(idToDelete).delete();
      await db.tasks.where('houseId').equals(idToDelete).delete();
      await db.shoppingItems.where('houseId').equals(idToDelete).delete();
      await db.photos.where('houseId').equals(idToDelete).delete();
    });
    setShowDeleteHouseModal(false);

    const remaining = houses.filter((h) => h.id !== idToDelete);
    if (remaining.length > 0) {
      setActiveHouseId(remaining[0].id);
    } else {
      const newId = uid('house');
      const rdcId = uid('floor');
      await db.houses.add({
        id: newId,
        name: 'Ma Maison',
        createdAt: new Date().toISOString(),
      });
      await db.floors.bulkAdd([
        {
          id: uid('floor'),
          houseId: newId,
          name: 'Extérieur',
          order: 0,
          isExterior: true,
          defaultWallHeightCm: 120,
          walls: [],
          openings: [],
          rooms: [],
          furniture: [],
        },
        {
          id: rdcId,
          houseId: newId,
          name: 'Rez-de-chaussée',
          order: 1,
          isExterior: false,
          defaultWallHeightCm: 250,
          walls: [],
          openings: [],
          rooms: [],
          furniture: [],
        },
      ]);
      setActiveHouseId(newId);
      setActiveFloorId(rdcId);
    }
  };

  const handleAddFloor = async (name: string, isExterior: boolean) => {
    if (!activeHouse) return;
    const maxOrder = floors.reduce((m, f) => Math.max(m, f.order), 0);
    const id = uid('floor');
    await db.floors.add({
      id,
      houseId: activeHouse.id,
      name,
      order: isExterior ? -1 : maxOrder + 1,
      isExterior,
      defaultWallHeightCm: isExterior ? 120 : 250,
      walls: [],
      openings: [],
      rooms: [],
      furniture: [],
    });
    setActiveFloorId(id);
  };

  const handleRenameFloor = async (floorId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await db.floors.update(floorId, { name: trimmed });
  };

  const handleDeleteFloor = async (floorId: string) => {
    if (floors.length <= 1) return;
    const remaining = floors.filter((f) => f.id !== floorId).sort((a, b) => a.order - b.order);
    await db.floors.delete(floorId);
    if (activeFloorId === floorId && remaining[0]) {
      setActiveFloorId(remaining[0].id);
    }
  };

  const handleReorderFloor = async (floorId: string, direction: 'left' | 'right') => {
    const sorted = [...floors].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === floorId);
    if (idx === -1) return;
    const swapIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(swapIdx, 0, moved);
    await db.floors.bulkPut(reordered.map((f, i) => ({ ...f, order: i })));
  };

  const handleExportBackup = async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      houses: await db.houses.toArray(),
      floors: await db.floors.toArray(),
      tasks: await db.tasks.toArray(),
      shoppingItems: await db.shoppingItems.toArray(),
      photos: await db.photos.toArray(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mamaison-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async (file: File | undefined) => {
    if (!file) return;
    setBackupError(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (
        !data ||
        typeof data !== 'object' ||
        (!Array.isArray(data.houses) &&
          !Array.isArray(data.floors) &&
          !Array.isArray(data.tasks) &&
          !Array.isArray(data.shoppingItems) &&
          !Array.isArray(data.photos))
      ) {
        throw new Error('Format de sauvegarde non reconnu.');
      }
      await db.transaction('rw', [db.houses, db.floors, db.tasks, db.shoppingItems, db.photos], async () => {
        if (Array.isArray(data.houses)) await db.houses.bulkPut(data.houses);
        if (Array.isArray(data.floors)) await db.floors.bulkPut(data.floors);
        if (Array.isArray(data.tasks)) await db.tasks.bulkPut(data.tasks);
        if (Array.isArray(data.shoppingItems)) await db.shoppingItems.bulkPut(data.shoppingItems);
        if (Array.isArray(data.photos)) await db.photos.bulkPut(data.photos);
      });
      if (data.houses?.[0]?.id) {
        setActiveHouseId(data.houses[0].id);
      }
    } catch (err) {
      console.error('Erreur restauration sauvegarde:', err);
      setBackupError(
        'Impossible de restaurer ce fichier : veuillez sélectionner une sauvegarde JSON valide exportée depuis MaMaison.'
      );
    }
  };

  const handleAddShoppingItemFromWeb = async (product: ExtractedWebProduct, floorName: string) => {
    if (!activeHouse) return;
    let targetTask = tasks.find((t) => t.title === 'Équipements & Mobilier du Plan');
    if (!targetTask) {
      targetTask = {
        id: uid('task'),
        houseId: activeHouse.id,
        roomName: floorName,
        title: 'Équipements & Mobilier du Plan',
        status: 'todo',
        priority: 'medium',
        createdAt: new Date().toISOString(),
      };
      await db.tasks.add(targetTask);
    }
    await db.shoppingItems.add({
      id: uid('shop'),
      taskId: targetTask.id,
      houseId: activeHouse.id,
      name: product.label,
      quantity: 1,
      unit: 'u',
      store: product.store,
      checked: false,
      estimatedPrice: product.price,
    });
  };

  const handleAddWebProductToActiveFloor = async (
    product: ExtractedWebProduct,
    alsoAddToShopping: boolean
  ) => {
    if (!activeFloor) return;
    const cx =
      activeFloor.walls.length > 0
        ? Math.round(
            activeFloor.walls.reduce((s, w) => s + (w.x1 + w.x2) / 2, 0) / activeFloor.walls.length
          )
        : 350;
    const cy =
      activeFloor.walls.length > 0
        ? Math.round(
            activeFloor.walls.reduce((s, w) => s + (w.y1 + w.y2) / 2, 0) / activeFloor.walls.length
          )
        : 350;
    await db.floors.put({
      ...activeFloor,
      furniture: [
        ...activeFloor.furniture,
        {
          id: uid('f'),
          type: product.type,
          label: product.label,
          x: cx,
          y: cy,
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
        },
      ],
    });
    if (alsoAddToShopping) {
      await handleAddShoppingItemFromWeb(product, activeFloor.name);
    }
  };

  const handleAddSuggestedToPlan = async (item: SuggestedDecoItem, floorId: string) => {
    const targetFloor = floors.find((f) => f.id === floorId) ?? activeFloor;
    if (!targetFloor) return;
    await db.floors.put({
      ...targetFloor,
      furniture: [
        ...targetFloor.furniture,
        {
          id: uid('f'),
          type: item.furnitureType,
          label: item.label,
          x: 350,
          y: 350,
          widthCm: item.widthCm,
          depthCm: item.depthCm,
          heightCm: item.heightCm,
          rotation: 0,
          color: item.color,
          price: item.estimatedPriceEur,
        },
      ],
    });
  };

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50 text-slate-600">
        Chargement de votre espace maison...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
            <Home className="w-5 h-5" />
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={activeHouseId}
              onChange={(e) => setActiveHouseId(e.target.value)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 min-h-[42px] max-w-[200px] truncate"
            >
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowNewHouseModal(true)}
              className="p-2.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 min-h-[42px] min-w-[42px] flex items-center justify-center transition-colors"
              title="Créer une nouvelle maison"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowDeleteHouseModal(true)}
              disabled={!activeHouse}
              className="p-2.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 min-h-[42px] min-w-[42px] flex items-center justify-center transition-colors disabled:opacity-40"
              title={activeHouse ? `Supprimer la maison "${activeHouse.name}"` : 'Supprimer'}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main View Tabs */}
        <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200">
          <NavTab active={activeTab === 'plan'} onClick={() => setActiveTab('plan')} icon={<Map className="w-4 h-4" />} label="Plan 2D" />
          <NavTab active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} icon={<CheckSquare className="w-4 h-4" />} label="Tâches & Courses" />
          <NavTab active={activeTab === 'photos'} onClick={() => setActiveTab('photos')} icon={<Camera className="w-4 h-4" />} label="Photos" />
          <NavTab active={activeTab === '3d'} onClick={() => setActiveTab('3d')} icon={<Box className="w-4 h-4" />} label="Vue 3D" />
        </nav>

        {/* Backup & AI Settings Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowAISettingsModal(true)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 min-h-[40px] transition-colors ${
              aiReady
                ? 'bg-violet-50 border-violet-200 text-violet-800 hover:bg-violet-100'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
            title="Configurer la clé API Google Gemini (100% gratuite) pour les fonctions IA V3"
          >
            <Sparkles className="w-4 h-4 text-violet-600" />
            <span className="hidden md:inline">IA V3</span>
            <span
              className={`w-2 h-2 rounded-full ${aiReady ? 'bg-emerald-500' : 'bg-slate-300'}`}
            />
          </button>
          <button
            onClick={handleExportBackup}
            className="px-3 py-2 rounded-xl text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center gap-1.5 min-h-[40px]"
            title="Sauvegarder toutes les données en local (JSON)"
          >
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">Sauvegarder</span>
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            className="px-3 py-2 rounded-xl text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center gap-1.5 min-h-[40px]"
            title="Restaurer une sauvegarde JSON"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden md:inline">Restaurer</span>
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              handleImportBackup(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {backupError && (
        <div
          role="alert"
          className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm text-rose-800 no-print"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{backupError}</span>
          </div>
          <button
            type="button"
            onClick={() => setBackupError(null)}
            className="px-2 py-1 rounded-lg hover:bg-rose-100 font-semibold text-rose-700 shrink-0"
          >
            Fermer
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'plan' && activeFloor && (
          <FloorPlanEditor
            floor={activeFloor}
            allFloors={floors}
            onUpdateFloor={(updated) => db.floors.put(updated)}
            onSelectFloor={setActiveFloorId}
            onAddFloor={handleAddFloor}
            onRenameFloor={handleRenameFloor}
            onDeleteFloor={handleDeleteFloor}
            onReorderFloor={handleReorderFloor}
            onOpenAISettings={() => setShowAISettingsModal(true)}
            onAddShoppingItemFromWeb={handleAddShoppingItemFromWeb}
          />
        )}

        {activeTab === 'tasks' && activeHouse && (
          <TasksAndShopping
            house={activeHouse}
            floors={floors}
            tasks={tasks}
            shoppingItems={shoppingItems}
            onAddTask={(t) => db.tasks.add(t)}
            onUpdateTask={(t) => db.tasks.put(t)}
            onDeleteTask={async (id) => {
              await db.tasks.delete(id);
              await db.shoppingItems.where('taskId').equals(id).delete();
            }}
            onAddShoppingItem={(s) => db.shoppingItems.add(s)}
            onUpdateShoppingItem={(s) => db.shoppingItems.put(s)}
            onToggleShoppingItem={(s) => db.shoppingItems.update(s.id, { checked: !s.checked })}
            onDeleteShoppingItem={(id) => db.shoppingItems.delete(id)}
          />
        )}

        {activeTab === 'photos' && activeHouse && (
          <PhotosGallery
            house={activeHouse}
            floors={floors}
            photos={photos}
            onAddPhoto={(p) => db.photos.add(p)}
            onDeletePhoto={(id) => db.photos.delete(id)}
            onOpenAISettings={() => setShowAISettingsModal(true)}
            onAddSuggestedToPlan={handleAddSuggestedToPlan}
          />
        )}

        {activeTab === '3d' && (
          floors.length > 0 ? (
            <React.Suspense
              fallback={
                <div className="h-full flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
                  Chargement de la vue 3D...
                </div>
              }
            >
              <FloorPlan3DViewer
                floors={floors}
                activeFloorId={activeFloorId}
                onSelectFloor={setActiveFloorId}
                onUpdateFloor={(updated) => db.floors.put(updated)}
                onOpenAISettings={() => setShowAISettingsModal(true)}
                onOpenWebCatalog={() => setShowWebCatalogFrom3D(true)}
              />
            </React.Suspense>
          ) : (
            <div className="h-full flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
              Ajoutez un étage dans le Plan 2D pour afficher la vue 3D.
            </div>
          )
        )}
      </main>

      {/* Delete House Confirmation Modal */}
      {showDeleteHouseModal && activeHouse && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-slate-900">Supprimer la maison ?</h3>
            </div>
            <p className="text-sm text-slate-600">
              Êtes-vous sûr de vouloir supprimer définitivement la maison{' '}
              <strong className="text-slate-900 font-semibold">« {activeHouse.name} »</strong> ?
            </p>
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 space-y-1">
              <p className="font-semibold">⚠️ Cette action est irréversible.</p>
              <p>Tous les étages, murs, ouvertures, pièces, meubles, tâches, listes de courses et photos de cette maison seront définitivement effacés.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteHouseModal(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDeleteHouse}
                className="px-4 py-2.5 rounded-xl text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 shadow-sm"
              >
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New House Modal */}
      {showNewHouseModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCreateHouse} className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-bold text-lg text-slate-900">Créer une maison</h3>
            <input
              type="text"
              required
              placeholder="Nom de la maison (ex: Maison principale)"
              value={newHouseName}
              onChange={(e) => setNewHouseName(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm"
            />
            <input
              type="text"
              placeholder="Adresse ou note (optionnel)"
              value={newHouseAddress}
              onChange={(e) => setNewHouseAddress(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNewHouseModal(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
              >
                Créer
              </button>
            </div>
          </form>
        </div>
      )}
      {/* AI Settings Modal (V3) */}
      <AISettingsModal
        isOpen={showAISettingsModal}
        onClose={() => setShowAISettingsModal(false)}
        onSaved={() => setAiReady(hasGeminiKey())}
      />

      {/* Web Catalog Modal launched directly from 3D View */}
      <WebCatalogModal
        isOpen={showWebCatalogFrom3D}
        onClose={() => setShowWebCatalogFrom3D(false)}
        onAddFurnitureToPlan={handleAddWebProductToActiveFloor}
      />
    </div>
  );
}

const NavTab: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`px-3.5 py-2 rounded-xl text-sm font-medium flex items-center gap-2 min-h-[40px] transition-colors ${
      active ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
    }`}
  >
    {icon}
    <span className="hidden sm:inline">{label}</span>
  </button>
);

export default App;
