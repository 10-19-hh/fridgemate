import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as learning from '../importLearning.js';

const CURRENT = 'fridgemate-import-corrections:v2:guest';
const LEGACY = 'fridgemate-import-corrections';
const ALICE = 'fridgemate-import-corrections:v2:user:alice';
const BOB = 'fridgemate-import-corrections:v2:user:bob';
const DAMAGED = '{private broken source';
const VALID = '{"우유":{"name":"저지방 우유"}}';

function api() {
  // Establish a feature-absence assertion without relying on an import error.
  expect(learning.inspectImportCorrections).toBeTypeOf('function');
  expect(learning.resetImportCorrections).toBeTypeOf('function');
  return learning;
}

function inspectDamaged(scope = 'guest') {
  const { inspectImportCorrections } = api();
  window.localStorage.setItem(`fridgemate-import-corrections:v2:${scope}`, DAMAGED);
  const inspection = inspectImportCorrections(scope);
  expect(inspection.status).toBe('damaged');
  return inspection.resetToken;
}

describe('explicit import learning recovery', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

  it('inspects empty and healthy storage without writing, deleting or issuing a reset token', () => {
    const { inspectImportCorrections } = api();
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    expect(inspectImportCorrections()).toEqual({ status: 'ready' });
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    set.mockRestore();
    window.localStorage.setItem(CURRENT, VALID);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(inspectImportCorrections()).toEqual({ status: 'ready' });
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(CURRENT)).toBe(VALID);
  });

  it.each(['', 'null', '42', 'true', '"text"', '[]', DAMAGED,
    '{"milk":null}', '{"milk":[]}', '{"milk":{"name":4}}', '{"milk":{"category":false}}',
    '{"milk":{"storageType":{}}}', '{"milk":{"updatedAt":1}}'])('reports damaged format without exposing or rewriting source: %s', (raw) => {
    const { inspectImportCorrections } = api();
    window.localStorage.setItem(CURRENT, raw);
    const result = inspectImportCorrections();
    expect(result.status).toBe('damaged');
    expect(Object.isFrozen(result.resetToken)).toBe(true);
    expect(Reflect.ownKeys(result.resetToken)).toEqual([]);
    expect(JSON.stringify(result)).toBe('{"status":"damaged","resetToken":{}}');
    expect(window.localStorage.getItem(CURRENT)).toBe(raw);
  });

  it('retains safe partial legacy rows without requiring modern fields or migrating them', () => {
    const { inspectImportCorrections } = api();
    const raw = '{"우유":{"category":"기타"}}';
    window.localStorage.setItem(LEGACY, raw);
    expect(inspectImportCorrections()).toEqual({ status: 'ready' });
    expect(learning.applyImportCorrections([{ normalizedName: '우유', name: '우유', category: '유제품' }])[0])
      .toMatchObject({ name: '우유', category: '기타', learnedCorrection: true });
    expect(window.localStorage.getItem(CURRENT)).toBeNull();
    expect(window.localStorage.getItem(LEGACY)).toBe(raw);
  });

  it('uses the present v2 value even when it is empty and never imports guest legacy into an account', () => {
    const { inspectImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    window.localStorage.setItem(CURRENT, '');
    expect(inspectImportCorrections().status).toBe('damaged');
    expect(inspectImportCorrections('user:alice')).toEqual({ status: 'ready' });
    window.localStorage.setItem(CURRENT, VALID);
    window.localStorage.setItem(LEGACY, DAMAGED);
    expect(inspectImportCorrections()).toEqual({ status: 'ready' });
  });

  it.each(['getter', 'current-read', 'legacy-read', 'no-window'])('reports unavailable instead of leaking %s errors', (blocked) => {
    const { inspectImportCorrections } = api();
    const get = Storage.prototype.getItem;
    if (blocked === 'getter') vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('PRIVATE'); });
    else if (blocked === 'no-window') vi.stubGlobal('window', undefined);
    else vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === (blocked === 'current-read' ? CURRENT : LEGACY)) throw new Error('PRIVATE');
      return get.call(this, key);
    });
    expect(inspectImportCorrections()).toEqual({ status: 'unavailable' });
  });

  it.each(['', ' guest', 'user:', 'user:a:b', 'user:../alice', ['guest'], null, {}])('rejects malformed inspection scope before accessing storage: %j', (scope) => {
    const { inspectImportCorrections } = api();
    const get = vi.spyOn(Storage.prototype, 'getItem');
    expect(inspectImportCorrections(scope)).toEqual({ status: 'unavailable' });
    expect(get).not.toHaveBeenCalled();
  });

  it('does not promise writable storage merely because inspection was ready', () => {
    const { inspectImportCorrections } = api();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('PRIVATE quota'); });
    expect(inspectImportCorrections()).toEqual({ status: 'ready' });
    expect(learning.saveImportCorrections([{ normalizedName: '우유', name: '저지방 우유' }])).toBe(false);
  });

  it('issues a fresh opaque confirmation on every damaged inspection', () => {
    const { inspectImportCorrections } = api();
    window.localStorage.setItem(CURRENT, DAMAGED);
    const first = inspectImportCorrections();
    const second = inspectImportCorrections();
    expect(first.resetToken).not.toBe(second.resetToken);
    expect(Reflect.ownKeys(first.resetToken)).toEqual([]);
    expect(Reflect.ownKeys(second.resetToken)).toEqual([]);
  });

  it('resets damaged legacy-only data and permits new learning after both old keys are absent', () => {
    const { inspectImportCorrections, resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, '');
    const { resetToken } = inspectImportCorrections();
    expect(resetImportCorrections({ scope: 'guest', resetToken })).toEqual({ status: 'reset' });
    expect(window.localStorage.getItem(CURRENT)).toBeNull();
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
    expect(learning.saveImportCorrections([{ normalizedName: '우유', name: '새 우유', category: '유제품', storageType: '냉장' }])).toBe(true);
    expect(inspectImportCorrections()).toEqual({ status: 'ready' });
    expect(learning.applyImportCorrections([{ normalizedName: '우유', name: '우유' }])[0])
      .toMatchObject({ name: '새 우유', learnedCorrection: true });
  });

  it('resets only confirmed guest learning keys, legacy first, leaving inventory and account keys intact', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    window.localStorage.setItem(ALICE, VALID);
    window.localStorage.setItem('fridgemate-ingredients', 'inventory sentinel');
    window.localStorage.setItem('fridgemate-shopping', 'shopping sentinel');
    const token = inspectDamaged();
    const remove = Storage.prototype.removeItem;
    const order = [];
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      order.push(key);
      return remove.call(this, key);
    });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'reset' });
    expect(order).toEqual([LEGACY, CURRENT]);
    expect(window.localStorage.getItem(CURRENT)).toBeNull();
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
    expect(window.localStorage.getItem(ALICE)).toBe(VALID);
    expect(window.localStorage.getItem('fridgemate-ingredients')).toBe('inventory sentinel');
    expect(window.localStorage.getItem('fridgemate-shopping')).toBe('shopping sentinel');
    expect(learning.applyImportCorrections([{ normalizedName: '우유', name: '우유' }])).toEqual([{ normalizedName: '우유', name: '우유' }]);
  });

  it('resets a single signed-in scope without reading or deleting guest or another account', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    window.localStorage.setItem(CURRENT, VALID);
    window.localStorage.setItem(BOB, VALID);
    const token = inspectDamaged('user:alice');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    expect(resetImportCorrections({ scope: 'user:alice', resetToken: token })).toEqual({ status: 'reset' });
    expect(read.mock.calls.every(([key]) => key === ALICE)).toBe(true);
    read.mockRestore();
    expect(window.localStorage.getItem(ALICE)).toBeNull();
    expect(window.localStorage.getItem(LEGACY)).toBe(VALID);
    expect(window.localStorage.getItem(CURRENT)).toBe(VALID);
    expect(window.localStorage.getItem(BOB)).toBe(VALID);
  });

  it('requires the actual opaque token and consumes it on the first reset attempt', () => {
    const { resetImportCorrections } = api();
    const token = inspectDamaged();
    for (const fake of [{}, { ...token }, JSON.parse(JSON.stringify(token)), null, 'token']) {
      expect(resetImportCorrections({ scope: 'guest', resetToken: fake })).toEqual({ status: 'invalid' });
      expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
    }
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'reset' });
    window.localStorage.setItem(CURRENT, DAMAGED);
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'invalid' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
  });

  it.each(['user:alice', 'user:a:b', null])('consumes a token used with the wrong scope %j without deleting anything', (scope) => {
    const { resetImportCorrections } = api();
    const token = inspectDamaged();
    expect(resetImportCorrections({ scope, resetToken: token })).toEqual({ status: 'invalid' });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'invalid' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
  });

  it.each(['false', 'throw'])('does not delete when the account guard returns %s and does not reuse that confirmation', (guard) => {
    const { resetImportCorrections } = api();
    const token = inspectDamaged();
    const isCurrent = () => { if (guard === 'throw') throw new Error('PRIVATE'); return false; };
    expect(resetImportCorrections({ scope: 'guest', resetToken: token }, { isCurrent })).toEqual({ status: 'changed' });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'invalid' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
  });

  it('rechecks the account guard after snapshot reads immediately before removal', () => {
    const { resetImportCorrections } = api();
    const token = inspectDamaged('user:alice');
    const get = Storage.prototype.getItem;
    let current = true;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      const result = get.call(this, key);
      current = false;
      return result;
    });
    expect(resetImportCorrections({ scope: 'user:alice', resetToken: token }, { isCurrent: () => current }))
      .toEqual({ status: 'changed' });
    expect(window.localStorage.getItem(ALICE)).toBe(DAMAGED);
  });

  it.each(['getter', 'read', 'no-window'])('consumes a confirmation without deleting data when reset %s becomes unavailable', (blocked) => {
    const { resetImportCorrections } = api();
    const token = inspectDamaged();
    let blockedAccess;
    if (blocked === 'no-window') vi.stubGlobal('window', undefined);
    else blockedAccess = blocked === 'getter'
      ? vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('PRIVATE'); })
      : vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('PRIVATE'); });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'unavailable' });
    if (blockedAccess) blockedAccess.mockRestore();
    vi.unstubAllGlobals();
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'invalid' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
  });

  it('fails closed and consumes the token when the supplied guard is not a function', () => {
    const { resetImportCorrections } = api();
    const token = inspectDamaged();
    expect(resetImportCorrections({ scope: 'guest', resetToken: token }, { isCurrent: true })).toEqual({ status: 'invalid' });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'invalid' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
  });

  it.each(['current-changed', 'current-removed', 'legacy-changed', 'legacy-removed', 'legacy-added'])('does not delete when %s since inspection', (change) => {
    const { resetImportCorrections } = api();
    if (change !== 'legacy-added') window.localStorage.setItem(LEGACY, VALID);
    const token = inspectDamaged();
    if (change === 'current-changed') window.localStorage.setItem(CURRENT, '');
    if (change === 'current-removed') window.localStorage.removeItem(CURRENT);
    if (change === 'legacy-changed') window.localStorage.setItem(LEGACY, '{}');
    if (change === 'legacy-removed') window.localStorage.removeItem(LEGACY);
    if (change === 'legacy-added') window.localStorage.setItem(LEGACY, '');
    const before = [window.localStorage.getItem(CURRENT), window.localStorage.getItem(LEGACY)];
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'changed' });
    expect(remove).not.toHaveBeenCalled();
    expect([window.localStorage.getItem(CURRENT), window.localStorage.getItem(LEGACY)]).toEqual(before);
  });

  it('does not clear v2 when removing legacy throws, preventing legacy reappearance', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    const token = inspectDamaged();
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      if (key === LEGACY) throw new Error('PRIVATE');
      return remove.call(this, key);
    });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'unavailable' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
    expect(window.localStorage.getItem(LEGACY)).toBe(VALID);
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'invalid' });
  });

  it('does not clear v2 when legacy removal reports no error but leaves the value present', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    const token = inspectDamaged();
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      if (key !== LEGACY) return remove.call(this, key);
    });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'unavailable' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
    expect(window.localStorage.getItem(LEGACY)).toBe(VALID);
  });

  it('reports partial when legacy was removed but v2 removal fails without rolling legacy back', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    const token = inspectDamaged();
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      if (key === CURRENT) throw new Error('PRIVATE');
      return remove.call(this, key);
    });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'partial' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
  });

  it('stops before v2 deletion when another key changes during legacy readback', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    const token = inspectDamaged();
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      const result = remove.call(this, key);
      if (key === LEGACY) this.setItem(CURRENT, 'new private source');
      return result;
    });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'partial' });
    expect(window.localStorage.getItem(CURRENT)).toBe('new private source');
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
  });

  it('rechecks the account guard before removing v2 after legacy removal', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    const token = inspectDamaged();
    const isCurrent = () => window.localStorage.getItem(LEGACY) !== null;
    expect(resetImportCorrections({ scope: 'guest', resetToken: token }, { isCurrent })).toEqual({ status: 'partial' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
  });

  it('detects a reappearing deleted legacy key before removing v2', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    const token = inspectDamaged();
    const get = Storage.prototype.getItem;
    let nullReads = 0;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === LEGACY && get.call(this, key) === null) {
        nullReads += 1;
        if (nullReads === 2) this.setItem(LEGACY, 'new legacy');
      }
      return get.call(this, key);
    });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'partial' });
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
    expect(window.localStorage.getItem(LEGACY)).toBe('new legacy');
  });

  it('does not report reset when readback becomes unavailable after removal', () => {
    const { resetImportCorrections } = api();
    const token = inspectDamaged('user:alice');
    const get = Storage.prototype.getItem;
    const remove = Storage.prototype.removeItem;
    let removed = false;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      const result = remove.call(this, key);
      removed = true;
      return result;
    });
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (removed) throw new Error('PRIVATE readback');
      return get.call(this, key);
    });
    expect(resetImportCorrections({ scope: 'user:alice', resetToken: token })).toEqual({ status: 'partial' });
    read.mockRestore();
    expect(window.localStorage.getItem(ALICE)).toBeNull();
  });

  it('reports partial if a failed removal already deleted its key', () => {
    const { resetImportCorrections } = api();
    window.localStorage.setItem(LEGACY, VALID);
    const token = inspectDamaged();
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      remove.call(this, key);
      throw new Error('PRIVATE post-write failure');
    });
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'partial' });
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
    expect(window.localStorage.getItem(CURRENT)).toBe(DAMAGED);
  });

  it('checks all keys once more before claiming reset', () => {
    const { resetImportCorrections } = api();
    const token = inspectDamaged('user:alice');
    const get = Storage.prototype.getItem;
    let nullReads = 0;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === ALICE && get.call(this, key) === null) {
        nullReads += 1;
        if (nullReads === 2) this.setItem(ALICE, 'new data');
      }
      return get.call(this, key);
    });
    expect(resetImportCorrections({ scope: 'user:alice', resetToken: token })).toEqual({ status: 'partial' });
    expect(window.localStorage.getItem(ALICE)).toBe('new data');
  });

  it('allows learning and applying new corrections after an explicitly confirmed reset', () => {
    const { resetImportCorrections, inspectImportCorrections } = api();
    const token = inspectDamaged();
    expect(resetImportCorrections({ scope: 'guest', resetToken: token })).toEqual({ status: 'reset' });
    expect(learning.saveImportCorrections([{ normalizedName: '우유', name: '새 우유', category: '유제품', storageType: '냉장' }])).toBe(true);
    expect(inspectImportCorrections()).toEqual({ status: 'ready' });
    expect(learning.applyImportCorrections([{ normalizedName: '우유', name: '우유' }])[0])
      .toMatchObject({ name: '새 우유', learnedCorrection: true });
  });
});
