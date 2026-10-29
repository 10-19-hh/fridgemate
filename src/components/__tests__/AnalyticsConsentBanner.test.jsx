import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import AnalyticsConsentBanner from '../AnalyticsConsentBanner';
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  ANALYTICS_ID_STORAGE_KEY,
  ANALYTICS_SESSION_ID_STORAGE_KEY,
  getAnalyticsConsent,
  openAnalyticsConsentSettings,
  setAnalyticsConsent
} from '../../utils/analyticsConsent';

describe('AnalyticsConsentBanner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setAnalyticsConsent('denied');
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.head.querySelectorAll('script[data-fridgemate-ga]').forEach((script) => script.remove());
    delete window.dataLayer;
    delete window.gtag;
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST123');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('offers equally accessible allow and deny actions when no choice exists', async () => {
    render(
      <MemoryRouter>
        <AnalyticsConsentBanner />
      </MemoryRouter>
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '필수 기능만' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: '분석 허용' })).toHaveClass('min-h-11');
    expect(document.head.querySelector('script[data-fridgemate-ga]')).toBeNull();
  });

  it('persists consent, loads GA only after approval, and supports later withdrawal', async () => {
    render(
      <MemoryRouter>
        <AnalyticsConsentBanner />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: '분석 허용' }));
    expect(getAnalyticsConsent()).toBe('granted');
    expect(document.head.querySelector('script[data-fridgemate-ga]')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    window.localStorage.setItem(ANALYTICS_ID_STORAGE_KEY, 'analytics-id');
    window.sessionStorage.setItem(ANALYTICS_SESSION_ID_STORAGE_KEY, 'session-id');

    act(() => openAnalyticsConsentSettings());
    expect(await screen.findByText('현재 설정: 이용 분석 허용')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '필수 기능만' }));

    expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('denied');
    expect(window.localStorage.getItem(ANALYTICS_ID_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(ANALYTICS_SESSION_ID_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a failed approval open with a safe error and does not load GA', () => {
    render(<MemoryRouter><AnalyticsConsentBanner /></MemoryRouter>);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('private storage detail', 'QuotaExceededError');
    });

    fireEvent.click(screen.getByRole('button', { name: '분석 허용' }));

    expect(screen.getByRole('alert')).toHaveTextContent('현재 탭에서는 분석을 중지');
    expect(screen.getByRole('alert')).not.toHaveTextContent('private storage detail');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(getAnalyticsConsent()).toBeNull();
    expect(document.head.querySelector('script[data-fridgemate-ga]')).toBeNull();
    write.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '분석 허용' }));
    expect(getAnalyticsConsent()).toBe('granted');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.head.querySelector('script[data-fridgemate-ga]')).toBeInTheDocument();
  });

  it('stops GA and explains that a failed withdrawal was not persisted', async () => {
    setAnalyticsConsent('granted');
    render(<MemoryRouter><AnalyticsConsentBanner /></MemoryRouter>);
    act(() => openAnalyticsConsentSettings());
    await screen.findByRole('button', { name: '필수 기능만' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('private storage detail', 'SecurityError');
    });

    fireEvent.click(screen.getByRole('button', { name: '필수 기능만' }));

    expect(screen.getByRole('alert')).toHaveTextContent('다른 탭이나 다시 연 페이지');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('granted');
    expect(getAnalyticsConsent()).toBeNull();
    expect(document.head.querySelector('script[data-fridgemate-ga]')).toBeNull();
    expect(window.dataLayer).toEqual([]);
    expect(window.gtag).toBeUndefined();
  });

  it('does not resume GA after an external approval following a failed local withdrawal', () => {
    setAnalyticsConsent('granted');
    render(<MemoryRouter><AnalyticsConsentBanner /></MemoryRouter>);
    act(() => openAnalyticsConsentSettings());
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('synthetic private detail', 'SecurityError');
    });
    fireEvent.click(screen.getByRole('button', { name: '필수 기능만' }));
    write.mockRestore();
    act(() => {
      window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');
      window.dispatchEvent(new StorageEvent('storage', {
        key: ANALYTICS_CONSENT_STORAGE_KEY, newValue: 'granted', storageArea: window.localStorage
      }));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(getAnalyticsConsent()).toBeNull();
    expect(document.head.querySelector('script[data-fridgemate-ga]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '분석 허용' }));
    expect(getAnalyticsConsent()).toBe('granted');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.head.querySelector('script[data-fridgemate-ga]')).toBeInTheDocument();
  });

  function renderFocusExample() {
    return render(<MemoryRouter>
      <main id="main-content" tabIndex={-1}><button>다른 작업</button></main>
      <button onClick={openAnalyticsConsentSettings}>분석 설정 열기</button>
      <AnalyticsConsentBanner />
    </MemoryRouter>);
  }

  it('focuses explicitly opened settings and restores the connected trigger after saving', async () => {
    setAnalyticsConsent('denied');
    const user = userEvent.setup();
    renderFocusExample();
    const trigger = screen.getByRole('button', { name: '분석 설정 열기' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '필수 기능만' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('does not autofocus an automatic banner and returns a removed choice button to main', async () => {
    const user = userEvent.setup();
    renderFocusExample();
    expect(document.body).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '필수 기능만' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('retains focus on a failed choice so the user can retry', async () => {
    setAnalyticsConsent('denied');
    const user = userEvent.setup();
    renderFocusExample();
    await user.click(screen.getByRole('button', { name: '분석 설정 열기' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const choice = screen.getByRole('button', { name: '필수 기능만' });
    await user.click(choice);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(choice).toHaveFocus();
  });

  it('keeps the automatic banner choice focused when the first save fails', async () => {
    const user = userEvent.setup();
    renderFocusExample();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const choice = screen.getByRole('button', { name: '필수 기능만' });
    await user.click(choice);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(choice).toHaveFocus();
  });

  it('does not steal focus that has moved outside settings when a choice is saved', async () => {
    setAnalyticsConsent('denied');
    const user = userEvent.setup();
    renderFocusExample();
    await user.click(screen.getByRole('button', { name: '분석 설정 열기' }));
    const other = screen.getByRole('button', { name: '다른 작업' });
    await user.click(other);
    fireEvent.click(screen.getByRole('button', { name: '필수 기능만' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(other).toHaveFocus();
  });
});
