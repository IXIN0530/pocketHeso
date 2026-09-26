import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { MachineSpec, PatternTable } from './machine.ts';
import { parseMachineText, parsePatternsText } from './machine.ts';
import { parseEconomy } from './economy-config.ts';
import { IdleEconomy } from './economy-state.ts';
import type { AwaySummary, EngineSnapshot, SimEvent } from './engine.ts';
import { Engine } from './engine.ts';

const H = 3600000;
const AWAY_FROM = 1000;
const AWAY_TO = 6 * H;

function loadMachine(): { spec: MachineSpec; patterns: PatternTable } {
  const spec = parseMachineText(readFileSync('../../resources/machines/light-middle-01.json', 'utf8'));
  const patterns = parsePatternsText(readFileSync('../../resources/machines/patterns.json', 'utf8'));
  return { spec, patterns };
}

function loadAtlas(): ArrayBuffer {
  const dir = '../../resources/atlas';
  const found = readdirSync(dir).find((n) => n.endsWith('.bin'));
  if (found === undefined) {
    throw new Error('atlas .bin not found');
  }
  const buf = readFileSync(dir + '/' + found);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return ab;
}

const ATLAS = loadAtlas();

function loadEconomy(): IdleEconomy {
  const json = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as unknown;
  return new IdleEconomy(parseEconomy(json));
}

function config(seed: number) {
  const { spec, patterns } = loadMachine();
  return { seed, spec, patterns, atlas: ATLAS, initialBalls: 10000000, initialMedals: 0, economy: loadEconomy() };
}

/** オート（rate4）で打ちながら AWAY_FROM〜awayTo の間だけ背面にいるエンジン。 */
function awayEngine(seed: number, awayTo = AWAY_TO): Engine {
  return new Engine(
    config(seed),
    [{ claimId: 'fuel', at: 0, fuelMs: 12 * H, medals: 2 }],
    [
      { t: 0, k: 'buy', target: 'windmill', count: 10 },
      { t: 0, k: 'buy', target: 'rate', count: 1 },
      { t: 0, k: 'buy', target: 'auto', count: 1 },
      { t: 0, k: 'auto', share: 1, rate: 4 },
      { t: AWAY_FROM, k: 'presence', fg: false },
      { t: awayTo, k: 'presence', fg: true },
    ],
  );
}

/** 留守中に変動を始めて大当たりになった変動（イベントから組み立てた正解）。 */
function awayHits(events: readonly SimEvent[]) {
  const holds = new Map<number, { color: string; hot: number }>();
  const spins = new Map<number, { pattern: string; at: number; endsAt: number }>();
  const hits: { entry: number; pattern: string; color: string; hot: number; startedAt: number; endsAt: number; kind: string; rounds: number }[] = [];
  for (const e of events) {
    if (e.k === 'holdAdded') holds.set(e.entry.serial, { color: e.entry.color, hot: e.entry.hot });
    if (e.k === 'spinStarted' && e.at >= AWAY_FROM) spins.set(e.entry, { pattern: e.pattern, at: e.at, endsAt: e.endsAt });
    if (e.k === 'jackpotStarted' && e.at < AWAY_TO) {
      const s = spins.get(e.entry);
      const h = holds.get(e.entry);
      if (s && h) hits.push({ entry: e.entry, pattern: s.pattern, color: h.color, hot: h.hot, startedAt: s.at, endsAt: s.endsAt, kind: e.kind, rounds: e.rounds });
    }
  }
  return hits;
}

test('留守中サマリーのリプレイは、留守中に始まった当たりの中で最も熱い変動と Engine のイベントが一致する', () => {
  const eng = awayEngine(3);
  const events = eng.advance(AWAY_TO + 1);
  const s = eng.awaySummary() as AwaySummary;
  const hits = awayHits(events);
  expect(s.jackpots).toBeGreaterThan(1);
  expect(hits.length).toBeGreaterThan(1);
  let best = hits[0]!;
  for (const h of hits) if (h.hot > best.hot) best = h;
  expect(s.replay).toEqual(best);
  expect(s.replay!.startedAt).toBeGreaterThanOrEqual(s.from);
  expect(s.replay!.endsAt).toBeLessThanOrEqual(s.to);
});

test('留守中の snapshot/restore でリプレイ候補が引き継がれる', () => {
  const a = awayEngine(3);
  a.advance(AWAY_TO + 1);
  const expected = a.awaySummary();
  // 変動中・大当たり中を含むいくつかの時点で切っても同じ。
  for (const cut of [H / 2, 2 * H + 3333, 4 * H + 17]) {
    const b = awayEngine(3);
    b.advance(cut);
    const c = Engine.restore(b.snapshot(), config(3));
    c.advance(AWAY_TO + 1);
    expect(c.awaySummary()).toEqual(expected);
  }
});

test('旧版の snapshot（リプレイ欄なし）は replay=null で読む', () => {
  const a = awayEngine(3);
  a.advance(AWAY_TO + 1);
  const snap = a.snapshot();
  const legacySummary: { -readonly [K in keyof AwaySummary]?: AwaySummary[K] } = { ...(snap.away.lastSummary as AwaySummary) };
  delete legacySummary.replay;
  const legacyAway = { ...snap.away, lastSummary: legacySummary };
  delete legacyAway.awaySpinCand;
  delete legacyAway.awayReplay;
  const legacy = { ...snap, away: legacyAway } as unknown as EngineSnapshot;
  const r = Engine.restore(legacy, config(3));
  expect(r.awaySummary()?.replay).toBeNull();
  expect(r.snapshot().away.awayReplay).toBeNull();
});

test('留守中に当たりが無ければ replay=null', () => {
  const short = awayEngine(3, AWAY_FROM + 2000);
  short.advance(AWAY_FROM + 2001);
  expect(short.awaySummary()?.jackpots).toBe(0);
  expect(short.awaySummary()?.replay).toBeNull();
});
