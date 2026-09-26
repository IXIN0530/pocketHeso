import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseCuePack, parseCueSheet } from './cue-sheet.ts';

const packJson: unknown = JSON.parse(readFileSync(new URL('../../../resources/packs/default/pack.json', import.meta.url), 'utf8'));

test('default pack parses', () => {
  const pack = parseCuePack(packJson);
  expect(pack.name).toBe('default');
  expect(pack.sheets.map((s) => s.pattern)).toContain('jackpot');
  expect(Object.keys(pack.sounds).length).toBeGreaterThan(0);
});

test('unknown kind is ignored (forward compatible)', () => {
  const sheet = parseCueSheet({
    pattern: 'x',
    cues: [
      { at: 0, kind: 'hologram', ms: 100 },
      { at: 10, kind: 'flash', style: 'white', ms: 100 },
    ],
  });
  expect(sheet.cues).toEqual([{ at: 10, kind: 'flash', style: 'white', ms: 100 }]);
  expect(sheet.branches).toEqual([]);
});

test('malformed cues and undefined sounds throw', () => {
  expect(() => parseCueSheet({ pattern: 'x', cues: [{ at: -1, kind: 'flash', style: 'white', ms: 1 }] })).toThrow();
  expect(() => parseCueSheet({ pattern: 'x', cues: [{ at: 0, kind: 'flash', style: 'strobe', ms: 1 }] })).toThrow();
  expect(() =>
    parseCueSheet({ pattern: 'x', cues: [], branches: [{ name: 'b', options: [{ weight: 0, cues: [] }] }] }),
  ).toThrow();
  expect(() =>
    parseCuePack({
      name: 'p',
      theme: { primary: '#000', accent: '#fff' },
      sounds: {},
      sheets: [{ pattern: 'x', cues: [{ at: 0, kind: 'sound', bus: 'se', asset: 'none' }] }],
    }),
  ).toThrow(/未定義の音/);
});
