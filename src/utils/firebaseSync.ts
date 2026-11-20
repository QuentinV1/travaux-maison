import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
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
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  MaintenanceEquipment,
  MaintenanceIntervention,
  ServiceProvider,
  ShoppingItem,
  TaskItem,
} from '../types';

export const FIREBASE_CONFIG = {
  projectId: 'quentin-apps-hub',
  appId: '1:249016348389:web:59deb2bca6520d029cee0c',
  storageBucket: 'quentin-apps-hub.firebasestorage.app',
  apiKey: 'AIzaSyCuYM0tMpd1f1jDYz27OhCaPpcAWhI3i48',
  authDomain: 'quentin-apps-hub.firebaseapp.com',
  messagingSenderId: '249016348389',
};

const WORKSPACE_COLLECTION = 'travaux_houses';

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function ensureFirebase(): { app: FirebaseApp; auth: Auth; firestore: Firestore } {
  if (!appInstance) {
    const existing = getApps();
    appInstance = existing.length > 0 ? existing[0] : initializeApp(FIREBASE_CONFIG);
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
}

export function getFirebaseAuth(): Auth {
  return ensureFirebase().auth;
}

export function subscribeAuth(callback: (user: User | null) => void): Unsubscribe {
  const { auth } = ensureFirebase();
  return onAuthStateChanged(auth, callback);
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

export async function resetFirebasePassword(email: string): Promise<void> {
  const { auth } = ensureFirebase();
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerificationEmail(): Promise<void> {
  const { auth } = ensureFirebase();
  if (!auth.currentUser) throw new Error('Aucun utilisateur connecté.');
  await sendEmailVerification(auth.currentUser);
}

export async function signOutFirebase(): Promise<void> {
  const { auth } = ensureFirebase();
  await signOut(auth);
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

type SyncSubcollection =
  | 'tasks'
  | 'shopping_items'
  | 'maintenance_equipments'
  | 'maintenance_providers'
  | 'maintenance_interventions';

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

  const ref = doc(firestore, WORKSPACE_COLLECTION, workspaceId, subcol, itemId);
  const existing = await getDoc(ref);
  const now = Timestamp.now();

  const existingData = existing.exists() ? existing.data() : null;
  const createdBy = existingData?.createdBy ? String(existingData.createdBy) : user.uid;
  const createdAt = existingData?.createdAt ?? now;

  const docData: Record<string, unknown> = {
    createdBy,
    createdAt,
    updatedAt: now,
    payload: fields.payload,
  };
  if (fields.title !== undefined) docData.title = fields.title.slice(0, 200);
  if (fields.notes !== undefined) docData.notes = fields.notes.slice(0, 5000);
  if (fields.status !== undefined && fields.status.length >= 1) {
    docData.status = fields.status.slice(0, 40);
  }
  if (typeof fields.amount === 'number' && Number.isFinite(fields.amount)) {
    docData.amount = fields.amount;
  }
  if (Array.isArray(fields.tags)) {
    docData.tags = fields.tags.slice(0, 20);
  }

  await setDoc(ref, docData);
}

async function deleteWorkspaceItem(
  workspaceId: string,
  subcol: SyncSubcollection,
  itemId: string
): Promise<void> {
  const { auth, firestore } = ensureFirebase();
  if (!auth.currentUser) return;
  const ref = doc(firestore, WORKSPACE_COLLECTION, workspaceId, subcol, itemId);
  await deleteDoc(ref);
}

export function pushTaskRemote(workspaceId: string, task: TaskItem): Promise<void> {
  return upsertWorkspaceItem(workspaceId, 'tasks', task.id, {
    title: task.title,
    notes: task.description,
    status: task.status,
    payload: { ...task },
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
    payload: { ...item },
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
    payload: { ...eq },
  });
}

export function deleteEquipmentRemote(workspaceId: string, eqId: string): Promise<void> {
  return deleteWorkspaceItem(workspaceId, 'maintenance_equipments', eqId);
}

export function pushProviderRemote(workspaceId: string, prov: ServiceProvider): Promise<void> {
  return upsertWorkspaceItem(workspaceId, 'maintenance_providers', prov.id, {
    title: prov.companyName,
    notes: prov.notes,
    payload: { ...prov },
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
    payload: { ...inter },
  });
}

export function deleteInterventionRemote(workspaceId: string, interId: string): Promise<void> {
  return deleteWorkspaceItem(workspaceId, 'maintenance_interventions', interId);
}

export interface RemoteSyncHandlers {
  onTasks: (items: TaskItem[]) => void;
  onShoppingItems: (items: ShoppingItem[]) => void;
  onEquipments: (items: MaintenanceEquipment[]) => void;
  onProviders: (items: ServiceProvider[]) => void;
  onInterventions: (items: MaintenanceIntervention[]) => void;
  onError?: (err: Error) => void;
}

export function subscribeWorkspaceCollections(
  workspaceId: string,
  localHouseId: string,
  handlers: RemoteSyncHandlers
): Unsubscribe {
  const { firestore } = ensureFirebase();

  const listen = <T extends { id: string; houseId: string }>(
    subcol: SyncSubcollection,
    cb: (items: T[]) => void
  ) =>
    onSnapshot(
      collection(firestore, WORKSPACE_COLLECTION, workspaceId, subcol),
      (snap) => {
        const items = snap.docs
          .map((d) => {
            const p = d.data()?.payload as T | undefined;
            if (!p || typeof p !== 'object') return null;
            return { ...p, id: d.id, houseId: localHouseId };
          })
          .filter((x): x is T => x !== null);
        cb(items);
      },
      (err) => handlers.onError?.(err)
    );

  const unsubs = [
    listen<TaskItem>('tasks', handlers.onTasks),
    listen<ShoppingItem>('shopping_items', handlers.onShoppingItems),
    listen<MaintenanceEquipment>('maintenance_equipments', handlers.onEquipments),
    listen<ServiceProvider>('maintenance_providers', handlers.onProviders),
    listen<MaintenanceIntervention>('maintenance_interventions', handlers.onInterventions),
  ];

  return () => {
    unsubs.forEach((u) => u());
  };
}
