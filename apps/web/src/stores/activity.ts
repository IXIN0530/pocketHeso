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

/** 計画の合計（確認画面の「今回増える燃料・メダル」）。 */
export function planTotals(plan: ClaimPlan): { fuelMs: number; medals: number } {
  let fuelMs = 0;
  let medals = 0;
  for (const r of plan.records) {
    fuelMs += r.grant.fuelMs;
    medals += r.grant.medals;
  }
  return { fuelMs, medals };
}

/** セッション・登録地点の ID。 */
export function newId(): string {
  return crypto.randomUUID();
}
