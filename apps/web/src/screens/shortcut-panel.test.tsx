import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShortcutPanel } from './shortcut-panel.tsx';

const noop = () => {};
const asyncKey = async () => 'abcdefghjkmnpqrs';
const okCode = () => null;

test('準備（shortcutReadyAt なし）は3手順、毎回（あり）は2ボタン＋やり直し', () => {
  const setup = renderToStaticMarkup(
    <ShortcutPanel pairingKey={undefined} shortcutReadyAt={undefined} onEnsureKey={asyncKey} onCode={okCode} onFirstSuccess={noop} onResetReady={noop} />,
  );
  expect(setup).toContain('①');
  expect(setup).toContain('②');
  expect(setup).toContain('③');
  expect(setup).toContain('大量のデータの共有を許可');
  expect(setup).not.toContain('準備をやり直す');

  const daily = renderToStaticMarkup(
    <ShortcutPanel pairingKey="abcdefghjkmnpqrs" shortcutReadyAt={123} onEnsureKey={asyncKey} onCode={okCode} onFirstSuccess={noop} onResetReady={noop} />,
  );
  expect(daily).toContain('運動を受け取る');
  expect(daily).toContain('貼り付けて受け取る');
  expect(daily).toContain('準備をやり直す');
  expect(daily).not.toContain('①');

  for (const html of [setup, daily]) {
    expect(html).toContain('詳細（手作り・旧版のショートカット用）');
  }
});
