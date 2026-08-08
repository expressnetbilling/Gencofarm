/**
 * Genco Firebase Client — Direct RTDB SDK Access (Optimized)
 *
 * Initializes the Firebase Web SDK (v9+ modular syntax) directly in the React
 * frontend. All data operations go through the SDK — NO Cloud Function proxy.
 *
 * Optimized to strictly prevent bandwidth credit-burning using server-side 
 * queries, dynamic date partitioning, and local multi-tier caching.
 *
 * Project ID: genco-export
 */

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  get,
  onValue,
  off,
  query,
  orderByChild,
  orderByKey,
  orderByValue,
  equalTo,
  limitToLast,
  limitToFirst,
  startAt,
  endAt,
  startAfter,
  endBefore,
  child,
  goOffline,
  goOnline,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onChildMoved,
  onDisconnect,
  runTransaction,
  serverTimestamp,
  type Database,
  type DataSnapshot,
  type Unsubscribe,
  type Query,
  type QueryConstraint,
  type ThenableReference,
} from "firebase/database";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import {
  cacheKey,
  removeCachedValue,
  removeCachedValuesByPrefix,
  removeMemoryCache,
  invalidateMemoryCacheByPrefix,
  readCachedValueTiered,
  writeCachedValueTiered,
} from "@/lib/data-cache";
import { queryClient } from "@/lib/query-client";

// ---------------------------------------------------------------------------
// Firebase Configuration
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// ---------------------------------------------------------------------------
// App & Service Initialization (singleton-safe)
// ---------------------------------------------------------------------------

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getDatabase(app);
export default app;

// Secondary app for admin user creation (doesn't log out the admin)
const secondaryApp =
  getApps().find((a) => a.name === "Secondary") ??
  initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

// Storage instance
const storage = getStorage(app);

// ---------------------------------------------------------------------------
// Re-export standard SDK functions
// ---------------------------------------------------------------------------

export {
  ref,
  push,
  set,
  update,
  remove,
  get,
  onValue,
  off,
  query,
  orderByChild,
  orderByKey,
  orderByValue,
  equalTo,
  limitToLast,
  limitToFirst,
  startAt,
  endAt,
  startAfter,
  endBefore,
  child,
  goOffline,
  goOnline,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onChildMoved,
  onDisconnect,
  runTransaction,
  serverTimestamp,
  type Database,
  type DataSnapshot,
  type Unsubscribe,
  type Query,
  type QueryConstraint,
  type ThenableReference,
};

export {
  getDownloadURL,
  getStorage,
  uploadBytes,
  ref as storageRef,
};

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type DatabaseRecord<T> = T & { id: string };

export type CollectionFetchOptions = {
  ttlMs?: number;
  noDateFilter?: boolean;
  startDate?: string;     // Format: YYYY-MM-DD
  endDate?: string;       // Format: YYYY-MM-DD
  dateField?: string;
  dateValueType?: "date-string" | "timestamp-ms";
  page?: number;
  limit?: number;
  fields?: readonly string[];
};

export type BatchCollectionRequest = {
  key?: string;
  path: string;
  programme?: string;
  programmes?: readonly string[];
  options?: CollectionFetchOptions;
};

// ---------------------------------------------------------------------------
// Optimized Internal Helpers
// ---------------------------------------------------------------------------

const normalizeProgrammeValue = (value: unknown): string =>
  String(value ?? "").trim().toUpperCase();

const getRecordProgramme = (record: Record<string, any>): string =>
  normalizeProgrammeValue(record.programme ?? record.Programme);

const PROGRAMME_FIELD_CANDIDATES = ["programme", "Programme"] as const;
const DEFAULT_UNFILTERED_LIMIT = 1000;
const DEFAULT_DATE_FIELD_BY_PATH: Record<string, Pick<CollectionFetchOptions, "dateField" | "dateValueType">> = {
  farmers: { dateField: "createdAt", dateValueType: "timestamp-ms" },
  offtakes: { dateField: "date", dateValueType: "date-string" },
  capacityBuilding: { dateField: "startDate", dateValueType: "date-string" },
  training: { dateField: "startDate", dateValueType: "date-string" },
  orders: { dateField: "date", dateValueType: "date-string" },
  requisitions: { dateField: "submittedAt", dateValueType: "timestamp-ms" },
  BoreholeStorage: { dateField: "date", dateValueType: "date-string" },
  "Recent Activities": { dateField: "date", dateValueType: "date-string" },
};

/** Dynamic Current Calendar Month Boundaries (Returns ISO local YYYY-MM-DD) */
export const getCurrentMonthRange = (): { startDate: string; endDate: string } => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  const startOfCurrentMonth = new Date(year, month, 1);
  const endOfCurrentMonth = new Date(year, month + 1, 0);

  const formatDate = (date: Date) => {
    const d = date.getDate().toString().padStart(2, "0");
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const y = date.getFullYear();
    return `${y}-${m}-${d}`;
  };

  return {
    startDate: formatDate(startOfCurrentMonth),
    endDate: formatDate(endOfCurrentMonth),
  };
};

/** Parse database snapshot to clean typescript-compatible record structures */
const toRecords = <T = any>(
  rawData: Record<string, any> | null,
): DatabaseRecord<T>[] => {
  if (!rawData || typeof rawData !== "object") return [];
  return Object.entries(rawData).map(([id, value]) => ({
    ...(value as T),
    id,
  }));
};

const dedupeRecords = <T>(
  records: DatabaseRecord<T>[],
): DatabaseRecord<T>[] => {
  const byId = new Map<string, DatabaseRecord<T>>();
  records.forEach((record) => byId.set(record.id, record));
  return [...byId.values()];
};

const hasServerDateFilter = (options: CollectionFetchOptions): boolean =>
  Boolean(!options.noDateFilter && options.dateField && (options.startDate || options.endDate));

const withDefaultCurrentMonthFilter = (
  path: string,
  options: CollectionFetchOptions,
): CollectionFetchOptions => {
  if (options.noDateFilter || options.dateField || options.startDate || options.endDate) {
    return options;
  }

  const defaultDateField = DEFAULT_DATE_FIELD_BY_PATH[path];
  if (!defaultDateField) return options;

  const currentMonth = getCurrentMonthRange();
  return {
    ...options,
    ...defaultDateField,
    startDate: currentMonth.startDate,
    endDate: currentMonth.endDate,
  };
};

const getDateBoundaryValue = (
  value: string | undefined,
  boundary: "start" | "end",
  valueType: CollectionFetchOptions["dateValueType"],
) => {
  if (!value) return undefined;
  if (valueType !== "timestamp-ms") return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (boundary === "start") date.setHours(0, 0, 0, 0);
  else date.setHours(23, 59, 59, 999);
  return date.getTime();
};

const applyLimit = (dbQuery: Query, options: CollectionFetchOptions): Query => {
  if (typeof options.limit === "number" && options.limit > 0) {
    return query(dbQuery, limitToLast(options.limit));
  }
  return dbQuery;
};

const buildDateQuery = (
  path: string,
  options: CollectionFetchOptions,
): Query => {
  const constraints: QueryConstraint[] = [orderByChild(options.dateField || "date")];
  const startValue = getDateBoundaryValue(options.startDate, "start", options.dateValueType);
  const endValue = getDateBoundaryValue(options.endDate, "end", options.dateValueType);
  if (startValue !== undefined) constraints.push(startAt(startValue));
  if (endValue !== undefined) constraints.push(endAt(endValue));
  if (typeof options.limit === "number" && options.limit > 0) {
    constraints.push(limitToLast(options.limit));
  }
  return query(ref(db, path), ...constraints);
};

const buildProgrammeQuery = (
  path: string,
  programmeField: string,
  programme: string,
  options: CollectionFetchOptions,
): Query => {
  const constraints: QueryConstraint[] = [
    orderByChild(programmeField),
    equalTo(programme),
  ];
  if (typeof options.limit === "number" && options.limit > 0) {
    constraints.push(limitToLast(options.limit));
  }
  return query(ref(db, path), ...constraints);
};

const readQueryRecords = async <T>(dbQuery: Query): Promise<DatabaseRecord<T>[]> => {
  const snapshot = await get(dbQuery);
  const rawData = snapshot.val() as Record<string, any> | null;
  return toRecords<T>(rawData);
};

// In-flight request deduplication map to prevent multiple identical queries hitting RTDB at once
const inFlightGets = new Map<string, Promise<DatabaseRecord<any>[]>>();

// ---------------------------------------------------------------------------
// fetchCollection — Direct SDK, Server-Filtered & Cache-Backed
// ---------------------------------------------------------------------------

/**
 * Fetch records at a given path using a server-side query.
 * Date filters are opt-in. Most app pages apply date filtering in-memory after
 * fetching programme-scoped data, because collections use different date fields.
 */
export const fetchCollection = async <T = Record<string, any>>(
  path: string,
  options?: number | CollectionFetchOptions,
): Promise<DatabaseRecord<T>[]> => {
  const rawOpts = typeof options === "number" ? { ttlMs: options } : options || {};
  const opts = withDefaultCurrentMonthFilter(path, rawOpts);
  const { ttlMs } = opts;

  const queryShape = hasServerDateFilter(opts)
    ? `date:${opts.dateField}:${opts.dateValueType ?? "date-string"}:${opts.startDate ?? ""}:${opts.endDate ?? ""}:limit:${opts.limit ?? "none"}`
    : `latest:limit:${opts.limit ?? DEFAULT_UNFILTERED_LIMIT}`;
  const cacheName = cacheKey("collection", path, queryShape);

  if (ttlMs) {
    const cached = readCachedValueTiered<DatabaseRecord<T>[]>(cacheName, ttlMs);
    if (cached) return cached;
  }

  if (inFlightGets.has(cacheName)) {
    return inFlightGets.get(cacheName)! as Promise<DatabaseRecord<T>[]>;
  }

  const fetchPromise = (async () => {
    try {
      const dbQuery = hasServerDateFilter(opts)
        ? buildDateQuery(path, opts)
        : applyLimit(ref(db, path), { ...opts, limit: opts.limit ?? DEFAULT_UNFILTERED_LIMIT });
      const records = await readQueryRecords<T>(dbQuery);

      if (ttlMs) {
        writeCachedValueTiered(cacheName, records);
      }

      return records;
    } finally {
      inFlightGets.delete(cacheName);
    }
  })();

  inFlightGets.set(cacheName, fetchPromise);
  return fetchPromise;
};

// ---------------------------------------------------------------------------
// fetchCollectionByProgramme — Client-side Programme Filter
// ---------------------------------------------------------------------------

export const fetchCollectionByProgramme = async <T = Record<string, any>>(
  path: string,
  programme: string,
  options?: number | CollectionFetchOptions,
): Promise<DatabaseRecord<T>[]> => {
  const normalized = normalizeProgrammeValue(programme);
  if (!normalized) return [];
  const rawOpts = typeof options === "number" ? { ttlMs: options } : options || {};
  const opts = withDefaultCurrentMonthFilter(path, rawOpts);
  const cacheName = cacheKey(
    "collection",
    path,
    `programme:${normalized}`,
    JSON.stringify({
      startDate: opts.startDate,
      endDate: opts.endDate,
      dateField: opts.dateField,
      dateValueType: opts.dateValueType,
      noDateFilter: opts.noDateFilter,
      limit: opts.limit,
    }),
  );

  if (opts.ttlMs) {
    const cached = readCachedValueTiered<DatabaseRecord<T>[]>(cacheName, opts.ttlMs);
    if (cached) return cached;
  }

  if (inFlightGets.has(cacheName)) {
    return inFlightGets.get(cacheName)! as Promise<DatabaseRecord<T>[]>;
  }

  const fetchPromise = (async () => {
    try {
      let records: DatabaseRecord<T>[];

      if (hasServerDateFilter(opts)) {
        records = (await fetchCollection<T>(path, opts)).filter(
          (record) => getRecordProgramme(record as Record<string, any>) === normalized,
        );
      } else {
        const programmeRecords = await Promise.all(
          PROGRAMME_FIELD_CANDIDATES.map((field) =>
            readQueryRecords<T>(buildProgrammeQuery(path, field, normalized, opts)),
          ),
        );
        records = dedupeRecords(programmeRecords.flat()).filter(
          (record) => getRecordProgramme(record as Record<string, any>) === normalized,
        );
      }

      if (opts.ttlMs) writeCachedValueTiered(cacheName, records);
      return records;
    } finally {
      inFlightGets.delete(cacheName);
    }
  })();

  inFlightGets.set(cacheName, fetchPromise);
  return fetchPromise;
};

// ---------------------------------------------------------------------------
// fetchCollectionByProgrammes — Multi-programme client-side filter
// ---------------------------------------------------------------------------

export const fetchCollectionByProgrammes = async <T = Record<string, any>>(
  path: string,
  programmes: readonly string[],
  options?: number | CollectionFetchOptions,
): Promise<DatabaseRecord<T>[]> => {
  const normalizedSet = new Set(
    programmes.map((p) => normalizeProgrammeValue(p)).filter(Boolean),
  );
  if (normalizedSet.size === 0) return [];

  const records = await Promise.all(
    [...normalizedSet].map((programme) =>
      fetchCollectionByProgramme<T>(path, programme, options),
    ),
  );

  return dedupeRecords(records.flat());
};

// ---------------------------------------------------------------------------
// fetchCollectionsBatch — Parallel query processor
// ---------------------------------------------------------------------------

export const fetchCollectionsBatch = async <T = Record<string, any>>(
  requests: readonly BatchCollectionRequest[],
): Promise<Record<string, DatabaseRecord<T>[]>> => {
  const results = await Promise.all(
    requests.map(async (req) => {
      let records: DatabaseRecord<T>[];

      if (req.programmes) {
        records = await fetchCollectionByProgrammes<T>(
          req.path,
          req.programmes,
          req.options,
        );
      } else if (req.programme) {
        records = await fetchCollectionByProgramme<T>(
          req.path,
          req.programme,
          req.options,
        );
      } else {
        records = await fetchCollection<T>(req.path, req.options);
      }

      return [req.key ?? req.path, records] as const;
    }),
  );

  return Object.fromEntries(results) as Record<string, DatabaseRecord<T>[]>;
};

// ---------------------------------------------------------------------------
// subscribeCollectionByProgramme — True Real-time Client Websocket
// ---------------------------------------------------------------------------

/**
 * Creates a native real-time listener using Firebase WebSockets (`onValue`).
 * Server queries restrict data limits to the current month by default.
 */
export const subscribeCollectionByProgramme = <T = Record<string, any>>(
  path: string,
  programme: string,
  onRecords: (records: Record<string, T>) => void,
  onError?: (error: Error) => void,
  options?: number | CollectionFetchOptions,
): (() => void) => {
  const normalized = programme.trim().toUpperCase();
  if (!normalized) {
    onRecords({});
    return () => {};
  }

  const rawOpts = typeof options === "number" ? {} : options || {};
  const opts = withDefaultCurrentMonthFilter(path, rawOpts);
  const latestByField = new Map<string, DatabaseRecord<T>[]>();

  const emitMergedRecords = () => {
    const records = dedupeRecords([...latestByField.values()].flat()).filter(
      (record) => getRecordProgramme(record as Record<string, any>) === normalized,
    );
    const map: Record<string, T> = {};
    records.forEach((record) => {
      map[record.id] = record as unknown as T;
    });
    onRecords(map);
  };

  if (hasServerDateFilter(opts)) {
    const unsubscribe = onValue(
      buildDateQuery(path, opts),
      (snapshot) => {
        latestByField.set("date", toRecords<T>(snapshot.val() as Record<string, any> | null));
        emitMergedRecords();
      },
      (err) => {
        if (onError) onError(err);
      },
    );

    return unsubscribe;
  }

  if (opts.noDateFilter) {
    const unsubscribe = onValue(
      ref(db, path),
      (snapshot) => {
        latestByField.set("all", toRecords<T>(snapshot.val() as Record<string, any> | null));
        emitMergedRecords();
      },
      (err) => {
        if (onError) onError(err);
      },
    );

    return unsubscribe;
  }

  const unsubs = PROGRAMME_FIELD_CANDIDATES.map((field) =>
    onValue(
      buildProgrammeQuery(path, field, normalized, opts),
      (snapshot) => {
        latestByField.set(field, toRecords<T>(snapshot.val() as Record<string, any> | null));
        emitMergedRecords();
      },
      (err) => {
        if (onError) onError(err);
      },
    ),
  );

  return () => {
    unsubs.forEach((unsubscribe) => unsubscribe());
  };
};

// ---------------------------------------------------------------------------
// subscribeCollectionByProgrammes — Merged Multi-Channel WebSockets
// ---------------------------------------------------------------------------

export const subscribeCollectionByProgrammes = <T = Record<string, any>>(
  path: string,
  programmes: readonly string[],
  onRecords: (records: Record<string, T>) => void,
  onError?: (error: Error) => void,
  options?: number | CollectionFetchOptions,
): (() => void) => {
  const normalized = Array.from(
    new Set(programmes.map((p) => p.trim().toUpperCase()).filter(Boolean)),
  );
  if (normalized.length === 0) {
    onRecords({});
    return () => {};
  }

  const mergedByProgramme = { current: new Map<string, Record<string, T>>() };

  const unsubs = normalized.map((p) =>
    subscribeCollectionByProgramme<T>(
      path,
      p,
      (records) => {
        mergedByProgramme.current.set(p, records);
        const all: Record<string, T> = {};
        mergedByProgramme.current.forEach((v) => Object.assign(all, v));
        onRecords(all);
      },
      onError,
      options,
    ),
  );

  return () => {
    unsubs.forEach((u) => u());
  };
};

// ---------------------------------------------------------------------------
// Cache Invalidation
// ---------------------------------------------------------------------------

export const invalidateCollectionCache = (path: string): void => {
  const prefixes = [
    cacheKey("collection", path),
    cacheKey("collection", path, "programme:"),
    cacheKey("collection", path, "programmes:"),
  ];

  for (const prefix of prefixes) {
    removeCachedValue(prefix);
    removeCachedValuesByPrefix(prefix);
    removeMemoryCache(prefix);
  }

  invalidateMemoryCacheByPrefix(cacheKey("collection", path));

  queryClient.invalidateQueries({
    queryKey: ["collection", auth.currentUser?.uid || "anon", path],
    refetchType: "none",
  });
};

// ---------------------------------------------------------------------------
// Storage Utilities
// ---------------------------------------------------------------------------

export const uploadFileToStorage = async (
  path: string,
  file: File,
): Promise<string> => {
  const targetRef = storageRef(storage, path);
  await uploadBytes(targetRef, file, {
    contentType: file.type || "application/octet-stream",
  });
  return getDownloadURL(targetRef);
};

// ---------------------------------------------------------------------------
// Profiles & Administrative Touches
// ---------------------------------------------------------------------------

export const getUserProfile = async (
  uid: string,
): Promise<{ id: string; [key: string]: any } | null> => {
  const directSnap = await get(ref(db, `users/${uid}`));
  if (directSnap.exists()) {
    return { id: uid, ...(directSnap.val() as Record<string, any>) };
  }

  const q = query(ref(db, "users"), orderByChild("uid"), equalTo(uid));
  const querySnap = await get(q);

  if (!querySnap.exists()) return null;

  let recordId: string | null = null;
  let data: Record<string, any> | null = null;

  querySnap.forEach((child) => {
    recordId = child.key;
    data = child.val() as Record<string, any>;
    return true;
  });

  if (!recordId || !data) return null;

  return { id: recordId, ...data };
};

export const touchLastLogin = async (recordId: string): Promise<void> => {
  await update(ref(db, `users/${recordId}`), {
    lastLogin: Date.now(),
  });
};