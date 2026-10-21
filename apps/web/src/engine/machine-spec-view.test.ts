import { expect, test } from 'vitest';
import { machineSpec } from './game-config.ts';
import { groupDigits, hitWithin, largestRemainder, machineSpecView, type MachineSpecView } from './machine-spec-view.ts';

function view(id: string): MachineSpecView {
  const spec = machineSpec(id);
  if (spec === null) throw new Error(id);
  return machineSpecView(spec);
}

/** 扇を「10R 1,500個 → RUSH 100回 50%」の1行に（数値をまとめて見るため）。 */
function pieLines(v: MachineSpecView): string[] {
  return v.pies.flatMap((p) => [p.title, ...p.slices.map((s) => `  ${s.roundsLabel} ${s.ballsLabel} → ${s.nextLabel} ${s.percent}%`)]);
}

function edgeLines(v: MachineSpecView): string[] {
  return v.edges.map((e) => `${e.from}→${e.to} ${e.kind === 'end' ? '回数切れ' : `${e.percent}%`}`);
}

test('largestRemainder: 合計 100・剰余の大きい順、同じなら先の添字', () => {
  expect(largestRemainder([1, 1, 1])).toEqual([34, 33, 33]);
  expect(largestRemainder([60, 25, 10, 5])).toEqual([60, 25, 10, 5]);
  expect(largestRemainder([0, 0])).toEqual([0, 0]);
  expect(largestRemainder([2, 1]).reduce((a, b) => a + b, 0)).toBe(100);
});

test('hitWithin・groupDigits', () => {
  expect(hitWithin(39.9, 0)).toBe(0);
  expect(hitWithin(2, 1)).toBeCloseTo(0.5, 10);
  expect(groupDigits(1500)).toBe('1,500');
  expect(groupDigits(9000)).toBe('9,000');
  expect(groupDigits(450)).toBe('450');
});

test('駅前店 light-middle-01', () => {
  const v = view('light-middle-01');
  expect(pieLines(v)).toEqual([
    'ヘソ（通常時）',
    '  10R 1,500個 → RUSH 100回 50%',
    '  4R 600個 → 通常 50%',
    '電チュー（RUSH 中）',
    '  10R 1,500個 → RUSH 100回 50%',
    '  4R 600個 → 通常 50%',
  ]);
  expect(v.nodes.map((n) => `${n.label} ${n.odds} ${n.spins}`)).toEqual(['通常時 1/185.0 0', 'RUSH 1/39.9 100']);
  expect(edgeLines(v)).toEqual(['normal→normal 50%', 'normal→st 50%', 'st→normal 50%', 'st→st 50%', 'st→normal 回数切れ']);
  expect(v.rushEntry).toBeCloseTo(0.5, 10);
  expect(v.continuation.st).toBeCloseTo(0.5 * (1 - Math.pow(1 - 1 / 39.9, 100)), 10);
  expect(v.rows).toEqual([
    { label: '大当たり確率（通常時）', value: '1/185.0' },
    { label: '大当たり確率（RUSH 中）', value: '1/39.9' },
    { label: 'RUSH 回転数', value: '100回' },
    { label: 'RUSH 突入率', value: '50.0%' },
    { label: 'RUSH 継続率', value: '46.0%' },
    { label: '1R', value: '10カウント × 15個' },
    { label: 'ヘソ賞球', value: '8個' },
    { label: '保留', value: '4個' },
  ]);
});

test('国道店 rush-middle-01', () => {
  const v = view('rush-middle-01');
  expect(pieLines(v)).toEqual([
    'ヘソ（通常時）',
    '  3R 450個 → RUSH 66回 35%',
    '  3R 450個 → 通常 65%',
    '電チュー（RUSH 中）',
    '  10R 1,500個 → RUSH 66回 75%',
    '  20R＋上乗せ 約3,000〜9,000個 → RUSH 66回 25%',
  ]);
  expect(edgeLines(v)).toEqual(['normal→normal 65%', 'normal→st 35%', 'st→st 100%', 'st→normal 回数切れ']);
  expect(v.nodes.map((n) => n.notes)).toEqual([[], ['RUSH 当たり → 上位RUSH 25%']]);
  expect(v.rushEntry).toBeCloseTo(0.35, 10);
  // 上位の平均 = 3,000 + 1,500 × E[K]（E[K] = 1/4 + 1/16 + 1/64 + 1/256）、最大 60R = 9,000個（D-120）。
  const up = v.pies[1]!.slices[1]!.upper!;
  expect(up.maxBalls).toBe(9000);
  expect(up.avgBalls).toBeCloseTo(3000 + 1500 * (85 / 256), 10);
  expect(v.rows.slice(3)).toEqual([
    { label: 'RUSH 突入率', value: '35.0%' },
    { label: 'RUSH 継続率', value: '81.3%' },
    { label: '上位RUSH', value: 'RUSH 中の当たりの 25%' },
    { label: '上乗せ', value: '1/4 でループ（最大 +40R）' },
    { label: 'RUSH 中の当たりの平均', value: '約2,000個' },
    { label: '1R', value: '10カウント × 15個' },
    { label: 'ヘソ賞球', value: '8個' },
    { label: '保留', value: '4個' },
  ]);
});

test('港町店 lt-middle-01（時短経由の突入・ST→LT・上乗せ）', () => {
  const v = view('lt-middle-01');
  expect(pieLines(v)).toEqual([
    'ヘソ（通常時）',
    '  3R 450個 → RUSH 56回 25%',
    '  3R 450個 → 時短 100回 75%',
    '電チュー（時短中）',
    '  3R 450個 → RUSH 56回 100%',
    '電チュー（RUSH 中）',
    '  10R 1,500個 → RUSH 56回 96%',
    '  10R 1,500個 → LT 91回 4%',
    '電チュー（LT 中）',
    '  10R 1,500個 → LT 91回 60%',
    '  10R＋上乗せ 10R 3,000個 → LT 91回 25%',
    '  10R＋上乗せ 20R 4,500個 → LT 91回 10%',
    '  10R＋上乗せ 40R 7,500個 → LT 91回 5%',
  ]);
  expect(v.nodes.map((n) => n.label)).toEqual(['通常時', '時短', 'RUSH', 'LT']);
  expect(edgeLines(v)).toEqual([
    'normal→jitan 75%',
    'normal→st 25%',
    'jitan→st 100%',
    'st→st 96%',
    'st→lt 4%',
    'lt→lt 100%',
    'jitan→normal 回数切れ',
    'st→normal 回数切れ',
    'lt→normal 回数切れ',
  ]);
  // spec/21 の理論値: 実質突入 約44%・時短の引き戻し 約26%・RUSH 継続 約76%・LT 継続 約90%。
  expect(v.rows.filter((r) => r.label.endsWith('率') && !r.label.startsWith('大当たり'))).toEqual([
    { label: 'RUSH 突入率', value: '44.3%' },
    { label: '時短 引き戻し率', value: '25.7%' },
    { label: 'RUSH 継続率', value: '75.9%' },
    { label: 'LT 継続率', value: '90.1%' },
  ]);
});

test('3機種とも各円グラフの合計 100・扇の重みは 0 でない', () => {
  for (const id of ['light-middle-01', 'rush-middle-01', 'lt-middle-01']) {
    for (const p of view(id).pies) {
      expect(p.slices.reduce((a, s) => a + s.percent, 0)).toBe(100);
      expect(p.slices.every((s) => s.weight > 0)).toBe(true);
    }
  }
});
