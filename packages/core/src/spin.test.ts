import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import type { HoldEntry } from './lottery.ts';
import { SpinMachine, jackpotDurationMs, spinDurationMs } from './spin.ts';
import type { SpinEvent } from './spin.ts';

function loadMachine(): { spec: MachineSpec; patterns: PatternTable } {
  const spec = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  return { spec, patterns };
}

function patternIndexOf(patterns: PatternTable, id: string): number {
  for (let i = 0; i < patterns.length; i = i + 1) {
    if ((patterns[i] as { id: string }).id === id) {
      return i;
    }
  }
  throw new Error('pattern not found: ' + id);
}

function makeEntry(serial: number, patternIndex: number, isHit: boolean, branchIndex: number | null): HoldEntry {
  return { serial, modeAtDraw: 'normal', isHit, branchIndex, patternIndex, color: 'white', hot: 0, hesoPayoutBalls: 3 };
}

function kinds(events: readonly SpinEvent[]): string[] {
  return events.map((e) => e.k);
}

test('変動時間の短縮と大当たり時間（保留3〜4で normal_short=2000ms）', () => {
  const { spec, patterns } = loadMachine();
  const shortIdx = patternIndexOf(patterns, 'normal_short');
  const reachIdx = patternIndexOf(patterns, 'reach_n');
  expect(spinDurationMs(patterns, shortIdx, 4)).toBe(2000);
  expect(spinDurationMs(patterns, shortIdx, 3)).toBe(2000);
  expect(spinDurationMs(patterns, shortIdx, 2)).toBe(5000);
  expect(spinDurationMs(patterns, shortIdx, 0)).toBe(5000);
  expect(spinDurationMs(patterns, reachIdx, 4)).toBe(10000);
  expect(jackpotDurationMs(spec, 0)).toBe(50000);
  expect(jackpotDurationMs(spec, 1)).toBe(20000);
  expect(() => spinDurationMs(patterns, 99, 0)).toThrow();
  expect(() => spinDurationMs(patterns, shortIdx, -1)).toThrow();
  expect(() => spinDurationMs(patterns, shortIdx, 9)).toThrow();
  expect(() => jackpotDurationMs(spec, 2)).toThrow();
});

test('保留4満タン→順次消化→当たり→ST→ST抜けが期待イベント列と一致', () => {
  const { spec, patterns } = loadMachine();
  const shortIdx = patternIndexOf(patterns, 'normal_short');
  const reachIdx = patternIndexOf(patterns, 'reach_n');
  const kakuteiIdx = patternIndexOf(patterns, 'kakutei');
  const m = new SpinMachine(spec, patterns);
  const all: SpinEvent[] = [];
  const run = (evs: SpinEvent[]): void => {
    for (let i = 0; i < evs.length; i = i + 1) {
      all.push(evs[i] as SpinEvent);
    }
  };

  const e0 = makeEntry(0, shortIdx, false, null);
  const e1 = makeEntry(1, reachIdx, false, null);
  const e2 = makeEntry(2, kakuteiIdx, true, 0);
  const e3 = makeEntry(3, shortIdx, false, null);

  run(m.startSpin(e0, 0, 4));
  expect(all[0]).toEqual({ k: 'spinStarted', entry: 0, at: 0, pattern: 'normal_short', endsAt: 2000 });
  run(m.resolveSpin(2000));
  expect(all[1]).toEqual({ k: 'spinResolved', entry: 0, at: 2000, hit: false });
  expect(m.mode).toBe('normal');
  expect(m.stRemaining).toBe(0);

  run(m.startSpin(e1, 2000, 3));
  expect(all[2]).toEqual({ k: 'spinStarted', entry: 1, at: 2000, pattern: 'reach_n', endsAt: 12000 });
  run(m.resolveSpin(12000));
  expect(all[3]).toEqual({ k: 'spinResolved', entry: 1, at: 12000, hit: false });

  run(m.startSpin(e2, 12000, 2));
  expect(all[4]).toEqual({ k: 'spinStarted', entry: 2, at: 12000, pattern: 'kakutei', endsAt: 42000 });
  run(m.resolveSpin(42000));
  expect(all[5]).toEqual({ k: 'spinResolved', entry: 2, at: 42000, hit: true });
  expect(all[6]).toEqual({ k: 'jackpotStarted', entry: 2, at: 42000, kind: 'kakuhen', rounds: 10 });
  expect(m.jackpotEndsAt).toBe(92000);

  run(m.finishJackpot(92000, 1));
  expect(all[7]).toEqual({ k: 'jackpotEnded', entry: 2, at: 92000, payout: 1500 });
  expect(all[8]).toEqual({ k: 'modeChanged', to: 'st', at: 92000, stRemaining: 100 });
  expect(m.mode).toBe('st');
  expect(m.stRemaining).toBe(100);

  run(m.startSpin(e3, 92000, 1));
  expect(all[9]).toEqual({ k: 'spinStarted', entry: 3, at: 92000, pattern: 'normal_short', endsAt: 97000 });
  run(m.resolveSpin(97000));
  expect(all[10]).toEqual({ k: 'spinResolved', entry: 3, at: 97000, hit: false });
  expect(m.stRemaining).toBe(99);

  let cur = 97000;
  for (let s = 0; s < 99; s = s + 1) {
    const serial = 10 + s;
    const e = makeEntry(serial, shortIdx, false, null);
    const started = m.startSpin(e, cur, 0);
    expect(started).toEqual([{ k: 'spinStarted', entry: serial, at: cur, pattern: 'normal_short', endsAt: cur + 5000 }]);
    run(started);
    const resolved = m.resolveSpin(cur + 5000);
    run(resolved);
    if (s < 98) {
      expect(resolved).toEqual([{ k: 'spinResolved', entry: serial, at: cur + 5000, hit: false }]);
      expect(m.mode).toBe('st');
      expect(m.stRemaining).toBe(98 - s);
    } else {
      expect(resolved).toEqual([
        { k: 'spinResolved', entry: serial, at: cur + 5000, hit: false },
        { k: 'modeChanged', to: 'normal', at: cur + 5000, stRemaining: 0 },
      ]);
      expect(m.mode).toBe('normal');
      expect(m.stRemaining).toBe(0);
    }
    cur = cur + 5000;
  }

  expect(all.length).toBe(210);
  expect(kinds(all).slice(0, 11)).toEqual([
    'spinStarted',
    'spinResolved',
    'spinStarted',
    'spinResolved',
    'spinStarted',
    'spinResolved',
    'jackpotStarted',
    'jackpotEnded',
    'modeChanged',
    'spinStarted',
    'spinResolved',
  ]);
  expect(kinds(all).slice(-3)).toEqual(['spinStarted', 'spinResolved', 'modeChanged']);
});

test('ST中の当たりは振分けで継続（確変）・終了（通常）する（大当たりでメダルは出ない, D-049）', () => {
  const { spec, patterns } = loadMachine();
  const shortIdx = patternIndexOf(patterns, 'normal_short');
  const kakuteiIdx = patternIndexOf(patterns, 'kakutei');

  const inSt = new SpinMachine(spec, patterns, { mode: 'st', stRemaining: 2 });
  const hitKakuhen = { ...makeEntry(50, kakuteiIdx, true, 0), modeAtDraw: 'st' as const };
  expect(inSt.startSpin(hitKakuhen, 1000, 0)[0]).toEqual({
    k: 'spinStarted',
    entry: 50,
    at: 1000,
    pattern: 'kakutei',
    endsAt: 31000,
  });
  const resolved = inSt.resolveSpin(31000);
  expect(resolved).toEqual([
    { k: 'spinResolved', entry: 50, at: 31000, hit: true },
    { k: 'jackpotStarted', entry: 50, at: 31000, kind: 'kakuhen', rounds: 10 },
  ]);
  const ended = inSt.finishJackpot(81000, 1);
  expect(ended).toEqual([
    { k: 'jackpotEnded', entry: 50, at: 81000, payout: 1500 },
    { k: 'modeChanged', to: 'st', at: 81000, stRemaining: 100 },
  ]);
  expect(inSt.mode).toBe('st');
  expect(inSt.stRemaining).toBe(100);

  const inSt2 = new SpinMachine(spec, patterns, { mode: 'st', stRemaining: 2 });
  const hitTsujo = { ...makeEntry(51, kakuteiIdx, true, 1), modeAtDraw: 'st' as const };
  inSt2.startSpin(hitTsujo, 5000, 1);
  inSt2.resolveSpin(35000);
  const ended2 = inSt2.finishJackpot(55000, 1);
  expect(ended2).toEqual([
    { k: 'jackpotEnded', entry: 51, at: 55000, payout: 600 },
    { k: 'modeChanged', to: 'normal', at: 55000, stRemaining: 0 },
  ]);
  expect(inSt2.mode).toBe('normal');

  const inNormal = new SpinMachine(spec, patterns);
  const missShort = makeEntry(60, shortIdx, false, null);
  expect(inNormal.startSpin(missShort, 0, 0)[0]).toEqual({
    k: 'spinStarted',
    entry: 60,
    at: 0,
    pattern: 'normal_short',
    endsAt: 5000,
  });
  inNormal.resolveSpin(5000);
  const hitTsujoNormal = makeEntry(61, kakuteiIdx, true, 1);
  inNormal.startSpin(hitTsujoNormal, 5000, 0);
  inNormal.resolveSpin(35000);
  const ended3 = inNormal.finishJackpot(55000, 4);
  expect(ended3).toEqual([{ k: 'jackpotEnded', entry: 61, at: 55000, payout: 2400 }]);
  expect(inNormal.mode).toBe('normal');
});

test('snapshot/restoreで続行が一致し不正遷移を拒否', () => {
  const { spec, patterns } = loadMachine();
  const shortIdx = patternIndexOf(patterns, 'normal_short');
  const reachIdx = patternIndexOf(patterns, 'reach_n');
  const m = new SpinMachine(spec, patterns);
  m.startSpin(makeEntry(0, shortIdx, false, null), 0, 1);
  m.resolveSpin(5000);
  const snap = m.snapshot();
  const a = SpinMachine.restore(spec, patterns, snap);
  const b = SpinMachine.restore(spec, patterns, snap);
  const evA: SpinEvent[] = [...a.startSpin(makeEntry(1, reachIdx, false, null), 5000, 1), ...a.resolveSpin(15000)];
  const evB: SpinEvent[] = [...b.startSpin(makeEntry(1, reachIdx, false, null), 5000, 1), ...b.resolveSpin(15000)];
  expect(evA).toEqual(evB);
  expect(a.snapshot()).toEqual(b.snapshot());

  expect(() => new SpinMachine(spec, patterns, { mode: 'normal', stRemaining: 1 })).toThrow();
  expect(() => new SpinMachine(spec, [], undefined)).toThrow();
  const busy = new SpinMachine(spec, patterns);
  busy.startSpin(makeEntry(0, shortIdx, false, null), 0, 0);
  expect(() => busy.startSpin(makeEntry(1, shortIdx, false, null), 0, 0)).toThrow();
  expect(() => busy.resolveSpin(0)).toThrow();
  expect(() => busy.finishJackpot(5000, 1)).toThrow();
  const idle = new SpinMachine(spec, patterns);
  expect(() => idle.resolveSpin(0)).toThrow();
  expect(() => idle.finishJackpot(0, 1)).toThrow();
  const badEntry = new SpinMachine(spec, patterns);
  expect(() => badEntry.startSpin(makeEntry(0, shortIdx, true, null), 0, 0)).toThrow();
  expect(() => badEntry.startSpin(makeEntry(0, shortIdx, false, 0), 0, 0)).toThrow();
  expect(() => badEntry.startSpin(makeEntry(0, 99, false, null), 0, 0)).toThrow();
  expect(() => badEntry.finishJackpot(0, 0)).toThrow();
});

test('白以外の保留の変動は短縮の後に spin_min_colored_ms 以上（P13-T5）', () => {
  const { spec, patterns } = loadMachine();
  expect(spec.spinMinColoredMs).toBe(6600);
  const shortIdx = patternIndexOf(patterns, 'normal_short');
  const reachIdx = patternIndexOf(patterns, 'reach_n');
  const endsOf = (color: HoldEntry['color'], patternIndex: number, holdCount: number, scale: number): number => {
    const m = new SpinMachine(spec, patterns);
    const e = m.startSpin({ ...makeEntry(0, patternIndex, false, null), color }, 1000, holdCount, scale)[0];
    return e !== undefined && e.k === 'spinStarted' ? e.endsAt - 1000 : -1;
  };
  expect(endsOf('white', shortIdx, 4, 1)).toBe(2000);
  expect(endsOf('blue', shortIdx, 4, 1)).toBe(6600);
  expect(endsOf('gold', shortIdx, 4, 0.5)).toBe(6600);
  expect(endsOf('red', shortIdx, 0, 1)).toBe(6600);
  expect(endsOf('green', reachIdx, 4, 0.8)).toBe(8000);
  const none = new SpinMachine({ ...spec, spinMinColoredMs: 0 }, patterns);
  const ev = none.startSpin({ ...makeEntry(0, shortIdx, false, null), color: 'blue' }, 0, 4)[0];
  expect(ev !== undefined && ev.k === 'spinStarted' ? ev.endsAt : -1).toBe(2000);
});
