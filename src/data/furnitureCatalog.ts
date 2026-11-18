import type {
  ArchShape,
  FloorMaterial,
  FurnitureMaterialType,
  FurnitureType,
  OpeningType,
  WallMaterial,
} from '../types';

export interface FurnitureCatalogEntry {
  type: FurnitureType;
  label: string;
  category: 'Salon' | 'Cuisine' | 'Chambre' | 'Salle de bain' | 'Extérieur' | 'Structure';
  widthCm: number;
  depthCm: number;
  color: string;
}

export const FURNITURE_CATALOG: FurnitureCatalogEntry[] = [
  // Salon
  { type: 'sofa', label: 'Canapé 3 places', category: 'Salon', widthCm: 210, depthCm: 95, color: '#cbd5e1' },
  { type: 'corner-sofa', label: 'Canapé d\'angle', category: 'Salon', widthCm: 260, depthCm: 170, color: '#cbd5e1' },
  { type: 'armchair', label: 'Fauteuil', category: 'Salon', widthCm: 85, depthCm: 85, color: '#cbd5e1' },
  { type: 'coffee-table', label: 'Table basse', category: 'Salon', widthCm: 110, depthCm: 65, color: '#e2e8f0' },
  { type: 'tv-stand', label: 'Meuble TV + TV', category: 'Salon', widthCm: 160, depthCm: 45, color: '#475569' },
  { type: 'dining-table', label: 'Table à manger', category: 'Salon', widthCm: 180, depthCm: 100, color: '#94a3b8' },
  { type: 'fireplace', label: 'Poêle / Cheminée', category: 'Salon', widthCm: 65, depthCm: 65, color: '#334155' },

  // Cuisine
  { type: 'kitchen-counter', label: 'Plan de travail', category: 'Cuisine', widthCm: 240, depthCm: 65, color: '#e2e8f0' },
  { type: 'kitchen-island', label: 'Îlot central', category: 'Cuisine', widthCm: 160, depthCm: 85, color: '#cbd5e1' },
  { type: 'sink', label: 'Évier', category: 'Cuisine', widthCm: 90, depthCm: 60, color: '#bae6fd' },
  { type: 'stove', label: 'Plaque cuisson', category: 'Cuisine', widthCm: 65, depthCm: 60, color: '#334155' },
  { type: 'fridge', label: 'Réfrigérateur', category: 'Cuisine', widthCm: 70, depthCm: 70, color: '#e2e8f0' },

  // Chambre
  { type: 'bed-double', label: 'Lit Double (160)', category: 'Chambre', widthCm: 160, depthCm: 200, color: '#bfdbfe' },
  { type: 'bed-single', label: 'Lit Simple (90)', category: 'Chambre', widthCm: 90, depthCm: 190, color: '#bfdbfe' },
  { type: 'wardrobe', label: 'Armoire / Dressing', category: 'Chambre', widthCm: 180, depthCm: 60, color: '#fde68a' },
  { type: 'desk', label: 'Bureau', category: 'Chambre', widthCm: 140, depthCm: 70, color: '#e2e8f0' },

  // Salle de bain
  { type: 'shower', label: 'Douche', category: 'Salle de bain', widthCm: 90, depthCm: 90, color: '#bae6fd' },
  { type: 'bathtub', label: 'Baignoire', category: 'Salle de bain', widthCm: 170, depthCm: 75, color: '#bae6fd' },
  { type: 'toilet', label: 'WC', category: 'Salle de bain', widthCm: 45, depthCm: 65, color: '#f1f5f9' },

  // Extérieur
  { type: 'outdoor-table', label: 'Table jardin', category: 'Extérieur', widthCm: 180, depthCm: 95, color: '#d6b48a' },
  { type: 'lounger', label: 'Transat', category: 'Extérieur', widthCm: 75, depthCm: 185, color: '#93c5fd' },
  { type: 'plant', label: 'Plante / Arbuste', category: 'Extérieur', widthCm: 65, depthCm: 65, color: '#86efac' },
  { type: 'tree', label: 'Arbre / Grand arbuste', category: 'Extérieur', widthCm: 180, depthCm: 180, color: '#4ade80' },
  { type: 'flower-bed', label: 'Jardinière / Massif', category: 'Extérieur', widthCm: 150, depthCm: 50, color: '#86efac' },
  { type: 'hedge', label: 'Haie', category: 'Extérieur', widthCm: 200, depthCm: 50, color: '#22c55e' },
  { type: 'low-wall', label: 'Muret', category: 'Extérieur', widthCm: 200, depthCm: 25, color: '#cbd5e1' },
  { type: 'gate', label: 'Portail battant', category: 'Extérieur', widthCm: 350, depthCm: 20, color: '#64748b' },
  { type: 'sliding-gate', label: 'Portail coulissant', category: 'Extérieur', widthCm: 350, depthCm: 20, color: '#475569' },
  { type: 'wicket-gate', label: 'Portillon', category: 'Extérieur', widthCm: 100, depthCm: 20, color: '#64748b' },

  // Structure
  { type: 'stairs', label: 'Escalier', category: 'Structure', widthCm: 280, depthCm: 100, color: '#fde68a' },
];

export const FLOOR_MATERIAL_LABELS: Record<FloorMaterial, { label: string; color: string }> = {
  tile: { label: 'Carrelage classique', color: '#f1f5f9' },
  'tile-marble': { label: 'Carrelage effet Marbre', color: '#f8fafc' },
  terrazzo: { label: 'Terrazzo', color: '#f3f4f6' },
  'cement-tile': { label: 'Carreaux de ciment', color: '#e2e8f0' },
  wood: { label: 'Parquet Chêne clair', color: '#fef3c7' },
  'wood-herringbone': { label: 'Parquet Point de Hongrie', color: '#fde68a' },
  'wood-dark': { label: 'Parquet Noyer / Fumé', color: '#d6b48a' },
  carpet: { label: 'Moquette / Jonc de mer', color: '#ede9fe' },
  concrete: { label: 'Béton ciré', color: '#e2e8f0' },
  deck: { label: 'Terrasse Bois / Dalles', color: '#fef9c3' },
  grass: { label: 'Pelouse / Jardin', color: '#dcfce7' },
};

export const WALL_MATERIAL_LABELS: Record<WallMaterial, { label: string; defaultColor: string }> = {
  'paint-matte': { label: 'Peinture Mate', defaultColor: '#f8fafc' },
  'paint-velvet': { label: 'Peinture Velours', defaultColor: '#f1f5f9' },
  'paint-satin': { label: 'Peinture Satinée', defaultColor: '#ffffff' },
  'plaster-concrete': { label: 'Enduit Chaux / Béton ciré', defaultColor: '#d6d3d1' },
  'brick-red': { label: 'Briques rouges apparentes', defaultColor: '#b4533c' },
  'brick-white': { label: 'Briques blanches peintes', defaultColor: '#f1f5f9' },
  stone: { label: 'Parement Pierre naturelle', defaultColor: '#cbd5e1' },
  'wood-slats': { label: 'Tasseaux bois Chêne clair', defaultColor: '#cfa574' },
  'wood-slats-walnut': { label: 'Tasseaux bois Noyer', defaultColor: '#7c5338' },
  'tile-subway': { label: 'Carrelage Métro', defaultColor: '#f8fafc' },
  'tile-zellige': { label: 'Faïence Zellige', defaultColor: '#e0f2fe' },
  'tile-marble': { label: 'Faïence Marbre', defaultColor: '#f8fafc' },
  wallpaper: { label: 'Papier peint / Photo', defaultColor: '#f5f5f4' },
  claustra: { label: 'Claustra ajouré (Tasseaux)', defaultColor: '#c89b68' },
};

export const WALL_COLOR_SWATCHES: Array<{ name: string; hex: string }> = [
  { name: 'Blanc pur', hex: '#ffffff' },
  { name: 'Blanc chaud', hex: '#f8f6f0' },
  { name: 'Lin / Écru', hex: '#ebe6dc' },
  { name: 'Gris perle', hex: '#e2e8f0' },
  { name: 'Greige', hex: '#d6cec2' },
  { name: 'Vert sauge', hex: '#a3b8a2' },
  { name: 'Vert forêt', hex: '#3b5249' },
  { name: 'Terracotta', hex: '#c76d53' },
  { name: 'Ocre doux', hex: '#d4a373' },
  { name: 'Bleu nuit', hex: '#28384c' },
  { name: 'Bleu grisé', hex: '#6c8596' },
  { name: 'Anthracite', hex: '#334155' },
];

export const FURNITURE_MATERIAL_LABELS: Record<FurnitureMaterialType, { label: string; defaultColor: string }> = {
  boucle: { label: 'Tissu Bouclette', defaultColor: '#f4efe6' },
  linen: { label: 'Lin lavé', defaultColor: '#dfd7c8' },
  velvet: { label: 'Velours lisse', defaultColor: '#4f6d5a' },
  corduroy: { label: 'Velours côtelé', defaultColor: '#9c7c5c' },
  leather: { label: 'Cuir', defaultColor: '#8d5524' },
  'wood-oak': { label: 'Bois Chêne clair', defaultColor: '#cfa574' },
  'wood-walnut': { label: 'Bois Noyer foncé', defaultColor: '#6f4e37' },
  'wood-black': { label: 'Bois Frêne noir', defaultColor: '#27272a' },
  'marble-white': { label: 'Marbre blanc', defaultColor: '#f1f5f9' },
  'marble-black': { label: 'Marbre noir', defaultColor: '#1e293b' },
  'metal-black': { label: 'Métal noir mat', defaultColor: '#1e293b' },
  'metal-brass': { label: 'Laiton brossé', defaultColor: '#d4af37' },
  'metal-chrome': { label: 'Chrome / Inox', defaultColor: '#cbd5e1' },
  glass: { label: 'Verre', defaultColor: '#bae6fd' },
};

export const FURNITURE_VARIANTS_BY_TYPE: Partial<
  Record<FurnitureType, Array<{ id: string; label: string }>>
> = {
  sofa: [
    { id: 'modern', label: 'Moderne Droit' },
    { id: 'lounge-curved', label: 'Lounge Arrondi (Poltronesofà)' },
    { id: 'scandinavian', label: 'Scandinave Capitonné' },
  ],
  'corner-sofa': [
    { id: 'chaise-left', label: 'Méridienne Gauche' },
    { id: 'chaise-right', label: 'Méridienne Droite' },
    { id: 'lounge-curved', label: 'Lounge Arrondi' },
  ],
  armchair: [
    { id: 'modern', label: 'Moderne Droit' },
    { id: 'lounge-curved', label: 'Crapaud / Bouclette arrondi' },
    { id: 'scandinavian', label: 'Scandinave pieds bois' },
  ],
  'dining-table': [
    { id: 'rect', label: 'Rectangulaire 4 pieds' },
    { id: 'round', label: 'Ronde pied central' },
    { id: 'oval', label: 'Ovale design' },
  ],
  'coffee-table': [
    { id: 'rect', label: 'Rectangulaire' },
    { id: 'round', label: 'Ronde tambour / marbre' },
    { id: 'oval', label: 'Organique / Ovale' },
  ],
  desk: [
    { id: 'rect', label: 'Rectangulaire' },
    { id: 'scandinavian', label: 'Scandinave pieds compas' },
  ],
  'tv-stand': [
    { id: 'stand', label: 'Sur meuble TV' },
    { id: 'wall-mounted', label: 'TV suspendue au mur (sans meuble)' },
    { id: 'easel', label: 'Sur pied chevalet design' },
  ],
  plant: [
    { id: 'monstera', label: 'Monstera / Tropicale' },
    { id: 'olive', label: 'Olivier / Ficus sur tige' },
    { id: 'palm', label: 'Palmier / Strelitzia' },
  ],
  tree: [
    { id: 'olive', label: 'Olivier / Arbre feuillu' },
    { id: 'palm', label: 'Palmier d’extérieur' },
  ],
};

export const OPENING_TYPE_LABELS: Record<OpeningType, string> = {
  'arch-passage': 'Passage ouvert / Arche (sans porte)',
  door: 'Porte battante',
  'double-door': 'Porte double battant',
  'pocket-door': 'Porte à galandage (coulissante)',
  'sliding-door': 'Baie vitrée coulissante',
  window: 'Fenêtre',
  'interior-glass': 'Verrière d’atelier',
  'pass-through': 'Passe-plat / Niche murale',
};

export const ARCH_SHAPE_LABELS: Record<ArchShape, string> = {
  flat: 'Droite (Rectangulaire)',
  'half-circle': 'Arche Plein Cintre (Demi-cercle)',
  segmental: 'Arche Cintrée / Surbaissée',
  'rounded-corners': 'Coins supérieurs arrondis',
  asymmetric: 'Demi-arche asymétrique',
  pointed: 'Arche Ogive',
};
