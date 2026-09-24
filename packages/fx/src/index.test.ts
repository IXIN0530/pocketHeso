import { expect, test } from 'vitest';
import { FX_CORE_VERSION } from './index.ts';

test('links to core', () => {
  expect(FX_CORE_VERSION).toBe(1);
});
