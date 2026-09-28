import { CanvasTexture, SRGBColorSpace, ShaderMaterial, Vector3, Vector4, type Texture } from 'three';
import type { LotteryHoldColor } from '@ph/core';
import { HOLD_BREAK_MS, HOLD_CRACK_STEPS_MS, holdBreakScale } from '@ph/fx';
import type { LcdCue } from '@ph/shared';
import { HudCanvas } from './hud-canvas.ts';
import type { HudView } from './jackpot-hud.ts';
import { NO_LOOK, lcdLook, pseudoWindows, reachAt, type LcdLook } from './lcd-scenes.ts';
import { isGrantHold, type LcdSpin, type LcdState } from './lcd-timeline.ts';

const SPIN_SPEED = 16; // 図柄/秒
const STOP_MS = 380;
const SYMBOLS = 9;
const SEVEN = 6; // アトラスの 7 の添字

/** 保留の色 → シェーダーの番号（0 は空き。1,2 は丸・3 はひし形・4 は4点の星・5 は5点の星, spec/40 の色＋形）。 */
export const HOLD_CODE: Record<LotteryHoldColor, number> = { white: 1, blue: 2, green: 3, red: 4, gold: 5 };

/** 保留の横位置（次の保留が当該保留のすぐ左、そこから左へ順に並ぶ, D-078）。5つ目は1つずれる動きの出どころ。 */
const HOLD_X = [0.4, 0.325, 0.25, 0.175, 0.1] as const;
const HOLD_Y = 0.095;
const HOLD_SIZE = 0.04;
/** 当該変動の保留（中央下に大きく）。 */
const CUR_X = 0.5;
const CUR_Y = 0.1;
const CUR_SIZE = 0.058;
/** 変動開始で保留が左から右へ1つずれる時間（実時間）。 */
const SHIFT_MS = 350;

interface Reel {
  pos: number;
  vel: number;
  mode: 'spin' | 'stopping' | 'stopped';
  from: number;
  to: number;
  t: number;
  target: number;
}

/** 変動1回の演出（CueSheet の lcd キュー。origin は変動開始の時刻, D-067）。 */
export interface SpinShow {
  readonly entry: number;
  readonly origin: number;
  readonly lcd: readonly LcdCue[];
}

/** 疑似連で止める図柄（揃わない並び。区間ごとにずらす）。 */
function pseudoTargets(entry: number, k: number): [number, number, number] {
  const a = (((entry + k * 5) * 2654435761) >>> 0) % SYMBOLS;
  return [a, (a + 4) % SYMBOLS, (a + 2) % SYMBOLS];
}

/** 1回の変動の出目（左・中・右）。当たりは3つ揃い、リーチのハズレは中だけ1コマずれ、通常のハズレは左右が揃わない。 */
export function spinTargets(entry: number, reach: boolean, hit: boolean): [number, number, number] {
  // 出目は通し番号から決める（同じ変動を開き直しても同じ図柄）。
  const u = ((entry * 2654435761) >>> 0) % 997;
  const a = hit && u % 3 === 0 ? SEVEN : u % SYMBOLS;
  if (hit) return [a, a, a];
  if (reach) return [a, (a + (u % 2 === 0 ? 1 : SYMBOLS - 1)) % SYMBOLS, a];
  const c = (a + 1 + (u % (SYMBOLS - 1))) % SYMBOLS;
  return [a, (u * 7) % SYMBOLS, c];
}

/**
 * 液晶の3列図柄・保留・演出シーン（spec/40, spec/43）。LcdTimeline の状態を表示時刻で映す:
 * 変動の開始で回し、左 → 右 → 中の順に止める。中は変動の終了時刻に止まる。リーチ（パターンの hot ≥ 1）は左右を
 * シートの reach の時刻（無ければ早め）に揃え、中を終了まで回して最後の 1.2 秒で減速する。疑似連の区間は3列をいったん
 * 止めて回し直す。SP・決め・群予告・テロップなどはシートの lcd キューをシェーダーで描く（図形・テキスト・パーティクルのみ）。
 * 当該変動の保留は中央下に大きく、保留は色＋形で4つまでそのすぐ左から左へ順に出し、変動開始で右へ1つずれる（D-078）。
 * 変化する保留は灰色で点滅し、変動開始で液晶の中央へ動いて
 * 大きな玉になり、ひびが入って割れ、中から最終色の保留が出て色が広がる（HOLD_BREAK_MS, D-075）。図柄はその後に回り始める。
 */
export class LcdReels {
  readonly material: ShaderMaterial;
  /** 大当たり中のラウンド・出玉と結果の告知（D-077）。 */
  private readonly hud = new HudCanvas();
  private readonly reels: Reel[] = [0, 1, 2].map((i) => ({
    pos: i * 3,
    vel: 0,
    mode: 'stopped' as const,
    from: 0,
    to: 0,
    t: 0,
    target: 0,
  }));
  private elapsed = 0;
  private spin: LcdSpin | null = null;
  private spinStart = 0;
  private isReach = false;
  private targets: [number, number, number] = [0, 0, 0];
  private stopAt: [number, number, number] = [0, 0, 0];
  private reachMs = -1;
  private flash = 0;
  private holdCount = 0;
  /** 保留が1つずれ始めた時刻（elapsed）と、ずれる保留の数（その後に来た保留は動かさない）。 */
  private shiftAt = -Infinity;
  private shiftN = 0;
  /** prefers-reduced-motion（保留の点滅と流れる光を止める, spec/43）。 */
  reducedMotion = false;
  private show: SpinShow | null = null;
  private pseudo: { from: number; to: number; state: 'wait' | 'stopped' | 'done' }[] = [];
  /** 中の図柄を最後に止めた（疑似連の停止と区別する）。 */
  private final = false;
  /** 図柄が回り始めるのを待っている（保留が割れる間, D-075）。 */
  private pending = false;

  constructor(
    atlas: Texture,
    textAtlas: Texture,
    textRows: number,
    private readonly patternHot: (pattern: string) => number = () => 0,
    private readonly textRow: (text: string) => number = () => -1,
  ) {
    this.material = lcdMaterial(atlas, textAtlas, textRows, this.hud.texture, tokuTexture());
  }

  get reach(): boolean {
    return this.reachMs >= 0;
  }

  /**
   * 表示時刻 now の状態を映す。scale は Debug の時間倍率（止まる動きは実時間なので、その分だけ早めに止め始める）。
   * peek は当否が不明な変動（Projection に揃えた直後）の結果を先読みする。
   */
  /** 保留が光る（保留変化, P7-T4）。 */
  pulse(): void {
    this.flash = 1;
  }

  update(
    dtMs: number,
    now: number,
    scale: number,
    st: LcdState,
    peek: (entry: number) => boolean | null,
    winLevel: number,
    show: SpinShow | null,
    hud: HudView | null = null,
  ): void {
    this.elapsed += dtMs;
    this.flash = Math.max(0, this.flash - dtMs / 400);
    if (st.holds.length > this.holdCount) this.flash = 1;
    this.holdCount = st.holds.length;

    if (st.spin && st.spin.entry !== this.spin?.entry) {
      this.shiftAt = this.elapsed;
      this.shiftN = st.holds.length;
      this.begin(st.spin, now, show?.entry === st.spin.entry ? show : null);
    }
    if (this.spin) this.step(dtMs, now, scale, st, peek);
    const look = this.show && this.spin ? lcdLook(this.show.lcd, now - this.show.origin, this.textRow) : NO_LOOK;
    this.setLook(look);

    const u = this.material.uniforms;
    (u.uReel!.value as Vector3).set(this.reels[0]!.pos, this.reels[1]!.pos, this.reels[2]!.pos);
    (u.uBlur!.value as Vector3).set(blur(this.reels[0]!), blur(this.reels[1]!), blur(this.reels[2]!));
    const h = st.holds.map((x) => HOLD_CODE[x.color]);
    (u.uHolds!.value as Vector4).set(h[0] ?? 0, h[1] ?? 0, h[2] ?? 0, h[3] ?? 0);
    const bk = st.holds.map((x) => (x.blink ? 1 : 0));
    (u.uBlink!.value as Vector4).set(bk[0] ?? 0, bk[1] ?? 0, bk[2] ?? 0, bk[3] ?? 0);
    u.uCur!.value = st.spin?.color ? HOLD_CODE[st.spin.color] : 0;
    const sp4 = st.holds.map((x) => (isGrantHold(x.entry) ? 1 : 0));
    (u.uToku!.value as Vector4).set(sp4[0] ?? 0, sp4[1] ?? 0, sp4[2] ?? 0, sp4[3] ?? 0);
    u.uCurToku!.value = st.spin && isGrantHold(st.spin.entry) ? 1 : 0;
    // 変動開始で残りの保留が右へ1つずれ、次の保留が当該の位置へ大きくなりながら動く（reduced-motion は動かさない）。
    const k = this.reducedMotion ? 1 : Math.min(1, (this.elapsed - this.shiftAt) / SHIFT_MS);
    const e = 1 - (1 - k) * (1 - k) * (1 - k);
    const x = [0, 1, 2, 3].map((i) => (i < this.shiftN ? HOLD_X[i + 1]! + (HOLD_X[i]! - HOLD_X[i + 1]!) * e : HOLD_X[i]!));
    (u.uHoldX!.value as Vector4).set(x[0]!, x[1]!, x[2]!, x[3]!);
    (u.uCurPos!.value as Vector3).set(
      HOLD_X[0] + (CUR_X - HOLD_X[0]) * e,
      HOLD_Y + (CUR_Y - HOLD_Y) * e,
      HOLD_SIZE + (CUR_SIZE - HOLD_SIZE) * e,
    );
    // 割れる演出は HOLD_BREAK_MS の尺で描く（短い変動は縮めた分だけ速く進める）。
    const sp = st.spin;
    const bt = sp?.breaks && sp.startAt !== null ? (now - sp.startAt) / holdBreakScale(sp.endsAt - sp.startAt) : -1;
    u.uBrk!.value = bt >= 0 && bt < HOLD_BREAK_MS.end ? bt / 1000 : -1;
    u.uTime!.value = this.elapsed / 1000;
    u.uReach!.value = this.reachMs >= 0 ? Math.min(1, this.reachMs / 300) : 0;
    u.uFlash!.value = this.flash;
    u.uWin!.value = Math.max(winLevel, st.jackpot ? 0.35 : 0);
    u.uCalm!.value = this.reducedMotion ? 1 : 0;
    this.hud.calm = this.reducedMotion;
    this.hud.update(hud);
    u.uHudOn!.value = this.hud.visible ? 1 : 0;
    u.uHudDim!.value = this.hud.dim;
  }

  private begin(spin: LcdSpin, now: number, show: SpinShow | null): void {
    this.spin = spin;
    this.show = show;
    this.spinStart = show?.origin ?? spin.startAt ?? now;
    const cueReach = show ? reachAt(show.lcd) : null;
    this.isReach = cueReach !== null || this.patternHot(spin.pattern) >= 1;
    this.targets = spinTargets(spin.entry, this.isReach, spin.hit === true);
    this.reachMs = -1;
    this.final = false;
    const d = Math.max(1, spin.endsAt - this.spinStart);
    // リーチは左右を早めに（シートがあれば reach の時刻に）揃えて中を長く見せる。通常は終了までに3列を順に止める。
    const l = cueReach !== null ? Math.max(0, cueReach - 500) : this.isReach ? Math.min(0.12 * d, 1400) : 0.45 * d;
    const r = cueReach ?? (this.isReach ? Math.min(0.2 * d, 2200) : 0.7 * d);
    this.stopAt = [this.spinStart + l, spin.endsAt, this.spinStart + r];
    // 途中から開いた時、終わった疑似連の区間は飛ばす。
    this.pseudo = (show ? pseudoWindows(show.lcd) : []).map((w) => ({
      from: this.spinStart + w.from,
      to: this.spinStart + w.to,
      state: this.spinStart + w.to <= now ? ('done' as const) : ('wait' as const),
    }));
    // 保留が割れる変動は、演出の起点（図柄が回り始める時刻）まで前の出目のまま待つ。
    this.pending = now < this.spinStart;
    if (this.pending) return;
    for (const reel of this.reels) {
      reel.mode = 'spin';
      reel.vel = SPIN_SPEED;
    }
  }

  /** 疑似連: 区間の頭で3列を止め、終わりで回し直す（左右の停止・リーチより前の区間に書く）。 */
  private stepPseudo(now: number, lead: number): boolean {
    let inPseudo = false;
    this.pseudo.forEach((w, k) => {
      if (w.state === 'wait' && now >= w.from - lead) {
        w.state = 'stopped';
        const t = pseudoTargets(this.spin!.entry, k);
        this.reels.forEach((reel, i) => this.stop(reel, t[i]!));
      }
      if (w.state === 'stopped' && now >= w.to) {
        w.state = 'done';
        for (const reel of this.reels) {
          reel.mode = 'spin';
          reel.vel = SPIN_SPEED;
        }
      }
      if (w.state === 'stopped') inPseudo = true;
    });
    return inPseudo;
  }

  private step(dtMs: number, now: number, scale: number, st: LcdState, peek: (entry: number) => boolean | null): void {
    if (this.pending) {
      for (const reel of this.reels) this.stepReel(reel, dtMs);
      if (now < this.spinStart) return;
      this.pending = false;
      for (const reel of this.reels) {
        reel.mode = 'spin';
        reel.vel = SPIN_SPEED;
      }
    }
    const spin = this.spin!;
    const [l, c, r] = this.reels as [Reel, Reel, Reel];
    const lead = STOP_MS * scale;
    const inPseudo = this.stepPseudo(now, lead);
    for (const i of [0, 2]) {
      const reel = this.reels[i]!;
      if (!inPseudo && reel.mode === 'spin' && now >= this.stopAt[i]! - lead) this.stop(reel, this.targets[i]!);
    }
    if (!inPseudo && this.isReach && this.reachMs < 0 && l.mode === 'stopped' && r.mode === 'stopped') this.reachMs = 0;
    if (this.reachMs >= 0) this.reachMs += dtMs;
    if (!inPseudo && c.mode === 'spin') {
      const left = (spin.endsAt - now) / scale;
      // リーチの最後の 1.2 秒は減速して、1コマずつ見せる。
      if (this.isReach && left < 1200) c.vel = Math.max(3.5, SPIN_SPEED * (left / 1200));
      if (now >= spin.endsAt - lead) {
        const hit = spin.hit ?? peek(spin.entry) ?? (st.resolved?.entry === spin.entry ? st.resolved.hit : null);
        // 当否が分からないうちは回し続ける（次の前進で届く）。
        if (hit !== null) {
          if (hit !== (spin.hit === true)) this.targets = spinTargets(spin.entry, this.isReach, hit);
          // 疑似連の途中で終わる変動（途中から開いた時など）でも左右は揃える。
          if (l.mode === 'spin') this.stop(l, this.targets[0]);
          if (r.mode === 'spin') this.stop(r, this.targets[2]);
          this.stop(c, this.targets[1]);
          this.final = true;
        }
      }
    }
    for (const reel of this.reels) this.stepReel(reel, dtMs);
    if (this.final && this.reels.every((x) => x.mode === 'stopped')) {
      this.spin = null;
      this.show = null;
      this.reachMs = -1;
    }
  }

  private setLook(k: LcdLook): void {
    const u = this.material.uniforms;
    (u.uScene!.value as Vector4).set(k.sp, k.climax, k.black, k.kakutei);
    (u.uScene2!.value as Vector3).set(k.kirin, k.group, k.pseudo);
    const t = k.text;
    u.uTextRow!.value = t ? t.row : -1;
    (u.uTextAnim!.value as Vector3).set(t?.mode ?? 0, t ? t.t / 1000 : 0, t?.p ?? 0);
    (u.uTextColor!.value as Vector3).set(...(t?.color ?? [1, 1, 1]));
  }

  private stop(r: Reel, target: number): void {
    r.mode = 'stopping';
    r.from = r.pos;
    let to = Math.ceil(r.pos + 1.2);
    while (((to % SYMBOLS) + SYMBOLS) % SYMBOLS !== target) to++;
    r.to = to;
    r.t = 0;
  }

  private stepReel(r: Reel, dtMs: number): void {
    if (r.mode === 'spin') {
      r.pos += (r.vel * dtMs) / 1000;
    } else if (r.mode === 'stopping') {
      r.t += dtMs;
      const k = Math.min(1, r.t / STOP_MS);
      r.pos = r.from + (r.to - r.from) * backOut(k);
      if (k >= 1) {
        r.pos = r.to % SYMBOLS;
        r.mode = 'stopped';
        r.vel = 0;
      }
    }
  }
}

/** 少し行き過ぎて戻る（図柄が止まる時の「ガコッ」）。 */
function backOut(t: number): number {
  const s = 1.9;
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

function blur(r: Reel): number {
  return r.mode === 'spin' ? Math.min(1, r.vel / SPIN_SPEED) : 0;
}

/** 特別保留の「特」の札（赤い角丸に白抜き, D-081）。 */
function tokuTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d0142c';
  ctx.strokeStyle = '#ffe9a8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(4, 4, 56, 56, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'white';
  ctx.font = 'bold 42px "Hiragino Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('特', 32, 35);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function lcdMaterial(atlas: Texture, textAtlas: Texture, textRows: number, hud: Texture, toku: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas },
      uText: { value: textAtlas },
      uTextRows: { value: Math.max(1, textRows) },
      uTextRow: { value: -1 },
      uTextAnim: { value: new Vector3() },
      uTextColor: { value: new Vector3(1, 1, 1) },
      uScene: { value: new Vector4() },
      uScene2: { value: new Vector3(0, -1, 0) },
      uReel: { value: new Vector3() },
      uBlur: { value: new Vector3() },
      uHolds: { value: new Vector4() },
      uHoldX: { value: new Vector4(HOLD_X[0], HOLD_X[1], HOLD_X[2], HOLD_X[3]) },
      uCurPos: { value: new Vector3(CUR_X, CUR_Y, CUR_SIZE) },
      uBlink: { value: new Vector4() },
      uCur: { value: 0 },
      uToku: { value: new Vector4() },
      uCurToku: { value: 0 },
      uTokuTex: { value: toku },
      uBrk: { value: -1 },
      uTime: { value: 0 },
      uReach: { value: 0 },
      uFlash: { value: 0 },
      uWin: { value: 0 },
      uCalm: { value: 0 },
      uHud: { value: hud },
      uHudOn: { value: 0 },
      uHudDim: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform sampler2D uText;
      uniform sampler2D uHud;       // 大当たり中の表示（D-077, hud-canvas.ts）
      uniform float uHudOn, uHudDim;
      uniform float uTextRows, uTextRow;
      uniform vec3 uTextAnim; // mode, 秒, 進み具合
      uniform vec3 uTextColor;
      uniform vec4 uScene;    // SP, 決め, ブラックアウト, 確定
      uniform vec3 uScene2;   // キリン柄, 群予告の進み具合（-1 は無し）, 疑似連の光
      uniform vec3 uReel;
      uniform vec3 uBlur;
      uniform vec4 uHolds;
      uniform vec4 uHoldX;    // 保留の横位置（1つずれる動きの途中を含む）
      uniform vec3 uCurPos;   // 当該変動の保留の位置と大きさ
      uniform vec4 uToku;     // 特別保留（「特」の札, D-081）
      uniform float uCurToku;
      uniform sampler2D uTokuTex;
      uniform vec4 uBlink;    // 灰色で点滅する保留（変化する保留, D-075）
      uniform float uCur, uTime, uReach, uFlash, uWin, uCalm;
      uniform float uBrk;     // 保留が割れる演出の経過秒（-1 は無し）
      varying vec2 vUv;
      const float SYM_H = 0.46;
      const float ASPECT = ${(160 / 104).toFixed(4)};
      const float B_GROW = ${(HOLD_BREAK_MS.grow / 1000).toFixed(3)};
      const float B_CRACK = ${(HOLD_BREAK_MS.crack / 1000).toFixed(3)};
      const float B_REVEAL = ${(HOLD_BREAK_MS.reveal / 1000).toFixed(3)};
      const float B_REELS = ${(HOLD_BREAK_MS.reels / 1000).toFixed(3)};
      const float B_END = ${(HOLD_BREAK_MS.end / 1000).toFixed(3)};
      // ひびの進み（0〜1）。HOLD_CRACK_STEPS_MS の時刻にピキッと一段ずつ伸びる（音と同じ時刻）。
      float crackAt(float t) {
        float c = 0.0;
        ${HOLD_CRACK_STEPS_MS.map((ms) => `c += smoothstep(${(ms / 1000).toFixed(3)}, ${(ms / 1000 + 0.06).toFixed(3)}, t);`).join('\n        ')}
        return c / ${HOLD_CRACK_STEPS_MS.length.toFixed(1)};
      }

      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
      vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }

      // キリン柄（ボロノイの斑。境目を明るい黄色に）。
      vec3 kirin(vec2 uv) {
        vec2 q = uv * vec2(ASPECT, 1.0) * 5.0 + vec2(uTime * 0.15, 0.0);
        vec2 i = floor(q);
        vec2 f = fract(q);
        float d1 = 8.0;
        float d2 = 8.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            float d = length(g + 0.15 + 0.7 * hash2(i + g) - f);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
          }
        }
        float spot = smoothstep(0.05, 0.11, d2 - d1);
        return mix(vec3(1.0, 0.86, 0.42), vec3(0.55, 0.26, 0.07), spot);
      }

      // テロップ（アトラスの1行）。mode 0 は中央に飛び出し、1 は斜めの帯に乗って右から左へ横切る。
      vec3 drawText(vec3 col) {
        if (uTextRow < 0.0) return col;
        float mode = uTextAnim.x;
        float t = uTextAnim.y;
        float p = uTextAnim.z;
        vec2 c = vec2(0.5, 0.56);
        float sc = 1.0;
        float a = 1.0;
        vec2 q = vUv;
        if (mode < 0.5) {
          sc = 1.0 + 0.6 * exp(-t * 14.0);
          a = min(1.0, t * 10.0) * smoothstep(1.0, 0.85, p);
        } else {
          // 帯は少し傾ける。入り（0〜25%）と抜け（80%〜）で横に滑らせる。
          q = vec2(vUv.x, vUv.y + (vUv.x - 0.5) * 0.18);
          float inX = 1.0 - smoothstep(0.0, 0.25, p);
          float outX = smoothstep(0.8, 1.0, p);
          c.x = 0.5 + 1.2 * inX - 1.2 * outX;
          float band = 1.0 - smoothstep(0.12, 0.125, abs(q.y - c.y));
          float edge = 1.0 - smoothstep(0.0, 0.006, abs(abs(q.y - c.y) - 0.123));
          col = mix(col, mix(vec3(0.02), uTextColor * 0.35, 0.5 + 0.5 * sin(q.x * 60.0 - uTime * 20.0)), band * 0.85);
          col += uTextColor * edge * 1.2;
        }
        // 行は横 8 : 縦 1。液晶の uv は横が ASPECT 倍長いので、縦の幅は w * ASPECT / 8。
        float w = 0.92 * sc;
        vec2 tuv = vec2((q.x - c.x) / w + 0.5, (q.y - c.y) / (w * ASPECT / 8.0) + 0.5);
        if (tuv.x < 0.0 || tuv.x > 1.0 || tuv.y < 0.0 || tuv.y > 1.0) return col;
        vec4 tx = texture2D(uText, vec2(tuv.x, (uTextRows - 1.0 - uTextRow + tuv.y) / uTextRows));
        vec3 fill = uTextColor * (1.15 + 0.35 * tuv.y);
        return mix(col, tx.rgb * fill, tx.a * a);
      }

      vec4 symbol(float s, float lx) {
        float n = mod(floor(s), 9.0);
        float lv = fract(s);
        vec2 cell = vec2(mod(n, 3.0), 2.0 - floor(n / 3.0));
        return texture2D(uAtlas, (cell + vec2(lx, lv)) / 3.0);
      }

      // n 点の星の距離（負が内側）。m は凹みの深さ（2 でひし形に近い）。
      float star(vec2 p, float r, float n, float m) {
        float an = 3.14159265 / n;
        float en = 3.14159265 / m;
        vec2 acs = vec2(cos(an), sin(an));
        vec2 ecs = vec2(cos(en), sin(en));
        float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
        p = length(p) * vec2(cos(bn), abs(sin(bn)));
        p -= r * acs;
        p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
        return length(p) * sign(p.x);
      }

      // 金属の地の色（白は銀）。
      vec3 holdColor(float code) {
        if (code < 1.5) return vec3(0.9, 0.93, 1.0);
        if (code < 2.5) return vec3(0.22, 0.52, 1.3);
        if (code < 3.5) return vec3(0.18, 1.1, 0.38);
        if (code < 4.5) return vec3(1.45, 0.1, 0.12);
        return vec3(1.5, 1.0, 0.22);
      }

      // 形（丸・ひし形・星）の距離。size は外接半径。
      float holdShape(vec2 d, float code, float size) {
        if (code < 2.5) return length(d) - size * 0.8;
        if (code < 3.5) return (abs(d.x) + abs(d.y)) * 0.75 - size * 0.75;
        if (code < 4.5) return star(d, size * 1.05, 4.0, 2.6);
        return star(d, size * 1.1, 5.0, 3.0);
      }

      // 点滅の明るさ（phase は回数）。reduced-motion は点けたまま。
      float blinkAt(float phase) { return mix(smoothstep(-0.4, 0.4, sin(phase * 6.2832)), 0.6, uCalm); }

      // 保留1つを重ねる（空きは暗い輪だけ）。面取りした金属の板として陰影をつけ、ハイライトが斜めに流れる。
      // 赤・金は点滅して後光が脈打つ（2.0/2.4回/秒, spec/43 の3回/秒未満）。reduced-motion（uCalm）では点滅と流れを止める。
      // bk は灰色の変化保留のチカチカ（2.0回/秒で明滅し、白い後光が大きく脈打つ）。
      // 特別保留の「特」の札（保留の右上に小さく重ねる, D-081）。
      vec3 drawToku(vec3 col, vec2 c, float size, float on) {
        if (on < 0.5) return col;
        vec2 d = (vUv - c) * vec2(ASPECT, 1.0) - vec2(size * 0.6, size * 1.05);
        vec2 tuv = d / (size * 1.5) + 0.5;
        if (tuv.x < 0.0 || tuv.x > 1.0 || tuv.y < 0.0 || tuv.y > 1.0) return col;
        vec4 tx = texture2D(uTokuTex, tuv);
        return mix(col, tx.rgb, tx.a);
      }

      vec3 drawHold(vec3 col, vec2 c, float code, float size, float bk) {
        vec2 d = (vUv - c) * vec2(ASPECT, 1.0);
        if (code < 0.5) {
          float ring = 1.0 - smoothstep(0.0, 0.004, abs(length(d) - size * 0.6));
          return mix(col, vec3(0.45), ring * 0.7);
        }
        float sd = holdShape(d, code, size);
        float fill = 1.0 - smoothstep(-0.002, 0.002, sd);
        vec3 base = holdColor(code);
        float hot = step(3.5, code);
        float gold = step(4.5, code);
        float t = uTime;
        float blink = mix(1.0, smoothstep(-0.35, 0.35, sin(t * 6.2832 * mix(2.0, 2.4, gold))), hot * (1.0 - uCalm));

        // 後光（赤・金は大きく、点滅に合わせて脈打つ）。
        float glow = exp(-max(sd, 0.0) * mix(90.0, 45.0, hot)) * mix(0.3, 0.12 + 0.8 * blink, hot);
        col += base * glow * 0.6;
        float chika = blinkAt(t * 2.0);
        col += vec3(0.85, 0.92, 1.0) * (exp(-max(sd, 0.0) * 50.0) * 0.6 + exp(-max(sd, 0.0) * 18.0) * 0.55) * bk * (0.25 + 0.75 * chika);
        if (fill <= 0.0) return col;

        // 面取りの法線: 縁の bevel 幅だけ外へ傾く（距離の勾配の向き）。
        float e = size * 0.03;
        vec2 g = vec2(holdShape(d + vec2(e, 0.0), code, size) - sd, holdShape(d + vec2(0.0, e), code, size) - sd) / e;
        float h = clamp(-sd / (size * 0.3), 0.0, 1.0);
        vec3 n = normalize(vec3(g * (1.0 - h) * 1.8, 1.0));
        // 映り込み: 上は明るい空、中よりやや下に暗い水平線、下は照り返し（クロームの定番の見え方）。
        float v = d.y / size * 0.5 + n.y * 0.9;
        vec3 metal = base * (mix(0.45, 0.6, hot) + 0.75 * smoothstep(-0.35, 0.6, v));
        metal += base * 0.4 * smoothstep(-0.55, -1.0, v);
        metal *= 1.0 - 0.3 * exp(-(v + 0.3) * (v + 0.3) * 50.0);
        // 左上からの光のハイライト（地の色を少し残した白）。
        float spec = pow(max(dot(n, normalize(vec3(-0.35, 0.45, 1.0))), 0.0), 60.0);
        metal += mix(base, vec3(1.0), 0.6) * spec * 1.3;
        // 斜めに流れる光（通常は約2.6秒ごと、赤・金は約1.1秒ごと）。
        float period = mix(2.6, 1.1, hot);
        float at = fract(t / period) * 3.0 - 1.2;
        float sweep = exp(-pow(((d.x + d.y) / size * 0.5 - at) * 5.0, 2.0)) * (1.0 - uCalm);
        metal += mix(base, vec3(1.0), 0.7) * sweep * 0.9;
        // 金はきらめき（面の上の4点の光）。
        if (gold > 0.5) {
          vec2 q = d / size - vec2(0.25, 0.3);
          float tw = 0.5 + 0.5 * sin(t * 5.0);
          float cross = exp(-abs(q.x) * 40.0) * exp(-abs(q.y) * 6.0) + exp(-abs(q.y) * 40.0) * exp(-abs(q.x) * 6.0);
          metal += vec3(1.0, 0.95, 0.7) * cross * mix(0.9, 0.3 + 1.0 * tw, 1.0 - uCalm);
        }
        metal *= mix(1.0, 0.4 + 0.8 * blink, hot);
        metal *= mix(1.0, 0.55 + 0.8 * chika, bk);
        return mix(col, metal, fill);
      }

      // ひびの網（ボロノイの境目までの距離）。q は玉の上の座標（半径1）。
      float crackNet(vec2 q) {
        vec2 p = q * 2.4 + vec2(3.1, 7.7);
        vec2 i = floor(p);
        vec2 f = fract(p);
        float d1 = 8.0;
        float d2 = 8.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            float d = length(g + hash2(i + g) - f);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
          }
        }
        return d2 - d1;
      }

      // 変化保留が割れる（D-075）。t は変動開始からの秒、code は見せる色（割れるまでは白）。
      // 次の保留の位置（当該のすぐ左）から中央へ動いて大きなパチンコ玉になり、点滅が 2.0 → 2.9 回/秒へ速くなりながらひびがピキッと段々に広がり、
      // 割れると殻が飛び散って中から最終色の保留が出て、保留の色が中心から液晶いっぱいに広がる。
      vec3 drawBreak(vec3 col, float t, float code) {
        float g = smoothstep(0.0, B_GROW, t);
        // 周りを暗くして玉に目を向ける（割れてから図柄が回り始めるまでに戻す）。
        col *= 1.0 - 0.6 * g * (1.0 - smoothstep(B_REVEAL, B_REELS, t));
        if (t < B_REVEAL) {
          float c = crackAt(t);
          float u = max(t - B_CRACK, 0.0);
          float bl = blinkAt(2.0 * t + 0.45 * u * u / (B_REVEAL - B_CRACK));
          vec2 ctr = mix(vec2(${HOLD_X[0]}, ${HOLD_Y}), vec2(0.5, 0.52), g);
          ctr.y += sin(g * 3.14159) * 0.06;
          // 割れる直前は小刻みに震える。
          ctr += (hash2(vec2(floor(t * 40.0), 1.0)) - 0.5) * 0.012 * c * c * (1.0 - uCalm);
          float R = mix(0.032, 0.3, g);
          vec2 q = (vUv - ctr) * vec2(ASPECT, 1.0) / R;
          float r = length(q);
          col += vec3(0.85, 0.9, 1.0) * exp(-max(r - 1.0, 0.0) * 4.0) * (0.1 + 0.3 * bl + 0.45 * c);
          float aa = 0.004 / R;
          float fill = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
          if (fill <= 0.0) return col;
          // クロームの玉: 上は明るい空、赤道の少し下に暗い帯、下は照り返し、左上にハイライト。
          vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r * r)));
          float v = n.y;
          vec3 ball = vec3(0.78, 0.8, 0.86) * (0.35 + 0.8 * smoothstep(-0.25, 0.75, v));
          ball *= 1.0 - 0.45 * exp(-(v + 0.12) * (v + 0.12) * 40.0);
          ball += vec3(0.5, 0.52, 0.58) * smoothstep(-0.5, -0.95, v);
          ball += vec3(1.0) * pow(max(dot(n, normalize(vec3(-0.4, 0.55, 1.0))), 0.0), 40.0) * 1.4;
          ball *= 1.0 - 0.35 * pow(r, 6.0);
          ball *= 0.7 + 0.5 * bl;
          // ひび: 左上の一点からギザギザの太いひびが6本伸び、後半は細かい網が広がる。太くなるほど奥から光が漏れる。
          vec2 pq = q - vec2(-0.25, 0.3);
          float pr = length(pq);
          float pa = atan(pq.y, pq.x);
          float w = 0.015 + 0.05 * c;
          float main = 8.0;
          for (int k = 0; k < 6; k++) {
            float fk = float(k);
            float a = fk * 1.047 + 0.4 * hash1(fk + 3.0) + 0.12 * sin(pr * 9.0 + fk * 3.0) + 0.06 * sin(pr * 23.0 + fk);
            float da = abs(mod(pa - a + 3.14159, 6.28318) - 3.14159) * pr;
            float len = c * 2.4 * (0.6 + 0.4 * hash1(fk + 11.0));
            main = min(main, da + 8.0 * step(len, pr));
          }
          float net = crackNet(q) + 8.0 * step(smoothstep(0.45, 1.0, c) * 1.9, pr);
          float e = min(main * 1.4, net);
          float m = step(0.001, c);
          vec3 leak = vec3(1.0, 0.96, 0.85) * (0.6 + 1.2 * c);
          ball = mix(ball, leak, (1.0 - smoothstep(w * 0.5, w, e)) * m);
          ball += vec3(1.0, 0.96, 0.85) * (1.0 - smoothstep(0.0, w * 3.0, e)) * m * 0.25 * c;
          return mix(col, ball, fill);
        }
        float s = t - B_REVEAL;
        vec3 hc = holdColor(code) / 1.3;
        vec2 ctr = vec2(0.5, 0.52);
        vec2 d = (vUv - ctr) * vec2(ASPECT, 1.0);
        float r = length(d);
        // 保留の色が中心からぶわっと広がる（輪・その内側の薄い光・きらめき）。
        float Rw = s * 1.3;
        float fade = 1.0 - smoothstep(0.25, 1.0, s);
        float x = (r - Rw) * 9.0;
        col += hc * (exp(-x * x) * 0.9 + (1.0 - smoothstep(0.0, max(Rw, 0.001), r)) * 0.35) * fade;
        vec2 gp = vUv * vec2(ASPECT, 1.0) * 14.0;
        vec2 h = hash2(floor(gp));
        float tw = mix(0.5 + 0.5 * sin(uTime * 7.0 + h.x * 30.0), 0.7, uCalm);
        float spark = exp(-length(fract(gp) - 0.2 - 0.6 * h) * 22.0) * step(0.55, h.x);
        vec3 sc = code > 4.5 ? hue(h.y + uTime * 0.3) : mix(hc, vec3(1.0), 0.5);
        col += sc * spark * tw * (1.0 - smoothstep(Rw - 0.1, Rw, r)) * fade * 1.4;
        // 割れた瞬間の白い光。
        col += vec3(1.0) * exp(-s * 12.0) * mix(0.35, 0.15, uCalm);
        // 殻のかけらが外へ広がって消える。
        vec2 q = d / (0.3 * (1.0 + s * 3.0));
        float rq = length(q);
        if (rq < 1.0 && s < 0.4) {
          float gap = 0.03 + s * 0.5;
          float shard = smoothstep(gap, gap + 0.02, crackNet(q)) * (1.0 - smoothstep(0.1, 0.4, s)) * (1.0 - smoothstep(0.9, 1.0, rq));
          col = mix(col, vec3(0.8, 0.82, 0.88) * (0.6 + 0.5 * hash2(floor(q * 2.4 + vec2(3.1, 7.7))).x), shard);
        }
        // 中から最終色の保留が弾むように出て、図柄が回り始めたら当該保留の位置へ戻る。
        float k = clamp(s / 0.3, 0.0, 1.0);
        float pop = 1.0 - (1.0 - k) * (1.0 - k) * (1.0 - k) + 0.18 * sin(clamp(s / 0.45, 0.0, 1.0) * 3.14159);
        float mv = smoothstep(B_REELS - 0.1, B_END, t);
        return drawHold(col, mix(ctr, vec2(${CUR_X}, ${CUR_Y}), mv), code, max(mix(0.24, ${CUR_SIZE}, mv) * pop, 0.001), 0.0);
      }

      void main() {
        vec2 p = vUv - vec2(0.5, 0.52);
        p.x *= ASPECT;
        float r = length(p);
        float ang = atan(p.y, p.x);
        float rays = smoothstep(0.2, 1.0, 0.5 + 0.5 * sin(ang * 10.0 + uTime * 0.9));

        // 背景: 夜空の紫 + 回る光条。
        vec3 col = mix(vec3(0.01, 0.015, 0.08), vec3(0.09, 0.02, 0.22), vUv.y);
        col += rays * max(0.0, 1.0 - r) * vec3(0.10, 0.05, 0.28);
        // リーチ: 赤く脈打つ。
        col = mix(col, vec3(0.45, 0.01, 0.04) * (0.6 + 0.4 * sin(uTime * 12.0)) * (1.2 - r), uReach * 0.8);
        // SP リーチ: 赤黒の背景に外へ流れる集中線。
        float speed = smoothstep(0.55, 1.0, sin(ang * 36.0 + hash1(floor(ang * 36.0 / 6.2832 * 6.0)) * 6.0))
          * smoothstep(0.05, 0.6, r) * (0.6 + 0.4 * fract(r * 3.0 - uTime * 2.5));
        vec3 spCol = mix(vec3(0.25, 0.0, 0.02), vec3(0.02, 0.0, 0.05), r) + speed * vec3(1.2, 0.45, 0.15);
        col = mix(col, spCol, uScene.x);
        // キリン柄・確定の虹（背景を差し替える）。
        col = mix(col, kirin(vUv) * 0.8, uScene2.x);
        col = mix(col, hue(ang / 6.2832 + uTime * 0.4 - r * 0.8) * (0.55 + 0.45 * rays), uScene.w);
        // 当たり: 虹。
        col = mix(col, hue(ang / 6.2832 + uTime * 0.6 - r) * (0.45 + 0.55 * rays), uWin);

        // 3列の図柄（中段が有効ライン）。回転中は縦にぼかす。
        float fx = vUv.x * 3.0;
        float i = floor(fx);
        float lx = (fract(fx) - 0.5) * 1.12 + 0.5;
        float pos = i < 1.0 ? uReel.x : (i < 2.0 ? uReel.y : uReel.z);
        float bl = i < 1.0 ? uBlur.x : (i < 2.0 ? uBlur.y : uBlur.z);
        float s = (vUv.y - 0.52) / SYM_H + 0.5 + pos;
        vec4 sym = vec4(0.0);
        if (lx > 0.0 && lx < 1.0) {
          for (int k = -3; k <= 3; k++) sym += symbol(s + float(k) * 0.07 * bl, lx);
          sym /= 7.0;
        }
        float bright = 1.0 + uWin * (0.9 + 0.6 * sin(uTime * 16.0)) + uFlash * 0.25;
        col = mix(col, sym.rgb * bright, sym.a);

        // 有効ラインの上下を少し暗く（奥行き）。
        col *= 1.0 - 0.45 * smoothstep(0.22, 0.52, abs(vUv.y - 0.52));

        // 群予告: 色とりどりの星が左から右へ群れで横切る。
        if (uScene2.y >= 0.0) {
          for (int k = 0; k < 18; k++) {
            float fk = float(k);
            float h1 = hash1(fk + 1.0);
            float h2 = hash1(fk + 31.0);
            float x = -0.2 + uScene2.y * (1.5 + 0.5 * h1) - 0.3 * h2;
            float y = 0.2 + 0.7 * h2 + 0.03 * sin(uTime * 9.0 + fk);
            vec2 d = (vUv - vec2(x, y)) * vec2(ASPECT, 1.0);
            float sd = star(d, 0.05 + 0.03 * h1, 5.0, 3.0);
            float fill = 1.0 - smoothstep(-0.002, 0.002, sd);
            col += hue(h1) * exp(-max(sd, 0.0) * 60.0) * 0.35;
            col = mix(col, hue(h1) * 1.3 + 0.2, fill);
          }
        }
        // 決め: 縁が脈打つ（約2.4回/秒, spec/43 の3回/秒未満）。疑似連の瞬間は白く光る。
        col += vec3(1.0, 0.85, 0.5) * uScene.y * (0.3 + 0.3 * sin(uTime * 15.0)) * smoothstep(0.25, 0.8, r);
        col += vec3(0.9, 0.95, 1.0) * uScene2.z * 0.45;
        // ブラックアウト（テロップだけ残す）。
        col *= 1.0 - 0.96 * uScene.z;
        col = drawText(col);
        // 大当たり中のラウンド・出玉と結果の告知（図柄を暗くして重ねる）。
        if (uHudOn > 0.5) {
          vec4 hud = texture2D(uHud, vUv);
          col *= 1.0 - uHudDim;
          col = mix(col, hud.rgb, hud.a);
        }

        // 当該変動の保留（中央下に大きく）と保留（そのすぐ左から左へ順に4つ、色＋形）。読みやすいよう下端に暗い帯を敷く。
        // 左の保留から描く（右へずれる保留が、その先の空きの輪の上に重なるように）。
        col *= 1.0 - 0.6 * (1.0 - smoothstep(0.17, 0.22, vUv.y));
        col = drawHold(col, vec2(uHoldX.w, ${HOLD_Y}), uHolds.w, ${HOLD_SIZE}, uBlink.w);
        col = drawHold(col, vec2(uHoldX.z, ${HOLD_Y}), uHolds.z, ${HOLD_SIZE}, uBlink.z);
        col = drawHold(col, vec2(uHoldX.y, ${HOLD_Y}), uHolds.y, ${HOLD_SIZE}, uBlink.y);
        col = drawHold(col, vec2(uHoldX.x, ${HOLD_Y}), uHolds.x, ${HOLD_SIZE}, uBlink.x);
        if (uBrk >= 0.0) col = drawBreak(col, uBrk, uCur);
        else if (uCur > 0.5) col = drawHold(col, uCurPos.xy, uCur, uCurPos.z, 0.0);
        col = drawToku(col, vec2(uHoldX.w, ${HOLD_Y}), ${HOLD_SIZE}, uToku.w * step(0.5, uHolds.w));
        col = drawToku(col, vec2(uHoldX.z, ${HOLD_Y}), ${HOLD_SIZE}, uToku.z * step(0.5, uHolds.z));
        col = drawToku(col, vec2(uHoldX.y, ${HOLD_Y}), ${HOLD_SIZE}, uToku.y * step(0.5, uHolds.y));
        col = drawToku(col, vec2(uHoldX.x, ${HOLD_Y}), ${HOLD_SIZE}, uToku.x * step(0.5, uHolds.x));
        if (uBrk < 0.0) col = drawToku(col, uCurPos.xy, uCurPos.z, uCurToku * step(0.5, uCur));

        // 走査線と周辺減光（液晶らしさ）。
        col *= 0.93 + 0.07 * sin(vUv.y * 420.0);
        col *= 1.0 - 0.35 * smoothstep(0.35, 0.75, r);
        col += uFlash * 0.08;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}
