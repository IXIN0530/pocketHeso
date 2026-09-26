import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ECONOMY_YAKUMONO_IDS,
  Engine,
  IdleEconomy,
  awakenMedalCost,
  buildGrowthTable,
  growthPow,
  parseEconomyText,
  type EconomySpec,
  type EngineSimEvent,
  type Grant,
  type IdleEconomySnapshot,
} from '@ph/core';
import { loadRunAtlas, loadRunMachine } from './run.ts';

const ECONOMY_URL = new URL('../../../resources/economy/default.json', import.meta.url);
const ECON_USAGE =
  'usage: pachisim econ --profile standard|none|heavy --days <n> [--seed <s>] [--machine <id>] [--economy <path>] [--ev-hours <h>] [--json]';

const MIN_MS = 60000;
const DAY_MS = 86400000;
/** 歩数が積み上がる時間帯（分。07:00〜21:00 に線形）。 */
const STEPS_FROM_MIN = 7 * 60;
const STEPS_TO_MIN = 21 * 60;
/** 前面中の判断間隔（予告の表示 13 秒に間に合う）と背面中の判断間隔。 */
const FG_STEP_MS = 5000;
const BG_STEP_MS = 60000;
/** 打つ/オートを止める・再開する持ち玉（マイナス発射を避けるヒステリシス）とオート解放後の購入時に残す玉。 */
const SHOOT_OFF_BELOW = 100;
const SHOOT_ON_FROM = 300;
const BUY_RESERVE = 300;
/** 試算の暦の起点（streakDay 用。曜日は day 番号 % 7 で扱う）。 */
const EPOCH_UTC_MS = Date.UTC(2026, 9, 1);
/** 既定機種（P3 の既定機種が決まるまで golden と同じ light）。 */
export const ECON_DEFAULT_MACHINE = 'light-middle-01';

/** 行動プロファイル（1日の歩数・ジム・前面セッション）。 */
export interface EconProfile {
  readonly id: string;
  readonly steps: number;
  /** ジムに行く曜日（day % 7）。 */
  readonly gymDays: readonly number[];
  readonly gymMin: number;
  readonly gymStartMin: number;
  /** 前面セッション [開始分, 長さ分]（開始時にショートカット同期で歩数 Grant が入る）。 */
  readonly fgSessions: readonly (readonly [number, number])[];
}

const STANDARD_FG: readonly (readonly [number, number])[] = [
  [7 * 60 + 30, 10],
  [12 * 60 + 30, 10],
  [21 * 60, 20],
];

/** 既定プロファイル（standard は spec/23 バランス目標の「毎日 8,000 歩＋週2回ジム」）。 */
export const ECON_PROFILES: readonly EconProfile[] = [
  { id: 'standard', steps: 8000, gymDays: [1, 4], gymMin: 60, gymStartMin: 18 * 60, fgSessions: STANDARD_FG },
  { id: 'none', steps: 0, gymDays: [], gymMin: 0, gymStartMin: 18 * 60, fgSessions: STANDARD_FG },
  {
    id: 'heavy',
    steps: 12000,
    gymDays: [0, 2, 4, 6],
    gymMin: 90,
    gymStartMin: 18 * 60,
    fgSessions: [
      [7 * 60, 20],
      [12 * 60, 20],
      [20 * 60, 20],
      [21 * 60, 60],
    ],
  },
];

/** econ コマンドの引数。 */
export interface EconArgs {
  readonly profile: EconProfile;
  readonly days: number;
  readonly seed: number;
  readonly machine: string;
  /** 経済定義 JSON（省略時は resources/economy/default.json。調整案の比較用）。 */
  readonly economy: URL;
  readonly evHours: number;
  readonly json: boolean;
}

/** `econ` コマンドの引数を解釈する（--profile/--days 必須）。 */
export function parseEconArgs(argv: string[]): EconArgs {
  let profileId: string | undefined;
  let days = Number.NaN;
  let seed = 1;
  let machine = ECON_DEFAULT_MACHINE;
  let economy = ECONOMY_URL;
  let evHours = 1000;
  let json = false;
  for (let i = 0; i < argv.length; i = i + 1) {
    const a = argv[i] as string;
    const v = argv[i + 1];
    if (a === '--json') {
      json = true;
      continue;
    }
    if (v === undefined) {
      throw new Error(ECON_USAGE);
    }
    if (a === '--profile') {
      profileId = v;
    } else if (a === '--days') {
      days = Math.floor(Number(v));
    } else if (a === '--seed') {
      seed = Math.floor(Number(v));
    } else if (a === '--machine') {
      machine = v;
    } else if (a === '--economy') {
      economy = pathToFileURL(v);
    } else if (a === '--ev-hours') {
      evHours = Math.floor(Number(v));
    } else {
      throw new Error(ECON_USAGE);
    }
    i = i + 1;
  }
  const profile = ECON_PROFILES.find((p) => p.id === profileId);
  if (profile === undefined || !(days >= 1 && days <= 365) || !(seed >= 0) || !(evHours >= 0)) {
    throw new Error(ECON_USAGE);
  }
  return { profile, days, seed, machine, economy, evHours, json };
}

/** 歩数 → 営業時間（分）。〜10,000 歩 1,000歩=10分、〜15,000 歩は半分、以降 0（spec/30）。 */
export function stepsFuelMin(steps: number): number {
  const full = steps < 10000 ? steps : 10000;
  const halfTo = steps < 15000 ? steps : 15000;
  const half = halfTo > 10000 ? halfTo - 10000 : 0;
  return full / 100 + half / 200;
}

/** 運動分（1日の合算）→ 営業時間（分）。〜60分 ×2、〜120分 ×1、以降 0（spec/30）。 */
export function exerciseFuelMin(min: number): number {
  const full = min < 60 ? min : 60;
  const halfTo = min < 120 ? min : 120;
  const half = halfTo > 60 ? halfTo - 60 : 0;
  return full * 2 + half;
}

/** day 番号の YYYY-MM-DD（UTC 暦）。 */
export function econDayString(day: number): string {
  return new Date(EPOCH_UTC_MS + day * DAY_MS).toISOString().slice(0, 10);
}

/** 時刻つきの入力（Grant か前面切替）。 */
export interface EconInput {
  readonly t: number;
  readonly grant?: Grant;
  readonly fg?: boolean;
}

/** プロファイルから Grant と前面切替の列を作る（時刻順）。 */
export function buildEconInputs(profile: EconProfile, days: number): EconInput[] {
  const out: EconInput[] = [];
  for (let d = 0; d < days; d = d + 1) {
    const base = d * DAY_MS;
    const dayStr = econDayString(d);
    const gymToday = profile.gymMin > 0 && profile.gymDays.includes(d % 7);
    const gymEnd = profile.gymStartMin + profile.gymMin;
    let stepsSent = 0;
    let stepMedal = false;
    const items: { min: number; input: EconInput }[] = [];
    const exerciseAt = (min: number): number => (gymToday && min >= gymEnd ? profile.gymMin : 0);
    const stepsAt = (min: number): number => {
      const r = (min - STEPS_FROM_MIN) / (STEPS_TO_MIN - STEPS_FROM_MIN);
      const c = r < 0 ? 0 : r > 1 ? 1 : r;
      return Math.floor(profile.steps * c);
    };
    const streakAt = (min: number): string | undefined =>
      stepsAt(min) >= 5000 || exerciseAt(min) >= 20 ? dayStr : undefined;
    for (let i = 0; i < profile.fgSessions.length; i = i + 1) {
      const [start, len] = profile.fgSessions[i] as readonly [number, number];
      const steps = stepsAt(start);
      const fuelMs = Math.floor((stepsFuelMin(steps) - stepsFuelMin(stepsSent)) * MIN_MS);
      let medals = 0;
      if (!stepMedal && steps >= 8000) {
        stepMedal = true;
        medals = 1;
      }
      stepsSent = steps;
      if (fuelMs > 0 || medals > 0) {
        items.push({
          min: start,
          input: { t: base + start * MIN_MS, grant: { claimId: `steps-${d}-${i}`, at: base + start * MIN_MS, fuelMs, medals, streakDay: streakAt(start) } },
        });
      }
      items.push({ min: start, input: { t: base + start * MIN_MS, fg: true } });
      items.push({ min: start + len, input: { t: base + (start + len) * MIN_MS, fg: false } });
    }
    if (gymToday) {
      const at = base + gymEnd * MIN_MS;
      const fuelMs = Math.floor(exerciseFuelMin(profile.gymMin) * MIN_MS);
      const medals = profile.gymMin >= 20 ? 1 : 0;
      items.push({ min: gymEnd, input: { t: at, grant: { claimId: `gym-${d}`, at, fuelMs, medals, streakDay: streakAt(gymEnd) } } });
    }
    items.sort((a, b) => a.min - b.min);
    for (let i = 0; i < items.length; i = i + 1) {
      out.push((items[i] as { input: EconInput }).input);
    }
  }
  return out;
}

/** 1日分の集計行（値は日末時点・累計）。 */
export interface EconDayRow {
  readonly day: number;
  readonly balls: number;
  readonly perSecFg: number;
  readonly runTotal: number;
  readonly regular: number;
  readonly closes: number;
  readonly awakens: number;
  /** 解放済みの最上位役物（Lv≥1 の最大 index。なければ '-'）。 */
  readonly top: string;
  readonly medals: number;
  readonly medalsActivity: number;
  readonly medalsPachinko: number;
  readonly jackpots: number;
  readonly fired: number;
  readonly payout: number;
  readonly fuelMin: number;
}

/** 試算結果（到達日は 1 始まり。未到達は null）。 */
export interface EconResult {
  readonly profile: string;
  readonly machine: string;
  readonly seed: number;
  readonly days: number;
  readonly rows: readonly EconDayRow[];
  readonly croonDay: number | null;
  readonly firstAwakenDay: number | null;
  readonly firstCloseDay: number | null;
  readonly medalsActivity: number;
  readonly medalsPachinko: number;
}

/** 買える候補（安い順に買う単純戦略用）。 */
interface BuyCandidate {
  readonly target: string;
  readonly price: number;
}

/** 経済状態の写しから玉で買える次の1段を列挙する。 */
function buyCandidates(spec: EconomySpec, table: readonly number[], s: IdleEconomySnapshot): BuyCandidate[] {
  const out: BuyCandidate[] = [];
  for (let i = 0; i < ECONOMY_YAKUMONO_IDS.length; i = i + 1) {
    if (i > 0 && (s.lv[i - 1] as number) < 1) {
      break;
    }
    const def = spec.yakumono[i] as { basePrice: number };
    out.push({ target: ECONOMY_YAKUMONO_IDS[i] as string, price: def.basePrice * growthPow(table, s.lv[i] as number) });
  }
  const u = spec.upgrades;
  const staged: [string, readonly number[], number][] = [
    ['idle', u.idleCosts, s.idleStage],
    ['tank', u.tankCosts, s.tankStage],
    ['nail', u.nailCosts, s.nailStage],
    ['shorten', u.shortenCosts, s.shortenStage],
    ['hold', u.holdPlusCosts, s.holdStage],
  ];
  for (let i = 0; i < staged.length; i = i + 1) {
    const [target, costs, stage] = staged[i] as [string, readonly number[], number];
    if (stage < costs.length) {
      out.push({ target, price: costs[stage] as number });
    }
  }
  if (!s.autoOwned) {
    out.push({ target: 'auto', price: u.autoCost });
  }
  if (!s.tomeuchiOwned) {
    out.push({ target: 'tomeuchi', price: u.tomeuchiCost });
  }
  return out;
}

/** 写しに購入を反映する（Engine に積む buy と同じ結果を次の候補計算に使う）。 */
function applyBuy(s: IdleEconomySnapshot, target: string): IdleEconomySnapshot {
  const idx = (ECONOMY_YAKUMONO_IDS as readonly string[]).indexOf(target);
  if (idx >= 0) {
    const lv = [...s.lv];
    lv[idx] = (lv[idx] as number) + 1;
    return { ...s, lv };
  }
  if (target === 'idle') return { ...s, idleStage: s.idleStage + 1 };
  if (target === 'tank') return { ...s, tankStage: s.tankStage + 1 };
  if (target === 'nail') return { ...s, nailStage: s.nailStage + 1 };
  if (target === 'shorten') return { ...s, shortenStage: s.shortenStage + 1 };
  if (target === 'hold') return { ...s, holdStage: s.holdStage + 1 };
  if (target === 'auto') return { ...s, autoOwned: true };
  return { ...s, tomeuchiOwned: true };
}

function topYakumono(s: IdleEconomySnapshot): string {
  let top = '-';
  for (let i = 0; i < ECONOMY_YAKUMONO_IDS.length; i = i + 1) {
    if ((s.lv[i] as number) >= 1) {
      top = ECONOMY_YAKUMONO_IDS[i] as string;
    }
  }
  return top;
}

/**
 * 行動プロファイルで N 日回す（P3-T4）。単純戦略: 予告は即タップ・閉店可能なら即閉店・覚醒可能なら下位から覚醒・
 * 玉で買えるものを安い順に買う（オート解放後は BUY_RESERVE を残す）・前面は手動打ち、オート解放後は share=1。レートは 1 固定（D-034）。
 */
export function runEcon(
  profile: EconProfile,
  days: number,
  seed: number,
  machine: string,
  economyUrl: URL = ECONOMY_URL,
): EconResult {
  const spec = parseEconomyText(readFileSync(economyUrl, 'utf8'));
  const table = buildGrowthTable(spec.priceGrowth, 10000);
  const { spec: mspec, patterns } = loadRunMachine(machine);
  const { buffer } = loadRunAtlas();
  const econ = new IdleEconomy(spec);
  const eng = new Engine(
    { seed, spec: mspec, patterns, atlas: buffer, initialBalls: econ.startBalls(), economy: econ },
    [],
    [{ t: 0, k: 'presence', fg: false }],
  );
  const inputs = buildEconInputs(profile, days);
  const end = days * DAY_MS;
  const rows: EconDayRow[] = [];
  let idx = 0;
  let t = 0;
  let fg = false;
  let shootOn = false;
  let autoOn = false;
  let closes = 0;
  let awakens = 0;
  let medalsActivity = 0;
  // 大当たりでメダルは出ない（D-049）。列の見直しは P3-T6
  const medalsPachinko = 0;
  let fuelGrantedMs = 0;
  let croonDay: number | null = null;
  let firstAwakenDay: number | null = null;
  let firstCloseDay: number | null = null;
  const dayOf = (at: number): number => Math.floor(at / DAY_MS) + 1;

  while (t < end) {
    while (idx < inputs.length && (inputs[idx] as EconInput).t === t) {
      const input = inputs[idx] as EconInput;
      if (input.grant !== undefined) {
        eng.appendGrant(input.grant);
      }
      if (input.fg !== undefined) {
        eng.appendAction({ t, k: 'presence', fg: input.fg });
        fg = input.fg;
      }
      idx = idx + 1;
    }
    const p = eng.project();
    let s: IdleEconomySnapshot = econ.snapshot();
    let balls: number = p.balls;
    let medals: number = p.medals;
    if (fg && p.notice !== undefined) {
      eng.appendAction({ t, k: 'noticeTap', noticeId: p.notice.id });
    }
    if (s.runTotal >= spec.close.requiredRunTotal) {
      eng.appendAction({ t, k: 'close' });
      closes = closes + 1;
      firstCloseDay = firstCloseDay ?? dayOf(t);
      balls = spec.close.startBalls;
      s = { ...s, lv: [0, 0, 0, 0, 0, 0, 0, 0], awakened: [0, 0, 0, 0, 0, 0, 0, 0], idleStage: 0, tankStage: 0, nailStage: 0, shortenStage: 0, holdStage: 0, autoOwned: false, tomeuchiOwned: false, runTotal: 0 };
    }
    for (let i = 0; i < ECONOMY_YAKUMONO_IDS.length; i = i + 1) {
      const cost = awakenMedalCost(spec.awaken.medalBase, spec.awaken.medalGrowth, s.awakened[i] as number);
      if ((s.lv[i] as number) >= spec.awaken.minLv && medals >= cost) {
        eng.appendAction({ t, k: 'awaken', yakumono: ECONOMY_YAKUMONO_IDS[i] as string });
        medals = medals - cost;
        const lv = [...s.lv];
        const aw = [...s.awakened];
        lv[i] = 0;
        aw[i] = (aw[i] as number) + 1;
        s = { ...s, lv, awakened: aw };
        awakens = awakens + 1;
        firstAwakenDay = firstAwakenDay ?? dayOf(t);
      }
    }
    while (true) {
      const cands = buyCandidates(spec, table, s);
      let best: BuyCandidate | null = null;
      for (let i = 0; i < cands.length; i = i + 1) {
        const c = cands[i] as BuyCandidate;
        if (best === null || c.price < best.price) {
          best = c;
        }
      }
      const reserve = s.autoOwned ? BUY_RESERVE : 0;
      if (best === null || balls - best.price < reserve) {
        break;
      }
      eng.appendAction({ t, k: 'buy', target: best.target, count: 1 });
      balls = balls - best.price;
      s = applyBuy(s, best.target);
    }
    if (croonDay === null && (s.lv[2] as number) >= 1) {
      croonDay = dayOf(t);
    }
    const wantShoot: boolean = shootOn ? balls >= SHOOT_OFF_BELOW : balls >= SHOOT_ON_FROM;
    if (wantShoot !== shootOn) {
      eng.appendAction({ t, k: 'shoot', on: wantShoot, rate: 1 });
      shootOn = wantShoot;
    }
    const wantAuto: boolean = s.autoOwned && wantShoot;
    if (wantAuto !== autoOn) {
      eng.appendAction({ t, k: 'auto', share: wantAuto ? 1 : 0, rate: 1 });
      autoOn = wantAuto;
    }
    if (!s.autoOwned) {
      autoOn = false;
    }
    const dayEnd = (Math.floor(t / DAY_MS) + 1) * DAY_MS;
    let next = t + (fg ? FG_STEP_MS : BG_STEP_MS);
    const nextInput = idx < inputs.length ? (inputs[idx] as EconInput).t : end;
    next = next < nextInput ? next : nextInput;
    next = next < dayEnd ? next : dayEnd;
    const evs: EngineSimEvent[] = eng.advance(next);
    for (let i = 0; i < evs.length; i = i + 1) {
      const e = evs[i] as EngineSimEvent;
      if (e.k === 'granted') {
        medalsActivity = medalsActivity + e.medals;
        fuelGrantedMs = fuelGrantedMs + e.fuelMs;
      } else if (e.k === 'rejected' && e.action !== 'noticeTap') {
        throw new Error(`econ: unexpected reject ${e.action} ${e.reason} at ${e.at}`);
      }
    }
    t = next;
    if (t === dayEnd) {
      const pe = eng.project();
      const se = econ.snapshot();
      rows.push({
        day: t / DAY_MS,
        balls: pe.balls,
        perSecFg: econ.getPerSec(true, 1),
        runTotal: se.runTotal,
        regular: se.regular,
        closes,
        awakens,
        top: topYakumono(se),
        medals: pe.medals,
        medalsActivity,
        medalsPachinko,
        jackpots: pe.totals.jackpots,
        fired: pe.totals.fired,
        payout: pe.totals.payoutBalls,
        fuelMin: fuelGrantedMs / MIN_MS,
      });
    }
  }
  return { profile: profile.id, machine, seed, days, rows, croonDay, firstAwakenDay, firstCloseDay, medalsActivity, medalsPachinko };
}

/** パチンコ期待値（1発あたり払い戻し）。背面オート share=1・レート1で hours 時間回す。 */
export function measurePachinkoEv(
  machine: string,
  seed: number,
  hours: number,
  full: boolean,
  economyUrl: URL = ECONOMY_URL,
): number {
  const spec = parseEconomyText(readFileSync(economyUrl, 'utf8'));
  const { spec: mspec, patterns } = loadRunMachine(machine);
  const { buffer } = loadRunAtlas();
  const econ = new IdleEconomy(spec);
  const u = spec.upgrades;
  const stages = full
    ? { nailStage: u.nailCosts.length, shortenStage: u.shortenCosts.length, holdStage: u.holdPlusCosts.length, tomeuchiOwned: true }
    : {};
  econ.restore({ ...econ.snapshot(), ...stages, autoOwned: true });
  const eng = new Engine({ seed, spec: mspec, patterns, atlas: buffer, initialBalls: 1e12, economy: econ }, [], [
    { t: 0, k: 'presence', fg: false },
    { t: 0, k: 'auto', share: 1, rate: 1 },
  ]);
  eng.advance(hours * 3600000);
  const totals = eng.project().totals;
  return totals.fired > 0 ? totals.payoutBalls / totals.fired : 0;
}

function fmtNum(v: number): string {
  if (v === 0) {
    return '0';
  }
  const a = v < 0 ? -v : v;
  if (a < 1e4) {
    return v.toFixed(a < 10 ? 2 : 0);
  }
  return v.toExponential(2);
}

/** 日別表とバランス目標の判定を文字列にする。 */
export function formatEcon(r: EconResult, ev: { init: number; full: number } | null): string {
  const lines: string[] = [];
  lines.push(`econ: profile=${r.profile} days=${r.days} machine=${r.machine} seed=${r.seed}`);
  lines.push('day | balls | perSec(fg) | runTotal | regP | close | awaken | top | medals | med act/pachi | jackpots | fuel(h,cum)');
  for (let i = 0; i < r.rows.length; i = i + 1) {
    const w = r.rows[i] as EconDayRow;
    lines.push(
      `${w.day} | ${fmtNum(w.balls)} | ${fmtNum(w.perSecFg)} | ${fmtNum(w.runTotal)} | ${w.regular} | ${w.closes} | ${w.awakens} | ${w.top} | ${w.medals} | ${w.medalsActivity}/${w.medalsPachinko} | ${w.jackpots} | ${(w.fuelMin / 60).toFixed(1)}`,
    );
  }
  const totalMedals = r.medalsActivity + r.medalsPachinko;
  const share = totalMedals > 0 ? r.medalsPachinko / totalMedals : 0;
  lines.push(`milestones: croon day ${r.croonDay ?? '-'} / first awaken day ${r.firstAwakenDay ?? '-'} / first close day ${r.firstCloseDay ?? '-'}`);
  lines.push(`medals: activity ${r.medalsActivity} / pachinko ${r.medalsPachinko} (pachinko share ${(share * 100).toFixed(1)}%)`);
  lines.push('targets (spec/23):');
  if (r.profile === 'standard') {
    const ok1 = r.croonDay === 1;
    const ok2 = r.firstAwakenDay !== null && r.firstAwakenDay >= 2 && r.firstAwakenDay <= 4;
    const ok3 = r.firstCloseDay !== null && r.firstCloseDay >= 6 && r.firstCloseDay <= 8;
    const ng3 = r.firstCloseDay === null && r.days < 8 ? 'NG (run --days >= 8)' : 'NG';
    lines.push(`  croon on day 1: ${ok1 ? 'OK' : 'NG'} / first awaken ~day 3 (2-4): ${ok2 ? 'OK' : 'NG'} / first close ~day 7 (6-8): ${ok3 ? 'OK' : ng3}`);
  } else if (r.profile === 'none') {
    const ok = r.firstCloseDay === null ? r.days >= 60 : r.firstCloseDay > 60;
    lines.push(`  first close after day 60: ${ok ? 'OK' : r.firstCloseDay === null ? 'NG (run --days >= 61)' : 'NG'}`);
  } else {
    lines.push('  (no target for this profile)');
  }
  lines.push(`  pachinko medal share >= 50%: ${share >= 0.5 ? 'OK' : 'NG'}`);
  if (ev !== null) {
    const okInit = ev.init >= 0.8 && ev.init <= 0.9;
    const okFull = ev.full <= 1.02;
    lines.push(
      `  pachinko EV init ${ev.init.toFixed(3)} (≈0.85: ${okInit ? 'OK' : 'NG'}) / all upgrades ${ev.full.toFixed(3)} (<=1.02: ${okFull ? 'OK' : 'NG'})`,
    );
  }
  return lines.join('\n');
}
