import React, { useMemo, useState } from 'react';
import {
  Wrench,
  Users,
  FileText,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Phone,
  Mail,
  Globe,
  MapPin,
  Download,
  Upload,
  Euro,
  Copy,
  Check,
  X,
  Bell,
} from 'lucide-react';
import type {
  EquipmentCategory,
  House,
  MaintenanceDocType,
  MaintenanceDocument,
  MaintenanceEquipment,
  MaintenanceIntervention,
  ServiceProvider,
} from '../types';
import { uid } from '../db';
import { useEscapeKey } from '../utils/useEscapeKey';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  EQUIPMENT_CATEGORY_LABELS,
  MAINTENANCE_DOC_TYPE_LABELS,
  buildBudgetPrevisionnelExport,
  computeAnnualExpenses,
  computeNextServiceDate,
  generateIcsCalendar,
  getDaysUntil,
  getMaintenanceUrgency,
  type MaintenanceUrgency,
} from '../utils/maintenance';

interface MaintenanceModuleProps {
  house: House;
  equipments: MaintenanceEquipment[];
  providers: ServiceProvider[];
  interventions: MaintenanceIntervention[];
  documents: MaintenanceDocument[];
  onSaveEquipment: (eq: MaintenanceEquipment) => Promise<void>;
  onDeleteEquipment: (id: string) => Promise<void>;
  onSaveProvider: (prov: ServiceProvider) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  onSaveIntervention: (inter: MaintenanceIntervention) => Promise<void>;
  onDeleteIntervention: (id: string) => Promise<void>;
  onAddDocument: (doc: MaintenanceDocument) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
}

type SubTab = 'equipments' | 'providers' | 'history';

const URGENCY_META: Record<
  MaintenanceUrgency,
  { label: string; badgeClass: string; borderClass: string }
> = {
  overdue: {
    label: 'En retard',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
    borderClass: 'border-rose-300',
  },
  due_soon_7: {
    label: 'Échéance J-7',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    borderClass: 'border-amber-300',
  },
  due_soon_30: {
    label: 'À prévoir (J-30)',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
    borderClass: 'border-sky-200',
  },
  ok: {
    label: 'À jour',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    borderClass: 'border-slate-200',
  },
  unscheduled: {
    label: 'Non planifié',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
    borderClass: 'border-slate-200',
  },
};

async function compressImageIfNeeded(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  if (!file.type.startsWith('image/')) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { dataUrl, mimeType: file.type || 'application/octet-stream' };
  }

  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1400;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ dataUrl: rawUrl, mimeType: file.type });
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/webp', 0.82), mimeType: 'image/webp' });
    };
    img.onerror = () => resolve({ dataUrl: rawUrl, mimeType: file.type });
    img.src = rawUrl;
  });
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const MaintenanceModule: React.FC<MaintenanceModuleProps> = ({
  house,
  equipments,
  providers,
  interventions,
  documents,
  onSaveEquipment,
  onDeleteEquipment,
  onSaveProvider,
  onDeleteProvider,
  onSaveIntervention,
  onDeleteIntervention,
  onAddDocument,
  onDeleteDocument,
}) => {
  const [subTab, setSubTab] = useState<SubTab>('equipments');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'action' | MaintenanceUrgency>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | EquipmentCategory>('all');
  const [providerSearch, setProviderSearch] = useState('');
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  // Equipment modal state
  const [eqModalOpen, setEqModalOpen] = useState(false);
  const [editingEq, setEditingEq] = useState<MaintenanceEquipment | null>(null);
  const [eqName, setEqName] = useState('');
  const [eqCategory, setEqCategory] = useState<EquipmentCategory>('heat_pump');
  const [eqLocation, setEqLocation] = useState('');
  const [eqBrand, setEqBrand] = useState('');
  const [eqModel, setEqModel] = useState('');
  const [eqSerial, setEqSerial] = useState('');
  const [eqPeriodicity, setEqPeriodicity] = useState('12');
  const [eqLastDate, setEqLastDate] = useState('');
  const [eqNextDate, setEqNextDate] = useState('');
  const [eqAnnualCost, setEqAnnualCost] = useState('');
  const [eqProviderId, setEqProviderId] = useState('');
  const [eqNotes, setEqNotes] = useState('');

  // Provider modal state
  const [provModalOpen, setProvModalOpen] = useState(false);
  const [editingProv, setEditingProv] = useState<ServiceProvider | null>(null);
  const [provCompany, setProvCompany] = useState('');
  const [provContact, setProvContact] = useState('');
  const [provPhone, setProvPhone] = useState('');
  const [provEmail, setProvEmail] = useState('');
  const [provWebsite, setProvWebsite] = useState('');
  const [provAddress, setProvAddress] = useState('');
  const [provSpecialty, setProvSpecialty] = useState('');
  const [provNotes, setProvNotes] = useState('');

  // Intervention modal state
  const [intModalOpen, setIntModalOpen] = useState(false);
  const [intEquipmentId, setIntEquipmentId] = useState('');
  const [intProviderId, setIntProviderId] = useState('');
  const [intDate, setIntDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [intTitle, setIntTitle] = useState('Entretien périodique');
  const [intCost, setIntCost] = useState('');
  const [intNextDate, setIntNextDate] = useState('');
  const [intNotes, setIntNotes] = useState('');

  // Document modal state
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docType, setDocType] = useState<MaintenanceDocType>('invoice');
  const [docTitle, setDocTitle] = useState('');
  const [docEquipmentId, setDocEquipmentId] = useState('');
  const [docProviderId, setDocProviderId] = useState('');
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [docAmount, setDocAmount] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  // Budget bridge modal state
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [copiedBudgetJson, setCopiedBudgetJson] = useState(false);

  useEscapeKey(eqModalOpen, () => setEqModalOpen(false));
  useEscapeKey(provModalOpen, () => setProvModalOpen(false));
  useEscapeKey(intModalOpen, () => setIntModalOpen(false));
  useEscapeKey(docModalOpen, () => setDocModalOpen(false));
  useEscapeKey(budgetModalOpen, () => setBudgetModalOpen(false));

  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const equipmentMap = useMemo(() => new Map(equipments.map((e) => [e.id, e])), [equipments]);

  const dashboard = useMemo(() => {
    let overdue = 0;
    let dueSoon7 = 0;
    let dueSoon30 = 0;
    let ok = 0;
    for (const eq of equipments) {
      const u = getMaintenanceUrgency(eq.nextServiceDate);
      if (u === 'overdue') overdue += 1;
      else if (u === 'due_soon_7') dueSoon7 += 1;
      else if (u === 'due_soon_30') dueSoon30 += 1;
      else if (u === 'ok') ok += 1;
    }
    const budget = buildBudgetPrevisionnelExport(equipments, interventions, house.name);
    return { overdue, dueSoon7, dueSoon30, ok, budget };
  }, [equipments, interventions, house.name]);

  const filteredEquipments = useMemo(() => {
    return equipments
      .filter((eq) => {
        if (categoryFilter !== 'all' && eq.category !== categoryFilter) return false;
        const u = getMaintenanceUrgency(eq.nextServiceDate);
        if (urgencyFilter === 'action') {
          return u === 'overdue' || u === 'due_soon_7' || u === 'due_soon_30';
        }
        if (urgencyFilter !== 'all' && u !== urgencyFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (!a.nextServiceDate && !b.nextServiceDate) return a.name.localeCompare(b.name);
        if (!a.nextServiceDate) return 1;
        if (!b.nextServiceDate) return -1;
        return a.nextServiceDate.localeCompare(b.nextServiceDate);
      });
  }, [equipments, categoryFilter, urgencyFilter]);

  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    return providers
      .filter((p) => {
        if (!q) return true;
        return (
          p.companyName.toLowerCase().includes(q) ||
          (p.contactName ?? '').toLowerCase().includes(q) ||
          (p.specialty ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [providers, providerSearch]);

  const annualSummary = useMemo(
    () => computeAnnualExpenses(selectedYear, interventions, equipments, providers),
    [selectedYear, interventions, equipments, providers]
  );

  const availableYears = useMemo(() => {
    const yrs = new Set<number>([new Date().getFullYear()]);
    for (const i of interventions) {
      const y = Number(i.date.slice(0, 4));
      if (Number.isFinite(y) && y > 1990) yrs.add(y);
    }
    return Array.from(yrs).sort((a, b) => b - a);
  }, [interventions]);

  const openNewEquipmentModal = () => {
    setEditingEq(null);
    setEqName('');
    setEqCategory('heat_pump');
    setEqLocation('');
    setEqBrand('');
    setEqModel('');
    setEqSerial('');
    setEqPeriodicity('12');
    setEqLastDate('');
    setEqNextDate('');
    setEqAnnualCost('');
    setEqProviderId('');
    setEqNotes('');
    setEqModalOpen(true);
  };

  const openEditEquipmentModal = (eq: MaintenanceEquipment) => {
    setEditingEq(eq);
    setEqName(eq.name);
    setEqCategory(eq.category);
    setEqLocation(eq.location ?? '');
    setEqBrand(eq.brand ?? '');
    setEqModel(eq.model ?? '');
    setEqSerial(eq.serialNumber ?? '');
    setEqPeriodicity(String(eq.periodicityMonths));
    setEqLastDate(eq.lastServiceDate ?? '');
    setEqNextDate(eq.nextServiceDate ?? '');
    setEqAnnualCost(eq.estimatedAnnualCost !== undefined ? String(eq.estimatedAnnualCost) : '');
    setEqProviderId(eq.providerId ?? '');
    setEqNotes(eq.notes ?? '');
    setEqModalOpen(true);
  };

  const handleSaveEquipmentForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eqName.trim()) return;
    const months = Math.max(1, Math.min(120, Number(eqPeriodicity) || 12));
    const computedNext =
      eqNextDate.trim() || (eqLastDate.trim() ? computeNextServiceDate(eqLastDate, months) : '');
    const now = new Date().toISOString();
    const record: MaintenanceEquipment = {
      id: editingEq?.id ?? uid('eq'),
      houseId: house.id,
      name: eqName.trim(),
      category: eqCategory,
      location: eqLocation.trim() || undefined,
      brand: eqBrand.trim() || undefined,
      model: eqModel.trim() || undefined,
      serialNumber: eqSerial.trim() || undefined,
      periodicityMonths: months,
      lastServiceDate: eqLastDate.trim() || undefined,
      nextServiceDate: computedNext || undefined,
      estimatedAnnualCost:
        eqAnnualCost.trim() !== '' && Number.isFinite(Number(eqAnnualCost))
          ? Math.max(0, Number(eqAnnualCost))
          : undefined,
      providerId: eqProviderId || undefined,
      notes: eqNotes.trim() || undefined,
      createdAt: editingEq?.createdAt ?? now,
      updatedAt: now,
    };
    await onSaveEquipment(record);
    setEqModalOpen(false);
  };

  const openNewProviderModal = () => {
    setEditingProv(null);
    setProvCompany('');
    setProvContact('');
    setProvPhone('');
    setProvEmail('');
    setProvWebsite('');
    setProvAddress('');
    setProvSpecialty('');
    setProvNotes('');
    setProvModalOpen(true);
  };

  const openEditProviderModal = (p: ServiceProvider) => {
    setEditingProv(p);
    setProvCompany(p.companyName);
    setProvContact(p.contactName ?? '');
    setProvPhone(p.phone ?? '');
    setProvEmail(p.email ?? '');
    setProvWebsite(p.website ?? '');
    setProvAddress(p.address ?? '');
    setProvSpecialty(p.specialty ?? '');
    setProvNotes(p.notes ?? '');
    setProvModalOpen(true);
  };

  const handleSaveProviderForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provCompany.trim()) return;
    const now = new Date().toISOString();
    const record: ServiceProvider = {
      id: editingProv?.id ?? uid('prov'),
      houseId: house.id,
      companyName: provCompany.trim(),
      contactName: provContact.trim() || undefined,
      phone: provPhone.trim() || undefined,
      email: provEmail.trim() || undefined,
      website: provWebsite.trim() || undefined,
      address: provAddress.trim() || undefined,
      specialty: provSpecialty.trim() || undefined,
      notes: provNotes.trim() || undefined,
      createdAt: editingProv?.createdAt ?? now,
      updatedAt: now,
    };
    await onSaveProvider(record);
    setProvModalOpen(false);
  };

  const openNewInterventionModal = (preselectedEq?: MaintenanceEquipment) => {
    const targetEq = preselectedEq ?? equipments[0];
    const today = new Date().toISOString().slice(0, 10);
    setIntEquipmentId(targetEq?.id ?? '');
    setIntProviderId(targetEq?.providerId ?? '');
    setIntDate(today);
    setIntTitle('Entretien périodique');
    setIntCost('');
    setIntNextDate(
      targetEq ? computeNextServiceDate(today, targetEq.periodicityMonths) : ''
    );
    setIntNotes('');
    setIntModalOpen(true);
  };

  const handleSaveInterventionForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intEquipmentId || !intDate || !intTitle.trim()) return;
    const eq = equipmentMap.get(intEquipmentId);
    const computedNext =
      intNextDate.trim() ||
      (eq ? computeNextServiceDate(intDate, eq.periodicityMonths) : '');
    const now = new Date().toISOString();
    const inter: MaintenanceIntervention = {
      id: uid('int'),
      houseId: house.id,
      equipmentId: intEquipmentId,
      providerId: intProviderId || undefined,
      date: intDate,
      title: intTitle.trim(),
      cost:
        intCost.trim() !== '' && Number.isFinite(Number(intCost))
          ? Math.max(0, Number(intCost))
          : undefined,
      nextDueDate: computedNext || undefined,
      notes: intNotes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    await onSaveIntervention(inter);
    if (eq) {
      await onSaveEquipment({
        ...eq,
        lastServiceDate: intDate,
        nextServiceDate: computedNext || eq.nextServiceDate,
        providerId: intProviderId || eq.providerId,
        updatedAt: now,
      });
    }
    setIntModalOpen(false);
  };

  const handleSaveDocumentForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocError(null);
    if (!docFile || !docTitle.trim()) {
      setDocError('Veuillez renseigner un titre et sélectionner un fichier.');
      return;
    }
    if (docFile.size > 4 * 1024 * 1024) {
      setDocError('Fichier trop volumineux (max 4 Mo).');
      return;
    }
    const { dataUrl, mimeType } = await compressImageIfNeeded(docFile);
    await onAddDocument({
      id: uid('doc'),
      houseId: house.id,
      equipmentId: docEquipmentId || undefined,
      providerId: docProviderId || undefined,
      docType,
      title: docTitle.trim(),
      date: docDate || undefined,
      amount:
        docAmount.trim() !== '' && Number.isFinite(Number(docAmount))
          ? Math.max(0, Number(docAmount))
          : undefined,
      fileName: docFile.name,
      mimeType,
      dataUrl,
      createdAt: new Date().toISOString(),
    });
    setDocModalOpen(false);
    setDocTitle('');
    setDocFile(null);
    setDocAmount('');
  };

  const handleExportIcs = () => {
    const ics = generateIcsCalendar(equipments, providers, house.name);
    triggerDownload(
      `entretien-${house.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.ics`,
      ics,
      'text/calendar;charset=utf-8'
    );
  };

  const handleCopyBudgetJson = async () => {
    const ok = await copyTextToClipboard(JSON.stringify(dashboard.budget.lines, null, 2));
    if (ok) {
      setCopiedBudgetJson(true);
      setTimeout(() => setCopiedBudgetJson(false), 2000);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Entretien Maison & Prestataires
            </h1>
            <p className="text-xs text-slate-500">
              Suivi des équipements, échéances J-30/J-7, justificatifs et provisions annuelles
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportIcs}
              disabled={!equipments.some((e) => e.nextServiceDate)}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5 disabled:opacity-40"
              title="Exporter les prochaines échéances avec rappels J-30 et J-7"
            >
              <Calendar className="w-4 h-4 text-sky-600" />
              Rappels (.ics)
            </button>
            <button
              type="button"
              onClick={() => setBudgetModalOpen(true)}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5"
              title="Exporter les provisions annuelles vers budget-previsionnel"
            >
              <Euro className="w-4 h-4 text-emerald-600" />
              Budget Prévisionnel
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => {
              setSubTab('equipments');
              setUrgencyFilter('overdue');
            }}
            className="text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-rose-300 transition-colors"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>En retard</span>
              <AlertTriangle className="w-4 h-4 text-rose-500" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-rose-600">{dashboard.overdue}</div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSubTab('equipments');
              setUrgencyFilter('action');
            }}
            className="text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-amber-300 transition-colors"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>À prévoir (J-30 / J-7)</span>
              <Bell className="w-4 h-4 text-amber-500" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-amber-600">
              {dashboard.dueSoon7 + dashboard.dueSoon30}
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setSubTab('equipments');
              setUrgencyFilter('ok');
            }}
            className="text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-emerald-300 transition-colors"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>À jour</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-emerald-600">{dashboard.ok}</div>
          </button>

          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Provision entretien</span>
              <Euro className="w-4 h-4 text-slate-400" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-slate-900">
              {dashboard.budget.totalMonthly.toFixed(0)} €/mois
            </div>
            <div className="text-[11px] text-slate-500">
              soit {dashboard.budget.totalAnnual.toFixed(0)} €/an
            </div>
          </div>
        </div>

        {/* Reminder Banner J-30 / J-7 / Overdue */}
        {(dashboard.overdue > 0 || dashboard.dueSoon7 > 0 || dashboard.dueSoon30 > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Alertes échéances :</strong> {dashboard.overdue} en retard,{' '}
                {dashboard.dueSoon7} sous 7 jours (J-7) et {dashboard.dueSoon30} sous 30 jours
                (J-30).
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubTab('equipments');
                setUrgencyFilter('action');
              }}
              className="font-semibold underline hover:text-amber-700"
            >
              Voir les échéances à traiter
            </button>
          </div>
        )}

        {/* Sub-navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-white border border-slate-200 p-1 rounded-2xl max-w-full overflow-x-auto scrollbar-none">
            <button
              type="button"
              onClick={() => setSubTab('equipments')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                subTab === 'equipments'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wrench className="w-4 h-4 shrink-0" />
              Équipements ({equipments.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('providers')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                subTab === 'providers'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              Prestataires ({providers.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('history')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                subTab === 'history'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className="sm:hidden">Historique</span>
              <span className="hidden sm:inline">Interventions, Justificatifs & Dépenses</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {subTab === 'equipments' && (
              <button
                type="button"
                onClick={openNewEquipmentModal}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Ajouter un équipement
              </button>
            )}
            {subTab === 'providers' && (
              <button
                type="button"
                onClick={openNewProviderModal}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Ajouter un prestataire
              </button>
            )}
            {subTab === 'history' && (
              <>
                <button
                  type="button"
                  onClick={() => openNewInterventionModal()}
                  disabled={equipments.length === 0}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                  Intervention
                </button>
                <button
                  type="button"
                  onClick={() => setDocModalOpen(true)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5"
                >
                  <Upload className="w-4 h-4" />
                  Justificatif
                </button>
              </>
            )}
          </div>
        </div>

        {/* TAB 1: Equipments */}
        {subTab === 'equipments' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={urgencyFilter}
                onChange={(e) => setUrgencyFilter(e.target.value as typeof urgencyFilter)}
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700"
              >
                <option value="all">Toutes les échéances</option>
                <option value="action">À traiter (Retard + J-30)</option>
                <option value="overdue">En retard uniquement</option>
                <option value="due_soon_7">Sous 7 jours (J-7)</option>
                <option value="due_soon_30">Sous 30 jours (J-30)</option>
                <option value="ok">À jour</option>
                <option value="unscheduled">Non planifié</option>
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700"
              >
                <option value="all">Toutes les catégories</option>
                {Object.entries(EQUIPMENT_CATEGORY_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            {filteredEquipments.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
                Aucun équipement pour ces critères. Ajoutez votre pompe à chaleur, chaudière,
                radiateurs ou tableau électrique pour suivre les entretiens.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredEquipments.map((eq) => {
                  const urgency = getMaintenanceUrgency(eq.nextServiceDate);
                  const meta = URGENCY_META[urgency];
                  const days = eq.nextServiceDate ? getDaysUntil(eq.nextServiceDate) : Number.NaN;
                  const provider = eq.providerId ? providerMap.get(eq.providerId) : undefined;
                  return (
                    <div
                      key={eq.id}
                      className={`bg-white border ${meta.borderClass} rounded-2xl p-4 space-y-3 shadow-xs`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-bold text-slate-900">{eq.name}</h3>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.badgeClass}`}
                            >
                              {meta.label}
                              {Number.isFinite(days)
                                ? days < 0
                                  ? ` (${Math.abs(days)}j)`
                                  : ` (J-${days})`
                                : ''}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {EQUIPMENT_CATEGORY_LABELS[eq.category]}
                            {eq.location ? ` · ${eq.location}` : ''}
                            {eq.brand ? ` · ${eq.brand}` : ''}
                            {eq.model ? ` ${eq.model}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditEquipmentModal(eq)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            title="Modifier"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteEquipment(eq.id)}
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 rounded-xl p-2.5">
                        <div>
                          <span className="text-slate-500">Dernier entretien :</span>
                          <div className="font-semibold text-slate-800">
                            {eq.lastServiceDate || '—'}
                          </div>
                        </div>
                        <div>
                          <span className="text-slate-500">Prochain entretien :</span>
                          <div className="font-semibold text-slate-800">
                            {eq.nextServiceDate || '—'}
                          </div>
                        </div>
                        <div>
                          <span className="text-slate-500">Périodicité :</span>
                          <div className="font-medium text-slate-700">
                            Tous les {eq.periodicityMonths} mois
                          </div>
                        </div>
                        <div>
                          <span className="text-slate-500">Coût annuel estimé :</span>
                          <div className="font-medium text-slate-700">
                            {eq.estimatedAnnualCost !== undefined
                              ? `${eq.estimatedAnnualCost} €/an`
                              : '—'}
                          </div>
                        </div>
                      </div>

                      {provider && (
                        <div className="text-xs text-slate-600 flex items-center justify-between gap-2">
                          <span>
                            Prestataire : <strong className="text-slate-800">{provider.companyName}</strong>
                          </span>
                          {provider.phone && (
                            <a
                              href={`tel:${provider.phone}`}
                              className="text-sky-600 hover:underline inline-flex items-center gap-1"
                            >
                              <Phone className="w-3 h-3" />
                              {provider.phone}
                            </a>
                          )}
                        </div>
                      )}

                      {eq.notes && <p className="text-xs text-slate-500 italic">{eq.notes}</p>}

                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => openNewInterventionModal(eq)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Enregistrer une intervention
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Providers */}
        {subTab === 'providers' && (
          <div className="space-y-4">
            <input
              type="text"
              maxLength={120}
              value={providerSearch}
              onChange={(e) => setProviderSearch(e.target.value)}
              placeholder="Rechercher un prestataire (nom, contact, spécialité)..."
              className="w-full max-w-md px-3.5 py-2 border border-slate-200 rounded-xl bg-white text-sm"
            />

            {filteredProviders.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
                Aucun prestataire enregistré.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredProviders.map((p) => {
                  const totalSpent = interventions
                    .filter((i) => i.providerId === p.id)
                    .reduce((s, i) => s + (i.cost ?? 0), 0);
                  return (
                    <div
                      key={p.id}
                      className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5 shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-slate-900">{p.companyName}</h3>
                          <p className="text-xs text-slate-500">
                            {p.specialty || 'Prestataire'}
                            {p.contactName ? ` · Contact : ${p.contactName}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditProviderModal(p)}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                            title="Modifier"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteProvider(p.id)}
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1 text-xs text-slate-600">
                        {p.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            <a href={`tel:${p.phone}`} className="text-sky-600 hover:underline">
                              {p.phone}
                            </a>
                          </div>
                        )}
                        {p.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            <a href={`mailto:${p.email}`} className="text-sky-600 hover:underline">
                              {p.email}
                            </a>
                          </div>
                        )}
                        {p.website && (
                          <div className="flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5 text-slate-400" />
                            <a
                              href={p.website.startsWith('http') ? p.website : `https://${p.website}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-600 hover:underline truncate"
                            >
                              {p.website}
                            </a>
                          </div>
                        )}
                        {p.address && (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{p.address}</span>
                          </div>
                        )}
                      </div>

                      {p.notes && <p className="text-xs text-slate-500 italic">{p.notes}</p>}

                      <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                        <span>Total interventions :</span>
                        <span className="font-semibold text-slate-800">{totalSpent.toFixed(2)} €</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: History, Documents & Annual Expenses */}
        {subTab === 'history' && (
          <div className="space-y-6">
            {/* Annual Expenses Breakdown */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900">Suivi des dépenses annuelles</h2>
                  <p className="text-xs text-slate-500">
                    Répartition par équipement et par entreprise sur l’année sélectionnée
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold bg-white"
                  >
                    {availableYears.map((y) => (
                      <option key={y} value={y}>
                        Année {y}
                      </option>
                    ))}
                  </select>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Total {selectedYear}</div>
                    <div className="text-lg font-bold text-slate-900">
                      {annualSummary.totalCost.toFixed(2)} €
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Par équipement
                  </h3>
                  {annualSummary.byEquipment.length === 0 ? (
                    <p className="text-xs text-slate-400">Aucune dépense en {selectedYear}.</p>
                  ) : (
                    annualSummary.byEquipment.map((row) => (
                      <div key={row.equipmentId} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-700 font-medium">{row.equipmentName}</span>
                          <span className="font-semibold text-slate-900">
                            {row.totalCost.toFixed(2)} € ({row.count})
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-slate-800 rounded-full"
                            style={{
                              width: `${annualSummary.totalCost > 0 ? (row.totalCost / annualSummary.totalCost) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Par prestataire
                  </h3>
                  {annualSummary.byProvider.length === 0 ? (
                    <p className="text-xs text-slate-400">Aucune dépense en {selectedYear}.</p>
                  ) : (
                    annualSummary.byProvider.map((row) => (
                      <div key={row.providerId} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-700 font-medium">{row.providerName}</span>
                          <span className="font-semibold text-slate-900">
                            {row.totalCost.toFixed(2)} € ({row.count})
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-sky-600 rounded-full"
                            style={{
                              width: `${annualSummary.totalCost > 0 ? (row.totalCost / annualSummary.totalCost) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Interventions List */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h2 className="font-bold text-slate-900">
                Historique des interventions ({interventions.length})
              </h2>
              {interventions.length === 0 ? (
                <p className="text-xs text-slate-500">Aucune intervention enregistrée.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {[...interventions]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((item) => {
                      const eq = equipmentMap.get(item.equipmentId);
                      const prov = item.providerId ? providerMap.get(item.providerId) : undefined;
                      return (
                        <div
                          key={item.id}
                          className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-slate-900">
                              {item.date} — {item.title}
                            </div>
                            <div className="text-slate-500">
                              {eq?.name ?? 'Équipement'}
                              {prov ? ` · ${prov.companyName}` : ''}
                              {item.nextDueDate ? ` · Prochain : ${item.nextDueDate}` : ''}
                            </div>
                            {item.notes && <div className="text-slate-500 italic mt-0.5">{item.notes}</div>}
                          </div>
                          <div className="flex items-center gap-3">
                            {item.cost !== undefined && (
                              <span className="font-bold text-slate-900">{item.cost.toFixed(2)} €</span>
                            )}
                            <button
                              type="button"
                              onClick={() => onDeleteIntervention(item.id)}
                              className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Documents / Justificatifs */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <h2 className="font-bold text-slate-900">
                Justificatifs, factures & attestations ({documents.length})
              </h2>
              {documents.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Aucun justificatif enregistré (factures, devis, attestations d’entretien, notices,
                  photos).
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {documents.map((docItem) => {
                    const eq = docItem.equipmentId ? equipmentMap.get(docItem.equipmentId) : undefined;
                    const prov = docItem.providerId ? providerMap.get(docItem.providerId) : undefined;
                    return (
                      <div
                        key={docItem.id}
                        className="border border-slate-200 rounded-xl p-3 flex flex-col justify-between gap-2"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                              {MAINTENANCE_DOC_TYPE_LABELS[docItem.docType]}
                            </span>
                            <button
                              type="button"
                              onClick={() => onDeleteDocument(docItem.id)}
                              className="p-1 rounded-lg text-rose-500 hover:bg-rose-50"
                              title="Supprimer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="font-semibold text-xs text-slate-900 mt-1.5">
                            {docItem.title}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {docItem.date || ''}
                            {docItem.amount !== undefined ? ` · ${docItem.amount.toFixed(2)} €` : ''}
                            {eq ? ` · ${eq.name}` : ''}
                            {prov ? ` · ${prov.companyName}` : ''}
                          </div>
                        </div>

                        {docItem.mimeType.startsWith('image/') && (
                          <img
                            src={docItem.dataUrl}
                            alt={docItem.title}
                            className="w-full h-28 object-cover rounded-lg border border-slate-100"
                          />
                        )}

                        <a
                          href={docItem.dataUrl}
                          download={docItem.fileName}
                          className="text-xs font-medium text-sky-600 hover:underline inline-flex items-center gap-1 min-w-0 max-w-full"
                        >
                          <Download className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">Télécharger ({docItem.fileName})</span>
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Equipment */}
      {eqModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <form
            onSubmit={handleSaveEquipmentForm}
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">
                {editingEq ? 'Modifier l’équipement' : 'Nouvel équipement'}
              </h3>
              <button
                type="button"
                onClick={() => setEqModalOpen(false)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Nom *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={eqName}
                  onChange={(e) => setEqName(e.target.value)}
                  placeholder="Ex: Pompe à chaleur Air/Eau"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Catégorie</label>
                <select
                  value={eqCategory}
                  onChange={(e) => setEqCategory(e.target.value as EquipmentCategory)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  {Object.entries(EQUIPMENT_CATEGORY_LABELS).map(([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Emplacement</label>
                <input
                  type="text"
                  maxLength={80}
                  value={eqLocation}
                  onChange={(e) => setEqLocation(e.target.value)}
                  placeholder="Ex: Garage / RDC"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Marque</label>
                <input
                  type="text"
                  maxLength={80}
                  value={eqBrand}
                  onChange={(e) => setEqBrand(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Modèle</label>
                <input
                  type="text"
                  maxLength={80}
                  value={eqModel}
                  onChange={(e) => setEqModel(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Périodicité (mois)
                </label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={eqPeriodicity}
                  onChange={(e) => setEqPeriodicity(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Coût annuel estimé (€)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  step="0.01"
                  value={eqAnnualCost}
                  onChange={(e) => setEqAnnualCost(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Dernier entretien
                </label>
                <input
                  type="date"
                  min="1990-01-01"
                  max="2100-12-31"
                  value={eqLastDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEqLastDate(val);
                    if (val && !eqNextDate) {
                      setEqNextDate(computeNextServiceDate(val, Number(eqPeriodicity) || 12));
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prochain entretien
                </label>
                <input
                  type="date"
                  min="1990-01-01"
                  max="2100-12-31"
                  value={eqNextDate}
                  onChange={(e) => setEqNextDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prestataire attitré
                </label>
                <select
                  value={eqProviderId}
                  onChange={(e) => setEqProviderId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  <option value="">Aucun prestataire</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.companyName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={eqNotes}
                  onChange={(e) => setEqNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEqModalOpen(false)}
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
        </div>
      )}

      {/* Modal: Provider */}
      {provModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <form
            onSubmit={handleSaveProviderForm}
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">
                {editingProv ? 'Modifier le prestataire' : 'Nouveau prestataire'}
              </h3>
              <button
                type="button"
                onClick={() => setProvModalOpen(false)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Société *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={provCompany}
                  onChange={(e) => setProvCompany(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Interlocuteur
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={provContact}
                  onChange={(e) => setProvContact(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Spécialité</label>
                <input
                  type="text"
                  maxLength={80}
                  value={provSpecialty}
                  onChange={(e) => setProvSpecialty(e.target.value)}
                  placeholder="Ex: Chauffagiste, Électricien"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Téléphone</label>
                <input
                  type="tel"
                  maxLength={40}
                  value={provPhone}
                  onChange={(e) => setProvPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  maxLength={120}
                  value={provEmail}
                  onChange={(e) => setProvEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Site web</label>
                <input
                  type="text"
                  maxLength={200}
                  value={provWebsite}
                  onChange={(e) => setProvWebsite(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Adresse</label>
                <input
                  type="text"
                  maxLength={200}
                  value={provAddress}
                  onChange={(e) => setProvAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={provNotes}
                  onChange={(e) => setProvNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setProvModalOpen(false)}
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
        </div>
      )}

      {/* Modal: Intervention */}
      {intModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <form
            onSubmit={handleSaveInterventionForm}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">Enregistrer une intervention</h3>
              <button
                type="button"
                onClick={() => setIntModalOpen(false)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Équipement *
                </label>
                <select
                  required
                  value={intEquipmentId}
                  onChange={(e) => {
                    const eq = equipmentMap.get(e.target.value);
                    setIntEquipmentId(e.target.value);
                    if (eq) {
                      setIntProviderId(eq.providerId ?? '');
                      setIntNextDate(computeNextServiceDate(intDate, eq.periodicityMonths));
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  {equipments.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Intitulé *</label>
                <input
                  type="text"
                  required
                  maxLength={150}
                  value={intTitle}
                  onChange={(e) => setIntTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    min="1990-01-01"
                    max="2100-12-31"
                    value={intDate}
                    onChange={(e) => {
                      const d = e.target.value;
                      setIntDate(d);
                      const eq = equipmentMap.get(intEquipmentId);
                      if (eq && d) {
                        setIntNextDate(computeNextServiceDate(d, eq.periodicityMonths));
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Coût (€)</label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step="0.01"
                    value={intCost}
                    onChange={(e) => setIntCost(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Prestataire</label>
                <select
                  value={intProviderId}
                  onChange={(e) => setIntProviderId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  <option value="">Aucun / Fait soi-même</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.companyName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prochain entretien prévu
                </label>
                <input
                  type="date"
                  min="1990-01-01"
                  max="2100-12-31"
                  value={intNextDate}
                  onChange={(e) => setIntNextDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={intNotes}
                  onChange={(e) => setIntNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIntModalOpen(false)}
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
        </div>
      )}

      {/* Modal: Document */}
      {docModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <form
            onSubmit={handleSaveDocumentForm}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900">Ajouter un justificatif</h3>
              <button
                type="button"
                onClick={() => setDocModalOpen(false)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {docError && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-xs text-rose-700">
                {docError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as MaintenanceDocType)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  {Object.entries(MAINTENANCE_DOC_TYPE_LABELS).map(([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Titre *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Ex: Facture entretien PAC 2026"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    min="1990-01-01"
                    max="2100-12-31"
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Montant (€)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step="0.01"
                    value={docAmount}
                    onChange={(e) => setDocAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Équipement</label>
                <select
                  value={docEquipmentId}
                  onChange={(e) => setDocEquipmentId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  <option value="">Aucun</option>
                  {equipments.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prestataire
                </label>
                <select
                  value={docProviderId}
                  onChange={(e) => setDocProviderId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white"
                >
                  <option value="">Aucun</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Fichier (PDF, image, document) *
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf,.doc,.docx,.txt"
                  onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-slate-600"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDocModalOpen(false)}
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
        </div>
      )}

      {/* Modal: Budget Prévisionnel Bridge (V3) */}
      {budgetModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg text-slate-900">
                  Passerelle Budget Prévisionnel
                </h3>
                <p className="text-xs text-slate-500">
                  Provisions annuelles mensualisées (/ 12) compatibles avec budget-previsionnel
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBudgetModalOpen(false)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-emerald-800">
                Total provisions entretien :
              </span>
              <span className="text-sm font-bold text-emerald-900">
                {dashboard.budget.totalMonthly.toFixed(2)} €/mois ({dashboard.budget.totalAnnual.toFixed(2)} €/an)
              </span>
            </div>

            {dashboard.budget.lines.length === 0 ? (
              <p className="text-xs text-slate-500">
                Renseignez un « Coût annuel estimé » sur vos équipements ou enregistrez une
                intervention chiffrée pour calculer les provisions.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl px-3">
                {dashboard.budget.lines.map((line) => (
                  <div key={line.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">{line.label}</div>
                      <div className="text-[11px] text-slate-500">{line.comment}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-slate-900">
                        {line.monthlyProvision.toFixed(2)} €/mois
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {line.annualAmount.toFixed(2)} €/an
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={dashboard.budget.lines.length === 0}
                onClick={handleCopyBudgetJson}
                className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                {copiedBudgetJson ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copiedBudgetJson ? 'JSON copié' : 'Copier JSON'}
              </button>
              <button
                type="button"
                disabled={dashboard.budget.lines.length === 0}
                onClick={() =>
                  triggerDownload(
                    `provisions-entretien-${house.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.csv`,
                    dashboard.budget.csv,
                    'text/csv;charset=utf-8'
                  )
                }
                className="px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                <Download className="w-4 h-4" />
                Télécharger CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
