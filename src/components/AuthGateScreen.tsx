import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Lock,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  UserPlus,
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

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 rounded-full border-4 border-sky-600 border-t-transparent animate-spin" />
        <p className="mt-4 text-sm font-medium text-slate-600">
          Vérification de votre accès…
        </p>
      </div>
    );
  }

  if (mode === 'unauthorized') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-slate-900">Accès non autorisé</h1>
              <p className="text-xs text-slate-500">Travaux Maison · Hub quentin-apps-hub</p>
            </div>
          </div>

          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-800 space-y-1.5 leading-relaxed">
            <p className="font-semibold">
              Votre compte n&apos;est pas autorisé à accéder à cette application.
            </p>
            {userEmail && (
              <p className="break-all text-rose-700">
                Compte connecté : <span className="font-bold">{userEmail}</span>
              </p>
            )}
            <p className="text-rose-700/90">
              Contactez un administrateur pour demander l&apos;accès ou connectez-vous avec un
              autre compte autorisé.
            </p>
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
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
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
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
            >
              <LogOut className="w-4 h-4" />
              Se déconnecter / Changer de compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
          <div className="w-11 h-11 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <Cloud className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-slate-900">Travaux Maison</h1>
            <p className="text-xs text-slate-500">
              Connexion requise pour accéder à l&apos;application
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleEmailAuth(false);
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="gate-sync-email" className="block text-xs font-medium text-slate-700 mb-1">
              Adresse e-mail
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="gate-sync-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom@exemple.fr"
                autoComplete="email"
                disabled={busy}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="gate-sync-password" className="block text-xs font-medium text-slate-700">
                Mot de passe (6 car. min)
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={handleResetPassword}
                className="text-xs text-sky-600 hover:text-sky-800 disabled:opacity-50"
              >
                Mot de passe oublié ?
              </button>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="gate-sync-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={busy}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{info}</span>
            </div>
          )}

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
    </div>
  );
};
