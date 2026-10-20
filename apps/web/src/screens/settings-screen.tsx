import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { CORE_VERSION } from '@ph/core';
import { Segmented } from '../components/segmented.tsx';
import { Switch } from '../components/switch.tsx';
import { isStandalone } from '../platform/pwa.ts';
import { loadSettings, openStorage, type Db } from '../platform/storage.ts';
import { formatFuel } from '../stores/activity.ts';
import { formatNum } from '../stores/format.ts';
import { clock, dbNameFor } from '../stores/clock.ts';
import { act, resetGame, useEngine } from '../stores/engine.ts';
import { setPrefs, usePrefs } from '../stores/prefs.ts';
import { LOOK_KEYS, LOOK_TEXT } from '../board/look.ts';
import { SPIKE_NAMES } from '../spikes/spike-names.ts';
import { SakibareCustomField } from './sakibare-custom.tsx';
import { SavePanel } from './save-panel.tsx';
import { AboutSheet, OnboardingSheet, markOnboarded } from './onboarding-sheet.tsx';
import styles from './activity.module.css';

// 計測ログは正式版には含めない（D-087、lazy import ごと落とす）。
const LogPanel = __DEV_TOOLS__ ? lazy(() => import('./log-panel.tsx').then((m) => ({ default: m.LogPanel }))) : null;

/** オート打ちで選べる割合（発射の枠のうち何割を打つか, spec/22）。 */
export const AUTO_SHARES: readonly (readonly [number, string])[] = [
  [0, '止める'],
  [0.25, '25%'],
  [0.5, '50%'],
  [1, '100%'],
];

const report = (e: unknown) => useEngine.setState({ error: e instanceof Error ? e.message : String(e) });

/** 設定画面（spec/40）: オート打ち・ブースト・演出・セーブ・リセット・計測ログのコピー・アプリの情報。 */
export function SettingsScreen() {
  const p = useEngine((s) => s.projection);
  const prefs = usePrefs();
  const [db, setDb] = useState<Db | null>(null);
  const [lastExportAt, setLastExportAt] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [resetStep, setResetStep] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [guide, setGuide] = useState<'guide' | 'about' | null>(null);

  const reload = useCallback(async (d: Db) => {
    setLastExportAt((await loadSettings(d)).lastExportAt);
  }, []);

  useEffect(() => {
    let opened: Db | null = null;
    openStorage(dbNameFor(clock.scale))
      .then(async (d) => {
        opened = d;
        await reload(d);
        setDb(d);
      })
      .catch(report);
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      opened?.close();
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [reload]);

  const send = (input: Parameters<typeof act>[0]) => {
    setBusy(true);
    act(input)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const autoOwned = (p?.shop?.upgrades.find((u) => u.id === 'auto')?.value ?? 0) > 0;
  const tomeuchi = (p?.shop?.upgrades.find((u) => u.id === 'tomeuchi')?.value ?? 0) > 0;
  const resting = p?.rest !== undefined && p?.rest !== null;
  // 正式版は常に 1（clock.ts）なので Debug の文言は出ない（D-087）。
  const debugDb = __DEV_TOOLS__ && clock.scale !== 1;

  return (
    <div className={styles.screen}>
      {p && (
        <section className={styles.card}>
          <h2>オート打ち</h2>
          {resting && <p className={styles.note}>休業中（開店すると自動で再開します）。割合の変更は開店後も残ります。</p>}
          {autoOwned ? (
            <>
              <p className={styles.note}>
                打たない間も自動で打ちます（燃料が切れると止まります{tomeuchi ? '。保留が満タンの間は止め打ち' : ''}）。
              </p>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>割合</span>
                <Segmented label="オート打ちの割合" options={AUTO_SHARES} value={p.auto.share} onChange={(share) => send({ k: 'auto', share, rate: p.auto.rate })} />
              </div>
              {p.rates.length > 1 && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>レート（パチ）</span>
                  <Segmented
                    label="オート打ちのレート"
                    dense
                    options={p.rates.map((r) => [r, String(r)] as const)}
                    value={p.auto.rate}
                    onChange={(rate) => send({ k: 'auto', share: p.auto.share, rate })}
                  />
                  <p className={styles.note}>
                    1発 {formatNum(p.rateCosts[p.rates.indexOf(p.auto.rate)] ?? p.auto.rate)}玉（生産{p.shotS}秒 × {p.auto.rate}パチ）
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className={styles.note}>強化タブの「オート打ち」を買うと使えます。</p>
          )}
        </section>
      )}
      {p?.shop && (
        <section className={styles.card}>
          <h2>ブースト</h2>
          <p className={styles.note}>
            燃料タンクから溢れた分がブーストになり、前面にいる間の生産が ×2 になります（残り {formatFuel(p.boostMs)}）。
          </p>
          <Switch checked={p.shop.boostOn} disabled={busy} onChange={(on) => send({ k: 'boost', on })}>
            ブーストを使う
          </Switch>
        </section>
      )}
      <section className={styles.card}>
        <h2>演出と操作</h2>
        <Switch checked={prefs.bloom} onChange={(bloom) => setPrefs({ bloom })}>
          当たりの光のにじみ（OFF で軽くなります）
        </Switch>
        <Switch checked={prefs.haptics} onChange={(haptics) => setPrefs({ haptics })}>
          操作の触覚（ボタン・タブ・長押しの購入）
        </Switch>
        <label>
          音量 {prefs.volume}
          <input className={styles.input} type="range" min={0} max={100} step={10} value={prefs.volume} onChange={(e) => setPrefs({ volume: Number(e.target.value) })} />
        </label>
        <p className={styles.note}>最初に画面をタップした後から鳴ります。消音スイッチが入っていると鳴らないことがあります。</p>
      </section>
      <section className={styles.card}>
        <h2>抽選カスタム</h2>
        <p className={styles.note}>先バレ（保留が光って先に知らせる演出）の出方を選べます。当たりやすさは変わりません。</p>
        <SakibareCustomField value={prefs.sakibareCustom} onChange={(sakibareCustom) => setPrefs({ sakibareCustom })} />
        <p className={styles.note}>変更は次に入った保留から効きます</p>
      </section>
      <section className={styles.card}>
        <h2>見た目</h2>
        <p className={styles.note}>常連ツリーで開けた見た目を選べます（この端末だけの設定です）。</p>
        {LOOK_KEYS.map((k) => {
          const owned = p?.tree?.unlocks.includes(k) === true;
          return owned ? (
            <Switch
              key={k}
              checked={!prefs.looksOff.includes(k)}
              onChange={(on) => setPrefs({ looksOff: on ? prefs.looksOff.filter((x) => x !== k) : [...prefs.looksOff, k] })}
            >
              {LOOK_TEXT[k].name}（{LOOK_TEXT[k].desc}）
            </Switch>
          ) : (
            <p key={k} className={styles.note}>
              {LOOK_TEXT[k].name}: 常連ツリーで開けると選べます
            </p>
          );
        })}
      </section>
      <section className={styles.card}>
        <h2>連携と登録地点</h2>
        <p className={styles.note}>ショートカット連携（ペアリング鍵）とトレーニングの登録地点は行動タブにあります。</p>
      </section>
      {db && <SavePanel lastExportAt={lastExportAt} onImported={() => reload(db)} />}
      <section className={styles.card}>
        <h2>リセット{debugDb && '（Debug のデータ）'}</h2>
        <p className={styles.note}>
          {debugDb ? 'Debug の時間倍率用のデータだけを消します。' : '玉・役物・行動の記録・設定をすべて消して最初から始めます。先にセーブを書き出しておくと戻せます。'}
        </p>
        <div className={styles.row}>
          {resetStep === 0 && (
            <button className={styles.sub} onClick={() => setResetStep(1)}>
              リセット…
            </button>
          )}
          {resetStep === 1 && (
            <>
              <button className={styles.danger} onClick={() => void resetGame().catch(report)}>
                すべて消す
              </button>
              <button className={styles.sub} onClick={() => setResetStep(0)}>
                やめる
              </button>
            </>
          )}
        </div>
      </section>
      {__DEV_TOOLS__ && LogPanel && (
        <Suspense>
          <LogPanel />
        </Suspense>
      )}
      <section className={styles.card}>
        <h2>アプリ</h2>
        <div className={styles.row}>
          <button className={styles.sub} onClick={() => setGuide('guide')}>
            はじめての案内をもう一度
          </button>
          <button className={styles.sub} onClick={() => setGuide('about')}>
            このアプリについて
          </button>
        </div>
        {guide === 'guide' && (
          <OnboardingSheet
            standalone={isStandalone()}
            onDone={() => {
              setGuide(null);
              markOnboarded().catch(report);
            }}
          />
        )}
        {guide === 'about' && <AboutSheet onDismiss={() => setGuide(null)} />}
        <dl className={styles.facts}>
          <dt>起動方法</dt>
          <dd>{isStandalone() ? 'ホーム画面（standalone）' : 'ブラウザ'}</dd>
          <dt>通信</dt>
          <dd>{online ? 'オンライン' : 'オフライン'}</dd>
          <dt>バージョン</dt>
          <dd>v{__APP_VERSION__}</dd>
          {__DEV_TOOLS__ && (
            <>
              <dt>Core</dt>
              <dd>v{CORE_VERSION}</dd>
            </>
          )}
        </dl>
        {__DEV_TOOLS__ && (
          <ul className={styles.list}>
            {SPIKE_NAMES.map((name) => (
              <li key={name}>
                <a className={styles.link} href={`/?spike=${name}`}>
                  spike: {name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
