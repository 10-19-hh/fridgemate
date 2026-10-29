const LEGACY_IMPORT_CORRECTIONS_STORAGE_KEY = 'fridgemate-import-corrections';
const MAX_CORRECTION_COUNT = 300;
const recoveryConfirmations = new WeakMap();

function storageKey(scope = 'guest') {
  return `fridgemate-import-corrections:v2:${scope}`;
}

function normalizeKeyPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function getBrowserStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

function parseCorrectionMap(rawValue) {
  try {
    const parsed = rawValue === null ? {} : JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { correctionMap: {}, canWrite: false };
    }
    const entries = Object.entries(parsed);
    const validEntries = entries.filter(([, row]) =>
      row && typeof row === 'object' && !Array.isArray(row) &&
      ['name', 'category', 'storageType', 'updatedAt'].every((field) =>
        !Object.hasOwn(row, field) || typeof row[field] === 'string'
      )
    );
    // Read safe rows, but never replace a damaged source with a partial recovery.
    return { correctionMap: Object.fromEntries(validEntries), canWrite: validEntries.length === entries.length };
  } catch {
    return { correctionMap: {}, canWrite: false };
  }
}

function readCorrectionMap(scope = 'guest') {
  try {
    const storage = getBrowserStorage();
    if (!storage) return { correctionMap: {}, canWrite: false };

    const currentValue = storage.getItem(storageKey(scope));
    const rawValue = currentValue === null && scope === 'guest'
      ? storage.getItem(LEGACY_IMPORT_CORRECTIONS_STORAGE_KEY)
      : currentValue;
    return parseCorrectionMap(rawValue);
  } catch {
    return { correctionMap: {}, canWrite: false };
  }
}

function writeCorrectionMap(correctionMap, scope = 'guest') {
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(storageKey(scope), JSON.stringify(correctionMap));
    return true;
  } catch {
    return false;
  }
}

function isRecoveryScope(scope) {
  return scope === 'guest' || (typeof scope === 'string' && /^user:[A-Za-z0-9_-]+$/.test(scope));
}

function readRecoverySnapshot(storage, scope) {
  return {
    currentRaw: storage.getItem(storageKey(scope)),
    legacyRaw: scope === 'guest' ? storage.getItem(LEGACY_IMPORT_CORRECTIONS_STORAGE_KEY) : null
  };
}

function sameRecoverySnapshot(left, right) {
  return left.currentRaw === right.currentRaw && left.legacyRaw === right.legacyRaw;
}

export function inspectImportCorrections(scope = 'guest') {
  if (!isRecoveryScope(scope)) return { status: 'unavailable' };
  try {
    const storage = getBrowserStorage();
    if (!storage) return { status: 'unavailable' };
    const currentRaw = storage.getItem(storageKey(scope));
    let legacyRaw = scope === 'guest' && currentRaw === null
      ? storage.getItem(LEGACY_IMPORT_CORRECTIONS_STORAGE_KEY) : null;
    const raw = currentRaw === null && scope === 'guest' ? legacyRaw : currentRaw;
    // A readable, valid source does not imply that setItem/removeItem will work.
    if (parseCorrectionMap(raw).canWrite) return { status: 'ready' };
    if (scope === 'guest' && currentRaw !== null) legacyRaw = storage.getItem(LEGACY_IMPORT_CORRECTIONS_STORAGE_KEY);
    const resetToken = Object.freeze(Object.create(null));
    // The opaque token has no enumerable, symbol or serializable source fields.
    recoveryConfirmations.set(resetToken, { scope, currentRaw, legacyRaw });
    return { status: 'damaged', resetToken };
  } catch {
    return { status: 'unavailable' };
  }
}

export function resetImportCorrections(input, options = {}) {
  let confirmation;
  let scope;
  let isCurrent;
  try {
    const resetToken = input?.resetToken;
    confirmation = recoveryConfirmations.get(resetToken);
    // Even a wrong-scope or blocked attempt requires a new explicit confirmation.
    recoveryConfirmations.delete(resetToken);
    scope = input?.scope === undefined ? 'guest' : input.scope;
    if (!confirmation || !isRecoveryScope(scope) || confirmation.scope !== scope) return { status: 'invalid' };
    isCurrent = options?.isCurrent === undefined ? () => true : options.isCurrent;
    if (typeof isCurrent !== 'function') return { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
  }

  const hasCurrentScope = () => {
    try { return isCurrent() === true; } catch { return false; }
  };
  let removedAny = false;
  const changed = () => ({ status: removedAny ? 'partial' : 'changed' });
  const unavailable = () => ({ status: removedAny ? 'partial' : 'unavailable' });
  const expected = { currentRaw: confirmation.currentRaw, legacyRaw: confirmation.legacyRaw };
  try {
    if (!hasCurrentScope()) return changed();
    const storage = getBrowserStorage();
    if (!storage) return unavailable();
    const keys = scope === 'guest'
      ? [['legacyRaw', LEGACY_IMPORT_CORRECTIONS_STORAGE_KEY], ['currentRaw', storageKey(scope)]]
      : [['currentRaw', storageKey(scope)]];
    for (const [field, key] of keys) {
      if (!hasCurrentScope()) return changed();
      // Recheck both remaining and already-deleted keys before each removal.
      if (!sameRecoverySnapshot(readRecoverySnapshot(storage, scope), expected)) return changed();
      if (expected[field] === null) continue;
      if (!hasCurrentScope()) return changed();
      let removalFailed = false;
      try { storage.removeItem(key); } catch { removalFailed = true; }
      let actual;
      try { actual = readRecoverySnapshot(storage, scope); } catch {
        // A deletion was attempted but its effect cannot be verified. Do not
        // claim successful reset or continue to delete the remaining source.
        return { status: 'partial' };
      }
      if (actual[field] === null) removedAny = true;
      if (removalFailed) return unavailable();
      if (actual[field] !== null) return unavailable();
      expected[field] = null;
      if (!sameRecoverySnapshot(actual, expected)) return changed();
    }
    if (!hasCurrentScope()) return changed();
    if (!sameRecoverySnapshot(readRecoverySnapshot(storage, scope), { currentRaw: null, legacyRaw: null })) return changed();
    // localStorage cannot make the separate reads/removals an atomic CAS.
    // This only confirms the final observed absence; never roll deleted data back.
    return { status: 'reset' };
  } catch {
    return unavailable();
  }
}

export function clearImportCorrections(scope = 'guest') {
  let storage;
  try {
    storage = getBrowserStorage();
  } catch {
    return false;
  }

  if (!storage) {
    return true;
  }

  const keys = [storageKey(scope)];

  if (scope === 'guest') {
    keys.push(LEGACY_IMPORT_CORRECTIONS_STORAGE_KEY);
  }

  let cleanupComplete = true;

  keys.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      cleanupComplete = false;
    }
  });

  return cleanupComplete;
}

export function getImportCorrectionKey(item) {
  return (
    normalizeKeyPart(item?.normalizedName) ||
    normalizeKeyPart(item?.displayName) ||
    normalizeKeyPart(item?.sourceLine) ||
    ''
  );
}

export function applyImportCorrections(items, scope = 'guest') {
  const { correctionMap } = readCorrectionMap(scope);

  return items.map((item) => {
    const correctionKey = getImportCorrectionKey(item);
    const correction = Object.hasOwn(correctionMap, correctionKey) ? correctionMap[correctionKey] : null;

    if (!correction) {
      return item;
    }

    return {
      ...item,
      name: correction.name || item.name,
      displayName: correction.name || item.displayName || item.name,
      normalizedName: correction.name || item.normalizedName || item.name,
      category: correction.category || item.category,
      storageType: correction.storageType || item.storageType,
      learnedCorrection: true
    };
  });
}

export function saveImportCorrections(items, scope = 'guest') {
  const { correctionMap, canWrite } = readCorrectionMap(scope);
  if (!canWrite) return false;
  const nextMap = new Map(Object.entries(correctionMap));

  items.forEach((item) => {
    const correctionKey = getImportCorrectionKey(item);

    if (!correctionKey || !item.name) {
      return;
    }

    nextMap.set(correctionKey, {
      name: item.name,
      category: item.category,
      storageType: item.storageType,
      updatedAt: new Date().toISOString()
    });
  });

  const trimmedEntries = [...nextMap.entries()]
    .sort((left, right) => String(right[1].updatedAt).localeCompare(String(left[1].updatedAt)))
    .slice(0, MAX_CORRECTION_COUNT);

  return writeCorrectionMap(Object.fromEntries(trimmedEntries), scope);
}
