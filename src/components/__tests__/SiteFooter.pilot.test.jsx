import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import SiteFooter from '../SiteFooter';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it('keeps existing pilot record management discoverable without inviting ordinary visitors to join', () => {
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
  render(<MemoryRouter><SiteFooter /></MemoryRouter>);
  expect(screen.getByRole('link', { name: '파일럿 기록 관리' })).toHaveAttribute('href', '/pilot');
  expect(screen.queryByRole('link', { name: '식단 파일럿' })).not.toBeInTheDocument();
});

it('offers the dedicated pilot entry in the pilot build', () => {
  vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
  render(<MemoryRouter><SiteFooter /></MemoryRouter>);
  expect(screen.getByRole('link', { name: '식단 파일럿' })).toHaveAttribute('href', '/pilot');
});
