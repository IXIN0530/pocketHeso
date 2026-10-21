/** 休業中の台選び（pickMachine）と開店での切り替え（spec/22 の新台入替・spec/25 の unlock_machine, P14-T1）。 */
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseMachineText, parsePatternsText, type MachineSpec } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { Action, EngineSnapshot, Grant, SimEvent } from './engine.ts';
import { BONUS_SERIAL_BASE, Engine, GRANT_HOLD_SERIAL_BASE, RESERVE_SERIAL_BASE } from './engine.ts';
import { drawHold, type LotteryMode } from './lottery.ts';
import { parseTree, treeUnknownMachines } from './tree-config.ts';

type Json = Record<string, unknown>;

function machine(id: string): MachineSpec {
  return parseMachineText(readFileSync('../../resources/machines/' + id + '.json', 'utf8'));
}

const LIGHT = machine('light-middle-01');
const RUSH = machine('rush-middle-01');
const LT = machine('lt-middle-01');
const MACHINES: readonly MachineSpec[] = [LIGHT, RUSH, LT];
const PATTERNS = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));

function loadAtlas(): ArrayBuffer {
  const dir = '../../resources/atlas';
  const names = readdirSync(dir);
  const found = names.find((n) => n.length > 4 && n.slice(n.length - 4) === '.bin') as string;
  const buf = readFileSync(dir + '/' + found);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return ab;
}

const ATLAS = loadAtlas();
const SEED = 11;
const REST_MAX = 1800000;
/** 閉店の時刻（1000ms・600ms の両方の倍数）。 */
const T = 600000;
const FUEL: Grant = { claimId: 'fuel', at: 0, fuelMs: 12 * 3600000, medals: 0 };

function econJson(): Json {
  return JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Json;
}

/** 閉店できる経済（常連P 100・今回の累計玉 2e10・オート打ちあり）。 */
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
    autoOwned: true,
  });
  return e;
}

/** machines の null は「渡さない」構成。 */
function engine(grants: Grant[], actions: Action[], machines: readonly MachineSpec[] | null = MACHINES): Engine {
  return new Engine(
    { seed: SEED, spec: LIGHT, patterns: PATTERNS, atlas: ATLAS, initialBalls: 1e12, initialMedals: 50, economy: closable(), machines: machines === null ? undefined : machines },
    grants,
    actions,
  );
}

function restoreCfg(): { seed: number; spec: MachineSpec; patterns: typeof PATTERNS; atlas: ArrayBuffer; economy: IdleEconomy; machines: readonly MachineSpec[] } {
  return { seed: SEED, spec: LIGHT, patterns: PATTERNS, atlas: ATLAS, economy: new IdleEconomy(parseEconomy(econJson())), machines: MACHINES };
}

function picks(events: readonly SimEvent[]): SimEvent[] {
  return events.filter((e) => (e.k === 'rejected' && e.action === 'pickMachine') || e.k === 'opened');
}

/** 休業中の行動の玉（開店後の持ち玉。開店後に手で打つ分）。 */
const BALLS: Grant = { claimId: 'b', at: T + 500, fuelMs: 0, medals: 0, prodMin: 10000 };

/** オート打ち・閉店・（買って）選ぶ・開店して手で打つ台本。 */
function script(buy: string[], pick: string[], open: boolean): Action[] {
  const a: Action[] = [{ t: 0, k: 'auto', share: 0.5, rate: 1 }, { t: T, k: 'close' }];
  for (const node of buy) {
    a.push({ t: T + 1000, k: 'treeBuy', node });
  }
  for (const machineId of pick) {
    a.push({ t: T + 2000, k: 'pickMachine', machineId });
  }
  if (open) {
    a.push({ t: T + 3000, k: 'open' }, { t: T + 3000, k: 'shoot', on: true, rate: 1 });
  }
  return a;
}

test('開放ノードなしは rejected machine、休業外は not-resting、未知の id も machine', () => {
  const eng = engine([FUEL], [
    { t: 0, k: 'pickMachine', machineId: 'rush-middle-01' },
    ...script([], ['rush-middle-01', 'nope'], true),
  ]);
  const evs = eng.advance(T + 4000);
  expect(picks(evs)).toEqual([
    { k: 'rejected', at: 0, action: 'pickMachine', reason: 'not-resting' },
    { k: 'rejected', at: T + 2000, action: 'pickMachine', reason: 'machine' },
    { k: 'rejected', at: T + 2000, action: 'pickMachine', reason: 'machine' },
    { k: 'opened', at: T + 3000, auto: false },
  ]);
  expect(eng.project().machineId).toBe('light-middle-01');
  expect(eng.project().machinesOpen).toEqual(['light-middle-01']);
  // machines を渡さない構成は最初の台だけ。
  const solo = engine([FUEL], [{ t: T, k: 'close' }, { t: T + 1000, k: 'treeBuy', node: 'shop_kokudo_open' }, { t: T + 2000, k: 'pickMachine', machineId: 'rush-middle-01' }], null);
  expect(picks(solo.advance(T + 3000))).toEqual([{ k: 'rejected', at: T + 2000, action: 'pickMachine', reason: 'machine' }]);
});

test('買った台は選べて、手動の開店でその台に切り替わり、その後の抽選は新しい台の表', () => {
  const eng = engine([FUEL, BALLS], script(['shop_kokudo_open'], ['rush-middle-01'], true));
  eng.advance(T + 2001);
  const resting = eng.project();
  expect(resting.machinesOpen).toEqual(['light-middle-01', 'rush-middle-01']);
  expect(resting.restMachineId).toBe('rush-middle-01');
  expect(resting.machineId).toBe('light-middle-01');
  const evs = eng.advance(T + 3 * 3600000);
  const openIdx = evs.findIndex((e) => e.k === 'opened');
  expect(evs[openIdx]).toEqual({ k: 'opened', at: T + 3000, auto: false, machineId: 'rush-middle-01' });
  const p = eng.project();
  expect(p.machineId).toBe('rush-middle-01');
  expect(p.restMachineId).toBeNull();
  // 開店後の保留は rush の表で引いたもの（モードはイベントの順に追う）。
  let mode: LotteryMode = 'normal';
  let checked = 0;
  let differs = 0;
  for (let i = openIdx + 1; i < evs.length; i = i + 1) {
    const e = evs[i] as SimEvent;
    if (e.k === 'modeChanged') {
      mode = e.to;
    } else if (e.k === 'holdAdded' && e.entry.serial < BONUS_SERIAL_BASE) {
      expect(e.entry.modeAtDraw).toBe(mode);
      expect(e.entry).toEqual(drawHold(RUSH, PATTERNS, SEED, e.entry.modeAtDraw, e.entry.serial, 1, e.entry.unit));
      if (JSON.stringify(drawHold(LIGHT, PATTERNS, SEED, e.entry.modeAtDraw, e.entry.serial, 1, e.entry.unit)) !== JSON.stringify(e.entry)) {
        differs = differs + 1;
      }
      checked = checked + 1;
    } else if (e.k === 'jackpotStarted') {
      expect([3, 10]).toContain(e.rounds);
    }
  }
  expect(checked).toBeGreaterThan(100);
  expect(differs).toBeGreaterThan(0);
  // snapshot に今の台が入り、restore して続けても通しと一致する。
  const snap = eng.snapshot();
  expect(snap.machineId).toBe('rush-middle-01');
  expect(snap.restMachineId).toBeUndefined();
});

test('自動の開店でも選んだ台で開く。選び直しは最後の1つ、今の台を選ぶと未選択に戻る', () => {
  const auto = engine([FUEL], script(['shop_kokudo_open', 'shop_minato_open'], ['rush-middle-01', 'lt-middle-01'], false));
  const evs = auto.advance(T + REST_MAX + 1);
  expect(picks(evs)).toEqual([{ k: 'opened', at: T + REST_MAX, auto: true, machineId: 'lt-middle-01' }]);
  expect(auto.project().machineId).toBe('lt-middle-01');
  expect(auto.project().machinesOpen).toEqual(['light-middle-01', 'rush-middle-01', 'lt-middle-01']);

  const back = engine([FUEL], script(['shop_kokudo_open'], ['rush-middle-01', 'light-middle-01'], true));
  back.advance(T + 2001);
  expect(back.project().restMachineId).toBeNull();
  expect(picks(back.advance(T + 4000))).toEqual([{ k: 'opened', at: T + 3000, auto: false }]);
  expect(back.project().machineId).toBe('light-middle-01');
});

test('切り替えで保留・電サポの残りを捨てて normal から。特別保留のストックは残る', () => {
  const base = engine(
    [FUEL, { claimId: 'h', at: T + 1500, fuelMs: 0, medals: 0, bonusHolds: 10 }],
    script(['shop_kokudo_open'], ['rush-middle-01'], true),
  );
  base.advance(T + 2001);
  // 休業中に RUSH（st 50回）だった状態を作る。
  const snap0 = base.snapshot();
  const inRush: EngineSnapshot = { ...snap0, spin: { ...snap0.spin, mode: 'st', stRemaining: 50 } };
  const eng = Engine.restore(JSON.parse(JSON.stringify(inRush)) as EngineSnapshot, restoreCfg());
  eng.advance(T + 3000);
  const before = eng.project();
  expect(before.mode).toBe('st');
  expect(before.holds.length).toBeGreaterThan(0);
  const stock = before.bonusStock;
  expect(stock).toBeGreaterThan(0);
  const evs = eng.advance(T + 3001);
  expect(evs.slice(0, 2)).toEqual([
    { k: 'opened', at: T + 3000, auto: false, machineId: 'rush-middle-01' },
    { k: 'modeChanged', to: 'normal', at: T + 3000, stRemaining: 0 },
  ]);
  const refilled = evs.filter((e) => e.k === 'holdAdded' && e.entry.serial >= GRANT_HOLD_SERIAL_BASE && e.entry.serial < RESERVE_SERIAL_BASE).length;
  expect(refilled).toBeGreaterThan(0);
  expect(eng.project().bonusStock + refilled).toBe(stock);
  expect(eng.project().mode).toBe('normal');
  expect(evs.some((e) => e.k === 'jackpotEnded')).toBe(false);
});

test('休業中の選択は snapshot/restore と1秒刻みで通しと一致する', () => {
  const grants = [FUEL];
  const actions = script(['shop_kokudo_open'], ['rush-middle-01'], false);
  const end = T + REST_MAX + 600000;
  const whole = engine(grants, actions);
  const all = whole.advance(end);

  const first = engine(grants, actions);
  const part = first.advance(T + 5000);
  const snap = first.snapshot();
  expect(snap.restMachineId).toBe('rush-middle-01');
  expect(snap.machineId).toBeUndefined();
  const again = Engine.restore(JSON.parse(JSON.stringify(snap)) as EngineSnapshot, restoreCfg());
  expect(again.project().restMachineId).toBe('rush-middle-01');
  const rest = again.advance(end);
  expect([...part, ...rest]).toEqual(all);
  expect(again.snapshot()).toEqual(whole.snapshot());

  const steppedAll = engine(grants, actions);
  const evs: SimEvent[] = [];
  for (let t = 1000; t <= end; t = t + 1000) {
    evs.push(...steppedAll.advance(t));
  }
  expect(evs).toEqual(all);
  expect(steppedAll.snapshot()).toEqual(whole.snapshot());
  // 切り替え後の lookahead も通しと一致する。
  const mid = engine(grants, actions);
  mid.advance(T + REST_MAX + 1000);
  const ahead = mid.lookahead(end);
  expect(mid.project().machineId).toBe('rush-middle-01');
  expect(ahead.filter((e) => e.k === 'opened' || e.k === 'rejected')).toEqual([]);
});

test('machines を渡しても pickMachine を使わなければ渡さない構成と同じ', () => {
  const actions: Action[] = [{ t: 0, k: 'auto', share: 0.5, rate: 1 }, { t: T, k: 'close' }, { t: T + 3000, k: 'open' }];
  const a = engine([FUEL], actions, MACHINES);
  const b = engine([FUEL], actions, null);
  expect(a.advance(T + 3600000)).toEqual(b.advance(T + 3600000));
  expect(a.snapshot()).toEqual(b.snapshot());
  expect(a.snapshot().machineId).toBeUndefined();
});

test('restore: 知らない machineId は弾く', () => {
  const eng = engine([FUEL], []);
  eng.advance(1000);
  const snap = { ...eng.snapshot(), machineId: 'nope' };
  expect(() => Engine.restore(snap, restoreCfg())).toThrow('snap.machineId unknown');
  const snap2 = { ...eng.snapshot(), restMachineId: 'nope' };
  expect(() => Engine.restore(snap2, restoreCfg())).toThrow('snap.restMachineId unknown');
});

test('ツリーの unlock_machine: 既定 JSON に国道店・港町店、重複はエラー、一覧に無い機種は警告', () => {
  const tree = parseEconomy(econJson()).tree;
  const kokudo = tree.nodes.find((n) => n.id === 'shop_kokudo_open');
  const minato = tree.nodes.find((n) => n.id === 'shop_minato_open');
  expect(kokudo).toMatchObject({ tier: 1, cost: 5, req: [], effect: [{ k: 'unlock_machine', machine: 'rush-middle-01' }] });
  expect(minato).toMatchObject({ tier: 1, cost: 5, req: [], effect: [{ k: 'unlock_machine', machine: 'lt-middle-01' }] });
  const ctx = { awakenMedalBase: 20, factorsClosed: 0.005 };
  const small = (effects: unknown[][]): Json => ({
    points_per_rank: 10,
    run_bonus_at: [1e11],
    tier_unlock: [0, 0, 0, 0, 0],
    bantou: { share: 0.5, max_per_run: 100 },
    nodes: effects.map((effect, i) => ({ id: 'n' + i, name: 'n', desc: 'n', tier: 1, cost: 5, req: [], effect })),
  });
  const ok = parseTree(small([[{ k: 'unlock_machine', machine: 'x-01' }]]), ctx);
  expect(treeUnknownMachines(ok, ['light-middle-01'])).toEqual(['x-01']);
  expect(() => parseTree(small([[{ k: 'unlock_machine', machine: 'x-01' }], [{ k: 'unlock_machine', machine: 'x-01' }]]), ctx)).toThrow('duplicated');
  expect(() => parseTree(small([[{ k: 'unlock_machine' }]]), ctx)).toThrow();
});
