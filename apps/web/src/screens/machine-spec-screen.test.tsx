import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MachineSpecScreen, slicePath } from './machine-spec-screen.tsx';

const noop = () => {};

test('3台のタブが出る・初期表示は今の台', () => {
  const html = renderToStaticMarkup(<MachineSpecScreen current="rush-middle-01" open={['light-middle-01', 'rush-middle-01']} onBack={noop} />);
  for (const shop of ['駅前店', '国道店', '港町店']) expect(html).toContain(shop);
  expect(html).toContain('ラッシュミドル');
  expect(html).not.toContain('未開放');
  expect(html).toContain('ゲームフロー');
  expect(html).toContain('基本性能');
  expect(html).toContain('ヘソ（通常時）');
  expect(html).toContain('<svg');
});

test('未開放の台は「未開放」の札つきで見られる', () => {
  const html = renderToStaticMarkup(<MachineSpecScreen current="lt-middle-01" open={['light-middle-01']} onBack={noop} />);
  expect(html).toContain('未開放');
  expect(html).toContain('LT ミドル');
  expect(html).toContain('LT');
});

test('今の台が不明なら駅前店、最初の台は常に開放扱い', () => {
  const html = renderToStaticMarkup(<MachineSpecScreen current="" open={[]} onBack={noop} />);
  expect(html).toContain('ライトミドル');
  expect(html).not.toContain('未開放');
});

test('ダークで読める: 色はアプリの暗い地に合う固定色で、白地を使わない', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('./machine-spec-screen.module.css', import.meta.url), 'utf8');
  expect(css).toContain('background: #1c2145');
  expect(css).not.toMatch(/background:\s*(#fff\b|#ffffff|white)/i);
});

test('slicePath: 全周は円、半周は large-arc 0', () => {
  expect(slicePath(0, 1, 10)).toContain('A10 10 0 1 1');
  expect(slicePath(0, 0.25, 10)).toContain('A10 10 0 0 1 10.00');
});
