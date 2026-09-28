// 行動画面の純関数: 受け取りの計画・集計・表示用の整形（時刻は引数）。
import {
  parseClaimRules,
  parseShortcutCode,
  planGrants,
  streakOf,
  type ClaimInput,
  type ClaimRecord,
  type ClaimRules,
} from '@ph/claims';
import { formatNum } from './format.ts';
import economyJson from '../../../../resources/economy/default.json';

export const CLAIM_RULES: ClaimRules = parseClaimRules(economyJson);

/** 確認画面に出す受け取りの計画。records が空なら「受け取るものなし」。 */
export interface ClaimPlan {
  readonly title: string;
  readonly records: readonly ClaimRecord[];
  readonly warnings: readonly string[];
}

export type PlanResult = { readonly k: 'plan'; readonly plan: ClaimPlan } | { readonly k: 'error'; readonly message: string };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 端末のローカル日付 YYYY-MM-DD。 */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 貼り付けたコードを検証して受け取りを計画する（spec/31）。 */
export function planShortcut(
  ledger: readonly ClaimRecord[],
  text: string,
  pairingKey: string,
  now: number,
  rules: ClaimRules = CLAIM_RULES,
): PlanResult {
  const parsed = parseShortcutCode(text, pairingKey, now);
  if (parsed.k === 'error') {
    return { k: 'error', message: parsed.message };
  }
  const records = planGrants(ledger, parsed, rules);
  return { k: 'plan', plan: { title: '運動を受け取る', records, warnings: parsed.warnings ?? [] } };
}

/** チェックイン・自己申告の受け取りを計画する。 */
export function planInput(
  ledger: readonly ClaimRecord[],
  input: ClaimInput,
  title: string,
  rules: ClaimRules = CLAIM_RULES,
): ClaimPlan {
  return { title, records: planGrants(ledger, input, rules), warnings: [] };
}

export interface ActivitySummary {
  /** 受け取った燃料の合計（Engine への Grant の合計。P5 で Engine の残量表示に置き換える）。 */
  readonly fuelMs: number;
  readonly medals: number;
  readonly todayFuelMs: number;
  readonly streak: number;
}

export function summarize(ledger: readonly ClaimRecord[], today: string, rules: ClaimRules = CLAIM_RULES): ActivitySummary {
  let fuelMs = 0;
  let medals = 0;
  let todayFuelMs = 0;
  for (const r of ledger) {
    fuelMs += r.grant.fuelMs;
    medals += r.grant.medals;
    if (localDay(r.receivedAt) === today) {
      todayFuelMs += r.grant.fuelMs;
    }
  }
  return { fuelMs, medals, todayFuelMs, streak: streakOf(ledger, today, rules) };
}

/** 燃料（営業時間）の表示: 「1時間05分」「25分」。1分未満は切り捨て。 */
export function formatFuel(ms: number): string {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}時間${pad2(min % 60)}分` : `${min}分`;
}

const SOURCE_TEXT: Record<ClaimRecord['source'], string> = {
  health: 'ヘルスケア',
  checkin: '施設',
  'checkin-own': '登録地点',
  self: '自己申告',
  pass: '休養日パス',
};

/** 確認画面・履歴の1行（例: 「9/24 歩数 8,234歩（ヘルスケア）」）。 */
export function describeRecord(r: ClaimRecord): string {
  const [, m, d] = r.day.split('-');
  const date = `${Number(m)}/${Number(d)}`;
  const n = r.amount.toLocaleString('ja-JP');
  switch (r.kind) {
    case 'steps':
      return `${date} 歩数 ${n}歩（${SOURCE_TEXT[r.source]}）`;
    case 'distance':
      return `${date} 距離 ${n}m（記録のみ）`;
    case 'checkin':
      return `${date} トレーニング ${n}分（${SOURCE_TEXT[r.source]}）${r.placeBonus !== undefined ? ' 初成立' : ''}`;
    case 'self':
      return `${date} 自己申告`;
    case 'rest':
      return `${date} 休養日パス（連続日数を保つ）`;
  }
}

/** 受け取りの合計（燃料・メダル・即時の玉の「生産◯分ぶん」・特別保留）。 */
export interface GrantTotals {
  readonly fuelMs: number;
  readonly medals: number;
  readonly prodMin: number;
  readonly bonusHolds: number;
}

export function grantTotals(records: readonly ClaimRecord[]): GrantTotals {
  let fuelMs = 0;
  let medals = 0;
  let prodMin = 0;
  let bonusHolds = 0;
  for (const r of records) {
    fuelMs += r.grant.fuelMs;
    medals += r.grant.medals;
    prodMin += r.grant.prodMin ?? 0;
    bonusHolds += r.grant.bonusHolds ?? 0;
  }
  return { fuelMs, medals, prodMin, bonusHolds };
}

/** 計画の合計（確認画面の「今回増えるもの」）。 */
export function planTotals(plan: ClaimPlan): GrantTotals {
  return grantTotals(plan.records);
}

/** 即時の玉の見込み = 基準生産/秒 × 生産◯分 × 60（Engine と同じ式, spec/23。確定値は granted の balls）。 */
export function projectBalls(prodMin: number, refPerSec: number): number {
  return refPerSec * prodMin * 60;
}

/** 「生産◯時間ぶん」の◯（「1時間05分」「25分」。1分未満は「1分未満」）。 */
export function formatProd(prodMin: number): string {
  return prodMin > 0 && prodMin < 1 ? '1分未満' : formatFuel(prodMin * 60000);
}

/** 今日の上限までの残り（即時の玉・メダル・特別保留）。上限を超える仮の入力を planGrants に通して求める（施設のチェックイン扱い）。 */
export function todayRemaining(ledger: readonly ClaimRecord[], now: number, rules: ClaimRules = CLAIM_RULES): Omit<GrantTotals, 'fuelMs'> {
  const today = localDay(now);
  const probes: ClaimInput[] = [
    { k: 'health', receivedAt: now, today, days: [{ day: today, steps: 1e9 }] },
    { k: 'checkin', receivedAt: now, today, sessionId: 'probe', day: today, own: false, minutes: 100000, span: [now, now] },
  ];
  const records = probes.flatMap((p) => planGrants(ledger, p, rules));
  const selfLeft = Math.max(0, rules.self.maxPerDay - ledger.filter((r) => r.kind === 'self' && r.day === today).length);
  const t = grantTotals(records);
  return { medals: t.medals, prodMin: t.prodMin + selfLeft * rules.self.prodMinPerItem * rules.trust.self, bonusHolds: t.bonusHolds };
}

/** セッション・登録地点の ID。 */
export function newId(): string {
  return crypto.randomUUID();
}

/** 確定後のトースト（Engine の granted の合計, spec/40）。何も増えなければ null。 */
export function describeReceived(r: { balls: number; bonusHolds: number; medals: number; fuelMs: number }): string | null {
  const parts: string[] = [];
  if (r.balls > 0) parts.push(`玉 +${formatNum(r.balls)}`);
  if (r.bonusHolds > 0) parts.push(`特別保留 +${r.bonusHolds}`);
  if (r.medals > 0) parts.push(`メダル +${r.medals}`);
  if (r.fuelMs > 0) parts.push(`燃料 +${formatFuel(r.fuelMs)}`);
  return parts.length === 0 ? null : `受け取りました: ${parts.join('・')}`;
}
