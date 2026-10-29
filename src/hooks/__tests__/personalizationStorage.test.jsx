import { Component, StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authHook from '../useAuth';
import * as api from '../../api/personalizationApi';
import { PantryStaplesProvider, usePantryStaples } from '../usePantryStaples';
import { UserPreferencesProvider, useUserPreferences } from '../useUserPreferences';
import PantryStaplesPanel from '../../components/PantryStaplesPanel';
import PreferenceSettingsPanel from '../../components/PreferenceSettingsPanel';

const auth = { storageScope: 'guest', isAuthenticated: false };
const pantryKey = scope => `fridgemate-pantry-ownership:v2:${scope}`;
const preferenceKey = scope => `fridgemate-user-preferences:v1:${scope}`;
const defaults = { preferredIngredients: [], dislikedIngredients: [], spiceLevel: 'medium', cookingTimePreference: 'flexible' };
let current;

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>설정 화면이 중단됨</p> : this.props.children; }
}
function Pantry() {
  const value = usePantryStaples();
  useEffect(() => { current = value; }, [value]);
  return <PantryStaplesPanel pantryOwnership={value.pantryOwnership} pantrySummary={value.pantrySummary}
    onCycle={value.cyclePantryStatus} error={value.syncError} disabled={value.saving || value.storageReady === false}
    onRetry={value.reloadPantryOwnership} onRetrySave={value.canRetrySave ? value.retryPantrySave : undefined} />;
}
function Preferences() {
  const value = useUserPreferences();
  useEffect(() => { current = value; }, [value]);
  return <PreferenceSettingsPanel />;
}
function App({ kind }) {
  return <StrictMode><Boundary>{kind === 'pantry'
    ? <PantryStaplesProvider><Pantry /></PantryStaplesProvider>
    : <UserPreferencesProvider><Preferences /></UserPreferencesProvider>}</Boundary></StrictMode>;
}
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function mount(kind) {
  const view = render(<App kind={kind} />);
  await act(async () => {});
  return view;
}
function denyWrite(key) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (name, value) {
    if (name === key) throw new DOMException('PRIVATE quota failure', 'QuotaExceededError');
    return original.call(this, name, value);
  });
}
function denyRead(key) {
  const original = Storage.prototype.getItem;
  return vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (name) {
    if (name === key) throw new DOMException('PRIVATE read failure', 'SecurityError');
    return original.call(this, name);
  });
}
const salt = () => screen.getByRole('button', { name: /^소금\s*(보유|미보유|모름)$/ });
const submit = () => fireEvent.click(screen.getByRole('button', { name: '취향 저장' }));

beforeEach(() => {
  localStorage.clear();
  auth.storageScope = 'guest'; auth.isAuthenticated = false;
  vi.spyOn(authHook, 'useAuth').mockImplementation(() => auth);
  vi.spyOn(api, 'getPantryOwnership').mockResolvedValue([]);
  vi.spyOn(api, 'savePantryOwnership').mockResolvedValue([]);
  vi.spyOn(api, 'getUserPreferences').mockResolvedValue(defaults);
  vi.spyOn(api, 'saveUserPreferences').mockImplementation(async value => value);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('pantry settings storage boundaries', () => {
  it('preserves guest legacy ownership and never imports it into an account scope', async () => {
    localStorage.setItem('fridgemate-pantry-ownership', JSON.stringify({ salt: 'owned' }));
    const view = await mount('pantry');
    expect(salt()).toHaveTextContent('보유');
    auth.storageScope = 'user:other';
    view.rerender(<App kind="pantry" />);
    await waitFor(() => expect(salt()).toHaveTextContent('모름'));
    expect(localStorage.getItem('fridgemate-pantry-ownership')).toBe('{"salt":"owned"}');
  });

  it('retains the saved recommendation state when a local write fails and allows retry', async () => {
    localStorage.setItem(pantryKey('guest'), '{"salt":"owned"}');
    await mount('pantry');
    const write = denyWrite(pantryKey('guest'));
    fireEvent.click(salt());
    expect(screen.queryByText('설정 화면이 중단됨')).not.toBeInTheDocument();
    expect(salt()).toHaveTextContent('보유');
    expect(current.pantryOwnership).toEqual({ salt: 'owned' });
    expect(screen.getByRole('alert')).toHaveTextContent(/이 기기.*저장하지 못/);
    expect(document.body.textContent).not.toContain('PRIVATE');
    expect(localStorage.getItem(pantryKey('guest'))).toBe('{"salt":"owned"}');
    write.mockRestore();
    fireEvent.click(salt());
    expect(salt()).toHaveTextContent('미보유');
    expect(localStorage.getItem(pantryKey('guest'))).toBe('{"salt":"missing"}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('distinguishes an unreadable initial value from no ownership and rechecks without overwriting', async () => {
    localStorage.setItem(pantryKey('guest'), '{"salt":"owned"}');
    const read = denyRead(pantryKey('guest'));
    await mount('pantry');
    expect(screen.getByRole('alert')).toHaveTextContent(/불러오지 못/);
    expect(salt()).toBeDisabled();
    read.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '팬트리 설정 다시 확인' }));
    await waitFor(() => expect(salt()).toBeEnabled());
    expect(salt()).toHaveTextContent('보유');
    expect(localStorage.getItem(pantryKey('guest'))).toBe('{"salt":"owned"}');
  });

  it('reports remote failure while preserving the successful local ownership write', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    vi.mocked(api.savePantryOwnership).mockRejectedValue(new Error('PRIVATE server failure'));
    await mount('pantry');
    fireEvent.click(salt());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/서버.*실패.*이 기기/));
    expect(salt()).toHaveTextContent('보유');
    expect(localStorage.getItem(pantryKey('user:one'))).toBe('{"salt":"owned"}');
    expect(document.body.textContent).not.toContain('PRIVATE');
    vi.mocked(api.savePantryOwnership).mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: '팬트리 다시 저장' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(salt()).toHaveTextContent('보유');
    expect(api.savePantryOwnership).toHaveBeenLastCalledWith([{ stapleId: 'salt', status: 'owned' }]);
  });

  it('does not mislabel a fetched server value as a server read failure when cache writing fails', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    localStorage.setItem(pantryKey('user:one'), '{"salt":"owned"}');
    vi.mocked(api.getPantryOwnership).mockResolvedValue([{ stapleId: 'salt', status: 'missing' }]);
    denyWrite(pantryKey('user:one'));
    await mount('pantry');
    expect(salt()).toHaveTextContent('보유');
    expect(screen.getByRole('alert')).toHaveTextContent(/서버.*불러왔지만.*이 기기/);
  });

  it('sends one remote write in StrictMode and blocks duplicate actions while it is pending', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred();
    vi.mocked(api.savePantryOwnership).mockReturnValue(remote.promise);
    await mount('pantry');
    act(() => { current.cyclePantryStatus('salt'); current.cyclePantryStatus('salt'); });
    expect(api.savePantryOwnership).toHaveBeenCalledTimes(1);
    expect(api.savePantryOwnership).toHaveBeenCalledWith([{ stapleId: 'salt', status: 'owned' }]);
    expect(salt()).toBeDisabled();
    await act(async () => remote.resolve([]));
    expect(salt()).toBeEnabled();
    expect(salt()).toHaveTextContent('보유');
  });

  it('does not overwrite an explicit local edit with an older remote load', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred();
    vi.mocked(api.getPantryOwnership).mockReturnValue(remote.promise);
    await mount('pantry');
    fireEvent.click(salt());
    await act(async () => {});
    await act(async () => remote.resolve([{ stapleId: 'salt', status: 'missing' }]));
    expect(salt()).toHaveTextContent('보유');
    expect(localStorage.getItem(pantryKey('user:one'))).toBe('{"salt":"owned"}');
  });

  it('ignores an old save failure after switching away and back to the account', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred();
    vi.mocked(api.savePantryOwnership).mockReturnValue(remote.promise);
    const view = await mount('pantry');
    fireEvent.click(salt());
    auth.storageScope = 'user:two'; view.rerender(<App kind="pantry" />);
    await act(async () => {});
    auth.storageScope = 'user:one'; view.rerender(<App kind="pantry" />);
    await act(async () => {});
    await act(async () => remote.reject(new Error('old private error')));
    expect(current.syncError).toBe('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(salt()).toHaveTextContent('보유');
  });

  it('never sends a remote mutation when the authenticated local write failed', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    await mount('pantry');
    denyWrite(pantryKey('user:one'));
    fireEvent.click(salt());
    expect(api.savePantryOwnership).not.toHaveBeenCalled();
    expect(current.pantryOwnership).toEqual({});
    expect(localStorage.getItem(pantryKey('user:one'))).toBe('{}');
  });
});

describe('preference settings storage boundaries', () => {
  it.each([
    { label: '매운맛', field: 'spiceLevel', value: 'spicy' },
    { label: '조리 여유', field: 'cookingTimePreference', value: 'quick' }
  ])('distinguishes a $label-only save from unsaved ingredient text', async ({ label, field, value }) => {
    await mount('preferences');
    fireEvent.change(screen.getByLabelText('선호 재료'), { target: { value: '두부' } });
    fireEvent.change(screen.getByLabelText('비선호 재료'), { target: { value: '오이' } });
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

    const saved = JSON.parse(localStorage.getItem(preferenceKey('guest')));
    expect(saved[field]).toBe(value);
    expect(saved.preferredIngredients).toEqual([]);
    expect(saved.dislikedIngredients).toEqual([]);
    expect(current.preferences.preferredIngredients).toEqual([]);
    expect(screen.getByLabelText('선호 재료')).toHaveValue('두부');
    expect(screen.getByLabelText('비선호 재료')).toHaveValue('오이');
    expect(screen.getByRole('status')).toHaveTextContent(`${label} 설정을 저장했습니다.`);
    expect(screen.getByRole('status')).toHaveTextContent('입력한 재료는 ‘취향 저장’을 눌러 저장해주세요.');
    expect(screen.queryByText('취향 설정을 저장했습니다.')).not.toBeInTheDocument();

    submit();
    await waitFor(() => expect(current.preferences.preferredIngredients).toEqual(['두부']));
    expect(current.preferences.dislikedIngredients).toEqual(['오이']);
    expect(screen.getByRole('status')).toHaveTextContent('취향 설정을 저장했습니다.');
    expect(screen.getByRole('status')).not.toHaveTextContent('입력한 재료는');
  });

  it('keeps unsaved text and previous recommendations on quota failure, then saves on retry', async () => {
    localStorage.setItem(preferenceKey('guest'), JSON.stringify({ ...defaults, preferredIngredients: ['감자'] }));
    await mount('preferences');
    fireEvent.change(screen.getByLabelText('선호 재료'), { target: { value: '두부' } });
    const write = denyWrite(preferenceKey('guest'));
    submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/이 기기.*저장하지 못/));
    expect(current.preferences.preferredIngredients).toEqual(['감자']);
    expect(screen.getByLabelText('선호 재료')).toHaveValue('두부');
    expect(screen.queryByText('취향 설정을 저장했습니다.')).not.toBeInTheDocument();
    write.mockRestore(); submit();
    await waitFor(() => expect(current.preferences.preferredIngredients).toEqual(['두부']));
    expect(JSON.parse(localStorage.getItem(preferenceKey('guest'))).preferredIngredients).toEqual(['두부']);
  });

  it('clears an earlier saved message when a later dropdown save fails', async () => {
    await mount('preferences'); submit();
    await waitFor(() => expect(screen.getByText(/취향 설정.*저장/)).toBeInTheDocument());
    denyWrite(preferenceKey('guest'));
    fireEvent.change(screen.getByLabelText('매운맛'), { target: { value: 'spicy' } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/이 기기.*저장하지 못/));
    expect(screen.queryByText('취향 설정을 저장했습니다.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('매운맛')).toHaveValue('medium');
    expect(current.preferences.spiceLevel).toBe('medium');
  });

  it('surfaces an initial read failure and explicitly reloads the existing preferences', async () => {
    localStorage.setItem(preferenceKey('guest'), JSON.stringify({ ...defaults, preferredIngredients: ['감자'] }));
    const read = denyRead(preferenceKey('guest'));
    await mount('preferences');
    expect(screen.getByRole('alert')).toHaveTextContent(/불러오지 못/);
    expect(screen.getByRole('button', { name: '취향 저장' })).toBeDisabled();
    read.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '취향 설정 다시 확인' }));
    await waitFor(() => expect(screen.getByLabelText('선호 재료')).toHaveValue('감자'));
    expect(screen.getByRole('button', { name: '취향 저장' })).toBeEnabled();
  });

  it('distinguishes a successful remote save from a failed normalized-response cache write', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred();
    vi.mocked(api.saveUserPreferences).mockReturnValue(remote.promise);
    await mount('preferences');
    fireEvent.change(screen.getByLabelText('선호 재료'), { target: { value: '두부' } });
    submit();
    await waitFor(() => expect(api.saveUserPreferences).toHaveBeenCalledTimes(1));
    denyWrite(preferenceKey('user:one'));
    await act(async () => remote.resolve({ ...defaults, preferredIngredients: ['버섯'] }));
    expect(screen.getByRole('alert')).toHaveTextContent(/서버.*저장.*이 기기.*반영하지 못/);
    expect(current.preferences.preferredIngredients).toEqual(['두부']);
    expect(JSON.parse(localStorage.getItem(preferenceKey('user:one'))).preferredIngredients).toEqual(['두부']);
    expect(screen.getByRole('button', { name: '취향 저장' })).toBeEnabled();
  });

  it('keeps the local write and reports safe local-fallback wording after remote rejection', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    vi.mocked(api.saveUserPreferences).mockRejectedValue(new Error('PRIVATE upstream request'));
    await mount('preferences');
    fireEvent.change(screen.getByLabelText('선호 재료'), { target: { value: '두부' } }); submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/서버.*실패.*이 기기/));
    expect(current.preferences.preferredIngredients).toEqual(['두부']);
    expect(JSON.parse(localStorage.getItem(preferenceKey('user:one'))).preferredIngredients).toEqual(['두부']);
    expect(document.body.textContent).not.toContain('PRIVATE');
  });

  it('blocks synchronous double submit and disables every input until acknowledgement', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred();
    vi.mocked(api.saveUserPreferences).mockReturnValue(remote.promise);
    await mount('preferences');
    const form = screen.getByRole('button', { name: '취향 저장' }).closest('form');
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(api.saveUserPreferences).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('선호 재료')).toBeDisabled();
    expect(screen.getByLabelText('매운맛')).toBeDisabled();
    await act(async () => remote.resolve(defaults));
    expect(screen.getByLabelText('선호 재료')).toBeEnabled();
  });

  it('ignores a remote load that started before an explicit preference save', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred();
    vi.mocked(api.getUserPreferences).mockReturnValue(remote.promise);
    await mount('preferences');
    fireEvent.change(screen.getByLabelText('선호 재료'), { target: { value: '두부' } }); submit();
    await act(async () => {});
    await act(async () => remote.resolve({ ...defaults, preferredIngredients: ['버섯'] }));
    expect(current.preferences.preferredIngredients).toEqual(['두부']);
    expect(JSON.parse(localStorage.getItem(preferenceKey('user:one'))).preferredIngredients).toEqual(['두부']);
  });

  it('does not recreate cleared account data or replace a newer session after an away-and-back response', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred();
    vi.mocked(api.saveUserPreferences).mockReturnValue(remote.promise);
    const view = await mount('preferences');
    fireEvent.change(screen.getByLabelText('선호 재료'), { target: { value: '두부' } }); submit();
    auth.storageScope = 'guest'; auth.isAuthenticated = false; view.rerender(<App kind="preferences" />);
    await act(async () => {});
    localStorage.removeItem(preferenceKey('user:one'));
    const newLoad = deferred();
    vi.mocked(api.getUserPreferences).mockReturnValue(newLoad.promise);
    auth.storageScope = 'user:one'; auth.isAuthenticated = true; view.rerender(<App kind="preferences" />);
    await act(async () => {});
    await act(async () => remote.resolve({ ...defaults, preferredIngredients: ['버섯'] }));
    expect(localStorage.getItem(preferenceKey('user:one'))).toBeNull();
    expect(current.preferences.preferredIngredients).toEqual([]);
    expect(screen.queryByText('취향 설정을 저장했습니다.')).not.toBeInTheDocument();
    await act(async () => newLoad.resolve({ ...defaults, preferredIngredients: ['감자'] }));
    expect(current.preferences.preferredIngredients).toEqual(['감자']);
  });

  it('does not write a late acknowledgement after the settings provider unmounts', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred();
    vi.mocked(api.saveUserPreferences).mockReturnValue(remote.promise);
    const view = await mount('preferences'); submit();
    view.unmount(); localStorage.removeItem(preferenceKey('user:one'));
    await act(async () => remote.resolve(defaults));
    expect(localStorage.getItem(preferenceKey('user:one'))).toBeNull();
  });
});

describe.each(['pantry', 'preferences'])('%s cross-tab storage boundaries', kind => {
  const keyFor = kind === 'pantry' ? pantryKey : preferenceKey;
  const snapshot = kind === 'pantry' ? { salt: 'missing' } : { ...defaults, preferredIngredients: ['감자'] };
  const getValue = () => kind === 'pantry' ? current.pantryOwnership : current.preferences;
  const getRemote = () => kind === 'pantry' ? api.getPantryOwnership : api.getUserPreferences;
  const saveRemote = () => kind === 'pantry' ? api.savePantryOwnership : api.saveUserPreferences;
  const remoteValue = kind === 'pantry' ? [{ stapleId: 'salt', status: 'owned' }] : { ...defaults, preferredIngredients: ['버섯'] };

  it('keeps structurally damaged stored data intact and exposes a read error instead of crashing', async () => {
    const damaged = kind === 'pantry' ? '{"salt":"invalid-status"}' : '{"preferredIngredients":"두부"}';
    localStorage.setItem(keyFor('guest'), damaged);
    await mount(kind);
    expect(screen.queryByText('설정 화면이 중단됨')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/불러오지 못/);
    expect(localStorage.getItem(keyFor('guest'))).toBe(damaged);
    expect(document.body.textContent).not.toContain('NaN');
  });

  it('uses a current local storage event without allowing an older GET to overwrite it', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred(); vi.mocked(getRemote()).mockReturnValue(remote.promise);
    await mount(kind);
    localStorage.setItem(keyFor('user:one'), JSON.stringify(snapshot));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: keyFor('user:one'), storageArea: localStorage })));
    await act(async () => remote.resolve(remoteValue));
    expect(getValue()).toEqual(snapshot);
    expect(JSON.parse(localStorage.getItem(keyFor('user:one')))).toEqual(snapshot);
  });

  it('does not recreate settings after another tab clears storage during a pending save', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred(); vi.mocked(saveRemote()).mockReturnValue(remote.promise);
    await mount(kind);
    if (kind === 'pantry') fireEvent.click(salt()); else submit();
    localStorage.clear();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage })));
    await act(async () => remote.resolve(kind === 'pantry' ? [] : { ...defaults, preferredIngredients: ['버섯'] }));
    expect(localStorage.getItem(keyFor('user:one'))).toBeNull();
    expect(getValue()).toEqual(kind === 'pantry' ? {} : defaults);
    expect(current.saving).toBe(false);
  });

  it('ignores another scope or sessionStorage event instead of abandoning an active save', async () => {
    auth.isAuthenticated = true; auth.storageScope = 'user:one';
    const remote = deferred(); vi.mocked(saveRemote()).mockReturnValue(remote.promise);
    await mount(kind);
    if (kind === 'pantry') fireEvent.click(salt()); else submit();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: keyFor('user:two'), storageArea: localStorage }));
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: sessionStorage }));
    });
    expect(current.saving).toBe(true);
    await act(async () => remote.resolve(kind === 'pantry' ? [] : { ...defaults, preferredIngredients: ['버섯'] }));
    expect(getValue()).toEqual(kind === 'pantry' ? { salt: 'owned' } : { ...defaults, preferredIngredients: ['버섯'] });
  });
});
