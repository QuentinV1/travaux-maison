import React, { useState } from 'react';
import {
  ShoppingBag,
  X,
  ExternalLink,
  Search,
  Sparkles,
  Plus,
  Loader2,
  CheckCircle2,
  Link as LinkIcon,
  Scissors,
  Image as ImageIcon,
  Box,
  Upload,
} from 'lucide-react';
import type { FurnitureMaterialType, FurnitureType } from '../types';
import {
  FURNITURE_CATALOG,
  FURNITURE_MATERIAL_LABELS,
  FURNITURE_VARIANTS_BY_TYPE,
} from '../data/furnitureCatalog';
import { extractWebProduct, PARTNER_STORES, type ExtractedWebProduct } from '../utils/aiService';
import { loadAppSettings } from '../utils/settings';
import { removeImageBackground } from '../utils/textures3d';
import { useEscapeKey } from '../utils/useEscapeKey';

interface WebCatalogModalProps {
  isOpen: boolean;
  initialQuery?: string;
  onClose: () => void;
  onAddFurnitureToPlan: (product: ExtractedWebProduct, alsoAddToShopping: boolean) => void;
}

const CURATED_WEB_PRESETS: ExtractedWebProduct[] = [
  {
    label: 'TV OLED 65" Ambilight / UHD',
    type: 'tv-stand',
    variant: 'wall-mounted',
    materialType: 'metal-black',
    widthCm: 145,
    depthCm: 14,
    heightCm: 84,
    price: 1490,
    store: 'Darty',
    color: '#1e293b',
    productUrl: 'https://www.darty.com/nav/recherche?text=tv+oled+65',
  },
  {
    label: 'Canapé Lounge Bouclette Arrondi',
    type: 'sofa',
    variant: 'lounge-curved',
    materialType: 'boucle',
    widthCm: 232,
    depthCm: 102,
    heightCm: 80,
    price: 1690,
    store: 'Poltronesofà',
    color: '#f4efe6',
    productUrl: 'https://www.poltronesofa.com/fr-FR/recherche?q=canape+bouclette',
  },
  {
    label: 'Grand Olivier / Monstera en pot céramique',
    type: 'plant',
    variant: 'olive',
    widthCm: 65,
    depthCm: 65,
    heightCm: 160,
    price: 129,
    store: 'Truffaut',
    color: '#3f6212',
    productUrl: 'https://www.truffaut.com/recherche?q=olivier+interieur',
  },
  {
    label: 'Canapé d’angle méridienne tissu',
    type: 'corner-sofa',
    variant: 'chaise-left',
    materialType: 'linen',
    widthCm: 252,
    depthCm: 158,
    heightCm: 85,
    price: 799,
    store: 'Maisons du Monde',
    color: '#d6cfc2',
    productUrl: 'https://www.maisonsdumonde.com/FR/fr/search?q=canape+angle',
  },
  {
    label: 'Meuble vasque chêne 120cm',
    type: 'sink',
    materialType: 'wood-oak',
    widthCm: 120,
    depthCm: 48,
    heightCm: 85,
    price: 449,
    store: 'Leroy Merlin',
    color: '#cfa574',
    productUrl: 'https://www.leroymerlin.fr/recherche?q=meuble+vasque+120',
  },
  {
    label: 'Paroi & Receveur douche 120x90',
    type: 'shower',
    widthCm: 120,
    depthCm: 90,
    heightCm: 200,
    price: 389,
    store: 'Castorama',
    color: '#bae6fd',
    productUrl: 'https://www.castorama.fr/search?term=receveur+douche+120x90',
  },
  {
    label: 'Bloc cuisine équipée 240cm',
    type: 'kitchen-counter',
    widthCm: 240,
    depthCm: 62,
    heightCm: 90,
    price: 599,
    store: 'Brico Dépôt',
    color: '#e2e8f0',
    productUrl: 'https://www.bricodepot.fr/catalogue/recherche/?text=meuble+cuisine',
  },
  {
    label: 'Table à manger chêne massif 200x100',
    type: 'dining-table',
    variant: 'rect',
    materialType: 'wood-oak',
    widthCm: 200,
    depthCm: 100,
    heightCm: 76,
    price: 549,
    store: 'Maisons du Monde',
    color: '#cfa574',
    productUrl: 'https://www.maisonsdumonde.com/FR/fr/search?q=table+a+manger',
  },
];

export const WebCatalogModal: React.FC<WebCatalogModalProps> = ({
  isOpen,
  initialQuery = '',
  onClose,
  onAddFurnitureToPlan,
}) => {
  useEscapeKey(isOpen, onClose);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [urlOrPaste, setUrlOrPaste] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [cuttingOut, setCuttingOut] = useState(false);
  const [cutoutNote, setCutoutNote] = useState<string | null>(null);
  const [alsoAddToShopping, setAlsoAddToShopping] = useState(true);
  const [addedBanner, setAddedBanner] = useState<string | null>(null);

  // Editable form for extracted/custom product
  const [draft, setDraft] = useState<ExtractedWebProduct>({
    label: '',
    type: 'sofa',
    widthCm: 180,
    depthCm: 90,
    heightCm: 80,
    price: undefined,
    store: 'Darty',
    productUrl: '',
    color: '#94a3b8',
    renderMode3D: 'parametric',
  });

  if (!isOpen) return null;

  const variantsForDraft = FURNITURE_VARIANTS_BY_TYPE[draft.type] ?? [];

  const handleExtract = async () => {
    if (!urlOrPaste.trim()) return;
    setExtracting(true);
    setCutoutNote(null);
    try {
      const { geminiApiKey } = loadAppSettings();
      const extracted = await extractWebProduct(
        geminiApiKey,
        urlOrPaste.trim(),
        draft.imageUrl
      );
      setDraft((prev) => ({
        ...extracted,
        imageUrl: extracted.imageUrl || prev.imageUrl,
        cutoutDataUrl: prev.cutoutDataUrl,
        glbDataUrl: prev.glbDataUrl,
      }));
    } finally {
      setExtracting(false);
    }
  };

  const applyImportedPhotoDataUrl = async (dataUrl: string, initialNote: string) => {
    setDraft((prev) => ({
      ...prev,
      imageUrl: dataUrl,
      cutoutDataUrl: undefined,
      renderMode3D: prev.type === 'tv-stand' ? 'photo-texture' : 'parametric',
    }));
    setCutoutNote(initialNote);
    setCuttingOut(true);
    try {
      const res = await removeImageBackground(dataUrl, 42);
      setDraft((prev) => ({
        ...prev,
        cutoutDataUrl: res.cutoutDataUrl,
        color: res.dominantHex || prev.color,
        renderMode3D: prev.type === 'tv-stand' ? 'photo-texture' : 'parametric',
      }));
      setCutoutNote('Photo analysée : teinte dominante et texture prêtes pour le modèle 3D !');
    } catch {
      // Garde la photo brute si l'analyse échoue
    } finally {
      setCuttingOut(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          void applyImportedPhotoDataUrl(
            String(reader.result),
            'Capture produit collée (Ctrl+V) ! Extraction de la teinte...'
          );
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      void applyImportedPhotoDataUrl(
        String(reader.result),
        'Photo importée ! Extraction de la teinte...'
      );
    };
    reader.readAsDataURL(file);
  };

  const handleGlbUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setCutoutNote('Fichier .glb trop volumineux (>15 Mo). Optimisez le maillage avant import.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setDraft((prev) => ({
        ...prev,
        glbDataUrl: dataUrl,
        renderMode3D: 'glb',
        label: prev.label || file.name.replace(/\.(glb|gltf)$/i, ''),
      }));
      setCutoutNote(`Modèle 3D « ${file.name} » prêt à être placé !`);
    };
    reader.readAsDataURL(file);
  };

  const handleAutoCutout = async () => {
    const src = draft.imageUrl;
    if (!src) return;
    setCuttingOut(true);
    setCutoutNote(null);
    try {
      const res = await removeImageBackground(src, 42);
      setDraft((prev) => ({
        ...prev,
        cutoutDataUrl: res.cutoutDataUrl,
        color: res.dominantHex || prev.color,
        renderMode3D: prev.type === 'tv-stand' ? 'photo-texture' : 'parametric',
      }));
      setCutoutNote('Fond détouré et couleur principale détectée sur le modèle 3D !');
    } catch {
      setCutoutNote('Détourage bloqué par CORS sur ce lien : faites Ctrl+V d’une capture d’écran du produit.');
    } finally {
      setCuttingOut(false);
    }
  };

  const handleConfirmAdd = (product: ExtractedWebProduct) => {
    if (!product.label.trim()) return;
    onAddFurnitureToPlan(product, alsoAddToShopping);
    setAddedBanner(`« ${product.label} » ajouté au plan 2D/3D${alsoAddToShopping ? ' et aux courses' : ''} !`);
    setTimeout(() => setAddedBanner(null), 3500);
  };

  return (
    <div
      onPaste={handlePaste}
      className="fixed inset-0 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 z-50"
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-teal-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Importer Produits Web & Objets 3D → Plan 2D/3D
              </h2>
              <p className="text-xs text-slate-500">
                Darty, Poltronesofà, Truffaut, Leroy Merlin, Maisons du Monde, IKEA · Lien URL, Ctrl+V image ou .GLB
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

        <div className="p-5 overflow-y-auto space-y-5">
          {addedBanner && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              {addedBanner}
            </div>
          )}

          {/* 1. Recherche directe sur les sites partenaires */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              1. Chercher sur Darty, Poltronesofà, Truffaut, Leroy Merlin...
            </h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                maxLength={120}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ex: TV OLED 65, canapé bouclette beige, monstera, meuble vasque..."
                className="flex-1 px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {PARTNER_STORES.map((store) => (
                <a
                  key={store.id}
                  href={store.searchUrl(searchQuery || 'maison')}
                  target="_blank"
                  rel="noreferrer"
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold text-white ${store.color} hover:opacity-90 flex items-center gap-1.5 shadow-xs`}
                >
                  {store.name}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ))}
            </div>
          </div>

          {/* 2. Import intelligent par URL / Ctrl+V / Photo / GLB */}
          <div className="bg-violet-50/60 border border-violet-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-violet-800 flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5" />
                2. Importer par lien URL, Ctrl+V image ou modèle 3D (.glb)
              </h3>
              <span className="text-[11px] text-violet-700 font-medium">
                Astuce : faites Win+Maj+S sur le site puis <strong>Ctrl+V</strong> ici !
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                maxLength={500}
                value={urlOrPaste}
                onChange={(e) => setUrlOrPaste(e.target.value)}
                placeholder="https://www.darty.com/... ou 'Canapé Poltronesofà 225x98cm 1490€'"
                className="flex-1 px-3.5 py-2.5 border border-violet-200 rounded-xl text-sm bg-white"
              />
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting || !urlOrPaste.trim()}
                className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
              >
                {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Extraire URL/IA
              </button>
            </div>

            {/* Formulaire d'édition / validation avant placement */}
            <div className="bg-white rounded-2xl p-3.5 border border-violet-100 space-y-3">
              {/* Visuel photo / détourage / 3D */}
              <div className="flex flex-wrap items-center gap-3 pb-2.5 border-b border-slate-100">
                {(draft.cutoutDataUrl || draft.imageUrl) && (
                  <div className="w-16 h-16 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0">
                    <img
                      src={draft.cutoutDataUrl || draft.imageUrl}
                      alt={draft.label || 'Aperçu'}
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" />
                    Photo produit
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                  </label>

                  {draft.imageUrl && (
                    <button
                      type="button"
                      disabled={cuttingOut}
                      onClick={handleAutoCutout}
                      className="px-3 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {cuttingOut ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
                      Extraire la teinte &amp; détourer la photo
                    </button>
                  )}

                  <label className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    Modèle .GLB
                    <input type="file" accept=".glb,.gltf" className="hidden" onChange={handleGlbUpload} />
                  </label>
                </div>

                {cutoutNote && (
                  <span className="text-[11px] text-emerald-700 font-medium">{cutoutNote}</span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-600">Nom de l’article</label>
                  <input
                    type="text"
                    maxLength={120}
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    placeholder="Ex: TV LG OLED 65C4 ou Canapé Poltronesofà"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Type 2D/3D</label>
                  <select
                    value={draft.type}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value as FurnitureType, variant: undefined })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs mt-0.5 bg-white"
                  >
                    {FURNITURE_CATALOG.map((item) => (
                      <option key={item.type} value={item.type}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Largeur (cm)</label>
                  <input
                    type="number"
                    min={10}
                    value={draft.widthCm}
                    onChange={(e) => setDraft({ ...draft, widthCm: Number(e.target.value) || 100 })}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Prof. (cm)</label>
                  <input
                    type="number"
                    min={5}
                    value={draft.depthCm}
                    onChange={(e) => setDraft({ ...draft, depthCm: Number(e.target.value) || 60 })}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Hauteur 3D (cm)</label>
                  <input
                    type="number"
                    min={10}
                    value={draft.heightCm}
                    onChange={(e) => setDraft({ ...draft, heightCm: Number(e.target.value) || 80 })}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Prix (€)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.price ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, price: e.target.value ? Number(e.target.value) : undefined })
                    }
                    placeholder="Ex: 399"
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Enseigne</label>
                  <input
                    type="text"
                    maxLength={60}
                    value={draft.store}
                    onChange={(e) => setDraft({ ...draft, store: e.target.value })}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs mt-0.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                {variantsForDraft.length > 0 && (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600">Forme 3D</label>
                    <select
                      value={draft.variant ?? variantsForDraft[0].id}
                      onChange={(e) => setDraft({ ...draft, variant: e.target.value })}
                      className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs mt-0.5 bg-white"
                    >
                      {variantsForDraft.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Matière 3D</label>
                  <select
                    value={draft.materialType ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        materialType: e.target.value ? (e.target.value as FurnitureMaterialType) : undefined,
                      })
                    }
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs mt-0.5 bg-white"
                  >
                    <option value="">Automatique</option>
                    {Object.entries(FURNITURE_MATERIAL_LABELS).map(([k, m]) => (
                      <option key={k} value={k}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                    <Box className="w-3 h-3" /> Rendu 3D
                  </label>
                  <select
                    value={
                      draft.renderMode3D === 'photo-billboard'
                        ? 'parametric'
                        : (draft.renderMode3D ?? 'parametric')
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        renderMode3D: e.target.value as ExtractedWebProduct['renderMode3D'],
                      })
                    }
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs mt-0.5 bg-white"
                  >
                    <option value="parametric">Modèle 3D sculpté Haute Définition (Recommandé)</option>
                    <option value="photo-texture">Modèle 3D + Texture photo plaquée (TV / Tissu)</option>
                    <option value="photo-volumetric">Volume 3D extrudé depuis la photo</option>
                    {draft.glbDataUrl && <option value="glb">Modèle 3D .GLB importé</option>}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Couleur</label>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input
                      type="color"
                      value={draft.color || '#94a3b8'}
                      onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                      className="w-10 h-8 rounded-lg border border-slate-300 cursor-pointer"
                    />
                    <span className="text-[11px] font-mono text-slate-500">{draft.color}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alsoAddToShopping}
                    onChange={(e) => setAlsoAddToShopping(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  Ajouter aussi automatiquement à la <strong>liste de courses</strong>
                </label>

                <button
                  type="button"
                  disabled={!draft.label.trim()}
                  onClick={() => handleConfirmAdd(draft)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Placer dans le plan 2D & 3D
                </button>
              </div>
            </div>
          </div>

          {/* 3. Articles types prêts à poser */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              3. Modèles d’enseignes prêts à placer (Darty, Poltronesofà, Truffaut...)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {CURATED_WEB_PRESETS.map((item, idx) => (
                <div
                  key={idx}
                  className="border border-slate-200 rounded-2xl p-3 flex items-center justify-between gap-2 hover:border-emerald-300 bg-white"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{item.label}</div>
                    <div className="text-[11px] text-slate-500">
                      {item.store} · {item.widthCm}×{item.depthCm}×{item.heightCm} cm ·{' '}
                      <span className="font-semibold text-emerald-700">{item.price} €</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.productUrl && (
                      <a
                        href={item.productUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        title="Voir sur le site"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleConfirmAdd(item)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    >
                      + Plan
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
