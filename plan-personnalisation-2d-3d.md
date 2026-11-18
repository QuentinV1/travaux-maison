# Plan d'Amélioration & Propositions de Solutions — Plan 2D, Studio 3D Réaliste & IA (V4)

Ce document détaille l'analyse technique et les meilleures solutions proposées pour répondre à vos 7 demandes d'évolution, afin d'obtenir une prise en main intuitive guidée par vos espacements et un rendu final 3D ultra-personnalisé et réaliste.

---

## 1. 📐 Plan 2D : Construction guidée par les Espacements (« Tout se décale »)

### 🔍 Pourquoi le fonctionnement actuel vous bloque
Aujourd'hui, dans `src/utils/geometry.ts` (`shiftWallInFloor` et `updateDistanceBetweenWalls`) :
1. **Déplacement isolé au lieu d'un décalage d'ensemble** : Quand vous modifiez l'espacement entre le Mur A et la Cloison 1 (ex: `+40 cm`), seule la Cloison 1 bouge. Résultat : cela **écrase** l'espacement de la pièce suivante (entre la Cloison 1 et la Cloison 2) au lieu de pousser toute la suite du bâtiment.
2. **Les murs extérieurs figent le plan au lieu de s'adapter** : Si vous posez d'abord un cadre extérieur approximatif, puis vos cloisons, la somme de vos espacements intérieurs réels ne correspond pas forcément à la longueur initiale du mur extérieur. Actuellement, le mur extérieur refuse de reculer ou d'avancer pour suivre vos cotes intérieures.

### 💡 Solutions Proposées

#### ✅ Proposition 1.A (Recommandée) : Moteur de « Décalage en Cascade (Push/Pull Global) »
Le workflow devient exactement celui que vous souhaitez en **3 étapes naturelles** :
1. **Étape 1** : Vous posez vos 4 murs extérieurs rapidement (même avec des dimensions approximatives).
2. **Étape 2** : Vous tracez vos cloisons intérieures simplement d'un mur à l'autre (accroche magnétique automatique en T sur les murs existants), sans vous soucier des cotes exactes au moment du tracé.
3. **Étape 3** : Vous cliquez sur chaque espacement (cote entre deux murs) et vous tapez la distance réelle :
   - **Effet « Tout se décale »** : Lorsque vous modifiez l'espacement entre un mur de référence $A$ et un mur $B$ de $+\Delta\text{ cm}$, **le mur $B$ ainsi que tous les murs, cloisons, ouvertures, pièces et meubles situés au-delà de $B$ se décalent ensemble de $+\Delta\text{ cm}$** !
   - **Adaptation automatique des murs extérieurs** : Les murs extérieurs perpendiculaires (ex: façades Haute et Basse) **s'allongent ou se raccourcissent automatiquement** pour englober la nouvelle somme de vos espacements intérieurs. Ce sont donc **vos espacements qui guident la taille finale de la maison**, et non les murs extérieurs.
   - **Choix du sens de décalage** : Lors du clic sur une cote, un petit sélecteur directionnel (`⬅️ Décaler la gauche` / `Décaler la droite ➡️` ou `⬆️` / `⬇️`, avec un sens par défaut Gauche $\rightarrow$ Droite et Haut $\rightarrow$ Bas) vous permet de choisir quel côté pousse l'autre.

#### ✅ Proposition 1.B (Complémentaire) : Verrouillage des Espacements (`🔒`) & Saisie en Chaîne (`Tab`)
- **Cadenas automatique sur les espacements saisis** : Dès que vous validez manuellement un espacement (ex: couloir à `110 cm`), cette cote passe en statut **Verrouillé (`🔒`)** (affichée en vert/indigo). Ainsi, quand vous modifiez ensuite la pièce d'à côté, l'algorithme ne réduira **jamais** votre couloir de `110 cm` : il poussera automatiquement les murs situés plus loin.
- **Navigation rapide au clavier (`Tab` / `Entrée`)** : Après avoir tapé un espacement, appuyer sur `Tab` sélectionne immédiatement l'espacement voisin sur le même axe pour coter toute votre maison en quelques secondes.

#### ✅ Proposition 1.C (Complémentaire) : Pièces auto-adaptatives & Outil « Diviser une pièce »
- **Synchronisation Murs $\leftrightarrow$ Pièces** : Les zones de pièces (`RoomZone`) restent magnétiquement collées aux faces intérieures des murs. Quand un espacement décale l'ensemble, les surfaces au sol ($\text{m}^2$) et les sols 3D s'étirent automatiquement sans jamais laisser de trou.
- **Bouton « ✨ Détecter les pièces automatiquement »** : Un clic détecte toutes les boucles fermées par vos murs extérieurs et vos cloisons pour créer les pièces sans avoir à les redessiner à la main.

---

## 2. 🏛️ Plan 2D & 3D : Ouvertures 100 % Personnalisables (Arches, Verrières, Niches...)

### 🔍 Pourquoi le fonctionnement actuel est limité
Aujourd'hui (`src/types.ts` et `src/utils/threeBuilder.ts`), seules 3 ouvertures fixes existent (`door`, `window`, `sliding-door`), toujours rectangulaires, avec une porte battante ou une vitre imposée.

### 💡 Solutions Proposées

#### ✅ Proposition 2.A (Recommandée) : Créateur d'Ouvertures Architecturales 100 % Sur-Mesure
Nous enrichissons le modèle `Opening` pour permettre une personnalisation totale en 2D comme en 3D :

1. **Nouveaux types de passages et ouvertures :**
   - **Passage ouvert / Arche sans porte (`arch-passage`)** : Idéal pour l'ouverture vers votre cuisine ! Aucun battant de porte, le mur est découpé proprement du sol jusqu'à la hauteur choisie.
   - **Verrière d'atelier (`interior-glass`)** : Ouverture vitrée posée sur une allège (muret bas, ex: à `90 cm` ou `110 cm` du sol) avec choix du nombre de travées/montants verticaux et de la couleur de l'armature (noir mat, blanc, bois, laiton).
   - **Passe-plat / Niche murale (`pass-through`)** : Ouverture en hauteur dans une cloison (avec tablette/rebord optionnel).
   - **Porte à galandage / coulissante (`pocket-door`)** et **Porte double battant (`double-door`)**.

2. **Forme supérieure 100 % paramétrable (`archShape`)** *(disponible sur les passages ouverts, portes et fenêtres)* :
   - **Droite (Rectangulaire)** : Linteau plat classique.
   - **Arche Plein Cintre (Demi-cercle parfait)** : La voûte forme un arc de cercle continu au sommet.
   - **Arche Cintrée / Surbaissée (Anse de panier)** : Vous réglez au centimètre près la **hauteur de courbure (`archRiseCm`)** (ex: arche douce de `25 cm` de flèche).
   - **Arche Asymétrique / Demi-arche moderne** ou **Coins supérieurs arrondis**.
   - **Arche Ogive**.

3. **Finitions, Cotes de positionnement & Rendu 3D réel :**
   - **Avec ou sans chambranle/cadre (`hasFrame`)** : Pour une arche de cuisine en placo peint, vous pouvez désactiver le cadre bois pour avoir une **arête murale lisse de la même couleur que le mur** !
   - **Positionnement exact en cm depuis les coins** : Dans l'inspecteur 2D, vous pouvez taper directement : *"À `45 cm` du mur gauche"* + *"Largeur `140 cm`"*.
   - **Vraie géométrie 3D courbée** : Dans `threeBuilder.ts`, le linteau au-dessus de l'ouverture est sculpté en 3D via `THREE.Shape` + `THREE.ExtrudeGeometry` pour dessiner la vraie voûte de l'arche, et vous pouvez passer dessous en mode Visite FPS !

#### ✅ Proposition 2.B (Bonus 2D/3D) : Demi-murs (Murets bar) & Claustras ajourés
- Possibilité de régler un segment de cloison en **Demi-mur / Bar** (ex: hauteur `110 cm` avec tablette bois sur le dessus) ou en **Claustra tasseaux de bois vertical** (laisse passer la lumière et la vue entre l'entrée et le salon).

---

## 3. 🎨 Plan 3D : Mode Personnalisation Directe (Murs, Sols, Plafonds au clic)

### 💡 Solutions Proposées

#### ✅ Proposition 3.A (Recommandée) : Mode « 🎨 Personnalisation 3D » avec Indépendance des 2 Faces d'un Mur
Dans la vue 3D (`FloorPlan3DViewer.tsx`), nous ajoutons un bouton bascule **« 🎨 Mode Personnalisation »** :

1. **Clic direct sur un Mur en 3D (avec distinction Face A / Face B) :**
   - **Pourquoi c'est essentiel** : Une cloison entre votre Salon et votre Cuisine ou Salle de bain n'a pas la même couleur des deux côtés !
   - **Comment ça marche** : Le rayon 3D (`Raycaster`) détecte de quel côté du mur vous avez cliqué (`side: 'front' | 'back'`). Vous pouvez ainsi peindre ou tapisser **uniquement la face cliquée**, ou cliquer sur *"Appliquer aux 2 faces"* / *"Appliquer à tous les murs de cette pièce"*.
   - **Palette & Revêtements muraux disponibles** :
     - **Nuancier de Peintures** (Blancs chauds, Lin, Beige, Greige, Vert sauge, Terracotta, Bleu nuit, Gris anthracite + Color Picker libre HEX) et finition (*Mat*, *Velours*, *Satiné*).
     - **Revêtements texturés 3D** :
       - *Enduit chaux / Béton ciré*
       - *Briques apparentes* (Rouges, Blanches, Industrielles)
       - *Pierre naturelle / Parement*
       - *Tasseaux de bois acoustiques* (Chêne clair, Noyer, Noir)
       - *Carrelage mural / Faïence* (Zellige, Métro, Grand format marbre)
       - *Papier peint ou Photo personnalisée* (vous pouvez importer une image de papier peint ou de carrelage trouvée sur le web pour l'appliquer directement sur le mur !).

2. **Clic direct sur un Sol en 3D :**
   - Modification en direct du matériau : *Parquet chêne clair / moyen / fumé*, *Parquet Point de Hongrie*, *Carrelage 60×60 / 80×80*, *Terrazzo*, *Carreaux de ciment*, *Béton ciré*, *Moquette / Jonc de mer*, *Terrasse bois*.
   - Réglage de la teinte, de l'échelle des carreaux/lames, de l'orientation (`0°`, `45°`, `90°`) et de la brillance.

3. **Clic direct sur un Plafond en 3D :**
   - Choix de la couleur du plafond par pièce + option **Poutres en bois apparentes** en 3D.

---

## 4. 🛋️ Plan 3D : Personnalisation des Meubles au Clic (Modèles, Couleurs, Tissus)

### 💡 Solutions Proposées

#### ✅ Proposition 4.A (Recommandée) : Panneau « Style & Matières » au clic sur n'importe quel meuble en 3D
Lorsque vous cliquez sur un meuble (ex: un canapé, un lit, une table, une cuisine) directement dans la vue 3D :

1. **Sélecteur de Design / Variante 3D (`variant`) :**
   - **Pour un Canapé** :
     - *Moderne Droit* (accoudoirs fins, pieds hauts)
     - *Lounge / Arrondi Bouclette* (assise basse galbée, coussins généreux type Poltronesofà / contemporain)
     - *Scandinave Capitonné* (pieds bois fuselés)
     - *Méridienne / Angle (Gauche ou Droit)*
   - **Pour une Table** : Plateau *Rectangulaire*, *Rond*, *Ovale*, *Organique* ; Pieds *4 coins*, *Pied central tulipe*, *Pieds croisés Mikado*.
   - **Pour une TV** : *Sur meuble TV*, *Suspendue au mur (Écran cadre ultra-fin)*, *Sur pied chevalet design*.
   - **Pour les Plantes** : *Monstera / Plante tropicale*, *Olivier / Ficus sur tige*, *Palmier / Strelitzia*, *Plante tombante*, en pot terre cuite, céramique blanche ou panier osier.

2. **Sélecteur de Matière / Tissu (`fabric` / `material`) :**
   - *Tissu Bouclette*, *Lin lavé*, *Velours côtelé*, *Velours lisse*, *Cuir (Cognac, Noir, Crème)*, *Bois (Chêne, Noyer, Frêne noir)*, *Marbre blanc/noir*, *Métal (Noir mat, Laiton, Chrome)*.
   - Chaque matière ajuste automatiquement la texture 3D, le grain (normal/bump map) et la rugosité (`roughness` / `metalness`).

3. **Couleurs Multi-Zones & Positionnement 3D direct :**
   - **Couleur principale** (ex: tissu du canapé) + **Couleur secondaire** (ex: pieds / structure / coussins).
   - **Manipulation directe en 3D** : Rotation à $360^\circ$, modification des dimensions (L × P × H) et **Hauteur par rapport au sol (`elevationCm`)** (indispensable pour fixer la TV au mur ou poser une plante/lampe sur une table).

---

## 5. ✨ Mode « Rendu Réel » 3D & Import d'Éléments de Sites Web (Darty, Poltronesofà, Truffaut...)

### 🔍 Le défi technique
Quand vous repérez une **TV sur Darty**, un **canapé sur Poltronesofà** ou une **plante sur Truffaut**, vous voulez :
1. Que l'application récupère les informations et **le visuel réel** du produit à partir du lien (ou d'un copier-coller).
2. Que l'objet dans votre salon 3D **ressemble vraiment au produit choisi** (et non à un cube gris générique), au sein d'un intérieur à l'éclairage réaliste.

### 💡 Solutions Proposées

#### ✅ Proposition 5.A : Le Mode « ✨ Rendu Réel (PBR & Éclairage Intérieur) » dans Three.js
Un bouton **« ✨ Rendu Réel »** dans la barre 3D active :
1. **Textures PBR procédurales Haute Définition** : Veinage du bois, joints de carrelage, trame de tissu bouclette/velours, relief de brique et reflets vitrés.
2. **Éclairage Global & Plafonniers Chauds par Pièce** : Ajout automatique de sources lumineuses intérieures douces (`2700K`), `ACESFilmicToneMapping`, reflets réalistes (`EnvironmentMap`) sur l'écran TV, les miroirs et les vitres, et **ombres de contact douces** sous chaque meuble.

#### ✅ Proposition 5.B : Système d'Import Web Visuel en 3 Modes (Darty, Poltronesofà, Truffaut, Leroy Merlin, IKEA...)
Pour que n'importe quel site web fonctionne à 100 % (même les sites protégés contre les robots comme Darty ou Poltronesofà) :

1. **Extraction intelligente Lien URL + Support du Copier-Coller d'Image (`Ctrl+V`) :**
   - Vous collez le lien du produit (Darty, Poltronesofà, Truffaut...) : l'application interroge les métadonnées OpenGraph/JSON-LD (via passerelle gratuite `microlink` / `jina` + Gemini) pour récupérer **le titre, les dimensions, le prix et la photo du produit**.
   - **Astuce anti-blocage 100 % fiable** : Vous pouvez aussi faire *Clic droit $\rightarrow$ Copier l'image* sur le site de Darty / Poltronesofà / Truffaut et faire **`Ctrl+V`** dans la modale : Gemini Vision lit l'image, extrait la couleur exacte, le style et l'intègre immédiatement !

2. **Rendu 3D fidèle du produit importé selon sa nature (3 technologies combinées) :**
   - **Mode 1 — Texture Photo HD sur Modèle 3D (Idéal pour TV Darty, Tableaux, Tapis, Carrelages, Papiers peints)** :
     - Votre TV Darty est modélisée avec son cadre ultra-fin aux vraies dimensions (ex: 55" = 123×71 cm, 65" = 144×83 cm) et affiche le vrai visuel de l'écran avec reflet verre !
   - **Mode 2 — Détourage Automatique du Fond Blanc + Rendu Photo-3D / Silhouette (Idéal pour les Plantes de Truffaut, Luminaires, Fauteuils)** :
     - Un outil intégré supprime automatiquement le fond blanc de la photo du produit (détourage transparent instantané sur Canvas).
     - Votre **plante de chez Truffaut** (ex: Olivier, Monstera, Bambou) apparaît dans votre salon 3D avec **son vrai feuillage photographique détouré en haute définition** (en mode Billboard 3D orienté ou plans croisés 3D), ou via sa variante végétale 3D !
   - **Mode 3 — Échantillonnage de Texture sur Variante 3D OU Import de Modèle `.glb` (Idéal pour un Canapé Poltronesofà)** :
     - Option rapide : Le canapé 3D adopte automatiquement la forme la plus proche (ex: Lounge arrondi) et **applique la couleur et la texture de tissu extraites de la photo Poltronesofà**.
     - Option 3D exacte (`.glb`) : Vous pouvez glisser-déposer un fichier **`.glb` / `.gltf`** généré gratuitement à partir de la photo du canapé Poltronesofà (via un convertisseur IA gratuit *Image-vers-3D* en 1 clic comme **TripoSR / Trellis / Hunyuan3D sur HuggingFace Spaces**). Le vrai modèle 3D exact du canapé est alors sauvegardé dans la base locale Dexie de votre maison !

---

## 6. 🤖 Génération d'un Intérieur 3D Réaliste à partir d'un Prompt IA (En direct OU Export 3D $\rightarrow$ Google Flow / Outil Externe $\rightarrow$ Réimport)

### 🔍 Analyse : Générer dans l'application vs Exporter / Réimporter
- **En direct dans l'application** : Idéal pour modifier instantanément tous les matériaux/couleurs/meubles 3D par prompt, ou pour transformer la vue 3D actuelle en image photoréaliste via une API gratuite (Gemini / Pollinations Flux / ComfyUI local).
- **En externe (Google Flow, AI Studio, Blender, PromeAI, Krea, World Labs)** : Les outils externes dédiés au rendu vidéo/3D neuronal (comme **Google Flow / Veo / Whisk**, **PromeAI**, **Krea.ai**, **Meshy/Trellis**) disposent de fermes de GPU gratuites capables de générer des rendus photoréalistes époustouflants, des vidéos de visite virtuelle ou des maillages 3D complets à partir d'une base 3D exportée.

### 💡 Solutions Proposées (Approche Hybride : Directe + Passerelle Export/Import 3D)

#### ✅ Proposition 6.A : En direct dans l'application (100 % Gratuit)
1. **Architecte Déco 3D par Prompt** : Depuis la vue 3D, vous tapez un prompt (ex: *"Ambiance contemporaine chaleureuse, mur du fond en terracotta, autres murs blanc lin, parquet chêne clair, canapé bouclette écru et arche cuisine blanche"*). L'IA met à jour directement tous les matériaux, couleurs et meubles de votre scène 3D interactive !
2. **Rendu Photo-Réel IA de la Caméra 3D actuelle** : Vous placez la caméra 3D (ou en mode FPS) face à votre salon ou votre cuisine $\rightarrow$ un clic capture la géométrie exacte du canvas 3D et génère une **photo d'architecture ultra-réaliste** qui respecte la position exacte de vos murs, de votre arche et de vos meubles.

#### ✅ Proposition 6.B (Recommandée) : Passerelle « Export Maison 3D $\rightarrow$ Google Flow / Outils IA $\rightarrow$ Réimport dans l'App »
Nous créons un module complet **« Studio Export / Import 3D & IA »** dans la vue 3D :

1. **📤 Export 3D Universel en 1 clic :**
   - **Export Modèle 3D `.glb` / `.gltf` et `.obj`** (via `GLTFExporter` officiel de Three.js) : Exporte toute votre maison (ou l'étage actif) avec ses murs, ses arches, ses sols et ses meubles aux cotes exactes. Vous pouvez l'ouvrir dans **Blender, SketchUp, D5 Render, Twinmotion, Tripo3D, Meshy**.
   - **Export « Pack Google Flow / IA Visuelle »** : Exporte en 1 clic :
     1. Le rendu de structure 3D haute définition de votre angle de vue,
     2. La **Carte de Profondeur (Depth Map)** générée par Three.js,
     3. Le **Prompt descriptif complet pré-rédigé** automatiquement à partir de votre pièce.
     - Il vous suffit de glisser cette image + ce prompt dans **Google Flow / Google AI Studio / Whisk / PromeAI / Krea** pour obtenir une génération photoréaliste ou une vidéo de visite cinématique gratuite !

2. **📥 Réimport dans l'Application :**
   - **Réimport de fichiers 3D (`.glb` / `.gltf`)** : Vous pouvez réimporter dans votre plan 3D soit un **objet/meuble 3D `.glb`** généré à l'extérieur, soit une **scène 3D `.glb` complète** retravaillée dans un outil externe !
   - **Réimport de Rendus Réalistes / Panoramas 360° épinglés aux pièces** : Vous réimportez l'image (ou la vue 360° équirectangulaire) générée par Google Flow ou une autre IA directement dans votre pièce 3D : un bouton **« 👁️ Voir le Rendu Réel de cette pièce »** permet de basculer à tout moment entre le modèle 3D de travail et le rendu photoréaliste final (avec visionneuse 360° interactive si l'image est un panorama) !

---

## 7. 🧠 Génération du Plan 2D via IA : Amélioration Interne + Mode Externe (Export Prompt / Import JSON)

### 🔍 Mon avis d'expert : Faut-il proposer un mode externe pour la génération 2D ?
**OUI, c'est même une excellente idée en complément du mode direct !** Voici pourquoi :
1. Sur les versions web gratuites de **Google AI Studio / Gemini Pro, ChatGPT ou Claude**, vous bénéficiez des **modèles de raisonnement ("Thinking") les plus puissants** sans aucune restriction de quota API gratuit, et vous pouvez **discuter avec l'IA** (*"Décale la cuisine à droite et ajoute une arche de 140 cm"*) avant d'importer le plan.
2. De plus, lorsqu'on demande à une IA de calculer directement des coordonnées `(x1, y1, x2, y2)` en partant d'un croquis, elle fait souvent des erreurs d'addition.

### 💡 Solutions Proposées

#### ✅ Proposition 7.A : Nouveau format IA basé sur les « Espacements & Pièces » (Zéro erreur géométrique)
Au lieu de demander uniquement des coordonnées brutes `x, y` à l'IA, nous lui permettons de décrire **les pièces, leurs espacements intérieurs (largeur × profondeur) et leurs connexions**, puis c'est **notre propre moteur géométrique (Proposition 1.A)** qui calcule les murs extérieurs et les cloisons au millimètre près ! Plus aucun mur en double ni décalé.

#### ✅ Proposition 7.B : Onglet « 🌐 Via IA Externe (Gemini Web / ChatGPT / Claude — Sans Clé API) »
Dans la modale de génération de plan 2D :
1. **Bouton « 📋 Copier le Prompt Architecte 2D »** : Génère un prompt prêt à coller dans ChatGPT, Claude ou Gemini Web (avec possibilité d'inclure votre plan actuel en JSON si vous souhaitez demander à l'IA de modifier votre plan existant !).
2. Vous joignez la photo de votre croquis ou votre description dans votre IA externe préférée.
3. **Zone « 📥 Coller le JSON généré »** : Vous collez la réponse de l'IA dans l'application, qui affiche un **aperçu instantané** (nombre de murs, pièces, cotes) et l'applique proprement à votre étage.

---

## 📋 Récapitulatif des Choix à Valider

| # | Domaine | Solution proposée | Inclus par défaut ? |
|---|---|---|---|
| **1** | **Plan 2D — Espacements** | **Décalage en cascade (Push/Pull global)** + adaptation automatique des murs extérieurs + verrouillage des cotes (`🔒`) + navigation `Tab` | ✅ Oui |
| **2** | **Plan 2D/3D — Ouvertures** | **Ouvertures 100 % personnalisables** : Passages ouverts / **Arches** (plein cintre, cintrée surbaissée, asymétrique, droite), **Verrières**, **Galandage**, **Niches**, avec ou sans cadre + hauteur d'allège et distance au coin | ✅ Oui |
| **3** | **Plan 3D — Murs, Sols, Plafonds** | **Mode Personnalisation 3D au clic** : peinture/revêtement indépendant sur **chaque face d'un mur** (Face A / Face B), textures 3D (briques, tasseaux bois, carrelage, béton ciré, photo perso), sols et plafonds | ✅ Oui |
| **4** | **Plan 3D — Meubles** | **Personnalisation au clic en 3D** : choix de variantes de modèles 3D, tissus/matières (bouclette, velours, lin, cuir, bois, marbre), couleurs multi-zones et hauteur du sol (`elevationCm` pour TV murale, etc.) | ✅ Oui |
| **5** | **Rendu Réel & Import Web** | **Mode Rendu Réel PBR** (textures relief, éclairage chaud, reflets, ombres douces) + **Import Web Visuel (Darty, Poltronesofà, Truffaut...)** par URL ou `Ctrl+V` d'image avec détourage auto du fond blanc, placage photo HD (TV/plantes) et support modèles `.glb` | ✅ Oui |
| **6** | **Génération 3D IA** | **Double solution** : Style/Rendu IA en direct dans l'app **+** **Studio Export/Import 3D (`.glb` / `.obj` + Pack Google Flow + Réimport de modèles `.glb` et de rendus/panoramas 360°)** | ✅ Oui |
| **7** | **Génération 2D IA** | **Double solution** : Génération directe améliorée **+** **Passerelle IA Externe (Copier Prompt Architecte $\rightarrow$ ChatGPT/Claude/Gemini $\rightarrow$ Coller JSON)** | ✅ Oui |
