// 常連ツリーの「見た目の解放」(spec/25)。所持している unlock の key と、端末の「使わない」設定から描画のパラメータを決める。
// 新しい素材は使わず、既存の描画（筐体の配色・LED・玉・液晶の背景・称号）の値を差し替えるだけ。

/** 見た目の解放の key（resources の tree.nodes の `unlock`）。 */
export const LOOK_KEYS = ['lamp_gold', 'lcd_sakura', 'cab_chrome', 'gold_ball', 'dendou'] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

export const LOOK_TEXT: Record<LookKey, { name: string; desc: string }> = {
  lamp_gold: { name: '金のランプ', desc: '筐体の LED が金色になります' },
  lcd_sakura: { name: '液晶「夜桜」', desc: '液晶の背景が夜桜になります' },
  cab_chrome: { name: 'クロームの筐体', desc: '筐体がクロームになります' },
  gold_ball: { name: '金の玉', desc: '盤面の玉が金色になります' },
  dendou: { name: '殿堂入り', desc: '金の筐体と液晶の隅の称号（クロームより優先）' },
};

export interface Look {
  readonly lamp: 'ice' | 'gold';
  readonly lcd: 'night' | 'sakura';
  readonly cabinet: 'violet' | 'chrome' | 'gold';
  readonly ball: 'steel' | 'gold';
  /** 液晶の隅の称号「殿堂入り」。 */
  readonly title: boolean;
}

export const DEFAULT_LOOK: Look = { lamp: 'ice', lcd: 'night', cabinet: 'violet', ball: 'steel', title: false };

/** 所持（unlocks）のうち「使わない」（off）にしていないものを反映する。 */
export function resolveLook(unlocks: readonly string[], off: readonly string[]): Look {
  const on = (k: LookKey) => unlocks.includes(k) && !off.includes(k);
  return {
    lamp: on('lamp_gold') ? 'gold' : 'ice',
    lcd: on('lcd_sakura') ? 'sakura' : 'night',
    cabinet: on('dendou') ? 'gold' : on('cab_chrome') ? 'chrome' : 'violet',
    ball: on('gold_ball') ? 'gold' : 'steel',
    title: on('dendou'),
  };
}

export const sameLook = (a: Look, b: Look): boolean =>
  a.lamp === b.lamp && a.lcd === b.lcd && a.cabinet === b.cabinet && a.ball === b.ball && a.title === b.title;
