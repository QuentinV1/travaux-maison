import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp, type Firestore } from 'firebase/firestore';
import { Bug, CheckCircle2, Clock, Lightbulb, MessageSquarePlus, Send, X } from 'lucide-react';

export type FeedbackType = 'evolution' | 'bug';

interface LocalFeedbackItem {
  id: string;
  type: FeedbackType;
  comment: string;
  createdAt: string;
  synced: boolean;
  context?: string;
}

interface FeedbackModalProps {
  open: boolean;
  user: User | null;
  db: Firestore | null;
  context?: string;
  onClose: () => void;
}

const STORAGE_KEY = 'travaux_maison_feedbacks_v1';
const APP_ID = 'travaux-maison';
const APP_NAME = 'Travaux Maison';

function loadLocalFeedbacks(): LocalFeedbackItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalFeedbacks(items: LocalFeedbackItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 30)));
  } catch {
    // Ignore storage quota errors
  }
}

export function FeedbackModal({ open, user, db, context, onClose }: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>('evolution');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<LocalFeedbackItem[]>(() => loadLocalFeedbacks());

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(null);
    setHistory(loadLocalFeedbacks());

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !db || !user || !user.emailVerified || !user.email || !navigator.onLine) return;
    const items = loadLocalFeedbacks();
    const pending = items.filter((item) => !item.synced);
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      const updated = [...items];
      for (const item of pending) {
        if (cancelled) break;
        try {
          await addDoc(collection(db, 'hub_feedbacks'), {
            appId: APP_ID,
            appName: APP_NAME,
            type: item.type,
            comment: item.comment.slice(0, 2000),
            status: 'open',
            authorUid: user.uid,
            authorEmail: (user.email || '').trim().toLowerCase(),
            authorName: (user.displayName || '').trim().slice(0, 80),
            context: (item.context || '').slice(0, 300),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          const idx = updated.findIndex((x) => x.id === item.id);
          if (idx >= 0) updated[idx] = { ...updated[idx], synced: true };
        } catch {
          // Will retry later
        }
      }
      if (!cancelled) {
        saveLocalFeedbacks(updated);
        setHistory(updated);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, db, user]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = comment.trim();
    if (!trimmed) {
      setError('Veuillez saisir un commentaire.');
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    const canSync = Boolean(db && user && user.emailVerified && user.email && navigator.onLine);
    let synced = false;

    if (canSync && db && user && user.email) {
      try {
        await addDoc(collection(db, 'hub_feedbacks'), {
          appId: APP_ID,
          appName: APP_NAME,
          type,
          comment: trimmed.slice(0, 2000),
          status: 'open',
          authorUid: user.uid,
          authorEmail: user.email.trim().toLowerCase(),
          authorName: (user.displayName || '').trim().slice(0, 80),
          context: (context || '').slice(0, 300),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        synced = true;
      } catch {
        synced = false;
      }
    }

    const nextItem: LocalFeedbackItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      comment: trimmed,
      createdAt: new Date().toISOString(),
      synced,
      context,
    };
    const nextHistory = [nextItem, ...loadLocalFeedbacks()].slice(0, 30);
    saveLocalFeedbacks(nextHistory);
    setHistory(nextHistory);
    setComment('');
    setBusy(false);
    setSuccess(
      synced
        ? 'Feedback envoyé avec succès !'
        : 'Feedback enregistré localement. Il sera envoyé dès la connexion au Cloud.'
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="feedback-modal-title" className="flex items-center gap-2 text-base font-bold text-slate-900">
            <MessageSquarePlus className="h-5 w-5 text-sky-600" />
            <span>Feedback — {APP_NAME}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Type de retour</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('evolution')}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  type === 'evolution'
                    ? 'border-sky-500 bg-sky-50 text-sky-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Lightbulb className="h-4 w-4" />
                <span>Évolution</span>
              </button>
              <button
                type="button"
                onClick={() => setType('bug')}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  type === 'bug'
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Bug className="h-4 w-4" />
                <span>Bug</span>
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600">
              <label htmlFor="feedback-comment-input">Commentaire</label>
              <span className="text-slate-400">{comment.length} / 2000</span>
            </div>
            <textarea
              id="feedback-comment-input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              rows={4}
              required
              placeholder={
                type === 'evolution'
                  ? "Décrivez l'amélioration ou la nouvelle fonctionnalité souhaitée..."
                  : 'Décrivez le problème rencontré et comment le reproduire...'
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {error}
            </p>
          )}
          {success && (
            <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{success}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !comment.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            <span>{busy ? 'Envoi...' : 'Envoyer le feedback'}</span>
          </button>
        </form>

        {history.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Vos derniers retours ({history.length})
            </div>
            <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
              {history.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        item.type === 'bug' ? 'text-rose-600' : 'text-sky-700'
                      }`}
                    >
                      {item.type === 'bug' ? <Bug className="h-3 w-3" /> : <Lightbulb className="h-3 w-3" />}
                      {item.type === 'bug' ? 'Bug' : 'Évolution'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      {item.synced ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Clock className="h-3 w-3 text-amber-500" />
                      )}
                      {new Date(item.createdAt).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-slate-700">{item.comment}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
