import { expect, test } from 'vitest';
import { FIRST_INTERVAL_MS, MIN_INTERVAL_MS, repeatWhile } from './hold-button.tsx';

test('repeatWhile fires until it cannot continue, speeding up to the floor', async () => {
  const waits: number[] = [];
  let fired = 0;
  const count = await repeatWhile(
    () => fired < 12,
    async () => {
      fired += 1;
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  expect(count).toBe(12);
  expect(waits[0]).toBe(FIRST_INTERVAL_MS);
  for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeLessThanOrEqual(waits[i - 1]!);
  expect(waits.at(-1)).toBe(MIN_INTERVAL_MS);
});

test('repeatWhile waits for each fire before the next (no overlap)', async () => {
  let running = 0;
  let maxRunning = 0;
  let n = 0;
  await repeatWhile(
    () => n < 5,
    async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      n += 1;
      running -= 1;
    },
    async () => {},
  );
  expect(maxRunning).toBe(1);
});

test('repeatWhile does nothing when it cannot start (e.g. cannot afford)', async () => {
  expect(await repeatWhile(() => false, async () => {}, async () => {})).toBe(0);
});
