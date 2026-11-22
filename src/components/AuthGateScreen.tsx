import React, { useState } from 'react';
import {
  AlertCircle,
  Box,
  CheckCircle2,
  ClipboardList,
  Home,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  Sparkles,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import {
  formatFirestoreError,
  registerWithEmail,
  resetFirebasePassword,
  signInWithEmail,
  signInWithGoogle,
} from '../utils/firebaseSync';

export interface AuthGateScreenProps {
  mode: 'loading' | 'unauthenticated' | 'unauthorized';
  userEmail?: string | null;
  onSignOut: () => Promise<void>;
  onRetryAccess?: () => Promise<void>;
}

export const AuthGateScreen: React.FC<AuthGateScreenProps> = ({
  mode,
  userEmail,
  onSignOut,
  onRetryAccess,
}) => {
  const [modeState, setModeState] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (isRegister) {
        await registerWithEmail(email, password);
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

  const highlights = [
    {
      icon: Box,
      title: 'Plan 2D & Visite 3D',
      desc: 'Dessine tes pièces, visualise en 3D et simule l’ensoleillement.',
    },
    {
      icon: Sparkles,
      title: 'Home Staging & IA',
      desc: 'Génère des rendus réalistes et importe tes articles déco.',
    },
    {
      icon: ClipboardList,
      title: 'Chantier, Courses & Entretien',
      desc: 'Tâches, budget, prestataires et échéances partagés à 2.',
    },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-sky-50/40 to-slate-100 p-4 sm:p-6">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xl lg:grid-cols-12">
        {/* Panneau éditorial */}
        <div className="relative flex flex-col justify-between bg-gradient-to-br from-slate-950 via-sky-950 to-sky-700 p-7 text-white lg:col-span-6 lg:p-10">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-xs">
                <Home className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-xl font-extrabold tracking-tight">Travaux Maison</p>
                <p className="text-xs text-sky-100/80">Plans 2D/3D, Chantier &amp; Entretien</p>
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
                Conçois tes plans, suis tes travaux et l&apos;entretien du foyer.
              </h1>
              <p className="text-sm text-sky-100/80">
                Synchronisé en temps réel pour le foyer et accessible hors-ligne sur le chantier.
              </p>
            </div>

            <div className="hidden space-y-3 pt-2 lg:block">
              {highlights.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="flex items-start gap-3 rounded-2xl bg-white/10 p-3.5 ring-1 ring-white/10 backdrop-blur-xs"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                      <Icon className="h-4 w-4 text-sky-100" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <p className="text-xs text-sky-100/80">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 hidden items-center gap-2 text-xs text-sky-100/70 lg:flex">
            <WifiOff className="h-3.5 w-3.5" />
            <span>Mode PWA hors-ligne inclus</span>
          </div>
        </div>

        {/* Formulaire */}
        <div className="flex flex-col justify-center p-6 sm:p-8 lg:col-span-6 lg:p-10">
          {mode === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="h-9 w-9 animate-spin rounded-full border-4 border-sky-600 border-t-transparent" />
              <p className="text-sm font-medium text-slate-600">
                Vérification de votre accès…
              </p>
            </div>
          )}

          {mode === 'unauthorized' && (
            <div className="space-y-4">
              <div className="space-y-1.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs leading-relaxed text-rose-800">
                <div className="flex items-center gap-2 text-sm font-bold text-rose-900">
                  <Shield className="h-4 w-4 text-rose-600" />
                  <span>Accès non autorisé</span>
                </div>
                <p>
                  Votre compte n&apos;est pas autorisé à accéder à cette application.
                </p>
                {userEmail && (
                  <p className="break-all text-rose-700">
                    Compte connecté : <span className="font-bold">{userEmail}</span>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {onRetryAccess && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onRetryAccess();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                    Vérifier à nouveau
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onSignOut();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" />
                  Se déconnecter / Changer de compte
                </button>
              </div>
            </div>
          )}

          {mode === 'unauthenticated' && (
            <div>
              <div className="mb-6 space-y-1">
                <h2 className="text-xl font-bold text-slate-900">
                  {modeState === 'login' ? 'Connexion à ton espace' : 'Créer ton compte'}
                </h2>
                <p className="text-sm text-slate-500">
                  Utilise ton compte autorisé pour retrouver tes projets et plans synchronisés.
                </p>
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSignInGoogle}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4" />
                  Continuer avec Google
                </button>

                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>ou par e-mail</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleEmailAuth(modeState === 'register');
                  }}
                  className="space-y-3"
                >
                  <input
                    id="gate-sync-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="adresse@email.com"
                    autoComplete="email"
                    disabled={busy}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                  />

                  <div className="space-y-1.5">
                    <input
                      id="gate-sync-password"
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mot de passe (6+ caractères)"
                      autoComplete={modeState === 'register' ? 'new-password' : 'current-password'}
                      disabled={busy}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
                    />
                    {modeState === 'login' && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleResetPassword}
                          className="text-[11px] font-medium text-sky-600 hover:underline disabled:opacity-50"
                        >
                          Mot de passe oublié ?
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-xs transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {modeState === 'register' ? (
                      <>
                        <UserPlus className="h-4 w-4" />
                        Créer un compte
                      </>
                    ) : (
                      <>
                        <Mail className="h-4 w-4" />
                        Se connecter par e-mail
                      </>
                    )}
                  </button>
                </form>

                <button
                  type="button"
                  className="w-full cursor-pointer pt-1 text-center text-xs font-medium text-slate-500 hover:text-sky-600"
                  onClick={() => {
                    setModeState(modeState === 'login' ? 'register' : 'login');
                    setError(null);
                    setInfo(null);
                  }}
                >
                  {modeState === 'login'
                    ? 'Pas encore de compte ? Créer un compte'
                    : 'Déjà inscrit ? Se connecter'}
                </button>

                {error && (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs font-medium text-rose-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {info && (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{info}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
