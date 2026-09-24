import { expect, test } from 'vitest';
import { CORE_VERSION } from './index.ts';

test('core version is defined', () => {
  expect(CORE_VERSION).toBe(1);
});
