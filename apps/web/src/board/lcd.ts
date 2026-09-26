import { ShaderMaterial, Vector3, Vector4, type Texture } from 'three';
import type { LotteryHoldColor } from '@ph/core';
import type { LcdSpin, LcdState } from './lcd-timeline.ts';

const SPIN_SPEED = 16; // 図柄/秒
const STOP_MS = 380;
const SYMBOLS = 9;
const SEVEN = 6; // アトラスの 7 の添字

/** 保留の色 → シェーダーの番号（0 は空き。1,2 は丸・3 はひし形・4 は4点の星・5 は5点の星, spec/40 の色＋形）。 */
export const HOLD_CODE: Record<LotteryHoldColor, number> = { white: 1, blue: 2, green: 3, red: 4, gold: 5 };

interface Reel {
  pos: number;
  vel: number;
  mode: 'spin' | 'stopping' | 'stopped';
  from: number;
  to: number;
  t: number;
  target: number;
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
 * 液晶の3列図柄と保留（spec/40 ホールの最小版。演出は P6 で差し替える）。LcdTimeline の状態を表示時刻で映す:
 * 変動の開始で回し、左 → 右 → 中の順に止める。中は変動の終了時刻に止まる。リーチ（パターンの hot ≥ 1）は左右を早めに揃え、
 * 中を終了まで回して最後の 1.2 秒で減速する。保留は色＋形で4つまで、当該変動の保留は中央下に大きく出す。
 */
export class LcdReels {
  readonly material: ShaderMaterial;
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

  constructor(
    atlas: Texture,
    private readonly patternHot: (pattern: string) => number = () => 0,
  ) {
    this.material = lcdMaterial(atlas);
  }

  get reach(): boolean {
    return this.reachMs >= 0;
  }

  /**
   * 表示時刻 now の状態を映す。scale は Debug の時間倍率（止まる動きは実時間なので、その分だけ早めに止め始める）。
   * peek は当否が不明な変動（Projection に揃えた直後）の結果を先読みする。
   */
  update(dtMs: number, now: number, scale: number, st: LcdState, peek: (entry: number) => boolean | null, winLevel: number): void {
    this.elapsed += dtMs;
    this.flash = Math.max(0, this.flash - dtMs / 400);
    if (st.holds.length > this.holdCount) this.flash = 1;
    this.holdCount = st.holds.length;

    if (st.spin && st.spin.entry !== this.spin?.entry) this.begin(st.spin, now);
    if (this.spin) this.step(dtMs, now, scale, st, peek);

    const u = this.material.uniforms;
    (u.uReel!.value as Vector3).set(this.reels[0]!.pos, this.reels[1]!.pos, this.reels[2]!.pos);
    (u.uBlur!.value as Vector3).set(blur(this.reels[0]!), blur(this.reels[1]!), blur(this.reels[2]!));
    const h = st.holds.map((x) => HOLD_CODE[x.color]);
    (u.uHolds!.value as Vector4).set(h[0] ?? 0, h[1] ?? 0, h[2] ?? 0, h[3] ?? 0);
    u.uCur!.value = st.spin?.color ? HOLD_CODE[st.spin.color] : 0;
    u.uTime!.value = this.elapsed / 1000;
    u.uReach!.value = this.reachMs >= 0 ? Math.min(1, this.reachMs / 300) : 0;
    u.uFlash!.value = this.flash;
    u.uWin!.value = Math.max(winLevel, st.jackpot ? 0.35 : 0);
  }

  private begin(spin: LcdSpin, now: number): void {
    this.spin = spin;
    this.spinStart = spin.startAt ?? now;
    this.isReach = this.patternHot(spin.pattern) >= 1;
    this.targets = spinTargets(spin.entry, this.isReach, spin.hit === true);
    this.reachMs = -1;
    const d = Math.max(1, spin.endsAt - this.spinStart);
    // リーチは左右を早めに揃えて中を長く見せる。通常は終了までに3列を順に止める。
    const l = this.isReach ? Math.min(0.12 * d, 1400) : 0.45 * d;
    const r = this.isReach ? Math.min(0.2 * d, 2200) : 0.7 * d;
    this.stopAt = [this.spinStart + l, spin.endsAt, this.spinStart + r];
    for (const reel of this.reels) {
      reel.mode = 'spin';
      reel.vel = SPIN_SPEED;
    }
  }

  private step(dtMs: number, now: number, scale: number, st: LcdState, peek: (entry: number) => boolean | null): void {
    const spin = this.spin!;
    const [l, c, r] = this.reels as [Reel, Reel, Reel];
    const lead = STOP_MS * scale;
    for (const i of [0, 2]) {
      const reel = this.reels[i]!;
      if (reel.mode === 'spin' && now >= this.stopAt[i]! - lead) this.stop(reel, this.targets[i]!);
    }
    if (this.isReach && this.reachMs < 0 && l.mode === 'stopped' && r.mode === 'stopped') this.reachMs = 0;
    if (this.reachMs >= 0) this.reachMs += dtMs;
    if (c.mode === 'spin') {
      const left = (spin.endsAt - now) / scale;
      // リーチの最後の 1.2 秒は減速して、1コマずつ見せる。
      if (this.isReach && left < 1200) c.vel = Math.max(3.5, SPIN_SPEED * (left / 1200));
      if (now >= spin.endsAt - lead) {
        const hit = spin.hit ?? peek(spin.entry) ?? (st.resolved?.entry === spin.entry ? st.resolved.hit : null);
        // 当否が分からないうちは回し続ける（次の前進で届く）。
        if (hit !== null) {
          if (hit !== (spin.hit === true)) this.targets = spinTargets(spin.entry, this.isReach, hit);
          this.stop(c, this.targets[1]);
        }
      }
    }
    for (const reel of this.reels) this.stepReel(reel, dtMs);
    if (this.reels.every((x) => x.mode === 'stopped')) {
      this.spin = null;
      this.reachMs = -1;
    }
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

function lcdMaterial(atlas: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas },
      uReel: { value: new Vector3() },
      uBlur: { value: new Vector3() },
      uHolds: { value: new Vector4() },
      uCur: { value: 0 },
      uTime: { value: 0 },
      uReach: { value: 0 },
      uFlash: { value: 0 },
      uWin: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform vec3 uReel;
      uniform vec3 uBlur;
      uniform vec4 uHolds;
      uniform float uCur, uTime, uReach, uFlash, uWin;
      varying vec2 vUv;
      const float SYM_H = 0.46;
      const float ASPECT = ${(160 / 104).toFixed(4)};

      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }

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

      vec3 holdColor(float code) {
        if (code < 1.5) return vec3(0.85);
        if (code < 2.5) return vec3(0.25, 0.6, 1.6);
        if (code < 3.5) return vec3(0.3, 1.4, 0.45);
        if (code < 4.5) return vec3(1.7, 0.18, 0.2);
        return vec3(1.9, 1.35, 0.35);
      }

      // 形（丸・ひし形・星）の距離。size は外接半径。
      float holdShape(vec2 d, float code, float size) {
        if (code < 2.5) return length(d) - size * 0.8;
        if (code < 3.5) return (abs(d.x) + abs(d.y)) * 0.75 - size * 0.75;
        if (code < 4.5) return star(d, size * 1.05, 4.0, 2.6);
        return star(d, size * 1.1, 5.0, 3.0);
      }

      // 保留1つを重ねる（空きは暗い輪だけ）。
      vec3 drawHold(vec3 col, vec2 c, float code, float size, float pulse) {
        vec2 d = (vUv - c) * vec2(ASPECT, 1.0);
        if (code < 0.5) {
          float ring = 1.0 - smoothstep(0.0, 0.004, abs(length(d) - size * 0.6));
          return mix(col, vec3(0.45), ring * 0.7);
        }
        float sd = holdShape(d, code, size);
        float fill = 1.0 - smoothstep(-0.002, 0.002, sd);
        float glow = exp(-max(sd, 0.0) * 90.0) * (0.35 + 0.25 * pulse);
        vec3 hc = holdColor(code);
        col += hc * glow * 0.5;
        return mix(col, hc * (0.9 + 0.3 * pulse), fill);
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

        // 保留（左下に4つ、色＋形）と当該変動の保留（中央下に大きく）。読みやすいよう下端に暗い帯を敷く。
        col *= 1.0 - 0.6 * (1.0 - smoothstep(0.17, 0.22, vUv.y));
        float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
        col = drawHold(col, vec2(0.075, 0.095), uHolds.x, 0.04, pulse);
        col = drawHold(col, vec2(0.15, 0.095), uHolds.y, 0.04, pulse);
        col = drawHold(col, vec2(0.225, 0.095), uHolds.z, 0.04, pulse);
        col = drawHold(col, vec2(0.3, 0.095), uHolds.w, 0.04, pulse);
        if (uCur > 0.5) col = drawHold(col, vec2(0.5, 0.1), uCur, 0.058, pulse);

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
