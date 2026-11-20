import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import {
  Sparkles,
  X,
  Download,
  Copy,
  Check,
  ExternalLink,
  Upload,
  Loader2,
  Camera,
  Box,
  Wand2,
  Globe,
  Pin,
  Trash2,
} from 'lucide-react';
import type { Floor, FurnitureItem } from '../types';
import { uid } from '../db';
import {
  apply3DStyleFromPrompt,
  generateRealisticRenderFrom3DView,
} from '../utils/aiService';
import { loadAppSettings } from '../utils/settings';
import { FLOOR_MATERIAL_LABELS, WALL_MATERIAL_LABELS } from '../data/furnitureCatalog';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Studio3DExportAIModalProps {
  isOpen: boolean;
  floor: Floor;
  initialRoomName?: string;
  onClose: () => void;
  onUpdateFloor: (updated: Floor) => void;
  onOpenAISettings?: () => void;
  onCaptureCanvasView: () => string | null;
  onCaptureDepthView: () => string | null;
  onGetModelRoot: () => THREE.Object3D | null;
}

const STYLE_PRESET_PROMPTS = [
  {
    label: 'Japandi & Bouclette',
    prompt: 'Style Japandi chaleureux : parquet chêne point de hongrie, peinture lin mat, un mur tasseaux bois, canapé bouclette écru',
  },
  {
    label: 'Haussmannien Chic',
    prompt: 'Haussmannien moderne : parquet point de hongrie, mur accent bleu nuit velours, canapé velours forêt, meubles noyer',
  },
  {
    label: 'Méditerranéen Chaux',
    prompt: 'Méditerranéen lumineux : sol terrazzo, enduit chaux sable, mur accent terracotta, poutres bois au plafond, canapé lin beige',
  },
  {
    label: 'Loft Industriel',
    prompt: 'Loft industriel chic : sol béton ciré, briques rouges sur mur d’accent, canapé cuir cognac, touches métal noir',
  },
];

function downloadBlobOrUrl(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export const Studio3DExportAIModal: React.FC<Studio3DExportAIModalProps> = ({
  isOpen,
  floor,
  initialRoomName,
  onClose,
  onUpdateFloor,
  onOpenAISettings,
  onCaptureCanvasView,
  onCaptureDepthView,
  onGetModelRoot,
}) => {
  useEscapeKey(isOpen, onClose);
  const [tab, setTab] = useState<'ai' | 'export' | 'import'>('ai');
  const [stylePrompt, setStylePrompt] = useState(
    'Style Japandi lumineux : parquet point de hongrie, murs blanc chaud, tasseaux chêne, canapé bouclette beige'
  );
  const [renderPrompt, setRenderPrompt] = useState(
    'Photographie architecturale ultra réaliste, lumière naturelle matinale par les fenêtres, ombres douces, matériaux naturels texturés, objectif 24mm'
  );
  const [targetRoomId, setTargetRoomId] = useState<string>(floor.rooms[0]?.id ?? '');
  const [applyingStyle, setApplyingStyle] = useState(false);
  const [generatingRender, setGeneratingRender] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [generatedRender, setGeneratedRender] = useState<{
    dataUrl?: string;
    note: string;
    method: string;
  } | null>(null);

  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [depthPreview, setDepthPreview] = useState<string | null>(null);
  const [copiedFlowPrompt, setCopiedFlowPrompt] = useState(false);
  const [exportingGlb, setExportingGlb] = useState(false);

  const [importIs360, setImportIs360] = useState(false);
  const [glbTargetMode, setGlbTargetMode] = useState<'furniture' | 'scene'>('furniture');

  useEffect(() => {
    if (!isOpen) return;
    const snap = onCaptureCanvasView();
    if (snap) setCapturedPreview(snap);
    if (initialRoomName) {
      const match = floor.rooms.find((r) => r.name === initialRoomName);
      if (match) setTargetRoomId(match.id);
    } else if (floor.rooms[0] && !targetRoomId) {
      setTargetRoomId(floor.rooms[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialRoomName]);

  const flowPromptText = useMemo(() => {
    const roomDesc = floor.rooms
      .map((r) => `${r.name} (sol ${FLOOR_MATERIAL_LABELS[r.floorType]?.label || r.floorType}${r.ceilingBeams ? ', poutres bois' : ''})`)
      .join(', ');
    const furnDesc = floor.furniture
      .slice(0, 12)
      .map((f) => `${f.label}${f.store ? ` (${f.store})` : ''}`)
      .join(', ');
    const archCount = floor.openings.filter((o) => o.type === 'arch-passage').length;
    const glassCount = floor.openings.filter((o) => o.type === 'interior-glass').length;
    const matCount = floor.walls.filter((w) => w.materialFront && w.materialFront !== 'paint-matte').length;

    return [
      `Rendu architectural photoréaliste fidèle à cette maquette 3D (${floor.name}) :`,
      roomDesc ? `Pièces : ${roomDesc}.` : '',
      archCount > 0 ? `${archCount} passage(s) en arche.` : '',
      glassCount > 0 ? `${glassCount} verrière(s) d'atelier.` : '',
      matCount > 0 ? `Murs texturés (${WALL_MATERIAL_LABELS[floor.walls.find((w) => w.materialFront)?.materialFront ?? 'paint-velvet'].label}).` : '',
      furnDesc ? `Mobilier : ${furnDesc}.` : '',
      `Consignes style : ${renderPrompt}`,
      `Respecte strictement la géométrie, l'emplacement des murs, des ouvertures et des meubles visibles sur l'image de référence.`,
    ]
      .filter(Boolean)
      .join(' ');
  }, [floor, renderPrompt]);

  if (!isOpen) return null;

  const { geminiApiKey } = loadAppSettings();
  const hasGeminiKey = geminiApiKey.trim().length > 10;

  const handleApply3DStyle = async () => {
    if (!stylePrompt.trim()) return;
    setApplyingStyle(true);
    setStatusBanner(null);
    setErrorBanner(null);
    try {
      const { updatedFloor, summary } = await apply3DStyleFromPrompt(
        geminiApiKey,
        floor,
        stylePrompt.trim()
      );
      onUpdateFloor(updatedFloor);
      setStatusBanner(summary);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Impossible d’appliquer le style.');
    } finally {
      setApplyingStyle(false);
    }
  };

  const handleGeneratePhotorealRender = async () => {
    const viewUrl = onCaptureCanvasView();
    if (!viewUrl) {
      setErrorBanner('Impossible de capturer la caméra 3D actuelle.');
      return;
    }
    setCapturedPreview(viewUrl);
    setGeneratingRender(true);
    setStatusBanner(null);
    setErrorBanner(null);
    try {
      const room = floor.rooms.find((r) => r.id === targetRoomId);
      const res = await generateRealisticRenderFrom3DView(
        geminiApiKey,
        viewUrl,
        renderPrompt.trim(),
        room?.name
      );
      setGeneratedRender(res);
      if (res.dataUrl) {
        setStatusBanner(res.note);
      } else {
        setErrorBanner(res.note);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Erreur lors du rendu IA.');
    } finally {
      setGeneratingRender(false);
    }
  };

  const handlePinRenderToRoom = (dataUrl: string, is360 = false) => {
    const chosenRoom = floor.rooms.find((r) => r.id === targetRoomId) ?? floor.rooms[0];
    if (!chosenRoom) {
      setErrorBanner('Créez au moins une pièce pour y épingler un rendu.');
      return;
    }
    onUpdateFloor({
      ...floor,
      rooms: floor.rooms.map((r) =>
        r.id === chosenRoom.id
          ? { ...r, aiRenderUrl: dataUrl, aiRenderIs360: is360, aiRenderPrompt: renderPrompt }
          : r
      ),
    });
    setStatusBanner(
      `Rendu ${is360 ? '360° ' : ''}épinglé sur « ${chosenRoom.name} » ! Cliquez sur cette pièce en 3D pour l’ouvrir.`
    );
  };

  const handleExportGlb = () => {
    const root = onGetModelRoot();
    if (!root) {
      setErrorBanner('Scène 3D indisponible pour l’export.');
      return;
    }
    setExportingGlb(true);
    setErrorBanner(null);
    const exporter = new GLTFExporter();
    exporter.parse(
      root,
      (gltf) => {
        const blob =
          gltf instanceof ArrayBuffer
            ? new Blob([gltf], { type: 'model/gltf-binary' })
            : new Blob([JSON.stringify(gltf, null, 2)], { type: 'model/gltf+json' });
        const url = URL.createObjectURL(blob);
        downloadBlobOrUrl(url, `${floor.name.replace(/\s+/g, '-').toLowerCase()}.glb`);
        URL.revokeObjectURL(url);
        setExportingGlb(false);
        setStatusBanner('Modèle 3D exporté au format .GLB !');
      },
      (err) => {
        setExportingGlb(false);
        setErrorBanner(`Erreur export GLB : ${err?.message || 'maillage non exportable'}`);
      },
      { binary: true, onlyVisible: true }
    );
  };

  const handleExportObj = () => {
    const root = onGetModelRoot();
    if (!root) {
      setErrorBanner('Scène 3D indisponible pour l’export.');
      return;
    }
    const exporter = new OBJExporter();
    const objText = exporter.parse(root);
    const blob = new Blob([objText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadBlobOrUrl(url, `${floor.name.replace(/\s+/g, '-').toLowerCase()}.obj`);
    URL.revokeObjectURL(url);
    setStatusBanner('Maillage 3D exporté au format .OBJ !');
  };

  const handleDownloadGoogleFlowPack = () => {
    const viewUrl = onCaptureCanvasView();
    const depthUrl = onCaptureDepthView();
    if (viewUrl) {
      setCapturedPreview(viewUrl);
      downloadBlobOrUrl(viewUrl, `${floor.name.replace(/\s+/g, '-').toLowerCase()}-vue3d.png`);
    }
    if (depthUrl) {
      setDepthPreview(depthUrl);
      downloadBlobOrUrl(depthUrl, `${floor.name.replace(/\s+/g, '-').toLowerCase()}-profondeur.png`);
    }
    navigator.clipboard?.writeText(flowPromptText).catch(() => undefined);
    setCopiedFlowPrompt(true);
    setTimeout(() => setCopiedFlowPrompt(false), 3000);
    setStatusBanner('Pack Google Flow téléchargé (PNG 3D + carte de profondeur) et prompt copié !');
  };

  const handleUploadRenderedImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      handlePinRenderToRoom(dataUrl, importIs360);
    };
    reader.readAsDataURL(file);
  };

  const handleUploadGlbImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setErrorBanner('Fichier .GLB supérieur à 20 Mo : privilégiez un modèle optimisé.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      if (glbTargetMode === 'scene') {
        onUpdateFloor({ ...floor, importedGlbUrl: dataUrl });
        setStatusBanner(`Scène 3D externe « ${file.name} » importée sur l’étage !`);
      } else {
        const cx =
          floor.walls.length > 0
            ? floor.walls.reduce((acc, w) => acc + (w.x1 + w.x2) / 2, 0) / floor.walls.length
            : 300;
        const cy =
          floor.walls.length > 0
            ? floor.walls.reduce((acc, w) => acc + (w.y1 + w.y2) / 2, 0) / floor.walls.length
            : 300;
        const item: FurnitureItem = {
          id: uid('f'),
          type: 'sofa',
          label: file.name.replace(/\.(glb|gltf)$/i, ''),
          x: Math.round(cx),
          y: Math.round(cy),
          widthCm: 140,
          depthCm: 100,
          heightCm: 90,
          rotation: 0,
          color: '#cbd5e1',
          renderMode3D: 'glb',
          glbDataUrl: dataUrl,
        };
        onUpdateFloor({ ...floor, furniture: [...floor.furniture, item] });
        setStatusBanner(`Objet 3D « ${item.label} » ajouté au centre du plan !`);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 z-50">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50 via-violet-50 to-amber-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Studio IA Réaliste & Export / Import 3D
              </h2>
              <p className="text-xs text-slate-500">
                Style par prompt, Rendu photo gratuit, Export .GLB/.OBJ, Pack Google Flow & Ré-import 360°
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

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Navigation Tabs */}
          <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => setTab('ai')}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                tab === 'ai' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5 text-violet-600" />
              IA 3D & Rendu Réel
            </button>
            <button
              type="button"
              onClick={() => setTab('export')}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                tab === 'export' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-amber-600" />
              Export .GLB & Google Flow
            </button>
            <button
              type="button"
              onClick={() => setTab('import')}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                tab === 'import' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5 text-emerald-600" />
              Ré-import Photo / 360° / .GLB
            </button>
          </div>

          {statusBanner && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs text-emerald-900 font-medium">
              {statusBanner}
            </div>
          )}
          {errorBanner && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-800 font-medium">
              {errorBanner}
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-4">
              {!hasGeminiKey && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center justify-between gap-2 text-xs text-amber-900">
                  <span>
                    Mode gratuit sans clé actif (moteur déco local + Pollinations Flux). Ajoutez une clé Gemini pour fidélité maximale.
                  </span>
                  {onOpenAISettings && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAISettings();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-amber-600 text-white font-semibold shrink-0"
                    >
                      Clé Gemini
                    </button>
                  )}
                </div>
              )}

              {/* Block A: Apply 3D Style directly to walls/floors/furniture */}
              <div className="border border-slate-200 rounded-2xl p-4 space-y-3 bg-slate-50/70">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    1. Relooker la maquette 3D par prompt
                  </h3>
                  <span className="text-[11px] text-slate-500">Modifie matériaux, couleurs et textures</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_PRESET_PROMPTS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setStylePrompt(p.prompt)}
                      className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white border border-slate-200 hover:border-violet-400 text-slate-700"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  value={stylePrompt}
                  onChange={(e) => setStylePrompt(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white"
                  placeholder="Ex: Parquet point de hongrie, murs terracotta et lin, canapé bouclette, tasseaux bois..."
                />
                <button
                  type="button"
                  disabled={applyingStyle}
                  onClick={handleApply3DStyle}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-1.5"
                >
                  {applyingStyle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Appliquer au modèle 3D
                </button>
              </div>

              {/* Block B: Photorealistic Image Render from live camera */}
              <div className="border border-violet-200 rounded-2xl p-4 space-y-3 bg-violet-50/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-violet-900">
                    2. Générer un Rendu Photoréaliste depuis la vue 3D actuelle
                  </h3>
                  {floor.rooms.length > 0 && (
                    <select
                      value={targetRoomId}
                      onChange={(e) => setTargetRoomId(e.target.value)}
                      className="px-2.5 py-1 border border-violet-200 rounded-lg text-xs bg-white font-semibold"
                    >
                      {floor.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          Pièce cible : {r.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <textarea
                  rows={2}
                  value={renderPrompt}
                  onChange={(e) => setRenderPrompt(e.target.value)}
                  className="w-full px-3 py-2 border border-violet-200 rounded-xl text-xs bg-white"
                  placeholder="Consignes photo : lumière du matin, plantes luxuriantes, rendu magazine..."
                />

                <button
                  type="button"
                  disabled={generatingRender}
                  onClick={handleGeneratePhotorealRender}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 flex items-center gap-1.5"
                >
                  {generatingRender ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  Générer Rendu Photo IA (Vue actuelle)
                </button>

                {(capturedPreview || generatedRender?.dataUrl) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    {capturedPreview && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-slate-600">Caméra 3D source</div>
                        <img
                          src={capturedPreview}
                          alt="Vue 3D source"
                          className="w-full h-40 object-cover rounded-xl border border-slate-200 bg-slate-900"
                        />
                      </div>
                    )}
                    {generatedRender?.dataUrl && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold text-violet-900">Rendu IA généré</div>
                        <img
                          src={generatedRender.dataUrl}
                          alt="Rendu réaliste IA"
                          className="w-full h-40 object-cover rounded-xl border border-violet-300 bg-white"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePinRenderToRoom(generatedRender.dataUrl!, false)}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold flex items-center gap-1"
                          >
                            <Pin className="w-3 h-3" /> Épingler sur la pièce
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              downloadBlobOrUrl(
                                generatedRender.dataUrl!,
                                `${floor.name.toLowerCase().replace(/\s+/g, '-')}-rendu-ia.png`
                              )
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] font-semibold flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" /> PNG
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'export' && (
            <div className="space-y-4">
              {/* Direct 3D Mesh Exports */}
              <div className="border border-slate-200 rounded-2xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Box className="w-4 h-4 text-indigo-600" />
                  Export Maillage 3D Universel (Blender, Google Flow, Viewer 3D)
                </h3>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={exportingGlb}
                    onClick={handleExportGlb}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs"
                  >
                    {exportingGlb ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Télécharger maquette .GLB (recommandé)
                  </button>
                  <button
                    type="button"
                    onClick={handleExportObj}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-2 shadow-xs"
                  >
                    <Download className="w-4 h-4" />
                    Télécharger maquette .OBJ
                  </button>
                </div>
              </div>

              {/* Google Flow / ControlNet Pack */}
              <div className="border border-amber-200 bg-amber-50/50 rounded-2xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                  Pack Google Flow / IA Externe (Qualité Cinéma Sans Limite GPU)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Télécharge simultanément la <strong>capture PNG haute définition</strong> de votre caméra 3D + la{' '}
                  <strong>carte de profondeur</strong> (géométrie exacte) et copie automatiquement le prompt décrivant toutes vos pièces, matériaux et meubles.
                </p>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadGoogleFlowPack}
                    className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs"
                  >
                    <Download className="w-4 h-4" />
                    Télécharger Pack Google Flow (PNG + Depth + Prompt)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(flowPromptText).catch(() => undefined);
                      setCopiedFlowPrompt(true);
                      setTimeout(() => setCopiedFlowPrompt(false), 2500);
                    }}
                    className="px-3 py-2 rounded-xl bg-white border border-amber-300 text-amber-900 text-xs font-semibold flex items-center gap-1.5"
                  >
                    {copiedFlowPrompt ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedFlowPrompt ? 'Prompt copié !' : 'Copier le prompt seul'}
                  </button>
                </div>

                {(capturedPreview || depthPreview) && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {capturedPreview && (
                      <img src={capturedPreview} alt="Capture 3D" className="w-full h-28 object-cover rounded-xl border border-slate-200" />
                    )}
                    {depthPreview && (
                      <img src={depthPreview} alt="Carte profondeur" className="w-full h-28 object-cover rounded-xl border border-slate-200" />
                    )}
                  </div>
                )}

                <textarea
                  readOnly
                  rows={3}
                  value={flowPromptText}
                  className="w-full px-3 py-2 rounded-xl border border-amber-200 bg-white text-[11px] text-slate-700"
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href="https://labs.google/fx/tools/flow"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                  >
                    Ouvrir Google Flow <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href="https://aistudio.google.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                  >
                    Google AI Studio <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href="https://huggingface.co/spaces"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1"
                  >
                    HuggingFace Spaces (ControlNet) <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {tab === 'import' && (
            <div className="space-y-4">
              {/* Re-import image / 360 panorama */}
              <div className="border border-emerald-200 bg-emerald-50/40 rounded-2xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                  1. Ré-importer une image réaliste ou un panorama 360° (depuis Google Flow / Gemini / Blender)
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  {floor.rooms.length > 0 && (
                    <select
                      value={targetRoomId}
                      onChange={(e) => setTargetRoomId(e.target.value)}
                      className="px-3 py-2 border border-emerald-200 rounded-xl text-xs bg-white font-semibold"
                    >
                      {floor.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          Épingler sur : {r.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importIs360}
                      onChange={(e) => setImportIs360(e.target.checked)}
                      className="rounded border-emerald-300 text-emerald-600"
                    />
                    Image Panorama 360° (visite immersive sphérique)
                  </label>
                </div>

                <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shadow-xs">
                  <Upload className="w-4 h-4" />
                  Choisir une image rendue (.png / .jpg / .webp)
                  <input type="file" accept="image/*" className="hidden" onChange={handleUploadRenderedImage} />
                </label>
              </div>

              {/* Import GLB model back into scene */}
              <div className="border border-indigo-200 bg-indigo-50/40 rounded-2xl p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                  2. Importer un modèle 3D (.GLB / .GLTF)
                </h3>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="glbMode"
                      checked={glbTargetMode === 'furniture'}
                      onChange={() => setGlbTargetMode('furniture')}
                    />
                    Ajouter comme Meuble 3D déplaçable (ex: canapé / plante 3D)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="glbMode"
                      checked={glbTargetMode === 'scene'}
                      onChange={() => setGlbTargetMode('scene')}
                    />
                    Superposer comme maquette 3D de l’étage
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer shadow-xs">
                    <Box className="w-4 h-4" />
                    Importer fichier .GLB / .GLTF
                    <input type="file" accept=".glb,.gltf" className="hidden" onChange={handleUploadGlbImport} />
                  </label>

                  {floor.importedGlbUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateFloor({ ...floor, importedGlbUrl: undefined });
                        setStatusBanner('Maquette .GLB superposée retirée.');
                      }}
                      className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Retirer maquette .GLB
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
