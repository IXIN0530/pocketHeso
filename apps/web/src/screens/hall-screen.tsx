import { Suspense, lazy, useEffect, useState } from 'react';
import type { HallProjection, NoticeEffect } from '@ph/core';
import { CountUp } from '../components/count-up.tsx';
import { Segmented } from '../components/segmented.tsx';
import { ACHIEVEMENTS } from '../engine/achievement-defs.ts';
import { playToastCue } from '../fx/fx-host.ts';
import { tick } from '../platform/haptic.ts';
import { formatFuel } from '../stores/activity.ts';
import { achievedIds, achievedToast } from '../stores/achievements.ts';
import { act, onView, useEngine } from '../stores/engine.ts';
import { formatNum, formatTime } from '../stores/format.ts';
import { PREVIEW_TAIL_MS, usePreview } from '../stores/preview.ts';
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

const fmtRate = (n: number) => formatNum(n, 1);

const report = (e: unknown) => useEngine.setState({ error: e instanceof Error ? e.message : String(e) });

/** 留守中リプレイの間だけ「リプレイ」の札を出す（盤面は Engine の液晶を止めてリプレイを流している）。 */
function ReplayBadge() {
  const request = usePreview((s) => s.request);
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (request?.replayAt === undefined) {
      setLabel(null);
      return;
    }
    setLabel(`リプレイ ${formatTime(request.replayAt, Date.now())} の当たり`);
    const id = setTimeout(() => setLabel(null), (request.durationMs ?? 0) + PREVIEW_TAIL_MS);
    return () => clearTimeout(id);
  }, [request]);
  return label && <div className={styles.replay}>{label}</div>;
}

/** トーストを出しておく時間（spec/24）。 */
export const TOAST_MS = 2500;

/** 実績を達成した前進ごとにトーストを1つ出す（同じ前進の複数は1つにまとめる, spec/24）。 */
function AchievedToast() {
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let key = 0;
    const off = onView((_, events) => {
      const text = achievedToast(achievedIds(events), ACHIEVEMENTS);
      if (text === null) return;
      key += 1;
      setToast({ text, key });
      playToastCue('achieved', useEngine.getState().seed, key);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), TOAST_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  return (
    toast && (
      <div key={toast.key} className={styles.toast} role="status">
        {toast.text}
      </div>
    )
  );
}

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
        <ReplayBadge />
        <AchievedToast />
        {notice && (
          <button
            className={`${styles.notice} ${styles[notice.effect]}`}
            onClick={() => {
              tick();
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
              <dd>
                <CountUp value={p.balls} format={formatNum} />
              </dd>
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
              <dd>
                <CountUp value={p.perSec} format={fmtRate} />
              </dd>
            </div>
          </dl>
          <p className={styles.state}>
            <span>{modeLabel(p)}</span>
            <span>回転 {formatNum(p.totals.spins)}</span>
            <span>大当たり {formatNum(p.totals.jackpots)}</span>
            {p.bonusStock > 0 && <span className={styles.stock}>特別保留 ×{p.bonusStock}（待機）</span>}
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
              onClick={() => {
                tick();
                send({ k: 'shoot', on: !p.shoot.on, rate: p.shoot.rate });
              }}
            >
              {p.shoot.on ? '打っています — 止める' : '打つ'}
            </button>
            {p.rates.length > 1 && (
              <div className={styles.rate}>
                <span className={styles.rateLabel}>レート（パチ）</span>
                <Segmented
                  label="レート（パチ）"
                  dense
                  options={p.rates.map((r) => [r, String(r)] as const)}
                  value={p.shoot.rate}
                  onChange={(r) => send({ k: 'shoot', on: p.shoot.on, rate: r })}
                />
              </div>
            )}
            <p className={styles.state}>1発 {formatNum(p.rateCosts[p.rates.indexOf(p.shoot.rate)] ?? p.shoot.rate)}玉（生産{p.shotS}秒 × {p.shoot.rate}パチ）</p>
          </div>
        </>
      )}
    </section>
  );
}
