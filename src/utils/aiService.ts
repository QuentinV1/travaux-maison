import { getAI, getGenerativeModel, GoogleAIBackend, type Part } from 'firebase/ai';
import { getFirebaseApp } from './firebaseSync';
import type {
  ArchShape,
  Floor,
  FloorMaterial,
  FurnitureItem,
  FurnitureMaterialType,
  FurnitureType,
  Opening,
  OpeningType,
  RoomZone,
  Wall,
  WallMaterial,
} from '../types';
import { uid } from '../db';
import { cleanAndAlignWalls, detectRoomsFromWalls, roundCm } from './geometry';

export interface AIPlanGenerationOptions {
  hintWidthM?: number;
  extThicknessCm?: number;
  intThicknessCm?: number;
}

export interface GeneratedFloorPlanData {
  walls: Wall[];
  openings: Opening[];
  rooms: RoomZone[];
  furniture: FurnitureItem[];
  summary: string;
}

export interface SuggestedDecoItem {
  label: string;
  furnitureType: FurnitureType;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  color: string;
  estimatedPriceEur: number;
  searchQuery: string;
  reason: string;
}

export interface HomeStagingResult {
  analysis: string;
  palette: { name: string; hex: string }[];
  materials: string[];
  suggestedItems: SuggestedDecoItem[];
  generatedImageDataUrl?: string;
  imageGenerationNote?: string;
}

export interface ExtractedWebProduct {
  label: string;
  type: FurnitureType;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  price?: number;
  store: string;
  productUrl?: string;
  color: string;
  imageUrl?: string;
  cutoutDataUrl?: string;
  variant?: string;
  materialType?: FurnitureMaterialType;
  renderMode3D?: FurnitureItem['renderMode3D'];
  glbDataUrl?: string;
}

export const PARTNER_STORES = [
  {
    id: 'darty',
    name: 'Darty',
    color: 'bg-red-600',
    searchUrl: (q: string) => `https://www.darty.com/nav/recherche?text=${encodeURIComponent(q)}`,
  },
  {
    id: 'poltronesofa',
    name: 'Poltronesofà',
    color: 'bg-rose-800',
    searchUrl: (q: string) => `https://www.poltronesofa.com/fr-FR/recherche?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'truffaut',
    name: 'Truffaut',
    color: 'bg-green-700',
    searchUrl: (q: string) => `https://www.truffaut.com/recherche?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'leroy-merlin',
    name: 'Leroy Merlin',
    color: 'bg-emerald-600',
    searchUrl: (q: string) => `https://www.leroymerlin.fr/recherche?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'maisons-du-monde',
    name: 'Maisons du Monde',
    color: 'bg-amber-700',
    searchUrl: (q: string) => `https://www.maisonsdumonde.com/FR/fr/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'castorama',
    name: 'Castorama',
    color: 'bg-blue-700',
    searchUrl: (q: string) => `https://www.castorama.fr/search?term=${encodeURIComponent(q)}`,
  },
  {
    id: 'brico-depot',
    name: 'Brico Dépôt',
    color: 'bg-rose-700',
    searchUrl: (q: string) => `https://www.bricodepot.fr/catalogue/recherche/?text=${encodeURIComponent(q)}`,
  },
  {
    id: 'ikea',
    name: 'IKEA',
    color: 'bg-sky-700',
    searchUrl: (q: string) => `https://www.ikea.com/fr/fr/search/?q=${encodeURIComponent(q)}`,
  },
];

function stripDataUrlPrefix(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: 'image/jpeg', base64: dataUrl };
}

async function callGeminiTextOrJson(
  apiKey: string,
  parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>,
  expectJson = true
): Promise<string> {
  const aiModels = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  let lastError = 'Erreur inconnue';

  try {
    const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
    const aiParts: (string | Part)[] = parts.map((p) => {
      if (p.inline_data) {
        return {
          type: 'inlineData',
          inlineData: { mimeType: p.inline_data.mime_type, data: p.inline_data.data },
        } as Part;
      }
      return p.text ?? '';
    });

    for (const modelName of aiModels) {
      try {
        const model = getGenerativeModel(ai, {
          model: modelName,
          ...(expectJson ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
        });
        const res = await model.generateContent(aiParts);
        const text = res.response.text();
        if (typeof text === 'string' && text.trim().length > 0) {
          return text;
        }
        lastError = 'Réponse vide de Firebase AI Logic';
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  if (apiKey.trim()) {
    for (const model of aiModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
        const body: Record<string, unknown> = {
          contents: [{ parts }],
        };
        if (expectJson) {
          body.generationConfig = { responseMimeType: 'application/json' };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          lastError = (errData as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
          continue;
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.trim().length > 0) {
          return text;
        }
        lastError = 'Réponse vide de Gemini';
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }
  throw new Error(lastError);
}

export async function testGeminiConnection(apiKey: string): Promise<boolean> {
  const res = await callGeminiTextOrJson(apiKey, [{ text: 'Réponds uniquement OK.' }], false);
  return res.toLowerCase().includes('ok') || res.length > 0;
}

const FLOOR_PLAN_SCHEMA_PROMPT = `Tu es un architecte expert en modélisation vectorielle 2D.
Génère un plan 2D structuré au format JSON strict. Toutes les coordonnées, longueurs, espacements entre murs et épaisseurs sont en CENTIMÈTRES (cm), avec une origine proche de (100, 100).
Les décimales en centimètres sont autorisées et doivent être respectées lorsqu'une cote précise est indiquée (ex: 12.5, 112.5, 342.5).

RÈGLES ARCHITECTURALES STRICTES (Murs Extérieurs -> Murs Intérieurs -> Cotes propres) :
1. ÉTAPE 1 (Murs Extérieurs) : Crée d'abord l'enveloppe périphérique fermée du bâtiment avec "wallType": "exterior" (épaisseur par défaut 20 cm, coins parfaitement joints aux mêmes coordonnées (x, y)).
2. ÉTAPE 2 (Murs Intérieurs / Cloisons sans restriction) : Ajoute ensuite les cloisons intérieures avec "wallType": "interior" (épaisseur par défaut 10 cm) pour séparer les pièces.
3. AUCUN MUR DOUBLON NI DÉPASSEMENT :
   - Deux pièces adjacentes (ex: Cage d'escalier et Entrée) partagent UN SEUL mur intérieur mitoyen. Ne génère jamais 2 murs superposés au même endroit !
   - Lorsqu'un mur intérieur rejoint un mur extérieur ou une autre cloison (jonction en T ou en L), son extrémité (x1,y1) ou (x2,y2) doit tomber EXACTEMENT sur la coordonnée du mur rejoint, sans jamais dépasser au-delà !
4. Les polygones "rooms" doivent suivre exactement les coordonnées des murs qui délimitent chaque pièce.

Le JSON doit impérativement avoir cette structure :
{
  "summary": "Description courte du plan généré (ex: Rez-de-chaussée 9,5m x 7m avec murs extérieurs 20cm et cloisons intérieures 10cm)",
  "walls": [
    { "tempId": "w1", "x1": 100, "y1": 100, "x2": 1050, "y2": 100, "thicknessCm": 20, "wallType": "exterior" },
    { "tempId": "w5", "x1": 450.5, "y1": 100, "x2": 450.5, "y2": 480, "thicknessCm": 10, "wallType": "interior" }
  ],
  "openings": [
    { "wallTempId": "w1", "type": "door" | "window" | "sliding-door" | "arch-passage" | "interior-glass" | "pass-through" | "pocket-door" | "double-door", "offsetRatio": 0.5, "widthCm": 90, "heightCm": 210, "archShape": "flat" | "half-circle" | "segmental" | "rounded-corners" }
  ],
  "rooms": [
    {
      "name": "Salon",
      "floorType": "wood" | "wood-herringbone" | "wood-dark" | "tile" | "tile-marble" | "terrazzo" | "cement-tile" | "carpet" | "concrete" | "grass" | "deck",
      "points": [{ "x": 100, "y": 100 }, { "x": 450.5, "y": 100 }, { "x": 450.5, "y": 480 }, { "x": 100, "y": 480 }]
    }
  ],
  "furniture": [
    { "type": "sofa" | "corner-sofa" | "armchair" | "coffee-table" | "tv-stand" | "dining-table" | "bed-double" | "bed-single" | "wardrobe" | "desk" | "kitchen-counter" | "kitchen-island" | "sink" | "stove" | "fridge" | "shower" | "bathtub" | "toilet" | "stairs" | "fireplace" | "plant", "label": "Canapé", "x": 280, "y": 300, "widthCm": 220, "depthCm": 95, "rotation": 0 }
  ]
}
Assure-toi que chaque opening référence un wallTempId valide avec offsetRatio entre 0.08 et 0.92.`;

const VALID_FLOOR_MATERIALS: FloorMaterial[] = [
  'tile',
  'tile-marble',
  'terrazzo',
  'cement-tile',
  'wood',
  'wood-herringbone',
  'wood-dark',
  'carpet',
  'concrete',
  'grass',
  'deck',
];

const VALID_OPENING_TYPES: OpeningType[] = [
  'door',
  'window',
  'sliding-door',
  'arch-passage',
  'interior-glass',
  'pass-through',
  'pocket-door',
  'double-door',
];

const VALID_ARCH_SHAPES: ArchShape[] = [
  'flat',
  'half-circle',
  'segmental',
  'rounded-corners',
  'asymmetric',
  'pointed',
];

function extractJsonObject(rawInput: string): string {
  const withoutFences = rawInput
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return withoutFences.slice(firstBrace, lastBrace + 1);
  }
  return withoutFences;
}

function normalizeGeneratedPlan(
  rawJsonText: string,
  options?: AIPlanGenerationOptions
): GeneratedFloorPlanData {
  const cleanText = extractJsonObject(rawJsonText);
  const parsed = JSON.parse(cleanText) as {
    summary?: string;
    walls?: Array<{
      tempId?: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      thicknessCm?: number;
      wallType?: string;
    }>;
    gridRooms?: Array<{
      name?: string;
      floorType?: string;
      xCm: number;
      yCm: number;
      widthCm: number;
      depthCm: number;
    }>;
    openings?: Array<{
      wallTempId?: string;
      type?: string;
      offsetRatio?: number;
      widthCm?: number;
      heightCm?: number;
      archShape?: string;
      archRiseCm?: number;
      sillHeightCm?: number;
      hasFrame?: boolean;
      frameColor?: string;
      glassMullions?: number;
    }>;
    rooms?: Array<{ name?: string; floorType?: string; points?: Array<{ x: number; y: number }> }>;
    furniture?: Array<{
      type?: string;
      label?: string;
      x: number;
      y: number;
      widthCm?: number;
      depthCm?: number;
      rotation?: number;
    }>;
  };

  const defaultExtThick = options?.extThicknessCm ?? 20;
  const defaultIntThick = options?.intThicknessCm ?? 10;

  // Support simplified gridRooms schema from external AI tools when walls array is omitted
  const sourceWalls = [...(parsed.walls ?? [])];
  const sourceRooms = [...(parsed.rooms ?? [])];

  if (sourceWalls.length === 0 && Array.isArray(parsed.gridRooms) && parsed.gridRooms.length > 0) {
    const minX = Math.min(...parsed.gridRooms.map((r) => Number(r.xCm) || 0));
    const maxX = Math.max(...parsed.gridRooms.map((r) => (Number(r.xCm) || 0) + (Number(r.widthCm) || 300)));
    const minY = Math.min(...parsed.gridRooms.map((r) => Number(r.yCm) || 0));
    const maxY = Math.max(...parsed.gridRooms.map((r) => (Number(r.yCm) || 0) + (Number(r.depthCm) || 300)));

    parsed.gridRooms.forEach((gr, idx) => {
      const x1 = roundCm(Number(gr.xCm) || 100, 2);
      const y1 = roundCm(Number(gr.yCm) || 100, 2);
      const x2 = roundCm(x1 + Math.max(80, Number(gr.widthCm) || 300), 2);
      const y2 = roundCm(y1 + Math.max(80, Number(gr.depthCm) || 300), 2);

      const edges = [
        { x1, y1, x2, y2: y1, isExt: Math.abs(y1 - minY) < 2 || Math.abs(y1 - maxY) < 2 },
        { x1: x2, y1, x2, y2, isExt: Math.abs(x2 - minX) < 2 || Math.abs(x2 - maxX) < 2 },
        { x1: x2, y1: y2, x2: x1, y2, isExt: Math.abs(y2 - minY) < 2 || Math.abs(y2 - maxY) < 2 },
        { x1, y1: y2, x2: x1, y2: y1, isExt: Math.abs(x1 - minX) < 2 || Math.abs(x1 - maxX) < 2 },
      ];
      edges.forEach((e, eIdx) => {
        sourceWalls.push({
          tempId: `gr${idx}_${eIdx}`,
          x1: e.x1,
          y1: e.y1,
          x2: e.x2,
          y2: e.y2,
          wallType: e.isExt ? 'exterior' : 'interior',
          thicknessCm: e.isExt ? defaultExtThick : defaultIntThick,
        });
      });

      sourceRooms.push({
        name: gr.name?.trim() || `Pièce ${idx + 1}`,
        floorType: gr.floorType,
        points: [
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ],
      });
    });
  }

  const wallIdMap = new Map<string, string>();
  const rawWalls: Wall[] = sourceWalls.map((w, idx) => {
    const id = uid('wall');
    const tempKey = w.tempId ?? `w${idx + 1}`;
    wallIdMap.set(tempKey, id);

    const explicitType =
      w.wallType === 'interior' || w.wallType === 'exterior' ? w.wallType : undefined;
    const rawThick = Number(w.thicknessCm);
    const inferredType: 'exterior' | 'interior' =
      explicitType ?? (Number.isFinite(rawThick) && rawThick <= 14 ? 'interior' : 'exterior');
    const fallbackThick = inferredType === 'interior' ? defaultIntThick : defaultExtThick;
    const thicknessCm = roundCm(
      Math.max(1, Math.min(100, Number.isFinite(rawThick) && rawThick > 0 ? rawThick : fallbackThick)),
      2
    );

    return {
      id,
      x1: roundCm(Number(w.x1) || 0, 2),
      y1: roundCm(Number(w.y1) || 0, 2),
      x2: roundCm(Number(w.x2) || 0, 2),
      y2: roundCm(Number(w.y2) || 0, 2),
      thicknessCm,
      wallType: inferredType,
    };
  });

  const rawOpenings: Opening[] = (parsed.openings ?? [])
    .map((op): Opening | null => {
      const wallId = (op.wallTempId && wallIdMap.get(op.wallTempId)) || rawWalls[0]?.id;
      if (!wallId) return null;
      const validType: OpeningType = VALID_OPENING_TYPES.includes(op.type as OpeningType)
        ? (op.type as OpeningType)
        : 'door';
      const validArch: ArchShape | undefined = VALID_ARCH_SHAPES.includes(op.archShape as ArchShape)
        ? (op.archShape as ArchShape)
        : validType === 'arch-passage'
          ? 'half-circle'
          : undefined;

      return {
        id: uid('open'),
        wallId,
        type: validType,
        offsetRatio: Math.max(0.08, Math.min(0.92, Number(op.offsetRatio) || 0.5)),
        widthCm: roundCm(Number(op.widthCm) || (validType === 'window' ? 120 : validType === 'arch-passage' ? 140 : 90), 2),
        heightCm: roundCm(Number(op.heightCm) || (validType === 'window' ? 120 : 210), 2),
        flip: false,
        archShape: validArch,
        archRiseCm: Number.isFinite(Number(op.archRiseCm)) ? Number(op.archRiseCm) : undefined,
        sillHeightCm: Number.isFinite(Number(op.sillHeightCm)) ? Number(op.sillHeightCm) : undefined,
        hasFrame: typeof op.hasFrame === 'boolean' ? op.hasFrame : validType !== 'arch-passage',
        frameColor: typeof op.frameColor === 'string' ? op.frameColor : undefined,
        glassMullions: Number.isFinite(Number(op.glassMullions)) ? Number(op.glassMullions) : undefined,
      };
    })
    .filter((o): o is Opening => o !== null);

  const rawRooms: RoomZone[] = sourceRooms
    .filter((r) => Array.isArray(r.points) && r.points.length >= 3)
    .map((r, idx) => ({
      id: uid('room'),
      name: r.name?.trim() || `Pièce ${idx + 1}`,
      floorType: VALID_FLOOR_MATERIALS.includes(r.floorType as FloorMaterial)
        ? (r.floorType as FloorMaterial)
        : 'wood',
      points: (r.points ?? []).map((p) => ({
        x: roundCm(Number(p.x) || 0, 2),
        y: roundCm(Number(p.y) || 0, 2),
      })),
    }));

  const furniture: FurnitureItem[] = (parsed.furniture ?? []).map((f) => ({
    id: uid('furn'),
    type: (f.type as FurnitureType) || 'sofa',
    label: f.label?.trim() || 'Meuble',
    x: roundCm(Number(f.x) || 200, 2),
    y: roundCm(Number(f.y) || 200, 2),
    widthCm: Math.max(15, roundCm(Number(f.widthCm) || 100, 2)),
    depthCm: Math.max(15, roundCm(Number(f.depthCm) || 60, 2)),
    rotation: Math.round(Number(f.rotation) || 0),
  }));

  // Run automatic alignment, collinear deduplication, and T-junction trimming so AI walls never overshoot!
  let cleanedFloor = cleanAndAlignWalls({
    id: 'temp_ai',
    houseId: 'temp',
    name: 'temp',
    order: 0,
    isExterior: false,
    defaultWallHeightCm: 250,
    walls: rawWalls,
    openings: rawOpenings,
    rooms: rawRooms,
    furniture,
  } satisfies Floor);

  if (cleanedFloor.rooms.length === 0 && cleanedFloor.walls.length >= 3) {
    cleanedFloor = detectRoomsFromWalls(cleanedFloor);
  }

  return {
    walls: cleanedFloor.walls,
    openings: cleanedFloor.openings,
    rooms: cleanedFloor.rooms,
    furniture: cleanedFloor.furniture,
    summary:
      parsed.summary ||
      `${cleanedFloor.rooms.length} pièce(s), ${cleanedFloor.walls.length} mur(s), ${cleanedFloor.openings.length} ouverture(s)`,
  };
}

export function buildExternal2DArchitectPrompt(
  currentFloor?: Floor,
  includeCurrentFloor = false
): string {
  const basePrompt = `${FLOOR_PLAN_SCHEMA_PROMPT}

BONUS — Tu peux aussi inclure des ouvertures spéciales ("arch-passage" avec "archShape": "half-circle", "interior-glass" pour verrière, "pocket-door", "pass-through") ou des sols ("wood-herringbone", "tile-marble", "terrazzo", "cement-tile").
Réponds UNIQUEMENT avec un bloc JSON valide (sans texte inutile autour) pour que l'application puisse l'importer en un clic.`;

  if (!includeCurrentFloor || !currentFloor) {
    return `${basePrompt}\n\nDécris ci-dessous la maison ou joins ton croquis dans cette discussion IA :`;
  }

  const compactFloor = {
    name: currentFloor.name,
    defaultWallHeightCm: currentFloor.defaultWallHeightCm,
    walls: currentFloor.walls.map((w) => ({
      tempId: w.id,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      thicknessCm: w.thicknessCm,
      wallType: w.wallType ?? 'exterior',
    })),
    openings: currentFloor.openings.map((o) => ({
      wallTempId: o.wallId,
      type: o.type,
      offsetRatio: roundCm(o.offsetRatio, 3),
      widthCm: o.widthCm,
      heightCm: o.heightCm,
      archShape: o.archShape,
    })),
    rooms: currentFloor.rooms.map((r) => ({
      name: r.name,
      floorType: r.floorType,
      points: r.points,
    })),
  };

  return `${basePrompt}

VOICI MON PLAN ACTUEL À OPTIMISER / COMPLÉTER (en cm) :
\`\`\`json
${JSON.stringify(compactFloor, null, 2)}
\`\`\`

Consignes à appliquer sur ce plan : `;
}

export function parseExternalAIPlanJson(
  rawInput: string,
  options?: AIPlanGenerationOptions
): GeneratedFloorPlanData {
  return normalizeGeneratedPlan(rawInput, options);
}

export async function generateFloorPlanFromImage(
  apiKey: string,
  imageDataUrl: string,
  optionsOrWidthM?: number | AIPlanGenerationOptions
): Promise<GeneratedFloorPlanData> {
  const opts: AIPlanGenerationOptions =
    typeof optionsOrWidthM === 'number'
      ? { hintWidthM: optionsOrWidthM }
      : optionsOrWidthM ?? {};

  const { mimeType, base64 } = stripDataUrlPrefix(imageDataUrl);
  const scaleHint = opts.hintWidthM
    ? `Indication d'échelle : la largeur totale du bâtiment/croquis est d'environ ${opts.hintWidthM} mètres (${roundCm(opts.hintWidthM * 100, 2)} cm).`
    : 'Estime des dimensions architecturales réalistes en cm (décimales autorisées comme 12.5 cm) si les cotes ne sont pas lisibles sur le plan.';
  const thickHint = `Utilise une épaisseur de ${opts.extThicknessCm ?? 20} cm pour les murs extérieurs ("wallType": "exterior") et ${opts.intThicknessCm ?? 10} cm pour les murs intérieurs / cloisons ("wallType": "interior"), sauf si une épaisseur spécifique est écrite sur le croquis.`;

  const prompt = `${FLOOR_PLAN_SCHEMA_PROMPT}

Analyse ce croquis ou plan 2D papier et extrais fidèlement :
1. D'abord les murs extérieurs ("wallType": "exterior"),
2. Puis les murs intérieurs / cloisons ("wallType": "interior") sans aucun mur en double entre deux pièces voisines et sans aucun dépassement aux jonctions,
3. Les portes/fenêtres/baies, les pièces (avec leurs noms visibles) et les principaux meubles s'il y en a.
Respecte scrupuleusement les cotes écrites sur le plan, y compris les décimales (ex: 12,5 cm -> 12.5).
${scaleHint}
${thickHint}`;

  const raw = await callGeminiTextOrJson(
    apiKey,
    [
      { text: prompt },
      { inline_data: { mime_type: mimeType, data: base64 } },
    ],
    true
  );
  return normalizeGeneratedPlan(raw, opts);
}

export async function generateFloorPlanFromText(
  apiKey: string,
  description: string,
  options?: AIPlanGenerationOptions
): Promise<GeneratedFloorPlanData> {
  const opts = options ?? {};
  const thickHint = `Utilise par défaut ${opts.extThicknessCm ?? 20} cm d'épaisseur pour les murs extérieurs ("wallType": "exterior") et ${opts.intThicknessCm ?? 10} cm pour les cloisons intérieures ("wallType": "interior"), sauf mention contraire dans la description (les décimales comme 12,5 cm sont supportées).`;

  const prompt = `${FLOOR_PLAN_SCHEMA_PROMPT}

Crée un plan 2D réaliste, fonctionnel et parfaitement aligné (murs extérieurs puis cloisons intérieures sans doublon ni dépassement) correspondant exactement à cette demande :
"${description}"
${thickHint}`;

  const raw = await callGeminiTextOrJson(apiKey, [{ text: prompt }], true);
  return normalizeGeneratedPlan(raw, opts);
}

async function tryGenerateImageWithGemini(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  style: string,
  customPrompt: string
): Promise<{ dataUrl?: string; note?: string }> {
  const imageModels = [
    'gemini-2.0-flash-preview-image-generation',
    'gemini-2.0-flash-exp-image-generation',
    'gemini-3.1-flash-image',
  ];
  const prompt = `Transforme cette vue/photo d'intérieur en un rendu architectural photoréaliste de style "${style}".
Conserve impérativement l'architecture existante (murs, ouvertures, perspective, volumes).
${customPrompt ? `Consignes supplémentaires : ${customPrompt}` : ''}
Rendu lumineux, réaliste, matériaux détaillés, ombres naturelles d'un magazine d'architecture.`;

  if (apiKey.trim()) {
    for (const model of imageModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: mimeType, data: imageBase64 } },
                ],
              },
            ],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts ?? [];
        for (const p of parts) {
          const inline = p.inlineData || p.inline_data;
          if (inline?.data) {
            const outMime = inline.mimeType || inline.mime_type || 'image/png';
            return { dataUrl: `data:${outMime};base64,${inline.data}` };
          }
        }
      } catch {
        // try next model
      }
    }
  }

  return {
    note: 'Rendu image direct non disponible sur ce palier API gratuit ; fiche déco & liste shopping générées avec succès.',
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Lecture blob impossible'));
    reader.readAsDataURL(blob);
  });
}

export async function generateRealisticRenderFrom3DView(
  apiKey: string,
  viewDataUrl: string,
  promptText: string,
  roomName?: string
): Promise<{ dataUrl?: string; note: string; method: 'gemini' | 'pollinations' | 'none' }> {
  const { mimeType, base64 } = stripDataUrlPrefix(viewDataUrl);
  const styleLabel = roomName ? `Intérieur ${roomName}` : 'Intérieur maison';

  if (apiKey.trim()) {
    const geminiRes = await tryGenerateImageWithGemini(
      apiKey,
      base64,
      mimeType,
      styleLabel,
      promptText || 'Rendu photographique réaliste, lumière du jour douce, matériaux naturels haute définition'
    );
    if (geminiRes.dataUrl) {
      return {
        dataUrl: geminiRes.dataUrl,
        note: 'Rendu photoréaliste généré via Gemini Image à partir de votre caméra 3D.',
        method: 'gemini',
      };
    }
  }

  // Fallback gratuit sans clé (Pollinations.ai Flux)
  try {
    const englishHint = `Photorealistic interior architecture photograph of ${roomName || 'modern house room'}, ${promptText || 'warm oak herringbone parquet, limewashed walls, natural daylight, editorial design magazine, 8k, no text'}`;
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishHint)}?width=1024&height=640&model=flux&nologo=true`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 28000);
    const res = await fetch(pollinationsUrl, { signal: controller.signal });
    window.clearTimeout(timer);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 2000) {
        const dataUrl = await blobToDataUrl(blob);
        return {
          dataUrl,
          note: 'Rendu d’inspiration généré gratuitement via Pollinations (Flux). Pour garder la géométrie exacte à 100%, utilisez le Pack Google Flow.',
          method: 'pollinations',
        };
      }
    }
  } catch {
    // fallback failed
  }

  return {
    note: 'Génération image directe indisponible ici. Exportez le Pack Google Flow dans l’onglet "Export 3D" puis réimportez le rendu.',
    method: 'none',
  };
}

function apply3DStyleHeuristic(floor: Floor, promptText: string): { updatedFloor: Floor; summary: string } {
  const q = promptText.toLowerCase();

  let wallColor = '#f8fafc';
  let accentWallColor = '#e2e8f0';
  let wallMat: WallMaterial = 'paint-velvet';
  let floorMat: FloorMaterial = 'wood';
  let ceilingColor = '#ffffff';
  let ceilingBeams = false;
  let sofaColor = '#d6cfc2';
  let sofaMat: FurnitureMaterialType = 'linen';
  let woodFurnMat: FurnitureMaterialType = 'wood-oak';

  if (q.includes('japandi') || q.includes('scandinave') || q.includes('nordique')) {
    wallColor = '#f5f2eb';
    accentWallColor = '#e6dfd3';
    wallMat = q.includes('tasseau') ? 'wood-slats' : 'paint-velvet';
    floorMat = 'wood-herringbone';
    sofaColor = '#ece6da';
    sofaMat = 'boucle';
    woodFurnMat = 'wood-oak';
  } else if (q.includes('industriel') || q.includes('loft') || q.includes('brique')) {
    wallColor = '#e5e7eb';
    accentWallColor = '#9a4636';
    wallMat = q.includes('béton') || q.includes('beton') ? 'plaster-concrete' : 'brick-red';
    floorMat = 'concrete';
    sofaColor = '#7c4a2d';
    sofaMat = 'leather';
    woodFurnMat = 'wood-black';
  } else if (q.includes('méditerran') || q.includes('mediterran') || q.includes('terracotta') || q.includes('chaux')) {
    wallColor = '#f6efe4';
    accentWallColor = '#c26d4f';
    wallMat = 'plaster-concrete';
    floorMat = 'terrazzo';
    ceilingBeams = true;
    sofaColor = '#dfd3c3';
    sofaMat = 'linen';
    woodFurnMat = 'wood-oak';
  } else if (q.includes('haussmann') || q.includes('chic') || q.includes('noyer') || q.includes('luxe')) {
    wallColor = '#f4f1ea';
    accentWallColor = '#1e3a5f';
    wallMat = 'paint-velvet';
    floorMat = 'wood-herringbone';
    sofaColor = '#2d4a3e';
    sofaMat = 'velvet';
    woodFurnMat = 'wood-walnut';
  }

  // Specific color/material overrides from prompt
  if (q.includes('sauge') || q.includes('vert')) accentWallColor = '#84a98c';
  if (q.includes('bleu nuit') || q.includes('bleu')) accentWallColor = '#1e3a5f';
  if (q.includes('beige') || q.includes('sable') || q.includes('lin')) wallColor = '#f3ece0';
  if (q.includes('tasseau')) wallMat = q.includes('noyer') ? 'wood-slats-walnut' : 'wood-slats';
  if (q.includes('zellige')) wallMat = 'tile-zellige';
  if (q.includes('poutre')) ceilingBeams = true;
  if (q.includes('bouclette') || q.includes('bouclé')) sofaMat = 'boucle';
  if (q.includes('velours')) sofaMat = 'velvet';
  if (q.includes('cuir')) sofaMat = 'leather';
  if (q.includes('chevron') || q.includes('hongrie')) floorMat = 'wood-herringbone';
  if (q.includes('marbre')) floorMat = 'tile-marble';
  if (q.includes('béton ciré') || q.includes('beton cire')) floorMat = 'concrete';

  const interiorWallIdx = floor.walls.findIndex((w) => w.wallType === 'interior');
  const nextWalls = floor.walls.map((w, idx) => ({
    ...w,
    colorFront: idx === interiorWallIdx ? accentWallColor : wallColor,
    colorBack: wallColor,
    materialFront: idx === interiorWallIdx ? wallMat : 'paint-velvet',
    materialBack: 'paint-matte' as WallMaterial,
  }));

  const nextRooms = floor.rooms.map((r) => {
    const isWet = /bain|sdb|wc|toilet|cuisine/i.test(r.name);
    const isExt = /terrasse|jardin|balcon|ext/i.test(r.name);
    return {
      ...r,
      floorType: isExt ? r.floorType : isWet && q.includes('zellige') ? 'tile-marble' : isWet ? 'tile' : floorMat,
      ceilingColor,
      ceilingBeams: !isExt && ceilingBeams,
    };
  });

  const nextFurniture = floor.furniture.map((f) => {
    if (f.type === 'sofa' || f.type === 'corner-sofa' || f.type === 'armchair') {
      return { ...f, color: sofaColor, materialType: sofaMat };
    }
    if (f.type === 'coffee-table' || f.type === 'dining-table' || f.type === 'tv-stand' || f.type === 'desk') {
      return { ...f, materialType: woodFurnMat };
    }
    return f;
  });

  return {
    updatedFloor: {
      ...floor,
      walls: nextWalls,
      rooms: nextRooms,
      furniture: nextFurniture,
    },
    summary: `Style appliqué localement (${wallMat}, sol ${floorMat}, textile ${sofaMat}${ceilingBeams ? ', poutres plafond' : ''}).`,
  };
}

export async function apply3DStyleFromPrompt(
  apiKey: string,
  floor: Floor,
  promptText: string
): Promise<{ updatedFloor: Floor; summary: string }> {
  if (!navigator.onLine) {
    return apply3DStyleHeuristic(floor, promptText);
  }

  const floorSnapshot = {
    walls: floor.walls.map((w) => ({ id: w.id, wallType: w.wallType })),
    rooms: floor.rooms.map((r) => ({ id: r.id, name: r.name, floorType: r.floorType })),
    furniture: floor.furniture.map((f) => ({ id: f.id, type: f.type, label: f.label })),
  };

  const prompt = `Tu es un architecte d'intérieur 3D. Applique ce style à l'étage existant sans changer la géométrie des murs :
Demande utilisateur : "${promptText}"

Éléments actuels :
${JSON.stringify(floorSnapshot)}

Valeurs autorisées :
- floorType: "tile" | "tile-marble" | "terrazzo" | "cement-tile" | "wood" | "wood-herringbone" | "wood-dark" | "carpet" | "concrete" | "grass" | "deck"
- wallMaterial: "paint-matte" | "paint-velvet" | "paint-satin" | "plaster-concrete" | "brick-red" | "brick-white" | "stone" | "wood-slats" | "wood-slats-walnut" | "tile-subway" | "tile-zellige" | "tile-marble" | "wallpaper" | "claustra"
- furnitureMaterial: "boucle" | "linen" | "velvet" | "corduroy" | "leather" | "wood-oak" | "wood-walnut" | "wood-black" | "marble-white" | "marble-black" | "metal-black" | "metal-brass" | "metal-chrome" | "glass"

Réponds en JSON strict :
{
  "summary": "Résumé court en français",
  "walls": [{ "id": "...", "colorFront": "#...", "colorBack": "#...", "materialFront": "...", "materialBack": "..." }],
  "rooms": [{ "id": "...", "floorType": "...", "ceilingColor": "#ffffff", "ceilingBeams": false }],
  "furniture": [{ "id": "...", "color": "#...", "materialType": "..." }]
}`;

  try {
    const raw = await callGeminiTextOrJson(apiKey, [{ text: prompt }], true);
    const parsed = JSON.parse(extractJsonObject(raw)) as {
      summary?: string;
      walls?: Array<{ id: string; colorFront?: string; colorBack?: string; materialFront?: WallMaterial; materialBack?: WallMaterial }>;
      rooms?: Array<{ id: string; floorType?: FloorMaterial; ceilingColor?: string; ceilingBeams?: boolean }>;
      furniture?: Array<{ id: string; color?: string; materialType?: FurnitureMaterialType }>;
    };

    const wallMap = new Map((parsed.walls ?? []).map((w) => [w.id, w]));
    const roomMap = new Map((parsed.rooms ?? []).map((r) => [r.id, r]));
    const furnMap = new Map((parsed.furniture ?? []).map((f) => [f.id, f]));

    return {
      updatedFloor: {
        ...floor,
        walls: floor.walls.map((w) => {
          const patch = wallMap.get(w.id);
          return patch
            ? {
                ...w,
                colorFront: patch.colorFront || w.colorFront,
                colorBack: patch.colorBack || w.colorBack,
                materialFront: patch.materialFront || w.materialFront,
                materialBack: patch.materialBack || w.materialBack,
              }
            : w;
        }),
        rooms: floor.rooms.map((r) => {
          const patch = roomMap.get(r.id);
          return patch
            ? {
                ...r,
                floorType:
                  patch.floorType && VALID_FLOOR_MATERIALS.includes(patch.floorType)
                    ? patch.floorType
                    : r.floorType,
                ceilingColor: patch.ceilingColor ?? r.ceilingColor,
                ceilingBeams: typeof patch.ceilingBeams === 'boolean' ? patch.ceilingBeams : r.ceilingBeams,
              }
            : r;
        }),
        furniture: floor.furniture.map((f) => {
          const patch = furnMap.get(f.id);
          return patch
            ? {
                ...f,
                color: patch.color || f.color,
                materialType: patch.materialType || f.materialType,
              }
            : f;
        }),
      },
      summary: parsed.summary || 'Ambiance 3D appliquée via Gemini.',
    };
  } catch {
    return apply3DStyleHeuristic(floor, promptText);
  }
}

export async function analyzeAndStageRoomPhoto(
  apiKey: string,
  imageDataUrl: string,
  style: string,
  customPrompt: string
): Promise<HomeStagingResult> {
  const { mimeType, base64 } = stripDataUrlPrefix(imageDataUrl);

  const analysisPrompt = `Tu es un architecte d'intérieur expert en rénovation.
Analyse cette photo de pièce et propose un projet complet de Home Staging / rénovation dans le style "${style}".
${customPrompt ? `Souhaits du propriétaire : ${customPrompt}` : ''}

Réponds en JSON strict avec ce schéma :
{
  "analysis": "Diagnostic de la pièce et description du projet d'aménagement recommandé (3-4 phrases en français)",
  "palette": [
    { "name": "Nom couleur", "hex": "#F8FAFC" }
  ],
  "materials": ["Parquet chêne clair", "Peinture blanc cassé mat"],
  "suggestedItems": [
    {
      "label": "Canapé 3 places lin beige",
      "furnitureType": "sofa",
      "widthCm": 220,
      "depthCm": 95,
      "heightCm": 82,
      "color": "#d6cfc2",
      "estimatedPriceEur": 690,
      "searchQuery": "canape 3 places lin beige scandinave",
      "reason": "Apporte de la chaleur et optimise l'espace face à la fenêtre"
    }
  ]
}
Propose entre 3 et 6 articles concrets (meubles, luminaires, revêtements) que l'on peut chercher chez Leroy Merlin, Maisons du Monde, Castorama ou Brico Dépôt.`;

  const [rawJson, imgResult] = await Promise.all([
    callGeminiTextOrJson(
      apiKey,
      [
        { text: analysisPrompt },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
      true
    ),
    tryGenerateImageWithGemini(apiKey, base64, mimeType, style, customPrompt),
  ]);

  const cleanText = rawJson.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleanText) as Partial<HomeStagingResult>;

  return {
    analysis: parsed.analysis || 'Proposition d’aménagement générée.',
    palette: Array.isArray(parsed.palette) ? parsed.palette : [],
    materials: Array.isArray(parsed.materials) ? parsed.materials : [],
    suggestedItems: Array.isArray(parsed.suggestedItems) ? parsed.suggestedItems : [],
    generatedImageDataUrl: imgResult.dataUrl,
    imageGenerationNote: imgResult.note,
  };
}

function heuristicExtractProduct(input: string, fetchedMeta?: { title?: string; description?: string; imageUrl?: string }): ExtractedWebProduct {
  const combined = `${input} ${fetchedMeta?.title ?? ''} ${fetchedMeta?.description ?? ''}`;
  const lower = combined.toLowerCase();
  let store = 'Enseigne Web';
  if (lower.includes('darty')) store = 'Darty';
  else if (lower.includes('poltronesofa')) store = 'Poltronesofà';
  else if (lower.includes('truffaut')) store = 'Truffaut';
  else if (lower.includes('leroymerlin')) store = 'Leroy Merlin';
  else if (lower.includes('maisonsdumonde')) store = 'Maisons du Monde';
  else if (lower.includes('castorama')) store = 'Castorama';
  else if (lower.includes('bricodepot')) store = 'Brico Dépôt';
  else if (lower.includes('ikea')) store = 'IKEA';

  const isUrl = /^https?:\/\//i.test(input.trim());

  // Extract dimensions if present like 220x90 or 220 x 90 x 80 cm
  const dimMatch = combined.match(/(\d{2,3})\s*[x×*]\s*(\d{2,3})(?:\s*[x×*]\s*(\d{2,3}))?\s*(?:cm)?/i);
  const priceMatch = combined.match(/(\d+(?:[.,]\d{1,2})?)\s*€/);

  let type: FurnitureType = 'sofa';
  let variant: string | undefined;
  let materialType: FurnitureMaterialType | undefined;
  let defaultW = 180;
  let defaultD = 90;
  let defaultH = 82;
  let color = '#cbd5e1';

  if (lower.includes('tv') || lower.includes('télé') || lower.includes('tele') || lower.includes('oled') || lower.includes('qled')) {
    type = 'tv-stand';
    variant = lower.includes('mural') || lower.includes('suspend') ? 'wall-mounted' : 'stand';
    materialType = 'wood-walnut';
    defaultW = 160;
    defaultD = 42;
    defaultH = 125;
    color = '#1e293b';
  } else if (lower.includes('angle') || lower.includes('meridienne') || lower.includes('méridienne')) {
    type = 'corner-sofa';
    variant = 'chaise-left';
    materialType = lower.includes('boucl') ? 'boucle' : 'velvet';
    defaultW = 260;
    defaultD = 165;
    defaultH = 82;
    color = '#dfd6c7';
  } else if (lower.includes('canap') || lower.includes('poltronesofa') || lower.includes('sofa')) {
    type = 'sofa';
    variant = lower.includes('arrondi') || lower.includes('poltronesofa') ? 'lounge-curved' : 'modern';
    materialType = lower.includes('boucl') ? 'boucle' : lower.includes('cuir') ? 'leather' : 'linen';
    defaultW = 220;
    defaultD = 95;
    defaultH = 82;
    color = '#d6cfc2';
  } else if (lower.includes('plante') || lower.includes('truffaut') || lower.includes('ficus') || lower.includes('monstera') || lower.includes('olivier') || lower.includes('palmier')) {
    type = 'plant';
    variant = lower.includes('olivier') || lower.includes('arbre') ? 'olive' : lower.includes('palmier') ? 'palm' : 'monstera';
    defaultW = 65;
    defaultD = 65;
    defaultH = 155;
    color = '#2f6f3e';
  } else if (lower.includes('table') && lower.includes('basse')) {
    type = 'coffee-table';
    variant = lower.includes('rond') ? 'round' : 'rect';
    materialType = lower.includes('marbre') ? 'marble-white' : 'wood-oak';
    defaultW = 110;
    defaultD = 70;
    defaultH = 40;
    color = '#c8a97e';
  } else if (lower.includes('table')) {
    type = 'dining-table';
    defaultW = 180;
    defaultD = 90;
    defaultH = 75;
    color = '#b58d63';
  } else if (lower.includes('lit')) {
    type = 'bed-double';
    defaultW = 160;
    defaultD = 200;
    defaultH = 95;
  } else if (lower.includes('bureau')) {
    type = 'desk';
    defaultW = 140;
    defaultD = 70;
    defaultH = 75;
  } else if (lower.includes('armoire') || lower.includes('dressing')) {
    type = 'wardrobe';
    defaultW = 150;
    defaultD = 60;
    defaultH = 220;
  } else if (lower.includes('douche')) {
    type = 'shower';
    defaultW = 120;
    defaultD = 90;
    defaultH = 210;
  } else if (lower.includes('baignoire')) {
    type = 'bathtub';
    defaultW = 170;
    defaultD = 75;
    defaultH = 58;
  } else if (lower.includes('cuisine') || lower.includes('meuble bas')) {
    type = 'kitchen-counter';
    defaultW = 180;
    defaultD = 62;
    defaultH = 90;
  } else if (lower.includes('ilot') || lower.includes('îlot')) {
    type = 'kitchen-island';
    defaultW = 180;
    defaultD = 95;
    defaultH = 90;
  } else if (lower.includes('fauteuil')) {
    type = 'armchair';
    variant = 'boucle-round';
    materialType = 'boucle';
    defaultW = 85;
    defaultD = 85;
    defaultH = 78;
  }

  let label = fetchedMeta?.title?.trim().slice(0, 56) || 'Article importé';
  if (!fetchedMeta?.title) {
    if (isUrl) {
      const parts = input.split('/').filter(Boolean);
      const slug = parts[parts.length - 1]?.split('?')[0]?.replace(/\.html?$/i, '') || '';
      const cleaned = slug.replace(/-\d+$/, '').replace(/[-_]+/g, ' ').trim();
      if (cleaned.length > 3) {
        label = cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 52);
      }
    } else if (input.trim().length > 2) {
      label = input.trim().slice(0, 52);
    }
  }

  return {
    label,
    type,
    widthCm: dimMatch ? Number(dimMatch[1]) : defaultW,
    depthCm: dimMatch ? Number(dimMatch[2]) : defaultD,
    heightCm: dimMatch?.[3] ? Number(dimMatch[3]) : defaultH,
    price: priceMatch ? Number(priceMatch[1].replace(',', '.')) : undefined,
    store,
    productUrl: isUrl ? input.trim() : undefined,
    color,
    imageUrl: fetchedMeta?.imageUrl,
    variant,
    materialType,
    renderMode3D: fetchedMeta?.imageUrl && type === 'tv-stand' ? 'photo-texture' : 'parametric',
  };
}

async function fetchUrlMetadata(url: string): Promise<{ title?: string; description?: string; imageUrl?: string }> {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url.trim())}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timeout);
    if (!res.ok) return {};
    const payload = await res.json();
    const d = payload?.data;
    if (!d) return {};
    return {
      title: typeof d.title === 'string' ? d.title : undefined,
      description: typeof d.description === 'string' ? d.description : undefined,
      imageUrl: typeof d.image?.url === 'string' ? d.image.url : undefined,
    };
  } catch {
    return {};
  }
}

export async function extractWebProduct(
  apiKey: string,
  urlOrText: string,
  pastedImageDataUrl?: string
): Promise<ExtractedWebProduct> {
  const isUrl = /^https?:\/\//i.test(urlOrText.trim());
  const fetchedMeta = isUrl ? await fetchUrlMetadata(urlOrText.trim()) : {};
  const fallback = heuristicExtractProduct(urlOrText, fetchedMeta);

  if (pastedImageDataUrl && !fallback.imageUrl) {
    fallback.imageUrl = pastedImageDataUrl;
  }

  if (!navigator.onLine) {
    return fallback;
  }

  const prompt = `Tu es un assistant d'extraction de fiche produit mobilier, électroménager et déco (Darty, Poltronesofà, Truffaut, Leroy Merlin, Maisons du Monde, IKEA, Castorama).
URL / texte : "${urlOrText}"
${fetchedMeta.title ? `Titre récupéré : "${fetchedMeta.title}"` : ''}
${fetchedMeta.description ? `Description : "${fetchedMeta.description}"` : ''}

Réponds en JSON strict :
{
  "label": "Nom court du produit",
  "type": "sofa" | "corner-sofa" | "armchair" | "coffee-table" | "tv-stand" | "dining-table" | "bed-double" | "bed-single" | "wardrobe" | "desk" | "kitchen-counter" | "kitchen-island" | "sink" | "stove" | "fridge" | "shower" | "bathtub" | "toilet" | "plant" | "outdoor-table" | "lounger",
  "widthCm": 180,
  "depthCm": 90,
  "heightCm": 80,
  "price": 399,
  "store": "Darty",
  "productUrl": "https://...",
  "color": "#cbd5e1",
  "materialType": "boucle" | "linen" | "velvet" | "corduroy" | "leather" | "wood-oak" | "wood-walnut" | "wood-black" | "marble-white" | "marble-black" | "metal-black" | "metal-brass" | "metal-chrome" | "glass",
  "variant": "nom court de variante"
}
Estime des dimensions et matériau réalistes en cm si non précisés.`;

  try {
    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [{ text: prompt }];
    if (pastedImageDataUrl) {
      const { mimeType, base64 } = stripDataUrlPrefix(pastedImageDataUrl);
      parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
    }
    const raw = await callGeminiTextOrJson(apiKey, parts, true);
    const parsed = JSON.parse(extractJsonObject(raw)) as Partial<ExtractedWebProduct>;
    return {
      label: parsed.label?.trim() || fallback.label,
      type: parsed.type || fallback.type,
      widthCm: Math.max(15, Math.round(Number(parsed.widthCm) || fallback.widthCm)),
      depthCm: Math.max(15, Math.round(Number(parsed.depthCm) || fallback.depthCm)),
      heightCm: Math.max(10, Math.round(Number(parsed.heightCm) || fallback.heightCm)),
      price: typeof parsed.price === 'number' && parsed.price > 0 ? parsed.price : fallback.price,
      store: parsed.store?.trim() || fallback.store,
      productUrl: parsed.productUrl?.startsWith('http') ? parsed.productUrl : fallback.productUrl,
      color: parsed.color?.startsWith('#') ? parsed.color : fallback.color,
      imageUrl: pastedImageDataUrl || fetchedMeta.imageUrl || fallback.imageUrl,
      materialType: parsed.materialType || fallback.materialType,
      variant: parsed.variant || fallback.variant,
      renderMode3D: fallback.renderMode3D,
    };
  } catch {
    return fallback;
  }
}
