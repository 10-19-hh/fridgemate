import { afterEach, describe, expect, it, vi } from 'vitest';

const { initialize } = vi.hoisted(() => ({ initialize: vi.fn() }));
// Keep the real entry-point decision; replace only SDK initialization and the
// unrelated application mount/retention work at their side-effect boundaries.
vi.mock('@sentry/react', () => ({ init: initialize }));
vi.mock('react-dom/client', () => ({ default: { createRoot: () => ({ render() {} }) } }));
vi.mock('../../features/mealPlans/mealPlanPilotRetention', () => ({
  purgeExpiredMealPlanPilots: async () => ({ supported: true, failedScopes: 0 })
}));

afterEach(() => {
  initialize.mockReset();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('pilot entry-point telemetry', () => {
  it('does not initialize Sentry even with an inherited preview DSN', async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'true');
    vi.stubEnv('VITE_SENTRY_DSN', 'https://fixture@synthetic.invalid/1');
    await import('../../main.jsx');
    expect(initialize).not.toHaveBeenCalled();
  });

  it('preserves ordinary build Sentry initialization', async () => {
    vi.stubEnv('VITE_LOCAL_PILOT_ENABLED', 'false');
    vi.stubEnv('VITE_SENTRY_DSN', 'https://fixture@synthetic.invalid/1');
    await import('../../main.jsx');
    expect(initialize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      dsn: 'https://fixture@synthetic.invalid/1', sendDefaultPii: false
    }));
  });
});
