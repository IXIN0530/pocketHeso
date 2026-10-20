import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import type { ClaimRecord } from '@ph/claims';
import type { EngineSimEvent, LotteryMode } from '@ph/core';
import { SAKIBARE_DELAY_MS, type SakibareCustom } from '@ph/fx';
import { expect, test } from 'vitest';
import { EngineHost, type Shot } from '../engine/engine-host.ts';
import { openStorage } from '../platform/storage.ts';
import { DISPLAY_LAG_MS } from './ball-tracks.ts';
import { LcdTimeline, applyLcdEventWith, fireSakibares, sakibareTimes, type LcdState } from './lcd-timeline.ts';

// 先バレの時刻の確認（P13-T2）: 通常はヘソ入賞、RUSH・時短は最後尾へ自動保留が足された時に鳴る。

const ATLAS = ((): ArrayBuffer => {
  const b = readFileSync('../../resources/atlas/default.27038344f36daf46.bin');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
})();
const T0 = Date.UTC(2026, 8, 26, 6, 0, 0);
const MIN = 60000;
const FRAME_MS = 17;
const LATE_MS = 1000;
/** 先バレが多く出る設定（信頼度40%・占有率95%）。時刻の確認なので当選確率は固定の 0.3。 */
const CUSTOM: SakibareCustom = 'sb40';
const hitProb = (): number => 0.3;

const fuel = (at: number): ClaimRecord => ({
  claimId: `health:steps:2026-09-26:${at}`,
  receivedAt: at,
  source: 'health',
  kind: 'steps',
  day: '2026-09-26',
  amount: 1000,
  trust: 1,
  grant: { claimId: `health:steps:2026-09-26:${at}`, at, fuelMs: 24 * 60 * MIN, medals: 0, prodMin: 5000 },
});

interface Run {
  events: EngineSimEvent[];
  shots: Map<number, Shot>;
  /** フレームごと（17ms）の LcdState と表示時刻、鳴った先バレ。 */
  fired: { entry: number; at: number; sound: boolean; frameAt: number }[];
  resyncs: number;
  seed: number;
  modes: Set<LotteryMode>;
}

let dbN = 0;
let seedN = 900;

/** 画面と同じ流れ: 1Hz の前進結果を積み、「時計 − 表示の遅れ」を 17ms 刻みで進め、先バレを board-scene と同じ判定で集める。 */
async function play(minutes: number): Promise<Run> {
  const db = await openStorage(`t-sakibare-${dbN++}`);
  const { host, boot } = await EngineHost.open(db, ATLAS, T0, () => seedN++);
  const tl = new LcdTimeline();
  tl.custom = CUSTOM;
  tl.push(boot.projection, []);
  await host.receive([fuel(T0)], false, T0 + 500);
  const run: Run = { events: [], shots: new Map(), fired: [], resyncs: 0, seed: boot.projection ? host.gameMeta.seed : 0, modes: new Set() };
  const r0 = await host.act({ k: 'shoot', on: true, rate: 1 }, T0 + 1000);
  const take = (r: { events: readonly EngineSimEvent[]; shots: readonly Shot[]; projection: Parameters<LcdTimeline['push']>[0] }) => {
    tl.push(r.projection, r.events);
    run.events.push(...r.events);
    for (const s of r.shots) run.shots.set(s.ball, s);
  };
  take(r0);
  let done = new Set<number>();
  let display = T0 + 2000 - DISPLAY_LAG_MS;
  for (let now = T0 + 2000; now < T0 + minutes * MIN; now += 1000) {
    take(await host.tick(now));
    for (; display <= now - DISPLAY_LAG_MS; display += FRAME_MS) {
      const st: LcdState = tl.advance(display);
      run.modes.add(st.rush?.mode ?? 'normal');
      const { fire, next } = fireSakibares(sakibareTimes(st, run.seed, hitProb), done, display, LATE_MS);
      for (const f of fire) run.fired.push({ ...f, frameAt: display });
      done = next;
    }
  }
  run.resyncs = tl.resyncs;
  return run;
}

/** 一度だけ長く遊ぶ（通常 → 大当たり → RUSH を含む）。 */
let cached: Promise<Run> | null = null;
const shared = (): Promise<Run> => (cached ??= play(300));

const holdsOf = (run: Run) => run.events.flatMap((e) => (e.k === 'holdAdded' ? [e] : []));
const startAts = (run: Run) => new Set(run.events.flatMap((e) => (e.k === 'sensor' && e.kind === 'start1' ? [e.at] : [])));

const applyEvent = (s: LcdState, e: Parameters<typeof applyLcdEventWith>[1]): LcdState => applyLcdEventWith(s, e, CUSTOM);

test('通常時: 先バレはヘソ入賞（玉がヘソに入る表示の時刻）の 150ms 後、差は 1 フレーム以内', async () => {
  const run = await shared();
  const heso = startAts(run);
  const added = new Map(holdsOf(run).map((h) => [h.entry.serial, h.at]));
  let checked = 0;
  for (const f of run.fired) {
    const at = added.get(f.entry)!;
    expect(f.at).toBe(at + SAKIBARE_DELAY_MS);
    // 表示の時計で鳴った時刻は、先バレの時刻から 1 フレーム（17ms）以内。
    expect(f.frameAt - f.at).toBeGreaterThanOrEqual(0);
    expect(f.frameAt - f.at).toBeLessThanOrEqual(FRAME_MS);
    if (!heso.has(at)) continue;
    // ヘソに入る玉の描画（BallTracks）は sensorAt に着いた最初のフレーム。保留の取得も同じ sensor の時刻。
    const shot = [...run.shots.values()].find((s) => s.kind === 'start1' && s.sensorAt === at);
    if (shot) {
      expect(f.frameAt - shot.sensorAt - SAKIBARE_DELAY_MS).toBeLessThanOrEqual(FRAME_MS);
      expect(shot.sensorAt).toBe(at);
    }
    checked++;
  }
  expect(checked).toBeGreaterThanOrEqual(20);
  // 通常時の保留は全てヘソ入賞と同じ時刻に取得されている。
  for (const h of holdsOf(run)) {
    if (h.entry.modeAtDraw === 'normal') expect(heso.has(h.at)).toBe(true);
  }
}, 120000);

test('保留が満タンの時にヘソに入った玉では鳴らない', async () => {
  const run = await shared();
  const overflow = run.events.flatMap((e) => (e.k === 'holdOverflow' ? [e.at] : []));
  const added = new Set(holdsOf(run).map((h) => h.at));
  expect(overflow.length).toBeGreaterThanOrEqual(10);
  const firedAt = new Set(run.fired.map((f) => f.at - SAKIBARE_DELAY_MS));
  for (const t of overflow) {
    if (!added.has(t)) expect(firedAt.has(t)).toBe(false);
  }
  // 鳴った先バレは必ず保留の取得（holdAdded）に対応する。
  for (const t of firedAt) expect(added.has(t)).toBe(true);
}, 120000);

test('RUSH: 自動保留が最後尾に足された時に鳴り、先頭に移っても変動開始でも再び鳴らない・まとめて足す時の音は1回', async () => {
  const run = await shared();
  expect(run.modes.has('st') || run.modes.has('lt')).toBe(true);
  const heso = startAts(run);
  const auto = holdsOf(run).filter((h) => !heso.has(h.at));
  expect(auto.length).toBeGreaterThanOrEqual(10);
  // 自動保留は、前の変動の開始・モード変更・大当たりの終わりのどれかと同じ時刻に足される。
  const triggers = new Set(run.events.flatMap((e) => (e.k === 'spinStarted' || e.k === 'modeChanged' || e.k === 'jackpotEnded' ? [e.at] : [])));
  for (const h of auto) expect(triggers.has(h.at)).toBe(true);
  // 取得は最後尾（イベントを順に反映して確かめる）。
  let s: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };
  const sakibareAuto = new Set<number>();
  const firedBy = new Map(run.fired.map((f) => [f.entry, f]));
  for (const e of run.events) {
    if (e.k !== 'holdAdded' && e.k !== 'spinStarted' && e.k !== 'spinResolved' && e.k !== 'jackpotStarted' && e.k !== 'uwanose' && e.k !== 'jackpotEnded' && e.k !== 'modeChanged') continue;
    s = applyEvent(s, e);
    if (e.k === 'holdAdded') {
      expect(s.holds[s.holds.length - 1]!.entry).toBe(e.entry.serial);
      if (!heso.has(e.at) && firedBy.has(e.entry.serial)) {
        expect(firedBy.get(e.entry.serial)!.at).toBe(e.at + SAKIBARE_DELAY_MS);
        sakibareAuto.add(e.entry.serial);
      }
    }
  }
  expect(sakibareAuto.size).toBeGreaterThanOrEqual(10);
  // 同じ保留で2回鳴らない。
  expect(new Set(run.fired.map((f) => f.entry)).size).toBe(run.fired.length);
  // 同じ時刻の先バレは音が1回だけ（光は保留ごと）。
  const byAt = new Map<number, { n: number; sounds: number }>();
  for (const f of run.fired) {
    const g = byAt.get(f.at) ?? { n: 0, sounds: 0 };
    byAt.set(f.at, { n: g.n + 1, sounds: g.sounds + (f.sound ? 1 : 0) });
  }
  expect([...byAt.values()].every((g) => g.sounds === 1)).toBe(true);
}, 120000);

test('RUSH を数分進めても Projection へ揃え直さない（取得時刻が消えて先バレが落ちない）', async () => {
  const run = await shared();
  expect(run.modes.has('st') || run.modes.has('lt')).toBe(true);
  expect(run.resyncs).toBe(0);
}, 120000);

test('fireSakibares: 同じ時刻にまとめて足された先バレは光が保留ごと・音は1回、済み・遅れすぎは鳴らさない', () => {
  const times = [
    { entry: 10, at: 1000 },
    { entry: 11, at: 1000 },
    { entry: 12, at: 1000 },
    { entry: 13, at: 1400 },
    { entry: 14, at: 5000 },
  ];
  const r = fireSakibares(times, new Set(), 1400, LATE_MS);
  expect(r.fire.map((f) => [f.entry, f.sound])).toEqual([
    [10, true],
    [11, false],
    [12, false],
    [13, true],
  ]);
  expect([...r.next]).toEqual([10, 11, 12, 13]);
  // 次のフレームでは済みの番号を鳴らさず、まだ時刻に達していない 14 は next にも入らない。
  const again = fireSakibares(times, r.next, 1417, LATE_MS);
  expect(again.fire).toEqual([]);
  // 時刻を 1 秒より過ぎて気付いた先バレ（背面から戻った時など）は鳴らさないが、済みとして覚える。
  const late = fireSakibares(times, new Set(), 2500, LATE_MS);
  expect(late.fire).toEqual([]);
  expect([...late.next]).toEqual([10, 11, 12, 13]);
});
