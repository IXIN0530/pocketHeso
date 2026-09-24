import { expect, test } from 'vitest';
import { CORE_VERSION } from '@ph/core';

test('resolves core from the workspace', () => {
  expect(CORE_VERSION).toBe(1);
});
