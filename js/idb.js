(function (root) {
  'use strict';

  const DB_NAME = 'bezier-editor';
  const DB_VERSION = 1;
  const STORE = 'kv';
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })).catch(err => {
      if (err && err.name === 'InvalidStateError') {
        dbPromise = null;
      }
      throw err;
    });
  }

  const api = {
    get(key) {
      return tx('readonly', store => store.get(key)).then(v => (v === undefined ? null : v));
    },
    set(key, value) {
      return tx('readwrite', store => store.put(value, key));
    },
    remove(key) {
      return tx('readwrite', store => store.delete(key));
    }
  };

  root.IDB = api;
})(typeof self !== 'undefined' ? self : this);
