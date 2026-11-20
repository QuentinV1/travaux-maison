import type {
  EquipmentCategory,
  MaintenanceDocType,
  MaintenanceEquipment,
  MaintenanceIntervention,
  ServiceProvider,
} from '../types';

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  heat_pump: 'Pompe à chaleur',
  heating: 'Chauffage / Chaudière',
  radiator: 'Radiateur',
  electricity: 'Électricité / Tableau',
  plumbing: 'Plomberie / Eau',
  ventilation: 'VMC / Ventilation',
  other: 'Autre équipement',
};

export const MAINTENANCE_DOC_TYPE_LABELS: Record<MaintenanceDocType, string> = {
  invoice: 'Facture',
  quote: 'Devis',
  certificate: 'Attestation d’entretien',
  manual: 'Notice / Manuel',
  photo: 'Photo',
  other: 'Autre document',
};

export type MaintenanceUrgency =
  | 'overdue'
  | 'due_soon_7'
  | 'due_soon_30'
  | 'ok'
  | 'unscheduled';

/**
 * Adds `periodicityMonths` to an ISO `YYYY-MM-DD` date string without timezone drift.
 */
export function computeNextServiceDate(lastDate: string, periodicityMonths: number): string {
  if (!lastDate || !Number.isFinite(periodicityMonths) || periodicityMonths <= 0) {
    return '';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lastDate.trim());
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);

  const targetMonthTotal = year * 12 + month + Math.round(periodicityMonths);
  const targetYear = Math.floor(targetMonthTotal / 12);
  const targetMonth = targetMonthTotal % 12;

  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);

  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Returns the integer number of days from `referenceDate` (local midnight) to `dateStr` (`YYYY-MM-DD`).
 */
export function getDaysUntil(dateStr: string, referenceDate: Date = new Date()): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return Number.NaN;
  const targetUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const refUtc = Date.UTC(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  return Math.round((targetUtc - refUtc) / 86_400_000);
}

/**
 * Classifies an equipment's maintenance urgency (overdue, J-7, J-30, ok, or unscheduled).
 */
export function getMaintenanceUrgency(
  nextServiceDate: string | undefined,
  referenceDate: Date = new Date()
): MaintenanceUrgency {
  if (!nextServiceDate) return 'unscheduled';
  const days = getDaysUntil(nextServiceDate, referenceDate);
  if (Number.isNaN(days)) return 'unscheduled';
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due_soon_7';
  if (days <= 30) return 'due_soon_30';
  return 'ok';
}

export interface AnnualExpenseSummary {
  year: number;
  totalCost: number;
  byEquipment: Array<{ equipmentId: string; equipmentName: string; totalCost: number; count: number }>;
  byProvider: Array<{ providerId: string; providerName: string; totalCost: number; count: number }>;
}

/**
 * Computes annual maintenance expenses grouped by equipment and by provider for a given year.
 */
export function computeAnnualExpenses(
  year: number,
  interventions: MaintenanceIntervention[],
  equipments: MaintenanceEquipment[],
  providers: ServiceProvider[]
): AnnualExpenseSummary {
  const equipMap = new Map(equipments.map((e) => [e.id, e.name]));
  const provMap = new Map(providers.map((p) => [p.id, p.companyName]));

  const eqTotals = new Map<string, { totalCost: number; count: number }>();
  const provTotals = new Map<string, { totalCost: number; count: number }>();
  let totalCost = 0;

  for (const item of interventions) {
    if (!item.date.startsWith(`${year}-`)) continue;
    const cost = Number(item.cost ?? 0);
    if (!Number.isFinite(cost) || cost < 0) continue;
    totalCost += cost;

    const eqCur = eqTotals.get(item.equipmentId) ?? { totalCost: 0, count: 0 };
    eqCur.totalCost += cost;
    eqCur.count += 1;
    eqTotals.set(item.equipmentId, eqCur);

    const pKey = item.providerId || '__none__';
    const pCur = provTotals.get(pKey) ?? { totalCost: 0, count: 0 };
    pCur.totalCost += cost;
    pCur.count += 1;
    provTotals.set(pKey, pCur);
  }

  const byEquipment = Array.from(eqTotals.entries())
    .map(([equipmentId, v]) => ({
      equipmentId,
      equipmentName: equipMap.get(equipmentId) ?? 'Équipement supprimé',
      totalCost: Math.round(v.totalCost * 100) / 100,
      count: v.count,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  const byProvider = Array.from(provTotals.entries())
    .map(([providerId, v]) => ({
      providerId,
      providerName:
        providerId === '__none__'
          ? 'Sans prestataire'
          : (provMap.get(providerId) ?? 'Prestataire supprimé'),
      totalCost: Math.round(v.totalCost * 100) / 100,
      count: v.count,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  return {
    year,
    totalCost: Math.round(totalCost * 100) / 100,
    byEquipment,
    byProvider,
  };
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Generates an RFC 5545 .ics calendar containing scheduled maintenance events with J-30 and J-7 reminders.
 */
export function generateIcsCalendar(
  equipments: MaintenanceEquipment[],
  providers: ServiceProvider[],
  houseName: string
): string {
  const provMap = new Map(providers.map((p) => [p.id, p]));
  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TravauxMaison//EntretienMaison//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`Entretien - ${houseName}`)}`,
  ];

  for (const eq of equipments) {
    if (!eq.nextServiceDate) continue;
    const dateCompact = eq.nextServiceDate.replace(/-/g, '');
    if (!/^\d{8}$/.test(dateCompact)) continue;

    const nextDay = new Date(`${eq.nextServiceDate}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const dtEnd = nextDay.toISOString().slice(0, 10).replace(/-/g, '');

    const provider = eq.providerId ? provMap.get(eq.providerId) : undefined;
    const descParts = [
      `Catégorie : ${EQUIPMENT_CATEGORY_LABELS[eq.category]}`,
      eq.location ? `Emplacement : ${eq.location}` : '',
      provider ? `Prestataire : ${provider.companyName}${provider.phone ? ` (${provider.phone})` : ''}` : '',
      eq.estimatedAnnualCost ? `Coût annuel estimé : ${eq.estimatedAnnualCost} €` : '',
      eq.notes ? `Notes : ${eq.notes}` : '',
    ].filter(Boolean);

    lines.push(
      'BEGIN:VEVENT',
      `UID:entretien-${eq.id}@travaux-maison`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART;VALUE=DATE:${dateCompact}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${escapeIcsText(`Entretien : ${eq.name}`)}`,
      `DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`Rappel J-30 : Entretien ${eq.name}`)}`,
      'TRIGGER:-P30D',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`Rappel J-7 : Entretien ${eq.name}`)}`,
      'TRIGGER:-P7D',
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export interface BudgetProvisionLine {
  id: string;
  section: 'expense';
  group: 'logement';
  label: string;
  comment: string;
  mode: 'annual';
  amount: number;
  annualAmount: number;
  share: number;
  tags: string[];
  monthlyProvision: number;
}

/**
 * Builds annual & monthly provision lines compatible with `budget-previsionnel`.
 */
export function buildBudgetPrevisionnelExport(
  equipments: MaintenanceEquipment[],
  interventions: MaintenanceIntervention[],
  houseName: string
): {
  totalAnnual: number;
  totalMonthly: number;
  lines: BudgetProvisionLine[];
  csv: string;
} {
  const lines: BudgetProvisionLine[] = [];

  for (const eq of equipments) {
    let annual = eq.estimatedAnnualCost ?? 0;
    if (annual <= 0) {
      const latestWithCost = interventions
        .filter((i) => i.equipmentId === eq.id && (i.cost ?? 0) > 0)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (latestWithCost?.cost && eq.periodicityMonths > 0) {
        annual = (latestWithCost.cost * 12) / eq.periodicityMonths;
      }
    }
    const roundedAnnual = Math.round(annual * 100) / 100;
    if (roundedAnnual <= 0) continue;

    const monthlyProvision = Math.round((roundedAnnual / 12) * 100) / 100;
    lines.push({
      id: `travaux_prov_${eq.id}`,
      section: 'expense',
      group: 'logement',
      label: `Entretien ${eq.name}`,
      comment: `${houseName} · ${EQUIPMENT_CATEGORY_LABELS[eq.category]} (tous les ${eq.periodicityMonths} mois)`,
      mode: 'annual',
      amount: 0,
      annualAmount: roundedAnnual,
      share: 100,
      tags: ['Provision'],
      monthlyProvision,
    });
  }

  const totalAnnual = Math.round(lines.reduce((s, l) => s + l.annualAmount, 0) * 100) / 100;
  const totalMonthly = Math.round((totalAnnual / 12) * 100) / 100;

  const csvRows = [
    ['Libellé', 'Catégorie Budget', 'Mode', 'Montant Annuel (€)', 'Provision Mensuelle (€)', 'Commentaire', 'Tags'].join(';'),
    ...lines.map((l) =>
      [
        `"${l.label.replace(/"/g, '""')}"`,
        'logement',
        'annual',
        l.annualAmount.toFixed(2).replace('.', ','),
        l.monthlyProvision.toFixed(2).replace('.', ','),
        `"${l.comment.replace(/"/g, '""')}"`,
        'Provision',
      ].join(';')
    ),
  ];

  return {
    totalAnnual,
    totalMonthly,
    lines,
    csv: csvRows.join('\n'),
  };
}
