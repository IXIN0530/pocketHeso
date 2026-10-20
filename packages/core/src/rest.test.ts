/** 閉店後の休業と開店（spec/25「休業」, D-107。P12-T1）。 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
import { Engine } from './engine.ts';

type Json = Record<string, unknown>;

const MACHINE = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
const PATTERNS = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));

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
  const buf = readFileSync(dir + '/' + found);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return ab;
}

const ATLAS = loadAtlas();
const REST_MAX = 1800000;
/** 閉店の時刻（1000ms・600ms の両方の倍数。同じ t の economyTick・発射が開店の後に来る）。 */
const T = 600000;

function econJson(): Json {
  return JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Json;
}

/** 閉店できる経済（常連P 100・今回の累計玉 2e10・役物と強化あり）。 */
function closable(): IdleEconomy {
  const e = new IdleEconomy(parseEconomy(econJson()));
  e.restore({
    ...(e.snapshot() as unknown as Json),
    points: 100,
    pointsEarned: 100,
    runTotal: 2e10,
    totalTotal: 1e12,
    medalsEarned: 10000,
    lv: [60, 40, 20, 0, 0, 0, 0, 0],
    tankStage: 2,
    idleStage: 1,
    autoOwned: true,
  });
  return e;
}

function engine(grants: Grant[], actions: Action[], econ: IdleEconomy = closable()): Engine {
  return new Engine(
    { seed: 11, spec: MACHINE, patterns: PATTERNS, atlas: ATLAS, initialBalls: 1e9, initialMedals: 50, economy: econ },
    grants,
    actions,
  );
}

const FUEL: Grant = { claimId: 'fuel', at: 0, fuelMs: 12 * 3600000, medals: 0 };

/** 比べる値（イベントは opened を除く。経済は休業の保存項目と版を除く）。 */
function digest(eng: Engine, events: readonly SimEvent[]): string {
  const snap = eng.snapshot();
  const econ = { ...(snap.economy as Json) };
  delete econ['v'];
  delete econ['restAt'];
  delete econ['restPendingBalls'];
  delete econ['runMaxLv'];
  delete econ['prevMaxLv'];
  const evs = events.filter((e) => e.k !== 'opened');
  const canonical = JSON.stringify({ evs, econ, balls: snap.balls, medals: snap.medals, fuelMs: snap.fuelMs });
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

test('close と open を同じ t で出すと、休業を入れる前の close と玉・役物・強化・イベントが一致する', () => {
  const actions: Action[] = [
    { t: 0, k: 'shoot', on: true, rate: 1 },
    { t: 0, k: 'auto', share: 0.5, rate: 1 },
    { t: 1000, k: 'treeBuy', node: 'kanban' },
    { t: 1000, k: 'treeBuy', node: 'tank_keep' },
    { t: 1000, k: 'treeBuy', node: 'starter1' },
    { t: 1000, k: 'treeBuy', node: 'open_dash1' },
    { t: T, k: 'close' },
    { t: T, k: 'open' },
    { t: T + 60000, k: 'presence', fg: false },
  ];
  const grants: Grant[] = [FUEL, { claimId: 'p', at: T + 120000, fuelMs: 3600000, medals: 3, prodMin: 1 }];
  const eng = engine(grants, actions);
  const events = eng.advance(T + 300000);
  expect(events.filter((e) => e.k === 'closed').length).toBe(1);
  expect(events.filter((e) => e.k === 'opened')).toEqual([{ k: 'opened', at: T, auto: false }]);
  expect(eng.project().shop!.yakumono[0]!.lv).toBeGreaterThanOrEqual(25);
  // 休業を入れる前（v1.2.1, 1d76727）の Engine で close だけを出した時の値。
  expect(digest(eng, events)).toBe('c80d24b3a32354ef');
});

test('休業中に starter・keep・開店ダッシュを買うと、その周回から効く', () => {
  const buys: Action[] = [
    { t: T + 1000, k: 'treeBuy', node: 'kanban' },
    { t: T + 1000, k: 'treeBuy', node: 'tank_keep' },
    { t: T + 1000, k: 'treeBuy', node: 'starter1' },
    { t: T + 1000, k: 'treeBuy', node: 'open_dash1' },
  ];
  const eng = engine([FUEL], [{ t: T, k: 'close' }, ...buys, { t: T + 2000, k: 'open' }]);
  eng.advance(T + 2001);
  const p = eng.project();
  expect(p.rest).toBeNull();
  expect(p.yakumono.map((y) => y.lv)).toEqual([25, 10, 0, 0, 0, 0, 0, 0]);
  expect(p.shop!.upgrades.find((u) => u.id === 'tank')!.stage).toBe(2);
  expect(p.shop!.upgrades.find((u) => u.id === 'idle')!.stage).toBe(0);
  expect(p.tree!.openBoostMs).toBe(7200000 - 1000);
  expect(p.balls).toBeGreaterThanOrEqual(100);
  expect(p.shop!.close.runTotal).toBe(p.balls - 100);
  // 開店の後に買うと次の開店まで効かない（今までどおり）。
  const late = engine([FUEL], [{ t: T, k: 'close' }, { t: T + 500, k: 'open' }, ...buys]);
  late.advance(T + 2001);
  const q = late.project();
  expect(q.yakumono.map((y) => y.lv)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  expect(q.shop!.upgrades.find((u) => u.id === 'tank')!.stage).toBe(0);
  expect(q.tree!.openBoostMs).toBe(0);
});

test('自動の開店は restAt + rest_max_ms ちょうど（1つ前は休業）。留守中・長い advance・lookahead でも同じ時刻', () => {
  const at = T + REST_MAX;
  const step = engine([FUEL], [{ t: T, k: 'close' }, { t: T + 5000, k: 'presence', fg: false }]);
  step.advance(T + 1);
  expect(step.project().rest).toEqual({ since: T, autoOpenAt: at, pendingBalls: 0 });
  const ahead = step.lookahead(at + 1).filter((e) => e.k === 'opened');
  expect(ahead).toEqual([{ k: 'opened', at, auto: true }]);
  expect(step.advance(at).filter((e) => e.k === 'opened')).toEqual([]);
  expect(step.project().rest).not.toBeNull();
  expect(step.advance(at + 1).filter((e) => e.k === 'opened')).toEqual([{ k: 'opened', at, auto: true }]);
  expect(step.project().rest).toBeNull();
  // 一度に長く進めても同じ。
  const long = engine([FUEL], [{ t: T, k: 'close' }, { t: T + 5000, k: 'presence', fg: false }]);
  const evs = long.advance(at + 3600000);
  expect(evs.filter((e) => e.k === 'opened')).toEqual([{ k: 'opened', at, auto: true }]);
  expect(digest(long, [])).toBe(digest((() => {
    const e = engine([FUEL], [{ t: T, k: 'close' }, { t: T + 5000, k: 'presence', fg: false }]);
    e.advance(T + 1);
    e.advance(at);
    e.advance(at + 1);
    e.advance(at + 3600000);
    return e;
  })(), []));
  // 開店した後の open は rejected。
  const twice = engine([FUEL], [{ t: T, k: 'close' }, { t: at, k: 'open' }]);
  expect(twice.advance(at + 1).filter((e) => e.k === 'rejected' || e.k === 'opened')).toEqual([
    { k: 'opened', at, auto: true },
    { k: 'rejected', at, action: 'open', reason: 'not-resting' },
  ]);
});

test('休業中: 生産 0・燃料が減らない・発射しない・close/shoot は rejected、Grant の玉は開店後の持ち玉に入る', () => {
  const grants: Grant[] = [FUEL, { claimId: 'p', at: T + 10000, fuelMs: 0, medals: 2, prodMin: 1, bonusHolds: 1 }];
  const actions: Action[] = [
    { t: 0, k: 'shoot', on: true, rate: 1 },
    { t: 0, k: 'open' },
    { t: T, k: 'close' },
    { t: T + 3000, k: 'shoot', on: true, rate: 1 },
    { t: T + 3000, k: 'shoot', on: false, rate: 1 },
    { t: T + 3000, k: 'close' },
    { t: T + 60000, k: 'open' },
  ];
  const eng = engine(grants, actions);
  const before = eng.advance(T);
  expect(before.find((e) => e.k === 'rejected')).toEqual({ k: 'rejected', at: 0, action: 'open', reason: 'not-resting' });
  eng.advance(T + 2000);
  const fuel0 = eng.project().fuelMs;
  const p0 = eng.project();
  expect(p0.perSec).toBe(0);
  const rest = eng.advance(T + 30000);
  expect(rest.filter((e) => e.k === 'rejected')).toEqual([
    { k: 'rejected', at: T + 3000, action: 'shoot', reason: 'resting' },
    { k: 'rejected', at: T + 3000, action: 'close', reason: 'resting' },
  ]);
  expect(rest.filter((e) => e.k === 'fired' && e.at >= T + 2000)).toEqual([]);
  const granted = rest.find((e) => e.k === 'granted') as { balls: number; medals: number; bonusHolds: number };
  expect(granted.balls).toBeGreaterThan(0);
  expect(granted.medals).toBe(2);
  expect(granted.bonusHolds).toBe(1);
  const p1 = eng.project();
  expect(p1.fuelMs).toBe(fuel0);
  expect(p1.rest!.pendingBalls).toBe(granted.balls);
  expect(rest.some((e) => e.k === 'holdAdded' && e.at === T + 10000)).toBe(true);
  const opened = eng.advance(T + 60001);
  expect(opened.filter((e) => e.k === 'opened')).toEqual([{ k: 'opened', at: T + 60000, auto: false }]);
  const p2 = eng.project();
  expect(p2.rest).toBeNull();
  expect(p2.balls).toBe(100 + granted.balls);
  expect(p2.shop!.close.runTotal).toBe(granted.balls);
});

test('休業中の行動の玉は「今のツリーで開店した直後」の基準生産で量る（D-108）', () => {
  const plain = engine(
    [FUEL, { claimId: 'p', at: T + 10000, fuelMs: 0, medals: 0, prodMin: 1 }],
    [{ t: T, k: 'close' }, { t: T, k: 'open' }],
  );
  const a = plain.advance(T + 10001).find((e) => e.k === 'granted') as { balls: number };
  const resting = engine([FUEL, { claimId: 'p', at: T + 10000, fuelMs: 0, medals: 0, prodMin: 1 }], [{ t: T, k: 'close' }]);
  const b = resting.advance(T + 10001).find((e) => e.k === 'granted') as { balls: number };
  expect(b.balls).toBe(a.balls);
});

test('v7 のセーブは休業でない状態で始まり、休業中の snapshot/restore は通しと一致する', () => {
  const e = closable();
  const v7: Json = { ...(e.snapshot() as unknown as Json), v: 7 };
  delete v7['restAt'];
  delete v7['restPendingBalls'];
  const back = new IdleEconomy(parseEconomy(econJson()));
  back.restore(v7);
  expect(back.isResting()).toBe(false);
  expect(back.getRestView()).toBeNull();
  expect(back.snapshot().v).toBe(9);
  expect(back.snapshot().restAt).toBeNull();

  const grants: Grant[] = [FUEL, { claimId: 'p', at: T + 10000, fuelMs: 0, medals: 0, prodMin: 1 }];
  const actions: Action[] = [{ t: 0, k: 'shoot', on: true, rate: 1 }, { t: T, k: 'close' }];
  const whole = engine(grants, actions);
  const all = whole.advance(T + REST_MAX + 60000);
  const first = engine(grants, actions);
  const part = first.advance(T + 20000);
  expect(first.project().rest!.pendingBalls).toBeGreaterThan(0);
  const snap = first.snapshot();
  expect((snap.economy as Json)['restAt']).toBe(T);
  const again = Engine.restore(JSON.parse(JSON.stringify(snap)), {
    seed: 11, spec: MACHINE, patterns: PATTERNS, atlas: ATLAS, economy: new IdleEconomy(parseEconomy(econJson())),
  });
  expect(again.project().rest).toEqual(first.project().rest);
  const rest = again.advance(T + REST_MAX + 60000);
  expect([...part, ...rest]).toEqual(all);
  expect(digest(again, [])).toBe(digest(whole, []));
});

test('ツリーの行の timing: keep・starter・open_boost だけなら open、他は now', () => {
  const nodes = closable().getTreeView().nodes;
  const timing = (id: string): string => nodes.find((n) => n.id === id)!.timing;
  expect(timing('starter1')).toBe('open');
  expect(timing('tank_keep')).toBe('open');
  expect(timing('open_dash1')).toBe('open');
  expect(timing('kanban')).toBe('now');
  expect(timing('bantou')).toBe('now');
});

test('close.rest_max_ms は 60,000 以上の整数', () => {
  const bad = econJson();
  (bad['close'] as Json)['rest_max_ms'] = 59999;
  expect(() => parseEconomy(bad)).toThrow(/rest_max_ms/);
  (bad['close'] as Json)['rest_max_ms'] = 60000.5;
  expect(() => parseEconomy(bad)).toThrow(/rest_max_ms/);
  expect(parseEconomy(econJson()).close.restMaxMs).toBe(REST_MAX);
});
