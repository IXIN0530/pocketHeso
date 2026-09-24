import { expect, test } from 'vitest';
import { App } from './app.tsx';

test('App is a component', () => {
  expect(typeof App).toBe('function');
});
