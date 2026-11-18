import React, { useMemo, useRef, useState } from 'react';
import { Camera, Plus, Trash2, X, Image as ImageIcon, Sparkles } from 'lucide-react';
import type { Floor, House, PhotoPhase, RoomPhoto } from '../types';
import { uid } from '../db';
import { compressImageToWebP } from '../utils/geometry';
import { AIHomeStagingModal } from './AIHomeStagingModal';
import type { SuggestedDecoItem } from '../utils/aiService';
import { useEscapeKey } from '../utils/useEscapeKey';

interface PhotosGalleryProps {
  house: House;
  floors: Floor[];
  photos: RoomPhoto[];
  onAddPhoto: (photo: RoomPhoto) => void;
  onDeletePhoto: (photoId: string) => void;
  onOpenAISettings?: () => void;
  onAddSuggestedToPlan?: (item: SuggestedDecoItem, floorId: string) => void;
}

const PHASE_LABELS: Record<PhotoPhase, { label: string; badge: string }> = {
  before: { label: 'Avant', badge: 'bg-slate-100 text-slate-700' },
  during: { label: 'Pendant', badge: 'bg-amber-100 text-amber-800' },
  after: { label: 'Après', badge: 'bg-emerald-100 text-emerald-800' },
};

export const PhotosGallery: React.FC<PhotosGalleryProps> = ({
  house,
  floors,
  photos,
  onAddPhoto,
  onDeletePhoto,
  onOpenAISettings,
  onAddSuggestedToPlan,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const roomOptions = useMemo(() => {
    const list: { floorId: string; roomName: string }[] = [];
    floors.forEach((f) => {
      f.rooms.forEach((r) => {
        list.push({ floorId: f.id, roomName: r.name });
      });
    });
    if (list.length === 0 && floors[0]) {
      list.push({ floorId: floors[0].id, roomName: 'Général' });
    }
    return list;
  }, [floors]);

  const [selectedRoomFilter, setSelectedRoomFilter] = useState<string>('all');
  const [uploadRoom, setUploadRoom] = useState<string>(roomOptions[0]?.roomName ?? 'Général');
  const [uploadPhase, setUploadPhase] = useState<PhotoPhase>('before');
  const [uploadCaption, setUploadCaption] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<RoomPhoto | null>(null);
  const [stagingPhoto, setStagingPhoto] = useState<RoomPhoto | null>(null);

  useEscapeKey(lightboxPhoto !== null, () => setLightboxPhoto(null));

  const filteredPhotos = useMemo(() => {
    return photos
      .filter((p) => (selectedRoomFilter === 'all' ? true : p.roomName === selectedRoomFilter))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [photos, selectedRoomFilter]);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsCompressing(true);
    try {
      const targetFloor =
        roomOptions.find((r) => r.roomName === uploadRoom)?.floorId ?? floors[0]?.id ?? '';
      for (const file of Array.from(files)) {
        const dataUrl = await compressImageToWebP(file, 1280, 0.8);
        onAddPhoto({
          id: uid('ph'),
          houseId: house.id,
          floorId: targetFloor,
          roomName: uploadRoom || 'Général',
          phase: uploadPhase,
          caption: uploadCaption.trim() || file.name.replace(/\.[^.]+$/, ''),
          dataUrl,
          createdAt: new Date().toISOString(),
        });
      }
      setUploadCaption('');
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Upload Bar */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Camera className="w-5 h-5 text-slate-700" /> Photos par pièce
            </h2>
            <span className="text-xs text-slate-500">Compression WebP automatique (100 % local)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <select
              value={uploadRoom}
              onChange={(e) => setUploadRoom(e.target.value)}
              className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
            >
              {roomOptions.map((r, i) => (
                <option key={`${r.floorId}-${r.roomName}-${i}`} value={r.roomName}>
                  {r.roomName}
                </option>
              ))}
              <option value="Extérieur">Extérieur</option>
              <option value="Général">Général</option>
            </select>

            <select
              value={uploadPhase}
              onChange={(e) => setUploadPhase(e.target.value as PhotoPhase)}
              className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
            >
              <option value="before">Avant travaux</option>
              <option value="during">Pendant travaux</option>
              <option value="after">Après travaux</option>
            </select>

            <input
              type="text"
              placeholder="Légende (optionnel)"
              value={uploadCaption}
              onChange={(e) => setUploadCaption(e.target.value)}
              className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isCompressing}
              className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 flex items-center justify-center gap-2 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              {isCompressing ? 'Compression...' : 'Ajouter photo(s)'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
          </div>
        </div>

        {/* Room Filter Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedRoomFilter('all')}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${
              selectedRoomFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Toutes les pièces ({photos.length})
          </button>
          {Array.from(new Set(photos.map((p) => p.roomName))).map((rm) => (
            <button
              key={rm}
              onClick={() => setSelectedRoomFilter(rm)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${
                selectedRoomFilter === rm
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-700'
              }`}
            >
              {rm} ({photos.filter((p) => p.roomName === rm).length})
            </button>
          ))}
        </div>

        {/* Photo Grid */}
        {filteredPhotos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 flex flex-col items-center gap-2">
            <ImageIcon className="w-10 h-10 text-slate-300" />
            <p>Aucune photo pour le moment. Ajoutez des photos Avant / Pendant / Après de vos pièces.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {filteredPhotos.map((photo) => (
              <div
                key={photo.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs group"
              >
                <div
                  onClick={() => setLightboxPhoto(photo)}
                  className="aspect-[4/3] bg-slate-100 overflow-hidden cursor-pointer relative"
                >
                  <img
                    src={photo.dataUrl}
                    alt={photo.caption}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <span
                    className={`absolute top-2.5 left-2.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                      PHASE_LABELS[photo.phase].badge
                    }`}
                  >
                    {PHASE_LABELS[photo.phase].label}
                  </span>
                </div>
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-900 truncate">{photo.roomName}</div>
                    <div className="text-xs text-slate-500 truncate">{photo.caption}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setStagingPhoto(photo)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-violet-50 text-violet-700 hover:bg-violet-100 flex items-center gap-1"
                      title="Simuler un aménagement intérieur par IA"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Simuler IA
                    </button>
                    <button
                      onClick={() => onDeletePhoto(photo.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl"
                      title="Supprimer la photo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxPhoto && (
        <div
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 bg-slate-950/90 flex items-center justify-center p-4 z-50"
        >
          <button
            onClick={() => setLightboxPhoto(null)}
            aria-label="Fermer"
            className="absolute top-4 right-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="w-6 h-6" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl w-full flex flex-col items-center">
            <img
              src={lightboxPhoto.dataUrl}
              alt={lightboxPhoto.caption}
              className="max-h-[80vh] rounded-2xl object-contain"
            />
            <div className="mt-3 text-white text-center">
              <div className="font-semibold">{lightboxPhoto.roomName} — {PHASE_LABELS[lightboxPhoto.phase].label}</div>
              <div className="text-sm text-slate-300">{lightboxPhoto.caption}</div>
            </div>
          </div>
        </div>
      )}
      {/* AI Home Staging Modal (V3) */}
      <AIHomeStagingModal
        photo={stagingPhoto}
        onClose={() => setStagingPhoto(null)}
        onOpenSettings={() => onOpenAISettings?.()}
        onSaveSimulatedPhoto={(dataUrl, caption) => {
          if (!stagingPhoto) return;
          onAddPhoto({
            id: uid('photo'),
            houseId: house.id,
            floorId: stagingPhoto.floorId,
            roomName: stagingPhoto.roomName,
            phase: 'after',
            caption,
            dataUrl,
            createdAt: new Date().toISOString(),
          });
        }}
        onAddSuggestedToPlan={
          onAddSuggestedToPlan && stagingPhoto
            ? (item) => onAddSuggestedToPlan(item, stagingPhoto.floorId)
            : undefined
        }
      />
    </div>
  );
};
