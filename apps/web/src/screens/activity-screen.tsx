import { useCallback, useEffect, useState } from 'react';
import type { CheckinResult, ClaimRecord, OwnPlace } from '@ph/claims';
import { generatePairingKey } from '../platform/shortcut.ts';
import {
  loadLedger,
  loadPlaces,
  loadSettings,
  openStorage,
  putPlace,
  putSetting,
  requestPersist,
  type Db,
  type Settings,
  type StoredSession,
} from '../platform/storage.ts';
import {
  CLAIM_RULES,
  formatFuel,
  localDay,
  planInput,
  planShortcut,
  summarize,
  type ClaimPlan,
} from '../stores/activity.ts';
import { receiveClaims, useEngine } from '../stores/engine.ts';
import { CheckinPanel } from './checkin-panel.tsx';
import { ConfirmModal } from './confirm-modal.tsx';
import { SavePanel } from './save-panel.tsx';
import { ShortcutPanel } from './shortcut-panel.tsx';
import styles from './activity.module.css';

interface Pending {
  readonly plan: ClaimPlan;
  /** true: 確定でチェックインのセッションも閉じる。 */
  readonly closesSession: boolean;
}

/** 行動画面（P4 の最小 UI）: 運動を受け取る・チェックイン・自己申告と、燃料の残り。 */
export function ActivityScreen() {
  const projection = useEngine((s) => s.projection);
  const [db, setDb] = useState<Db | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<ClaimRecord[]>([]);
  const [places, setPlaces] = useState<OwnPlace[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async (d: Db) => {
    const [l, p, s] = await Promise.all([loadLedger(d), loadPlaces(d), loadSettings(d)]);
    setLedger(l);
    setPlaces(p);
    setSettings(s);
  }, []);

  useEffect(() => {
    let alive = true;
    openStorage()
      .then(async (d) => {
        await reload(d);
        if (alive) {
          setDb(d);
        }
        void requestPersist();
      })
      .catch((e: unknown) => setError(`保存領域を開けません: ${e instanceof Error ? e.message : String(e)}`));
    // 経過分の表示と日付の切り替わり用（前面の間だけ）。
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [reload]);

  if (error !== null) {
    return <p className={styles.error}>{error}</p>;
  }
  if (db === null) {
    return <p>読み込み中…</p>;
  }

  const today = localDay(now);
  const sum = summarize(ledger, today);

  const saveSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    await putSetting(db, key, value);
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const onCode = (text: string): string | null => {
    const key = settings.pairingKey;
    if (key === undefined) {
      return '先にショートカット連携を始めてください';
    }
    const r = planShortcut(ledger, text, key, Date.now());
    if (r.k === 'error') {
      return r.message;
    }
    setPending({ plan: r.plan, closesSession: false });
    return null;
  };

  const onFinish = (result: CheckinResult, title: string) => {
    setPending({ plan: planInput(ledger, result, title), closesSession: true });
  };

  const selfReport = () => {
    const at = Date.now();
    const day = localDay(at);
    setPending({ plan: planInput(ledger, { k: 'self', receivedAt: at, today: day, day }, '自己申告（運動した）'), closesSession: false });
  };

  const confirm = async () => {
    if (pending === null) {
      return;
    }
    try {
      await receiveClaims(pending.plan.records, pending.closesSession);
      setReceiveError(null);
    } catch (e) {
      setReceiveError(`受け取れませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
    await reload(db);
    setPending(null);
  };

  const selfToday = ledger.filter((r) => r.kind === 'self' && r.day === today).length;

  return (
    <div className={styles.screen}>
      {receiveError && <p className={styles.error}>{receiveError}</p>}
      <div className={styles.summary}>
        <div>
          <small>燃料の残り</small>
          <b>{projection === null ? '—' : formatFuel(projection.fuelMs)}</b>
          <small>今日 +{formatFuel(sum.todayFuelMs)}</small>
        </div>
        <div>
          <small>メダル</small>
          <b>{projection === null ? '—' : projection.medals}</b>
        </div>
        <div>
          <small>連続日数</small>
          <b>{sum.streak}日</b>
        </div>
      </div>
      <ShortcutPanel
        pairingKey={settings.pairingKey}
        onCreateKey={() => saveSetting('pairingKey', generatePairingKey())}
        onCode={onCode}
      />
      <CheckinPanel
        session={settings.session}
        places={places}
        noticeAck={settings.locationNoticeAck === true}
        now={now}
        onAckNotice={() => saveSetting('locationNoticeAck', true)}
        onSaveSession={(s: StoredSession | undefined) => saveSetting('session', s)}
        onRegister={async (p) => {
          await putPlace(db, p);
          setPlaces((list) => [...list, p]);
        }}
        onFinish={onFinish}
      />
      <section className={styles.card}>
        <h2>自己申告</h2>
        <p className={styles.note}>
          記録の取れない運動をした日に（燃料 +{Math.round(CLAIM_RULES.self.fuelMinPerItem * CLAIM_RULES.trust.self)}分、1日
          {CLAIM_RULES.self.maxPerDay}回まで。今日 {selfToday}回）。
        </p>
        <div className={styles.row}>
          <button className={styles.sub} disabled={selfToday >= CLAIM_RULES.self.maxPerDay} onClick={selfReport}>
            運動した
          </button>
        </div>
      </section>
      <SavePanel lastExportAt={settings.lastExportAt} onImported={() => reload(db)} />
      {pending && <ConfirmModal plan={pending.plan} onConfirm={confirm} onCancel={() => setPending(null)} />}
    </div>
  );
}
