import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import type { ClaimRecord } from '@ph/claims';
import { expect, test } from 'vitest';
import { appendClaims, getSnapshot, loadActions, openStorage, putSnapshot, type Db } from '../platform/storage.ts';
import { EngineHost } from './engine-host.ts';

const ATLAS = ((): ArrayBuffer => {
  const b = readFileSync('../../resources/atlas/default.9489bfc699495d5a.bin');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
})();

const T0 = Date.UTC(2026, 8, 26, 6, 0, 0);
const MIN = 60000;
let seedN = 100;
const seeds = () => seedN++;

const rec = (claimId: string, at: number, fuelMs: number, medals = 0): ClaimRecord => ({
  claimId,
  receivedAt: at,
  source: 'health',
  kind: 'steps',
  day: '2026-09-26',
  amount: 1000,
  trust: 1,
  grant: { claimId, at, fuelMs, medals },
});

let dbN = 0;
const freshDb = (): Promise<Db> => openStorage(`t-host-${dbN++}`);

/** 受け取り・打つ・背面/前面を混ぜて T0+10分まで遊ぶ。 */
async function play(db: Db): Promise<EngineHost> {
  const { host } = await EngineHost.open(db, ATLAS, T0, seeds);
  await host.receive([rec('health:steps:2026-09-26:1', T0 - 5000, 30 * MIN, 1)], false, T0 + 1000);
  await host.act({ k: 'shoot', on: true, rate: 1 }, T0 + 2000);
  for (let t = T0 + 3000; t < T0 + 2 * MIN; t += 1000) {
    await host.tick(t);
  }
  await host.presence(false, T0 + 2 * MIN);
  await host.presence(true, T0 + 6 * MIN);
  await host.receive([rec('health:steps:2026-09-26:2', T0 + 6 * MIN, 10 * MIN)], false, T0 + 7 * MIN);
  await host.tick(T0 + 10 * MIN);
  return host;
}

test('新規: 再計算で起動し、開始時刻は now・初期玉は経済の startBalls', async () => {
  const db = await freshDb();
  const { host, boot } = await EngineHost.open(db, ATLAS, T0, seeds);
  expect(boot.restoredFrom).toBe('recompute');
  expect(boot.clockBack).toBe(false);
  expect(host.gameMeta.createdAt).toBe(T0);
  expect(boot.projection.at).toBe(T0);
  expect(boot.projection.balls).toBeGreaterThan(0);
  expect(await getSnapshot(db, 'latest')).toBeDefined();
});

test('版1（P4 の台帳のみ）から移行: 開始時刻は最古の受け取りに揃え、台帳の燃料が入る', async () => {
  const db = await freshDb();
  await db.put('meta', 1, 'schema');
  await appendClaims(db, [rec('a', T0 - 3 * MIN, 20 * MIN, 1)]);
  const { host, boot } = await EngineHost.open(db, ATLAS, T0, seeds);
  expect(host.gameMeta).toMatchObject({ schema: 2, createdAt: T0 - 3 * MIN, machineId: 'light-middle-01' });
  expect(boot.projection.medals).toBe(1);
  expect(boot.projection.fuelMs).toBeGreaterThan(0);
  // 2回目は同じ meta を読む。
  const again = await EngineHost.open(db, ATLAS, T0 + 1000, seeds);
  expect(again.host.gameMeta).toEqual(host.gameMeta);
  expect(again.boot.restoredFrom).toBe('snapshot');
});

test('Accept: 書き出し→全消去→読み込みで同じ Projection', async () => {
  const db = await freshDb();
  const host = await play(db);
  const end = T0 + 12 * MIN;
  const text = await host.exportSave(end);
  expect(text.startsWith('PH-SAVE1:')).toBe(true);
  const before = (await host.tick(end)).projection;
  await Promise.all(['meta', 'claims', 'actions', 'snapshot', 'places', 'settings'].map((s) => db.clear(s as 'meta')));

  // 全消去した DB で新しいゲームとして起動してから読み込む。
  const { host: other } = await EngineHost.open(db, ATLAS, end, seeds);
  const boot = await other.importSave(`\n${text.slice(0, 40)}\n${text.slice(40)}  `, end);
  expect(boot.restoredFrom).toBe('recompute');
  expect(other.gameMeta).toEqual(host.gameMeta);
  expect(boot.projection).toEqual(before);
  expect(before.medals).toBe(1);
});

test('Accept: snapshot を壊しても再計算で同じ状態に起動できる', async () => {
  const db = await freshDb();
  await play(db);
  const at = T0 + 15 * MIN;
  const good = await EngineHost.open(db, ATLAS, at, seeds);
  expect(good.boot.restoredFrom).toBe('snapshot');
  const snap = (await getSnapshot(db, 'latest')) as { engine: { grants: unknown[] } };

  const broken: unknown[] = [
    'garbage',
    { ...snap, engine: { ...snap.engine, grants: 'x' } },
    { ...snap, engine: { ...snap.engine, balls: Number.NaN, nowMs: -1 } },
    { ...snap, seed: 12345 },
  ];
  for (const b of broken) {
    await putSnapshot(db, 'latest', b);
    const r = await EngineHost.open(db, ATLAS, at, seeds);
    expect(r.boot.restoredFrom).toBe('recompute');
    expect(r.boot.projection).toEqual(good.boot.projection);
  }
});

test('背面のまま終了していたら起動時に前面へ戻して留守中サマリーを返す', async () => {
  const db = await freshDb();
  const { host } = await EngineHost.open(db, ATLAS, T0, seeds);
  await host.receive([rec('a', T0, 60 * MIN)], false, T0 + 1000);
  await host.presence(false, T0 + 2000);
  const r = await EngineHost.open(db, ATLAS, T0 + 30 * MIN, seeds);
  expect(r.boot.away).toMatchObject({ from: T0 + 2000, to: T0 + 30 * MIN });
  expect((await loadActions(db)).map((a) => a.k)).toEqual(['presence', 'presence']);
});

test('時計の巻き戻し: 小さな揺れは Engine の時刻に揃え、大きく戻ったら前進も記録もしない', async () => {
  const db = await freshDb();
  const { host } = await EngineHost.open(db, ATLAS, T0, seeds);
  await host.tick(T0 + 10000);
  expect((await host.act({ k: 'shoot', on: true, rate: 1 }, T0 + 9000)).clockBack).toBe(false);
  const back = await host.tick(T0 - MIN);
  expect(back.clockBack).toBe(true);
  expect(back.projection.at).toBe(T0 + 10001);
  expect((await host.act({ k: 'shoot', on: false, rate: 1 }, T0)).clockBack).toBe(true);
  expect((await host.receive([rec('b', T0, MIN)], false, T0)).clockBack).toBe(true);
  expect(await loadActions(db)).toHaveLength(1);
  expect((await host.tick(T0 + 20000)).clockBack).toBe(false);
});

test('Engine が弾く操作は保存しない・保存に失敗したら DB の状態に戻す', async () => {
  const db = await freshDb();
  const { host } = await EngineHost.open(db, ATLAS, T0, seeds);
  await expect(host.act({ k: 'shoot', on: true, rate: 0 }, T0 + 1000)).rejects.toThrow();
  expect(await loadActions(db)).toHaveLength(0);
  await host.receive([rec('dup', T0, MIN)], false, T0 + 2000);
  const before = (await host.tick(T0 + 3000)).projection;
  // 同じ claimId は台帳が拒否する → Engine も付与前に戻る。
  await expect(host.receive([rec('dup', T0, MIN)], false, T0 + 4000)).rejects.toThrow();
  const after = (await host.tick(T0 + 5000)).projection;
  expect(after.medals).toBe(before.medals);
  expect(after.fuelMs).toBeLessThanOrEqual(before.fuelMs);
});

test('壊れたセーブの読み込みは DB を変えない', async () => {
  const db = await freshDb();
  const host = await play(db);
  const meta = host.gameMeta;
  await expect(host.importSave('hello', T0 + 11 * MIN)).rejects.toThrow('セーブの文字列ではありません');
  await expect(host.importSave('PH-SAVE1:AAAA', T0 + 11 * MIN)).rejects.toThrow('壊れています');
  expect(host.gameMeta).toEqual(meta);
  expect((await loadActions(db)).length).toBeGreaterThan(0);
});

test('P7-T1: 起動・advance・受け取りを metrics store に残し、次の起動で続きから数える', async () => {
  const db = await freshDb();
  const host = await play(db);
  const info = await host.debugInfo();
  expect(info.metrics.boots).toHaveLength(1);
  expect(info.metrics.boots[0]).toMatchObject({ at: T0, from: 'recompute', spanMs: 0, inputs: 0 });
  expect(info.metrics.advance.count).toBeGreaterThan(100);
  expect(info.metrics.advance.maxMs).toBeGreaterThanOrEqual(info.metrics.advance.lastMs);
  expect(info.metrics.receives).toEqual({ count: 2, claims: 2, lastAt: T0 + 7 * MIN + 1 });
  // 背面の間（4分）を起動で追いつく。advance の集計はスナップショットと一緒に書かれている。
  await host.presence(false, T0 + 11 * MIN);
  const { host: again, boot } = await EngineHost.open(db, ATLAS, T0 + 15 * MIN, seeds);
  const m = (await again.debugInfo()).metrics;
  expect(boot.restoredFrom).toBe('snapshot');
  expect(m.boots).toHaveLength(2);
  // 背面に回った操作は t+1 まで進めて反映するので、追いつきは 4分 - 1ms。
  expect(m.boots[0]).toMatchObject({ at: T0 + 15 * MIN, from: 'snapshot', spanMs: 4 * MIN - 1 });
  expect(m.boots[0]?.inputs).toBeGreaterThan(3);
  expect(m.boots[0]?.catchUpMs).toBeGreaterThanOrEqual(0);
  expect(m.advance.count).toBeGreaterThanOrEqual(info.metrics.advance.count);
  expect(m.receives.count).toBe(2);
  // リセットで空に戻り、DB からも消える。
  await again.resetMetrics(T0 + 16 * MIN);
  expect((await again.debugInfo()).metrics.boots).toHaveLength(0);
  expect(await db.count('metrics')).toBe(0);
});

test('P7-T1: 端末時計が戻っていた起動は追いつき 0・時刻は Engine のまま記録する', async () => {
  const db = await freshDb();
  await play(db);
  const { host, boot } = await EngineHost.open(db, ATLAS, T0 + MIN, seeds);
  expect(boot.clockBack).toBe(true);
  const b = (await host.debugInfo()).metrics.boots[0];
  expect(b).toMatchObject({ catchUpMs: 0, spanMs: 0 });
  expect(b?.at).toBe(boot.projection.at);
});
