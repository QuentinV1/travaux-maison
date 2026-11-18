import React, { useRef, useState } from 'react';
import {
  Sparkles,
  X,
  ImagePlus,
  Type,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Wand2,
  Replace,
  PlusCircle,
  Globe,
  Copy,
  Check,
  ExternalLink,
  Upload,
} from 'lucide-react';
import type { Floor } from '../types';
import { loadAppSettings } from '../utils/settings';
import {
  buildExternal2DArchitectPrompt,
  generateFloorPlanFromImage,
  generateFloorPlanFromText,
  parseExternalAIPlanJson,
  type GeneratedFloorPlanData,
} from '../utils/aiService';
import { compressImageToWebP, computeInterWallDimensions } from '../utils/geometry';
import { NumericInput } from './NumericInput';
import { useEscapeKey } from '../utils/useEscapeKey';

interface AIPlanGeneratorModalProps {
  isOpen: boolean;
  currentFloor?: Floor;
  onClose: () => void;
  onOpenSettings: () => void;
  onApplyPlan: (data: GeneratedFloorPlanData, mode: 'replace' | 'append') => void;
}

export const AIPlanGeneratorModal: React.FC<AIPlanGeneratorModalProps> = ({
  isOpen,
  currentFloor,
  onClose,
  onOpenSettings,
  onApplyPlan,
}) => {
  useEscapeKey(isOpen, onClose);
  const [tab, setTab] = useState<'image' | 'text' | 'external'>('image');
  const [imageDataUrl, setImageDataUrl] = useState<string>('');
  const [hintWidthM, setHintWidthM] = useState<string>('');
  const [extThicknessCm, setExtThicknessCm] = useState<number>(20);
  const [intThicknessCm, setIntThicknessCm] = useState<number>(10);
  const [description, setDescription] = useState<string>('');
  const [includeCurrentFloor, setIncludeCurrentFloor] = useState<boolean>(true);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [externalJson, setExternalJson] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedFloorPlanData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const settings = loadAppSettings();
  const hasKey = settings.geminiApiKey.trim().length > 10;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const compressed = await compressImageToWebP(file, 1400, 0.85);
      setImageDataUrl(compressed);
    } catch {
      const reader = new FileReader();
      reader.onload = () => setImageDataUrl(String(reader.result || ''));
      reader.readAsDataURL(file);
    }
  };

  const handleCopyPrompt = async () => {
    const prompt = buildExternal2DArchitectPrompt(currentFloor, includeCurrentFloor);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2500);
    } catch {
      setError('Impossible de copier automatiquement dans le presse-papiers.');
    }
  };

  const handleLoadExternalJson = () => {
    setError(null);
    setResult(null);
    if (!externalJson.trim()) {
      setError('Collez le JSON retourné par Gemini / ChatGPT / Claude avant d’importer.');
      return;
    }
    try {
      const data = parseExternalAIPlanJson(externalJson, { extThicknessCm, intThicknessCm });
      if (data.walls.length === 0) {
        setError('Aucun mur trouvé dans le JSON fourni.');
        return;
      }
      setResult(data);
    } catch (err) {
      setError(
        `JSON invalide : ${err instanceof Error ? err.message : 'Vérifiez que vous avez copié le bloc JSON complet.'}`
      );
    }
  };

  const handleGenerate = async () => {
    if (tab === 'external') {
      handleLoadExternalJson();
      return;
    }
    if (!hasKey) {
      setError('Veuillez d’abord renseigner votre clé API Gemini gratuite dans les réglages IA.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (tab === 'image') {
        if (!imageDataUrl) {
          setError('Importez d’abord une photo de croquis ou de plan 2D.');
          setLoading(false);
          return;
        }
        const widthNum = Number.parseFloat(hintWidthM.replace(',', '.'));
        const data = await generateFloorPlanFromImage(settings.geminiApiKey, imageDataUrl, {
          hintWidthM: Number.isFinite(widthNum) && widthNum > 0 ? widthNum : undefined,
          extThicknessCm,
          intThicknessCm,
        });
        setResult(data);
      } else {
        if (description.trim().length < 8) {
          setError('Décrivez plus précisément votre pièce ou étage (ex: surfaces, ouvertures, cotes en cm).');
          setLoading(false);
          return;
        }
        const data = await generateFloorPlanFromText(settings.geminiApiKey, description.trim(), {
          extThicknessCm,
          intThicknessCm,
        });
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la génération IA.');
    } finally {
      setLoading(false);
    }
  };

  const extWallCount = result
    ? result.walls.filter((w) => w.wallType === 'exterior' || (!w.wallType && w.thicknessCm > 14)).length
    : 0;
  const intWallCount = result ? result.walls.length - extWallCount : 0;
  const interWallDimCount = result ? computeInterWallDimensions(result.walls).length : 0;

  return (
    <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 z-50">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-violet-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Générer un Plan 2D / 3D par IA
              </h2>
              <p className="text-xs text-slate-500">
                Murs extérieurs puis cloisons intérieures alignées sans dépassement + cotes décimales
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
        <div className="p-5 overflow-y-auto space-y-4">
          {!hasKey && tab !== 'external' && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-between gap-3">
              <div className="text-xs text-amber-900">
                <strong>Clé API Gemini optionnelle :</strong> Ajoutez votre clé pour l’analyse en un clic, ou utilisez l’onglet gratuit <strong>IA Externe</strong>.
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

          {/* Tabs */}
          <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => setTab('image')}
              className={`py-2.5 px-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                tab === 'image' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ImagePlus className="w-4 h-4 text-violet-600 shrink-0" />
              Croquis 2D
            </button>
            <button
              type="button"
              onClick={() => setTab('text')}
              className={`py-2.5 px-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                tab === 'text' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Type className="w-4 h-4 text-blue-600 shrink-0" />
              Texte IA
            </button>
            <button
              type="button"
              onClick={() => setTab('external')}
              className={`py-2.5 px-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                tab === 'external' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-4 h-4 text-emerald-600 shrink-0" />
              IA Externe
            </button>
          </div>

          {tab === 'image' ? (
            <div className="space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-violet-400 rounded-2xl p-5 text-center cursor-pointer bg-slate-50/70 transition-colors"
              >
                {imageDataUrl ? (
                  <div className="space-y-2">
                    <img
                      src={imageDataUrl}
                      alt="Croquis importé"
                      className="max-h-56 mx-auto rounded-xl object-contain border border-slate-200 bg-white"
                    />
                    <p className="text-xs text-violet-600 font-medium">Cliquer pour changer d’image</p>
                  </div>
                ) : (
                  <div className="space-y-2 py-4">
                    <ImagePlus className="w-9 h-9 text-slate-400 mx-auto" />
                    <p className="text-sm font-semibold text-slate-700">
                      Importer une photo de plan 2D ou croquis papier
                    </p>
                    <p className="text-xs text-slate-500">
                      L’IA distingue les murs extérieurs et intérieurs, fusionne les cloisons mitoyennes et conserve les décimales
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-slate-700 whitespace-nowrap">
                  Largeur totale estimée (optionnel, en m) :
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="1"
                  value={hintWidthM}
                  onChange={(e) => setHintWidthM(e.target.value)}
                  placeholder="ex: 10,5"
                  className="w-28 px-3 py-1.5 border border-slate-300 rounded-xl text-sm font-semibold"
                />
              </div>
            </div>
          ) : tab === 'text' ? (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">
                Décrivez votre étage ou pièce (décimales en cm acceptées, ex: cloison de 12,5 cm) :
              </label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Un étage de 9,5m x 7m avec murs extérieurs de 20 cm et cloisons intérieures de 12,5 cm : cage d'escalier de 100 cm de large, entrée de 110 cm de large, deux chambres et une salle de bain."
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          ) : (
            <div className="space-y-3 bg-emerald-50/50 border border-emerald-200 rounded-2xl p-4">
              <div className="text-xs text-slate-700 space-y-1">
                <p className="font-bold text-emerald-900">
                  Pont IA Externe (gratuit, sans quota API — Google AI Studio, Gemini, ChatGPT, Claude)
                </p>
                <p className="text-slate-600">
                  1. Copiez notre prompt architecte ci-dessous et collez-le dans votre IA préférée avec votre croquis ou vos envies. 2. Collez le JSON généré ci-après.
                </p>
              </div>

              {currentFloor && (
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCurrentFloor}
                    onChange={(e) => setIncludeCurrentFloor(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  Inclure le plan actuel de l’étage (« {currentFloor.name} ») pour l’optimiser ou le modifier
                </label>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5 shadow-xs"
                >
                  {copiedPrompt ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedPrompt ? 'Prompt copié !' : 'Copier le Prompt Architecte 2D'}
                </button>
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                >
                  Google AI Studio <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://gemini.google.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                >
                  Gemini Web <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://chatgpt.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                >
                  ChatGPT <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Collez ici la réponse JSON de l’IA externe :
                </label>
                <textarea
                  rows={5}
                  value={externalJson}
                  onChange={(e) => setExternalJson(e.target.value)}
                  placeholder='{"summary": "...", "walls": [...], "openings": [...], "rooms": [...]}'
                  className="w-full px-3 py-2 border border-emerald-200 rounded-xl text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
          )}

          {/* Wall Thickness Configuration with Decimals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-3">
            <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
              <span className="font-medium">Épaisseur Murs Extérieurs :</span>
              <div className="flex items-center gap-1">
                <NumericInput
                  step={0.1}
                  min={1}
                  max={100}
                  value={extThicknessCm}
                  onCommit={setExtThicknessCm}
                  className="w-18 px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold text-center text-slate-900"
                />
                <span className="font-semibold text-slate-500">cm</span>
              </div>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
              <span className="font-medium">Épaisseur Murs Intérieurs :</span>
              <div className="flex items-center gap-1">
                <NumericInput
                  step={0.1}
                  min={1}
                  max={100}
                  value={intThicknessCm}
                  onCommit={setIntThicknessCm}
                  className="w-18 px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold text-center text-slate-900"
                />
                <span className="font-semibold text-slate-500">cm</span>
              </div>
            </label>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2 text-emerald-900">
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
                <div>
                  <p className="text-sm font-bold">Plan généré & jonctions alignées !</p>
                  <p className="text-xs text-emerald-800 mt-0.5">{result.summary}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                <div className="bg-white rounded-xl p-2 border border-emerald-100">
                  <div className="text-base font-bold text-slate-900">{extWallCount}</div>
                  <div className="text-[11px] text-slate-500">Murs Ext.</div>
                </div>
                <div className="bg-white rounded-xl p-2 border border-emerald-100">
                  <div className="text-base font-bold text-indigo-700">{intWallCount}</div>
                  <div className="text-[11px] text-slate-500">Murs Int.</div>
                </div>
                <div className="bg-white rounded-xl p-2 border border-emerald-100">
                  <div className="text-base font-bold text-indigo-600">{interWallDimCount}</div>
                  <div className="text-[11px] text-slate-500">Cotes inter-murs</div>
                </div>
                <div className="bg-white rounded-xl p-2 border border-emerald-100">
                  <div className="text-base font-bold text-slate-900">{result.rooms.length}</div>
                  <div className="text-[11px] text-slate-500">Pièces</div>
                </div>
                <div className="bg-white rounded-xl p-2 border border-emerald-100">
                  <div className="text-base font-bold text-slate-900">{result.openings.length}</div>
                  <div className="text-[11px] text-slate-500">Ouvertures</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onApplyPlan(result, 'replace');
                    onClose();
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center gap-1.5"
                >
                  <Replace className="w-4 h-4" />
                  Remplacer cet étage
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onApplyPlan(result, 'append');
                    onClose();
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 flex items-center justify-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  Ajouter au plan existant
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-200/70"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-2 shadow-sm ${
              tab === 'external' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyse IA en cours...
              </>
            ) : tab === 'external' ? (
              <>
                <Upload className="w-4 h-4" />
                Charger & Prévisualiser le JSON
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Générer le plan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
