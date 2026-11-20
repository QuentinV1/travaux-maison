import { describe, expect, it } from 'vitest';
import {
  buildBudgetPrevisionnelExport,
  computeAnnualExpenses,
  computeNextServiceDate,
  generateIcsCalendar,
  getDaysUntil,
  getMaintenanceUrgency,
} from './maintenance';
import type {
  MaintenanceEquipment,
  MaintenanceIntervention,
  ServiceProvider,
} from '../types';

describe('maintenance helpers', () => {
  it('computes next service date cleanly across year boundaries and short months', () => {
    expect(computeNextServiceDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(computeNextServiceDate('2026-06-15', 12)).toBe('2027-06-15');
    expect(computeNextServiceDate('2026-11-20', 6)).toBe('2027-05-20');
    expect(computeNextServiceDate('', 12)).toBe('');
  });

  it('classifies urgency into overdue, J-7, J-30, ok, and unscheduled', () => {
    const ref = new Date(2026, 10, 20); // 2026-11-20
    expect(getDaysUntil('2026-11-19', ref)).toBe(-1);
    expect(getMaintenanceUrgency('2026-11-19', ref)).toBe('overdue');
    expect(getMaintenanceUrgency('2026-11-25', ref)).toBe('due_soon_7');
    expect(getMaintenanceUrgency('2026-12-10', ref)).toBe('due_soon_30');
    expect(getMaintenanceUrgency('2027-03-01', ref)).toBe('ok');
    expect(getMaintenanceUrgency(undefined, ref)).toBe('unscheduled');
  });

  it('computes annual expenses grouped by equipment and provider', () => {
    const equipments: MaintenanceEquipment[] = [
      {
        id: 'eq1',
        houseId: 'h1',
        name: 'PAC Air/Eau',
        category: 'heat_pump',
        periodicityMonths: 12,
        createdAt: '2026-01-01',
      },
      {
        id: 'eq2',
        houseId: 'h1',
        name: 'Tableau électrique',
        category: 'electricity',
        periodicityMonths: 24,
        createdAt: '2026-01-01',
      },
    ];
    const providers: ServiceProvider[] = [
      { id: 'p1', houseId: 'h1', companyName: 'ThermoPro', createdAt: '2026-01-01' },
    ];
    const interventions: MaintenanceIntervention[] = [
      {
        id: 'i1',
        houseId: 'h1',
        equipmentId: 'eq1',
        providerId: 'p1',
        date: '2026-03-10',
        title: 'Entretien annuel',
        cost: 180,
        createdAt: '2026-03-10',
      },
      {
        id: 'i2',
        houseId: 'h1',
        equipmentId: 'eq2',
        date: '2026-05-01',
        title: 'Contrôle',
        cost: 90,
        createdAt: '2026-05-01',
      },
      {
        id: 'i3',
        houseId: 'h1',
        equipmentId: 'eq1',
        providerId: 'p1',
        date: '2025-03-10',
        title: 'Ancien',
        cost: 150,
        createdAt: '2025-03-10',
      },
    ];

    const summary = computeAnnualExpenses(2026, interventions, equipments, providers);
    expect(summary.totalCost).toBe(270);
    expect(summary.byEquipment[0]).toMatchObject({ equipmentId: 'eq1', totalCost: 180, count: 1 });
    expect(summary.byProvider[0]).toMatchObject({ providerName: 'ThermoPro', totalCost: 180 });
  });

  it('generates valid .ics calendar with J-30 and J-7 VALARM triggers', () => {
    const equipments: MaintenanceEquipment[] = [
      {
        id: 'eq1',
        houseId: 'h1',
        name: 'Chaudière',
        category: 'heating',
        periodicityMonths: 12,
        nextServiceDate: '2026-12-15',
        createdAt: '2026-01-01',
      },
    ];
    const ics = generateIcsCalendar(equipments, [], 'Maison');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261215');
    expect(ics).toContain('TRIGGER:-P30D');
    expect(ics).toContain('TRIGGER:-P7D');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('builds budget-previsionnel compatible annual & monthly provisions', () => {
    const equipments: MaintenanceEquipment[] = [
      {
        id: 'eq1',
        houseId: 'h1',
        name: 'PAC',
        category: 'heat_pump',
        periodicityMonths: 12,
        estimatedAnnualCost: 240,
        createdAt: '2026-01-01',
      },
    ];
    const out = buildBudgetPrevisionnelExport(equipments, [], 'Maison');
    expect(out.totalAnnual).toBe(240);
    expect(out.totalMonthly).toBe(20);
    expect(out.lines[0]).toMatchObject({
      section: 'expense',
      group: 'logement',
      mode: 'annual',
      annualAmount: 240,
      monthlyProvision: 20,
      tags: ['Provision'],
    });
    expect(out.csv).toContain('240,00');
  });
});
