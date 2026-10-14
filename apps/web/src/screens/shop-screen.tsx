import { useState } from 'react';
import type { ShopUpgradeId, ShopUpgradeView, ShopView } from '@ph/core';
import economyJson from '../../../../resources/economy/default.json';
import { CountUp } from '../components/count-up.tsx';
import { HoldButton } from '../components/hold-button.tsx';
import { Segmented } from '../components/segmented.tsx';
import { Switch } from '../components/switch.tsx';
import { closeBreakdown, closeExplain, restCloseText } from '../engine/tree-defs.ts';
import { TreeSheet, rankText } from './tree-sheet.tsx';
import { act, useEngine } from '../stores/engine.ts';
import { formatNum } from '../stores/format.ts';
import styles from './shop.module.css';

const NAMES: Readonly<Record<string, string>> = Object.fromEntries(economyJson.yakumono.map((y) => [y.id, y.name]));
const BULK = [1, ...economyJson.bulk_sizes] as const;
const BULK_OPTIONS = BULK.map((n, i) => [i, `×${n}`] as const);

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

const fmtRate = (n: number) => formatNum(n, 1);

/** 強化画面（spec/40）: 役物（まとめ買い・覚醒）、強化、閉店。購入ボタンは長押しで続けて買う。 */
export function ShopScreen() {
  const p = useEngine((s) => s.projection);
  const [bulk, setBulk] = useState(0);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  /** 閉店した直後の獲得（「常連ツリーへ」の案内用）。 */
  const [closedPoints, setClosedPoints] = useState<number | null>(null);

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
  // 購入は HoldButton が1つずつ順に送る（長押しの連続でボタンを無効にしない）。
  const buy = (input: Parameters<typeof act>[0]) => act(input).catch(report);

  /** 閉店を確定し、休業のツリーシートを自動で開く（P12-T3）。 */
  const closeShop = (points: number) => {
    setBusy(true);
    act({ k: 'close' })
      .then(() => {
        setClosedPoints(points);
        setTreeOpen(true);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  const c = shop.close;
  const tree = p.tree;
  const points = tree?.points ?? 0;
  const bd = closeBreakdown(c.gain, c.runTotal, c.points);
  return (
    <div className={styles.screen}>
      <dl className={styles.wallet}>
        <div>
          <dt>持ち玉</dt>
          <dd>
            <CountUp value={p.balls} format={formatNum} />
          </dd>
        </div>
        <div>
          <dt>メダル</dt>
          <dd>{formatNum(p.medals)}</dd>
        </div>
        <div>
          <dt>生産/秒</dt>
          <dd>
            <CountUp value={p.perSec} format={fmtRate} />
          </dd>
        </div>
        <div>
          <dt>常連P</dt>
          <dd>{formatNum(points)}</dd>
        </div>
      </dl>

      <section className={styles.card}>
        <div className={styles.head}>
          <h2>役物</h2>
          <Segmented label="まとめ買い" options={BULK_OPTIONS} value={bulk} onChange={setBulk} />
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
                  <HoldButton
                    className={styles.buy}
                    disabled={busy || y.locked || price === null || p.balls < price}
                    onFire={() => buy({ k: 'buy', target: y.id, count: BULK[bulk] ?? 1 })}
                  >
                    ×{BULK[bulk]} {price === null ? '—' : formatNum(price)}
                  </HoldButton>
                </div>
              </li>
            );
          })}
        </ul>
        <p className={styles.note}>購入ボタンは長押しで続けて買えます。覚醒は Lv{economyJson.awaken.min_lv} から。Lv が 0 に戻り、その役物の生産が ×{economyJson.awaken.mult} になります（メダルを使います）。</p>
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
                  <HoldButton
                    className={styles.buy}
                    disabled={busy || u.cost === null || have < u.cost}
                    onFire={() => buy({ k: 'buy', target: u.id, count: 1 })}
                  >
                    {u.cost === null ? '最大' : u.currency === 'medals' ? `メダル${formatNum(u.cost)}` : formatNum(u.cost)}
                  </HoldButton>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {tree !== undefined && (
        <section className={styles.card}>
          <button type="button" className={styles.treeRow} onClick={() => setTreeOpen(true)}>
            <span>
              <b>常連ツリー</b>
              <small>{rankText(tree)}</small>
            </span>
            <span className={styles.treePoints}>常連P {formatNum(points)} ›</span>
          </button>
          {tree.bantou.owned && (
            <Switch checked={tree.bantou.on} disabled={busy} onChange={(on) => send({ k: 'bantou', on })}>
              番頭さん（役物を自動で買う）
            </Switch>
          )}
        </section>
      )}

      <section className={styles.card}>
        <h2>閉店</h2>
        <p className={styles.note}>
          今回の累計玉が {formatNum(c.required)} に届くと閉店できます。{restCloseText()}。閉店すると玉・役物・玉で買った強化が最初に戻り、
          常連ランクが上がり（生産倍率が増える）常連P を得ます。ランクは使っても減りません。常連P はツリーで使うと減ります。メダル・燃料・レート・記録は残ります。
        </p>
        <div className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(Math.min(1, c.runTotal / c.required) * 100)}>
          <span style={{ width: `${Math.min(1, c.runTotal / c.required) * 100}%` }} />
        </div>
        <p>
          今回 {formatNum(c.runTotal)} / {formatNum(c.required)}玉 ・ 獲得見込み ランク +{c.gain}・常連P +{c.points}
        </p>
        <p className={styles.note}>
          ランクの上がり幅は「玉由来 {c.byBalls}」と「行動由来 {c.byMedals}」の小さい方（今 ランク{shop.regular}）。
        </p>
        <details className={styles.note}>
          <summary>計算のしかた</summary>
          <ul>
            {closeExplain(c, shop.medalsEarned, shop.regular).map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>
              今回の内訳: ランク +{c.gain}＝{bd.rank}P・累計玉の段 +{bd.bonus}・口コミ +{bd.kuchikomi}（常連P +{c.points}）
            </li>
          </ul>
        </details>
        {c.ready && !closing && (
          <div className={styles.row}>
            <button className={styles.danger} disabled={busy} onClick={() => setClosing(true)}>
              閉店する
            </button>
          </div>
        )}
        {closedPoints !== null && !closing && (
          <div className={styles.row}>
            <p className={styles.note}>閉店しました。常連P +{closedPoints}。</p>
            <button className={styles.sub} onClick={() => setTreeOpen(true)}>
              常連ツリーへ
            </button>
          </div>
        )}
        {closing && (
          <>
            <p className={styles.note}>{restCloseText()}。</p>
            {c.gain > 0 && (
              <p className={styles.note}>
                この閉店で 常連P +{c.points}（ランク +{c.gain}＝{bd.rank}P・累計玉の段 +{bd.bonus}・口コミ +{bd.kuchikomi}）
              </p>
            )}
            {c.gain === 0 && (
              <p className={styles.warn}>
                今閉店しても常連ランクも常連P も増えません（{c.byMedals < c.byBalls ? '行動由来が上限です。運動してメダルを貯めてください' : '玉由来が足りません'}）。
              </p>
            )}
            <div className={styles.row}>
              <button
                className={styles.danger}
                disabled={busy}
                onClick={() => {
                  setClosing(false);
                  closeShop(c.points);
                }}
              >
                閉店を確定（常連P +{c.points}）
              </button>
              <button className={styles.sub} disabled={busy} onClick={() => setClosing(false)}>
                やめる
              </button>
            </div>
          </>
        )}
      </section>
      {treeOpen && tree !== undefined && <TreeSheet tree={tree} rest={p.rest} at={p.at} onDismiss={() => setTreeOpen(false)} />}
    </div>
  );
}
