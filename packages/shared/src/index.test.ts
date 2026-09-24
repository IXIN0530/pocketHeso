import { expect, test } from 'vitest';
import { SHARED_CORE_VERSION } from './index.ts';

test('links to core', () => {
  expect(SHARED_CORE_VERSION).toBe(1);
});
