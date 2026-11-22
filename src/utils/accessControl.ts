import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

export type HubRole = 'admin' | 'user';

export interface WhitelistEntry {
  email: string;
  displayName?: string;
  role: HubRole;
  createdAt?: string;
  addedAt?: string;
  updatedAt?: string;
}

export interface AccessStatus {
  isGlobalAdmin: boolean;
  isAppAdmin: boolean;
  isAdmin: boolean;
  hasAppAccess: boolean;
  appConfigured: boolean;
  role: HubRole | null;
}

export const ROOT_ADMIN_EMAIL = 'quentin.vaslin@gmail.com';

export const INITIAL_GLOBAL_WHITELIST: Array<{ email: string; displayName: string; role: HubRole }> = [
  { email: 'quentin.vaslin@gmail.com', displayName: 'Quentin', role: 'admin' },
  { email: 'vaslin.pascal@wanadoo.fr', displayName: 'Pascal', role: 'user' },
  { email: 'pa.vaslin@bouygues-construction.com', displayName: 'PA Vaslin', role: 'user' },
  { email: 'clementvaslin@gmail.com', displayName: 'Clément', role: 'user' },
  { email: 'delisle-margaux@hotmail.com', displayName: 'Margaux', role: 'user' },
  { email: 'mar9aux-delisle@hotmail.fr', displayName: 'Margaux (alt)', role: 'user' },
];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
}

export async function resolveUserAccess(
  db: Firestore | null | undefined,
  appId: string,
  userEmail: string | null | undefined,
): Promise<AccessStatus> {
  const email = userEmail ? normalizeEmail(userEmail) : '';
  if (!db || !email) {
    return {
      isGlobalAdmin: false,
      isAppAdmin: false,
      isAdmin: false,
      hasAppAccess: false,
      appConfigured: false,
      role: null,
    };
  }

  const isRoot = email === ROOT_ADMIN_EMAIL;

  let isGlobalAdmin = isRoot;
  let inGlobal = isRoot;

  try {
    const globalSnap = await getDoc(doc(db, 'hub_global_whitelist', email));
    if (globalSnap.exists()) {
      inGlobal = true;
      const data = globalSnap.data() as Partial<WhitelistEntry>;
      if (data.role === 'admin') {
        isGlobalAdmin = true;
      }
    }
  } catch {
    // Ignore if rules/offline prevent read
  }

  let appConfigured = false;
  try {
    const appSnap = await getDoc(doc(db, 'hub_apps', appId));
    appConfigured = appSnap.exists();
  } catch {
    appConfigured = false;
  }

  let isAppAdmin = isGlobalAdmin;
  let inApp = isGlobalAdmin;

  try {
    const memberSnap = await getDoc(doc(db, 'hub_apps', appId, 'members', email));
    if (memberSnap.exists()) {
      inApp = true;
      const data = memberSnap.data() as Partial<WhitelistEntry>;
      if (data.role === 'admin') {
        isAppAdmin = true;
      }
    }
  } catch {
    // Not a member or offline
  }

  const isAdmin = isGlobalAdmin || isAppAdmin;
  const hasAppAccess = isAdmin || (appConfigured ? inApp : inGlobal || INITIAL_GLOBAL_WHITELIST.some((u) => u.email === email));

  return {
    isGlobalAdmin,
    isAppAdmin,
    isAdmin,
    hasAppAccess,
    appConfigured,
    role: isAdmin ? 'admin' : hasAppAccess ? 'user' : null,
  };
}

export async function seedInitialGlobalWhitelistIfEmpty(db: Firestore): Promise<boolean> {
  const colRef = collection(db, 'hub_global_whitelist');
  const snap = await getDocs(colRef);
  if (!snap.empty) return false;

  const now = new Date().toISOString();
  const batch = writeBatch(db);
  for (const item of INITIAL_GLOBAL_WHITELIST) {
    batch.set(doc(db, 'hub_global_whitelist', item.email), {
      email: item.email,
      displayName: item.displayName,
      role: item.role,
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return true;
}

export async function listGlobalWhitelist(db: Firestore): Promise<WhitelistEntry[]> {
  const snap = await getDocs(collection(db, 'hub_global_whitelist'));
  const items: WhitelistEntry[] = [];
  snap.forEach((d) => {
    const data = d.data() as Partial<WhitelistEntry>;
    items.push({
      email: normalizeEmail(data.email || d.id),
      displayName: data.displayName || '',
      role: data.role === 'admin' ? 'admin' : 'user',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  });
  return items.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
}

export async function upsertGlobalWhitelistEntry(
  db: Firestore,
  entry: { email: string; displayName?: string; role: HubRole },
): Promise<void> {
  const email = normalizeEmail(entry.email);
  if (!isValidEmailFormat(email)) {
    throw new Error('Adresse e-mail invalide.');
  }
  const now = new Date().toISOString();
  const ref = doc(db, 'hub_global_whitelist', email);
  const existing = await getDoc(ref);
  const role: HubRole = email === ROOT_ADMIN_EMAIL ? 'admin' : entry.role;
  await setDoc(
    ref,
    {
      email,
      displayName: (entry.displayName || '').trim() || null,
      role,
      createdAt: existing.exists() ? existing.data()?.createdAt || now : now,
      updatedAt: now,
    },
    { merge: true },
  );
}

export async function updateGlobalWhitelistEntry(
  db: Firestore,
  oldEmail: string,
  next: { email: string; displayName?: string; role: HubRole },
  appId?: string,
): Promise<void> {
  const prevEmail = normalizeEmail(oldEmail);
  const newEmail = normalizeEmail(next.email);
  if (!isValidEmailFormat(newEmail)) {
    throw new Error('Adresse e-mail invalide.');
  }
  if (prevEmail === ROOT_ADMIN_EMAIL && newEmail !== ROOT_ADMIN_EMAIL) {
    throw new Error("L'adresse de l'administrateur principal ne peut pas être modifiée.");
  }

  const now = new Date().toISOString();
  const role: HubRole = newEmail === ROOT_ADMIN_EMAIL ? 'admin' : next.role;
  const displayName = (next.displayName || '').trim() || null;

  if (prevEmail === newEmail) {
    await setDoc(
      doc(db, 'hub_global_whitelist', prevEmail),
      { email: prevEmail, displayName, role, updatedAt: now },
      { merge: true },
    );
    return;
  }

  const oldRef = doc(db, 'hub_global_whitelist', prevEmail);
  const oldSnap = await getDoc(oldRef);
  const createdAt = oldSnap.exists() ? oldSnap.data()?.createdAt || now : now;

  await setDoc(doc(db, 'hub_global_whitelist', newEmail), {
    email: newEmail,
    displayName,
    role,
    createdAt,
    updatedAt: now,
  });
  await deleteDoc(oldRef);

  if (appId) {
    const oldMemberRef = doc(db, 'hub_apps', appId, 'members', prevEmail);
    const oldMemberSnap = await getDoc(oldMemberRef);
    if (oldMemberSnap.exists()) {
      const mData = oldMemberSnap.data() as Partial<WhitelistEntry>;
      await setDoc(doc(db, 'hub_apps', appId, 'members', newEmail), {
        email: newEmail,
        displayName,
        role: mData.role === 'admin' ? 'admin' : 'user',
        addedAt: mData.addedAt || now,
        updatedAt: now,
      });
      await deleteDoc(oldMemberRef);
    }
  }
}

export async function deleteGlobalWhitelistEntry(db: Firestore, email: string): Promise<void> {
  const target = normalizeEmail(email);
  if (target === ROOT_ADMIN_EMAIL) {
    throw new Error("Impossible de supprimer l'administrateur principal.");
  }
  await deleteDoc(doc(db, 'hub_global_whitelist', target));
}

export async function isAppConfigured(db: Firestore, appId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'hub_apps', appId));
  return snap.exists();
}

export async function listAppMembers(db: Firestore, appId: string): Promise<WhitelistEntry[]> {
  const snap = await getDocs(collection(db, 'hub_apps', appId, 'members'));
  const items: WhitelistEntry[] = [];
  snap.forEach((d) => {
    const data = d.data() as Partial<WhitelistEntry>;
    items.push({
      email: normalizeEmail(data.email || d.id),
      displayName: data.displayName || '',
      role: data.role === 'admin' ? 'admin' : 'user',
      addedAt: data.addedAt,
      updatedAt: data.updatedAt,
    });
  });
  return items.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
}

export async function ensureAppInitialized(
  db: Firestore,
  appId: string,
  appName: string,
  adminEmail: string,
): Promise<void> {
  const now = new Date().toISOString();
  const appRef = doc(db, 'hub_apps', appId);
  const appSnap = await getDoc(appRef);
  if (!appSnap.exists()) {
    await setDoc(appRef, {
      appId,
      name: appName,
      updatedAt: now,
      updatedBy: normalizeEmail(adminEmail),
    });
  }
  const rootMemberRef = doc(db, 'hub_apps', appId, 'members', ROOT_ADMIN_EMAIL);
  const rootSnap = await getDoc(rootMemberRef);
  if (!rootSnap.exists()) {
    await setDoc(rootMemberRef, {
      email: ROOT_ADMIN_EMAIL,
      displayName: 'Quentin',
      role: 'admin',
      addedAt: now,
      updatedAt: now,
    });
  }
}

export async function migrateGlobalUserToApp(
  db: Firestore,
  appId: string,
  appName: string,
  adminEmail: string,
  entry: { email: string; displayName?: string; role?: HubRole },
): Promise<void> {
  const email = normalizeEmail(entry.email);
  if (!isValidEmailFormat(email)) {
    throw new Error('Adresse e-mail invalide.');
  }
  await ensureAppInitialized(db, appId, appName, adminEmail);
  const now = new Date().toISOString();
  const role: HubRole = email === ROOT_ADMIN_EMAIL ? 'admin' : entry.role === 'admin' ? 'admin' : 'user';
  await setDoc(
    doc(db, 'hub_apps', appId, 'members', email),
    {
      email,
      displayName: (entry.displayName || '').trim() || null,
      role,
      addedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
}

export async function setAppMemberRole(
  db: Firestore,
  appId: string,
  email: string,
  role: HubRole,
): Promise<void> {
  const target = normalizeEmail(email);
  if (target === ROOT_ADMIN_EMAIL && role !== 'admin') {
    throw new Error("L'administrateur principal reste toujours Administrateur.");
  }
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'hub_apps', appId, 'members', target),
    { role, updatedAt: now },
    { merge: true },
  );
}

export async function removeAppMember(
  db: Firestore,
  appId: string,
  email: string,
): Promise<void> {
  const target = normalizeEmail(email);
  if (target === ROOT_ADMIN_EMAIL) {
    throw new Error("Impossible de retirer l'administrateur principal.");
  }
  await deleteDoc(doc(db, 'hub_apps', appId, 'members', target));
}

export async function listShareableAppUsers(
  db: Firestore | null | undefined,
  appId: string,
): Promise<WhitelistEntry[]> {
  if (!db) return [];
  try {
    const configured = await isAppConfigured(db, appId);
    if (configured) {
      return await listAppMembers(db, appId);
    }
    const globals = await listGlobalWhitelist(db);
    if (globals.length > 0) return globals;
    return INITIAL_GLOBAL_WHITELIST.map((u) => ({ ...u }));
  } catch {
    return [];
  }
}
