import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import {
  ArrowRight,
  Check,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  deleteGlobalWhitelistEntry,
  ensureAppInitialized,
  isAppConfigured,
  listAppMembers,
  listGlobalWhitelist,
  migrateGlobalUserToApp,
  normalizeEmail,
  removeAppMember,
  resolveUserAccess,
  ROOT_ADMIN_EMAIL,
  seedInitialGlobalWhitelistIfEmpty,
  setAppMemberRole,
  updateGlobalWhitelistEntry,
  upsertGlobalWhitelistEntry,
  type AccessStatus,
  type HubRole,
  type WhitelistEntry,
} from '../utils/accessControl';

interface AccessControlPanelProps {
  db: Firestore | null | undefined;
  user: User | null;
  appId: string;
  appName: string;
  theme?: 'light' | 'dark';
}

export const AccessControlPanel: React.FC<AccessControlPanelProps> = ({
  db,
  user,
  appId,
  appName,
  theme = 'light',
}) => {
  const isDark = theme === 'dark';

  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [globalList, setGlobalList] = useState<WhitelistEntry[]>([]);
  const [appMembers, setAppMembers] = useState<WhitelistEntry[]>([]);
  const [appActive, setAppActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Add to global form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<HubRole>('user');

  // Edit global entry
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editEmailValue, setEditEmailValue] = useState('');
  const [editNameValue, setEditNameValue] = useState('');
  const [editRoleValue, setEditRoleValue] = useState<HubRole>('user');

  const loadData = useCallback(async () => {
    if (!db || !user?.email) return;
    setLoading(true);
    setError(null);
    try {
      const status = await resolveUserAccess(db, appId, user.email);
      setAccess(status);
      if (!status.isAdmin) {
        setLoading(false);
        return;
      }

      if (status.isGlobalAdmin) {
        await seedInitialGlobalWhitelistIfEmpty(db);
      }

      const [globals, configured, members] = await Promise.all([
        listGlobalWhitelist(db),
        isAppConfigured(db, appId),
        listAppMembers(db, appId),
      ]);
      setGlobalList(globals);
      setAppActive(configured);
      setAppMembers(members);
    } catch (err) {
      setError((err as Error).message || 'Erreur lors du chargement des accès.');
    } finally {
      setLoading(false);
    }
  }, [db, user?.email, appId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!user || !db) return null;
  if (loading && !access) {
    return (
      <div className={`py-6 text-center text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Chargement des accès…
      </div>
    );
  }
  if (!access?.isAdmin) return null;

  const appMemberSet = new Set(appMembers.map((m) => normalizeEmail(m.email)));

  const handleAddGlobal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await upsertGlobalWhitelistEntry(db, {
        email: newEmail,
        displayName: newName,
        role: newRole,
      });
      setNewEmail('');
      setNewName('');
      setNewRole('user');
      setInfo('E-mail ajouté à la whitelist globale.');
      await loadData();
    } catch (err) {
      setError((err as Error).message || "Impossible d'ajouter cet e-mail.");
    } finally {
      setBusy(false);
    }
  };

  const startEditGlobal = (entry: WhitelistEntry) => {
    setEditingEmail(entry.email);
    setEditEmailValue(entry.email);
    setEditNameValue(entry.displayName || '');
    setEditRoleValue(entry.role);
    setError(null);
    setInfo(null);
  };

  const handleSaveEditGlobal = async (oldEmail: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await updateGlobalWhitelistEntry(
        db,
        oldEmail,
        {
          email: editEmailValue,
          displayName: editNameValue,
          role: editRoleValue,
        },
        appId,
      );
      setEditingEmail(null);
      setInfo('Membre global mis à jour.');
      await loadData();
    } catch (err) {
      setError((err as Error).message || 'Impossible de modifier ce membre.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGlobal = async (email: string) => {
    if (!window.confirm(`Supprimer ${email} de la whitelist globale ?`)) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await deleteGlobalWhitelistEntry(db, email);
      if (appMemberSet.has(normalizeEmail(email))) {
        await removeAppMember(db, appId, email).catch(() => {});
      }
      setInfo(`${email} supprimé de la whitelist globale.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message || 'Impossible de supprimer ce membre.');
    } finally {
      setBusy(false);
    }
  };

  const handleMigrateToApp = async (entry: WhitelistEntry) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await migrateGlobalUserToApp(db, appId, appName, user.email || ROOT_ADMIN_EMAIL, entry);
      setInfo(`${entry.email} ajouté à ${appName}.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message || "Impossible d'ajouter ce membre à l'application.");
    } finally {
      setBusy(false);
    }
  };

  const handleActivateAppList = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await ensureAppInitialized(db, appId, appName, user.email || ROOT_ADMIN_EMAIL);
      setInfo(`Liste dédiée activée pour ${appName}.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message || "Impossible d'activer la liste dédiée.");
    } finally {
      setBusy(false);
    }
  };

  const handleChangeAppRole = async (email: string, role: HubRole) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await setAppMemberRole(db, appId, email, role);
      setInfo(`Rôle de ${email} mis à jour (${role === 'admin' ? 'Administrateur' : 'Utilisateur'}).`);
      await loadData();
    } catch (err) {
      setError((err as Error).message || 'Impossible de modifier le rôle.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFromApp = async (email: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await removeAppMember(db, appId, email);
      setInfo(`${email} retiré de ${appName}.`);
      await loadData();
    } catch (err) {
      setError((err as Error).message || "Impossible de retirer ce membre de l'application.");
    } finally {
      setBusy(false);
    }
  };

  const cardClass = isDark
    ? 'rounded-xl border border-slate-700/80 bg-slate-800/70 p-3'
    : 'rounded-xl border border-slate-200 bg-slate-50/80 p-3';
  const rowClass = isDark
    ? 'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-900/60 px-2.5 py-2'
    : 'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-white px-2.5 py-2';
  const inputCls = isDark
    ? 'rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none'
    : 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none';
  const textPrimary = isDark ? 'text-slate-100' : 'text-slate-900';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="space-y-4 text-left">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-sky-500" />
          <span className={`text-xs font-bold uppercase tracking-wide ${textPrimary}`}>
            Accès &amp; Rôles — {appName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading || busy}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ${
            isDark
              ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
          title="Rafraîchir"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-500">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-lg border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-500">
          {info}
        </div>
      )}

      {/* Section 1: Whitelist de l'application */}
      <div className={cardClass}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <UserCheck className="h-3.5 w-3.5 text-emerald-500" />
            <h4 className={`text-xs font-bold ${textPrimary}`}>
              Whitelist de l&apos;application ({appMembers.length})
            </h4>
          </div>
          {!appActive && (
            <button
              type="button"
              disabled={busy}
              onClick={handleActivateAppList}
              className="rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Activer la liste dédiée
            </button>
          )}
        </div>

        {!appActive && (
          <p className={`mb-2 text-[11px] ${textMuted}`}>
            Mode hérité actif : tous les e-mails globaux ont accès. Migrez un membre ci-dessous pour restreindre l&apos;accès à cette application.
          </p>
        )}

        {appMembers.length === 0 ? (
          <p className={`text-xs ${textMuted}`}>Aucun membre spécifique configuré pour cette application.</p>
        ) : (
          <div className="space-y-1.5">
            {appMembers.map((member) => {
              const isRoot = member.email === ROOT_ADMIN_EMAIL;
              return (
                <div key={member.email} className={rowClass}>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-xs font-semibold ${textPrimary}`}>
                      {member.displayName || member.email}
                    </div>
                    {member.displayName && (
                      <div className={`truncate text-[11px] ${textMuted}`}>{member.email}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      aria-label={`Rôle de ${member.email}`}
                      value={member.role}
                      disabled={busy || isRoot}
                      onChange={(e) => void handleChangeAppRole(member.email, e.target.value as HubRole)}
                      className={`${inputCls} py-1 text-[11px]`}
                    >
                      <option value="user">Utilisateur</option>
                      <option value="admin">Administrateur</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy || isRoot}
                      onClick={() => void handleRemoveFromApp(member.email)}
                      title={isRoot ? "Administrateur principal protégé" : "Retirer de l'application"}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                        isRoot
                          ? 'cursor-not-allowed opacity-40'
                          : 'bg-red-500/15 text-red-500 hover:bg-red-500/25'
                      }`}
                    >
                      <X className="h-3 w-3" />
                      Retirer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Whitelist globale */}
      <div className={cardClass}>
        <div className="mb-2 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-sky-500" />
          <h4 className={`text-xs font-bold ${textPrimary}`}>
            Whitelist globale ({globalList.length})
          </h4>
        </div>

        {access.isGlobalAdmin && (
          <form onSubmit={handleAddGlobal} className="mb-3 grid grid-cols-1 gap-1.5 sm:grid-cols-12">
            <input
              type="email"
              required
              placeholder="email@exemple.fr"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={`${inputCls} sm:col-span-5`}
            />
            <input
              type="text"
              placeholder="Nom (optionnel)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={`${inputCls} sm:col-span-3`}
            />
            <select
              aria-label="Rôle global"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as HubRole)}
              className={`${inputCls} sm:col-span-2`}
            >
              <option value="user">Utilisateur</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={busy || !newEmail.trim()}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 sm:col-span-2"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </button>
          </form>
        )}

        <div className="space-y-1.5">
          {globalList.map((entry) => {
            const isRoot = entry.email === ROOT_ADMIN_EMAIL;
            const inApp = appMemberSet.has(entry.email);
            const isEditing = editingEmail === entry.email;

            if (isEditing) {
              return (
                <div key={entry.email} className={`${rowClass} flex-col items-stretch`}>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                    <input
                      type="email"
                      value={editEmailValue}
                      disabled={isRoot}
                      onChange={(e) => setEditEmailValue(e.target.value)}
                      className={inputCls}
                      placeholder="Email"
                    />
                    <input
                      type="text"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      className={inputCls}
                      placeholder="Nom"
                    />
                    <select
                      value={editRoleValue}
                      disabled={isRoot}
                      onChange={(e) => setEditRoleValue(e.target.value as HubRole)}
                      className={inputCls}
                    >
                      <option value="user">Utilisateur</option>
                      <option value="admin">Administrateur</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingEmail(null)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                        isDark ? 'bg-slate-700 text-slate-200' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSaveEditGlobal(entry.email)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                    >
                      <Check className="h-3 w-3" />
                      Enregistrer
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={entry.email} className={rowClass}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-xs font-semibold ${textPrimary}`}>
                      {entry.displayName || entry.email}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        entry.role === 'admin'
                          ? 'bg-amber-500/15 text-amber-500'
                          : isDark
                            ? 'bg-slate-700 text-slate-300'
                            : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {entry.role === 'admin' ? 'Admin' : 'Utilisateur'}
                    </span>
                  </div>
                  {entry.displayName && (
                    <div className={`truncate text-[11px] ${textMuted}`}>{entry.email}</div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {inApp ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-500">
                      <Check className="h-3 w-3" />
                      Dans l&apos;app
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleMigrateToApp(entry)}
                      title="Migrer vers la liste de cette application"
                      className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      <ArrowRight className="h-3 w-3" />
                      Migrer
                    </button>
                  )}

                  {access.isGlobalAdmin && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => startEditGlobal(entry)}
                        title="Modifier"
                        className={`rounded-lg p-1.5 ${
                          isDark
                            ? 'text-slate-300 hover:bg-slate-700'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy || isRoot}
                        onClick={() => void handleDeleteGlobal(entry.email)}
                        title={isRoot ? 'Administrateur principal protégé' : 'Supprimer de la liste globale'}
                        className={`rounded-lg p-1.5 ${
                          isRoot
                            ? 'cursor-not-allowed opacity-30'
                            : 'text-red-500 hover:bg-red-500/15'
                        }`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
