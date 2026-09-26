// Engine Worker の中身（Worker 外でもテストできるよう DB と Atlas を受け取る）。spec/10 保存・spec/40 状態管理。
// 真実は seed + 機種 + 台帳 + ActionLog。スナップショットはキャッシュで、壊れていれば捨てて再計算する。
import type { ClaimRecord } from '@ph/claims';
import {
  BallSimulator,
  Engine,
  atlasKeyForBall,
  decodeAtlasHeader,
  parseBoard,
  parseLaunchDirs,
  verifyAtlas,
  type Action,
  type AtlasVerifyResult,
  type AwaySummary,
  type EngineSimEvent,
  type HallProjection,
} from '@ph/core';
import { decodeSave, dumpSave, encodeSave, replaceWithSave } from '../platform/save-file.ts';
import {
  appendAction,
  appendClaims,
  closeSessionWithClaims,
  ensureGameMeta,
  migrateMeta,
  putSetting,
  putSnapshot,
  type Db,
  type GameMeta,
} from '../platform/storage.ts';
import { localDay } from '../stores/activity.ts';
import { SNAPSHOT_VERSION, buildEngine, ledgerOrder, type RestoredFrom, type SnapshotRecord } from './engine-build.ts';
import { engineConfig } from './game-config.ts';

/** 端末時計がこれ以上戻っていたら巻き戻しとみなして止める（それ未満の揺れは Engine の時刻に揃える）。 */
export const CLOCK_SKEW_MS = 2000;
/** 前面中にスナップショットを書く間隔。 */
export const SNAPSHOT_EVERY_MS = 60000;
/** 1回の前進で着いた玉を描画に渡す上限（Debug の x3600 で1時間分を送らない）。 */
export const SHOT_LIMIT = 240;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
/** UI から送る操作（時刻は Worker が付ける）。 */
export type ActionInput = DistributiveOmit<Action, 't'>;

/** 盤面に描く1発（spec/50）。軌跡は描画側が Atlas キーの正準条件から計算する。 */
export interface Shot {
  readonly ball: number;
  readonly fireAt: number;
  readonly sensorAt: number;
  /** Engine の確定した入賞先（釘の強化で out→start1 に変わることがある）。 */
  readonly kind: 'start1' | 'out' | 'lost';
  readonly key: number;
}

export interface EngineView {
  readonly projection: HallProjection;
  /** 端末時計の巻き戻しで前進を止めている（now < 最後に進めた時刻）。 */
  readonly clockBack: boolean;
  /** 今回の前進で発射して着いた玉＋飛行中の玉（描画側で ball ごとに重複を除く）。 */
  readonly shots: readonly Shot[];
  /** 演出の分岐に使う（RNGStream(seed, 'presentation', entry), spec/43）。 */
  readonly seed: number;
}

export interface TickResult extends EngineView {
  readonly events: readonly EngineSimEvent[];
}

/** Debug 画面の状態ダンプ（入力列は件数だけ）。 */
export interface DebugInfo {
  readonly meta: GameMeta;
  readonly nowMs: number;
  readonly grants: number;
  readonly actions: number;
  readonly snapshot: unknown;
}

export interface BootResult extends EngineView {
  readonly restoredFrom: RestoredFrom;
  /** 留守から戻った時の集計（背面のまま終了していた場合）。 */
  readonly away: AwaySummary | null;
}

export class EngineHost {
  private engine: Engine;
  private fg: boolean;
  private lastSavedAt = 0;
  private lastSavedDay = '';

  private constructor(
    private readonly db: Db,
    private readonly atlas: ArrayBuffer,
    private readonly newSeed: () => number,
    private meta: GameMeta,
    built: { engine: Engine; fg: boolean },
  ) {
    this.engine = built.engine;
    this.fg = built.fg;
  }

  /** 起動: meta の移行 → スナップショット復元（だめなら再計算）→ now まで追いつき → 前面に戻す。 */
  static async open(db: Db, atlas: ArrayBuffer, now: number, newSeed: () => number): Promise<{ host: EngineHost; boot: BootResult }> {
    const meta = await ensureGameMeta(db, now, newSeed());
    const built = await buildEngine(db, meta, atlas);
    const host = new EngineHost(db, atlas, newSeed, meta, built);
    return { host, boot: await host.afterBuild(built.from, now) };
  }

  get gameMeta(): GameMeta {
    return this.meta;
  }

  private async afterBuild(from: RestoredFrom, now: number): Promise<BootResult> {
    const t = this.clamp(now);
    if (t === null) {
      return { ...this.view(true), restoredFrom: from, away: null };
    }
    this.engine.advance(t);
    let away: AwaySummary | null = null;
    if (!this.fg) {
      await this.presence(true, t);
      away = this.engine.awaySummary();
    }
    await this.saveSnapshot(t, true);
    return { ...this.view(false), restoredFrom: from, away };
  }

  /** 端末時計を Engine の時刻に揃える。巻き戻しなら null。 */
  private clamp(now: number): number | null {
    const at = this.engine.nowMs;
    if (now >= at) {
      return now;
    }
    return at - now <= CLOCK_SKEW_MS ? at : null;
  }

  private view(clockBack: boolean, events: readonly EngineSimEvent[] = []): EngineView {
    return { projection: this.engine.project(), clockBack, shots: this.shots(events), seed: this.meta.seed };
  }

  /** 今回の前進内で発射して着いた玉（新しい方から SHOT_LIMIT 個。入賞先はセンサーイベント）と、まだ飛んでいる玉。 */
  private shots(events: readonly EngineSimEvent[]): Shot[] {
    const seed = this.meta.seed;
    const landed = new Map<number, { at: number; kind: Shot['kind'] }>();
    for (const e of events) {
      if (e.k === 'sensor') {
        landed.set(e.ball, { at: e.at, kind: e.kind });
      }
    }
    const out: Shot[] = [];
    for (const e of events) {
      if (e.k !== 'fired') {
        continue;
      }
      const s = landed.get(e.ball);
      if (s !== undefined) {
        out.push({ ball: e.ball, fireAt: e.at, sensorAt: s.at, kind: s.kind, key: atlasKeyForBall(seed, e.ball) });
      }
    }
    out.splice(0, out.length - SHOT_LIMIT);
    for (const p of this.engine.inFlight()) {
      out.push({ ball: p.ball, fireAt: p.fireAt, sensorAt: p.sensorAt, kind: p.kind, key: atlasKeyForBall(seed, p.ball) });
    }
    return out;
  }

  /** 前面中の 1Hz 前進。 */
  async tick(now: number): Promise<TickResult> {
    const t = this.clamp(now);
    if (t === null) {
      return { ...this.view(true), events: [] };
    }
    const events = this.engine.advance(t);
    await this.saveSnapshot(t, false);
    return { ...this.view(false, events), events };
  }

  /**
   * Engine に入れてから IndexedDB に書く（Engine が不正な入力を弾くので先に試す）。
   * 書き込みに失敗したら DB から作り直して throw（画面に返す状態は保存済みのものだけ）。
   */
  private async commit(now: number, apply: (t: number) => () => Promise<void>): Promise<TickResult> {
    const t = this.clamp(now);
    if (t === null) {
      return { ...this.view(true), events: [] };
    }
    let before: EngineSimEvent[];
    try {
      before = this.engine.advance(t);
      const persist = apply(t);
      await persist();
    } catch (e) {
      await this.rebuild(t);
      throw e;
    }
    // 半開区間 [now, to) なので t の入力は t+1 まで進めて反映する。前回の前進から t までのイベントも渡す（液晶・盤面が取りこぼさない）。
    const events = [...before, ...this.engine.advance(t + 1)];
    return { ...this.view(false, events), events };
  }

  /** 操作を記録する（spec/40: UI → appendAction(t=now) → advance → 新 Projection）。 */
  act(input: ActionInput, now: number): Promise<TickResult> {
    return this.commit(now, (t) => {
      const action = { ...input, t } as Action;
      this.engine.appendAction(action);
      return () => appendAction(this.db, action);
    });
  }

  /** 前面/背面（visibilitychange）。背面に回る時はすぐスナップショットを書く。 */
  async presence(fg: boolean, now: number): Promise<TickResult & { away: AwaySummary | null }> {
    if (fg === this.fg) {
      return { ...(await this.tick(now)), away: null };
    }
    const r = await this.act({ k: 'presence', fg }, now);
    if (r.clockBack) {
      return { ...r, away: null };
    }
    this.fg = fg;
    await this.saveSnapshot(this.engine.nowMs, true);
    return { ...r, away: fg ? this.engine.awaySummary() : null };
  }

  /**
   * 受け取りを確定する。計画時刻は確認画面の間に Engine の時刻より古くなるので、確定時刻に付け直す
   * （claimId は時刻に依らない）。closesSession ならチェックインのセッションも同じトランザクションで閉じる。
   */
  receive(records: readonly ClaimRecord[], closesSession: boolean, now: number): Promise<TickResult> {
    return this.commit(now, (t) => {
      const stamped = records.map((r) => ({ ...r, receivedAt: t, grant: { ...r.grant, at: t } })).sort(ledgerOrder);
      stamped.forEach((r) => this.engine.appendGrant(r.grant));
      if (closesSession) {
        return () => closeSessionWithClaims(this.db, stamped);
      }
      return () => (stamped.length > 0 ? appendClaims(this.db, stamped) : Promise.resolve());
    });
  }

  /** Debug: seed・入力の件数・スナップショット（台帳と ActionLog の中身は除く）。 */
  debugInfo(): DebugInfo {
    const { grants, actions, ...rest } = this.engine.snapshot();
    return { meta: this.meta, nowMs: this.engine.nowMs, grants: grants.length, actions: actions.length, snapshot: rest };
  }

  /** Debug: Atlas の先頭を物理で再計算して照合する（盤面は board の JSON。数秒かかる）。 */
  verifyAtlas(boardJson: unknown, dirsJson: unknown): AtlasVerifyResult {
    const sim = new BallSimulator(parseBoard(boardJson), parseLaunchDirs(dirsJson));
    return verifyAtlas(this.atlas, decodeAtlasHeader(this.atlas).boardHash, (p) => sim.run(p));
  }

  /** セーブを書き出し、書き出した時刻を設定に残す（週1回のバックアップ案内, spec/41）。 */
  async exportSave(now: number): Promise<string> {
    const text = await encodeSave(await dumpSave(this.db));
    await putSetting(this.db, 'lastExportAt', now);
    return text;
  }

  /** セーブを読み込む。中身から Engine を組めることを確かめてから DB を置き換える（失敗時は何も変えない）。 */
  async importSave(text: string, now: number): Promise<BootResult> {
    const data = await decodeSave(text);
    const claims = data.claims.slice().sort(ledgerOrder);
    const meta = migrateMeta(data.meta, claims[0]?.receivedAt, now, this.newSeed());
    new Engine(engineConfig(meta, this.atlas), claims.map((c) => c.grant), data.actions);
    await replaceWithSave(this.db, { ...data, claims }, meta);
    this.meta = meta;
    const built = await buildEngine(this.db, meta, this.atlas);
    this.engine = built.engine;
    this.fg = built.fg;
    this.lastSavedAt = 0;
    this.lastSavedDay = '';
    return this.afterBuild(built.from, now);
  }

  private async rebuild(now: number): Promise<void> {
    const built = await buildEngine(this.db, this.meta, this.atlas);
    this.engine = built.engine;
    this.fg = built.fg;
    if (now >= this.engine.nowMs) {
      this.engine.advance(now);
    }
  }

  /** latest を書く（前面中は SNAPSHOT_EVERY_MS ごと）。日が変わって最初の保存では day:<日> も書く（7日分）。 */
  private async saveSnapshot(now: number, force: boolean): Promise<void> {
    if (!force && now - this.lastSavedAt < SNAPSHOT_EVERY_MS) {
      return;
    }
    const rec: SnapshotRecord = {
      v: SNAPSHOT_VERSION,
      seed: this.meta.seed,
      machineId: this.meta.machineId,
      createdAt: this.meta.createdAt,
      savedAt: now,
      engine: this.engine.snapshot(),
    };
    await putSnapshot(this.db, 'latest', rec);
    const day = localDay(now);
    if (day !== this.lastSavedDay) {
      await putSnapshot(this.db, `day:${day}`, rec);
      this.lastSavedDay = day;
    }
    this.lastSavedAt = now;
  }
}
