import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  getFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  AppSettings,
  CloudSyncState,
  MaintenanceEquipment,
  MaintenanceIntervention,
  ServiceProvider,
  ShoppingItem,
  TaskItem,
} from '../types';
import { clearAuthCache } from './accessControl';

export const FIREBASE_CONFIG = {
  projectId: 'quentin-apps-hub',
  appId: '1:249016348389:web:59deb2bca6520d029cee0c',
  storageBucket: 'quentin-apps-hub.firebasestorage.app',
  apiKey: 'AIzaSyCuYM0tMpd1f1jDYz27OhCaPpcAWhI3i48',
  authDomain: 'quentin-apps-hub.firebaseapp.com',
  messagingSenderId: '249016348389',
};

const WORKSPACE_COLLECTION = 'travaux_houses';
export const LAST_UID_KEY = 'travaux_maison_last_uid';
const BATCH_CHUNK_SIZE = 450;

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let activeListeners: Unsubscribe[] = [];

export const cloudState: CloudSyncState = {
  initialSyncDone: false,
  syncedCols: {},
  syncStatus: 'idle',
  syncError: null,
  lastSyncedAt: null,
};

const cloudStateSubscribers = new Set<(state: CloudSyncState) => void>();

function notifyCloudState(): void {
  const snapshot: CloudSyncState = {
    ...cloudState,
    syncedCols: { ...cloudState.syncedCols },
  };
  cloudStateSubscribers.forEach((cb) => cb(snapshot));
}

export function subscribeCloudState(cb: (state: CloudSyncState) => void): () => void {
  cloudStateSubscribers.add(cb);
  cb({ ...cloudState, syncedCols: { ...cloudState.syncedCols } });
  return () => {
    cloudStateSubscribers.delete(cb);
  };
}

export function updateCloudState(patch: Partial<CloudSyncState>): void {
  Object.assign(cloudState, patch);
  notifyCloudState();
}

export function reinitialiserEtatCloud(): void {
  cloudState.initialSyncDone = false;
  cloudState.syncedCols = {};
  cloudState.syncStatus = 'idle';
  cloudState.syncError = null;
  cloudState.lastSyncedAt = null;
  notifyCloudState();
}

export function formatFirestoreError(err: unknown, fallback = 'Erreur de synchronisation Firestore'): string {
  const code = (err as { code?: string })?.code;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (
    code === 'permission-denied' ||
    msg.toLowerCase().includes('missing or insufficient permissions') ||
    msg.toLowerCase().includes('permission-denied')
  ) {
    return 'Accès Firestore refusé (vérifiez que votre compte est autorisé).';
  }
  return msg || fallback;
}

export function cleanForFirestore<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (v === undefined ? null : v))
  ) as T;
}

function tryInitFirebase(): { app: FirebaseApp; auth: Auth; firestore: Firestore } | null {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return null;
  }
  try {
    if (!appInstance) {
      const existing = getApps();
      appInstance = existing.length > 0 ? existing[0] : initializeApp(FIREBASE_CONFIG);
      const appCheckSiteKey =
        (import.meta as unknown as { env?: Record<string, string | undefined> }).env
          ?.VITE_FIREBASE_APPCHECK_SITE_KEY || '6LfRaysuAAAAACpC4hKbGG5Bjpr3Ifr1CyUSlmRe';
      if (appCheckSiteKey && typeof window !== 'undefined') {
        initializeAppCheck(appInstance, {
          provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      }
    }
    if (!authInstance) {
      authInstance = getAuth(appInstance);
    }
    if (!dbInstance) {
      try {
        dbInstance = initializeFirestore(appInstance, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
          ignoreUndefinedProperties: true,
        });
      } catch {
        dbInstance = getFirestore(appInstance);
      }
    }
    return { app: appInstance, auth: authInstance, firestore: dbInstance };
  } catch (err) {
    console.warn('Firebase SDK indisponible (mode hors-ligne local):', err);
    return null;
  }
}

function ensureFirebase(): { app: FirebaseApp; auth: Auth; firestore: Firestore } {
  const inst = tryInitFirebase();
  if (!inst) {
    throw new Error('Firebase indisponible hors-ligne.');
  }
  return inst;
}

export function getFirebaseApp(): FirebaseApp {
  return ensureFirebase().app;
}

export function getFirebaseAuth(): Auth {
  return ensureFirebase().auth;
}

export function getFirestoreDb(): Firestore | null {
  return tryInitFirebase()?.firestore ?? null;
}

export function subscribeAuth(callback: (user: User | null) => void): Unsubscribe {
  const inst = tryInitFirebase();
  if (!inst) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(inst.auth, callback);
}

export async function signInWithGoogle(): Promise<User> {
  const { auth } = ensureFirebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const { auth } = ensureFirebase();
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function registerWithEmail(email: string, password: string): Promise<User> {
  const { auth } = ensureFirebase();
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (cred.user) {
    sendEmailVerification(cred.user).catch(() => {});
  }
  return cred.user;
}

export async function resetFirebasePassword(email: string): Promise<void> {
  const { auth } = ensureFirebase();
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerificationEmail(): Promise<boolean> {
  const { auth } = ensureFirebase();
  if (!auth.currentUser) throw new Error('Aucun utilisateur connecté.');
  if (auth.currentUser.emailVerified) return false;
  await sendEmailVerification(auth.currentUser);
  return true;
}

export async function reloadFirebaseUser(): Promise<User | null> {
  const inst = tryInitFirebase();
  if (!inst || !inst.auth.currentUser) return null;
  await inst.auth.currentUser.reload();
  await inst.auth.currentUser.getIdToken(true);
  return inst.auth.currentUser;
}

export function stopAllFirestoreListeners(): void {
  activeListeners.forEach((unsub) => {
    try {
      unsub();
    } catch {
      // ignore
    }
  });
  activeListeners = [];
}

export async function signOutFirebase(): Promise<void> {
  clearAuthCache('travaux-maison');
  stopAllFirestoreListeners();
  reinitialiserEtatCloud();
  const inst = tryInitFirebase();
  if (!inst) return;
  await signOut(inst.auth);
}

export interface RemoteWorkspaceSummary {
  id: string;
  name: string;
  description?: string;
  ownerUid: string;
  memberUids: string[];
}

export async function listMyRemoteWorkspaces(uid: string): Promise<RemoteWorkspaceSummary[]> {
  const { firestore } = ensureFirebase();
  const q = query(
    collection(firestore, WORKSPACE_COLLECTION),
    where('memberUids', 'array-contains', uid)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      description: typeof data.description === 'string' ? data.description : undefined,
      ownerUid: String(data.ownerUid ?? ''),
      memberUids: Array.isArray(data.memberUids) ? data.memberUids.map(String) : [],
    };
  });
}

export async function ensureRemoteWorkspace(
  workspaceId: string,
  name: string,
  description?: string
): Promise<RemoteWorkspaceSummary> {
  const { auth, firestore } = ensureFirebase();
  const user = auth.currentUser;
  if (!user) throw new Error('Utilisateur non connecté à Firebase.');

  const ref = doc(firestore, WORKSPACE_COLLECTION, workspaceId);
  const snap = await getDoc(ref);
  const now = Timestamp.now();

  if (snap.exists()) {
    const data = snap.data();
    return {
      id: snap.id,
      name: String(data.name ?? name),
      description: typeof data.description === 'string' ? data.description : undefined,
      ownerUid: String(data.ownerUid ?? user.uid),
      memberUids: Array.isArray(data.memberUids) ? data.memberUids.map(String) : [user.uid],
    };
  }

  const safeName = (name.trim() || 'Ma Maison').slice(0, 120);
  const safeDesc = description ? description.slice(0, 1000) : undefined;
  const payload = {
    ownerUid: user.uid,
    memberUids: [user.uid],
    name: safeName,
    ...(safeDesc ? { description: safeDesc } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, payload);
  return {
    id: workspaceId,
    name: safeName,
    description: safeDesc,
    ownerUid: user.uid,
    memberUids: [user.uid],
  };
}

export async function updateWorkspaceMembers(
  workspaceId: string,
  memberUids: string[]
): Promise<string[]> {
  const { auth, firestore } = ensureFirebase();
  const user = auth.currentUser;
  if (!user) throw new Error('Utilisateur non connecté.');

  const ref = doc(firestore, WORKSPACE_COLLECTION, workspaceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Espace partagé introuvable.');
  const data = snap.data();
  const ownerUid = String(data.ownerUid ?? '');
  const cleanMembers = Array.from(
    new Set([ownerUid, ...memberUids.map((m) => m.trim()).filter(Boolean)])
  ).slice(0, 10);

  await setDoc(
    ref,
    {
      ownerUid,
      memberUids: cleanMembers,
      name: String(data.name ?? 'Ma Maison').slice(0, 120),
      ...(typeof data.description === 'string' ? { description: data.description } : {}),
      createdAt: data.createdAt ?? Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: false }
  );
  return cleanMembers;
}

export type SyncSubcollection =
  | 'tasks'
  | 'shopping_items'
  | 'maintenance_equipments'
  | 'maintenance_providers'
  | 'maintenance_interventions';

export const SYNC_SUBCOLLECTIONS: SyncSubcollection[] = [
  'tasks',
  'shopping_items',
  'maintenance_equipments',
  'maintenance_providers',
  'maintenance_interventions',
];

function buildWorkspaceItemDoc(
  userUid: string,
  existingData: Record<string, unknown> | null,
  fields: {
    title?: string;
    notes?: string;
    status?: string;
    amount?: number;
    tags?: string[];
    payload: Record<string, unknown>;
  }
): Record<string, unknown> {
  const now = Timestamp.now();
  const createdBy = existingData?.createdBy ? String(existingData.createdBy) : userUid;
  const createdAt = existingData?.createdAt ?? now;

  const docData: Record<string, unknown> = {
    createdBy,
    createdAt,
    updatedAt: now,
    payload: cleanForFirestore(fields.payload),
  };
  if (fields.title !== undefined && fields.title !== null) {
    docData.title = String(fields.title).slice(0, 200);
  }
  if (fields.notes !== undefined && fields.notes !== null) {
    docData.notes = String(fields.notes).slice(0, 5000);
  }
  if (fields.status !== undefined && fields.status !== null && String(fields.status).length >= 1) {
    docData.status = String(fields.status).slice(0, 40);
  }
  if (typeof fields.amount === 'number' && Number.isFinite(fields.amount)) {
    docData.amount = fields.amount;
  }
  if (Array.isArray(fields.tags)) {
    docData.tags = fields.tags.slice(0, 20);
  }
  return docData;
}

async function commitBatchOperations(
  firestore: Firestore,
  ops: Array<{ type: 'set'; ref: DocumentReference; data: Record<string, unknown> } | { type: 'delete'; ref: DocumentReference }>
): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_CHUNK_SIZE) {
    const chunk = ops.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(firestore);
    for (const op of chunk) {
      if (op.type === 'set') {
        batch.set(op.ref, op.data);
      } else {
        batch.delete(op.ref);
      }
    }
    await batch.commit();
  }
}

export interface WorkspaceSnapshotPayload {
  tasks: TaskItem[];
  shoppingItems: ShoppingItem[];
  equipments: MaintenanceEquipment[];
  providers: ServiceProvider[];
  interventions: MaintenanceIntervention[];
  settings?: AppSettings;
}

export async function syncAllHouseDataToFirestore(
  workspaceId: string,
  data: WorkspaceSnapshotPayload
): Promise<void> {
  const { auth, firestore } = ensureFirebase();
  const user = auth.currentUser;
  if (!user) throw new Error('Non connecté au Cloud.');

  await ensureRemoteWorkspace(workspaceId, 'Ma Maison');

  const collectionsToSync: Array<{
    subcol: SyncSubcollection;
    items: Array<{
      id: string;
      fields: {
        title?: string;
        notes?: string;
        status?: string;
        amount?: number;
        tags?: string[];
        payload: Record<string, unknown>;
      };
    }>;
  }> = [
    {
      subcol: 'tasks',
      items: data.tasks
        .filter((t) => t && t.id)
        .map((t) => ({
          id: String(t.id),
          fields: {
            title: t.title,
            notes: t.description,
            status: t.status,
            payload: { ...t, id: String(t.id) },
          },
        })),
    },
    {
      subcol: 'shopping_items',
      items: data.shoppingItems
        .filter((s) => s && s.id)
        .map((s) => ({
          id: String(s.id),
          fields: {
            title: s.name,
            status: s.checked ? 'checked' : 'pending',
            amount: s.estimatedPrice,
            payload: { ...s, id: String(s.id) },
          },
        })),
    },
    {
      subcol: 'maintenance_equipments',
      items: data.equipments
        .filter((eq) => eq && eq.id)
        .map((eq) => ({
          id: String(eq.id),
          fields: {
            title: eq.name,
            notes: eq.notes,
            status: eq.category,
            amount: eq.estimatedAnnualCost,
            payload: { ...eq, id: String(eq.id) },
          },
        })),
    },
    {
      subcol: 'maintenance_providers',
      items: data.providers
        .filter((p) => p && p.id)
        .map((p) => ({
          id: String(p.id),
          fields: {
            title: p.companyName,
            notes: p.notes,
            payload: { ...p, id: String(p.id) },
          },
        })),
    },
    {
      subcol: 'maintenance_interventions',
      items: data.interventions
        .filter((inter) => inter && inter.id)
        .map((inter) => ({
          id: String(inter.id),
          fields: {
            title: inter.title,
            notes: inter.notes,
            amount: inter.cost,
            payload: { ...inter, id: String(inter.id) },
          },
        })),
    },
  ];

  const ops: Array<
    | { type: 'set'; ref: DocumentReference; data: Record<string, unknown> }
    | { type: 'delete'; ref: DocumentReference }
  > = [];

  for (const { subcol, items } of collectionsToSync) {
    const colRef = collection(firestore, WORKSPACE_COLLECTION, workspaceId, subcol);
    const existingSnap = await getDocs(colRef);
    const existingById = new Map<string, Record<string, unknown>>();
    existingSnap.docs.forEach((d) => {
      existingById.set(d.id, d.data());
    });

    const currentIds = new Set(items.map((i) => i.id));
    existingSnap.docs.forEach((d) => {
      if (!currentIds.has(d.id)) {
        ops.push({ type: 'delete', ref: d.ref });
      }
    });

    items.forEach((item) => {
      const ref = doc(colRef, item.id);
      const docData = buildWorkspaceItemDoc(
        user.uid,
        existingById.get(item.id) ?? null,
        item.fields
      );
      ops.push({ type: 'set', ref, data: docData });
    });
  }

  await commitBatchOperations(firestore, ops);

  if (data.settings) {
    await saveUserSettingsToFirestore(data.settings);
  }
}

export async function saveUserSettingsToFirestore(settings: AppSettings): Promise<void> {
  const inst = tryInitFirebase();
  if (!inst || !inst.auth.currentUser) return;
  const uid = inst.auth.currentUser.uid;
  const ref = doc(inst.firestore, 'users', uid, 'settings', 'main');
  const existing = await getDoc(ref);
  const now = Timestamp.now();
  const createdAt = existing.exists() && existing.data()?.createdAt ? existing.data().createdAt : now;

  // On ne pousse jamais la clé API Gemini privée dans le cloud, uniquement comfyUiUrl
  await setDoc(ref, {
    createdAt,
    updatedAt: now,
    title: 'travaux-maison-settings',
    payload: cleanForFirestore({
      comfyUiUrl: settings.comfyUiUrl || '',
      updatedAtIso: new Date().toISOString(),
    }),
  });
}

async function upsertWorkspaceItem(
  workspaceId: string,
  subcol: SyncSubcollection,
  itemId: string,
  fields: {
    title?: string;
    notes?: string;
    status?: string;
    amount?: number;
    tags?: string[];
    payload: Record<string, unknown>;
  }
): Promise<void> {
  const { auth, firestore } = ensureFirebase();
  const user = auth.currentUser;
  if (!user) return;

  const ref = doc(firestore, WORKSPACE_COLLECTION, workspaceId, subcol, String(itemId));
  const existing = await getDoc(ref);
  const existingData = existing.exists() ? existing.data() : null;
  const docData = buildWorkspaceItemDoc(user.uid, existingData, fields);
  await setDoc(ref, docData);
}

async function deleteWorkspaceItem(
  workspaceId: string,
  subcol: SyncSubcollection,
  itemId: string
): Promise<void> {
  const { auth, firestore } = ensureFirebase();
  if (!auth.currentUser) return;
  const ref = doc(firestore, WORKSPACE_COLLECTION, workspaceId, subcol, String(itemId));
  await deleteDoc(ref);
}

export function pushTaskRemote(workspaceId: string, task: TaskItem): Promise<void> {
  return upsertWorkspaceItem(workspaceId, 'tasks', task.id, {
    title: task.title,
    notes: task.description,
    status: task.status,
    payload: { ...task, id: String(task.id) },
  });
}

export function deleteTaskRemote(workspaceId: string, taskId: string): Promise<void> {
  return deleteWorkspaceItem(workspaceId, 'tasks', taskId);
}

export function pushShoppingRemote(workspaceId: string, item: ShoppingItem): Promise<void> {
  return upsertWorkspaceItem(workspaceId, 'shopping_items', item.id, {
    title: item.name,
    status: item.checked ? 'checked' : 'pending',
    amount: item.estimatedPrice,
    payload: { ...item, id: String(item.id) },
  });
}

export function deleteShoppingRemote(workspaceId: string, itemId: string): Promise<void> {
  return deleteWorkspaceItem(workspaceId, 'shopping_items', itemId);
}

export function pushEquipmentRemote(
  workspaceId: string,
  eq: MaintenanceEquipment
): Promise<void> {
  return upsertWorkspaceItem(workspaceId, 'maintenance_equipments', eq.id, {
    title: eq.name,
    notes: eq.notes,
    status: eq.category,
    amount: eq.estimatedAnnualCost,
    payload: { ...eq, id: String(eq.id) },
  });
}

export function deleteEquipmentRemote(workspaceId: string, eqId: string): Promise<void> {
  return deleteWorkspaceItem(workspaceId, 'maintenance_equipments', eqId);
}

export function pushProviderRemote(workspaceId: string, prov: ServiceProvider): Promise<void> {
  return upsertWorkspaceItem(workspaceId, 'maintenance_providers', prov.id, {
    title: prov.companyName,
    notes: prov.notes,
    payload: { ...prov, id: String(prov.id) },
  });
}

export function deleteProviderRemote(workspaceId: string, provId: string): Promise<void> {
  return deleteWorkspaceItem(workspaceId, 'maintenance_providers', provId);
}

export function pushInterventionRemote(
  workspaceId: string,
  inter: MaintenanceIntervention
): Promise<void> {
  return upsertWorkspaceItem(workspaceId, 'maintenance_interventions', inter.id, {
    title: inter.title,
    notes: inter.notes,
    amount: inter.cost,
    payload: { ...inter, id: String(inter.id) },
  });
}

export function deleteInterventionRemote(workspaceId: string, interId: string): Promise<void> {
  return deleteWorkspaceItem(workspaceId, 'maintenance_interventions', interId);
}

export interface RemoteSyncHandlers {
  onCollectionUpdate: <T extends { id: string; houseId: string }>(
    subcol: SyncSubcollection,
    items: T[],
    fromCache: boolean
  ) => void;
  onSettingsUpdate?: (payload: Partial<AppSettings>) => void;
  onError?: (err: Error, label: string) => void;
}

export function subscribeWorkspaceCollections(
  workspaceId: string,
  localHouseId: string,
  handlers: RemoteSyncHandlers
): Unsubscribe {
  stopAllFirestoreListeners();
  const inst = tryInitFirebase();
  const currentUser = inst?.auth.currentUser;
  if (!inst || !currentUser) {
    return () => {};
  }
  const { firestore } = inst;
  const uid = currentUser.uid;

  const listen = <T extends { id: string; houseId: string }>(subcol: SyncSubcollection) =>
    onSnapshot(
      collection(firestore, WORKSPACE_COLLECTION, workspaceId, subcol),
      (snap) => {
        const items = snap.docs
          .map((d) => {
            const p = d.data()?.payload as T | undefined;
            if (!p || typeof p !== 'object') return null;
            return { ...p, id: String(d.id), houseId: localHouseId };
          })
          .filter((x): x is T => x !== null);
        handlers.onCollectionUpdate(subcol, items, snap.metadata.fromCache);
      },
      (err) => handlers.onError?.(err, subcol)
    );

  const unsubs: Unsubscribe[] = SYNC_SUBCOLLECTIONS.map((subcol) => listen(subcol));

  // Écoute des préférences utilisateur dans users/{uid}/settings/main
  unsubs.push(
    onSnapshot(
      doc(firestore, 'users', uid, 'settings', 'main'),
      (snap) => {
        if (snap.exists()) {
          const payload = snap.data()?.payload as Partial<AppSettings> | undefined;
          if (payload && typeof payload === 'object') {
            handlers.onSettingsUpdate?.(payload);
          }
        }
      },
      (err) => handlers.onError?.(err, 'settings')
    )
  );

  activeListeners = unsubs;

  return () => {
    stopAllFirestoreListeners();
  };
}
