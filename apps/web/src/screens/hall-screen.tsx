import { Suspense, lazy, useEffect, useState } from 'react';
import type { HallProjection, NoticeEffect } from '@ph/core';
import { CountUp } from '../components/count-up.tsx';
import { Segmented } from '../components/segmented.tsx';
import { ACHIEVEMENTS } from '../engine/achievement-defs.ts';
import { machineInfo } from '../engine/machine-info.ts';
import { openBoostMult } from '../engine/tree-defs.ts';
import { playToastCue } from '../fx/fx-host.ts';
import { tick } from '../platform/haptic.ts';
import { formatFuel } from '../stores/activity.ts';
import { achievedIds, achievedToast } from '../stores/achievements.ts';
import { act, onView, useEngine } from '../stores/engine.ts';
import { formatClock, formatNum, formatTime } from '../stores/format.ts';
import { usePrefs } from '../stores/prefs.ts';
import { shownHall, useLcdView } from '../stores/lcd-view.ts';
import { PREVIEW_TAIL_MS, usePreview } from '../stores/preview.ts';
import { sakibareCustomBadge } from './sakibare-custom.tsx';
import styles from './hall.module.css';

// Three.js 一式は盤面と一緒に別チャンクで読む（最初の表示を待たせない）。
const BoardCanvas = lazy(() => import('../board/board-canvas.tsx'));


/** 台が変わった時（開店で切り替え）に、店名・台名を2秒ほど出す（P14-T2）。 */
function MachineToast({ machineId }: { machineId: string | undefined }) {
  const [shown, setShown] = useState<string | null>(null);
  const [prev, setPrev] = useState(machineId);
  if (machineId !== prev) {
    setPrev(machineId);
    if (prev !== undefined && machineId !== undefined) setShown(machineId);
  }
  useEffect(() => {
    if (shown === null) return;
    const id = setTimeout(() => setShown(null), 2000);
    return () => clearTimeout(id);
  }, [shown]);
  const m = shown === null ? null : machineInfo(shown);
  if (m === null) return null;
  return (
    <p className={styles.machineToast} role="status">
      {m.shop} {m.name}
    </p>
  );
}

/** 抽選モードの表示（spec/21 モード拡張）。 */
export function modeLabel(p: { mode: HallProjection['mode']; stRemaining: number | null }): string {
  const n = p.stRemaining === null ? '' : `残り${p.stRemaining}回`;
  switch (p.mode) {
    case 'normal':
      return '通常';
    case 'jitan':
      return p.stRemaining === null ? '時短' : `時短 ${n}`;
    case 'st':
      return p.stRemaining === null ? 'RUSH' : `RUSH ${n}`;
    case 'lt':
      return p.stRemaining === null ? 'LT' : `LT ${n}`;
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
    let unwait: (() => void) | undefined;
    const show = (text: string) => {
      key += 1;
      setToast({ text, key });
      playToastCue('achieved', useEngine.getState().seed, key);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), TOAST_MS);
    };
    const off = onView((_, events) => {
      const text = achievedToast(achievedIds(events), ACHIEVEMENTS);
      if (text === null) return;
      // 液晶がまだ大当たりを映していない間は結果を先に明かさない（P13-T4）。映したら出す。
      const pending = (v: { pendingJackpots: number } | null) => v !== null && v.pendingJackpots > 0;
      if (!pending(useLcdView.getState().view)) {
        show(text);
        return;
      }
      unwait?.();
      unwait = useLcdView.subscribe((st) => {
        if (pending(st.view)) return;
        unwait?.();
        unwait = undefined;
        show(text);
      });
    });
    return () => {
      off();
      unwait?.();
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
  const lcdView = useLcdView((s) => s.view);
  const customBadge = sakibareCustomBadge(usePrefs((s) => s.sakibareCustom));
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
  const shown = p ? shownHall(p, lcdView) : null;
  const resting = p?.rest !== undefined && p?.rest !== null;

  return (
    <section className={styles.hall}>
      <div className={`${styles.board} ${resting ? styles.resting : ''}`}>
        <Suspense>
          <BoardCanvas active={active} />
        </Suspense>
        <ReplayBadge />
        <AchievedToast />
        {resting && (
          <div className={styles.closed} role="status">
            本日閉店
          </div>
        )}
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
                <CountUp value={shown!.balls} format={formatNum} />
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
          <MachineToast machineId={p.machineId} />
          <p className={styles.state}>
            {machineInfo(p.machineId) !== null && <span className={styles.shopName}>{machineInfo(p.machineId)?.shop}</span>}
            <span>{resting ? '本日閉店（休業中）' : modeLabel(shown!)}</span>
            <span>回転 {formatNum(p.totals.spins)}</span>
            <span>大当たり {formatNum(shown!.jackpots)}</span>
            {resting && <span className={styles.stock}>オート打ち 休業中</span>}
            {p.tree !== undefined && p.tree.openBoostMs > 0 && (
              <span className={styles.stock}>
                開店 ×{openBoostMult(p.tree.nodes)} 残り {formatClock(p.tree.openBoostMs)}
              </span>
            )}
            {customBadge !== null && <span className={styles.custom}>{customBadge}</span>}
            {p.bonusStock > 0 && <span className={styles.stock}>特別保留 ×{p.bonusStock}（待機）</span>}
            {shown!.jackpot && (
              <span className={styles.hot}>
                大当たり中 {shown!.jackpot.rounds}R{shown!.chain > 1 ? `・${shown!.chain}連` : ''}
              </span>
            )}
          </p>
          <div className={styles.controls}>
            <button
              className={`${styles.shoot} ${p.shoot.on ? styles.on : ''}`}
              aria-pressed={p.shoot.on}
              disabled={busy || resting}
              onClick={() => {
                tick();
                send({ k: 'shoot', on: !p.shoot.on, rate: p.shoot.rate });
              }}
            >
              {resting ? '休業中' : p.shoot.on ? '打っています — 止める' : '打つ'}
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
