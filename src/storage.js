const DB_NAME = 'bezier-editor';
const STORE_NAME = 'documents';
const RECORD_KEY = 'current';
const LEGACY_KEY = 'bezier-editor.document';

export async function loadDocument() {
  try {
    const document = await loadFromIndexedDb();
    if (document) return { document, source: 'indexeddb' };
  } catch (error) {
    console.warn('IndexedDB 读取失败，尝试 localStorage', error);
  }

  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (raw) return { document: JSON.parse(raw), source: 'localStorage' };
  } catch (error) {
    console.warn('localStorage 读取失败', error);
  }

  return { document: null, source: 'default' };
}

export async function saveDocument(document) {
  const serialized = JSON.stringify(document);

  try {
    await saveToIndexedDb(document);
    return 'indexeddb';
  } catch (error) {
    console.warn('IndexedDB 写入失败，降级到 localStorage', error);
  }

  try {
    window.localStorage.setItem(LEGACY_KEY, serialized);
    return 'localStorage';
  } catch (error) {
    console.warn('localStorage 写入失败，本次仅保留内存状态', error);
    return 'memory';
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('浏览器不支持 IndexedDB'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
  });
}

async function withStore(mode, callback) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);
    request.onsuccess = () => {
      transaction.oncomplete = () => {
        database.close();
        resolve(request.result);
      };
    };
    request.onerror = () => {
      database.close();
      reject(request.error || new Error('IndexedDB 操作失败'));
    };
  });
}

function loadFromIndexedDb() {
  return withStore('readonly', (store) => store.get(RECORD_KEY));
}

function saveToIndexedDb(document) {
  return withStore('readwrite', (store) =>
    store.put(document, RECORD_KEY),
  );
}
