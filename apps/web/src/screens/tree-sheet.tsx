import { useState } from 'react';
import type { RestView, ShopView, TreeNodeView, TreeView } from '@ph/core';
import { HoldButton } from '../components/hold-button.tsx';
import { Segmented } from '../components/segmented.tsx';
import { Sheet } from '../components/sheet.tsx';
import { groupTier, restHeaderText, stateMark, treeNodeNow, timingBadge, TREE_NODE_TEXT, TREE_TIER_NAMES, tierRemaining } from '../engine/tree-defs.ts';
import { playToastCue } from '../fx/fx-host.ts';
import { act, useEngine } from '../stores/engine.ts';
import { formatNum } from '../stores/format.ts';
import styles from './tree.module.css';

let cueSerial = 0;
const report = (e: unknown) => useEngine.setState({ error: e instanceof Error ? e.message : String(e) });

/** 行の前提の表示（「← 呼び込み」）。 */
function reqText(n: TreeNodeView): string {
  return n.req.map((id) => `← ${TREE_NODE_TEXT[id]?.name ?? id}`).join(' ');
}

/** 常連ランクの表示（使っても減らない）。 */
export function rankText(t: TreeView): string {
  return `常連ランク ${t.rank}（生産 ×${(1 + t.regularRate * t.rank).toFixed(2)}）`;
}

/**
 * 常連ツリーのシート（spec/25 画面）: 段のタブ・系統ごとの縦リスト・行タップで詳細と長押しで開ける。
 * 購入は返金なしのため長押し（HoldButton）。ランクは減らず、常連P だけが減る。
 * 休業中は上にカウントダウン・下に「開店する」（普通のボタン, P12-T3）。rest が null でない時だけ出す。
 */
export function TreeSheet({ tree, rest, at, shop, onDismiss }: { tree: TreeView; rest?: RestView | null; at?: number; shop?: ShopView; onDismiss: () => void }) {
  const firstOpen = Math.max(1, tree.tierOpen.findIndex((o, i) => o && tree.nodes.some((n) => n.tier === i + 1 && (n.state === 'buyable' || n.state === 'short'))) + 1);
  const [tier, setTier] = useState(firstOpen);
  const [picked, setPicked] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const open = tree.tierOpen[tier - 1] === true;
  const left = tierRemaining(tree.nodes, tier);
  const sel = tree.nodes.find((n) => n.id === picked) ?? null;
  const selText = sel === null ? undefined : TREE_NODE_TEXT[sel.id];
  const resting = rest !== undefined && rest !== null;
  const restingAt = at ?? rest?.autoOpenAt ?? 0;

  return (
    <Sheet onDismiss={onDismiss} labelledBy="tree-title">
      <h2 id="tree-title">常連ツリー</h2>
      {resting && rest !== null && (
        <p className={styles.rest} role="status">
          {restHeaderText(rest, restingAt)}
        </p>
      )}
      <p className={styles.summary}>
        <span>{rankText(tree)}</span>
        <small>使っても減りません</small>
        <b>常連P {formatNum(tree.points)}</b>
      </p>
      <Segmented
        label="段"
        dense
        options={TREE_TIER_NAMES.map((_, i) => [i + 1, `${tree.tierOpen[i] === true ? '' : '🔒'}段${i + 1}`] as const)}
        value={tier}
        onChange={(t) => {
          setTier(t);
          setPicked(null);
        }}
      />
      <p className={styles.tierNote}>
        段{tier} {TREE_TIER_NAMES[tier - 1]}
        {!open && `（あと ${left} 個で開く）`}
      </p>
      <div className={styles.groups}>
        {groupTier(tree.nodes, tier).map((g) => (
          <section key={g.line} className={styles.group}>
            <h3>{g.line}</h3>
            <ul className={styles.list}>
              {g.nodes.map((n) => {
                const m = stateMark(n.state);
                const text = TREE_NODE_TEXT[n.id];
                const badge = timingBadge(n.timing, resting);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`${styles.row} ${styles[n.state]} ${picked === n.id ? styles.picked : ''}`}
                      aria-pressed={picked === n.id}
                      onClick={() => setPicked(picked === n.id ? null : n.id)}
                    >
                      <span className={styles.mark} aria-label={m.label}>
                        {m.mark}
                      </span>
                      <span className={styles.info}>
                        <b>
                          {text?.name ?? n.id}
                          {badge !== null && <small className={styles.timing}> {badge}</small>}
                        </b>
                        <small>{text?.desc ?? ''}</small>
                        {n.req.length > 0 && <small className={styles.req}>{reqText(n)}</small>}
                      </span>
                      <span className={styles.cost}>{n.state === 'owned' ? m.label : `${n.cost}P`}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {sel !== null && (
        <div className={styles.detail}>
          <p>
            <b>{selText?.name ?? sel.id}</b> {selText?.desc}
          </p>
          {shop !== undefined && treeNodeNow(sel.id, shop) !== null && <p className={styles.sub}>{treeNodeNow(sel.id, shop)}</p>}
          <p className={styles.sub}>
            {selText?.line}・コスト {sel.cost}P{sel.req.length > 0 ? `・${reqText(sel)}` : ''}・{stateMark(sel.state).label}
            {timingBadge(sel.timing, resting) !== null ? `・${timingBadge(sel.timing, resting)}` : ''}
          </p>
          {sel.state === 'owned' ? null : (
            <HoldButton
              className={styles.buyBtn}
              disabled={sel.state !== 'buyable'}
              onFire={async () => {
                const before = tree.tierOpen.filter(Boolean).length;
                const ok = await act({ k: 'treeBuy', node: sel.id }).then(() => true, (e: unknown) => (report(e), false));
                if (ok) {
                  const now = useEngine.getState().projection?.tree?.tierOpen.filter(Boolean).length ?? before;
                  playToastCue(now > before ? 'tierOpened' : 'treeBought', useEngine.getState().seed, ++cueSerial);
                }
                setPicked(null);
              }}
            >
              {sel.state === 'buyable' ? '長押しで開ける' : sel.state === 'short' ? `常連P が あと ${sel.cost - tree.points} 足りません` : open ? '前提を先に開けてください' : `段${tier} はまだ閉じています`}
            </HoldButton>
          )}
        </div>
      )}
      {resting && (
        <button
          type="button"
          className={styles.openBtn}
          disabled={opening}
          onClick={() => {
            setOpening(true);
            act({ k: 'open' })
              .then(() => playToastCue('opened', useEngine.getState().seed, ++cueSerial))
              .catch(report)
              .finally(() => setOpening(false));
          }}
        >
          開店する
        </button>
      )}
      <button type="button" className={styles.close} onClick={onDismiss}>
        閉じる
      </button>
    </Sheet>
  );
}
