import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Cloud,
  CloudOff,
  Copy,
  Check,
  LogIn,
  LogOut,
  RefreshCw,
  UserPlus,
  Users,
  X,
  AlertCircle,
} from 'lucide-react';
import type { House, HouseSyncConfig } from '../types';
import { useEscapeKey } from '../utils/useEscapeKey';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  ensureRemoteWorkspace,
  listMyRemoteWorkspaces,
  resendVerificationEmail,
  resetFirebasePassword,
  signInWithEmail,
  signInWithGoogle,
  signOutFirebase,
  updateWorkspaceMembers,
  type RemoteWorkspaceSummary,
} from '../utils/firebaseSync';

interface CloudSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  house: House | null;
  syncConfig: HouseSyncConfig | null;
  onEnableSync: (workspaceId: string) => Promise<void>;
  onDisableSync: () => Promise<void>;
  onPushLocalToRemote: (workspaceId: string) => Promise<void>;
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  isOpen,
  onClose,
  user,
  house,
  syncConfig,
  onEnableSync,
  onDisableSync,
  onPushLocalToRemote,
}) => {
  useEscapeKey(isOpen, onClose);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copiedUid, setCopiedUid] = useState(false);
  const [workspaces, setWorkspaces] = useState<RemoteWorkspaceSummary[]>([]);
  const [newMemberUid, setNewMemberUid] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!isOpen || !user) {
      setWorkspaces([]);
      return;
    }
    let cancelled = false;
    listMyRemoteWorkspaces(user.uid)
      .then((list) => {
        if (!cancelled) setWorkspaces(list);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Erreur chargement espaces Firebase:', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, user]);

  if (!isOpen) return null;

  const activeWorkspace = syncConfig?.enabled
    ? workspaces.find((w) => w.id === syncConfig.workspaceId)
    : undefined;

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion Google impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await signInWithEmail(email, password);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion par e-mail impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError('Saisissez votre adresse e-mail pour recevoir le lien de réinitialisation.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await resetFirebasePassword(email);
      setInfo('E-mail de réinitialisation envoyé (vérifiez vos spams).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’envoyer l’e-mail de réinitialisation.');
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await resendVerificationEmail();
      setInfo('E-mail de vérification envoyé. Rechargez la page après validation.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’envoyer l’e-mail de vérification.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndSync = async () => {
    if (!house || !user) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const ws = await ensureRemoteWorkspace(house.id, house.name, house.address);
      await onEnableSync(ws.id);
      await onPushLocalToRemote(ws.id);
      const list = await listMyRemoteWorkspaces(user.uid);
      setWorkspaces(list);
      setInfo('Synchronisation activée et données locales envoyées.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’activer la synchronisation Firebase.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleJoinWorkspace = async (workspaceId: string) => {
    if (!house || !user) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await onEnableSync(workspaceId);
      setInfo('Maison connectée à l’espace partagé.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de rejoindre cet espace.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace || !newMemberUid.trim() || !user) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const updated = await updateWorkspaceMembers(activeWorkspace.id, [
        ...activeWorkspace.memberUids,
        newMemberUid.trim(),
      ]);
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === activeWorkspace.id ? { ...w, memberUids: updated } : w))
      );
      setNewMemberUid('');
      setInfo('Membre ajouté à l’espace partagé.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’ajouter ce membre (seul le propriétaire peut modifier les membres).'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (uidToRemove: string) => {
    if (!activeWorkspace || !user || uidToRemove === activeWorkspace.ownerUid) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateWorkspaceMembers(
        activeWorkspace.id,
        activeWorkspace.memberUids.filter((m) => m !== uidToRemove)
      );
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === activeWorkspace.id ? { ...w, memberUids: updated } : w))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyUid = async () => {
    if (!user) return;
    const ok = await copyTextToClipboard(user.uid);
    if (ok) {
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-slate-900">Synchronisation Foyer (Firebase)</h2>
              <p className="text-xs text-slate-500">Hub quentin-apps-hub · Partage à 2 en temps réel</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 leading-relaxed">
          <strong className="text-slate-800">Données synchronisées :</strong> Tâches chantier, Liste de
          courses, Équipements d’entretien, Prestataires et Interventions.
          <br />
          <strong className="text-slate-800">Données locales uniquement :</strong> Plans 2D/3D, Photos
          WebP, Justificatifs et modèles .GLB (pour respecter la limite Firestore et préserver la
          rapidité).
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {info && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
            {info}
          </div>
        )}

        {!user ? (
          <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
            <p className="text-sm text-slate-600 text-center">
              Connectez-vous avec votre compte autorisé sur <strong>quentin-apps-hub</strong> pour
              activer la synchronisation temps réel.
            </p>
            <div className="text-center">
              <button
                type="button"
                disabled={busy}
                onClick={handleSignIn}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                Se connecter avec Google
              </button>
            </div>

            <div className="relative flex items-center py-1">
              <div className="grow border-t border-slate-200" />
              <span className="shrink mx-3 text-xs text-slate-400">ou par e-mail</span>
              <div className="grow border-t border-slate-200" />
            </div>

            <form onSubmit={handleEmailSignIn} className="space-y-3">
              <div>
                <label htmlFor="cloud-sync-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Adresse e-mail
                </label>
                <input
                  id="cloud-sync-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nom@exemple.fr"
                  autoComplete="email"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label htmlFor="cloud-sync-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Mot de passe
                </label>
                <input
                  id="cloud-sync-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleResetPassword}
                  className="text-xs text-sky-600 hover:text-sky-800 disabled:opacity-50"
                >
                  Mot de passe oublié ?
                </button>
                <button
                  type="submit"
                  disabled={busy || !email.trim() || !password}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
                >
                  <LogIn className="w-4 h-4" />
                  Se connecter
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            {!user.emailVerified && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 space-y-2">
                <p>
                  <strong>E-mail non vérifié :</strong> les règles Firestore de{' '}
                  <code>quentin-apps-hub</code> exigent une adresse vérifiée (<code>email_verified</code>).
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleResendVerification}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  Renvoyer l’e-mail de vérification
                </button>
              </div>
            )}
            {/* Connected User */}
            <div className="border border-slate-200 rounded-xl p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {user.displayName || user.email}
                </div>
                <div className="text-xs text-slate-500 truncate">{user.email}</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <code className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 truncate max-w-[210px]">
                    UID: {user.uid}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyUid}
                    className="text-xs text-sky-600 hover:text-sky-800 inline-flex items-center gap-1"
                    title="Copier mon UID pour le partager"
                  >
                    {copiedUid ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedUid ? 'Copié' : 'Copier'}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => signOutFirebase()}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5 shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                Déconnexion
              </button>
            </div>

            {/* Active House Sync */}
            {house && (
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      Maison active
                    </div>
                    <div className="text-sm font-bold text-slate-900">{house.name}</div>
                  </div>
                  {syncConfig?.enabled ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Synchronisée
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                      Locale uniquement
                    </span>
                  )}
                </div>

                {syncConfig?.enabled ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onPushLocalToRemote(syncConfig.workspaceId)}
                      className="px-3 py-2 rounded-xl bg-sky-600 text-white text-xs font-medium hover:bg-sky-700 inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Envoyer les données locales
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onDisableSync}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <CloudOff className="w-3.5 h-3.5" />
                      Désactiver la synchro
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCreateAndSync}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 inline-flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Cloud className="w-4 h-4" />
                    Activer le partage cloud pour cette maison
                  </button>
                )}
              </div>
            )}

            {/* Members Management */}
            {activeWorkspace && (
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Users className="w-4 h-4 text-slate-600" />
                  Membres du foyer ({activeWorkspace.memberUids.length}/10)
                </div>
                <div className="space-y-1.5">
                  {activeWorkspace.memberUids.map((uid) => (
                    <div
                      key={uid}
                      className="flex items-center justify-between gap-2 text-xs bg-slate-50 px-3 py-2 rounded-lg"
                    >
                      <span className="font-mono text-slate-700 truncate">
                        {uid}
                        {uid === activeWorkspace.ownerUid ? ' (propriétaire)' : ''}
                        {uid === user.uid ? ' (vous)' : ''}
                      </span>
                      {user.uid === activeWorkspace.ownerUid && uid !== activeWorkspace.ownerUid && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(uid)}
                          className="text-rose-600 hover:text-rose-800 font-medium shrink-0"
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {user.uid === activeWorkspace.ownerUid && (
                  <form onSubmit={handleAddMember} className="flex gap-2">
                    <input
                      type="text"
                      maxLength={128}
                      value={newMemberUid}
                      onChange={(e) => setNewMemberUid(e.target.value)}
                      placeholder="Coller l’UID Firebase du conjoint..."
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs"
                    />
                    <button
                      type="submit"
                      disabled={busy || !newMemberUid.trim()}
                      className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Ajouter
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Existing Shared Workspaces to Join */}
            {workspaces.length > 0 && (
              <div className="border border-slate-200 rounded-xl p-4 space-y-2.5">
                <div className="text-xs font-semibold text-slate-700">
                  Espaces partagés accessibles avec votre compte
                </div>
                <div className="space-y-2">
                  {workspaces.map((ws) => {
                    const isCurrent = syncConfig?.enabled && syncConfig.workspaceId === ws.id;
                    return (
                      <div
                        key={ws.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {ws.name}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">
                            {ws.id} · {ws.memberUids.length} membre(s)
                          </div>
                        </div>
                        {isCurrent ? (
                          <span className="text-[11px] font-semibold text-emerald-700 px-2 py-1">
                            Connecté
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleJoinWorkspace(ws.id)}
                            className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
                          >
                            Relier ici
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
