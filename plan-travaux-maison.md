# Plan d'implémentation — Application « Travaux Maison & Design » (PC Tactile)

Ce document centralise l'architecture, les choix techniques **100 % gratuits** et la feuille de route complète (V1 → V2 → V3) validée au fil des conversations pour votre application de gestion de travaux, plans 2D/3D et aménagement intérieur.

---

## 1. Choix d'Architecture & Stockage (100 % Gratuit)

* **Stockage Local-First** : IndexedDB via **Dexie.js** (aucun compte requis, aucune limite de stockage cloud, persistance sur disque local).
* **Hors-ligne / PWA** : Fonctionne directement sur le chantier sans connexion Internet.
* **Gestion Photos** : Compression automatique en **WebP** côté client avant enregistrement dans Dexie (photos légères et fluides).
* **Sauvegarde & Restauration** : Export / Import de la base complète en `.json`.
* **Partage Téléphone** : Génération de QR Code instantané (imprimable ou scannable) pour ouvrir ou partager la liste de courses.

---

## 2. État d'Avancement des Versions

### ✅ V1 — Le Cœur de l'Application (Terminé)
* **Multi-maisons** : Création, sélection, suppression complète avec confirmation sécurisée.
* **Éditeur de Plan 2D Tactile (Konva)** :
  * Multi-niveaux (Extérieur, RDC, Étage 1, etc.) avec calque fantôme (Onion skin).
  * Tracé des murs au doigt / stylet / souris avec snap magnétique.
  * Saisie numérique précise des cotes de mur (sans étirement manuel).
  * Suppression par touche `Suppr` ou bouton, `Ctrl+Z` / `Ctrl+Y` (Undo / Redo).
  * Cadenas de verrouillage pour protéger les murs ou meubles.
  * Définition de pièces / zones (rectangulaires et polygonales) avec calcul automatique des surfaces au sol (m²) et périmètres.
  * Ouvertures : portes (avec arc), fenêtres, baies vitrées coulissantes.
  * Bibliothèque de meubles 2D intérieurs et extérieurs (plantes, haies, murets, portails battants/coulissants, portillons).
  * Tutoriel interactif intégré ("Guide de création d'un étage de A à Z").
  * Support tactile multi-touch (zoom / pan fluide à deux doigts quel que soit l'outil actif).
* **Tâches & Liste de Courses** :
  * Tâches par pièce / étage avec priorités et échéances.
  * Liste de courses avec prix estimé par article, magasins et calcul du budget par pièce / global.
  * Vue imprimable optimisée et QR Code pour mobile.
* **Galerie Photos** :
  * Photos classées par pièce et phase (Avant / Pendant / Après) avec compression WebP.

---

### ✅ V2 — Visualisation 3D Interactive (Terminé)
* Rendu 3D Three.js temps réel généré dynamiquement depuis le plan 2D.
* Extrusion des murs avec découpe automatique des ouvertures (portes, fenêtres, baies).
* Rendu des sols texturés et placement automatique du mobilier 3D aux bonnes coordonnées et rotations.
* Vue étage courant vs vue maison complète empilée.
* Éclairage jour / soir, bascule grille et meubles, contrôles d'orbite 3D tactiles.

---

### 🚀 V3 — Intelligence Artificielle & Shopping Connecté (Feuille de Route Validée)

Voici l'ensemble des fonctionnalités demandées et enregistrées au fil des échanges pour la V3 :

#### 1. 📐 Import & Reconnaissance de Plan 2D par IA (Vision)
*(Demandé lors de la session du 13/11 à 14h26)*
* **Photo d'un plan 2D papier / croquis $\rightarrow$ Génération automatique dans l'application** :
  * Prendre en photo un plan d'architecte, un schéma coté ou un croquis à main levée.
  * L'IA analyse la structure, détecte les murs, ouvertures et cotes, et génère directement les murs vectoriels et pièces dans le canvas 2D.

#### 2. 🛋️ Transformation de Photos & Simulation de Pièces par IA (Home Staging)
*(Demandé lors de la session initiale du 13/11 à 14h03)*
* **Simulation d'aménagement intérieur sur photo réelle** :
  * À partir d'une photo de votre galerie (pièce brute ou en travaux), l'IA applique un style décoratif (ex: scandinave, industriel, contemporain) tout en respectant l'agencement réel des murs et ouvertures.
* **Assistance à la génération 3D par IA** :
  * Génération automatique ou proposition d'agencement 3D depuis une description ou une photo.

#### 3. 🌐 Intégration E-Commerce (Leroy Merlin, Maisons du Monde, Castorama, Brico Dépôt...)
*(Demandé lors de la session du 13/11 à 17h10)*
* **Import d'articles web vers le Plan 2D & 3D** :
  * Pouvoir coller le lien ou sélectionner un produit depuis les sites marchands partenaires (Leroy Merlin, Maisons du Monde, Castorama, Brico Dépôt, etc.).
  * Extraction automatique des **dimensions réelles** pour insertion à l'échelle dans le plan 2D et du **visuel/modèle** pour la vue 3D.
  * **Ajout automatique à la liste de courses** avec le prix, le magasin et le lien direct d'achat.
* **Recherche inversée d'objets réels depuis l'IA** :
  * Depuis un meuble ou un élément généré par l'IA dans une simulation de pièce, lancer une recherche visuelle pour trouver un meuble équivalent réel disponible à l'achat sur ces sites marchands.

#### 4. 🎮 3D Immersive & Visite Virtuelle (V3)
*(Ajouté au plan V3)*
* **Mode Visite Première Personne (FPS Walkthrough)** :
  * Déplacement à hauteur humaine (1,68 m) au clavier (`ZQSD` / flèches) ou via un pad tactile sur écran tactile, et rotation caméra 360° au doigt/souris.
  * Détection de collision contre les murs pleins tout en permettant le passage par les portes et baies vitrées.
  * Affichage en temps réel de la pièce traversée et téléportation rapide par pièce.
* **Coupe Transversale ("Maison de poupée")** :
  * Plan de coupe verticale réglable en hauteur pour voir l'intérieur de la maison sous tous les angles.
* **Ombres Portées & Course du Soleil** :
  * Slider d'heure de la journée (8h → 20h) pour simuler la lumière naturelle traversant les fenêtres.
* **Plafonds optionnels** pour un rendu intérieur réaliste en mode visite.

#### 5. 🔑 Infrastructure & Gratuité (100% Gratuit)
* Clé API Google Gemini (Free Tier) renseignée dans les réglages et stockée en local dans Dexie.
* Respect strict de la gratuité sans abonnement ni serveur payant.
