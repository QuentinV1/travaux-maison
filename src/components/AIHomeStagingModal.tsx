import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Wand2,
  Loader2,
  AlertCircle,
  ExternalLink,
  Save,
  Palette,
  ShoppingBag,
  CheckCircle2,
} from 'lucide-react';
import type { RoomPhoto } from '../types';
import {
  analyzeAndStageRoomPhoto,
  PARTNER_STORES,
  type HomeStagingResult,
  type SuggestedDecoItem,
} from '../utils/aiService';
import { loadAppSettings } from '../utils/settings';
import { useEscapeKey } from '../utils/useEscapeKey';

interface AIHomeStagingModalProps {
  photo: RoomPhoto | null;
  onClose: () => void;
  onOpenSettings: () => void;
  onSaveSimulatedPhoto: (dataUrl: string, caption: string) => void;
  onAddSuggestedToPlan?: (item: SuggestedDecoItem) => void;
}

const STYLES = [
  'Scandinave chaleureux',
  'Moderne & Épuré',
  'Industriel Loft',
  'Japandi (Bois & Lin)',
  'Rustique Chic',
  'Contemporain Lumineux',
];

export const AIHomeStagingModal: React.FC<AIHomeStagingModalProps> = ({
  photo,
  onClose,
  onOpenSettings,
  onSaveSimulatedPhoto,
  onAddSuggestedToPlan,
}) => {
  useEscapeKey(photo !== null, onClose);
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const [customPrompt, setCustomPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HomeStagingResult | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  if (!photo) return null;

  const settings = loadAppSettings();
  const hasKey = settings.geminiApiKey.trim().length > 10;

  const handleRunStaging = async () => {
    if (!hasKey) {
      setError('Ajoutez d’abord votre clé API Gemini gratuite dans les réglages IA.');
      return;
    }
    setLoading(true);
    setError(null);
    setSavedNotice(false);
    try {
      const res = await analyzeAndStageRoomPhoto(
        settings.geminiApiKey,
        photo.dataUrl,
        selectedStyle,
        customPrompt.trim()
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la simulation IA.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 z-50">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-violet-50 to-fuchsia-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Simulation Home Staging IA — {photo.roomName}
              </h2>
              <p className="text-xs text-slate-500">
                Transformez votre photo & trouvez les meubles similaires en ligne
              </p>
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

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {!hasKey && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-between gap-3">
              <div className="text-xs text-amber-900">
                <strong>Clé API Gemini requise :</strong> Configurez votre clé gratuite pour simuler la pièce.
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 shrink-0"
              >
                Configurer
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {/* Photo originale */}
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Photo d’origine
              </div>
              <img
                src={photo.dataUrl}
                alt={photo.caption || photo.roomName}
                className="w-full h-56 object-cover rounded-2xl border border-slate-200 bg-slate-100"
              />
            </div>

            {/* Configuration du style */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Style d’aménagement souhaité
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => setSelectedStyle(style)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                      selectedStyle === style
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Précisions optionnelles : parquet chêne clair, mur vert sauge, grand canapé beige, suspension rotin..."
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-2xl text-xs sm:text-sm"
              />
              <button
                type="button"
                disabled={loading}
                onClick={handleRunStaging}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Génération de la simulation en cours...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    Lancer la simulation IA
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Résultats IA */}
          {result && (
            <div className="space-y-4 pt-2 border-t border-slate-200">
              {result.generatedImageDataUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-violet-700">
                      Rendu visuel généré par IA ({selectedStyle})
                    </span>
                    <button
                      type="button"
                      disabled={savedNotice}
                      onClick={() => {
                        if (!result.generatedImageDataUrl) return;
                        onSaveSimulatedPhoto(
                          result.generatedImageDataUrl,
                          `Simulation IA (${selectedStyle})`
                        );
                        setSavedNotice(true);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-70 flex items-center gap-1.5"
                    >
                      {savedNotice ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Enregistrée dans la galerie !
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          Enregistrer en photo « Après »
                        </>
                      )}
                    </button>
                  </div>
                  <img
                    src={result.generatedImageDataUrl}
                    alt="Simulation IA"
                    className="w-full max-h-80 object-contain rounded-2xl border border-violet-200 bg-slate-50"
                  />
                </div>
              ) : (
                result.imageGenerationNote && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
                    ℹ️ {result.imageGenerationNote}
                  </div>
                )
              )}

              {/* Analyse & Moodboard */}
              <div className="bg-violet-50/60 border border-violet-100 rounded-2xl p-4 space-y-3">
                <p className="text-xs sm:text-sm text-slate-800 leading-relaxed">{result.analysis}</p>

                <div className="flex flex-wrap items-center gap-3">
                  {result.palette.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Palette className="w-4 h-4 text-violet-600" />
                      <div className="flex items-center gap-1.5">
                        {result.palette.map((c, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200 text-[11px]"
                          >
                            <span
                              className="w-3 h-3 rounded-full border border-slate-300"
                              style={{ backgroundColor: c.hex }}
                            />
                            <span>{c.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {result.materials.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {result.materials.map((m, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 rounded-full bg-white border border-violet-200 text-[11px] font-medium text-violet-900"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Recherche inversée d'éléments similaires sur Internet */}
              {result.suggestedItems.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4 text-emerald-600" />
                    Éléments suggérés — Trouver un équivalent réel sur Internet
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {result.suggestedItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-200 rounded-2xl p-3.5 bg-white space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold text-slate-900">{item.label}</div>
                            <div className="text-[11px] text-slate-500">
                              {item.widthCm}×{item.depthCm}×{item.heightCm} cm · ~{item.estimatedPriceEur} €
                            </div>
                          </div>
                          {onAddSuggestedToPlan && (
                            <button
                              type="button"
                              onClick={() => onAddSuggestedToPlan(item)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 shrink-0"
                            >
                              + Plan
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600">{item.reason}</p>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {PARTNER_STORES.slice(0, 4).map((store) => (
                            <a
                              key={store.id}
                              href={store.searchUrl(item.searchQuery || item.label)}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 inline-flex items-center gap-1"
                            >
                              {store.name}
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
