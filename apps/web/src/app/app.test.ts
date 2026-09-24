import { expect, test, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

test('App is a component', async () => {
  const { App } = await import('./app.tsx');
  expect(typeof App).toBe('function');
});
