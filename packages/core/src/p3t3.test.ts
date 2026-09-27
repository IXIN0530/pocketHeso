import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
import { Engine } from './engine.ts';

function loadMachine(): { spec: MachineSpec; patterns: PatternTable } {
  const spec = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  return { spec, patterns };
}

function loadAtlas(): ArrayBuffer {
  const dir = '../../resources/atlas';
  const names = readdirSync(dir);
  let found = '';
  for (let i = 0; i < names.length; i = i + 1) {
    const n = names[i] as string;
    if (n.length > 4 && n.slice(n.length - 4) === '.bin') {
      found = n;
      break;
    }
  }
  if (found === '') {
    throw new Error('atlas .bin not found');
  }
  const buf = readFileSync(dir + '/' + found);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const ab = new ArrayBuffer(u8.length);
  new Uint8Array(ab).set(u8);
  return ab;
}

function loadEconomy(): IdleEconomy {
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as unknown;
  return new IdleEconomy(parseEconomy(json));
}

interface GoldenScript {
  seed: number;
  initialBalls: number;
  initialMedals: number;
  initialFuelMs: number;
  until: number;
  grants: Grant[];
  actions: Action[];
}

function loadScript(): GoldenScript {
  return JSON.parse(readFileSync('../../resources/golden/script01.json', 'utf8')) as GoldenScript;
}

function runScript(): { events: SimEvent[]; econHash: string; fullHash: string } {
  const { spec, patterns } = loadMachine();
  const s = loadScript();
  const eng = new Engine(
    {
      seed: s.seed,
      spec,
      patterns,
      atlas: loadAtlas(),
      initialBalls: s.initialBalls,
      initialMedals: s.initialMedals,
      initialFuelMs: s.initialFuelMs,
      economy: loadEconomy(),
    },
    s.grants,
    s.actions,
  );
  const events = eng.advance(s.until);
  const snap = eng.snapshot();
  const canonical = JSON.stringify({ events, economy: snap.economy, balls: snap.balls, fuelMs: snap.fuelMs });
  const fullHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const econHash = createHash('sha256').update(JSON.stringify(snap.economy), 'utf8').digest('hex');
  return { events, econHash, fullHash };
}

test('ゴールデン: script01のイベント列＋最終経済状態が固定', () => {
  const { events, fullHash } = runScript();
  expect(events.length).toBeGreaterThan(60000);
  expect(events.filter((e) => e.k === 'noticeSpawned').length).toBeGreaterThan(0);
  expect(fullHash.slice(0, 16)).toBe('55bc36381f5852ff');
});

function t3Engine(seed: number): Engine {
  const { spec, patterns } = loadMachine();
  return new Engine(
    { seed, spec, patterns, atlas: loadAtlas(), initialBalls: 1000000, initialMedals: 20, economy: loadEconomy() },
    [{ claimId: 'g', at: 5000, fuelMs: 12 * 3600000, medals: 5 }],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share: 0.5, rate: 1 },
      { t: 0, k: 'buy', target: 'nail', count: 1 },
      { t: 0, k: 'buy', target: 'shorten', count: 1 },
      { t: 0, k: 'buy', target: 'hold', count: 1 },
      { t: 60000, k: 'presence', fg: false },
      { t: 120000, k: 'presence', fg: true },
    ],
  );
}

test('決定論契約1: 経済込み1回vs1秒刻みで一致（予告・強化込み）', () => {
  const until = 1800000;
  const a = t3Engine(99);
  const once = a.advance(until);
  const snapOnce = a.snapshot();
  const b = t3Engine(99);
  const parts: SimEvent[] = [];
  for (let t = 1000; t <= until; t = t + 1000) {
    const step = b.advance(t);
    for (let i = 0; i < step.length; i = i + 1) {
      parts.push(step[i] as SimEvent);
    }
  }
  expect(parts).toEqual(once);
  expect(b.snapshot()).toEqual(snapOnce);
});

test('決定論契約1: 1000msに揃わない刻みでも1回と一致（経済tick・予告出現時刻）', () => {
  const until = 1800000;
  const a = t3Engine(99);
  const once = a.advance(until);
  const snapOnce = a.snapshot();
  const steps = [1, 337, 499, 600, 999, 1234, 1500, 7777];
  const b = t3Engine(99);
  const parts: SimEvent[] = [];
  let t = 0;
  let i = 0;
  while (t < until) {
    const next = t + (steps[i % steps.length] as number);
    t = next > until ? until : next;
    i = i + 1;
    const step = b.advance(t);
    for (let j = 0; j < step.length; j = j + 1) {
      parts.push(step[j] as SimEvent);
    }
  }
  expect(parts.filter((e) => e.k === 'noticeSpawned').length).toBeGreaterThan(0);
  expect(parts).toEqual(once);
  expect(b.snapshot()).toEqual(snapOnce);
});

test('経済tick: 1000ms未満のadvanceを重ねても生産が消えない', () => {
  const a = t3Engine(5);
  a.advance(10000);
  const b = t3Engine(5);
  for (let t = 500; t <= 10000; t = t + 500) {
    b.advance(t);
  }
  expect(b.snapshot().balls).toBe(a.snapshot().balls);
  expect(b.snapshot().fuelMs).toBe(a.snapshot().fuelMs);
});

test('決定論契約2: 経済込みsnapshot/restoreで一致（予告・留守込み）', () => {
  const until = 1800000;
  const mid = 900000;
  const through = t3Engine(77);
  through.advance(mid);
  const snap = through.snapshot();
  const tailThrough = through.advance(until);
  const snapThrough = through.snapshot();
  const resumed = Engine.restore(snap, {
    seed: 77,
    spec: loadMachine().spec,
    patterns: loadMachine().patterns,
    atlas: loadAtlas(),
    economy: loadEconomy(),
  });
  expect(resumed.advance(until)).toEqual(tailThrough);
  expect(resumed.snapshot()).toEqual(snapThrough);
});

test('決定論契約4: 経済計算は許可APIのみ（+ - * /・sqrt・floor）', () => {
  const files = ['economy-math.ts', 'economy-state.ts', 'engine.ts', 'lottery.ts', 'spin.ts', 'rng.ts'];
  const banned = [
    'Math.sin',
    'Math.cos',
    'Math.tan',
    'Math.atan2',
    'Math.exp',
    'Math.log',
    'Math.pow',
    'Math.hypot',
    'Math.cbrt',
    'Math.random',
    'Date.now',
    'new Date',
    'getRandomValues',
  ];
  for (let i = 0; i < files.length; i = i + 1) {
    const name = files[i] as string;
    const raw = readFileSync('./src/' + name, 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    for (let j = 0; j < banned.length; j = j + 1) {
      const b = banned[j] as string;
      expect(src.includes(b), name + ' contains ' + b).toBe(false);
    }
    expect(src.includes('**'), name + ' contains **').toBe(false);
  }
});

const ADVANCE_24H_LIMIT_MS = process.env['CI'] || process.env['VERCEL'] ? 1000 : 150;

test(
  '放置24時間のadvanceがNodeで150ms以内（CIは1000ms）',
  { timeout: 60000 },
  () => {
    const { spec, patterns } = loadMachine();
    const atlas = loadAtlas();
    const economyJson = readFileSync('../../resources/economy/default.json', 'utf8');
    const mk = (): Engine =>
      new Engine(
        {
          seed: 42,
          spec,
          patterns,
          atlas,
          initialBalls: 100000,
          initialMedals: 10,
          economy: new IdleEconomy(parseEconomy(JSON.parse(economyJson) as unknown)),
        },
        [{ claimId: 'f', at: 0, fuelMs: 12 * 3600000, medals: 0 }],
        [
          { t: 0, k: 'buy', target: 'windmill', count: 10 },
          { t: 0, k: 'shoot', on: true, rate: 1 },
        ],
      );
    mk().advance(3600000);
    const until = 24 * 60 * 60 * 1000;
    let best = Number.POSITIVE_INFINITY;
    let count = 0;
    for (let i = 0; i < 5 && best >= ADVANCE_24H_LIMIT_MS; i = i + 1) {
      const eng = mk();
      const t0 = performance.now();
      const evs = eng.advance(until);
      const ms = performance.now() - t0;
      count = evs.length;
      if (ms < best) {
        best = ms;
      }
    }
    expect(count).toBeGreaterThan(100000);
    expect(best).toBeLessThan(ADVANCE_24H_LIMIT_MS);
  },
);
