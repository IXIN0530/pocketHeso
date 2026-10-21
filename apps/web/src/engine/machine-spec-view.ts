// 台のスペック画面の表示データ（P14-T3）。機種 JSON（MachineSpec）から円グラフ・ゲームフロー・基本性能の表を作る純関数。
// Core は変えない。web なので Math.pow 可。出玉は「1発 1玉」のとき（実際は × 取得時の unit, spec/21 D-090）。
import { splitWeights, type LotteryModeId, type MachineMode, type MachineSpec } from '@ph/core';

/** 円グラフの1扇（振り分けの重みが 0 でない枝）。 */
export interface SpecSlice {
  /** jackpotSplit の添字。 */
  readonly branch: number;
  readonly rounds: number;
  readonly bonusRounds: number;
  /** 「10R」「10R＋上乗せ 20R」。上位は「20R＋上乗せ」。 */
  readonly roundsLabel: string;
  /** 出玉（1発 1玉のとき）= (rounds + bonusRounds) × count × payout_per_ball。上位は上乗せ 0 回のとき。 */
  readonly balls: number;
  /** 上位の枝（D-120）: 上乗せが最大まで乗った時の出玉と、平均（rounds + bonus + add × E[K]）。上位でなければ null。 */
  readonly upper: { readonly maxBalls: number; readonly avgBalls: number } | null;
  /** 「1,500個」。上位は「約3,000〜9,000個」。 */
  readonly ballsLabel: string;
  readonly next: LotteryModeId;
  /** 次の状態の帯: 「RUSH 100回」「時短 100回」「LT 91回」「通常」。 */
  readonly nextLabel: string;
  readonly weight: number;
  /** 重みの比（0〜1）。 */
  readonly share: number;
  /** 整数の %（最大剰余で合計 100）。 */
  readonly percent: number;
}

/** 入賞口（モード）ごとの円グラフ。 */
export interface SpecPie {
  readonly mode: LotteryModeId;
  /** 「ヘソ（通常時）」「電チュー（RUSH 中）」など。 */
  readonly title: string;
  readonly slices: readonly SpecSlice[];
}

/** ゲームフローの箱（機種にあるモードだけ）。 */
export interface FlowNode {
  readonly mode: LotteryModeId;
  /** 「通常時」「時短」「RUSH」「LT」。 */
  readonly label: string;
  /** 「1/185.0」。 */
  readonly odds: string;
  /** 回転数（通常は 0 = 無制限）。 */
  readonly spins: number;
  /** 矢印の下に添える注記（例「RUSH 当たり → 上位RUSH 25%」）。 */
  readonly notes: readonly string[];
}

/** ゲームフローの矢印。jackpot = そのモードの大当たり後の行き先（% は行き先ごとに合算・最大剰余）、end = 回数切れで通常へ。 */
export interface FlowEdge {
  readonly from: LotteryModeId;
  readonly to: LotteryModeId;
  readonly kind: 'jackpot' | 'end';
  /** jackpot の時の割合（整数 %）。end は 0。 */
  readonly percent: number;
}

/** 基本性能の表の1行。 */
export interface SpecRow {
  readonly label: string;
  readonly value: string;
}

export interface MachineSpecView {
  readonly id: string;
  readonly pies: readonly SpecPie[];
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  readonly rows: readonly SpecRow[];
  /** RUSH 突入率（通常時の初当たりから。時短経由の引き戻しを含む）0〜1。 */
  readonly rushEntry: number;
  /** モードごとの継続率・引き戻し率（0〜1）。st: RUSH 継続率 / lt: LT 継続率 / jitan: 時短中に RUSH へ行く率。 */
  readonly continuation: Readonly<Partial<Record<LotteryModeId, number>>>;
  /** 出玉の注記。 */
  readonly ballsNote: string;
}

/** 表示順（反復順に依存しない）。 */
const MODES: readonly LotteryModeId[] = ['normal', 'jitan', 'st', 'lt'];

const PIE_TITLE: Readonly<Record<LotteryModeId, string>> = {
  normal: 'ヘソ（通常時）',
  jitan: '電チュー（時短中）',
  st: '電チュー（RUSH 中）',
  lt: '電チュー（LT 中）',
};

const NODE_LABEL: Readonly<Record<LotteryModeId, string>> = {
  normal: '通常時',
  jitan: '時短',
  st: 'RUSH',
  lt: 'LT',
};

const ODDS_LABEL: Readonly<Record<LotteryModeId, string>> = {
  normal: '通常時',
  jitan: '時短中',
  st: 'RUSH 中',
  lt: 'LT 中',
};

export const BALLS_NOTE = '出玉は 1発 1玉のとき。実際は × 1発の玉数（レートと生産で変わる）';

function modeSpec(spec: MachineSpec, mode: LotteryModeId): MachineMode | undefined {
  if (mode === 'normal') return spec.normal;
  if (mode === 'jitan') return spec.jitan;
  if (mode === 'st') return spec.st;
  return spec.lt;
}

/** 機種の状態として出るモード（normal・st は必ず。jitan・lt は JSON にある時だけ）。 */
function modesOf(spec: MachineSpec): LotteryModeId[] {
  return MODES.filter((m) => modeSpec(spec, m) !== undefined);
}

/** 3桁区切り（ロケールに依存しない）。 */
export function groupDigits(n: number): string {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 重みを整数 % に（最大剰余。剰余が同じなら先の添字から +1）。合計 0 なら全部 0。 */
export function largestRemainder(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w * 100) / total);
  const out = exact.map((x) => Math.floor(x));
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    out[o.i] = (out[o.i] as number) + 1;
    rest -= 1;
  }
  return out;
}

/** n 回転のうちに 1/p が1回以上当たる確率 = 1 − (1 − 1/p)^n。 */
export function hitWithin(jackpot1In: number, spins: number): number {
  if (spins <= 0) return 0;
  return 1 - Math.pow(1 - 1 / jackpot1In, spins);
}

/** 上乗せ回数の期待値 E[K] = Σ_{k=1..max} (1/loop_1_in)^k。 */
export function expectedLoops(loop1In: number, loopMax: number): number {
  let e = 0;
  for (let k = 1; k <= loopMax; k++) e += Math.pow(1 / loop1In, k);
  return e;
}

/** 振り分けの next（省略時は kakuhen→st・tsujo→normal, spec/21）。 */
function nextOf(spec: MachineSpec, branch: number): LotteryModeId {
  const b = spec.jackpotSplit[branch];
  if (b === undefined) return 'normal';
  if (b.next !== undefined) return b.next;
  return b.kind === 'kakuhen' ? 'st' : 'normal';
}

function nextLabel(spec: MachineSpec, next: LotteryModeId): string {
  if (next === 'normal') return '通常';
  const m = modeSpec(spec, next);
  return `${NODE_LABEL[next]} ${m === undefined ? 0 : m.stSpins}回`;
}

function slicesOf(spec: MachineSpec, mode: LotteryModeId): SpecSlice[] {
  const weights = splitWeights(spec, mode);
  const idx: number[] = [];
  for (let i = 0; i < weights.length; i++) if ((weights[i] as number) > 0) idx.push(i);
  const ws = idx.map((i) => weights[i] as number);
  const total = ws.reduce((a, b) => a + b, 0);
  const pct = largestRemainder(ws);
  return idx.map((i, k) => {
    const b = spec.jackpotSplit[i]!;
    const bonus = b.bonusRounds ?? 0;
    const perRound = spec.roundCount * spec.payoutPerBall;
    const balls = (b.rounds + bonus) * perRound;
    const next = nextOf(spec, i);
    const u = b.upper;
    const upper =
      u === undefined
        ? null
        : { maxBalls: balls + u.addRounds * u.loopMax * perRound, avgBalls: balls + u.addRounds * expectedLoops(u.loop1In, u.loopMax) * perRound };
    return {
      branch: i,
      rounds: b.rounds,
      bonusRounds: bonus,
      roundsLabel: upper !== null ? `${b.rounds + bonus}R＋上乗せ` : bonus > 0 ? `${b.rounds}R＋上乗せ ${bonus}R` : `${b.rounds}R`,
      balls,
      upper,
      ballsLabel: upper !== null ? `約${groupDigits(balls)}〜${groupDigits(upper.maxBalls)}個` : `${groupDigits(balls)}個`,
      next,
      nextLabel: nextLabel(spec, next),
      weight: ws[k] as number,
      share: (ws[k] as number) / total,
      percent: pct[k] as number,
    };
  });
}

/** そのモードの大当たりで行き先が targets に入る割合（0〜1）。 */
function shareTo(pie: SpecPie, targets: readonly LotteryModeId[]): number {
  let s = 0;
  for (const sl of pie.slices) if (targets.includes(sl.next)) s += sl.share;
  return s;
}

function pct1(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** そのモードの当たりで上位になる割合（0〜1）。 */
function upperShare(pie: SpecPie): number {
  let s = 0;
  for (const sl of pie.slices) if (sl.upper !== null) s += sl.share;
  return s;
}

/** そのモードの当たり1回の平均出玉（上位は上乗せの期待値込み）。 */
function avgBallsOf(pie: SpecPie): number {
  let s = 0;
  for (const sl of pie.slices) s += sl.share * (sl.upper === null ? sl.balls : sl.upper.avgBalls);
  return s;
}

export function machineSpecView(spec: MachineSpec): MachineSpecView {
  const modes = modesOf(spec);
  const pies: SpecPie[] = modes.map((mode) => ({ mode, title: PIE_TITLE[mode], slices: slicesOf(spec, mode) }));
  const pieOf = (m: LotteryModeId): SpecPie | undefined => pies.find((p) => p.mode === m);

  const nodes: FlowNode[] = modes.map((mode) => {
    const m = modeSpec(spec, mode)!;
    const pie = pies.find((p) => p.mode === mode)!;
    const up = upperShare(pie);
    const notes = up > 0 ? [`${NODE_LABEL[mode]} 当たり → 上位RUSH ${Math.round(up * 100)}%`] : [];
    return { mode, label: NODE_LABEL[mode], odds: `1/${m.jackpot1In.toFixed(1)}`, spins: mode === 'normal' ? 0 : m.stSpins, notes };
  });

  const edges: FlowEdge[] = [];
  for (const pie of pies) {
    const targets = MODES.filter((t) => pie.slices.some((s) => s.next === t));
    const pct = largestRemainder(targets.map((t) => shareTo(pie, [t])));
    targets.forEach((to, k) => edges.push({ from: pie.mode, to, kind: 'jackpot', percent: pct[k] as number }));
  }
  for (const mode of modes) if (mode !== 'normal') edges.push({ from: mode, to: 'normal', kind: 'end', percent: 0 });

  // 継続率: その状態の回転数のうちに当たる確率 × 振り分けで RUSH（LT は LT）に戻る枝の割合。
  const continuation: Partial<Record<LotteryModeId, number>> = {};
  const rushTargets: Readonly<Record<LotteryModeId, readonly LotteryModeId[]>> = {
    normal: [],
    jitan: ['st', 'lt'],
    st: ['st', 'lt'],
    lt: ['lt'],
  };
  for (const mode of modes) {
    if (mode === 'normal') continue;
    const m = modeSpec(spec, mode)!;
    continuation[mode] = hitWithin(m.jackpot1In, m.stSpins) * shareTo(pieOf(mode)!, rushTargets[mode]);
  }

  // RUSH 突入率: 初当たりで RUSH/LT 直行 ＋ 時短へ行く割合 × 時短中に RUSH へ行く率。
  const normalPie = pieOf('normal')!;
  const rushEntry = shareTo(normalPie, ['st', 'lt']) + shareTo(normalPie, ['jitan']) * (continuation.jitan ?? 0);

  const rows: SpecRow[] = [];
  for (const n of nodes) rows.push({ label: `大当たり確率（${ODDS_LABEL[n.mode]}）`, value: n.odds });
  for (const n of nodes) if (n.mode !== 'normal') rows.push({ label: `${n.label} 回転数`, value: `${n.spins}回` });
  rows.push({ label: 'RUSH 突入率', value: pct1(rushEntry) });
  if (continuation.jitan !== undefined) rows.push({ label: '時短 引き戻し率', value: pct1(continuation.jitan) });
  if (continuation.st !== undefined) rows.push({ label: 'RUSH 継続率', value: pct1(continuation.st) });
  if (continuation.lt !== undefined) rows.push({ label: 'LT 継続率', value: pct1(continuation.lt) });
  // 上位RUSH（D-120）: 上位の枝があるモードだけ。割合・上乗せのループ・そのモードの当たりの平均出玉（100個単位）。
  for (const pie of pies) {
    const up = upperShare(pie);
    if (up <= 0) continue;
    const sl = pie.slices.find((x) => x.upper !== null)!;
    const u = spec.jackpotSplit[sl.branch]!.upper!;
    rows.push({ label: '上位RUSH', value: `${ODDS_LABEL[pie.mode]}の当たりの ${Math.round(up * 100)}%` });
    rows.push({ label: '上乗せ', value: `1/${u.loop1In} でループ（最大 +${u.addRounds * u.loopMax}R）` });
    rows.push({ label: `${ODDS_LABEL[pie.mode]}の当たりの平均`, value: `約${groupDigits(Math.round(avgBallsOf(pie) / 100) * 100)}個` });
  }
  rows.push({ label: '1R', value: `${spec.roundCount}カウント × ${spec.payoutPerBall}個` });
  rows.push({ label: 'ヘソ賞球', value: `${spec.hesoPayout}個` });
  rows.push({ label: '保留', value: `${spec.holdMax}個` });

  return { id: spec.id, pies, nodes, edges, rows, rushEntry, continuation, ballsNote: BALLS_NOTE };
}
