import React, { useState } from 'react';
import { Sparkles, X, CheckCircle2, AlertCircle, KeyRound, ExternalLink, Loader2, LayoutGrid } from 'lucide-react';
import { loadAppSettings, saveAppSettings } from '../utils/settings';
import { testGeminiConnection } from '../utils/aiService';
import { useEscapeKey } from '../utils/useEscapeKey';

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const AISettingsModal: React.FC<AISettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
  const initial = loadAppSettings();
  const [geminiApiKey, setGeminiApiKey] = useState(initial.geminiApiKey);
  const [comfyUiUrl, setComfyUiUrl] = useState(initial.comfyUiUrl || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showOtherApps, setShowOtherApps] = useState(false);

  useEscapeKey(isOpen, () => {
    if (showOtherApps) {
      setShowOtherApps(false);
    } else {
      onClose();
    }
  });

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveAppSettings({
      geminiApiKey: geminiApiKey.trim(),
      comfyUiUrl: comfyUiUrl.trim(),
    });
    onSaved();
    onClose();
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await testGeminiConnection(geminiApiKey);
      setTestResult(
        ok
          ? { ok: true, message: 'Connexion Firebase AI Logic (Gemini) réussie !' }
          : { ok: false, message: 'Réponse inattendue de l’API.' }
      );
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Échec de connexion à Gemini.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-violet-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Paramètres IA — V3 (100 % Gratuit)</h2>
              <p className="text-xs text-slate-500">Stockage local sécurisé dans votre navigateur</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white/80"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-3.5 text-xs text-violet-900 space-y-1.5">
            <p className="font-semibold">Comment obtenir une clé Gemini gratuite ?</p>
            <p>
              Google propose un palier <strong>100 % gratuit</strong> via Google AI Studio. Votre clé reste
              strictement sur votre appareil et n’est envoyée qu’aux serveurs Google lors de vos demandes IA.
            </p>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline pt-0.5"
            >
              Créer ma clé gratuite sur Google AI Studio <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-violet-600" />
              Clé API Google Gemini
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                maxLength={200}
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="flex-1 px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1.5 min-h-[42px]"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Tester'}
              </button>
            </div>
          </div>

          {testResult && (
            <div
              className={`rounded-xl p-3 text-xs flex items-start gap-2 ${
                testResult.ok
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">
              URL ComfyUI locale (Optionnel — pour génération GPU illimitée)
            </label>
            <input
              type="url"
              maxLength={250}
              value={comfyUiUrl}
              onChange={(e) => setComfyUiUrl(e.target.value)}
              placeholder="http://127.0.0.1:8188"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">Mes autres applications</p>
              <p className="text-[11px] text-slate-500">
                Accéder rapidement aux autres applications web (GitHub Pages).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowOtherApps(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Ouvrir
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 shadow-sm"
            >
              Enregistrer
            </button>
          </div>
        </form>
      </div>

      {showOtherApps && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
          onClick={() => setShowOtherApps(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <LayoutGrid className="w-4 h-4 text-violet-600" />
                Mes autres applications
              </h3>
              <button
                type="button"
                onClick={() => setShowOtherApps(false)}
                aria-label="Fermer"
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-5">
              <p className="text-xs text-slate-500">
                Retrouvez toutes les autres applications hébergées sur GitHub Pages.
              </p>
              <div className="grid gap-2">
                {[
                  { name: "L'Affinoir", desc: "Charcuterie, salaisons & cave d'affinage", url: 'https://quentinv1.github.io/app-charcuterie/' },
                  { name: 'Pêche France', desc: 'Réglementation, mailles, cartes & carnet de prises', url: 'https://quentinv1.github.io/app-peche/' },
                  { name: 'App Voyage', desc: "Planificateur d'itinéraire, carte & carnet de voyage", url: 'https://quentinv1.github.io/app-voyage/' },
                  { name: 'Budget Prévisionnel', desc: 'Budget du foyer, provisions & projections', url: 'https://quentinv1.github.io/budget-previsionnel/' },
                  { name: 'Cave à vin', desc: 'Stock de bouteilles, apogée & dégustations', url: 'https://quentinv1.github.io/cave-a-vin/' },
                  { name: 'Checklist Valise', desc: 'Bagages, calculateur de poids & règles IATA', url: 'https://quentinv1.github.io/checklist-valise/' },
                  { name: 'Livre de recettes', desc: 'Recettes, planning semaine & liste de courses', url: 'https://quentinv1.github.io/livre-recettes/' },
                  { name: 'Suivi Chasse', desc: 'Carnet de sorties, carte & album trophées', url: 'https://quentinv1.github.io/suivi-chasse/' },
                ].map((app) => (
                  <a
                    key={app.url}
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 transition hover:border-violet-300 hover:bg-violet-50/40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{app.name}</div>
                      <div className="truncate text-xs text-slate-500">{app.desc}</div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-600">
                      Ouvrir <ExternalLink className="w-3.5 h-3.5" />
                    </span>
                  </a>
                ))}
              </div>
            </div>
            <div className="flex justify-end border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowOtherApps(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
