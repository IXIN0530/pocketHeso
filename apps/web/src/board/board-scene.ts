import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HalfFloatType,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Scene,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Material,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FlashLayer, HOLD_BREAK_MS, HOLD_CRACK_CUE, SAKIBARE_CUE, UPPER_CUES, holdBreakScale, holdChangeCue, holdRank, type SakibareCustom, type SceneCue, type UpperBannerKind } from '@ph/fx';
import {
  BALL_RADIUS_MM,
  type Board,
  type BoardYakumono,
  type EngineSimEvent,
  type HallProjection,
  type LotteryHoldColor,
  type Vec2,
} from '@ph/core';
import type { Shot } from '../engine/engine-host.ts';
import {
  packTexts,
  planFor,
  playBreakCue,
  playCue,
  playCues,
  playHesoCue,
  playHudCue,
  playSideCue,
  setFlashTarget,
  setSceneTarget,
} from '../fx/fx-host.ts';
import { PREVIEW_TAIL_MS, PREVIEW_UPPER_SPEC, upperPreviewRounds, upperPreviewState, type PreviewRequest } from '../stores/preview.ts';
import { LCD_RECT, bakeBoard, bakeGlare, bakeHall, bakeSoftDot, bakeSymbolAtlas, bakeTextAtlas } from './art.ts';
import { BallTracks, DISPLAY_LAG_MS, MAX_BALLS, PREROLL_MS } from './ball-tracks.ts';
import { DEFAULT_ROUND, jackpotHud, resultCue, type HudView, type JackpotRound } from './jackpot-hud.ts';
import { CAB, Cabinet, PALETTES, bakeCabinetEnv, ledTube } from './cabinet.ts';
import { DEFAULT_LOOK, sameLook, type Look } from './look.ts';
import { summarize, type FrameStats } from './frame-stats.ts';
import { LcdReels, type SpinShow } from './lcd.ts';
import { setLcdView } from '../stores/lcd-view.ts';
import { LcdTimeline, fireSakibares, sakibareTimes, shownLcdState, type LcdState, type OddsOf } from './lcd-timeline.ts';

export interface DrawInfo {
  calls: number;
  triangles: number;
}

/** 当たり演出の長さ（ブルームを ON にしておく時間）。 */
const WIN_MS = 3000;

/** 先バレの時刻からこれ以上たって気付いたら鳴らさない（表示時刻の ms）。 */
const SAKIBARE_LATE_MS = 1000;
/** ヘソ入賞で鳴らすパックの演出。 */
const HESO_CUE = 'heso';

/** 変動パターンの熱さ（1 以上をリーチとして見せる）と基準の尺（spec/21 patterns.json）。 */
export interface PatternInfo {
  readonly hot: number;
  readonly ms: number;
}

/** 演出プレビュー（Debug の4本と留守中リプレイ。Engine の液晶を止めて1変動を流す）。 */
export type PreviewSpin = PreviewRequest;

/** 上位RUSH・上乗せの告知が出た時に鳴らすパックの演出（fx の UPPER_CUES と同じ）。 */
const UPPER_BANNER_CUES: Record<UpperBannerKind, string> = {
  upperIn: UPPER_CUES.break,
  uwanoseStart: UPPER_CUES.uwanoseStart,
  digit: UPPER_CUES.digit,
  uwanoseHit: UPPER_CUES.uwanoseHit,
  uwanoseEnd: UPPER_CUES.uwanoseEnd,
  uwanoseMax: UPPER_CUES.uwanoseMax,
};

// 奥行き（spec/50）: 盤面板 0 → 液晶 +3 → 玉・釘 +7 → 役物 +8 → ガラス +16 → 枠 +10〜+55（cabinet.ts）。
const Z_LCD = 3;
const Z_BALL = 7;
const Z_YAKU = 8;
const Z_GLASS = 16;

/** 役物の見た目（盤面 JSON の id ごと）。色は筐体に合わせて氷色・バイオレット・マゼンタの3色に絞る。回る速さは Projection の periodS。 */
const ICE = 0x8fe6ff;
const VIOLET = 0x9a6bff;
const MAGENTA = 0xff4d9a;
const YAKU_STYLE: Record<string, { blades: number; color: number }> = {
  windmill: { blades: 4, color: ICE },
  'spinner-r': { blades: 3, color: VIOLET },
  'pocket-l': { blades: 6, color: VIOLET },
  'pocket-r': { blades: 6, color: VIOLET },
  'gate-l': { blades: 2, color: ICE },
  'gate-r': { blades: 2, color: ICE },
  'center-top': { blades: 8, color: 0xe8f6ff },
  'center-bottom': { blades: 5, color: MAGENTA },
};
const YAKU_DEFAULT = { blades: 4, color: 0xffffff };

/** 描画に要る役物の状態（Engine の YakumonoView の一部。盤面の役物 i に経済の役物 i を割り当てる, D-063）。 */
export interface YakumonoState {
  readonly lv: number;
  readonly phase?: number | undefined;
  readonly periodS?: number | undefined;
}

/** 表示の時計（Debug の時間倍率を含む）。 */
export interface SceneClock {
  readonly scale: number;
  now(): number;
}

interface Yaku {
  group: Group;
  material: MeshStandardMaterial;
  dir: number;
}

/**
 * 盤面の Three.js シーン（spec/50 の構成・奥行き・質感に従う）。React からは命令的に使う（<BoardCanvas>）。
 * 盤面板は Canvas 2D の1枚、釘は InstancedMesh 1つ、玉は Engine の Shot を BallTracks で補間、
 * 役物は Projection の位相と周期で回す。win() で当たり演出（虹の加算クアッド＋ブルーム3秒）。
 */
export class BoardScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 50, 6000);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly board: Board;
  private readonly tracks: BallTracks;
  private readonly clock: SceneClock;
  private yakuStates: readonly YakumonoState[] = [];
  private yakuAt = 0;
  private readonly lcd: LcdReels;
  private readonly lcdTimeline = new LcdTimeline();
  private lastJackpot = -1;
  /** 大当たり中の表示で鳴らした音（ラウンド・上乗せ・結果の告知, D-077）。 */
  private hudHeard = { round: '', bonus: -1, result: -1 };
  /** 上位RUSH・上乗せで鳴らし済みの段（D-120）。 */
  private upperHeard = { entry: -1, crack: 0, frozen: false, banner: '' };
  private round: JackpotRound = DEFAULT_ROUND;
  /** 前のフレームで見せた保留の色（番号ごと。保留変化の音・光を鳴らす判定, P7-T4）。 */
  private shownColors = new Map<number, LotteryHoldColor>();
  /** 先バレを済ませた保留の番号（D-074）。 */
  private sakibareDone = new Set<number>();
  /** 今の変動の演出（CueSheet の lcd キュー）。 */
  private show: SpinShow | null = null;
  private seed = 0;
  /** 取得時のモード → 先バレの材料（今の機種。カスタム用, P13-T8b）。 */
  private oddsOf: OddsOf = () => ({ p: 0, hitW: [], missW: [] });
  private preview: (PreviewSpin & { start: number }) | null = null;
  private cueShake = { until: 0, amp: 0 };
  private cueCam = { from: 0, ms: 0 };
  private readonly lcdCenter = new Vector3();
  private readonly scratch = new Vector3();
  private readonly ballMeshes: Mesh[] = [];
  private readonly ballShadows: InstancedMesh;
  private readonly yaku: Yaku[] = [];
  private readonly cabinet = new Cabinet();
  private ballMat!: MeshStandardMaterial;
  private look: Look = DEFAULT_LOOK;
  private readonly rainbow: Mesh<PlaneGeometry, ShaderMaterial>;
  /** 全画面フラッシュとブルームの期間（CueSheet から, spec/43）。 */
  private readonly flashLayer: FlashLayer;
  private readonly hesoMat: MeshStandardMaterial;
  private readonly lcdLight: PointLight;
  private readonly hesoLight: PointLight;
  private readonly host: HTMLElement;
  private readonly resizeObs: ResizeObserver;
  private readonly tmp = new Object3D();
  private readonly v = new Vector3();
  private readonly c = new Color();
  private frameMs: number[] = [];
  private last = 0;
  private elapsed = 0;
  private winMs = -1;
  private bloomOn = true;
  private hesoFlash = 0;
  private homeDist = 1400;
  private readonly homeY = (CAB.top + CAB.bottom) / 2;

  constructor(
    host: HTMLElement,
    board: Board,
    dirs: readonly Vec2[],
    clock: SceneClock,
    private readonly patterns: (id: string) => PatternInfo | undefined = () => undefined,
  ) {
    this.host = host;
    this.board = board;
    this.clock = clock;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    // ブルーム中はパスが増えるので、フレーム単位で draw call を数える。
    this.renderer.info.autoReset = false;
    this.renderer.domElement.style.display = 'block';
    host.appendChild(this.renderer.domElement);

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
    this.cabinet.setEnvironment(bakeCabinetEnv(this.renderer));
    this.scene.background = tex(bakeHall());

    const key = new DirectionalLight(0xfff4e8, 1.6);
    key.position.set(-250, 350, 600);
    this.scene.add(key);
    this.lcdLight = new PointLight(0x8a5cff, 60, 0, 1);
    this.toWorld(LCD_RECT.x + LCD_RECT.w / 2, LCD_RECT.y + LCD_RECT.h / 2, 45, this.lcdLight.position);
    this.scene.add(this.lcdLight);
    this.hesoLight = new PointLight(0xff3050, 0, 0, 1);
    this.scene.add(this.hesoLight);

    this.scene.add(this.buildBoardPlate());
    this.scene.add(this.buildNails());
    this.scene.add(this.buildRails());
    const heso = this.buildHeso();
    this.hesoMat = heso.material as MeshStandardMaterial;
    this.scene.add(heso);
    for (const y of board.yakumono) this.scene.add(this.buildYakumono(y));
    this.scene.add(this.buildYakuRings());

    const atlas = tex(bakeSymbolAtlas());
    const texts = packTexts();
    this.lcd = new LcdReels(
      atlas,
      tex(bakeTextAtlas(texts)),
      texts.length,
      (id) => this.patterns(id)?.hot ?? 0,
      (text) => texts.indexOf(text),
    );
    this.toWorld(LCD_RECT.x + LCD_RECT.w / 2, LCD_RECT.y + LCD_RECT.h / 2, 0, this.lcdCenter);
    this.scene.add(this.buildLcd());

    this.scene.add(this.cabinet.group);
    this.scene.add(this.buildGlass());

    // 玉: ジオメトリとマテリアルを全玉で共有（spec/50）。
    const ballGeo = new SphereGeometry(BALL_RADIUS_MM, 28, 18);
    const ballMat = (this.ballMat = new MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 }));
    for (let i = 0; i < MAX_BALLS; i++) {
      const m = new Mesh(ballGeo, ballMat);
      m.visible = false;
      this.ballMeshes.push(m);
      this.scene.add(m);
    }
    this.ballShadows = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0x000000, alphaMap: tex(bakeSoftDot()), transparent: true, opacity: 0.55, depthWrite: false }),
      MAX_BALLS,
    );
    this.ballShadows.frustumCulled = false;
    this.scene.add(this.ballShadows);
    this.scene.add(this.buildTrayBalls(ballGeo, ballMat));

    this.rainbow = new Mesh(new PlaneGeometry(2, 2), rainbowMaterial());
    this.rainbow.frustumCulled = false;
    this.rainbow.renderOrder = 999;
    this.rainbow.visible = false;
    this.scene.add(this.rainbow);
    this.flashLayer = new FlashLayer();

    const rt = new WebGLRenderTarget(1, 1, { samples: 4, type: HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // しきい値 2.5 で LED・発光部（ランプ・液晶・虹）だけを光らせる（spec/50）。
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.7, 0.35, 2.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.tracks = new BallTracks(board, dirs);
    this.resize();
    this.updateCamera(performance.now());
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.setRunning(true);
  }

  get info(): DrawInfo {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  /** 玉を描く時刻（時計 − 表示の遅れ。Engine の 1Hz より先に発射を知るため, D-063）。 */
  displayNow(): number {
    return this.clock.now() - DISPLAY_LAG_MS * this.clock.scale;
  }

  /** Engine から届いた玉（重複は BallTracks が除く）。 */
  addShots(shots: readonly Shot[]): void {
    this.tracks.add(shots, this.displayNow(), PREROLL_MS * this.clock.scale);
  }

  /** 役物の Lv・位相・周期（位相は時刻 at の値）。 */
  setYakumono(states: readonly YakumonoState[], at: number): void {
    this.yakuStates = states;
    this.yakuAt = at;
    this.yaku.forEach((y, i) => {
      // 未解放は暗く表示（spec/50）。
      const on = (states[i]?.lv ?? 0) > 0;
      y.material.emissiveIntensity = on ? 0.6 : 0.04;
      y.material.opacity = on ? 0.9 : 0.45;
    });
  }

  /** Engine の前進結果（液晶の保留・変動・大当たり。盤面の玉と同じ表示時刻で再生する）。 */
  pushView(projection: HallProjection, events: readonly EngineSimEvent[]): void {
    this.lcdTimeline.push(projection, events);
  }

  /** 機種のラウンドの中身（大当たり中のラウンド・出玉の表示, D-077）。 */
  setRound(round: JackpotRound): void {
    this.round = round;
  }

  /**
   * 大当たり中の表示に合わせて鳴らす: 2ラウンド目からの各ラウンドの始め（round）・上乗せ（uwanose）・結果の告知（rush_in など）。
   * Debug の倍速では鳴らさない。
   */
  private noteHud(st: LcdState, hud: HudView | null, scale: number): void {
    const heard = this.hudHeard;
    const j = st.jackpot;
    const roundKey = j && hud?.k === 'round' ? `${j.entry}:${hud.round}` : '';
    const newRound = roundKey !== '' && roundKey !== heard.round && heard.round.startsWith(`${j!.entry}:`);
    heard.round = roundKey || heard.round;
    const bonusAt = j?.bonus?.at ?? -1;
    const newBonus = hud?.k === 'round' && hud.bonus !== null && bonusAt !== heard.bonus;
    if (hud?.k === 'round' && hud.bonus !== null) heard.bonus = bonusAt;
    const resultAt = hud?.k === 'result' ? st.result!.at : -1;
    const newResult = resultAt >= 0 && resultAt !== heard.result;
    if (resultAt >= 0) heard.result = resultAt;
    const upperCue = j && hud?.k === 'round' ? this.noteUpper(j.entry, hud) : null;
    if (scale !== 1 || !hud) return;
    const serial = j?.entry ?? 0;
    if (upperCue) playHudCue(upperCue, this.seed, serial);
    else if (newBonus) playHudCue('uwanose', this.seed, serial);
    else if (newRound && !(hud.k === 'round' && hud.upper?.frozen)) playHudCue('round', this.seed, serial);
    if (newResult && hud.k === 'result' && hud.t < 1000) {
      this.lcd.pulse();
      playHudCue(resultCue(hud.kind), this.seed, 0);
    }
  }

  /**
   * 上位RUSH・上乗せの時刻表（hud.upper）が進んだら鳴らすパックの演出を返す: フリーズ・ひびの各段・割れる・数字・終了（D-120）。
   * 途中から開いた時（背面から戻った時など）は、過ぎた段は鳴らさず、出たばかりの告知だけ鳴らす。
   */
  private noteUpper(entry: number, hud: Extract<HudView, { k: 'round' }>): string | null {
    const h = this.upperHeard;
    const u = hud.upper;
    const first = h.entry !== entry;
    if (first) Object.assign(h, { entry, crack: u?.crack ?? 0, frozen: u?.frozen ?? false, banner: '' });
    if (!u) return null;
    let cue: string | null = null;
    if (u.frozen && !h.frozen) cue = UPPER_CUES.freeze;
    h.frozen = u.frozen;
    if (u.crack > h.crack) cue = UPPER_CUES.crack;
    h.crack = u.crack;
    const b = u.banner;
    const key = b ? `${b.k}:${b.digit ?? ''}:${Math.round(hud.t - b.t)}` : '';
    if (b && key !== h.banner && (!first || b.t < 600)) cue = UPPER_BANNER_CUES[b.k];
    h.banner = key;
    return cue;
  }

  /** 演出の分岐に使う seed（Engine の GameMeta, spec/43）。 */
  setSeed(seed: number): void {
    this.seed = seed;
  }

  /** 今の機種の取得時のモード → 先バレの材料（機種を替えたら呼び直す）。 */
  setOdds(oddsOf: OddsOf): void {
    this.oddsOf = oddsOf;
  }

  /** 抽選カスタム（設定）。この後に取得する保留から効く（取った保留は取得時の値のまま）。 */
  setSakibareCustom(custom: SakibareCustom): void {
    this.lcdTimeline.custom = custom;
  }

  /** 演出プレビュー・留守中リプレイ（次に描くフレームから実時間で流す）。 */
  playPreview(p: PreviewSpin): void {
    this.preview = { ...p, start: -1 };
  }

  /** 当たり演出（3秒。連打したら頭から）。 */
  win(): void {
    this.winMs = 0;
  }

  /** 当たり演出のブルーム（設定の「光のにじみ」。OFF なら composer を通さない）。 */
  /** 見た目の解放（金のランプ・夜桜・クローム・金の玉・殿堂入り, spec/25）。既存の描画の色・値の差し替えだけ。 */
  setLook(look: Look): void {
    if (sameLook(look, this.look)) return;
    this.look = look;
    const base = look.cabinet === 'gold' ? PALETTES.gold : look.cabinet === 'chrome' ? PALETTES.chrome : PALETTES['pearl-violet'];
    this.cabinet.setPalette(look.lamp === 'gold' ? { ...base, led: 0xffd877 } : base);
    this.ballMat.color.setHex(look.ball === 'gold' ? 0xffd34d : 0xffffff);
    this.ballMat.roughness = look.ball === 'gold' ? 0.2 : 0.08;
    this.lcd.setTheme(look.lcd === 'sakura', look.title);
  }

  setBloom(on: boolean): void {
    this.bloomOn = on;
  }

  setRunning(running: boolean): void {
    this.last = 0;
    if (!running) setLcdView(null);
    setFlashTarget(this.flashLayer, running);
    setSceneTarget(this.onSceneCue, running);
    this.renderer.setAnimationLoop(running ? (t) => this.frame(t) : null);
  }

  takeStats(): FrameStats {
    const f = this.frameMs;
    this.frameMs = [];
    return summarize(f);
  }

  destroy(): void {
    this.setRunning(false);
    this.flashLayer.dispose();
    this.resizeObs.disconnect();
    this.composer.dispose();
    this.scene.traverse((o) => {
      if (o instanceof Mesh) {
        (o.geometry as BufferGeometry).dispose();
        const mats = (Array.isArray(o.material) ? o.material : [o.material]) as Material[];
        mats.forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** 盤面座標（左上原点・+y 下）→ ワールド座標（中心原点・+y 上）。y の向きの変換はここだけ。 */
  private toWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
    return out.set(x - this.board.widthMm / 2, this.board.heightMm / 2 - y, z);
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // 筐体が縦横どちらにも収まる距離（ボタン・ハンドルが手前に張り出す分を足す）。
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    const needH = (CAB.top - CAB.bottom + 24) / 2 / t;
    const needW = (CAB.halfW * 2 + 16) / 2 / (t * this.camera.aspect);
    this.homeDist = Math.max(needH, needW) + 50;
    this.camera.updateProjectionMatrix();
  }

  private frame(now: number): void {
    this.renderer.info.reset();
    const raw = this.last === 0 ? 16.7 : now - this.last;
    this.last = now;
    this.frameMs.push(raw);
    const dt = Math.min(raw, 50);
    this.elapsed += dt;
    const sec = this.elapsed / 1000;

    let winLevel = 0;
    let white = 0;
    if (this.winMs >= 0) {
      this.winMs += dt;
      const w = this.winMs;
      winLevel = w < 150 ? w / 150 : w < WIN_MS - 500 ? 1 : Math.max(0, (WIN_MS - w) / 500);
      white = Math.max(0, 1 - w / 260);
      if (w >= WIN_MS) this.winMs = -1;
    }
    const winning = this.winMs >= 0;

    const display = this.displayNow();
    this.tracks.update(display, (kind) => {
      if (kind !== 'start1') return;
      this.hesoFlash = 1;
      // ヘソ入賞の軽い音（先バレとは別の小さな正弦波）。Debug の倍速では鳴らさない。
      if (this.clock.scale === 1) playHesoCue(HESO_CUE, this.seed, 0);
    });
    const clockNow = performance.now();
    let lcdState = this.lcdTimeline.advance(display);
    let lcdNow = display;
    let lcdScale = this.clock.scale;
    const pv = this.previewState(clockNow);
    if (pv) {
      // プレビュー中は Engine の液晶を止めて、実時間でプレビューの変動を映す。
      lcdState = pv;
      lcdNow = clockNow;
      lcdScale = 1;
    }
    // ホールの状態行・持ち玉を、液晶が映している状態に揃える（プレビュー・Debug の倍速は Projection のまま, P13-T4）。
    if (pv || this.clock.scale !== 1) {
      setLcdView(null);
    } else {
      const pend = this.lcdTimeline.pending();
      const rush = lcdState.rush;
      setLcdView({
        jackpot: lcdState.jackpot ? { rounds: lcdState.jackpot.rounds } : null,
        mode: rush?.mode ?? 'normal',
        chain: rush?.chain ?? 0,
        pendingJackpots: pend.jackpots,
        pendingPayout: pend.payout,
      });
    }
    // 見せる色（保留変化）。割れる変動は図柄と演出の起点を割れた後へずらす（D-075）。
    const shown = shownLcdState(lcdState, this.seed, lcdNow, this.oddsOf);
    this.startShow(shown, lcdNow, lcdScale);
    const jackpot = lcdState.jackpot?.entry ?? -1;
    if (jackpot !== this.lastJackpot) {
      this.lastJackpot = jackpot;
      if (jackpot >= 0) {
        this.win();
        playCue('jackpot', this.seed, jackpot);
      }
    }
    this.hesoFlash = Math.max(0, this.hesoFlash - dt / 500);
    this.updateBalls();
    this.updateYakumono(display, winLevel);
    this.noteSakibare(lcdState, lcdNow, lcdScale);
    this.noteHoldChanges(shown, lcdScale);
    this.lcd.reducedMotion = this.flashLayer.reducedMotion;
    // 上位RUSH・ガセのプレビューは、上位の枝の無い機種でも流す。
    const req = pv ? this.preview : null;
    const round = req && (req.upper || req.gase) && !this.round.upper ? { ...this.round, upper: PREVIEW_UPPER_SPEC } : this.round;
    const hud = jackpotHud(lcdState, lcdNow, round, this.seed);
    this.noteHud(lcdState, hud, lcdScale);
    this.lcd.update(dt, lcdNow, lcdScale, shown, (e) => this.lcdTimeline.peekResult(e), winLevel, this.show, hud);
    this.updateLamps(sec, winLevel, white);
    this.updateCamera(clockNow);
    // 保留の色が広がる光（wash）の起点は画面上の液晶の中心。
    this.scratch.copy(this.lcdCenter).project(this.camera);
    this.flashLayer.origin.set((this.scratch.x + 1) / 2, (this.scratch.y + 1) / 2);

    this.rainbow.visible = winning;
    if (winning) {
      const u = this.rainbow.material.uniforms;
      u.uTime!.value = sec;
      // 明滅は 3回/秒未満（約2.4回/秒）、reduced-motion では明滅させない（spec/43）。
      const pulse = this.flashLayer.reducedMotion ? 1 : 0.5 + 0.5 * Math.abs(Math.sin(this.winMs * 0.0075));
      u.uAmt!.value = winLevel * pulse;
      // 全画面の白は FlashLayer（jackpot キュー）が 3回/秒・輝度の制限付きで出す。
      u.uWhite!.value = 0;
    }

    // ブルームは bloom キューの期間だけ（常時は重いので使わない, spec/50）。
    const bloom = this.bloomOn ? this.flashLayer.bloomStrength(clockNow) : 0;
    if (bloom > 0) {
      this.bloom.strength = bloom;
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
    this.flashLayer.render(this.renderer, clockNow);
  }

  /** プレビューの液晶の状態（変動 → 当たり/ハズレの表示 → 終了で Engine の液晶に戻る）。 */
  private previewState(now: number): LcdState | null {
    const pv = this.preview;
    if (!pv) return null;
    if (pv.start < 0) pv.start = now;
    const t = now - pv.start;
    if ((pv.upper || pv.gase) && pv.pattern === '') {
      // 上位RUSH・ガセ（Debug）: 変動は省いて大当たりから流す（ST 中の当たり）。
      const rounds = upperPreviewRounds(pv);
      if (t >= rounds * this.round.msPerRound + PREVIEW_TAIL_MS) {
        this.preview = null;
        return null;
      }
      return upperPreviewState(pv, pv.start);
    }
    const ms = pv.durationMs ?? this.patterns(pv.pattern)?.ms ?? 20000;
    if (t < ms) {
      const spin = {
        entry: pv.serial,
        pattern: pv.pattern,
        startAt: pv.start,
        endsAt: pv.start + ms,
        color: pv.color,
        hit: pv.hit,
        addedAt: null,
        ...(pv.breaks ? { breaks: true } : {}),
      };
      return { holds: [], spin, resolved: null, jackpot: null };
    }
    // 上位の当たりのリプレイ（留守中）は、上乗せまで通して見せる。
    const tail = pv.upper ? upperPreviewRounds(pv) * this.round.msPerRound : PREVIEW_TAIL_MS;
    if (t < ms + tail) {
      const jackpot = pv.hit
        ? { entry: pv.serial, kind: pv.kind ?? 'kakuhen', rounds: pv.upper ? upperPreviewRounds(pv) : (pv.rounds ?? 10), startAt: pv.start + ms, ...(pv.upper ? { upper: pv.upper } : {}) }
        : null;
      return { holds: [], spin: null, resolved: { entry: pv.serial, hit: pv.hit }, jackpot, ...(pv.upper ? { rush: { mode: 'st' as const, chain: 1, balls: 0 } } : {}) };
    }
    this.preview = null;
    return null;
  }

  /**
   * 変動が始まったら演出を決める（分岐は RNGStream(seed, 'presentation', entry)、尺は実際の変動時間, D-067）。
   * 液晶のシーンは LcdReels が描き、音・光・振動・揺れ・カメラは CuePlayer が実時間で鳴らす（Debug の倍速では鳴らさない）。
   * 保留が割れる変動（D-075）は hold_crack を鳴らし、図柄と演出は割れた後（HOLD_BREAK_MS.reels。短い変動は holdBreakScale で縮める）から残りの尺で流す。
   */
  private startShow(st: LcdState, now: number, scale: number): void {
    const spin = st.spin;
    if (!spin || spin.entry === this.show?.entry) return;
    const patternMs = this.patterns(spin.pattern)?.ms ?? spin.endsAt - (spin.startAt ?? now);
    // Projection から作った変動は開始時刻が分からないので、パターンの尺から逆算する。
    const start = spin.startAt ?? spin.endsAt - patternMs;
    // 短い変動は割れる演出を縮めて、割れた後にも図柄が回るようにする。
    const k = holdBreakScale(spin.endsAt - start);
    const origin = spin.breaks ? Math.min(start + HOLD_BREAK_MS.reels * k, spin.endsAt - 1) : start;
    const plan = planFor(spin.pattern, this.seed, spin.entry, patternMs, spin.endsAt - origin);
    this.show = { entry: spin.entry, origin, lcd: plan.lcd };
    if (scale !== 1) return;
    playCues(plan.cues, now - origin);
    if (spin.breaks && now - start < HOLD_BREAK_MS.reveal * k) playBreakCue(HOLD_CRACK_CUE, this.seed, spin.entry, now - start, k);
  }

  /**
   * 見せる色が上がった保留（割れて最終色が出た時, D-075）を光らせ、パックの hold_<色> を鳴らす。
   * Debug の倍速では液晶だけ（音・光は鳴らさない, D-067）。
   */
  private noteHoldChanges(st: LcdState, scale: number): void {
    const next = new Map<number, LotteryHoldColor>();
    const see = (entry: number, color: LotteryHoldColor | null) => {
      if (entry < 0 || color === null) return;
      const prev = this.shownColors.get(entry);
      if (prev !== undefined && holdRank(color) > holdRank(prev)) {
        this.lcd.pulse();
        if (scale === 1) playBreakCue(holdChangeCue(color), this.seed, entry);
      }
      next.set(entry, color);
    };
    for (const h of st.holds) see(h.entry, h.color);
    if (st.spin) see(st.spin.entry, st.spin.color);
    this.shownColors = next;
  }

  /**
   * 先バレ（D-074）: 玉が入ってすぐ保留を光らせ、パックの sakibare を鳴らす（色が上がるのは取得時の変化で、そこで hold_<色> が鳴る）。
   * 時刻を大きく過ぎてから気付いた先バレ（背面から戻った時など）は鳴らさない。Debug の倍速では液晶だけ。
   */
  private noteSakibare(st: LcdState, now: number, scale: number): void {
    const { fire, next } = fireSakibares(sakibareTimes(st, this.seed, this.oddsOf), this.sakibareDone, now, SAKIBARE_LATE_MS);
    for (const { entry, sound } of fire) {
      this.lcd.pulse();
      if (sound && scale === 1) playSideCue(SAKIBARE_CUE, this.seed, entry);
    }
    this.sakibareDone = next;
  }

  /** 盤面が受け持つキュー: 揺れと液晶への寄り（spec/43 shake・camera）。 */
  private readonly onSceneCue = (cue: SceneCue, offsetMs: number, nowMs: number): void => {
    if (cue.kind === 'shake') this.cueShake = { until: nowMs - offsetMs + cue.ms, amp: cue.amp };
    else if (cue.kind === 'camera' && cue.shot === 'lcd') this.cueCam = { from: nowMs - offsetMs, ms: cue.ms };
  };

  private updateBalls(): void {
    const balls = this.tracks.balls;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const m = this.ballMeshes[i];
      if (!b || !m) continue;
      m.visible = b.active;
      if (b.active) {
        this.toWorld(b.x, b.y, Z_BALL, m.position);
        this.toWorld(b.x + 2.4, b.y + 3.4, 0.4, this.tmp.position);
        this.tmp.scale.setScalar(BALL_RADIUS_MM * 2.6);
      } else {
        this.tmp.scale.setScalar(0);
      }
      this.tmp.updateMatrix();
      this.ballShadows.setMatrixAt(i, this.tmp.matrix);
    }
    this.ballShadows.instanceMatrix.needsUpdate = true;
  }

  /** 角度 = 位相 +（表示時刻 − at）/ 周期。表示時刻は遅れているので at より前でもよい。 */
  private updateYakumono(display: number, winLevel: number): void {
    this.yaku.forEach((y, i) => {
      const st = this.yakuStates[i];
      if (!st || st.lv <= 0 || !st.periodS) return;
      const turns = (st.phase ?? 0) + (display - this.yakuAt) / 1000 / st.periodS;
      y.group.rotation.z = y.dir * Math.PI * 2 * (turns - Math.floor(turns));
      y.material.emissiveIntensity = 0.6 + winLevel * 1.2;
    });
  }

  private updateLamps(sec: number, winLevel: number, white: number): void {
    const reach = this.lcd.reach ? 1 : 0;
    const blink = Math.sin(sec * 50) > 0 ? 1 : 0.35;
    // 筐体の LED・エンブレム・ボタン（通常は氷色の流れ、リーチで赤、当たりで虹）。
    this.cabinet.update({ sec, reach, win: winLevel, boost: this.hesoFlash * 0.8 + white * 2, blink });

    this.hesoMat.emissiveIntensity = 0.5 + this.hesoFlash * 4 + winLevel * 2 * blink;
    const hb = this.board.sensors.find((s) => s.kind === 'start1');
    if (hb) this.toWorld(hb.x + hb.w / 2, hb.y, 25, this.hesoLight.position);
    this.hesoLight.intensity = this.hesoFlash * 40;

    // 液晶の光が釘と玉に映る（色は液晶の雰囲気に合わせる）。
    if (winLevel > 0) this.lcdLight.color.setHSL((sec * 0.6) % 1, 1, 0.6);
    else if (reach) this.lcdLight.color.setHSL(0.99, 1, 0.5);
    else this.lcdLight.color.setHSL(0.72, 0.8, 0.62);
    this.lcdLight.intensity = 50 + winLevel * 25 + reach * 20;
  }

  private updateCamera(nowMs: number): void {
    // 当たりの瞬間だけ寄って揺らし、1.2 秒で定位置に戻す。
    let zoom = 1;
    let shake = 0;
    if (this.winMs >= 0) {
      const w = this.winMs;
      zoom = w < 180 ? 1 - 0.07 * (w / 180) : 1 - 0.07 * Math.max(0, 1 - (w - 180) / 1000);
      shake = Math.max(0, 1 - w / 600) * 3;
    }
    // shake キュー（amp 1 ≒ 5mm。終わりに向けて弱める）。
    const sk = this.cueShake;
    if (nowMs < sk.until && !this.flashLayer.reducedMotion) shake = Math.max(shake, sk.amp * 5 * Math.min(1, (sk.until - nowMs) / 300));
    // camera キュー（液晶へ寄る）。入り・抜けは 400ms、終わったら必ず定位置（spec/50）。
    const ct = nowMs - this.cueCam.from;
    const lcd = ct >= 0 && ct < this.cueCam.ms ? ease(Math.min(1, ct / 400, (this.cueCam.ms - ct) / 400)) : 0;
    const d = this.homeDist * zoom * (1 - 0.28 * lcd);
    const ty = this.homeY + (this.lcdCenter.y - this.homeY) * lcd;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    // 正面からわずかに見上げる。
    this.camera.position.set(sx, ty - 45 * (1 - lcd) + sy, d);
    this.camera.lookAt(sx * 0.5, ty + sy * 0.5, 0);
  }

  // ---- 組み立て ----

  private buildBoardPlate(): Mesh {
    const map = tex(bakeBoard(this.board));
    map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    // つや消し（roughness 0.85）。セル画の発色は弱い emissive で持ち上げる（つやを上げると白く飛ぶ）。
    const mat = new MeshStandardMaterial({ map, roughness: 0.85, metalness: 0, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.4 });
    const m = new Mesh(new PlaneGeometry(this.board.widthMm, this.board.heightMm), mat);
    return m;
  }

  private buildNails(): InstancedMesh {
    // 真鍮の釘: 細い軸＋丸い頭（旋盤形状）。軸を +z に向ける。
    const profile = [
      new Vector2(0, 0),
      new Vector2(1, 0),
      new Vector2(1, 10.6),
      new Vector2(1.7, 11),
      new Vector2(1.6, 11.8),
      new Vector2(1.0, 12.3),
      new Vector2(0, 12.4),
    ];
    const geo = new LatheGeometry(profile, 12);
    geo.rotateX(Math.PI / 2);
    const mat = new MeshStandardMaterial({ color: 0xe0b050, metalness: 1, roughness: 0.28 });
    const pins = this.board.pins;
    const mesh = new InstancedMesh(geo, mat, pins.length);
    pins.forEach((pin, i) => {
      this.toWorld(pin.p.x, pin.p.y, 0, this.tmp.position);
      const s = pin.r / 1.1;
      this.tmp.scale.set(s, s, 1);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(i, this.tmp.matrix);
    });
    this.tmp.scale.set(1, 1, 1);
    return mesh;
  }

  private buildRails(): Mesh {
    const a = new Vector3();
    const b = new Vector3();
    const geos = this.board.segments.map((s) => {
      this.toWorld(s.a.x, s.a.y, 6, a);
      this.toWorld(s.b.x, s.b.y, 6, b);
      const len = a.distanceTo(b);
      const g = new BoxGeometry(len + 2.4, 2.4, 12);
      g.rotateZ(Math.atan2(b.y - a.y, b.x - a.x));
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, 6);
      return g;
    });
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    return new Mesh(merged ?? new BufferGeometry(), new MeshStandardMaterial({ color: 0xe8ecf4, metalness: 1, roughness: 0.16 }));
  }

  private buildHeso(): Mesh {
    const s = this.board.sensors.find((x) => x.kind === 'start1');
    const parts: BufferGeometry[] = [];
    if (s) {
      const add = (x: number, y: number, w: number, h: number, rot: number) => {
        const g = new BoxGeometry(w, h, 9);
        g.rotateZ(rot);
        const p = this.toWorld(x, y, Z_YAKU, new Vector3());
        g.translate(p.x, p.y, p.z);
        parts.push(g);
      };
      add(s.x + s.w / 2, s.y + s.h + 1.5, s.w + 6, 3, 0); // 受け皿
      add(s.x - 1.5, s.y + s.h / 2 - 1, 3, s.h + 4, 0); // 左柱
      add(s.x + s.w + 1.5, s.y + s.h / 2 - 1, 3, s.h + 4, 0); // 右柱
      add(s.x - 8, s.y - 3, 13, 2.5, -0.55); // 左の羽
      add(s.x + s.w + 8, s.y - 3, 13, 2.5, 0.55); // 右の羽
    }
    const geo = mergeGeometries(parts) ?? new BufferGeometry();
    parts.forEach((g) => g.dispose());
    const mat = new MeshStandardMaterial({
      color: 0xff2a4a,
      emissive: 0xff2040,
      emissiveIntensity: 0.5,
      metalness: 0.1,
      roughness: 0.2,
      transparent: true,
      opacity: 0.92,
    });
    return new Mesh(geo, mat);
  }

  private buildYakumono(y: BoardYakumono): Group {
    const st = YAKU_STYLE[y.id] ?? YAKU_DEFAULT;
    const g = new Group();
    const len = y.r + 3;
    // 角ばった羽根（根元が細く先が広い、少し後退角）。透明の樹脂が内側から光る。
    const w0 = len * 0.1;
    const w1 = len * (st.blades <= 2 ? 0.24 : st.blades >= 6 ? 0.26 : 0.36);
    const blade = new Shape();
    blade.moveTo(-w0, len * 0.3);
    blade.lineTo(w0, len * 0.3);
    blade.lineTo(w1 + len * 0.08, len * 0.94);
    blade.lineTo(len * 0.08 - w1 * 0.4, len);
    blade.lineTo(-w1 * 0.8, len * 0.9);
    blade.closePath();
    const parts: BufferGeometry[] = [];
    for (let k = 0; k < st.blades; k++) {
      const b = new ExtrudeGeometry(blade, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 1 });
      b.translate(0, 0, -0.8);
      b.rotateZ((k / st.blades) * Math.PI * 2);
      parts.push(b);
    }
    const material = new MeshStandardMaterial({
      color: st.color,
      emissive: st.color,
      emissiveIntensity: 0.04,
      metalness: 0.2,
      roughness: 0.12,
      transparent: true,
      opacity: 0.45,
    });
    const blades = new Mesh(mergeGeometries(parts) ?? new BufferGeometry(), material);
    parts.forEach((p) => p.dispose());
    g.add(blades);
    this.toWorld(y.p.x, y.p.y, Z_YAKU, g.position);
    this.yaku.push({ group: g, material, dir: this.yaku.length % 2 ? -1 : 1 });
    return g;
  }

  /** 役物のクロームの輪と軸（回らない部分。全役物で1メッシュ）。 */
  private buildYakuRings(): Mesh {
    const geos: BufferGeometry[] = [];
    for (const y of this.board.yakumono) {
      const len = y.r + 3;
      const p = this.toWorld(y.p.x, y.p.y, Z_YAKU, new Vector3());
      const ring = new TorusGeometry(len + 1.6, 1.1, 8, 40);
      ring.translate(p.x, p.y, p.z - 0.5);
      const hub = new CylinderGeometry(len * 0.3, len * 0.3, 4, 20);
      hub.rotateX(Math.PI / 2);
      hub.translate(p.x, p.y, p.z + 1);
      geos.push(ring, hub);
    }
    const merged = mergeGeometries(geos) ?? new BufferGeometry();
    geos.forEach((g) => g.dispose());
    return new Mesh(merged, this.cabinet.chrome);
  }

  private buildLcd(): Group {
    const g = new Group();
    const { x, y, w, h } = LCD_RECT;
    const screen = new Mesh(new PlaneGeometry(w, h), this.lcd.material);
    this.toWorld(x + w / 2, y + h / 2, Z_LCD, screen.position);
    g.add(screen);
    // クロームの額縁＋アクセント色の内枠＋外周の LED（玉の中心より奥に置く）。
    const outer = roundedRectShape(w + 12, h + 12, 8);
    outer.holes.push(roundedRectShape(w + 3, h + 3, 5));
    const bezel = new Mesh(
      new ExtrudeGeometry(outer, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 2, curveSegments: 6 }),
      this.cabinet.chrome,
    );
    bezel.position.copy(screen.position);
    bezel.position.z = Z_LCD + 0.2;
    g.add(bezel);
    const inner = roundedRectShape(w + 3, h + 3, 5);
    inner.holes.push(roundedRectShape(w, h, 4));
    const trim = new Mesh(
      new ExtrudeGeometry(inner, { depth: 0.8, bevelEnabled: false, curveSegments: 6 }),
      new MeshStandardMaterial({ color: 0x7a3cff, emissive: 0x7a3cff, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.25 }),
    );
    trim.position.copy(screen.position);
    trim.position.z = Z_LCD + 0.2;
    g.add(trim);
    const led = new Mesh(ledTube(roundedRectShape(w + 16, h + 16, 10).getSpacedPoints(120), 0, 0.9, 0, true), this.cabinet.led);
    led.position.copy(screen.position);
    led.position.z = Z_LCD + 1.6;
    g.add(led);
    return g;
  }

  private buildGlass(): Mesh {
    const glare = tex(bakeGlare());
    const m = new Mesh(
      new PlaneGeometry(this.board.widthMm + 2, this.board.heightMm + 2),
      // 黒の加算合成で、環境の映り込みと斜めの光の帯だけを足す（白く曇らせない, spec/50）。
      new MeshStandardMaterial({
        color: 0x000000,
        metalness: 0,
        roughness: 0.03,
        envMapIntensity: 0.25,
        emissive: 0xffffff,
        emissiveMap: glare,
        emissiveIntensity: 0.1,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    m.position.z = Z_GLASS;
    return m;
  }

  /** 上皿に溜まった玉（静的。InstancedMesh 1つ）。 */
  private buildTrayBalls(geo: SphereGeometry, mat: MeshStandardMaterial): InstancedMesh {
    // 上皿の溝（左右の暗い溝、x ±70〜214・y -248〜-276）に溜まった玉。
    const r = BALL_RADIUS_MM;
    const pos: [number, number, number][] = [];
    const z = 26 + r;
    for (let k = 0; k < 12; k++) pos.push([-208 + k * r * 2, -276 + r + 0.5, z]);
    for (let k = 0; k < 8; k++) pos.push([-203 + k * r * 2, -276 + r * 2.6, z + 1]);
    for (let k = 0; k < 5; k++) pos.push([78 + k * r * 2, -276 + r + 0.5, z]);
    const mesh = new InstancedMesh(geo, mat, pos.length);
    pos.forEach(([x, y, z], i) => {
      this.tmp.position.set(x, y, z);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(i, this.tmp.matrix);
    });
    return mesh;
  }
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function tex(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function roundedRectShape(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const HUE_GLSL = /* glsl */ `
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`;

/** 当たり演出: 画面全体に加算で重ねる虹と白フラッシュ（クリップ空間に直接描く, spec/43 の FlashLayer）。 */
function rainbowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uWhite: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAmt, uWhite;
      varying vec2 vUv;
      ${HUE_GLSL}
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p);
        float ang = atan(p.y, p.x);
        // 斜めに流れる虹の帯 + 中心から広がる光条。
        vec3 band = hue(vUv.x * 0.8 + vUv.y * 0.6 - uTime * 0.9);
        // 加算は sRGB 変換で暗部が大きく持ち上がるので、光は細い筋と外周に絞る（中央の台を白く曇らせない）。
        float rays = pow(0.5 + 0.5 * sin(ang * 12.0 - uTime * 5.0), 18.0) * smoothstep(0.08, 0.45, r);
        float ringWave = 1.0 - smoothstep(0.0, 0.035, abs(r - fract(uTime * 0.8) * 0.9));
        float edge = smoothstep(0.38, 0.85, r);
        vec3 col = band * (0.45 * edge * edge) + hue(ang / 6.2832 + uTime) * (rays * 0.4 + ringWave * 0.3);
        col = col * uAmt + vec3(1.0, 0.95, 0.85) * uWhite * 1.2;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
}
