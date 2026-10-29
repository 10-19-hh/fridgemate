import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authHook from '../../hooks/useAuth';
import * as consent from '../../features/mealPlans/mealPlanPilotConsent';
import * as database from '../../db/indexedDB';
import { LOCAL_PILOT_POLICY } from '../../features/mealPlans/mealPlanPilotPolicy';

const Page = Object.values(import.meta.glob('../MealPlanPilotPage.jsx', { eager: true }))[0]?.default;
const collector = Object.values(import.meta.glob('../../features/mealPlans/mealPlanPilotCollector.js', { eager: true }))[0] || {};
const START = '2026-09-28T03:00:00.000Z';
const ACCOUNT = 'user:pilot-page-a';
const OTHER = 'user:pilot-page-b';
const auth = { storageScope: 'guest', loading: false, isAuthenticated: false };
const CONSENT_LABEL = '이 기기에 식단 파일럿 기록을 저장하는 데 동의해요';
let downloads;
let objectUrls;

function App() { return <MemoryRouter><Page /></MemoryRouter>; }
const raw = scope => database.runMealPlanPilotTransaction('readonly', store => store.getAll(), scope);
const grant = scope => consent.grantMealPlanPilotConsent({ scope, expectedVersion: null, policyVersion: LOCAL_PILOT_POLICY, accepted: true });
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function ready() {
  await waitFor(() => expect(screen.getByRole('button', { name: '파일럿 상태 다시 확인' })).toBeEnabled());
}
async function join() {
  await ready();
  fireEvent.click(screen.getByRole('checkbox', { name: CONSENT_LABEL }));
  fireEvent.click(screen.getByRole('button', { name: '동의하고 기록 시작' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '파일럿 기록 내려받기' })).toBeEnabled());
}

beforeEach(async () => {
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
  expect(Page, 'the dedicated public pilot settings page must exist').toBeTypeOf('function');
  expect(collector.getMealPlanPilotCapture, 'use the real scoped capture API').toBeTypeOf('function');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(START));
  auth.storageScope = 'guest';
  auth.loading = false;
  localStorage.clear();
  for (const scope of ['guest', ACCOUNT, OTHER]) await database.clearAccountLocalData(scope);
  vi.spyOn(authHook, 'useAuth').mockImplementation(() => auth);
  downloads = [];
  objectUrls = [];
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob) { objectUrls.push(blob); return 'blob:pilot-download'; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloads.push({ href: this.href, filename: this.download });
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  for (const scope of ['guest', ACCOUNT, OTHER]) await database.clearAccountLocalData(scope);
  localStorage.clear();
});

describe('explicit browser-local pilot settings', () => {
  it('does not offer new participation in an ordinary build', async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    render(<App />);
    await ready();
    expect(screen.queryByRole('checkbox', { name: CONSENT_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '동의하고 기록 시작' })).not.toBeInTheDocument();
    expect(await raw('guest')).toEqual([]);
  });

  it('retains ordinary access to existing exports and withdrawal without a resume control', async () => {
    await grant('guest');
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    render(<App />);
    await ready();
    expect(screen.queryByRole('button', { name: '앞으로 기록 재개' })).not.toBeInTheDocument();
    expect(screen.queryByText(/일시 중지 상태라면 앞으로 기록 재개를 선택/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '파일럿 기록 내려받기' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '참여 철회 및 기록 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '철회 및 삭제 확인' }));
    await waitFor(async () => expect((await consent.getMealPlanPilotConsent()).status).toBe('withdrawn'));
    expect(screen.queryByRole('button', { name: '동의하고 기록 시작' })).not.toBeInTheDocument();
  });

  it('announces capture changes and external withdrawal without taking keyboard focus', async () => {
    await grant('guest');
    render(<><button>다른 작업 계속</button><App /></>);
    await ready();
    const announcement = screen.getByRole('status', { name: '파일럿 상태 알림' });
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent('기록 일시 중지');
    fireEvent.click(screen.getByRole('button', { name: '앞으로 기록 재개' }));
    await ready();
    expect(screen.getByRole('status', { name: '파일럿 상태 알림' })).toBe(announcement);
    expect(announcement).toHaveTextContent('기록 수집 중');
    const other = screen.getByRole('button', { name: '다른 작업 계속' });
    other.focus();
    await act(async () => consent.withdrawMealPlanPilotConsent('guest'));
    await waitFor(() => expect(announcement).toHaveTextContent('참여 철회'));
    expect(other).toHaveFocus();
    expect(downloads).toEqual([]);
  });

  it('keeps pilot consent off and unchecked independently from ordinary analytics consent', async () => {
    localStorage.setItem('fridgemate-analytics-consent', 'granted');
    render(<App />);
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: '식단 파일럿 참여' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: CONSENT_LABEL })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '동의하고 기록 시작' })).toBeDisabled();
    expect(await raw('guest')).toEqual([]);
    expect(screen.getByText(/35일/)).toBeInTheDocument();
    expect(screen.getByText(/내려받은 파일.*회수|다운로드한 파일.*회수/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내 데이터 내려받기' })).not.toBeInTheDocument();
  });

  it('starts collection only after explicit consent and retains ordinary analytics preferences', async () => {
    localStorage.setItem('fridgemate-analytics-consent', 'denied');
    render(<App />);
    await join();
    const active = await collector.getMealPlanPilotCapture('guest');
    expect(active).toMatchObject({ status: 'active', captureState: 'collecting', startedAt: START,
      expiresAt: '2026-11-02T03:00:00.000Z' });
    expect(localStorage.getItem('fridgemate-analytics-consent')).toBe('denied');
    const stored = await raw('guest');
    expect(JSON.stringify(stored)).toContain('sub_');
    expect(document.body.textContent).not.toContain('sub_');
    expect(document.body.textContent).not.toContain(active.version);
  });

  it('distinguishes saved consent from a failed collector start and permits explicit future-only resume', async () => {
    const resume = collector.resumeMealPlanPilotCapture;
    vi.spyOn(collector, 'resumeMealPlanPilotCapture').mockRejectedValueOnce(new Error('private collection failure'));
    render(<App />);
    await join();
    expect(await consent.getMealPlanPilotConsent()).toMatchObject({ status: 'active' });
    expect(screen.getByRole('alert')).toHaveTextContent(/동의.*저장.*기록.*시작하지 못/);
    expect(document.body.textContent).not.toContain('private collection failure');
    vi.mocked(collector.resumeMealPlanPilotCapture).mockImplementation(resume);
    fireEvent.click(screen.getByRole('button', { name: '앞으로 기록 재개' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '앞으로 기록 재개' })).not.toBeInTheDocument());
    expect((await collector.getMealPlanPilotCapture('guest')).captureState).toBe('collecting');
  });

  it('downloads a validated local-only snapshot without rendering raw events or account identities', async () => {
    auth.storageScope = ACCOUNT;
    render(<App />);
    await join();
    fireEvent.click(screen.getByRole('button', { name: '파일럿 기록 내려받기' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]).toEqual({ href: 'blob:pilot-download', filename: 'fridgemate-local-pilot-2026-09-28.json' });
    const text = await new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(objectUrls[0]);
    });
    const exported = JSON.parse(text);
    expect(exported).toMatchObject({ exportKind: 'fridgemate-local-meal-plan-pilot', measurementUnit: 'browser-scope',
      dataset: { subjects: [expect.objectContaining({ kind: 'account', firstGenerationKnown: false })] } });
    expect(text).not.toContain(ACCOUNT);
    expect(document.body.textContent).not.toContain(exported.dataset.subjects[0].id);
    expect(screen.getByRole('status', { name: '파일럿 작업 결과' })).toHaveTextContent(/다운로드.*요청/);
  });

  it('preserves business data when withdrawal is cancelled or confirmed and keeps other scopes untouched', async () => {
    const other = await grant(OTHER);
    await database.saveIngredient({ id: 'stock', name: 'private ingredient', quantity: '1개' }, 'guest');
    const before = await database.getAllIngredients('guest');
    render(<App />);
    await join();
    fireEvent.click(screen.getByRole('button', { name: '참여 철회 및 기록 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByRole('button', { name: '참여 철회 및 기록 삭제' })).toHaveFocus();
    expect((await consent.getMealPlanPilotConsent()).status).toBe('active');
    fireEvent.click(screen.getByRole('button', { name: '참여 철회 및 기록 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '철회 및 삭제 확인' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: CONSENT_LABEL })).not.toBeChecked());
    expect((await consent.getMealPlanPilotConsent()).status).toBe('withdrawn');
    expect(await consent.getMealPlanPilotConsent(OTHER)).toStrictEqual(other);
    expect(await database.getAllIngredients('guest')).toStrictEqual(before);
    expect(JSON.stringify(await raw('guest'))).not.toContain('sub_');
  });

  it('does not let an old withdrawal confirmation delete a renewed session from another tab', async () => {
    render(<App />);
    await join();
    fireEvent.click(screen.getByRole('button', { name: '참여 철회 및 기록 삭제' }));
    const oldConfirm = screen.getByRole('button', { name: '철회 및 삭제 확인' });
    let renewed;
    await act(async () => {
      const closed = await consent.withdrawMealPlanPilotConsent();
      renewed = await consent.grantMealPlanPilotConsent({ scope: 'guest', expectedVersion: closed.version,
        policyVersion: LOCAL_PILOT_POLICY, accepted: true });
    });
    fireEvent.click(oldConfirm);
    await ready();
    expect(await consent.getMealPlanPilotConsent()).toStrictEqual(renewed);
  });

  it('does not download after the active scope switches away and back during export preparation', async () => {
    auth.storageScope = ACCOUNT;
    const view = render(<App />);
    await join();
    const pending = deferred();
    const prepare = consent.prepareMealPlanPilotExport;
    let prepared = false;
    vi.spyOn(consent, 'prepareMealPlanPilotExport').mockImplementationOnce(async (...args) => {
      const output = await prepare(...args);
      prepared = true;
      await pending.promise;
      return output;
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: '파일럿 기록 내려받기' }));
      await waitFor(() => expect(prepared).toBe(true));
      auth.storageScope = OTHER;
      view.rerender(<App />);
      auth.storageScope = ACCOUNT;
      view.rerender(<App />);
    } finally {
      await act(async () => pending.resolve());
    }
    await ready();
    expect(downloads).toEqual([]);
    expect(objectUrls).toEqual([]);
  });

  it('drops a delayed grant before its transaction when the account session has changed', async () => {
    auth.storageScope = ACCOUNT;
    const pending = deferred();
    const grantActual = consent.grantMealPlanPilotConsent;
    vi.spyOn(consent, 'grantMealPlanPilotConsent').mockImplementationOnce(async (...args) => {
      await pending.promise;
      return grantActual(...args);
    });
    const view = render(<App />);
    await ready();
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: '동의하고 기록 시작' }));
    auth.storageScope = OTHER;
    view.rerender(<App />);
    auth.storageScope = ACCOUNT;
    view.rerender(<App />);
    await act(async () => pending.resolve());
    await ready();
    expect(await raw(ACCOUNT)).toEqual([]);
    expect(await raw(OTHER)).toEqual([]);
  });

  it('shows a safe read failure without pretending consent is off or exposing raw errors', async () => {
    vi.spyOn(collector, 'getMealPlanPilotCapture').mockRejectedValueOnce(new Error('private scope id raw failure'));
    render(<App />);
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent(/확인하지 못/);
    expect(document.body.textContent).not.toContain('private scope id raw failure');
    expect(screen.queryByRole('button', { name: '동의하고 기록 시작' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '파일럿 상태 다시 확인' }));
    await screen.findByRole('button', { name: '동의하고 기록 시작' });
    expect(await raw('guest')).toEqual([]);
  });

  it('requires fresh unchecked consent after expiry instead of exporting or extending the old session', async () => {
    render(<App />);
    await join();
    vi.setSystemTime(new Date('2026-11-02T03:00:00.000Z'));
    fireEvent.focus(window);
    await screen.findByRole('button', { name: '동의하고 기록 시작' });
    expect(screen.getByRole('checkbox', { name: CONSENT_LABEL })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '동의하고 기록 시작' })).toBeDisabled();
    expect((await consent.getMealPlanPilotConsent()).status).toBe('expired');
    expect(downloads).toEqual([]);
  });

  it('prevents synchronous duplicate consent submissions while the first request is pending', async () => {
    const grantSpy = vi.spyOn(consent, 'grantMealPlanPilotConsent');
    render(<App />);
    await ready();
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT_LABEL }));
    const button = screen.getByRole('button', { name: '동의하고 기록 시작' });
    act(() => { button.click(); button.click(); });
    expect(grantSpy).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: CONSENT_LABEL })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: '파일럿 기록 내려받기' })).toBeEnabled());
    expect((await collector.getMealPlanPilotCapture('guest')).captureState).toBe('collecting');
  });

  it('does not download an old export after another tab withdraws and renews the pilot session', async () => {
    render(<App />);
    await join();
    const pending = deferred();
    const prepare = consent.prepareMealPlanPilotExport;
    let prepared = false;
    vi.spyOn(consent, 'prepareMealPlanPilotExport').mockImplementationOnce(async (...args) => {
      const output = await prepare(...args);
      prepared = true;
      await pending.promise;
      return output;
    });
    let renewed;
    try {
      fireEvent.click(screen.getByRole('button', { name: '파일럿 기록 내려받기' }));
      await waitFor(() => expect(prepared).toBe(true));
      await act(async () => {
        const closed = await consent.withdrawMealPlanPilotConsent();
        renewed = await consent.grantMealPlanPilotConsent({ scope: 'guest', expectedVersion: closed.version,
          policyVersion: LOCAL_PILOT_POLICY, accepted: true });
      });
    } finally {
      await act(async () => pending.resolve());
    }
    await ready();
    expect(screen.getByRole('alert')).toHaveTextContent(/내려받지 못/);
    expect(downloads).toEqual([]);
    expect(objectUrls).toEqual([]);
    expect(await consent.getMealPlanPilotConsent()).toStrictEqual(renewed);
  });
});
