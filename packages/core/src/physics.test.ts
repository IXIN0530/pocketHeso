import { expect, test } from 'vitest';
import { parseBoard, type Board } from './board.ts';
import {
  BallSimulator,
  PHYS_MAX_STEPS,
  type BallState,
  type LaunchParams,
} from './physics.ts';
import { vec2, type Vec2 } from './vec2.ts';

/** 1024 件の方向表（テスト用。Core は表を読むだけで生成しない）。 */
function filledDirs(x: number, y: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < 1024; i = i + 1) {
    out.push(vec2(x, y));
  }
  return out;
}

function downDirs(): Vec2[] {
  return filledDirs(0, 1);
}

/** 真上中心±0.1rad 相当の1024表（sin/cos を使わず x を線形に振って単位化）。 */
function upFanDirs(): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < 1024; i = i + 1) {
    const x = -0.099833 + (0.199666 * i) / 1023;
    out.push(vec2(x, -Math.sqrt(1 - x * x)));
  }
  return out;
}

function testBoard(json: unknown): Board {
  return parseBoard(json);
}

/** 既定盤面と同規模の合成盤面（釘322本・壁2・センサー2・右下発射）。 */
function scaleBoard(): Board {
  const pins: Array<{ p: [number, number]; r: number }> = [];
  for (let row = 0; row < 14; row = row + 1) {
    for (let col = 0; col < 23; col = col + 1) {
      pins.push({ p: [40 + (360 * col) / 22, 60 + (340 * row) / 13], r: 1.1 });
    }
  }
  return testBoard({
    id: 'scale',
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 9000,
    pins,
    segments: [
      { a: [0, 0], b: [0, 460], restitution: 0.35, friction: 0.1 },
      { a: [420, 0], b: [420, 460], restitution: 0.35, friction: 0.1 },
    ],
    sensors: [
      { id: 'heso', kind: 'start1', rect: [190, 300, 24, 10] },
      { id: 'out', kind: 'out', rect: [0, 452, 420, 8] },
    ],
    launch: { origin: [405, 440], dir_table: 'launch_dirs', speed_mm_s: [3200, 3600] },
    pin_restitution: 0.45,
    pin_friction: 0.05,
    yakumono: [],
  });
}

test('水平面で静止する（貫通せず lost で終了）', () => {
  const board = testBoard({
    id: 'horiz',
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 9000,
    pins: [],
    segments: [{ a: [0, 400], b: [420, 400], restitution: 0, friction: 0.1 }],
    sensors: [
      { id: 'heso', kind: 'start1', rect: [0, 0, 10, 10] },
      { id: 'out', kind: 'out', rect: [0, 452, 420, 8] },
    ],
    launch: { origin: [210, 100], dir_table: 'launch_dirs', speed_mm_s: [500, 500] },
    pin_restitution: 0.45,
    pin_friction: 0.05,
    yakumono: [],
  });
  const sim = new BallSimulator(board, downDirs());
  const params: LaunchParams = { dirIndex: 0, speedQ: 0 };
  const s: BallState = sim.initialState(params);
  for (let i = 0; i < 3000; i = i + 1) {
    sim.step(s);
  }
  expect(s.x).toBeCloseTo(210, 6);
  expect(s.y).toBeCloseTo(394.5, 0);
  expect(Math.abs(s.vx)).toBeLessThan(0.000001);
  expect(Math.abs(s.vy)).toBeLessThan(20);
  const o = sim.run(params);
  expect(o.kind).toBe('lost');
  expect(o.steps).toBe(PHYS_MAX_STEPS);
  expect(o.flightMs).toBe(20000);
});

test('斜面を転がる（右に流れて out で終了）', () => {
  const board = testBoard({
    id: 'slope',
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 9000,
    pins: [],
    segments: [{ a: [40, 300], b: [380, 360], restitution: 0.1, friction: 0.05 }],
    sensors: [
      { id: 'heso', kind: 'start1', rect: [0, 0, 10, 10] },
      { id: 'out', kind: 'out', rect: [0, 452, 420, 8] },
    ],
    launch: { origin: [210, 100], dir_table: 'launch_dirs', speed_mm_s: [500, 500] },
    pin_restitution: 0.45,
    pin_friction: 0.05,
    yakumono: [],
  });
  const sim = new BallSimulator(board, downDirs());
  const params: LaunchParams = { dirIndex: 0, speedQ: 0 };
  const s: BallState = sim.initialState(params);
  let guard = 0;
  while (s.y < 370 && guard < 5000) {
    sim.step(s);
    guard = guard + 1;
  }
  expect(guard).toBeLessThan(5000);
  expect(s.x).toBeGreaterThan(260);
  const o = sim.run(params);
  expect(o.kind).toBe('out');
  expect(o.steps).toBeLessThan(PHYS_MAX_STEPS);
});

test('釘1本で反射する（反発係数どおりに向きが返る）', () => {
  const board = testBoard({
    id: 'pin',
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 1,
    pins: [{ p: [210, 250], r: 5 }],
    segments: [],
    sensors: [
      { id: 'heso', kind: 'start1', rect: [0, 0, 10, 10] },
      { id: 'out', kind: 'out', rect: [0, 452, 420, 8] },
    ],
    launch: { origin: [210, 100], dir_table: 'launch_dirs', speed_mm_s: [500, 500] },
    pin_restitution: 0.5,
    pin_friction: 0,
    yakumono: [],
  });
  const sim = new BallSimulator(board, downDirs());

  const fromLeft: BallState = { x: 190, y: 250, vx: 1000, vy: 0 };
  for (let i = 0; i < 50 && fromLeft.vx > 0; i = i + 1) {
    sim.step(fromLeft);
  }
  expect(fromLeft.vx).toBeLessThan(-400);
  expect(fromLeft.vx).toBeGreaterThan(-600);
  const ldx = fromLeft.x - 210;
  const ldy = fromLeft.y - 250;
  expect(ldx * ldx + ldy * ldy).toBeCloseTo(10.5 * 10.5, 0);

  const fromRight: BallState = { x: 230, y: 250, vx: -1000, vy: 0 };
  for (let i = 0; i < 50 && fromRight.vx < 0; i = i + 1) {
    sim.step(fromRight);
  }
  expect(fromRight.vx).toBeGreaterThan(400);
  expect(fromRight.vx).toBeLessThan(600);

  const fromTop: BallState = { x: 210, y: 230, vx: 0, vy: 1000 };
  for (let i = 0; i < 50 && fromTop.vy > 0; i = i + 1) {
    sim.step(fromTop);
  }
  expect(fromTop.vy).toBeLessThan(-400);
  expect(fromTop.vy).toBeGreaterThan(-600);
});

test('センサーは盤面順の最初に当たったもので確定する', () => {
  const rect = [200, 300, 40, 20];
  const base = {
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 9000,
    pins: [],
    segments: [],
    launch: { origin: [220, 100], dir_table: 'launch_dirs', speed_mm_s: [500, 500] },
    pin_restitution: 0.45,
    pin_friction: 0.05,
    yakumono: [],
  };
  const firstStart = testBoard({
    ...base,
    id: 'sense-a',
    sensors: [
      { id: 'heso', kind: 'start1', rect },
      { id: 'out', kind: 'out', rect },
    ],
  });
  const firstOut = testBoard({
    ...base,
    id: 'sense-b',
    sensors: [
      { id: 'out', kind: 'out', rect },
      { id: 'heso', kind: 'start1', rect },
    ],
  });
  const params: LaunchParams = { dirIndex: 0, speedQ: 0 };
  expect(new BallSimulator(firstStart, downDirs()).run(params).kind).toBe('start1');
  expect(new BallSimulator(firstOut, downDirs()).run(params).kind).toBe('out');
});

test('不正な入力を拒否する', () => {
  const board = testBoard({
    id: 'invalid',
    version: 1,
    size_mm: [420, 460],
    gravity_mm_s2: 9000,
    pins: [],
    segments: [],
    sensors: [
      { id: 'heso', kind: 'start1', rect: [0, 0, 10, 10] },
      { id: 'out', kind: 'out', rect: [0, 452, 420, 8] },
    ],
    launch: { origin: [210, 100], dir_table: 'launch_dirs', speed_mm_s: [500, 500] },
    pin_restitution: 0.45,
    pin_friction: 0.05,
    yakumono: [],
  });
  expect(() => new BallSimulator(board, downDirs().slice(0, 100))).toThrow();
  const sim = new BallSimulator(board, downDirs());
  expect(() => sim.run({ dirIndex: -1, speedQ: 0 })).toThrow();
  expect(() => sim.run({ dirIndex: 1024, speedQ: 0 })).toThrow();
  expect(() => sim.run({ dirIndex: 0.5, speedQ: 0 })).toThrow();
  expect(() => sim.run({ dirIndex: 0, speedQ: -1 })).toThrow();
  expect(() => sim.run({ dirIndex: 0, speedQ: 65536 })).toThrow();
  expect(() => sim.run({ dirIndex: 0, speedQ: 1.5 })).toThrow();
});

test(
  '1万発すべてがセンサーかタイムアウトで終了する',
  { timeout: 180000 },
  () => {
    const sim = new BallSimulator(scaleBoard(), upFanDirs());
    let nStart1 = 0;
    let nOut = 0;
    let nLost = 0;
    for (let i = 0; i < 10000; i = i + 1) {
      const params: LaunchParams = { dirIndex: i % 1024, speedQ: (i * 37) % 65536 };
      const o = sim.run(params);
      expect(o.steps).toBeGreaterThanOrEqual(1);
      expect(o.steps).toBeLessThanOrEqual(PHYS_MAX_STEPS);
      expect(o.flightMs).toBe((o.steps * 1000) / 960);
      if (o.kind === 'start1') {
        nStart1 = nStart1 + 1;
      } else if (o.kind === 'out') {
        nOut = nOut + 1;
      } else if (o.kind === 'lost') {
        nLost = nLost + 1;
      } else {
        throw new Error('unknown outcome kind');
      }
    }
    expect(nStart1 + nOut + nLost).toBe(10000);
    const a = sim.run({ dirIndex: 7, speedQ: 12345 });
    const b = sim.run({ dirIndex: 7, speedQ: 12345 });
    expect(a).toEqual(b);
  },
);
