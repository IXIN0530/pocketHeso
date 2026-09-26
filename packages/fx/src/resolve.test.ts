import { expect, test } from 'vitest';
import type { CueSheet } from '@ph/shared';
import { resolveCueSheet } from './resolve.ts';
import { sheet } from './fx.fixtures.ts';

test('same seed and serial give the same cue sequence', () => {
  for (let serial = 0; serial < 50; serial++) {
    const a = resolveCueSheet(sheet('sp_reach'), { seed: 12345, serial, intensity: 2 });
    const b = resolveCueSheet(sheet('sp_reach'), { seed: 12345, serial, intensity: 2 });
    expect(b).toEqual(a);
  }
});

test('branches vary by serial and are sorted by time', () => {
  const picks = new Set<number>();
  for (let serial = 0; serial < 64; serial++) {
    const r = resolveCueSheet(sheet('sp_reach'), { seed: 7, serial, intensity: 3 });
    picks.add(r.picks[0]!);
    for (let i = 1; i < r.cues.length; i++) expect(r.cues[i]!.at).toBeGreaterThanOrEqual(r.cues[i - 1]!.at);
  }
  expect([...picks].sort()).toEqual([0, 1]);
});

test('intensity drops cues but not branch picks', () => {
  const s: CueSheet = {
    pattern: 't',
    cues: [
      { at: 0, kind: 'flash', style: 'white', ms: 100, min_intensity: 3 },
      { at: 0, kind: 'haptic', pattern: [50] },
    ],
    branches: [{ name: 'b', options: [{ weight: 1, cues: [] }, { weight: 1, cues: [{ at: 5, kind: 'haptic', pattern: [10] }] }] }],
  };
  for (let serial = 0; serial < 20; serial++) {
    const lo = resolveCueSheet(s, { seed: 1, serial, intensity: 1 });
    const hi = resolveCueSheet(s, { seed: 1, serial, intensity: 3 });
    expect(lo.picks).toEqual(hi.picks);
    expect(lo.cues.some((c) => c.kind === 'flash')).toBe(false);
    expect(hi.cues.some((c) => c.kind === 'flash')).toBe(true);
  }
});
