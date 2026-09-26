import { ShaderMaterial, Vector3, type Texture } from 'three';

const SPIN_SPEED = 16; // 図柄/秒
const STOP_MS = 380;
const SEVEN = 6; // アトラスの 7 の添字

interface Reel {
  pos: number;
  vel: number;
  mode: 'spin' | 'stopping' | 'stopped';
  from: number;
  to: number;
  t: number;
  stopAt: number;
  target: number;
}

/**
 * BAKEOFF: 液晶の3列図柄（最小版）。ヘソ入賞で保留が増え、保留を1つずつ消化して回す。
 * 左右が揃うとリーチ（中列だけ減速して長く回る）。win() で 7・7・7 に止めて当たり表示。
 */
export class LcdReels {
  readonly material: ShaderMaterial;
  hold = 0;
  private readonly reels: Reel[] = [0, 1, 2].map((i) => ({
    pos: i * 3,
    vel: 0,
    mode: 'stopped' as const,
    from: 0,
    to: 0,
    t: 0,
    stopAt: 0,
    target: 0,
  }));
  private elapsed = 0;
  private elapsedSpin = 0;
  private spinning = false;
  private restMs = 0;
  private reachMs = -1;
  private flash = 0;
  private winMs = -1;

  constructor(atlas: Texture) {
    this.material = lcdMaterial(atlas);
  }

  get reach(): boolean {
    return this.reachMs >= 0;
  }

  /** ヘソ入賞（保留は4まで）。 */
  addHold(): void {
    if (this.hold < 4) this.hold++;
    this.flash = 1;
  }

  /** 当たり（全列を 7 で止める）。 */
  win(): void {
    this.winMs = 0;
    this.reachMs = -1;
    this.spinning = true;
    this.reels.forEach((r, i) => {
      r.vel = SPIN_SPEED;
      r.mode = 'spin';
      r.stopAt = 250 + i * 160;
      r.target = SEVEN;
    });
    this.elapsedSpin = 0;
  }

  update(dtMs: number, winLevel: number): void {
    this.elapsed += dtMs;
    this.flash = Math.max(0, this.flash - dtMs / 400);
    if (this.winMs >= 0) {
      this.winMs += dtMs;
      if (this.winMs > 3000) this.winMs = -1;
    }
    if (!this.spinning) {
      this.restMs -= dtMs;
      if (this.restMs <= 0 && this.hold > 0 && this.winMs < 0) this.start();
    }
    if (this.spinning) {
      this.elapsedSpin += dtMs;
      for (const r of this.reels) this.stepReel(r, dtMs);
      const [l, c, rr] = this.reels as [Reel, Reel, Reel];
      if (this.reachMs < 0 && this.winMs < 0 && l.mode === 'stopped' && rr.mode === 'stopped' && c.mode === 'spin' && l.target === rr.target) {
        this.reachMs = 0;
        // リーチは中列を長く回す。
        c.stopAt = this.elapsedSpin + 2600;
      }
      if (this.reachMs >= 0) {
        this.reachMs += dtMs;
        // 止まる直前の1.2秒は減速して、1コマずつ見せる。
        const left = c.stopAt - this.elapsedSpin;
        if (c.mode === 'spin' && left < 1200) c.vel = Math.max(3.5, SPIN_SPEED * (left / 1200));
      }
      if (this.reels.every((r) => r.mode === 'stopped')) {
        this.spinning = false;
        this.reachMs = -1;
        this.restMs = this.winMs >= 0 ? 3000 : 700;
      }
    }

    const u = this.material.uniforms;
    (u.uReel!.value as Vector3).set(this.reels[0]!.pos, this.reels[1]!.pos, this.reels[2]!.pos);
    (u.uBlur!.value as Vector3).set(blur(this.reels[0]!), blur(this.reels[1]!), blur(this.reels[2]!));
    u.uTime!.value = this.elapsed / 1000;
    u.uHold!.value = this.hold;
    u.uReach!.value = this.reachMs >= 0 ? Math.min(1, this.reachMs / 300) : 0;
    u.uFlash!.value = this.flash;
    u.uWin!.value = winLevel;
  }

  private start(): void {
    this.hold--;
    this.spinning = true;
    this.elapsedSpin = 0;
    const pick = () => Math.floor(Math.random() * 9);
    const a = pick();
    let b = pick();
    let c = pick();
    if (Math.random() < 0.22) {
      // リーチ目（左右が同じ、中はハズレ。惜しい1コマずれを多めに）。
      c = a;
      b = Math.random() < 0.6 ? (a + 1) % 9 : (a + 1 + Math.floor(Math.random() * 8)) % 9;
    } else if (a === c) {
      c = (c + 1 + Math.floor(Math.random() * 8)) % 9;
    }
    // 7 揃いはタップ専用。
    if (a === SEVEN && b === SEVEN && c === SEVEN) b = 0;
    const order = [a, b, c];
    this.reels.forEach((r, i) => {
      r.mode = 'spin';
      r.vel = SPIN_SPEED;
      r.target = order[i] ?? 0;
      // 左 → 右 → 中の順に止める。
      r.stopAt = i === 0 ? 1300 : i === 2 ? 1800 : 2350;
    });
  }

  private stepReel(r: Reel, dtMs: number): void {
    if (r.mode === 'spin') {
      r.pos += (r.vel * dtMs) / 1000;
      if (this.elapsedSpin >= r.stopAt) {
        r.mode = 'stopping';
        r.from = r.pos;
        let to = Math.ceil(r.pos + 1.2);
        while ((((to % 9) + 9) % 9) !== r.target) to++;
        r.to = to;
        r.t = 0;
      }
    } else if (r.mode === 'stopping') {
      r.t += dtMs;
      const k = Math.min(1, r.t / STOP_MS);
      r.pos = r.from + (r.to - r.from) * backOut(k);
      if (k >= 1) {
        r.pos = r.to % 9;
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
      uTime: { value: 0 },
      uHold: { value: 0 },
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
      uniform float uTime, uHold, uReach, uFlash, uWin;
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

        // 保留ランプ（左下に4つ）。
        for (int k = 0; k < 4; k++) {
          vec2 c = vec2(0.07 + float(k) * 0.055, 0.075);
          vec2 d = (vUv - c) * vec2(ASPECT, 1.0);
          float dd = length(d);
          float on = step(float(k) + 0.5, uHold);
          float disc = 1.0 - smoothstep(0.016, 0.022, dd);
          float ring = 1.0 - smoothstep(0.0, 0.004, abs(dd - 0.02));
          col = mix(col, mix(vec3(0.25), vec3(0.4, 0.9, 1.6), on), max(disc * (0.25 + on * 0.75), ring * 0.6));
        }

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
