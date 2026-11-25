import type { Transcript } from './types';

const DB_NAME = 'hookcut-cache';
const DB_VERSION = 1;
const STORE_NAME = 'transcripts';

interface StoredTranscriptRecord {
  cacheKey: string;
  transcript: Transcript;
}

const memoryFallback = new Map<string, Transcript>();

export function buildTranscriptCacheKey(fileFingerprint: string, modelId: string): string {
  return `${fileFingerprint}::${modelId}`;
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCachedTranscript(
  fileFingerprint: string,
  modelId: string,
): Promise<Transcript | null> {
  const cacheKey = buildTranscriptCacheKey(fileFingerprint, modelId);
  const db = await openCacheDb();

  if (!db) {
    return memoryFallback.get(cacheKey) ?? null;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey);
      req.onsuccess = () => {
        const record = req.result as StoredTranscriptRecord | undefined;
        resolve(record?.transcript ?? null);
      };
      req.onerror = () => resolve(memoryFallback.get(cacheKey) ?? null);
      tx.oncomplete = () => db.close();
    } catch {
      db.close();
      resolve(memoryFallback.get(cacheKey) ?? null);
    }
  });
}

export async function saveCachedTranscript(transcript: Transcript): Promise<void> {
  const cacheKey = buildTranscriptCacheKey(transcript.fileFingerprint, transcript.modelId);
  memoryFallback.set(cacheKey, transcript);

  const db = await openCacheDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ cacheKey, transcript } satisfies StoredTranscriptRecord);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function clearCachedTranscripts(): Promise<void> {
  memoryFallback.clear();
  const db = await openCacheDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
