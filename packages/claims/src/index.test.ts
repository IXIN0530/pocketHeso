import { expect, test } from 'vitest';
import { CLAIMS_CORE_VERSION } from './index.ts';

test('links to core', () => {
  expect(CLAIMS_CORE_VERSION).toBe(1);
});
