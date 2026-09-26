import { useState } from 'react';
import type { ShopUpgradeId, ShopUpgradeView, ShopView } from '@ph/core';
import economyJson from '../../../../resources/economy/default.json';
import { act, useEngine } from '../stores/engine.ts';
import { formatNum } from '../stores/format.ts';
import styles from './shop.module.css';

const NAMES: Readonly<Record<string, string>> = Object.fromEntries(economyJson.yakumono.map((y) => [y.id, y.name]));
const BULK = [1, ...economyJson.bulk_sizes] as const;

const pct = (q: number) => `${(q * 100).toFixed(2)}%`;

/** 強化の名前と効果の表示（spec/23 強化の表）。 */
export const UPGRADE_TEXT: Record<ShopUpgradeId, { name: string; effect: (v: number) => string }> = {
  idle: { name: '放置効率', effect: (v) => `背面の生産 ×${v.toFixed(1)}` },
  tank: { name: '燃料タンク', effect: (v) => `上限 ${v}時間` },
  nail: { name: '釘調整', effect: (v) => `外れ玉がヘソへ ${pct(v)}` },
  shorten: { name: '変動短縮', effect: (v) => `変動 ×${v.toFixed(2)}` },
  hold: { name: '保留+1', effect: (v) => `保留 +${v}` },
  auto: { name: 'オート打ち', effect: (v) => (v > 0 ? '解放済み（設定で調整）' : '生産の一部を自動で打つ') },
  tomeuchi: { name: '止め打ち', effect: (v) => (v > 0 ? '保留満タンで止める' : '保留満タンでオート打ちを止める') },
  rate: { name: 'レート解放', effect: (v) => `${v}パチまで` },
};

/** 強化の1行の効果（今 → 次）。 */
export function upgradeEffect(u: ShopUpgradeView): string {
  const t = UPGRADE_TEXT[u.id];
  return u.next === null ? t.effect(u.value) : `${t.effect(u.value)} → ${t.effect(u.next)}`;
}

const report = (e: unknown) => useEngine.setState({ error: e instanceof Error ? e.message : String(e) });

/** 強化画面（spec/40）: 役物（まとめ買い・覚醒）、強化、閉店。 */
export function ShopScreen() {
  const p = useEngine((s) => s.projection);
  const [bulk, setBulk] = useState(0);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  if (p === null || p.shop === undefined) {
    return <p className={styles.note}>読み込み中…</p>;
  }
  const shop: ShopView = p.shop;

  const send = (input: Parameters<typeof act>[0]) => {
    setBusy(true);
    act(input)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const c = shop.close;
  return (
    <div className={styles.screen}>
      <dl className={styles.wallet}>
        <div>
          <dt>持ち玉</dt>
          <dd>{formatNum(p.balls)}</dd>
        </div>
        <div>
          <dt>メダル</dt>
          <dd>{formatNum(p.medals)}</dd>
        </div>
        <div>
          <dt>生産/秒</dt>
          <dd>{formatNum(p.perSec, 1)}</dd>
        </div>
        <div>
          <dt>常連P</dt>
          <dd>{formatNum(shop.regular)}</dd>
        </div>
      </dl>

      <section className={styles.card}>
        <div className={styles.head}>
          <h2>役物</h2>
          <div className={styles.bulk} role="radiogroup" aria-label="まとめ買い">
            {BULK.map((n, i) => (
              <button key={n} role="radio" aria-checked={bulk === i} className={bulk === i ? styles.picked : ''} onClick={() => setBulk(i)}>
                ×{n}
              </button>
            ))}
          </div>
        </div>
        <ul className={styles.list}>
          {shop.yakumono.map((y) => {
            const price = y.prices[bulk] ?? null;
            return (
              <li key={y.id} className={`${styles.item} ${y.locked ? styles.locked : ''}`}>
                <div className={styles.info}>
                  <b>
                    {NAMES[y.id] ?? y.id} <small>Lv{y.lv}</small>
                    {y.awakened > 0 && <small className={styles.awake}> 覚醒{y.awakened}</small>}
                  </b>
                  <small>{y.locked ? '前の役物を Lv1 にすると解放' : `毎秒 ${formatNum(y.perSec, 1)}玉`}</small>
                </div>
                <div className={styles.actions}>
                  {y.awakenReady && (
                    <button
                      className={styles.awakenBtn}
                      disabled={busy || p.medals < y.awakenCost}
                      onClick={() => send({ k: 'awaken', yakumono: y.id })}
                    >
                      覚醒 メダル{y.awakenCost}
                    </button>
                  )}
                  <button
                    className={styles.buy}
                    disabled={busy || y.locked || price === null || p.balls < price}
                    onClick={() => send({ k: 'buy', target: y.id, count: BULK[bulk] ?? 1 })}
                  >
                    ×{BULK[bulk]} {price === null ? '—' : formatNum(price)}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className={styles.note}>覚醒は Lv{economyJson.awaken.min_lv} から。Lv が 0 に戻り、その役物の生産が ×{economyJson.awaken.mult} になります（メダルを使います）。</p>
      </section>

      <section className={styles.card}>
        <h2>強化</h2>
        <ul className={styles.list}>
          {shop.upgrades.map((u) => {
            const have = u.currency === 'medals' ? p.medals : p.balls;
            return (
              <li key={u.id} className={styles.item}>
                <div className={styles.info}>
                  <b>
                    {UPGRADE_TEXT[u.id].name}{' '}
                    <small>
                      {u.stage}/{u.stages}
                    </small>
                  </b>
                  <small>{upgradeEffect(u)}</small>
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.buy}
                    disabled={busy || u.cost === null || have < u.cost}
                    onClick={() => send({ k: 'buy', target: u.id, count: 1 })}
                  >
                    {u.cost === null ? '最大' : u.currency === 'medals' ? `メダル${formatNum(u.cost)}` : formatNum(u.cost)}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.card}>
        <h2>閉店</h2>
        <p className={styles.note}>
          今回の累計玉が {formatNum(c.required)} に届くと閉店できます。閉店すると玉・役物・玉で買った強化が最初に戻り、
          常連P（生産 ×(1+常連P)）を得ます。メダル・燃料・レート・記録は残ります。
        </p>
        <div className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(Math.min(1, c.runTotal / c.required) * 100)}>
          <span style={{ width: `${Math.min(1, c.runTotal / c.required) * 100}%` }} />
        </div>
        <p>
          今回 {formatNum(c.runTotal)} / {formatNum(c.required)}玉 ・ 獲得見込み +{c.gain}P
        </p>
        <p className={styles.note}>
          常連P は「玉由来 {c.byBalls}」と「行動由来 {c.byMedals}（累計メダル {shop.medalsEarned}枚 ÷ {economyJson.close.medals_per_point}）」の小さい方まで（今 {shop.regular}P）。
        </p>
        {c.ready && !closing && (
          <div className={styles.row}>
            <button className={styles.danger} disabled={busy} onClick={() => setClosing(true)}>
              閉店する
            </button>
          </div>
        )}
        {closing && (
          <>
            {c.gain === 0 && (
              <p className={styles.warn}>
                今閉店しても常連P は増えません（{c.byMedals < c.byBalls ? '行動由来が上限です。運動してメダルを貯めてください' : '玉由来が足りません'}）。
              </p>
            )}
            <div className={styles.row}>
              <button
                className={styles.danger}
                disabled={busy}
                onClick={() => {
                  setClosing(false);
                  send({ k: 'close' });
                }}
              >
                閉店を確定（+{c.gain}P）
              </button>
              <button className={styles.sub} disabled={busy} onClick={() => setClosing(false)}>
                やめる
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
