import { writeFileHandleWithRetry } from "./write-retry.js";

const DB_NAME = "context-capture-db";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const DIRECTORY_KEY = "capture-directory";

function closeDbSafely(db) {
  try {
    db?.close();
  } catch (_error) {
    // Ignore close errors; IndexedDB connection cleanup is best effort.
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      closeDbSafely(db);
      callback(value);
    };
    request.onsuccess = () => finish(resolve, request.result || null);
    request.onerror = () => finish(reject, request.error);
    tx.onabort = () => finish(reject, tx.error || new Error("IndexedDB read transaction aborted"));
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(value, key);
    let settled = false;
    const finish = (callback, payload) => {
      if (settled) {
        return;
      }
      settled = true;
      closeDbSafely(db);
      callback(payload);
    };
    request.onerror = () => finish(reject, request.error);
    tx.oncomplete = () => finish(resolve);
    tx.onabort = () => finish(reject, tx.error || new Error("IndexedDB write transaction aborted"));
    tx.onerror = () => finish(reject, tx.error || new Error("IndexedDB write transaction failed"));
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);
    let settled = false;
    const finish = (callback, payload) => {
      if (settled) {
        return;
      }
      settled = true;
      closeDbSafely(db);
      callback(payload);
    };
    request.onerror = () => finish(reject, request.error);
    tx.oncomplete = () => finish(resolve);
    tx.onabort = () => finish(reject, tx.error || new Error("IndexedDB delete transaction aborted"));
    tx.onerror = () => finish(reject, tx.error || new Error("IndexedDB delete transaction failed"));
  });
}

export async function saveDirectoryHandle(handle) {
  await idbSet(DIRECTORY_KEY, handle);
}

export async function getSavedDirectoryHandle() {
  return idbGet(DIRECTORY_KEY);
}

export async function clearSavedDirectoryHandle() {
  await idbDelete(DIRECTORY_KEY);
}

export async function ensureReadWritePermission(handle) {
  if (!handle) {
    return false;
  }

  const options = { mode: "readwrite" };

  try {
    if (await handle.queryPermission(options) === "granted") {
      return true;
    }

    return (await handle.requestPermission(options)) === "granted";
  } catch (_error) {
    return false;
  }
}

async function getNestedDirectoryHandle(rootHandle, segments) {
  let current = rootHandle;

  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  return current;
}

export async function writeJsonToDirectory(handle, fileName, payload, subdirectories = []) {
  const targetHandle = await getNestedDirectoryHandle(handle, subdirectories);
  const fileHandle = await targetHandle.getFileHandle(fileName, { create: true });
  await writeFileHandleWithRetry(fileHandle, `${JSON.stringify(payload, null, 2)}\n`, {
    target: fileName
  });
}
