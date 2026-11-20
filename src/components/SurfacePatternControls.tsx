import React from 'react';
import type { SurfacePattern, SurfacePatternType } from '../types';
import { SURFACE_PATTERN_LABELS } from '../data/furnitureCatalog';

interface SurfacePatternControlsProps {
  label?: string;
  pattern?: SurfacePattern;
  defaultPrimary?: string;
  defaultSecondary?: string;
  onChange: (next: SurfacePattern | undefined) => void;
}

const PATTERN_PRESETS: { name: string; pattern: SurfacePattern }[] = [
  {
    name: 'Damier N&B',
    pattern: { type: 'checkerboard', primaryColor: '#f8fafc', secondaryColor: '#1e293b', scaleCm: 35 },
  },
  {
    name: 'Damier Sauge',
    pattern: { type: 'checkerboard', primaryColor: '#f8fafc', secondaryColor: '#84a98c', scaleCm: 35 },
  },
  {
    name: 'Rayures Lin',
    pattern: { type: 'stripes-vertical', primaryColor: '#faf5f0', secondaryColor: '#d6c7b2', scaleCm: 30 },
  },
  {
    name: 'Chevron Or',
    pattern: { type: 'herringbone-wallpaper', primaryColor: '#f8fafc', secondaryColor: '#c8a96e', scaleCm: 40 },
  },
];

export const SurfacePatternControls: React.FC<SurfacePatternControlsProps> = ({
  label = 'Motif / Papier peint',
  pattern,
  defaultPrimary = '#f8fafc',
  defaultSecondary = '#334155',
  onChange,
}) => {
  const currentType: SurfacePatternType = pattern?.type ?? 'none';
  const primary = pattern?.primaryColor ?? defaultPrimary;
  const secondary = pattern?.secondaryColor ?? defaultSecondary;
  const scaleCm = pattern?.scaleCm ?? 40;

  const update = (patch: Partial<SurfacePattern>) => {
    const nextType = patch.type ?? currentType;
    if (nextType === 'none') {
      onChange(undefined);
      return;
    }
    onChange({
      type: nextType,
      primaryColor: patch.primaryColor ?? primary,
      secondaryColor: patch.secondaryColor ?? secondary,
      scaleCm: patch.scaleCm ?? scaleCm,
    });
  };

  return (
    <div className="pt-2 border-t border-slate-100 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-600">{label}</span>
        {currentType !== 'none' && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[11px] font-semibold text-rose-600 hover:underline"
          >
            Retirer
          </button>
        )}
      </div>

      <select
        value={currentType}
        onChange={(e) => update({ type: e.target.value as SurfacePatternType })}
        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-xl bg-white font-semibold"
      >
        {Object.entries(SURFACE_PATTERN_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>

      <div className="flex flex-wrap gap-1">
        {PATTERN_PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => onChange({ ...p.pattern })}
            className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-semibold text-slate-700"
          >
            {p.name}
          </button>
        ))}
      </div>

      {currentType !== 'none' && (
        <div className="space-y-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center justify-between gap-1">
              <span className="text-[11px] text-slate-600">Couleur 1</span>
              <input
                type="color"
                value={primary}
                onChange={(e) => update({ primaryColor: e.target.value })}
                className="w-7 h-6 rounded border border-slate-300 cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between gap-1">
              <span className="text-[11px] text-slate-600">Couleur 2</span>
              <input
                type="color"
                value={secondary}
                onChange={(e) => update({ secondaryColor: e.target.value })}
                className="w-7 h-6 rounded border border-slate-300 cursor-pointer"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <div className="flex justify-between text-[11px] text-slate-600">
              <span>Taille du motif</span>
              <span className="font-semibold">{scaleCm} cm</span>
            </div>
            <input
              type="range"
              min={15}
              max={100}
              step={5}
              value={scaleCm}
              onChange={(e) => update({ scaleCm: Number(e.target.value) })}
              className="w-full accent-indigo-600 h-1.5"
            />
          </label>
        </div>
      )}
    </div>
  );
};
