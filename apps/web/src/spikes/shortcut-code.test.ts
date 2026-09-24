import { expect, test } from 'vitest';
import { decodeShortcutCode } from './shortcut-code.ts';

const encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

test('decodes PH1 code with Japanese workout type', () => {
  const body = { v: 1, workouts: [{ type: '伝統的なウェイトトレーニング' }] };
  const r = decodeShortcutCode(`  PH1.${encode(JSON.stringify(body))}.0123456789abcdef\n`);
  expect(r).toEqual({ ok: true, json: body, sig: '0123456789abcdef' });
});

test('rejects malformed input', () => {
  expect(decodeShortcutCode('hello').ok).toBe(false);
  expect(decodeShortcutCode('PH1.@@@.x').ok).toBe(false);
  expect(decodeShortcutCode(`PH1.${encode('not json')}.x`).ok).toBe(false);
});
