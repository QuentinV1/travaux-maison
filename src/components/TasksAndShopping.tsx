import React, { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Plus,
  CheckCircle2,
  Circle,
  Clock,
  ShoppingCart,
  Printer,
  QrCode,
  Trash2,
  Copy,
  Check,
  Calendar,
  AlertCircle,
  X,
  Wallet,
  Tag,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react';
import type { Floor, House, ShoppingItem, TaskItem, TaskPriority, TaskStatus } from '../types';
import { uid } from '../db';
import { copyTextToClipboard } from '../utils/clipboard';
import { useEscapeKey } from '../utils/useEscapeKey';

interface TasksAndShoppingProps {
  house: House;
  floors: Floor[];
  tasks: TaskItem[];
  shoppingItems: ShoppingItem[];
  onAddTask: (task: TaskItem) => void;
  onUpdateTask: (task: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  onAddShoppingItem: (item: ShoppingItem) => void;
  onUpdateShoppingItem?: (item: ShoppingItem) => void;
  onToggleShoppingItem: (item: ShoppingItem) => void;
  onDeleteShoppingItem: (itemId: string) => void;
}

export const TasksAndShopping: React.FC<TasksAndShoppingProps> = ({
  house,
  floors,
  tasks,
  shoppingItems,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onAddShoppingItem,
  onUpdateShoppingItem,
  onToggleShoppingItem,
  onDeleteShoppingItem,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [roomFilter, setRoomFilter] = useState<'all' | string>('all');
  const [showBudgetCard, setShowBudgetCard] = useState(true);
  const [showNewTask, setShowNewTask] = useState(false);
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [editingPriceVal, setEditingPriceVal] = useState<string>('');
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // New task form
  const [title, setTitle] = useState('');
  const [roomName, setRoomName] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');

  // Inline shopping item inputs keyed by taskId
  const [newItemInputs, setNewItemInputs] = useState<
    Record<string, { name: string; qty: string; unit: string; store: string; price: string }>
  >({});
  const [keepStore, setKeepStore] = useState(true);

  // QR Code modal state
  const [qrPayload, setQrPayload] = useState<{ title: string; text: string } | null>(null);
  const [qrMode, setQrMode] = useState<'text' | 'whatsapp' | 'sms'>('whatsapp');
  const [copied, setCopied] = useState(false);

  useEscapeKey(qrPayload !== null, () => setQrPayload(null));

  // Print target (either a specific taskId or 'all')
  const [printScope, setPrintScope] = useState<string>('all');

  const allRoomNames = useMemo(() => {
    const set = new Set<string>();
    floors.forEach((f) => f.rooms.forEach((r) => set.add(r.name)));
    return Array.from(set);
  }, [floors]);

  // Aggregate budget per room
  const budgetByRoom = useMemo(() => {
    const map = new Map<
      string,
      { roomName: string; total: number; spent: number; remaining: number; itemCount: number; taskCount: number }
    >();

    // Initialize with all known rooms in the house
    allRoomNames.forEach((rName) => {
      map.set(rName, {
        roomName: rName,
        total: 0,
        spent: 0,
        remaining: 0,
        itemCount: 0,
        taskCount: 0,
      });
    });

    tasks.forEach((t) => {
      const rName = t.roomName?.trim() || 'Général / Sans pièce';
      let entry = map.get(rName);
      if (!entry) {
        entry = {
          roomName: rName,
          total: 0,
          spent: 0,
          remaining: 0,
          itemCount: 0,
          taskCount: 0,
        };
        map.set(rName, entry);
      }
      entry.taskCount += 1;
      const items = shoppingItems.filter((s) => s.taskId === t.id);
      items.forEach((item) => {
        const lineTotal = (item.estimatedPrice ?? 0) * (item.quantity ?? 1);
        entry.itemCount += 1;
        entry.total += lineTotal;
        if (item.checked) {
          entry.spent += lineTotal;
        } else {
          entry.remaining += lineTotal;
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [tasks, shoppingItems, allRoomNames]);

  const globalBudget = useMemo(() => {
    return shoppingItems.reduce(
      (acc, item) => {
        const cost = (item.estimatedPrice ?? 0) * (item.quantity ?? 1);
        acc.total += cost;
        if (item.checked) acc.spent += cost;
        else acc.remaining += cost;
        return acc;
      },
      { total: 0, spent: 0, remaining: 0 }
    );
  }, [shoppingItems]);

  const filteredTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (roomFilter !== 'all') {
          const r = t.roomName?.trim() || 'Général / Sans pièce';
          if (r !== roomFilter) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [tasks, statusFilter, roomFilter]);

  const buildShoppingText = (taskTitle: string, items: ShoppingItem[]) => {
    const header = `${house.name} — ${taskTitle}\n`;
    let total = 0;
    const lines = items.map((i) => {
      const lineCost = (i.estimatedPrice ?? 0) * (i.quantity ?? 1);
      total += lineCost;
      const priceTag = i.estimatedPrice != null ? ` [${(lineCost).toFixed(2)} €]` : '';
      return `${i.checked ? '[x]' : '[ ]'} ${i.name} (${i.quantity} ${i.unit})${priceTag}${i.store ? ` (${i.store})` : ''}`;
    });
    const footer = total > 0 ? `\nTotal estimé : ${total.toFixed(2)} €` : '';
    return header + lines.join('\n') + footer;
  };

  const openQrForTask = (task: TaskItem) => {
    const items = shoppingItems.filter((s) => s.taskId === task.id);
    if (items.length === 0) return;
    setQrPayload({
      title: task.title,
      text: buildShoppingText(task.title, items),
    });
  };

  const openQrForAllRemaining = () => {
    const remaining = shoppingItems.filter((s) => !s.checked);
    if (remaining.length === 0) return;
    setQrPayload({
      title: 'Courses restantes',
      text: buildShoppingText('Toutes les courses restantes', remaining),
    });
  };

  const triggerPrint = (scope: string) => {
    setPrintScope(scope);
    setTimeout(() => window.print(), 60);
  };

  const qrValue = useMemo(() => {
    if (!qrPayload) return '';
    if (qrMode === 'whatsapp') {
      return `https://wa.me/?text=${encodeURIComponent(qrPayload.text)}`;
    }
    if (qrMode === 'sms') {
      return `sms:?body=${encodeURIComponent(qrPayload.text)}`;
    }
    return qrPayload.text;
  }, [qrPayload, qrMode]);

  const handleImportFromPlan = () => {
    const allFurniture = floors.flatMap((f) =>
      f.furniture.map((item) => ({ floorName: f.name, item }))
    );
    if (allFurniture.length === 0) {
      setSyncNotice('Aucun meuble ou équipement trouvé dans vos plans 2D.');
      setTimeout(() => setSyncNotice(null), 3500);
      return;
    }

    const existingNames = new Set(shoppingItems.map((s) => s.name.toLowerCase()));
    const toAdd = allFurniture.filter(
      ({ item }) => !existingNames.has(item.label.toLowerCase())
    );

    if (toAdd.length === 0) {
      setSyncNotice('Tous les équipements de vos plans sont déjà dans la liste de courses.');
      setTimeout(() => setSyncNotice(null), 3500);
      return;
    }

    let targetTask = tasks.find((t) => t.title === 'Équipements & Mobilier du Plan');
    if (!targetTask) {
      targetTask = {
        id: uid('task'),
        houseId: house.id,
        title: 'Équipements & Mobilier du Plan',
        status: 'todo',
        priority: 'medium',
        createdAt: new Date().toISOString(),
      };
      onAddTask(targetTask);
    }

    for (const { item } of toAdd) {
      onAddShoppingItem({
        id: uid('shop'),
        taskId: targetTask.id,
        houseId: house.id,
        name: item.label,
        quantity: 1,
        unit: 'u',
        store: item.store,
        checked: false,
        estimatedPrice: item.price,
      });
    }

    setSyncNotice(`${toAdd.length} article(s) importé(s) depuis vos plans 2D/3D !`);
    setTimeout(() => setSyncNotice(null), 4000);
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAddTask({
      id: uid('task'),
      houseId: house.id,
      roomName: roomName.trim() || undefined,
      title: title.trim(),
      status: 'todo',
      priority,
      dueDate: dueDate || undefined,
      createdAt: new Date().toISOString(),
    });
    setTitle('');
    setRoomName('');
    setPriority('medium');
    setDueDate('');
    setShowNewTask(false);
  };

  const handleAddItem = (taskId: string) => {
    const draft = newItemInputs[taskId];
    if (!draft?.name?.trim()) return;
    const priceNum = draft.price ? parseFloat(draft.price.replace(',', '.')) : undefined;
    onAddShoppingItem({
      id: uid('shop'),
      taskId,
      houseId: house.id,
      name: draft.name.trim(),
      quantity: Math.max(1, Number(draft.qty) || 1),
      unit: draft.unit?.trim() || 'pièce(s)',
      store: draft.store?.trim() || undefined,
      estimatedPrice: priceNum && !isNaN(priceNum) && priceNum >= 0 ? priceNum : undefined,
      checked: false,
    });
    setNewItemInputs((prev) => ({
      ...prev,
      [taskId]: { name: '', qty: '1', unit: 'pièce(s)', store: keepStore ? (draft.store ?? '') : '', price: '' },
    }));
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  // Items to print in the hidden print-only sheet
  const printableItems = useMemo(() => {
    if (printScope === 'all') {
      return shoppingItems.filter((s) => !s.checked);
    }
    return shoppingItems.filter((s) => s.taskId === printScope);
  }, [printScope, shoppingItems]);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6 no-print">
        {/* Header & Global Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Travaux & Listes de courses</h2>
            <p className="text-sm text-slate-500">
              {doneCount} / {tasks.length} tâches terminées • {shoppingItems.filter((s) => !s.checked).length} articles à acheter
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleImportFromPlan}
              className="px-3.5 py-2.5 rounded-xl text-sm font-medium bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center gap-2 min-h-[44px]"
              title="Générer la liste de courses à partir des meubles/articles ajoutés au Plan 2D/3D"
            >
              <Layers className="w-4 h-4" /> Importer du Plan
            </button>
            <button
              onClick={() => triggerPrint('all')}
              className="px-3.5 py-2.5 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-2 min-h-[44px]"
            >
              <Printer className="w-4 h-4" /> Imprimer tout
            </button>
            <button
              onClick={openQrForAllRemaining}
              disabled={shoppingItems.filter((s) => !s.checked).length === 0}
              className="px-3.5 py-2.5 rounded-xl text-sm font-medium bg-indigo-50 hover:bg-indigo-100 text-indigo-700 disabled:opacity-40 flex items-center gap-2 min-h-[44px]"
            >
              <QrCode className="w-4 h-4" /> Envoyer au tél
            </button>
            <button
              onClick={() => setShowNewTask((s) => !s)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-2 min-h-[44px]"
            >
              <Plus className="w-4 h-4" /> Nouvelle tâche
            </button>
          </div>
        </div>

        {syncNotice && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{syncNotice}</span>
          </div>
        )}

        {/* Budget Overview & Room Breakdown Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 text-base">Budget Travaux & Matériaux par Pièce</h3>
                <p className="text-xs text-slate-500">Estimations et dépenses réelles de la maison</p>
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-left sm:text-right">
                <span className="text-[11px] text-slate-500 uppercase font-semibold block">Total estimé</span>
                <span className="text-lg font-bold text-slate-900">{globalBudget.total.toFixed(2)} €</span>
              </div>
              <div className="text-left sm:text-right">
                <span className="text-[11px] text-slate-500 uppercase font-semibold block">Acheté / Réglé</span>
                <span className="text-lg font-bold text-emerald-600">{globalBudget.spent.toFixed(2)} €</span>
              </div>
              <div className="text-left sm:text-right">
                <span className="text-[11px] text-slate-500 uppercase font-semibold block">Reste à payer</span>
                <span className="text-lg font-bold text-amber-600">{globalBudget.remaining.toFixed(2)} €</span>
              </div>
              <button
                onClick={() => setShowBudgetCard((s) => !s)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 ml-1"
                title={showBudgetCard ? 'Masquer le détail par pièce' : 'Afficher le détail par pièce'}
              >
                {showBudgetCard ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {showBudgetCard && (
            <div className="p-4 bg-slate-50/60 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold uppercase tracking-wider">Répartition du budget par Pièce (Cliquez pour filtrer les tâches) :</span>
                {roomFilter !== 'all' && (
                  <button
                    onClick={() => setRoomFilter('all')}
                    className="text-blue-600 hover:underline font-semibold"
                  >
                    Effacer le filtre ({roomFilter})
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {budgetByRoom.map((b) => {
                  const pct = b.total > 0 ? Math.round((b.spent / b.total) * 100) : 0;
                  const isSelected = roomFilter === b.roomName;
                  return (
                    <button
                      key={b.roomName}
                      onClick={() => setRoomFilter(isSelected ? 'all' : b.roomName)}
                      className={`text-left p-3.5 rounded-xl border transition-all ${
                        isSelected
                          ? 'bg-blue-50/90 border-blue-400 shadow-xs ring-1 ring-blue-300'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2 mb-1.5">
                        <span className="font-semibold text-slate-900 text-sm truncate">{b.roomName}</span>
                        <span className="font-bold text-slate-900 text-sm whitespace-nowrap">{b.total.toFixed(2)} €</span>
                      </div>
                      
                      {/* Mini progress bar */}
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mb-2">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="flex justify-between items-center text-xs text-slate-500">
                        <span>{b.itemCount} article{b.itemCount > 1 ? 's' : ''} ({b.taskCount} tâche{b.taskCount > 1 ? 's' : ''})</span>
                        <span className="text-emerald-700 font-medium">{b.spent.toFixed(2)} € ({pct}%)</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* New Task Form */}
        {showNewTask && (
          <form onSubmit={handleCreateTask} className="bg-white p-4 rounded-2xl border border-blue-200 shadow-sm space-y-3">
            <h3 className="font-semibold text-slate-900">Ajouter une tâche</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                maxLength={140}
                placeholder="Ex: Poser le parquet de la chambre 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm sm:col-span-2"
              />
              <div>
                <label className="text-xs text-slate-500 block mb-1">Pièce (optionnel)</label>
                <input
                  list="room-suggestions"
                  maxLength={80}
                  placeholder="Ex: Séjour Salon, Cuisine..."
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm"
                />
                <datalist id="room-suggestions">
                  {allRoomNames.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Priorité</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
                  >
                    <option value="low">Basse</option>
                    <option value="medium">Moyenne</option>
                    <option value="high">Haute</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Échéance (optionnel)</label>
                  <input
                    type="date"
                    min="1900-01-01"
                    max="2099-12-31"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNewTask(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
              >
                Enregistrer
              </button>
            </div>
          </form>
        )}

        {/* Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { id: 'all', label: 'Toutes' },
            { id: 'todo', label: 'À faire' },
            { id: 'in_progress', label: 'En cours' },
            { id: 'done', label: 'Terminées' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id as 'all' | TaskStatus)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap min-h-[40px] ${
                statusFilter === f.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Tasks List */}
        <div className="space-y-4">
          {filteredTasks.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500">
              Aucune tâche dans cette catégorie. Touchez « Nouvelle tâche » pour commencer.
            </div>
          )}

          {filteredTasks.map((task) => {
            const taskItems = shoppingItems.filter((s) => s.taskId === task.id);
            const draft = newItemInputs[task.id] ?? { name: '', qty: '1', unit: 'pièce(s)', store: '' };
            const isOverdue = task.dueDate && task.status !== 'done' && task.dueDate < todayStr;

            return (
              <div
                key={task.id}
                className={`bg-white rounded-2xl border p-4 shadow-xs transition-opacity ${
                  task.status === 'done' ? 'border-slate-200 opacity-75' : 'border-slate-200'
                }`}
              >
                {/* Task Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <button
                      onClick={() => {
                        const next: TaskStatus =
                          task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo';
                        onUpdateTask({ ...task, status: next });
                      }}
                      className="mt-0.5 p-1 rounded-full hover:bg-slate-100"
                      title="Changer le statut"
                    >
                      {task.status === 'done' ? (
                        <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                      ) : task.status === 'in_progress' ? (
                        <Clock className="w-6 h-6 text-amber-500" />
                      ) : (
                        <Circle className="w-6 h-6 text-slate-300" />
                      )}
                    </button>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`font-semibold text-base ${task.status === 'done' ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                          {task.title}
                        </h3>
                        {task.roomName && (
                          <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                            {task.roomName}
                          </span>
                        )}
                        {task.priority === 'high' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">
                            Prioritaire
                          </span>
                        )}
                        {(() => {
                          const tTotal = taskItems.reduce((acc, i) => acc + (i.estimatedPrice ?? 0) * (i.quantity ?? 1), 0);
                          const tSpent = taskItems.filter((i) => i.checked).reduce((acc, i) => acc + (i.estimatedPrice ?? 0) * (i.quantity ?? 1), 0);
                          if (tTotal === 0) return null;
                          return (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200">
                              Budget : {tTotal.toFixed(2)} € {tSpent > 0 ? `(${tSpent.toFixed(2)} € réglé)` : ''}
                            </span>
                          );
                        })()}
                      </div>

                      {task.dueDate && (
                        <div className={`flex items-center gap-1 text-xs mt-1 ${isOverdue ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                          {isOverdue ? <AlertCircle className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}
                          Échéance : {task.dueDate} {isOverdue ? '(En retard)' : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Task Actions */}
                  <div className="flex items-center gap-1.5">
                    {taskItems.length > 0 && (
                      <>
                        <button
                          onClick={() => triggerPrint(task.id)}
                          className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                          title="Imprimer la liste de courses de cette tâche"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openQrForTask(task)}
                          className="p-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1.5 text-xs font-medium"
                          title="Envoyer la liste au téléphone via QR Code"
                        >
                          <QrCode className="w-4 h-4" /> QR Tél
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => onDeleteTask(task.id)}
                      className="p-2.5 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-600"
                      title="Supprimer la tâche"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Shopping List Sub-section */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Liste de courses ({taskItems.filter((i) => i.checked).length}/{taskItems.length})
                  </div>

                  <div className="space-y-1.5 mb-3">
                    {taskItems.map((item) => {
                      const lineCost = (item.estimatedPrice ?? 0) * (item.quantity ?? 1);
                      return (
                        <div
                          key={item.id}
                          className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
                        >
                          <button
                            onClick={() => onToggleShoppingItem(item)}
                            className="flex items-start sm:items-center gap-2.5 flex-1 text-left min-h-[32px] min-w-0"
                          >
                            <input
                              type="checkbox"
                              checked={item.checked}
                              readOnly
                              className="w-5 h-5 mt-0.5 sm:mt-0 rounded accent-slate-900 pointer-events-none shrink-0"
                            />
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 flex-1">
                              <span className={`text-sm font-medium break-words ${item.checked ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                {item.name}
                              </span>
                              <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200 whitespace-nowrap">
                                {item.quantity} {item.unit}
                              </span>
                              {item.store && (
                                <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md whitespace-nowrap">
                                  {item.store}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Price Display & Inline Editor */}
                          <div className="flex items-center gap-2">
                            {editingPriceItemId === item.id ? (
                              <div
                                className="flex items-center gap-1 bg-white p-1 rounded-lg border border-emerald-400 shadow-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  placeholder="0.00"
                                  value={editingPriceVal}
                                  onChange={(e) => setEditingPriceVal(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const val = parseFloat(editingPriceVal.replace(',', '.'));
                                      if (onUpdateShoppingItem) {
                                        onUpdateShoppingItem({
                                          ...item,
                                          estimatedPrice: !isNaN(val) && val >= 0 ? val : undefined,
                                        });
                                      }
                                      setEditingPriceItemId(null);
                                    }
                                  }}
                                  className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right font-semibold"
                                  autoFocus
                                />
                                <span className="text-xs font-semibold text-slate-600">€</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const val = parseFloat(editingPriceVal.replace(',', '.'));
                                    if (onUpdateShoppingItem) {
                                      onUpdateShoppingItem({
                                        ...item,
                                        estimatedPrice: !isNaN(val) && val >= 0 ? val : undefined,
                                      });
                                    }
                                    setEditingPriceItemId(null);
                                  }}
                                  className="px-2 py-1 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-700 inline-flex items-center justify-center"
                                  aria-label="Valider"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingPriceItemId(null)}
                                  className="px-1.5 py-1 text-slate-400 hover:text-slate-600 text-xs inline-flex items-center justify-center"
                                  aria-label="Annuler"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingPriceItemId(item.id);
                                  setEditingPriceVal(item.estimatedPrice != null ? item.estimatedPrice.toString() : '');
                                }}
                                className={`text-xs px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                                  item.estimatedPrice != null
                                    ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                                    : 'bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-dashed border-slate-300'
                                }`}
                                title="Cliquer pour définir ou ajuster le prix"
                              >
                                {item.estimatedPrice != null ? (
                                  <>
                                    <span>{lineCost.toFixed(2)} €</span>
                                    {item.quantity > 1 ? (
                                      <span className="text-[10px] font-normal text-emerald-600">
                                        ({item.estimatedPrice.toFixed(2)} €/u)
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  <>
                                    <Tag className="w-3 h-3" />
                                    <span>Prix €</span>
                                  </>
                                )}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => onDeleteShoppingItem(item.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                              title="Supprimer l'article"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Quick Add Shopping Item */}
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      maxLength={120}
                      placeholder="Ajouter un article (ex: Sac de colle 25kg)"
                      value={draft.name}
                      onChange={(e) =>
                        setNewItemInputs((prev) => ({ ...prev, [task.id]: { ...draft, name: e.target.value } }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddItem(task.id);
                        }
                      }}
                      className="w-full sm:w-auto sm:flex-1 sm:min-w-[180px] px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                    />
                    <input
                      type="number"
                      min={1}
                      value={draft.qty}
                      onChange={(e) =>
                        setNewItemInputs((prev) => ({ ...prev, [task.id]: { ...draft, qty: e.target.value } }))
                      }
                      className="w-16 px-2.5 py-2 border border-slate-200 rounded-xl text-sm text-center bg-white"
                      title="Quantité"
                    />
                    <input
                      type="text"
                      maxLength={24}
                      placeholder="Unité"
                      value={draft.unit}
                      onChange={(e) =>
                        setNewItemInputs((prev) => ({ ...prev, [task.id]: { ...draft, unit: e.target.value } }))
                      }
                      className="w-24 px-2.5 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                      title="Unité (rouleaux, pots, sacs...)"
                    />
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      placeholder="Prix €"
                      value={draft.price ?? ''}
                      onChange={(e) =>
                        setNewItemInputs((prev) => ({ ...prev, [task.id]: { ...draft, price: e.target.value } }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddItem(task.id);
                        }
                      }}
                      className="w-24 px-2.5 py-2 border border-slate-200 rounded-xl text-sm bg-white text-right"
                      title="Prix unitaire estimé en €"
                    />
                    <input
                      type="text"
                      maxLength={60}
                      placeholder="Magasin"
                      value={draft.store}
                      onChange={(e) =>
                        setNewItemInputs((prev) => ({ ...prev, [task.id]: { ...draft, store: e.target.value } }))
                      }
                      className="w-28 px-2.5 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                    />
                    <label
                      className="flex items-center gap-1.5 text-xs text-slate-500 select-none cursor-pointer px-1"
                      title="Conserver le nom du magasin après l'ajout d'un article"
                    >
                      <input
                        type="checkbox"
                        checked={keepStore}
                        onChange={(e) => setKeepStore(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-slate-900"
                      />
                      <span>Conserver magasin</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleAddItem(task.id)}
                      className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 min-h-[40px]"
                    >
                      + Ajouter
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* QR Code Modal */}
      {qrPayload && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 no-print">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">Envoyer vers votre téléphone</h3>
              <button
                onClick={() => setQrPayload(null)}
                aria-label="Fermer"
                className="p-2 rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
              {[
                { id: 'whatsapp', label: 'WhatsApp' },
                { id: 'sms', label: 'SMS' },
                { id: 'text', label: 'Texte / Notes' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setQrMode(m.id as 'whatsapp' | 'sms' | 'text')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    qrMode === m.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col items-center justify-center bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <QRCodeSVG value={qrValue} size={220} level="M" includeMargin />
              <p className="text-xs text-slate-500 text-center mt-3">
                Scannez ce QR Code avec l'appareil photo de votre téléphone pour ouvrir la liste directement.
              </p>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-700 whitespace-pre-wrap max-h-32 overflow-y-auto border border-slate-200">
              {qrPayload.text}
            </div>

            <button
              onClick={async () => {
                const ok = await copyTextToClipboard(qrPayload.text);
                if (ok) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } else {
                  alert('Copie automatique refusée par le navigateur. Sélectionnez et copiez le texte ci-dessus.');
                }
              }}
              className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-slate-800"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copié dans le presse-papiers !' : 'Copier le texte'}
            </button>
          </div>
        </div>
      )}

      {/* Printable Sheet (Only visible during @media print) */}
      <div className="hidden print-only p-6 text-black">
        <h1 className="text-2xl font-bold mb-1">Liste de courses & Budget — {house.name}</h1>
        <p className="text-sm text-gray-600 mb-4">
          Imprimé le {new Date().toLocaleDateString('fr-FR')}
          {printScope !== 'all' ? ` • Tâche : ${tasks.find((t) => t.id === printScope)?.title ?? ''}` : ' • Tous les articles restants'}
        </p>

        {/* Global budget recap in print */}
        <div className="mb-4 p-3 border border-black rounded flex justify-between text-sm">
          <span><strong>Budget Total estimé :</strong> {globalBudget.total.toFixed(2)} €</span>
          <span><strong>Déjà réglé :</strong> {globalBudget.spent.toFixed(2)} €</span>
          <span><strong>Reste à régler :</strong> {globalBudget.remaining.toFixed(2)} €</span>
        </div>

        <table className="w-full border-collapse text-sm mb-6">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-2 w-8">OK</th>
              <th className="py-2">Article</th>
              <th className="py-2">Quantité</th>
              <th className="py-2">Prix unitaire</th>
              <th className="py-2">Total estimé</th>
              <th className="py-2">Magasin</th>
            </tr>
          </thead>
          <tbody>
            {printableItems.map((item) => {
              const lineCost = (item.estimatedPrice ?? 0) * (item.quantity ?? 1);
              return (
                <tr key={item.id} className="border-b border-gray-300">
                  <td className="py-2">
                    <div className="w-4 h-4 border border-black inline-block" />
                  </td>
                  <td className="py-2 font-medium">{item.name}</td>
                  <td className="py-2">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="py-2">
                    {item.estimatedPrice != null ? `${item.estimatedPrice.toFixed(2)} €` : '—'}
                  </td>
                  <td className="py-2 font-semibold">
                    {lineCost > 0 ? `${lineCost.toFixed(2)} €` : '—'}
                  </td>
                  <td className="py-2">{item.store ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Room budget summary table in print */}
        <h2 className="text-base font-bold mb-2">Récapitulatif Budget par Pièce</h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1">Pièce</th>
              <th className="py-1">Articles</th>
              <th className="py-1">Total estimé</th>
              <th className="py-1">Déjà réglé</th>
              <th className="py-1">Reste</th>
            </tr>
          </thead>
          <tbody>
            {budgetByRoom.filter((b) => b.total > 0).map((b) => (
              <tr key={b.roomName} className="border-b border-gray-200">
                <td className="py-1 font-medium">{b.roomName}</td>
                <td className="py-1">{b.itemCount}</td>
                <td className="py-1 font-semibold">{b.total.toFixed(2)} €</td>
                <td className="py-1">{b.spent.toFixed(2)} €</td>
                <td className="py-1">{b.remaining.toFixed(2)} €</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
