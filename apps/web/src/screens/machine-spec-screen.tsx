import { useState } from 'react';
import type { LotteryModeId } from '@ph/core';
import { Segmented } from '../components/segmented.tsx';
import { machineSpec } from '../engine/game-config.ts';
import { MACHINE_INFO, machineInfo } from '../engine/machine-info.ts';
import { machineSpecView, type FlowEdge, type SpecPie, type SpecSlice } from '../engine/machine-spec-view.ts';
import { useEngine } from '../stores/engine.ts';
import styles from './machine-spec-screen.module.css';

/** モードごとの色（帯・扇・箱の縁）。 */
const MODE_COLOR: Readonly<Record<LotteryModeId, string>> = {
  normal: '#a8acc8',
  jitan: '#6ec8e8',
  st: '#e8b840',
  lt: '#e87aa8',
};

/** 上位RUSH の扇（RUSH の扇と見分ける, D-120）。 */
const UPPER_COLOR = '#f07848';

function sliceColor(s: SpecSlice): string {
  return s.upper !== null ? UPPER_COLOR : MODE_COLOR[s.next];
}

const MODE_LABEL: Readonly<Record<LotteryModeId, string>> = { normal: '通常', jitan: '時短', st: 'RUSH', lt: 'LT' };

/** 扇の座標（中心 (0,0)・半径 r。角度は上から時計回り）。web なので sin/cos 可。 */
export function slicePath(from: number, to: number, r: number): string {
  if (to - from >= 0.9999) return `M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}Z`;
  const a0 = from * 2 * Math.PI;
  const a1 = to * 2 * Math.PI;
  const x0 = r * Math.sin(a0);
  const y0 = -r * Math.cos(a0);
  const x1 = r * Math.sin(a1);
  const y1 = -r * Math.cos(a1);
  const large = to - from > 0.5 ? 1 : 0;
  return `M0 0L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z`;
}

function Pie({ pie }: { pie: SpecPie }) {
  const r = 70;
  let acc = 0;
  return (
    <section className={styles.card} aria-label={pie.title}>
      <h3>{pie.title}</h3>
      <svg className={styles.pie} viewBox="-80 -80 160 160" role="img" aria-label={`${pie.title}の大当たり振り分け`}>
        {pie.slices.map((s, i) => {
          const from = acc;
          acc += s.share;
          const mid = (from + acc) / 2;
          const labelR = pie.slices.length === 1 ? 0 : r * 0.62;
          return (
            <g key={i}>
              <path d={slicePath(from, acc, r)} fill={sliceColor(s)} stroke="#1c2145" strokeWidth="1.5" />
              {s.percent >= 6 && (
                <text className={styles.pct} x={(labelR * Math.sin(mid * 2 * Math.PI)).toFixed(1)} y={(-labelR * Math.cos(mid * 2 * Math.PI)).toFixed(1)}>
                  {s.percent}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ul className={styles.legend}>
        {pie.slices.map((s, i) => (
          <li key={i}>
            <span className={styles.dot} style={{ background: sliceColor(s) }} aria-hidden="true" />
            <b>{s.roundsLabel}</b>
            <span>{s.ballsLabel}</span>
            <span className={styles.band} style={{ background: MODE_COLOR[s.next] }}>
              {s.nextLabel}
            </span>
            <span className={styles.pctText}>{s.percent}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Arrow({ back }: { back: boolean }) {
  return (
    <svg viewBox="0 0 16 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {back ? <path d="M13 2v4H3M6 3 3 6l3 3" /> : <path d="M1 6h13M10 2l4 4-4 4" />}
    </svg>
  );
}

function edgeText(e: FlowEdge, label: (m: LotteryModeId) => string): string {
  if (e.kind === 'end') return `回数切れで ${label(e.to)} へ`;
  return e.from === e.to ? `大当たり後も ${label(e.to)} ${e.percent}%` : `大当たり後 ${label(e.to)} ${e.percent}%`;
}

/** 台1つぶんのスペック（円グラフ・ゲームフロー・基本性能）。 */
export function MachineSpecBody({ id }: { id: string }) {
  const spec = machineSpec(id);
  if (spec === null) return <p className={styles.note}>この台のデータがありません。</p>;
  const v = machineSpecView(spec);
  const label = (m: LotteryModeId) => v.nodes.find((n) => n.mode === m)?.label ?? MODE_LABEL[m];
  return (
    <>
      <section className={styles.card} aria-label="ゲームフロー">
        <h2>ゲームフロー</h2>
        <ul className={styles.flow}>
          {v.nodes.map((n) => (
            <li key={n.mode} className={styles.node} style={{ ['--c' as string]: MODE_COLOR[n.mode] }}>
              <header>
                <b>{n.label}</b>
                <small>
                  {n.odds}
                  {n.spins > 0 ? `・${n.spins}回` : ''}
                </small>
              </header>
              <ul className={styles.edges}>
                {v.edges
                  .filter((e) => e.from === n.mode)
                  .map((e, i) => (
                    <li key={i} className={e.kind === 'end' ? styles.end : undefined}>
                      <Arrow back={e.kind === 'end' || e.from === e.to} />
                      {edgeText(e, label)}
                    </li>
                  ))}
                {n.notes.map((t) => (
                  <li key={t}>※ {t}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.card} aria-label="基本性能">
        <h2>基本性能</h2>
        <dl className={styles.table}>
          {v.rows.map((r) => (
            <div key={r.label} style={{ display: 'contents' }}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <h2 style={{ margin: 0, fontSize: 16 }}>大当たり詳細</h2>
      {v.pies.map((p) => (
        <Pie key={p.mode} pie={p} />
      ))}
      <p className={styles.note}>{v.ballsNote}</p>
    </>
  );
}

export interface MachineSpecScreenProps {
  /** 初期表示の台（今の台）。 */
  readonly current: string;
  /** 開放済みの台（Projection.machinesOpen）。 */
  readonly open: readonly string[];
  readonly onBack: () => void;
}

/** 台のスペック画面（設定から, P14-T3）: 3台のタブ。未開放の台も見られる。 */
export function MachineSpecScreen({ current, open, onBack }: MachineSpecScreenProps) {
  const [id, setId] = useState(machineInfo(current) !== null ? current : (MACHINE_INFO[0]?.id ?? ''));
  const info = machineInfo(id);
  const unlocked = open.includes(id) || info?.node === null;
  return (
    <div className={styles.screen}>
      <button type="button" className={styles.back} onClick={onBack}>
        ‹ 設定
      </button>
      <Segmented label="台" dense options={MACHINE_INFO.map((m) => [m.id, m.shop] as const)} value={id} onChange={setId} />
      {info && (
        <p className={styles.note}>
          {info.name} / {info.blurb}
        </p>
      )}
      {!unlocked && <span className={styles.badge}>未開放</span>}
      <MachineSpecBody id={id} />
    </div>
  );
}

/** ストアにつないだ画面。 */
export function ConnectedMachineSpecScreen({ onBack }: { onBack: () => void }) {
  const machineId = useEngine((s) => s.machineId);
  const open = useEngine((s) => s.projection?.machinesOpen);
  return <MachineSpecScreen current={machineId} open={open ?? [MACHINE_INFO[0]?.id ?? '']} onBack={onBack} />;
}
