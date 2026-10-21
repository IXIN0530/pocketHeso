import { renderToStaticMarkup } from 'react-dom/server';
import { SAKIBARE_CUSTOMS, SAKIBARE_CUSTOM_RATES } from '@ph/fx';
import { expect, test } from 'vitest';
import { SakibareCustomField, sakibareCustomBadge, sakibareCustomText } from './sakibare-custom.tsx';

test('抽選カスタムの文言: 名前と説明の数字は SAKIBARE_CUSTOM_RATES から出る', () => {
  expect(sakibareCustomText('normal')).toEqual({ name: '通常', desc: '保留の色で決まる先バレ（信頼度 約40%）' });
  expect(sakibareCustomText('sb40')).toEqual({
    name: '先バレ 信頼度40%・占有率 高',
    desc: '先バレした時に当たる割合 40%・当たりのうち先バレする割合 95%。先バレが鳴った保留は必ず変化する（色が上がっても外れることがある）',
  });
  expect(sakibareCustomText('sb90')).toEqual({
    name: '先バレ 信頼度90%・占有率 高',
    desc: '先バレした時に当たる割合 90%・当たりのうち先バレする割合 90%。先バレが鳴った保留は必ず変化する（色が上がっても外れることがある）',
  });
  expect(sakibareCustomText('sb100')).toEqual({
    name: '先バレ 信頼度100%・占有率 中',
    desc: '先バレした時に当たる割合 100%・当たりのうち先バレする割合 60%。先バレが鳴った保留は必ず変化する（色が上がっても外れることがある）',
  });
  expect(SAKIBARE_CUSTOM_RATES.sb100.occ).toBe(0.6);
});

test('ホールの札は通常以外だけ「カスタム 先バレ◯%」', () => {
  expect(sakibareCustomBadge('normal')).toBeNull();
  expect(sakibareCustomBadge('sb40')).toBe('カスタム 先バレ40%');
  expect(sakibareCustomBadge('sb90')).toBe('カスタム 先バレ90%');
  expect(sakibareCustomBadge('sb100')).toBe('カスタム 先バレ100%');
});

test('設定画面の選択欄: ラジオが4つ、選んだ1つだけ checked、各行に説明', () => {
  const html = renderToStaticMarkup(<SakibareCustomField value="sb90" onChange={() => {}} />);
  expect(html.match(/type="radio"/g)?.length).toBe(4);
  expect(html.match(/checked=""/g)?.length).toBe(1);
  expect(html).toMatch(/value="sb90"[^>]*checked=""|checked=""[^>]*value="sb90"/);
  for (const c of SAKIBARE_CUSTOMS) {
    const t = sakibareCustomText(c);
    expect(html).toContain(t.name);
    expect(html).toContain(t.desc);
  }
});
