import { Suspense, lazy, useState } from 'react';
import type { HallProjection, NoticeEffect } from '@ph/core';
import { formatFuel } from '../stores/activity.ts';
import { act, useEngine } from '../stores/engine.ts';
import { formatNum } from '../stores/format.ts';
import styles from './hall.module.css';

// Three.js 一式は盤面と一緒に別チャンクで読む（最初の表示を待たせない）。
const BoardCanvas = lazy(() => import('../board/board-canvas.tsx'));


/** 抽選モードの表示（spec/21 モード拡張）。 */
export function modeLabel(p: Pick<HallProjection, 'mode' | 'stRemaining'>): string {
  switch (p.mode) {
    case 'normal':
      return '通常';
    case 'jitan':
      return `時短 残り${p.stRemaining}回`;
    case 'st':
      return `RUSH 残り${p.stRemaining}回`;
    case 'lt':
      return `LT 残り${p.stRemaining}回`;
  }
}

/** 予告の種類（spec/23: fever=生産×7・rush=即時出玉・bonus=特別変動）。見た目は赤保留・キリン柄・金保留（spec/23, P6-T2）。 */
export const NOTICE_TEXT: Record<NoticeEffect, { title: string; body: string }> = {
  fever: { title: 'フィーバー予告', body: 'タップで生産 ×7' },
  rush: { title: 'ラッシュ予告', body: 'タップで出玉' },
  bonus: { title: 'ボーナス予告', body: 'タップで特別変動' },
};

const report = (e: unknown) => useEngine.setState({ error: e instanceof Error ? e.message : String(e) });

/**
 * ホール（spec/40 メイン画面の最小版）: 盤面＋液晶（保留・変動は盤面の中）、HUD、打つトグルとレート選択、予告。
 * 演出は P6 で差し替える。active=false（別タブ表示中）は盤面の描画を止める。
 */
export function HallScreen({ active = true }: { active?: boolean }) {
  const projection = useEngine((s) => s.projection);
  const [busy, setBusy] = useState(false);
  const [tapped, setTapped] = useState(-1);

  const send = (input: Parameters<typeof act>[0]) => {
    setBusy(true);
    act(input)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const p = projection;
  const notice = p?.notice && p.notice.expiresAt > p.at && p.notice.id !== tapped ? p.notice : null;

  return (
    <section className={styles.hall}>
      <div className={styles.board}>
        <Suspense>
          <BoardCanvas active={active} />
        </Suspense>
        {notice && (
          <button
            className={`${styles.notice} ${styles[notice.effect]}`}
            onClick={() => {
              setTapped(notice.id);
              send({ k: 'noticeTap', noticeId: notice.id });
            }}
          >
            <span className={styles.noticeIcon} aria-hidden="true" />
            <span className={styles.noticeText}>
              <b>{NOTICE_TEXT[notice.effect].title}</b>
              <span>
                {NOTICE_TEXT[notice.effect].body}（残り{Math.ceil((notice.expiresAt - p!.at) / 1000)}秒）
              </span>
            </span>
          </button>
        )}
      </div>
      {p && (
        <>
          <dl className={styles.hud}>
            <div>
              <dt>持ち玉</dt>
              <dd>{formatNum(p.balls)}</dd>
            </div>
            <div>
              <dt>メダル</dt>
              <dd>{formatNum(p.medals)}</dd>
            </div>
            <div>
              <dt>燃料</dt>
              <dd>{p.fuelMs > 0 ? formatFuel(p.fuelMs) : '切れ'}</dd>
            </div>
            <div>
              <dt>生産/秒</dt>
              <dd>{formatNum(p.perSec, 1)}</dd>
            </div>
          </dl>
          <p className={styles.state}>
            <span>{modeLabel(p)}</span>
            <span>回転 {formatNum(p.totals.spins)}</span>
            <span>大当たり {formatNum(p.totals.jackpots)}</span>
            {p.jackpot && (
              <span className={styles.hot}>
                大当たり中 {p.jackpot.rounds}R{p.chain > 1 ? `・${p.chain}連` : ''}
              </span>
            )}
          </p>
          <div className={styles.controls}>
            <button
              className={`${styles.shoot} ${p.shoot.on ? styles.on : ''}`}
              aria-pressed={p.shoot.on}
              disabled={busy}
              onClick={() => send({ k: 'shoot', on: !p.shoot.on, rate: p.shoot.rate })}
            >
              {p.shoot.on ? '打っています — 止める' : '打つ'}
            </button>
            {p.rates.length > 1 && (
              <div className={styles.rates} role="radiogroup" aria-label="レート">
                {p.rates.map((r) => (
                  <button
                    key={r}
                    role="radio"
                    aria-checked={r === p.shoot.rate}
                    className={r === p.shoot.rate ? styles.picked : ''}
                    disabled={busy}
                    onClick={() => send({ k: 'shoot', on: p.shoot.on, rate: r })}
                  >
                    {r}パチ
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
