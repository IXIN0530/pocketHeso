import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, resolveLook, sameLook } from './look.ts';

describe('resolveLook', () => {
  it('何も持っていなければ既定', () => {
    expect(resolveLook([], [])).toEqual(DEFAULT_LOOK);
  });
  it('持っているものだけ反映し、使わない設定で外せる', () => {
    const all = ['lamp_gold', 'lcd_sakura', 'cab_chrome', 'gold_ball', 'dendou'];
    expect(resolveLook(all, [])).toEqual({ lamp: 'gold', lcd: 'sakura', cabinet: 'gold', ball: 'gold', title: true });
    expect(resolveLook(all, ['dendou'])).toMatchObject({ cabinet: 'chrome', title: false });
    expect(resolveLook(['gold_ball'], ['gold_ball'])).toEqual(DEFAULT_LOOK);
    expect(resolveLook(['cab_chrome'], [])).toMatchObject({ cabinet: 'chrome' });
  });
  it('same', () => {
    expect(sameLook(DEFAULT_LOOK, resolveLook([], []))).toBe(true);
    expect(sameLook(DEFAULT_LOOK, resolveLook(['gold_ball'], []))).toBe(false);
  });
});
