import { lazy } from 'react';

// スパイクごとに別チャンクにする（本体や他のスパイクのサイズに混ざらないように）。
const ShortcutSpike = lazy(() => import('./shortcut-spike.tsx').then((m) => ({ default: m.ShortcutSpike })));
const GeoSpike = lazy(() => import('./geo-spike.tsx').then((m) => ({ default: m.GeoSpike })));
const PerfSpike = lazy(() => import('./perf-spike.tsx').then((m) => ({ default: m.PerfSpike })));
const ThreeSpike = lazy(() => import('./three-spike.tsx').then((m) => ({ default: m.ThreeSpike })));
const BakeoffSpike = lazy(() => import('./bakeoff-spike.tsx').then((m) => ({ default: m.BakeoffSpike })));

/** `?spike=<name>` で表示するスパイク画面の振り分け（P0 限定）。 */
export default function SpikeRoot({ name }: { name: string }) {
  switch (name) {
    case 'shortcut':
      return <ShortcutSpike />;
    case 'geo':
      return <GeoSpike />;
    case 'perf':
      return <PerfSpike />;
    case 'three':
      return <ThreeSpike />;
    case 'bakeoff':
      return <BakeoffSpike />;
    default:
      return <p>unknown spike: {name}</p>;
  }
}
