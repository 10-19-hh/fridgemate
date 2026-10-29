import { LOCAL_PILOT_RETENTION_MS, parsePilotInstant, createPilotVersion } from './mealPlanPilotPolicy.js';

const DEADLINE = 5000;
const PREFIX = 'fridgemate-db__';
const STORE = 'mealPlanPilot';

function scopeForName(name) {
  if (name === `${PREFIX}guest`) return 'guest';
  const match = typeof name === 'string' && /^fridgemate-db__user_([A-Za-z0-9_-]+)$/.exec(name);
  return match ? `user:${match[1]}` : null;
}

function instant(value) {
  const time = parsePilotInstant(value);
  if (time === null) throw new Error();
  return time;
}

function expired(row, scope, now) {
  if (row === undefined) return false;
  if (!row || row.id !== 'session' || ![1, 2].includes(row.schemaVersion) || row.scope !== scope
    || typeof row.version !== 'string' || !/^[a-f0-9]{32}$/.test(row.version)) throw new Error();
  if (['expired', 'withdrawn'].includes(row.status)) {
    if (row.schemaVersion !== 1 || Object.keys(row).length !== 5) throw new Error();
    return false;
  }
  if (row.status !== 'active') throw new Error();
  const started = instant(row.startedAt);
  const expiry = instant(row.expiresAt);
  if (expiry !== started + LOCAL_PILOT_RETENTION_MS) throw new Error();
  return now >= expiry;
}

function purgeDatabase(factory, name, scope) {
  return new Promise(resolve => {
    let database;
    let transaction;
    let settled = false;
    let didExpire = false;
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      database?.close();
      resolve(status);
    };
    const stop = () => {
      if (settled) return;
      try { transaction?.abort(); } catch { /* It may already have completed. */ }
      finish('failed');
    };
    const timer = setTimeout(stop, DEADLINE);
    let request;
    try {
      // No version argument: startup retention must not migrate another scope.
      request = factory.open(name);
    } catch { stop(); return; }
    request.onblocked = stop;
    request.onerror = stop;
    request.onupgradeneeded = () => {
      // A database may disappear between enumeration and opening. Abort the
      // implicit creation, including when the open result arrives too late.
      try { request.transaction.abort(); } catch { /* An aborted open will fail. */ }
      stop();
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      database = request.result;
      database.onversionchange = stop;
      database.onclose = stop;
      if (!database.objectStoreNames.contains(STORE)) { finish('unchanged'); return; }
      try {
        transaction = database.transaction(STORE, 'readwrite');
        transaction.oncomplete = () => finish(didExpire ? 'expired' : 'unchanged');
        transaction.onabort = stop;
        transaction.onerror = stop;
        const store = transaction.objectStore(STORE);
        const read = store.get('session');
        read.onsuccess = () => {
          if (settled) return;
          try {
            // Queuing and opening can cross the retention boundary. Payloads
            // need not be valid to delete an expired, valid session header.
            if (!expired(read.result, scope, Date.now())) return;
            const marker = { id: 'session', schemaVersion: 1, scope, status: 'expired', version: createPilotVersion() };
            store.clear();
            store.put(marker);
            didExpire = true;
          } catch { stop(); }
        };
      } catch { stop(); }
    };
  });
}

/** Startup cleanup only. Never exports identifiers, payloads or raw errors. */
export async function purgeExpiredMealPlanPilots() {
  const result = { supported: false, checkedScopes: 0, expiredScopes: 0, failedScopes: 0 };
  const factory = globalThis.window?.indexedDB;
  if (typeof factory?.databases !== 'function') return result;
  let timer;
  let databases;
  try {
    databases = await Promise.race([factory.databases(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error()), DEADLINE);
    })]);
    if (!Array.isArray(databases)) return result;
  } catch { return result; }
  finally { clearTimeout(timer); }
  result.supported = true;
  const names = [...new Set(databases.map(database => database?.name).filter(name => scopeForName(name)))];
  for (const name of names) {
    result.checkedScopes += 1;
    const status = await purgeDatabase(factory, name, scopeForName(name));
    if (status === 'expired') result.expiredScopes += 1;
    if (status === 'failed') result.failedScopes += 1;
  }
  return result;
}
