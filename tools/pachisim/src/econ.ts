import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ECONOMY_YAKUMONO_IDS,
  Engine,
  IdleEconomy,
  awakenMedalCost,
  ballPoints,
  buildGrowthTable,
  closeGain,
  growthPow,
  parseEconomyText,
  type EconomySpec,
  type EngineSimEvent,
  type Grant,
  type IdleEconomySnapshot,
} from '@ph/core';
import { loadRunAtlas, loadRunMachine, computeTheory } from './run.ts';

const ECONOMY_URL = new URL('../../../resources/economy/default.json', import.meta.url);
const ECON_USAGE =
  'usage: pachisim econ --profile standard|none|heavy --days <n> [--seed <s>] [--machine <id>] [--economy <path>] [--ev-hours <h>] [--play-rate <r>] [--play-min <m>] [--json]';

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
  /** 前面で打つ打ち方（P8-T9）。rate は 1〜100 の整数、min は 1日あたり前面で打つ分（0 は追加なし）。 */
  readonly playRate: number;
  readonly playMin: number;
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
  let playRate = 1;
  let playMin = 0;
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
    } else if (a === '--play-rate') {
      playRate = Math.floor(Number(v));
    } else if (a === '--play-min') {
      playMin = Math.floor(Number(v));
    } else {
      throw new Error(ECON_USAGE);
    }
    i = i + 1;
  }
  const profile = ECON_PROFILES.find((p) => p.id === profileId);
  if (
    profile === undefined ||
    !(days >= 1 && days <= 365) ||
    !(seed >= 0) ||
    !(evHours >= 0) ||
    !(playRate >= 1 && playRate <= 100) ||
    !(playMin >= 0 && playMin <= 1440)
  ) {
    throw new Error(ECON_USAGE);
  }
  return { profile, days, seed, machine, economy, evHours, playRate, playMin, json };
}

/** sim内の換算 Tier（claims と同じ逓減。層違反を避けるため自前実装, D-081）。 */
interface SimTier {
  readonly to: number;
  readonly mult: number;
}

function simTiered(x: number, ts: readonly SimTier[]): number {
  let sum = 0;
  let lo = 0;
  for (const t of ts) {
    if (x <= lo) {
      break;
    }
    const hi = x < t.to ? x : t.to;
    sum = sum + (hi - lo) * t.mult;
    lo = t.to;
  }
  return sum;
}

/** claims節の換算値（economy JSON から読む。@ph/claims は層違反のため import しない）。 */
interface SimClaimParams {
  readonly stepsFuelPer1000: number;
  readonly stepsProdPer1000: number;
  readonly stepsTiers: readonly SimTier[];
  readonly stepsMedalPer: number;
  readonly stepsMedalTo: number;
  readonly checkinFuelPerMin: number;
  readonly checkinProdPerMin: number;
  readonly checkinTiers: readonly SimTier[];
  readonly checkinMedalPerMin: number;
  readonly checkinMedalToMin: number;
  readonly bonusPerMin: number;
  readonly bonusMax: number;
}

function simClaimParams(url: URL = ECONOMY_URL): SimClaimParams {
  const json = JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
  const claims = (json['claims'] as Record<string, unknown>);
  const steps = claims['steps'] as Record<string, unknown>;
  const checkin = claims['checkin'] as Record<string, unknown>;
  const tiersOf = (v: unknown): SimTier[] => (v as SimTier[]).map((t) => ({ to: t.to, mult: t.mult }));
  return {
    stepsFuelPer1000: steps['fuel_min_per_1000'] as number,
    stepsProdPer1000: steps['prod_min_per_1000'] as number,
    stepsTiers: tiersOf(steps['tiers']),
    stepsMedalPer: steps['medal_per'] as number,
    stepsMedalTo: steps['medal_to'] as number,
    checkinFuelPerMin: checkin['fuel_min_per_min'] as number,
    checkinProdPerMin: checkin['prod_min_per_min'] as number,
    checkinTiers: tiersOf(checkin['tiers']),
    checkinMedalPerMin: checkin['medal_per_min'] as number,
    checkinMedalToMin: checkin['medal_to_min'] as number,
    bonusPerMin: checkin['bonus_hold_per_min'] as number,
    bonusMax: checkin['bonus_hold_max_per_day'] as number,
  };
}

/** 歩数 → 営業時間（分）。〜10,000 歩 1,000歩=10分、〜15,000 歩は半分、以降 0（spec/30）。 */
export function stepsFuelMin(steps: number): number {
  const p = simClaimParams();
  return (simTiered(steps, p.stepsTiers) * p.stepsFuelPer1000) / 1000;
}

/** 運動分（1日の合算）→ 営業時間（分）。〜60分 ×2、〜120分 ×1、以降 0（spec/30）。 */
export function exerciseFuelMin(min: number): number {
  const p = simClaimParams();
  return simTiered(min, p.checkinTiers) * p.checkinFuelPerMin;
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

/** プロファイルから Grant と前面切替の列を作る（時刻順。claims と同じ換算を自前実装, D-081）。 */
export function buildEconInputs(
  profile: EconProfile,
  days: number,
  params: SimClaimParams = simClaimParams(),
  play: { rate: number; min: number } = { rate: 1, min: 0 },
): EconInput[] {
  const out: EconInput[] = [];
  /** 追加の前面プレー（P8-T9。19:00 開始で play.min 分。既存セッションと重なっても fg=true の重複は無害）。 */
  const PLAY_START_MIN = 19 * 60;
  for (let d = 0; d < days; d = d + 1) {
    const base = d * DAY_MS;
    const dayStr = econDayString(d);
    const gymToday = profile.gymMin > 0 && profile.gymDays.includes(d % 7);
    const gymEnd = profile.gymStartMin + profile.gymMin;
    const items: { min: number; input: EconInput }[] = [];
    const stepsAt = (min: number): number => {
      const r = (min - STEPS_FROM_MIN) / (STEPS_TO_MIN - STEPS_FROM_MIN);
      const c = r < 0 ? 0 : r > 1 ? 1 : r;
      return Math.floor(profile.steps * c);
    };
    let stepsPrev = 0;
    let stepsMedalsIssued = 0;
    const streakDays = new Set<string>();
    const streakFor = (steps: number, exercise: number): string | undefined =>
      steps >= 5000 || exercise >= 20 ? dayStr : undefined;
    for (let i = 0; i < profile.fgSessions.length; i = i + 1) {
      const [start, len] = profile.fgSessions[i] as readonly [number, number];
      const steps = stepsAt(start);
      const at = base + start * MIN_MS;
      if (steps > stepsPrev) {
        const fuelMs = Math.round(
          ((simTiered(steps, params.stepsTiers) - simTiered(stepsPrev, params.stepsTiers)) * params.stepsFuelPer1000 * MIN_MS) / 1000,
        );
        const prodMin =
          ((simTiered(steps, params.stepsTiers) - simTiered(stepsPrev, params.stepsTiers)) * params.stepsProdPer1000) / 1000;
        const capped = steps < params.stepsMedalTo ? steps : params.stepsMedalTo;
        const totalMedals = Math.floor(capped / params.stepsMedalPer);
        const medals = totalMedals > stepsMedalsIssued ? totalMedals - stepsMedalsIssued : 0;
        stepsMedalsIssued = totalMedals;
        const grant: Grant =
          prodMin > 0
            ? { claimId: `steps-${d}-${i}`, at, fuelMs, medals, prodMin, streakDay: streakFor(steps, 0) }
            : { claimId: `steps-${d}-${i}`, at, fuelMs, medals, streakDay: streakFor(steps, 0) };
        // streakDay は初めて条件を満たした Grant にだけ載せる。
        const finalGrant = streakDays.has(dayStr) ? { ...grant, streakDay: undefined } : grant;
        if (finalGrant.streakDay !== undefined) {
          streakDays.add(dayStr);
        }
        if (fuelMs > 0 || medals > 0 || prodMin > 0) {
          // streakDay が undefined の場合は省略する。
          const g = finalGrant.streakDay === undefined ? { claimId: finalGrant.claimId, at, fuelMs, medals, ...(prodMin > 0 ? { prodMin } : {}) } : finalGrant;
          items.push({ min: start, input: { t: at, grant: g } });
        }
        stepsPrev = steps;
      }
      items.push({ min: start, input: { t: at, fg: true } });
      items.push({ min: start + len, input: { t: base + (start + len) * MIN_MS, fg: false } });
    }
    if (gymToday) {
      const at = base + gymEnd * MIN_MS;
      // sim のジムは1日1回のため、その日の合算 = gymMin。
      const eq = simTiered(profile.gymMin, params.checkinTiers);
      const fuelMs = Math.round(eq * params.checkinFuelPerMin * MIN_MS);
      const prodMin = eq * params.checkinProdPerMin;
      const capped = profile.gymMin < params.checkinMedalToMin ? profile.gymMin : params.checkinMedalToMin;
      const medals = Math.floor(capped / params.checkinMedalPerMin);
      const bonusTotal = Math.floor(profile.gymMin / params.bonusPerMin);
      const bonusHolds = bonusTotal < params.bonusMax ? bonusTotal : params.bonusMax;
      const grantBase: Grant = { claimId: `gym-${d}`, at, fuelMs, medals, streakDay: streakDays.has(dayStr) ? undefined : dayStr };
      const withProd: Grant = prodMin > 0 ? { ...grantBase, prodMin } : grantBase;
      const grant: Grant = bonusHolds > 0 ? { ...withProd, bonusHolds } : withProd;
      items.push({ min: gymEnd, input: { t: at, grant } });
    }
    if (play.min > 0) {
      items.push({ min: PLAY_START_MIN, input: { t: base + PLAY_START_MIN * MIN_MS, fg: true } });
      items.push({ min: PLAY_START_MIN + play.min, input: { t: base + (PLAY_START_MIN + play.min) * MIN_MS, fg: false } });
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
  /** 全期間累計玉（tick＋払出。玉由来Pの元）。 */
  readonly totalTotal: number;
  readonly regular: number;
  /** 玉由来P = floor(cbrt(total/divisor))。 */
  readonly ballPts: number;
  /** 行動由来P = floor(累計獲得メダル/medals_per_point)。 */
  readonly medalPts: number;
  readonly closes: number;
  readonly awakens: number;
  /** 解放済みの最上位役物（Lv≥1 の最大 index。なければ '-'）。 */
  readonly top: string;
  /** 役物 Lv の合計（週次の「最高到達」判定用）。 */
  readonly lvTotal: number;
  readonly medals: number;
  readonly medalsActivity: number;
  readonly medalsPachinko: number;
  readonly jackpots: number;
  readonly fired: number;
  readonly payout: number;
  /** 役物生産（累計。tick分。D-080でフィーバー廃止）。 */
  readonly yakumono: number;
  /** 大当たりボーナスの合計（累計。jackpotEndedのbonus, D-080）。 */
  readonly bonus: number;
  /** 行動の即時報酬の合計（累計。grantedのballs, D-081）。 */
  readonly action: number;
  readonly fuelMin: number;
  /** 達成した実績の数（一覧にある id だけ, spec/24）。 */
  readonly achDone: number;
  /** 実績の生産倍率 achMult。 */
  readonly achMult: number;
}

/** 閉店1回分の記録（日は1始まり・gainは獲得常連P）。 */
export interface EconCloseEntry {
  readonly day: number;
  readonly gain: number;
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
  /** 閉店ごとの獲得（獲得≥1のみ。貪欲戦略は0獲得で閉店しない）。 */
  readonly closeHistory: readonly EconCloseEntry[];
  /** 累計の玉内訳（役物/大当たりボーナス/出玉/行動の即時報酬, D-080・D-081）。 */
  readonly yakumono: number;
  readonly bonus: number;
  readonly payout: number;
  readonly action: number;
  /** 全ステップの持ち玉の最小値（P8-T9 の「7日間で 0 に落ちない」判定用）。 */
  readonly minBalls: number;
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

function topIndex(s: IdleEconomySnapshot): number {
  let top = -1;
  for (let i = 0; i < ECONOMY_YAKUMONO_IDS.length; i = i + 1) {
    if ((s.lv[i] as number) >= 1) {
      top = i;
    }
  }
  return top;
}

/**
 * 行動プロファイルで N 日回す（P3-T4）。単純戦略: 予告は即タップ・閉店可能なら即閉店・覚醒可能なら下位から覚醒・
 * 玉で買えるものを安い順に買う（オート解放後は BUY_RESERVE を残す）・前面は手動打ち、オート解放後は share=1。
 * P8-T9: play.min>0 の時は 19:00 から play.min 分だけ前面で play.rate（既定1）で打つ。play.rate>1 の時は
 * バランス試算のためレート解放を仮定する（メダル消費なし。実プレイでは解放が必要）。
 */
export function runEcon(
  profile: EconProfile,
  days: number,
  seed: number,
  machine: string,
  economyUrl: URL = ECONOMY_URL,
  play: { rate: number; min: number } = { rate: 1, min: 0 },
): EconResult {
  const economyText = readFileSync(economyUrl, 'utf8');
  const spec = parseEconomyText(economyText);
  const table = buildGrowthTable(spec.priceGrowth, 10000);
  const { spec: mspec, patterns } = loadRunMachine(machine);
  const { buffer } = loadRunAtlas();
  const econ = new IdleEconomy(spec);
  // プレー用のレート解放（試算の仮定。実プレイはメダルで解放）。
  if (play.rate > 1) {
    const rates = spec.upgrades.rates;
    let stage = 0;
    for (let i = 0; i < rates.length; i = i + 1) {
      if ((rates[i] as number) <= play.rate) {
        stage = i;
      }
    }
    econ.restore({ ...econ.snapshot(), rateStage: stage });
  }
  const eng = new Engine(
    { seed, spec: mspec, patterns, atlas: buffer, initialBalls: econ.startBalls(), economy: econ },
    [],
    [{ t: 0, k: 'presence', fg: false }],
  );
  const inputs = buildEconInputs(profile, days, simClaimParams(economyUrl), play);
  const end = days * DAY_MS;
  const rows: EconDayRow[] = [];
  const closeHistory: EconCloseEntry[] = [];
  let idx = 0;
  let t = 0;
  let fg = false;
  let shootOn = false;
  let autoOn = false;
  let closes = 0;
  let awakens = 0;
  let medalsActivity = 0;
  // 大当たりでメダルは出ない（D-049）。
  const medalsPachinko = 0;
  let fuelGrantedMs = 0;
  let yakumonoBase = 0;
  const bonusTotal = 0;
  let actionTotal = 0;
  let croonDay: number | null = null;
  let firstAwakenDay: number | null = null;
  let firstCloseDay: number | null = null;
  let minBalls = econ.startBalls();
  const dayOf = (at: number): number => Math.floor(at / DAY_MS) + 1;
  const shootRate = play.min > 0 ? play.rate : 1;

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
      const gain = closeGain(s.totalTotal, spec.close.divisor, s.regular, s.medalsEarned, spec.close.medalsPerPoint);
      if (gain >= 1) {
        eng.appendAction({ t, k: 'close' });
        closes = closes + 1;
        firstCloseDay = firstCloseDay ?? dayOf(t);
        closeHistory.push({ day: dayOf(t), gain });
        balls = spec.close.startBalls;
        s = { ...s, lv: [0, 0, 0, 0, 0, 0, 0, 0], awakened: [0, 0, 0, 0, 0, 0, 0, 0], idleStage: 0, tankStage: 0, nailStage: 0, shortenStage: 0, holdStage: 0, autoOwned: false, tomeuchiOwned: false, runTotal: 0 };
      }
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
      eng.appendAction({ t, k: 'shoot', on: wantShoot, rate: shootRate });
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
    const total0 = econ.getTotalTotal();
    const payout0 = eng.project().totals.payoutBalls;
    const evs: EngineSimEvent[] = eng.advance(next);
    const total1 = econ.getTotalTotal();
    const payout1 = eng.project().totals.payoutBalls;
    let actionInInterval = 0;
    for (let i = 0; i < evs.length; i = i + 1) {
      const e = evs[i] as EngineSimEvent;
      if (e.k === 'granted') {
        actionInInterval = actionInInterval + (e.balls ?? 0);
      }
    }
    const tick = total1 - total0 - (payout1 - payout0) - actionInInterval;
    if (tick > 0) {
      yakumonoBase = yakumonoBase + tick;
    }
    if (actionInInterval > 0) {
      actionTotal = actionTotal + actionInInterval;
    }
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
    const nowBalls = eng.project().balls;
    if (nowBalls < minBalls) {
      minBalls = nowBalls;
    }
    if (t === dayEnd) {
      const pe = eng.project();
      const se = econ.snapshot();
      const ti = topIndex(se);
      rows.push({
        day: t / DAY_MS,
        balls: pe.balls,
        perSecFg: econ.getPerSec(true, 1),
        runTotal: se.runTotal,
        totalTotal: se.totalTotal,
        regular: se.regular,
        ballPts: ballPoints(se.totalTotal, spec.close.divisor),
        medalPts: Math.floor(se.medalsEarned / spec.close.medalsPerPoint),
        closes,
        awakens,
        top: ti >= 0 ? (ECONOMY_YAKUMONO_IDS[ti] as string) : '-',
        lvTotal: se.lv.reduce((a, v) => a + v, 0),
        medals: pe.medals,
        medalsActivity,
        medalsPachinko,
        jackpots: pe.totals.jackpots,
        fired: pe.totals.fired,
        payout: pe.totals.payoutBalls,
        yakumono: yakumonoBase,
        bonus: bonusTotal,
        action: actionTotal,
        fuelMin: fuelGrantedMs / MIN_MS,
        achDone: se.achieved.length,
        achMult: econ.achMult(),
      });
    }
  }
  const lastPayout = rows.length > 0 ? (rows[rows.length - 1] as EconDayRow).payout : 0;
  const lastAction = rows.length > 0 ? (rows[rows.length - 1] as EconDayRow).action : 0;
  return {
    profile: profile.id,
    machine,
    seed,
    days,
    rows,
    croonDay,
    firstAwakenDay,
    firstCloseDay,
    medalsActivity,
    medalsPachinko,
    closeHistory,
    yakumono: yakumonoBase,
    bonus: bonusTotal,
    payout: lastPayout,
    action: lastAction,
    minBalls,
  };
}

/** パチンコ期待値（1玉あたり払い戻し＝出玉/投入玉。出玉だけ・レートによらない, D-090）。背面オート share=1・レート1で hours 時間回す。 */
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
  const fuelMs = hours * 3600000;
  const initialBalls = 1e12;
  const eng = new Engine({ seed, spec: mspec, patterns, atlas: buffer, initialBalls, initialFuelMs: fuelMs, economy: econ }, [], [
    { t: 0, k: 'presence', fg: false },
    { t: 0, k: 'auto', share: 1, rate: 1 },
  ]);
  eng.advance(hours * 3600000);
  const totals = eng.project().totals;
  const finalBalls = eng.project().balls;
  // 投入玉＝初期−最終＋払い戻し（生産0のため。燃料はあるが役物なしで perSec=0）。
  const cost = initialBalls - finalBalls + totals.payoutBalls;
  return cost > 0 ? totals.payoutBalls / cost : 0;
}

/** 初当たり1回（連チャン込み）の平均出玉を生産時間に換算（P8-T9 その2）。理論値 avgPerHatsuari（unit=1）を使い、レート r での生産時間 = avg × r × shotS / 3600（ref が約分されレートによらない基準と同じ）。 */
export function hatsuariProdHours(machine: string, rate: number, economyUrl: URL = ECONOMY_URL): { avg: number; hours: number } {
  const espec = parseEconomyText(readFileSync(economyUrl, 'utf8'));
  const { spec: mspec } = loadRunMachine(machine);
  const { hesoRate } = loadRunAtlas();
  const theory = computeTheory(mspec, hesoRate);
  const hours = (theory.avgPerHatsuari * rate * espec.pachinko.shotS) / 3600;
  return { avg: theory.avgPerHatsuari, hours };
}

/** 100パチのバースト1回（P8-T9 その3）。手持ち生産 initialProdHours 時間ぶんで rate を前面で打ち続け、尽きるまでの分と初当たりの有無を返す。上限 30分で打ち切る。 */
export function runBurstOnce(
  machine: string,
  seed: number,
  initialProdHours = 56,
  rate = 100,
  economyUrl: URL = ECONOMY_URL,
): { minutes: number; hatsuari: boolean } {
  const espec = parseEconomyText(readFileSync(economyUrl, 'utf8'));
  const { spec: mspec, patterns } = loadRunMachine(machine);
  const { buffer } = loadRunAtlas();
  const econ = new IdleEconomy(espec);
  const rates = espec.upgrades.rates;
  let stage = 0;
  for (let i = 0; i < rates.length; i = i + 1) {
    if ((rates[i] as number) <= rate) {
      stage = i;
    }
  }
  econ.restore({ ...econ.snapshot(), rateStage: stage });
  const ref = econ.getRefPerSec();
  const initialBalls = initialProdHours * 3600 * ref;
  const unit = econ.getShotUnit(rate);
  const eng = new Engine(
    { seed, spec: mspec, patterns, atlas: buffer, initialBalls, initialFuelMs: 10 * 3600000, economy: econ },
    [],
    [
      { t: 0, k: 'presence', fg: true },
      { t: 0, k: 'shoot', on: true, rate },
    ],
  );
  const CAP_MS = 30 * 60000;
  const STEP_MS = 600;
  let t = 0;
  while (t < CAP_MS) {
    const next = t + STEP_MS;
    eng.advance(next);
    t = next;
    const p = eng.project();
    if (p.balls < unit && p.totals.jackpots === 0) {
      // まだ当たりが無く持ち玉が1発に足りない：一旦打ち止めだが保留の払い出しで復活するかもしれないので、
      // 追加で 60 秒だけ進めてそれでも足りなければ尽きたとみなす。
      eng.advance(t + 60000);
      t = t + 60000;
      if (eng.project().balls < unit) {
        break;
      }
    } else if (p.balls < unit) {
      // 当たり後の持ち玉でも1発に足りなければ、保留消化を待たずに尽きたとみなす（連チャン中の出玉は既に反映済み）。
      // ただし大当たり・変動が進行中なら終了まで待つため、追加で 5 分進めて判定する。
      eng.advance(t + 300000);
      t = t + 300000;
      if (eng.project().balls < unit) {
        break;
      }
      if (t >= CAP_MS) {
        break;
      }
    }
    if (p.totals.jackpots > 0 && p.balls < unit) {
      break;
    }
  }
  const capped = t >= CAP_MS;
  const p = eng.project();
  return { minutes: capped ? 30 : t / 60000, hatsuari: p.totals.jackpots > 0 };
}

/** バースト100試行（seed 1〜100 固定で決定論）の平均時間と初当たり確率（P8-T9 その3）。 */
export function burstStats(
  machine: string,
  economyUrl: URL = ECONOMY_URL,
  trials = 100,
  initialProdHours = 56,
  rate = 100,
): { avgMin: number; hatsuariProb: number } {
  let sum = 0;
  let hits = 0;
  for (let i = 1; i <= trials; i = i + 1) {
    const r = runBurstOnce(machine, i, initialProdHours, rate, economyUrl);
    sum = sum + r.minutes;
    if (r.hatsuari) {
      hits = hits + 1;
    }
  }
  return { avgMin: sum / trials, hatsuariProb: hits / trials };
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

/** 最終日の常連P（行が無ければ 0）。 */
export function lastRegular(r: EconResult): number {
  return r.rows.length > 0 ? (r.rows[r.rows.length - 1] as EconDayRow).regular : 0;
}

/** 日別表とバランス目標の判定を文字列にする。heavy は同じ機種・seed・日数の standard（baseline）と常連Pを比べる。 */
export function formatEcon(r: EconResult, ev: { init: number; full: number } | null, baseline: EconResult | null = null): string {
  const lines: string[] = [];
  lines.push(`econ: profile=${r.profile} days=${r.days} machine=${r.machine} seed=${r.seed}`);
  lines.push('day | balls | perSec(fg) | runTotal | total | regP(ball/med) | close | awaken | top | medals | yaku/bonus/payout/action | jackpot% | action% | jackpots | fuel(h,cum) | ach(n/xmult)');
  for (let i = 0; i < r.rows.length; i = i + 1) {
    const w = r.rows[i] as EconDayRow;
    const total = w.yakumono + w.bonus + w.payout + w.action;
    const share = total > 0 ? ((w.bonus + w.payout) / total) * 100 : 0;
    const actionShare = total > 0 ? (w.action / total) * 100 : 0;
    lines.push(
      `${w.day} | ${fmtNum(w.balls)} | ${fmtNum(w.perSecFg)} | ${fmtNum(w.runTotal)} | ${fmtNum(w.totalTotal)} | ${w.regular}(${w.ballPts}/${w.medalPts}) | ${w.closes} | ${w.awakens} | ${w.top} | ${w.medals} | ${fmtNum(w.yakumono)}/${fmtNum(w.bonus)}/${fmtNum(w.payout)}/${fmtNum(w.action)} | ${share.toFixed(1)} | ${actionShare.toFixed(1)} | ${w.jackpots} | ${(w.fuelMin / 60).toFixed(1)} | ${w.achDone}/x${w.achMult.toFixed(2)}`,
    );
  }
  lines.push(`milestones: croon day ${r.croonDay ?? '-'} / first awaken day ${r.firstAwakenDay ?? '-'} / first close day ${r.firstCloseDay ?? '-'}`);
  lines.push(`medals: activity ${r.medalsActivity} / pachinko ${r.medalsPachinko} (pachinko always 0, D-049)`);
  lines.push(`min balls: ${fmtNum(r.minBalls)} (${r.minBalls > 0 ? 'OK not broke' : 'NG broke'})`);
  const closeStr = r.closeHistory.length > 0 ? r.closeHistory.map((c) => `day${c.day}+${c.gain}`).join(', ') : '-';
  lines.push(`closes: ${closeStr}`);
  const grandTotal = r.yakumono + r.bonus + r.payout + r.action;
  const grandShare = grandTotal > 0 ? ((r.bonus + r.payout) / grandTotal) * 100 : 0;
  const grandActionShare = grandTotal > 0 ? (r.action / grandTotal) * 100 : 0;
  lines.push(`balls: yakumono ${fmtNum(r.yakumono)} / bonus ${fmtNum(r.bonus)} / payout ${fmtNum(r.payout)} / action ${fmtNum(r.action)} (jackpot ${(grandShare).toFixed(1)}% / action ${(grandActionShare).toFixed(1)}%)`);
  const row7 = r.rows.length >= 7 ? (r.rows[6] as EconDayRow) : null;
  if (row7 !== null) {
    const t7 = row7.yakumono + row7.bonus + row7.payout + row7.action;
    const s7 = t7 > 0 ? ((row7.bonus + row7.payout) / t7) * 100 : 0;
    const a7 = t7 > 0 ? (row7.action / t7) * 100 : 0;
    lines.push(`balls day1-7: jackpot share ${s7.toFixed(1)}% (target 25-45%) / action share ${a7.toFixed(1)}% (target 25-45%, D-081)`);
  }
  lines.push('targets (spec/23):');
  if (r.profile === 'standard') {
    const ok1 = r.croonDay === 1;
    const ok2 = r.firstAwakenDay !== null && r.firstAwakenDay >= 3 && r.firstAwakenDay <= 4;
    const ok3 = r.firstCloseDay !== null && r.firstCloseDay >= 6 && r.firstCloseDay <= 8;
    const ng3 = r.firstCloseDay === null && r.days < 8 ? 'NG (run --days >= 8)' : 'NG';
    const firstGain = r.closeHistory.length > 0 ? (r.closeHistory[0] as EconCloseEntry).gain : 0;
    const okGain = firstGain === 1;
    lines.push(`  croon on day 1: ${ok1 ? 'OK' : 'NG'} / first awaken ~day 3 (3-4): ${ok2 ? 'OK' : 'NG'} / first close ~day 7 (6-8): ${ok3 ? 'OK' : ng3} / first gain +1: ${okGain ? 'OK' : 'NG'}`);
    if (row7 !== null) {
      const t7 = row7.yakumono + row7.bonus + row7.payout + row7.action;
      const s7 = t7 > 0 ? (row7.bonus + row7.payout) / t7 : 0;
      const a7 = t7 > 0 ? row7.action / t7 : 0;
      lines.push(`  jackpot share day1-7 25-45%: ${(s7 >= 0.25 && s7 <= 0.45 ? 'OK' : 'NG')} (${(s7 * 100).toFixed(1)}%)`);
      lines.push(`  action share day1-7 25-45%: ${(a7 >= 0.25 && a7 <= 0.45 ? 'OK' : 'NG')} (${(a7 * 100).toFixed(1)}%)`);
    }
    if (r.days >= 28) {
      const closes28 = r.closeHistory.filter((c) => c.day <= 28).length;
      lines.push(`  closes in 28d ~(weekly x4): ${closes28 >= 3 && closes28 <= 5 ? 'OK' : 'NG'} (${closes28})`);
      // 各週の最高到達役物は (役物index, その Lv) の辞書順で比べる（最上位役物に達した後も Lv で「上回る」を判定, D-054）。
      const weekTop: number[] = [-1, -1, -1, -1];
      const weekLv: number[] = [0, 0, 0, 0];
      const weekPer: number[] = [0, 0, 0, 0];
      for (let i = 0; i < r.rows.length && i < 28; i = i + 1) {
        const w = r.rows[i] as EconDayRow;
        const wk = Math.floor(i / 7);
        const topIdx = (ECONOMY_YAKUMONO_IDS as readonly string[]).indexOf(w.top);
        if (topIdx > (weekTop[wk] as number) || (topIdx === weekTop[wk] && w.lvTotal > (weekLv[wk] as number))) {
          weekTop[wk] = topIdx;
          weekLv[wk] = w.lvTotal;
        }
        if (w.perSecFg > (weekPer[wk] as number)) {
          weekPer[wk] = w.perSecFg;
        }
      }
      let topUp = true;
      let perUp = true;
      for (let k = 1; k < 4; k = k + 1) {
        const cur = weekTop[k] as number;
        const prev = weekTop[k - 1] as number;
        if (!(cur > prev || (cur === prev && (weekLv[k] as number) > (weekLv[k - 1] as number)))) {
          topUp = false;
        }
        if (!((weekPer[k] as number) > (weekPer[k - 1] as number))) {
          perUp = false;
        }
      }
      const weekStr = weekTop.map((v, k) => `${v}:${weekLv[k]}`).join('/');
      lines.push(`  weekly top increasing: ${topUp ? 'OK' : 'NG'} (${weekStr}) / weekly perSec increasing: ${perUp ? 'OK' : 'NG'}`);
    }
    if (r.days >= 84) {
      // 4週目→12週目で、週の最高 perSec の伸びが (1 + 常連P) の伸び以上か（倍率式が鈍っていないか, spec/23）。
      const weekMax = (wk: number): { per: number; reg: number } => {
        let per = 0;
        let reg = 0;
        for (let i = wk * 7 - 7; i < wk * 7 && i < r.rows.length; i = i + 1) {
          const w = r.rows[i] as EconDayRow;
          per = w.perSecFg > per ? w.perSecFg : per;
          reg = w.regular;
        }
        return { per, reg };
      };
      const w4 = weekMax(4);
      const w12 = weekMax(12);
      const perGrowth = w4.per > 0 ? w12.per / w4.per : 0;
      const regGrowth = (1 + w12.reg) / (1 + w4.reg);
      lines.push(
        `  12w perSec growth >= (1+P) growth (week4->12): ${perGrowth >= regGrowth ? 'OK' : 'NG'} (x${perGrowth.toFixed(2)} vs x${regGrowth.toFixed(2)}, P ${w4.reg}->${w12.reg})`,
      );
    }
  } else if (r.profile === 'none') {
    const ok = r.firstCloseDay === null ? r.days >= 60 : r.firstCloseDay > 60;
    lines.push(`  first close after day 60: ${ok ? 'OK' : r.firstCloseDay === null ? 'NG (run --days >= 61)' : 'NG'}`);
  } else {
    const mine = lastRegular(r);
    if (baseline === null) {
      lines.push(`  heavy regular > standard: NG (no standard baseline)`);
    } else {
      const base = lastRegular(baseline);
      lines.push(`  heavy regular > standard: ${mine > base ? 'OK' : 'NG'} (${mine} vs ${base})`);
    }
  }
  if (ev !== null) {
    const margin = r.machine.startsWith('lt-') ? 0.07 : 0.05;
    const okInit = ev.init >= 1.1 - margin && ev.init <= 1.1 + margin;
    const okFull = ev.full <= 1.3;
    lines.push(
      `  pachinko EV init ${ev.init.toFixed(3)} (≈1.10: ${okInit ? 'OK' : 'NG'}) / all upgrades ${ev.full.toFixed(3)} (<=1.30: ${okFull ? 'OK' : 'NG'})`,
    );
  }
  return lines.join('\n');
}
