import { useEffect, useState } from 'react';
import { Sheet } from '../components/sheet.tsx';
import { YOLP_CREDIT } from '../platform/yolp.ts';
import { loadSettings, openStorage, putSetting } from '../platform/storage.ts';
import { clock, dbNameFor } from '../stores/clock.ts';
import styles from './activity.module.css';

/** ソース（設定の「このアプリについて」・案内に載せる）。 */
export const REPO_URL = 'https://github.com/IXIN0530/pocketHeso';

/**
 * 案内を出すか（P8-T4）: `onboardedAt` が無く、台帳も操作の記録も無い新規だけ。
 * 既存のセーブ（玉や記録がある＝受け取りや操作が残っている）では出さない。
 */
export function shouldShowOnboarding(onboardedAt: number | undefined, hasSave: boolean): boolean {
  return onboardedAt === undefined && !hasSave;
}

/** 台帳か操作の記録が1件でもあれば既存のセーブ。 */
export function hasSaveData(claimKeys: readonly unknown[], actionKeys: readonly unknown[]): boolean {
  return claimKeys.length > 0 || actionKeys.length > 0;
}

export function stepsFor(standalone: boolean): readonly (readonly [string, string])[] {
  const steps: (readonly [string, string])[] = [
    ['良い行動で玉を増やすゲーム', '良い行動（運動・トレーニング）で燃料（営業時間）がもらえます。燃料がある間、役物が回って玉が増えます。玉で役物を強化して、パチンコを打ちます。'],
  ];
  if (!standalone) {
    steps.push([
      'ホーム画面に追加',
      'Safari の共有ボタンから「ホーム画面に追加」で追加できます。ブラウザのタブとホーム画面では保存場所が別なので、どちらか一方で遊んでください。',
    ]);
  }
  steps.push([
    '行動の受け取り方',
    '行動タブで受け取ります。「運動を受け取る」（ショートカット連携）か「トレーニングのチェックイン」です。行動と位置のデータは端末の外に送りません。',
  ]);
  return steps;
}

/** はじめての案内（P8-T4）: 3枚（ホーム画面の手順はブラウザ起動の時だけ）、スキップ可。 */
export function OnboardingSheet({ standalone, onDone }: { standalone: boolean; onDone: () => void }) {
  const steps = stepsFor(standalone);
  const [page, setPage] = useState(0);
  const last = page >= steps.length - 1;
  const [title, body] = steps[page] ?? steps[0]!;
  return (
    <Sheet onDismiss={onDone} labelledBy="onboarding-title">
      <p className={styles.note}>
        はじめての案内（{page + 1} / {steps.length}）
      </p>
      <h2 id="onboarding-title">{title}</h2>
      <p>{body}</p>
      <div className={styles.row}>
        {!last && (
          <button className={styles.button} onClick={() => setPage(page + 1)}>
            次へ
          </button>
        )}
        {last && (
          <button className={styles.button} onClick={onDone}>
            はじめる
          </button>
        )}
        {page > 0 && (
          <button className={styles.sub} onClick={() => setPage(page - 1)}>
            戻る
          </button>
        )}
        <button className={styles.sub} onClick={onDone}>
          スキップ
        </button>
      </div>
    </Sheet>
  );
}

/** このアプリについて（P8-T4）: プライバシー・クレジット・セーブ・ソースとライセンス。 */
export function AboutSheet({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Sheet onDismiss={onDismiss} labelledBy="about-title">
      <h2 id="about-title">このアプリについて</h2>
      <p>行動と位置のデータは端末の外に送りません。施設を探す時だけ、現在地の座標を Yahoo! に送って施設の一覧をもらいます。</p>
      <p className={styles.note}>
        施設情報: <a className={styles.link} href={YOLP_CREDIT.href}>{YOLP_CREDIT.text}</a>
      </p>
      <p>セーブはこの端末の中だけにあります。機種変更や故障に備えて、設定のセーブから書き出しておいてください。</p>
      <p className={styles.note}>
        ソース: <a className={styles.link} href={REPO_URL}>{REPO_URL}</a>
        （ライセンスは正式公開までに決めます）
      </p>
      <div className={styles.row}>
        <button className={styles.button} onClick={onDismiss}>
          閉じる
        </button>
      </div>
    </Sheet>
  );
}

async function readOnboardingNeeded(): Promise<boolean> {
  const db = await openStorage(dbNameFor(clock.scale));
  try {
    const [settings, claimKeys, actionKeys] = await Promise.all([
      loadSettings(db),
      db.getAllKeys('claims', undefined, 1),
      db.getAllKeys('actions', undefined, 1),
    ]);
    return shouldShowOnboarding(settings.onboardedAt, hasSaveData(claimKeys, actionKeys));
  } finally {
    db.close();
  }
}

export async function markOnboarded(): Promise<void> {  const db = await openStorage(dbNameFor(clock.scale));
  try {
    await putSetting(db, 'onboardedAt', clock.now());
  } finally {
    db.close();
  }
}

/**
 * 初回起動の案内の出し分け（App に置く）。新規だけ出して、閉じたら `onboardedAt` を保存する。
 * 既存のセーブでは出さない。保存に失敗しても案内を閉じるだけにする。
 */
export function OnboardingGate({ standalone }: { standalone: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    readOnboardingNeeded()
      .then((needed) => {
        if (alive && needed) setShow(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!show) {
    return null;
  }
  const done = () => {
    setShow(false);
    markOnboarded().catch(() => {});
  };
  return <OnboardingSheet standalone={standalone} onDone={done} />;
}
