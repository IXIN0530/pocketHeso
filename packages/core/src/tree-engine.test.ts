import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, Grant, SimEvent } from './engine.ts';
import { Engine, GRANT_HOLD_SERIAL_BASE } from './engine.ts';
import { drawGrantHold } from './lottery.ts';

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

function econJson(): Json {
  return JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Json;
}

/** 常連P を points 持った経済（ツリーは空）。 */
function econWith(points: number, json: Json = econJson(), extra: Json = {}): IdleEconomy {
  const e = new IdleEconomy(parseEconomy(json));
  e.restore({ ...(e.snapshot() as unknown as Json), points, pointsEarned: points, ...extra });
  return e;
}

/** 段3（番頭さん・特別保留の目利き）まで開く12個＋ツリーの台本。 */
const TIER3_PATH = [
  'kanban', 'tank_keep', 'auto_keep', 'starter1', 'lamp_gold', 'open_dash1', 'notice_call1', 'idle_keep', 'sashiire1',
  'nail_keep', 'lcd_sakura', 'shop_light1',
];

function treeBuys(t: number, ids: readonly string[]): Action[] {
  return ids.map((node) => ({ t, k: 'treeBuy', node }) as const);
}

const GRANTS: Grant[] = [
  { claimId: 'g0', at: 0, fuelMs: 12 * 3600000, medals: 0 },
  { claimId: 'g1', at: 600000, fuelMs: 3600000, medals: 5, prodMin: 1, bonusHolds: 3 },
];

const ACTIONS: Action[] = [
  { t: 0, k: 'buy', target: 'windmill', count: 10 },
  { t: 1000, k: 'bantou', on: true },
  ...treeBuys(2000, [...TIER3_PATH, 'bantou', 'grant_hold_luck', 'notice_auto']),
  { t: 2000, k: 'treeBuy', node: 'kanban' },
  { t: 2000, k: 'treeBuy', node: 'nope' },
  { t: 3000, k: 'bantou', on: true },
  { t: 3000, k: 'shoot', on: true, rate: 1 },
  { t: 1200000, k: 'presence', fg: false },
  { t: 1500000, k: 'presence', fg: true },
];

const END = 2400000;

function scripted(): Engine {
  return new Engine(
    { seed: 42, spec: MACHINE, patterns: PATTERNS, atlas: ATLAS, initialBalls: 100000, initialMedals: 20, economy: econWith(2000) },
    GRANTS,
    ACTIONS,
  );
}

function stepped(eng: Engine, from: number, to: number, step: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = from + step; t <= to; t = t + step) {
    out.push(...eng.advance(t));
  }
  return out;
}

test('treeBuy・bantou を含む台本: advance 1回と1秒刻みが一致', () => {
  const a = scripted();
  const evA = a.advance(END);
  const b = scripted();
  const evB = stepped(b, 0, END, 1000);
  expect(evB).toEqual(evA);
  expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(a.snapshot()));
  const rejected = evA.filter((e) => e.k === 'rejected');
  expect(rejected).toContainEqual({ k: 'rejected', at: 1000, action: 'bantou', reason: 'not-owned' });
  expect(rejected).toContainEqual({ k: 'rejected', at: 2000, action: 'treeBuy', reason: 'owned' });
  expect(rejected).toContainEqual({ k: 'rejected', at: 2000, action: 'treeBuy', reason: 'unknown-node' });
  const p = a.project();
  const tree = p.tree;
  expect(tree).toBeDefined();
  expect(tree!.bantou).toEqual({ owned: true, on: true });
  expect(tree!.nodes.filter((n) => n.state === 'owned').length).toBe(15);
  // 番頭さんが風車の次の役物も買っている（手では風車しか買っていない）。
  expect(p.yakumono[1]!.lv).toBeGreaterThan(0);
  // light の台なので shop_light1（+0.1）と看板（+0.1）が treeMult に入る。
  expect(tree!.mult).toBeCloseTo(1.2, 12);
});

test('snapshot → restore → 続行 が通しと一致（機種 id も復元後に渡る）', () => {
  const whole = scripted();
  const evWhole = whole.advance(END);
  const first = scripted();
  const ev1 = first.advance(1300000);
  const snap = JSON.parse(JSON.stringify(first.snapshot()));
  const econ = new IdleEconomy(parseEconomy(econJson()));
  const second = Engine.restore(snap, { seed: 42, spec: MACHINE, patterns: PATTERNS, atlas: ATLAS, economy: econ });
  const ev2 = second.advance(END);
  expect([...ev1, ...ev2]).toEqual(evWhole);
  expect(JSON.stringify(second.snapshot())).toBe(JSON.stringify(whole.snapshot()));
  expect(second.project().tree!.mult).toBeCloseTo(1.2, 12);
});

test('notice_auto: 前面の予告は出現 +3秒で受け取る（失効しない）。背面なら受け取らず、期限内に戻れば戻った時刻に', () => {
  const make = (extra: Action[]): Engine => new Engine(
    { seed: 7, spec: MACHINE, patterns: PATTERNS, atlas: ATLAS, initialBalls: 100000, economy: econWith(100) },
    [{ claimId: 'g0', at: 0, fuelMs: 12 * 3600000, medals: 0 }],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      ...treeBuys(0, ['kanban', 'auto_keep', 'notice_call1', 'tank_keep', 'starter1', 'notice_auto']),
      ...extra,
    ],
  );
  const base = make([]);
  const evs = base.advance(3600000);
  const spawned = evs.filter((e) => e.k === 'noticeSpawned');
  expect(spawned.length).toBeGreaterThanOrEqual(2);
  expect(evs.filter((e) => e.k === 'noticeExpired').length).toBe(0);
  const t0 = (spawned[0] as { at: number }).at;
  // +3秒の直前では表示中、直後には受け取り済み。
  const probe = make([]);
  probe.advance(t0 + 2999);
  expect(probe.project().notice?.id).toBe(0);
  probe.advance(t0 + 3001);
  expect(probe.project().notice).toBeUndefined();

  const away = make([{ t: t0 + 1000, k: 'presence', fg: false }, { t: t0 + 20000, k: 'presence', fg: true }]);
  const evAway = away.advance(t0 + 30000);
  expect(evAway.filter((e) => e.k === 'noticeExpired').map((e) => (e as { id: number }).id)).toEqual([0]);

  const back = make([{ t: t0 + 1000, k: 'presence', fg: false }, { t: t0 + 5000, k: 'presence', fg: true }]);
  back.advance(t0 + 5000);
  expect(back.project().notice?.id).toBe(0);
  const evBack = back.advance(t0 + 30000);
  expect(back.project().notice).toBeUndefined();
  expect(evBack.filter((e) => e.k === 'noticeExpired').length).toBe(0);
});

test('grant_hold_1_in: 行動の特別保留だけ 1/8 で抽選する', () => {
  const econ = econWith(200);
  const eng = new Engine(
    { seed: 3, spec: MACHINE, patterns: PATTERNS, atlas: ATLAS, initialBalls: 0, economy: econ },
    [{ claimId: 'g', at: 0, fuelMs: 0, medals: 0, bonusHolds: 3 }],
    treeBuys(0, [...TIER3_PATH, 'grant_hold_luck']),
  );
  expect(econ.getNoticeConfig().grantBonus1In).toBe(10);
  const evs = eng.advance(1);
  expect(econ.getNoticeConfig().grantBonus1In).toBe(8);
  expect(econ.getNoticeConfig().bonus1In).toBe(10);
  const added = evs.filter((e) => e.k === 'holdAdded').map((e) => (e as { entry: unknown }).entry);
  expect(added.length).toBe(3);
  const unit = econ.getShotUnit(1);
  for (let n = 0; n < 3; n = n + 1) {
    expect(added[n]).toEqual(drawGrantHold(MACHINE, PATTERNS, 3, 'normal', n, GRANT_HOLD_SERIAL_BASE + n, 8, unit));
  }
});

test('番頭さんの購入順: 次の Lv が最も安い役物から1 Lv ずつ（同額は添字の小さい方・解放は前の役物 Lv1・上限 max_per_run）', () => {
  const json = econJson();
  const yak = json['yakumono'] as Json[];
  (yak[1] as Json)['base_price'] = 15; // 風車と回転体を同額にする
  const owned = (e: IdleEconomy): void => {
    const ids = [...TIER3_PATH, 'bantou'];
    for (let i = 0; i < ids.length; i = i + 1) {
      expect(e.buyTreeNode(ids[i] as string, 0)).toEqual({ ok: true });
    }
  };
  const e = econWith(1000, json);
  owned(e);
  // OFF の間は買わない。
  expect(e.onBantouTick(1e6)).toEqual({ balls: 1e6, spent: 0 });
  expect(e.onBantou(true)).toEqual({ ok: true });
  // 予算 30 × 0.5 = 15 → 風車 Lv1 だけ（回転体は風車 Lv1 で解放されるが同額で予算切れ）。
  const r1 = e.onBantouTick(30);
  expect(r1.spent).toBe(15);
  expect(e.getYakumonoViews().map((v) => v.lv).slice(0, 3)).toEqual([1, 0, 0]);
  // 予算 15 → 次は回転体 Lv0（15）が風車 Lv1（15×1.15）より安い。
  e.onBantouTick(30);
  expect(e.getYakumonoViews().map((v) => v.lv).slice(0, 3)).toEqual([1, 1, 0]);
  // 同額（風車 Lv1・回転体 Lv1）は添字の小さい風車から。
  const before = e.getYakumonoViews();
  const price = before[0]!.nextPrice!;
  e.onBantouTick(price * 2);
  expect(e.getYakumonoViews().map((v) => v.lv).slice(0, 3)).toEqual([2, 1, 0]);

  // 参照実装（毎回 nextPrice 最小・同額は添字順・前の役物 Lv1 で解放）と一致し、1回の上限は max_per_run。
  const big = econWith(1000, econJson());
  owned(big);
  big.onBantou(true);
  const ref = econWith(0, econJson());
  const balls = 1e30;
  let budget = balls * 0.5;
  const lv = [0, 0, 0, 0, 0, 0, 0, 0];
  let bought = 0;
  for (; bought < 100; bought = bought + 1) {
    ref.restore({ ...(ref.snapshot() as unknown as Json), lv: [...lv] });
    const views = ref.getYakumonoViews();
    let best = -1;
    for (let i = 0; i < 8; i = i + 1) {
      if (i > 0 && (lv[i - 1] as number) < 1) {
        continue;
      }
      if (best < 0 || views[i]!.nextPrice! < views[best]!.nextPrice!) {
        best = i;
      }
    }
    const p = views[best]!.nextPrice!;
    if (p > budget) {
      break;
    }
    budget = budget - p;
    lv[best] = (lv[best] as number) + 1;
  }
  expect(bought).toBe(100);
  big.onBantouTick(balls);
  expect(big.getYakumonoViews().map((v) => v.lv)).toEqual(lv);
});

test('番頭さん: 24時間の advance の時間が OFF の 1.5倍以内', () => {
  const run = (on: boolean): number => {
    const eng = new Engine(
      { seed: 5, spec: MACHINE, patterns: PATTERNS, atlas: ATLAS, initialBalls: 1e6, economy: econWith(1000) },
      [{ claimId: 'g0', at: 0, fuelMs: 12 * 3600000, medals: 0 }],
      [
        { t: 0, k: 'buy', target: 'windmill', count: 10 },
        ...treeBuys(0, [...TIER3_PATH, 'bantou']),
        { t: 0, k: 'bantou', on },
        { t: 0, k: 'presence', fg: false },
      ],
    );
    const s = performance.now();
    eng.advance(24 * 3600000);
    const ms = performance.now() - s;
    if (on) {
      expect(eng.project().yakumono[2]!.lv).toBeGreaterThan(0);
    }
    return ms;
  };
  run(false);
  let off = Infinity;
  let on = Infinity;
  for (let i = 0; i < 3; i = i + 1) {
    off = Math.min(off, run(false));
    on = Math.min(on, run(true));
  }
  expect(on).toBeLessThanOrEqual(off * 1.5);
});

test('closed イベントに今回得た常連P（points）が載り、閉店見込みと一致する', () => {
  const econ = econWith(0, econJson(), { runTotal: 2e11, totalTotal: 1e12, regular: 0, medalsEarned: 10000 });
  const eng = new Engine(
    { seed: 1, spec: MACHINE, patterns: PATTERNS, atlas: ATLAS, initialBalls: 0, economy: econ },
    [],
    [{ t: 1000, k: 'close' }],
  );
  eng.advance(1000);
  const want = eng.project().tree!.nextClosePoints;
  expect(eng.project().shop!.close.points).toBe(want);
  expect(want).toBeGreaterThan(0);
  const evs = eng.advance(2000);
  const closed = evs.find((e) => e.k === 'closed') as { points?: number; regularPoints: number };
  expect(closed.points).toBe(want);
  expect(eng.project().tree!.points).toBe(want);
});
