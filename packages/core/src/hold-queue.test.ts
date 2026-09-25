import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { HoldQueue, acquireHold } from './hold-queue.ts';
import type { HoldEntry } from './lottery.ts';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';

function loadMachine(): { spec: MachineSpec; patterns: PatternTable } {
  const spec = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  return { spec, patterns };
}

test('保留キューはFIFO・満タンでoverflow・賞球は支払う', () => {
  const { spec, patterns } = loadMachine();
  expect(spec.holdMax).toBe(4);
  const queue = new HoldQueue(spec.holdMax);
  for (let s = 0; s < 4; s = s + 1) {
    const r = acquireHold(spec, patterns, 555, 'normal', s, 1, queue);
    expect(r.overflow).toBe(false);
    expect(r.entry === null ? -1 : r.entry.serial).toBe(s);
    expect(r.hesoPayoutBalls).toBe(3);
  }
  expect(queue.size).toBe(4);
  expect(queue.isFull()).toBe(true);
  const over = acquireHold(spec, patterns, 555, 'normal', 4, 1, queue);
  expect(over.overflow).toBe(true);
  expect(over.entry).toBeNull();
  expect(over.hesoPayoutBalls).toBe(3);
  expect(queue.size).toBe(4);
  for (let s = 0; s < 4; s = s + 1) {
    const first = queue.takeFirst();
    expect(first === null ? -1 : first.serial).toBe(s);
  }
  expect(queue.takeFirst()).toBeNull();
  expect(queue.isFull()).toBe(false);
});

test('hold_max 可変（上限変更・小さい上限・peek/clear）', () => {
  const { spec, patterns } = loadMachine();
  const queue = new HoldQueue(2);
  expect(queue.max).toBe(2);
  expect(acquireHold(spec, patterns, 777, 'st', 0, 4, queue).overflow).toBe(false);
  expect(acquireHold(spec, patterns, 777, 'st', 1, 4, queue).overflow).toBe(false);
  expect(acquireHold(spec, patterns, 777, 'st', 2, 4, queue).overflow).toBe(true);
  queue.setMax(4);
  expect(queue.max).toBe(4);
  const r = acquireHold(spec, patterns, 777, 'st', 2, 4, queue);
  expect(r.overflow).toBe(false);
  expect(r.entry === null ? -1 : r.entry.modeAtDraw).toBe('st');
  expect(r.entry === null ? -1 : r.entry.hesoPayoutBalls).toBe(12);
  expect(queue.peekAll().length).toBe(3);
  const added = queue.peekAll()[0] as HoldEntry;
  const single = new HoldQueue(1);
  expect(single.tryAdd(added)).toBe(true);
  expect(single.tryAdd(added)).toBe(false);
  queue.clear();
  expect(queue.size).toBe(0);
  expect(() => new HoldQueue(0)).toThrow();
  expect(() => new HoldQueue(9)).toThrow();
  expect(() => queue.setMax(0)).toThrow();
});
