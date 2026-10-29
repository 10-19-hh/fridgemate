import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as authHook from '../../hooks/useAuth';
import * as consent from '../../features/mealPlans/mealPlanPilotConsent';
import * as database from '../../db/indexedDB';
import { LOCAL_PILOT_POLICY } from '../../features/mealPlans/mealPlanPilotPolicy';

const Notice = Object.values(import.meta.glob('../MealPlanPilotNotice.jsx', { eager: true }))[0]?.default;
const collector = Object.values(import.meta.glob('../../features/mealPlans/mealPlanPilotCollector.js', { eager: true }))[0] || {};
const ACCOUNT = 'user:pilot-notice-a';
const OTHER = 'user:pilot-notice-b';
const auth = { storageScope: ACCOUNT, loading: false };
const grant = scope => consent.grantMealPlanPilotConsent({ scope, expectedVersion: null, policyVersion: LOCAL_PILOT_POLICY, accepted: true });
function App({ path = '/meal-plan' }) { return <MemoryRouter initialEntries={[path]}><Notice /></MemoryRouter>; }

beforeEach(async () => {
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
  expect(Notice, 'a scoped notice must expose interrupted collection outside pilot settings').toBeTypeOf('function');
  expect(collector.getMealPlanPilotCapture).toBeTypeOf('function');
  auth.storageScope = ACCOUNT;
  auth.loading = false;
  vi.spyOn(authHook, 'useAuth').mockImplementation(() => auth);
  for (const scope of [ACCOUNT, OTHER]) await database.clearAccountLocalData(scope);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const scope of [ACCOUNT, OTHER]) await database.clearAccountLocalData(scope);
});

it('does not infer participation from a first read failure or show notices to nonparticipants', async () => {
  vi.spyOn(collector, 'getMealPlanPilotCapture').mockRejectedValueOnce(new Error('private storage failure'));
  render(<App />);
  await act(async () => {});
  expect(screen.queryByRole('region', { name: '파일럿 기록 상태' })).not.toBeInTheDocument();
  fireEvent.focus(window);
  await act(async () => { await collector.getMealPlanPilotCapture(ACCOUNT); });
  expect(screen.queryByRole('region', { name: '파일럿 기록 상태' })).not.toBeInTheDocument();
});

it('shows paused collection with a separate settings link without resuming it', async () => {
  await grant(ACCOUNT);
  render(<App />);
  const notice = await screen.findByRole('region', { name: '파일럿 기록 상태' });
  expect(notice).toHaveTextContent(/일시 중지/);
  expect(screen.getByRole('link', { name: '파일럿 상태 확인' })).toHaveAttribute('href', '/pilot');
  expect((await collector.getMealPlanPilotCapture(ACCOUNT)).captureState).toBe('paused');
  expect(document.body.textContent).not.toContain(ACCOUNT);
});

it('does not duplicate the notice on pilot settings or show it during normal collecting', async () => {
  const state = await grant(ACCOUNT);
  const settings = render(<App path="/pilot" />);
  await act(async () => { await collector.getMealPlanPilotCapture(ACCOUNT); });
  expect(screen.queryByRole('region', { name: '파일럿 기록 상태' })).not.toBeInTheDocument();
  settings.unmount();
  await collector.resumeMealPlanPilotCapture({ scope: ACCOUNT, expectedVersion: state.version });
  render(<App />);
  await act(async () => { await collector.getMealPlanPilotCapture(ACCOUNT); });
  expect(screen.queryByRole('region', { name: '파일럿 기록 상태' })).not.toBeInTheDocument();
});

it('shows an unknown-state warning after a previously active session becomes unreadable', async () => {
  await grant(ACCOUNT);
  render(<App />);
  await screen.findByRole('region', { name: '파일럿 기록 상태' });
  vi.spyOn(collector, 'getMealPlanPilotCapture').mockRejectedValueOnce(new Error('private status failure'));
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByRole('region', { name: '파일럿 기록 상태' })).toHaveTextContent(/확인하지 못/));
  expect(document.body.textContent).not.toContain('private status failure');
});

it('discards an old active read after switching away and back instead of reviving a withdrawn notice', async () => {
  await grant(ACCOUNT);
  let release;
  let started = false;
  const gate = new Promise(resolve => { release = resolve; });
  const get = collector.getMealPlanPilotCapture;
  vi.spyOn(collector, 'getMealPlanPilotCapture').mockImplementationOnce(async (...args) => {
    const old = await get(...args);
    started = true;
    await gate;
    return old;
  });
  const view = render(<App />);
  try {
    await waitFor(() => expect(started).toBe(true));
    auth.storageScope = OTHER;
    view.rerender(<App />);
    await act(async () => { await consent.withdrawMealPlanPilotConsent(ACCOUNT); });
    auth.storageScope = ACCOUNT;
    view.rerender(<App />);
  } finally {
    await act(async () => release());
  }
  await act(async () => { await collector.getMealPlanPilotCapture(ACCOUNT); });
  expect(screen.queryByRole('region', { name: '파일럿 기록 상태' })).not.toBeInTheDocument();
});
