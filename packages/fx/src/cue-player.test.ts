import { expect, test } from 'vitest';
import type { Cue } from '@ph/shared';
import { CuePlayer } from './cue-player.ts';

const cues: Cue[] = [
  { at: 0, kind: 'sound', bus: 'bgm', asset: 'loop', loop: true },
  { at: 100, kind: 'haptic', pattern: [50] },
  { at: 200, kind: 'flash', style: 'white', ms: 300 },
  { at: 1000, kind: 'sound', bus: 'se', asset: 'kyuin' },
];

function run(origin: number, times: number[]): [string, number][] {
  const fired: [string, number][] = [];
  const p = new CuePlayer((c, off) => fired.push([c.kind + ':' + c.at, off]));
  p.start(cues, origin);
  for (const t of times) p.update(t);
  expect(p.done).toBe(true);
  return fired;
}

test('fires cues in order at their time', () => {
  expect(run(1000, [1000, 1100, 1250, 1999, 2000])).toEqual([
    ['sound:0', 0],
    ['haptic:100', 0],
    ['flash:200', 50],
    ['sound:1000', 0],
  ]);
});

test('starts mid-way: finished cues are skipped, running ones get an offset', () => {
  // at=0 から 400ms 経過した所から再生: ループ音は 400ms 頭出し、振動（50ms）は終わっている、フラッシュは 200ms 経過。
  expect(run(0, [400, 1000])).toEqual([
    ['sound:0', 400],
    ['flash:200', 200],
    ['sound:1000', 0],
  ]);
});

test('stop drops the rest', () => {
  const fired: string[] = [];
  const p = new CuePlayer((c) => fired.push(c.kind));
  p.start(cues, 0);
  p.update(120);
  p.stop();
  p.update(5000);
  expect(fired).toEqual(['sound', 'haptic']);
});
