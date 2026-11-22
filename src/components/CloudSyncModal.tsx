import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
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
  User as UserIcon,
  Shield,
} from 'lucide-react';
import type { CloudSyncState, House, HouseSyncConfig } from '../types';
import { useEscapeKey } from '../utils/useEscapeKey';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  listShareableAppUsers,
  normalizeEmail,
  resolveUserAccess,
  type AccessStatus,
  type WhitelistEntry,
} from '../utils/accessControl';
import { AccessControlPanel } from './AccessControlPanel';
import {
  ensureRemoteWorkspace,
  formatFirestoreError,
  getFirestoreDb,
  listMyRemoteWorkspaces,
  registerWithEmail,
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
  cloudState: CloudSyncState;
  syncedItemsCount: number;
  onEnableSync: (workspaceId: string) => Promise<void>;
  onDisableSync: () => Promise<void>;
  onForceSync: () => Promise<void>;
  onUserVerified?: (user: User) => Promise<void>;
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  isOpen,
  onClose,
  user,
  house,
  syncConfig,
  cloudState,
  syncedItemsCount,
  onEnableSync,
  onDisableSync,
  onForceSync,
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
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'account' | 'access'>('account');
  const [shareableUsers, setShareableUsers] = useState<WhitelistEntry[]>([]);
  const [uidByEmail, setUidByEmail] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen || !user) {
      setAccessStatus(null);
      setActiveTab('account');
      setShareableUsers([]);
      setUidByEmail({});
      return;
    }
    const db = getFirestoreDb();
    let cancelled = false;
    resolveUserAccess(db, 'travaux-maison', user.email, user.uid)
      .then((status) => {
        if (!cancelled) {
          setAccessStatus(status);
          if (!status.isAdmin) {
            setActiveTab('account');
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccessStatus(null);
          setActiveTab('account');
        }
      });

    listShareableAppUsers(db, 'travaux-maison')
      .then((list) => {
        if (!cancelled) setShareableUsers(list);
      })
      .catch(() => {
        if (!cancelled) setShareableUsers([]);
      });

    if (db) {
      getDocs(collection(db, 'users'))
        .then((snap) => {
          if (cancelled) return;
          const map: Record<string, string> = {};
          snap.forEach((d) => {
            const data = d.data() as { email?: string; uid?: string };
            if (data.email) {
              map[normalizeEmail(data.email)] = data.uid || d.id;
            }
          });
          setUidByEmail(map);
        })
        .catch(() => {
          if (!cancelled) setUidByEmail({});
        });
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, user, user?.email, user?.uid]);

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
  }, [isOpen, user, syncConfig?.workspaceId]);

  if (!isOpen) return null;

  const activeWorkspace = syncConfig?.enabled
    ? workspaces.find((w) => w.id === syncConfig.workspaceId)
    : undefined;

  const handleSignInGoogle = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(formatFirestoreError(err, 'Connexion Google impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailAuth = async (isRegister: boolean) => {
    if (!email.trim() || !password) {
      setError('Veuillez renseigner votre adresse e-mail et votre mot de passe.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (isRegister) {
        await registerWithEmail(email, password);
        setInfo('Compte créé et connecté.');
      } else {
        await signInWithEmail(email, password);
      }
      setPassword('');
    } catch (err) {
      setError(
        formatFirestoreError(
          err,
          isRegister ? 'Impossible de créer le compte.' : 'Connexion par e-mail impossible.'
        )
      );
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
      setError(formatFirestoreError(err, 'Impossible d’envoyer l’e-mail de réinitialisation.'));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!window.confirm('Se déconnecter du compte Cloud ?')) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await signOutFirebase();
      onClose();
    } catch (err) {
      setError(formatFirestoreError(err, 'Impossible de se déconnecter.'));
    } finally {
      setBusy(false);
    }
  };

  const handleForceSync = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await onForceSync();
      if (user) {
        const list = await listMyRemoteWorkspaces(user.uid);
        setWorkspaces(list);
      }
      setInfo('Synchronisation effectuée avec succès.');
    } catch (err) {
      setError(formatFirestoreError(err, 'Impossible de synchroniser maintenant.'));
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
      const list = await listMyRemoteWorkspaces(user.uid);
      setWorkspaces(list);
      setInfo('Synchronisation activée pour cette maison.');
    } catch (err) {
      setError(formatFirestoreError(err, 'Impossible d’activer la synchronisation Firebase.'));
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
      setError(formatFirestoreError(err, 'Impossible de rejoindre cet espace.'));
    } finally {
      setBusy(false);
    }
  };

  const addMemberUidToWorkspace = async (uidToAdd: string) => {
    if (!activeWorkspace || !uidToAdd.trim() || !user) return;
    const trimmed = uidToAdd.trim();
    if (activeWorkspace.memberUids.includes(trimmed)) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const updated = await updateWorkspaceMembers(activeWorkspace.id, [
        ...activeWorkspace.memberUids,
        trimmed,
      ]);
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === activeWorkspace.id ? { ...w, memberUids: updated } : w))
      );
      setNewMemberUid('');
      setInfo('Membre ajouté à l’espace partagé.');
    } catch (err) {
      setError(
        formatFirestoreError(
          err,
          'Impossible d’ajouter ce membre (seul le propriétaire peut modifier les membres).'
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    await addMemberUidToWorkspace(newMemberUid);
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
      setError(formatFirestoreError(err, 'Suppression impossible.'));
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

  const renderSyncStatusText = () => {
    if (cloudState.syncStatus === 'syncing') {
      return <span className="text-amber-600 font-semibold">Synchronisation en cours…</span>;
    }
    if (cloudState.syncStatus === 'error') {
      return <span className="text-rose-600 font-semibold">Erreur de synchronisation</span>;
    }
    if (cloudState.initialSyncDone || cloudState.syncStatus === 'synced') {
      return (
        <span className="text-emerald-700 font-semibold">
          Synchronisé ({syncedItemsCount} élément{syncedItemsCount > 1 ? 's' : ''})
        </span>
      );
    }
    return <span className="text-slate-500">Connexion au Cloud…</span>;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
      <div
        className={`bg-white rounded-2xl shadow-xl w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-5 ${
          activeTab === 'access' ? 'max-w-2xl' : 'max-w-lg'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-slate-900">Compte Cloud & Synchronisation</h2>
              <p className="text-xs text-slate-500">Hub quentin-apps-hub · Sauvegarde & partage Foyer</p>
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
          courses, Équipements d’entretien, Prestataires, Interventions et Préférences.
          <br />
          <strong className="text-slate-800">Données locales uniquement :</strong> Plans 2D/3D, Photos
          WebP, Justificatifs et modèles .GLB (limite 1 Mo/doc Firestore).
        </div>

        {(error || cloudState.syncError) && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error || cloudState.syncError}</span>
          </div>
        )}

        {info && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
            {info}
          </div>
        )}

        {!user ? (
          <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
            <p className="text-sm text-slate-600">
              Connectez-vous pour synchroniser vos tâches, courses et entretiens entre vos appareils
              et partager votre maison.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleEmailAuth(false);
              }}
              className="space-y-3"
            >
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
                  placeholder="prenom@exemple.fr"
                  autoComplete="email"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label htmlFor="cloud-sync-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Mot de passe (6 car. min)
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

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
                >
                  <LogIn className="w-4 h-4" />
                  Se connecter
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleEmailAuth(true)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                >
                  <UserPlus className="w-4 h-4" />
                  Créer un compte
                </button>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleResetPassword}
                  className="text-xs text-sky-600 hover:text-sky-800 disabled:opacity-50"
                >
                  Mot de passe oublié ?
                </button>
              </div>
            </form>

            <div className="relative flex items-center py-1">
              <div className="grow border-t border-slate-200" />
              <span className="shrink mx-3 text-xs text-slate-400">ou</span>
              <div className="grow border-t border-slate-200" />
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleSignInGoogle}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              Continuer avec Google
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {accessStatus && !accessStatus.hasAppAccess && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs font-medium text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Votre compte n&apos;est pas autorisé sur cette application. Contactez un
                  administrateur.
                </span>
              </div>
            )}

            {accessStatus?.isAdmin && (
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('account')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'account'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  Compte Cloud
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('access')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'access'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  Accès &amp; Rôles
                </button>
              </div>
            )}

            {accessStatus?.isAdmin && activeTab === 'access' ? (
              <AccessControlPanel
                db={getFirestoreDb()}
                user={user}
                appId="travaux-maison"
                appName="Travaux Maison"
                theme="light"
              />
            ) : (
              <>
            {/* Connected User & Sync Status */}
            <div className="border border-slate-200 bg-slate-50/70 rounded-xl p-3.5 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Connecté en tant que
                  </div>
                  <div className="text-sm font-bold text-slate-900 break-all flex items-center gap-1.5 mt-0.5">
                    <UserIcon className="w-4 h-4 text-sky-600 shrink-0" />
                    <span>{user.email || user.displayName || user.uid}</span>
                  </div>
                  <div className="text-xs mt-1.5">{renderSyncStatusText()}</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200/80">
                <code className="text-[11px] bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-700 truncate max-w-[240px]">
                  UID: {user.uid}
                </code>
                <button
                  type="button"
                  onClick={handleCopyUid}
                  className="text-xs text-sky-600 hover:text-sky-800 inline-flex items-center gap-1"
                  title="Copier mon UID pour le partager"
                >
                  {copiedUid ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedUid ? 'Copié' : 'Copier UID'}
                </button>
              </div>
            </div>

            {/* Primary Cloud Actions (Synchroniser maintenant / Se déconnecter) */}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleForceSync}
                className="flex-1 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${busy || cloudState.syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                Synchroniser maintenant
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSignOut}
                className="px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-100 inline-flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                Se déconnecter
              </button>
            </div>

            {/* Active House Sync & Sharing */}
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
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-slate-500 font-mono truncate">
                      Espace : {syncConfig.workspaceId}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onDisableSync}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <CloudOff className="w-3.5 h-3.5" />
                      Suspendre pour cette maison
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
                    Activer la synchronisation pour cette maison
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
                {shareableUsers.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-600">
                      Membres autorisés sur l&apos;application
                    </div>
                    <div className="space-y-1">
                      {shareableUsers.map((entry) => {
                        const knownUid = uidByEmail[normalizeEmail(entry.email)];
                        const alreadyMember = Boolean(
                          knownUid && activeWorkspace.memberUids.includes(knownUid)
                        );
                        const canQuickAdd =
                          user.uid === activeWorkspace.ownerUid &&
                          Boolean(knownUid) &&
                          !alreadyMember &&
                          activeWorkspace.memberUids.length < 10;

                        return (
                          <div
                            key={entry.email}
                            className="flex items-center justify-between gap-2 text-xs bg-slate-50/80 px-2.5 py-1.5 rounded-lg"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-slate-800 truncate">
                                {entry.displayName || entry.email}
                              </div>
                              {entry.displayName && (
                                <div className="text-[10px] text-slate-500 truncate">
                                  {entry.email}
                                </div>
                              )}
                            </div>
                            <div className="shrink-0">
                              {alreadyMember ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                  Déjà membre
                                </span>
                              ) : canQuickAdd && knownUid ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => addMemberUidToWorkspace(knownUid)}
                                  className="px-2 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-medium hover:bg-slate-800 disabled:opacity-50"
                                >
                                  + Ajouter au foyer
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-500">
                                  {knownUid ? 'Non membre' : 'UID inconnu'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
