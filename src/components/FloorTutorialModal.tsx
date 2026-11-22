import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Square,
  PenLine,
  Layers,
  Keyboard,
  HelpCircle,
  CheckCircle,
  ArrowRight,
  ShieldCheck,
  Shapes,
  Lightbulb,
  Ruler,
} from 'lucide-react';
import { useEscapeKey } from '../utils/useEscapeKey';

interface FloorTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FloorTutorialModal: React.FC<FloorTutorialModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'difference' | 'step_by_step' | 'irregular' | 'shortcuts'>('difference');

  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50/50 to-indigo-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Guide & Tutoriel : Créer un Étage de A à Z</h2>
              <p className="text-xs text-slate-500">Murs vs Pièces, cas pratique étage, pièces non-rectangulaires et raccourcis</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50/80 px-4 gap-1 overflow-x-auto">
          {[
            { id: 'difference', label: 'Mur vs Pièce (Principe)', icon: <HelpCircle className="w-4 h-4" /> },
            { id: 'step_by_step', label: 'Étape par étape (Cas Étage)', icon: <Layers className="w-4 h-4" /> },
            { id: 'irregular', label: 'Pièces non-rectangulaires', icon: <Shapes className="w-4 h-4" /> },
            { id: 'shortcuts', label: 'Raccourcis & Cadenas', icon: <Keyboard className="w-4 h-4" /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-3.5 py-3 text-xs sm:text-sm font-semibold flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-700 bg-white rounded-t-xl shadow-xs'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-slate-700 text-sm leading-relaxed">
          {/* TAB 1: MUR VS PIECE */}
          {activeTab === 'difference' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                <h3 className="font-bold text-blue-900 text-base mb-1 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-blue-600 shrink-0" />
                  La règle d'or architecturale : Le Mur structure, la Pièce habite !
                </h3>
                <p className="text-blue-800 text-xs sm:text-sm">
                  Pour votre étage (2 chambres, salle de bain, bureau, couloir/escalier) :{' '}
                  <strong>ne mettez jamais 1 seule pièce globale !</strong> Vous devez créer les{' '}
                  <strong>murs</strong> pour délimiter physiquement l'espace, puis définir{' '}
                  <strong>5 pièces distinctes</strong>.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Mur Card */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <PenLine className="w-5 h-5 text-slate-900" />
                    <span>Le Mur (Structure Physique)</span>
                  </div>
                  <ul className="text-xs space-y-1.5 text-slate-600 list-disc list-inside">
                    <li>Représente la maçonnerie réelle ou les cloisons placo (épaisseur 7, 10 ou 20 cm).</li>
                    <li>
                      Donne la <strong>forme géométrique exacte</strong> : angles droits, diagonales, pans coupés,
                      sous-pentes.
                    </li>
                    <li>
                      <strong>Accueille les ouvertures</strong> : les portes et fenêtres ne peuvent être posées que sur un
                      mur.
                    </li>
                    <li>Calcule la surface murale pour les pots de peinture ou le papier peint.</li>
                  </ul>
                </div>

                {/* Pièce Card */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Square className="w-5 h-5 text-blue-600" />
                    <span>La Pièce (Zone de vie & Finition)</span>
                  </div>
                  <ul className="text-xs space-y-1.5 text-slate-600 list-disc list-inside">
                    <li>Vient « remplir » la zone délimitée par les murs.</li>
                    <li>
                      Calcule automatiquement la <strong>surface au sol en m²</strong> et le périmètre pour les plinthes.
                    </li>
                    <li>Permet de choisir le <strong>revêtement</strong> (parquet, carrelage, stratifié...).</li>
                    <li>
                      <strong>Pilote le budget</strong> : regroupe les tâches de travaux et les listes de courses de cette pièce !
                    </li>
                  </ul>
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                <h4 className="font-bold text-emerald-950 text-sm mb-1 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  Réponse directe pour votre projet d'Étage :
                </h4>
                <p className="text-xs sm:text-sm text-emerald-900">
                  Tracez le contour extérieur de votre étage en murs, ajoutez les cloisons de séparation, puis créez{' '}
                  <strong>5 pièces distinctes</strong> :
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2 text-xs font-semibold text-center">
                  <div className="bg-white p-2 rounded-xl border border-emerald-200 text-slate-800">1. Chambre 1</div>
                  <div className="bg-white p-2 rounded-xl border border-emerald-200 text-slate-800">2. Chambre 2</div>
                  <div className="bg-white p-2 rounded-xl border border-emerald-200 text-slate-800">3. Salle de bain</div>
                  <div className="bg-white p-2 rounded-xl border border-emerald-200 text-slate-800">4. Bureau</div>
                  <div className="bg-white p-2 rounded-xl border border-emerald-200 text-slate-800">5. Couloir Escalier</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ETAPE PAR ETAPE */}
          {activeTab === 'step_by_step' && (
            <div className="space-y-4">
              <p className="text-xs sm:text-sm text-slate-600">
                Voici le protocole complet pour concevoir votre étage de A à Z en quelques minutes :
              </p>

              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    1
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Tracez l'enveloppe extérieure (Murs)</h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Sélectionnez l'outil <strong>Mur</strong>. Cliquez pour le point de départ, puis cliquez pour le point de fin.
                      L'aimantation automatique permet de fermer parfaitement le périmètre de l'étage (épaisseur conseillée : 20 ou 25 cm).
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    2
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Ajoutez les cloisons intérieures</h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Toujours avec l'outil <strong>Mur</strong>, tracez les cloisons de séparation (épaisseur 7 ou 10 cm)
                      pour diviser l'espace : chambre 1, chambre 2, salle de bain, bureau et le palier couloir.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    3
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Placez les Portes et Fenêtres</h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Cliquez sur l'outil <strong>Porte</strong> ou <strong>Fenêtre</strong>, puis touchez simplement le mur souhaité.
                      L'ouverture s'insère automatiquement dans le mur. Cliquez dessus pour ajuster sa largeur ou inverser son sens.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    4
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Définissez vos 5 Pièces</h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Prenez l'outil <strong>Pièce</strong> (Rectangle ou Polygone). Placez la zone dans chaque pièce, nommez-la
                      (« Chambre 1 », « Bureau », etc.) et choisissez le sol (parquet, carrelage). La surface en m² se calcule en direct !
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    5
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Aménagez les Meubles & Escaliers</h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Ouvrez le tiroir <strong>Meubles</strong> : ajoutez l'Escalier (trémie d'arrivée de l'étage), les lits doubles,
                      la douche, les vasques et le bureau. Vous pouvez les tourner et les placer au millimètre.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PIECES NON RECTANGULAIRES */}
          {activeTab === 'irregular' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <h3 className="font-bold text-amber-950 text-base mb-1 flex items-center gap-2">
                  <Ruler className="w-4 h-4 text-amber-700 shrink-0" />
                  Comment gérer un couloir en L, une pièce en biseau ou mansardée ?
                </h3>
                <p className="text-amber-900 text-xs sm:text-sm">
                  Dans une maison, les couloirs et pièces sous combles ne sont jamais de simples rectangles. Voici comment faire :
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Shapes className="w-4 h-4 text-blue-600" />
                    Option 1 : L'outil « Pièce (Polygone) »
                  </h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Dans la barre du bas, cliquez sur <strong>Pièce (Polygone)</strong>. Cliquez successivement sur chaque coin
                    de votre couloir en L ou pièce non rectangulaire (point 1, point 2, point 3, point 4, point 5, point 6...),
                    puis cliquez sur <strong>Terminer la pièce</strong>. La surface exacte de la pièce biscornue est instantanément calculée !
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <PenLine className="w-4 h-4 text-slate-900" />
                    Option 2 : Les Murs définissent n'importe quel angle
                  </h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Les murs peuvent être dessinés en diagonale sous n'importe quel angle. Vous pouvez connecter plusieurs murs
                    pour former des formes complexes.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-emerald-600" />
                    Option 3 : Réglage numérique précis des longueurs (sans étirer)
                  </h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Cliquez sur n'importe quel mur sélectionné : dans le panneau de droite, vous pouvez saisir directement sa
                    longueur en centimètres (ex: 385 cm = 3,85 m) ou utiliser les boutons <strong>-10 / +10 cm</strong> pour
                    ajuster le mur sans avoir à l'étirer à la souris !
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: RACCOURCIS ET CADENAS */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-4">
              <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2.5 mb-2 font-bold text-base">
                  <Keyboard className="w-5 h-5 text-blue-400" />
                  Raccourcis Clavier Disponibles
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 flex justify-between items-center">
                    <span>Supprimer l'élément sélectionné</span>
                    <kbd className="px-2.5 py-1 bg-slate-700 text-white font-mono rounded font-bold border border-slate-600">Suppr</kbd>
                  </div>
                  <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 flex justify-between items-center">
                    <span>Annuler la dernière action</span>
                    <kbd className="px-2.5 py-1 bg-slate-700 text-white font-mono rounded font-bold border border-slate-600">Ctrl + Z</kbd>
                  </div>
                  <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 flex justify-between items-center">
                    <span>Rétablir l'action annulée</span>
                    <kbd className="px-2.5 py-1 bg-slate-700 text-white font-mono rounded font-bold border border-slate-600">Ctrl + Y</kbd>
                  </div>
                  <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 flex justify-between items-center">
                    <span>Annuler l'outil en cours / Désélection</span>
                    <kbd className="px-2.5 py-1 bg-slate-700 text-white font-mono rounded font-bold border border-slate-600">Échap</kbd>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-950 font-bold text-sm">
                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                  Le Cadenas : Protection contre la suppression accidentelle
                </div>
                <p className="text-xs sm:text-sm text-amber-900">
                  En haut de l'écran, vous disposez de cadenas pour les <strong>Murs (C1)</strong> et les <strong>Meubles (C2)</strong>.
                </p>
                <ul className="text-xs text-amber-800 space-y-1 list-disc list-inside">
                  <li>Lorsque le cadenas est activé, l'élément ne peut <strong>ni être déplacé, ni être supprimé</strong> (la touche Suppr et le bouton poubelle sont bloqués).</li>
                  <li>Très utile lorsque votre étage est dessiné : verrouillez les Murs pour meubler en toute tranquillité sans risquer d'effacer une cloison par erreur !</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-xs text-slate-500">Accessible à tout moment via le bouton « Guide & Tuto »</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs sm:text-sm font-semibold hover:bg-slate-800 transition-colors"
          >
            Fermer le guide
          </button>
        </div>
      </div>
    </div>
  );
};
