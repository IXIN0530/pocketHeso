import { GeoSpike } from './geo-spike.tsx';
import { PerfSpike } from './perf-spike.tsx';
import { ShortcutSpike } from './shortcut-spike.tsx';

/** `?spike=<name>` で表示するスパイク画面の振り分け（P0 限定）。 */
export default function SpikeRoot({ name }: { name: string }) {
  switch (name) {
    case 'shortcut':
      return <ShortcutSpike />;
    case 'geo':
      return <GeoSpike />;
    case 'perf':
      return <PerfSpike />;
    default:
      return <p>unknown spike: {name}</p>;
  }
}
