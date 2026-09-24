import { ShortcutSpike } from './shortcut-spike.tsx';

/** `?spike=<name>` で表示するスパイク画面の振り分け（P0 限定）。 */
export default function SpikeRoot({ name }: { name: string }) {
  switch (name) {
    case 'shortcut':
      return <ShortcutSpike />;
    default:
      return <p>unknown spike: {name}</p>;
  }
}
