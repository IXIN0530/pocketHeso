import { useRef, useState } from 'react';
import {
  accuracyVerdict,
  candidates,
  endSession,
  registerPlace,
  selfCheckin,
  sessionState,
  startSession,
  type Candidate,
  type CheckinResult,
  type Fix,
  type OwnPlace,
} from '@ph/claims';
import { GEO_ERROR_TEXT, getFix } from '../platform/geo.ts';
import type { StoredSession } from '../platform/storage.ts';
import { canQueryYolp, searchYolp, YOLP_CREDIT, yolpAppId } from '../platform/yolp.ts';
import { CLAIM_RULES, localDay, newId } from '../stores/activity.ts';
import styles from './activity.module.css';

type Purpose = 'start' | 'end';

type Phase =
  | { k: 'idle' }
  | { k: 'notice' }
  | { k: 'locating'; purpose: Purpose }
  | { k: 'retry'; purpose: Purpose; attempt: number; accuracyM: number }
  | { k: 'choose'; fix: Fix; list: Candidate[]; yolpCalls: number; yolpState: 'ok' | 'failed' | 'off'; suggest: string }
  | { k: 'register'; fix: Fix; yolpCalls: number; name: string; kind: string }
  | { k: 'short'; minutes: number }
  | { k: 'self'; reason: 'outside' | 'expired' | 'inaccurate'; minutes: string }
  | { k: 'error'; message: string };

const KINDS = ['ジム', '公園', 'プール', 'その他'];

const PRIVACY_TEXT =
  'トレーニングの開始と終了の2回だけ現在地を取ります。現在地の座標は保存しません（「ここを登録」した地点の中心だけ端末に保存）。' +
  '近くの施設を探すため、そのときの座標を Yahoo! JAPAN（LINEヤフー）のローカルサーチに送ります。';

/** トレーニングのチェックイン（spec/32）: 開始と終了の2回だけ前面で位置を取る。 */
export function CheckinPanel({
  session,
  places,
  noticeAck,
  now,
  onAckNotice,
  onSaveSession,
  onRegister,
  onFinish,
}: {
  session: StoredSession | undefined;
  places: readonly OwnPlace[];
  noticeAck: boolean;
  now: number;
  onAckNotice: () => Promise<void>;
  onSaveSession: (s: StoredSession | undefined) => Promise<void>;
  onRegister: (p: OwnPlace) => Promise<void>;
  /** 成立・自己申告の結果を確認画面へ（確定でセッションを閉じる）。 */
  onFinish: (result: CheckinResult, title: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [denied, setDenied] = useState(false);
  // YOLP 施設の名前は保存しない（規約）。この起動の間だけ表示に使う。
  const yolpNames = useRef<Record<string, string>>({});

  const selfMax = CLAIM_RULES.checkin.selfMaxMinutes;

  const locate = async (purpose: Purpose, attempt: number) => {
    setPhase({ k: 'locating', purpose });
    const r = await getFix();
    if (r.k === 'error') {
      if (r.code === 'denied') {
        setDenied(true);
      }
      setPhase({ k: 'error', message: GEO_ERROR_TEXT[r.code] });
      return;
    }
    const verdict = accuracyVerdict(r.fix, attempt);
    if (verdict === 'retry') {
      setPhase({ k: 'retry', purpose, attempt, accuracyM: r.fix.accuracyM });
      return;
    }
    if (verdict === 'give-up') {
      setPhase(
        purpose === 'end'
          ? { k: 'self', reason: 'inaccurate', minutes: String(selfMax) }
          : { k: 'error', message: '位置の精度が低いままです。屋外や窓際で、もう一度「今からトレーニング」を押してください' },
      );
      return;
    }
    await (purpose === 'start' ? afterStartFix(r.fix) : afterEndFix(r.fix));
  };

  const afterStartFix = async (fix: Fix) => {
    const appid = yolpAppId();
    const yolp = appid === null ? null : await searchYolp(fix, appid);
    const list = candidates(fix, places, yolp ?? []);
    for (const c of list) {
      if (c.ref.k === 'yolp') {
        yolpNames.current[c.ref.gid] = c.name;
      }
    }
    setPhase({
      k: 'choose',
      fix,
      list,
      yolpCalls: appid === null ? 0 : 1,
      yolpState: appid === null ? 'off' : yolp === null ? 'failed' : 'ok',
      suggest: list.find((c) => c.ref.k === 'yolp')?.name ?? '',
    });
  };

  const pick = async (c: Candidate, fix: Fix, yolpCalls: number) => {
    const at = Date.now();
    await onSaveSession({ session: startSession(newId(), c, fix, at, localDay(at)), yolpCalls });
    setPhase({ k: 'idle' });
  };

  const register = async (fix: Fix, yolpCalls: number, name: string, kind: string) => {
    const place = registerPlace(newId(), name.trim() === '' ? kind : name.trim(), kind, fix);
    await onRegister(place);
    await pick({ ref: { k: 'own', placeId: place.placeId }, name: place.name, kind, distanceM: 0 }, fix, yolpCalls);
  };

  const afterEndFix = async (fix: Fix) => {
    if (session === undefined) {
      return;
    }
    let yolp = null;
    let yolpCalls = session.yolpCalls;
    const appid = yolpAppId();
    // YOLP 施設は終了時に再問い合わせして判定する（結果は保存しない）。登録地点は問い合わせない。
    if (session.session.place.k === 'yolp' && appid !== null && canQueryYolp(yolpCalls)) {
      yolp = await searchYolp(fix, appid);
      yolpCalls += 1;
      await onSaveSession({ ...session, yolpCalls });
    }
    const at = Date.now();
    const out = endSession(
      { session: session.session, fix, own: places, yolp, now: at, today: localDay(at) },
      CLAIM_RULES,
    );
    if (out.k === 'ok') {
      setPhase({ k: 'idle' });
      onFinish(out.result, 'トレーニング終了');
    } else if (out.k === 'short') {
      setPhase({ k: 'short', minutes: out.minutes });
    } else if (out.k === 'outside') {
      setPhase({ k: 'self', reason: 'outside', minutes: String(Math.min(out.minutes, selfMax)) });
    } else {
      setPhase({ k: 'self', reason: 'expired', minutes: String(selfMax) });
    }
  };

  const submitSelf = (minutes: string) => {
    if (session === undefined) {
      return;
    }
    const at = Date.now();
    const result = selfCheckin(session.session, Number(minutes) || 0, at, localDay(at), CLAIM_RULES);
    if (result === null) {
      setPhase({ k: 'error', message: '0分なので記録しません' });
      return;
    }
    setPhase({ k: 'idle' });
    onFinish(result, 'トレーニング（自己申告）');
  };

  const discard = async () => {
    await onSaveSession(undefined);
    setPhase({ k: 'idle' });
  };

  const start = () => {
    if (!noticeAck) {
      setPhase({ k: 'notice' });
      return;
    }
    void locate('start', 1);
  };

  const placeName = (s: StoredSession): string => {
    const ref = s.session.place;
    return ref.k === 'own'
      ? (places.find((p) => p.placeId === ref.placeId)?.name ?? '登録地点')
      : (yolpNames.current[ref.gid] ?? '近くの施設（Yahoo!）');
  };

  const body = () => {
    switch (phase.k) {
      case 'notice':
        return (
          <>
            <p>{PRIVACY_TEXT}</p>
            <div className={styles.row}>
              <button
                className={styles.button}
                onClick={() => {
                  void onAckNotice().then(() => locate('start', 1));
                }}
              >
                わかった、開始する
              </button>
              <button className={styles.sub} onClick={() => setPhase({ k: 'idle' })}>
                やめる
              </button>
            </div>
          </>
        );
      case 'locating':
        return <p>現在地を取得中…（許可を聞かれたら「許可」）</p>;
      case 'retry':
        return (
          <>
            <p>
              位置の精度が低いです（約 {Math.round(phase.accuracyM)}m）。屋外や窓際に近づいて再取得してください。
            </p>
            <div className={styles.row}>
              <button className={styles.button} onClick={() => void locate(phase.purpose, phase.attempt + 1)}>
                再取得
              </button>
              <button className={styles.sub} onClick={() => setPhase({ k: 'idle' })}>
                やめる
              </button>
            </div>
          </>
        );
      case 'choose':
        return (
          <>
            <p>トレーニングする場所を選んでください。</p>
            {phase.list.length === 0 && <p className={styles.note}>近くに候補がありません。「ここを登録」で地点を登録できます。</p>}
            <ul className={styles.list}>
              {phase.list.map((c) => (
                <li key={c.ref.k === 'own' ? c.ref.placeId : c.ref.gid}>
                  <button className={styles.candidate} onClick={() => void pick(c, phase.fix, phase.yolpCalls)}>
                    {c.name || '(名前なし)'}
                    <small>
                      {c.kind} ・ 約 {Math.round(c.distanceM)}m{c.ref.k === 'own' ? ' ・ 登録地点' : ''}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            {phase.yolpState === 'failed' && <p className={styles.note}>施設の検索に失敗したため、登録地点だけを出しています。</p>}
            {phase.yolpState === 'off' && <p className={styles.note}>施設の検索は未設定です（登録地点だけを出しています）。</p>}
            <div className={styles.row}>
              <button
                className={styles.sub}
                onClick={() => setPhase({ k: 'register', fix: phase.fix, yolpCalls: phase.yolpCalls, name: phase.suggest, kind: 'ジム' })}
              >
                ここを登録
              </button>
              <button className={styles.sub} onClick={() => setPhase({ k: 'idle' })}>
                やめる
              </button>
            </div>
            {phase.yolpState !== 'off' && (
              <p className={styles.credit}>
                <a className={styles.link} href={YOLP_CREDIT.href} target="_blank" rel="noreferrer">
                  {YOLP_CREDIT.text}
                </a>
              </p>
            )}
          </>
        );
      case 'register':
        return (
          <>
            <p>今いる場所を登録します（中心 = 今の位置、半径 80m）。</p>
            <input
              className={styles.input}
              value={phase.name}
              placeholder="名前（例: 近所のジム）"
              onChange={(e) => setPhase({ ...phase, name: e.target.value })}
            />
            <select className={styles.select} value={phase.kind} onChange={(e) => setPhase({ ...phase, kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <div className={styles.row}>
              <button className={styles.button} onClick={() => void register(phase.fix, phase.yolpCalls, phase.name, phase.kind)}>
                登録して開始
              </button>
              <button className={styles.sub} onClick={() => setPhase({ k: 'idle' })}>
                やめる
              </button>
            </div>
          </>
        );
      case 'short':
        return (
          <>
            <p>開始から {phase.minutes} 分です。20分未満は報酬がありません。</p>
            <div className={styles.row}>
              <button className={styles.button} onClick={() => setPhase({ k: 'idle' })}>
                続ける
              </button>
              <button className={styles.sub} onClick={() => void discard()}>
                記録しないで終了
              </button>
            </div>
          </>
        );
      case 'self':
        return (
          <>
            <p>
              {phase.reason === 'outside' && '施設の範囲外で終了しました。'}
              {phase.reason === 'expired' && '開始から3時間たったため、セッションは失効しました。'}
              {phase.reason === 'inaccurate' && '現在地を確かめられないため、施設内か判定できませんでした。'}
              自己申告に切り替えられます（最大 {selfMax} 分・燃料は3割、メダルと連続日数はなし）。
            </p>
            <label>
              運動した時間（分）
              <input
                className={styles.input}
                type="number"
                inputMode="numeric"
                value={phase.minutes}
                onChange={(e) => setPhase({ ...phase, minutes: e.target.value })}
              />
            </label>
            <div className={styles.row}>
              <button className={styles.button} onClick={() => submitSelf(phase.minutes)}>
                自己申告する
              </button>
              <button className={styles.sub} onClick={() => void discard()}>
                記録しないで終了
              </button>
            </div>
          </>
        );
      case 'error':
        return (
          <>
            <p className={styles.error}>{phase.message}</p>
            <div className={styles.row}>
              {session !== undefined && (
                <button className={styles.sub} onClick={() => setPhase({ k: 'self', reason: 'inaccurate', minutes: String(selfMax) })}>
                  自己申告に切り替える
                </button>
              )}
              <button className={styles.sub} onClick={() => setPhase({ k: 'idle' })}>
                閉じる
              </button>
            </div>
          </>
        );
      case 'idle':
        return idle();
    }
  };

  const idle = () => {
    if (session === undefined) {
      return (
        <>
          <div className={styles.row}>
            <button className={styles.button} disabled={denied} onClick={start}>
              今からトレーニング
            </button>
          </div>
          <p className={styles.note}>
            {denied
              ? '位置情報が拒否されたため使えません（アプリを開き直すと再び許可を聞かれます）。下の自己申告は使えます。'
              : 'スマホは置いたままで大丈夫。開始と終了の2回だけ位置を確認します。20分以上で燃料とメダル。'}
          </p>
        </>
      );
    }
    const expired = sessionState(session.session, now) === 'expired';
    const minutes = Math.max(0, Math.floor((now - session.session.startAt) / 60000));
    return (
      <>
        <p>
          {placeName(session)} で{expired ? '開始したセッションは失効しました（3時間）' : ` トレーニング中（${minutes}分）`}
        </p>
        <div className={styles.row}>
          {expired ? (
            <button className={styles.button} onClick={() => setPhase({ k: 'self', reason: 'expired', minutes: String(selfMax) })}>
              終了し忘れを申告
            </button>
          ) : (
            <button className={styles.button} onClick={() => void locate('end', 1)}>
              トレーニング終了
            </button>
          )}
          <button className={styles.sub} onClick={() => void discard()}>
            取り消す
          </button>
        </div>
      </>
    );
  };

  return (
    <section className={styles.card}>
      <h2>トレーニング（チェックイン）</h2>
      {body()}
    </section>
  );
}
