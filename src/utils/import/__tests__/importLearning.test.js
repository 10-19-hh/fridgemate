import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyImportCorrections,
  clearImportCorrections,
  getImportCorrectionKey,
  saveImportCorrections
} from '../importLearning.js';

const STORAGE_KEY = 'fridgemate-import-corrections:v2:guest';

function createImportItem(overrides = {}) {
  return {
    id: 'item-1',
    name: '우유',
    displayName: '우유',
    normalizedName: '우유',
    category: '유제품',
    storageType: '냉장',
    sourceLine: '서울우유 1L',
    ...overrides
  };
}

describe('importLearning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T12:00:00.000Z'));
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  describe('getImportCorrectionKey', () => {
    it('builds the correction key from normalizedName first', () => {
      const item = createImportItem({
        normalizedName: '  우유  ',
        displayName: '서울우유',
        sourceLine: '서울우유 1L'
      });

      expect(getImportCorrectionKey(item)).toBe('우유');
    });
  });

  describe('saveImportCorrections', () => {
    it('stores corrected name, category, and storage type in localStorage', () => {
      saveImportCorrections([
        createImportItem({
          name: '두부',
          normalizedName: '두부',
          category: '기타',
          storageType: '냉장'
        })
      ]);

      const savedMap = JSON.parse(window.localStorage.getItem(STORAGE_KEY));

      expect(savedMap).toMatchObject({
        두부: {
          name: '두부',
          category: '기타',
          storageType: '냉장',
          updatedAt: '2026-03-18T12:00:00.000Z'
        }
      });
    });

    it('overwrites learning data for the same product key', () => {
      saveImportCorrections([
        createImportItem({
          name: '양파',
          normalizedName: '양파',
          category: '채소',
          storageType: '실온'
        })
      ]);

      vi.setSystemTime(new Date('2026-03-19T09:30:00.000Z'));

      saveImportCorrections([
        createImportItem({
          name: '깐양파',
          normalizedName: '양파',
          category: '기타',
          storageType: '냉장'
        })
      ]);

      const savedMap = JSON.parse(window.localStorage.getItem(STORAGE_KEY));

      expect(Object.keys(savedMap)).toEqual(['양파']);
      expect(savedMap['양파']).toMatchObject({
        name: '깐양파',
        category: '기타',
        storageType: '냉장',
        updatedAt: '2026-03-19T09:30:00.000Z'
      });
    });
  });

  describe('applyImportCorrections', () => {
    it('reapplies learned corrections on the next import', () => {
      saveImportCorrections([
        createImportItem({
          name: '깐양파',
          normalizedName: '양파',
          category: '기타',
          storageType: '냉장'
        })
      ]);

      const correctedItems = applyImportCorrections([
        createImportItem({
          id: 'item-2',
          name: '양파',
          displayName: '양파',
          normalizedName: '양파',
          category: '채소',
          storageType: '실온'
        })
      ]);

      expect(correctedItems[0]).toMatchObject({
        name: '깐양파',
        displayName: '깐양파',
        normalizedName: '깐양파',
        category: '기타',
        storageType: '냉장',
        learnedCorrection: true
      });
    });

    it('returns the original items when localStorage is empty', () => {
      const items = [
        createImportItem({
          id: 'item-3',
          name: '오이',
          displayName: '오이',
          normalizedName: '오이',
          category: '채소',
          storageType: '냉장'
        })
      ];

      const correctedItems = applyImportCorrections(items);

      expect(correctedItems).toEqual(items);
    });

    it('keeps learned corrections isolated between signed-in users', () => {
      saveImportCorrections(
        [createImportItem({ name: '사용자1 우유', normalizedName: '우유' })],
        'user:user-1'
      );

      const userOneItems = applyImportCorrections(
        [createImportItem({ normalizedName: '우유' })],
        'user:user-1'
      );
      const userTwoItems = applyImportCorrections(
        [createImportItem({ normalizedName: '우유' })],
        'user:user-2'
      );

      expect(userOneItems[0].name).toBe('사용자1 우유');
      expect(userTwoItems[0].name).toBe('우유');
    });
  });

  describe('clearImportCorrections', () => {
    it('removes only the requested authenticated scope', () => {
      saveImportCorrections(
        [createImportItem({ name: '사용자1 우유', normalizedName: '우유' })],
        'user:user-1'
      );
      saveImportCorrections(
        [createImportItem({ name: '사용자2 우유', normalizedName: '우유' })],
        'user:user-2'
      );

      expect(clearImportCorrections('user:user-1')).toBe(true);
      expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:user-1')).toBeNull();
      expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:user-2')).not.toBeNull();
    });

    it('removes both current and legacy guest correction keys', () => {
      window.localStorage.setItem(STORAGE_KEY, '{}');
      window.localStorage.setItem('fridgemate-import-corrections', '{}');

      expect(clearImportCorrections()).toBe(true);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem('fridgemate-import-corrections')).toBeNull();
    });
  });

  describe('damaged or unavailable auxiliary storage', () => {
    it.each(['', 'null', '42', 'true', '"milk"', '[]', '[{"name":"변경"}]', '{broken'])('ignores damaged root %s without replacing the original', (raw) => {
      window.localStorage.setItem(STORAGE_KEY, raw);
      const items = [createImportItem({ normalizedName: '0' })];

      expect(applyImportCorrections(items)).toEqual(items);
      expect(saveImportCorrections(items)).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    });

    it.each([null, [], '변경', 10, { name: { value: '변경' } }, { category: ['채소'] }, { storageType: false }, { updatedAt: 4 }].map((row) => [row]))('ignores a damaged row %j while retaining safe rows and the original source', (invalidRow) => {
      const raw = JSON.stringify({ 우유: invalidRow, 두부: { name: '손두부' } });
      window.localStorage.setItem(STORAGE_KEY, raw);
      const items = [createImportItem(), createImportItem({ name: '두부', normalizedName: '두부' })];

      expect(applyImportCorrections(items)).toEqual([
        items[0],
        expect.objectContaining({ name: '손두부', learnedCorrection: true })
      ]);
      expect(saveImportCorrections(items)).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    });

    it('keeps partial legacy fields and raw item metadata without leaking guest corrections to accounts', () => {
      const raw = JSON.stringify({ 우유: { category: '기타' } });
      window.localStorage.setItem('fridgemate-import-corrections', raw);
      const item = createImportItem({ memo: '원문 메모' });

      expect(applyImportCorrections([item])).toEqual([
        { ...item, category: '기타', learnedCorrection: true }
      ]);
      expect(applyImportCorrections([item], 'user:alice')).toEqual([item]);
      expect(window.localStorage.getItem('fridgemate-import-corrections')).toBe(raw);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does not fall back to legacy learning when the current key contains damaged empty text', () => {
      const legacy = '{"우유":{"name":"이전 우유"}}';
      window.localStorage.setItem(STORAGE_KEY, '');
      window.localStorage.setItem('fridgemate-import-corrections', legacy);
      const items = [createImportItem()];

      expect(applyImportCorrections(items)).toEqual(items);
      expect(saveImportCorrections(items)).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe('');
      expect(window.localStorage.getItem('fridgemate-import-corrections')).toBe(legacy);
    });

    it('does not replace a damaged empty legacy source when the current guest key is absent', () => {
      window.localStorage.setItem('fridgemate-import-corrections', '');
      const items = [createImportItem()];
      expect(applyImportCorrections(items)).toEqual(items);
      expect(saveImportCorrections(items)).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem('fridgemate-import-corrections')).toBe('');
    });

    it('never applies inherited object properties as learned rows', () => {
      const items = [createImportItem({ normalizedName: '__proto__' }), createImportItem({ normalizedName: 'constructor' })];
      expect(applyImportCorrections(items)).toEqual(items);
    });

    it('returns unsuccessful save and clear results when the localStorage getter is blocked', () => {
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('private detail', 'SecurityError'); });
      const items = [createImportItem()];

      expect(applyImportCorrections(items)).toEqual(items);
      expect(saveImportCorrections(items)).toBe(false);
      expect(clearImportCorrections()).toBe(false);
    });

    it('does not overwrite an unreadable map when getItem fails', () => {
      window.localStorage.setItem(STORAGE_KEY, '{"우유":{"name":"기존 우유"}}');
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('read blocked'); });
      const items = [createImportItem()];

      expect(applyImportCorrections(items)).toEqual(items);
      expect(saveImportCorrections(items)).toBe(false);
      getItem.mockRestore();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{"우유":{"name":"기존 우유"}}');
    });

    it('returns false instead of throwing when quota prevents learning', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
      expect(saveImportCorrections([createImportItem()])).toBe(false);
    });

    it('reports incomplete cleanup without erasing other scopes when one key removal fails', () => {
      window.localStorage.setItem(STORAGE_KEY, '{}');
      window.localStorage.setItem('fridgemate-import-corrections', '{}');
      window.localStorage.setItem('fridgemate-import-corrections:v2:user:alice', '{}');
      const removeItem = Storage.prototype.removeItem;
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
        if (key === STORAGE_KEY) throw new Error('blocked');
        return removeItem.call(this, key);
      });

      expect(clearImportCorrections()).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{}');
      expect(window.localStorage.getItem('fridgemate-import-corrections')).toBeNull();
      expect(window.localStorage.getItem('fridgemate-import-corrections:v2:user:alice')).toBe('{}');
    });

    it('keeps SSR cleanup a no-op success but does not claim learning was persisted', () => {
      vi.stubGlobal('window', undefined);
      expect(applyImportCorrections([createImportItem()])).toEqual([createImportItem()]);
      expect(saveImportCorrections([createImportItem()])).toBe(false);
      expect(clearImportCorrections()).toBe(true);
    });

    it('returns successful saves and retains the newest 300 normalized keys', () => {
      const oldMap = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`old-${index}`, { name: `기존 ${index}`, updatedAt: '2026-01-01T00:00:00.000Z' }]));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(oldMap));
      expect(saveImportCorrections([createImportItem({ normalizedName: '  MILK  ', name: ' 새 우유 ' })])).toBe(true);
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      expect(Object.keys(saved)).toHaveLength(300);
      expect(saved.milk).toMatchObject({ name: ' 새 우유 ', updatedAt: '2026-03-18T12:00:00.000Z' });
    });
  });
});
