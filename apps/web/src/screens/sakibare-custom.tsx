// 抽選カスタム（先バレの出方, P13-T1）の文言と選択欄。数字は SAKIBARE_CUSTOM_RATES から作る（直書きしない）。
import { SAKIBARE_CUSTOMS, SAKIBARE_CUSTOM_RATES, type SakibareCustom } from '@ph/fx';
import styles from './activity.module.css';

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** 占有率の高低の呼び方（75% 以上を「高」、それ未満を「中」）。 */
const occLabel = (occ: number) => (occ >= 0.75 ? '高' : '中');

/** 選択肢の名前と説明。 */
export function sakibareCustomText(c: SakibareCustom): { name: string; desc: string } {
  if (c === 'normal') return { name: '通常', desc: '保留の色で決まる先バレ（信頼度 約40%）' };
  const { rel, occ } = SAKIBARE_CUSTOM_RATES[c];
  return {
    name: `先バレ 信頼度${pct(rel)}・占有率 ${occLabel(occ)}`,
    desc: `先バレした時に当たる割合 ${pct(rel)}・当たりのうち先バレする割合 ${pct(occ)}。先バレが鳴った保留は必ず変化する（色が上がっても外れることがある）`,
  };
}

/** ホールの状態行の札（通常は出さない）。 */
export function sakibareCustomBadge(c: SakibareCustom): string | null {
  return c === 'normal' ? null : `カスタム 先バレ${pct(SAKIBARE_CUSTOM_RATES[c].rel)}`;
}

/** 設定画面の「抽選カスタム」の4択（縦並びのラジオ）。 */
export function SakibareCustomField({ value, onChange }: { value: SakibareCustom; onChange: (c: SakibareCustom) => void }) {
  return (
    <div role="radiogroup" aria-label="抽選カスタム" className={styles.radios}>
      {SAKIBARE_CUSTOMS.map((c) => {
        const t = sakibareCustomText(c);
        return (
          <label key={c} className={styles.radioRow}>
            <input type="radio" name="sakibare-custom" value={c} checked={value === c} onChange={() => onChange(c)} />
            <span className={styles.radioText}>
              <span>{t.name}</span>
              <span className={styles.radioDesc}>{t.desc}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
