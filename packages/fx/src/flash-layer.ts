import {
  AdditiveBlending,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { FlashStyle } from '@ph/shared';
import { FlashLimiter, flashAlpha } from './flash.ts';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uRainbow;
uniform float uTime;
uniform float uWashRainbow; // 1 は輪も虹色（wash_rainbow）
uniform float uWash;     // 0 は全面、1 は起点から広がる輪（wash_<色>）
uniform float uProg;     // 輪の進み具合（0〜1）
uniform vec3 uWashColor;
uniform vec2 uOrigin;    // 起点（画面の uv）
uniform float uAspect;   // 画面の横 / 縦
varying vec2 vUv;
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
void main() {
  vec3 c = mix(vec3(1.0), hue(vUv.y * 0.8 + vUv.x * 0.2 + uTime * 0.5), uRainbow);
  if (uWash > 0.5) {
    // 起点から輪が画面の外まで広がり、内側は薄く色づいて、きらめきが舞う（金は虹色のきらめき）。
    vec2 d = (vUv - uOrigin) * vec2(uAspect, 1.0);
    float r = length(d);
    float R = uProg * 1.8;
    float x = (r - R) * 5.0;
    float inside = 1.0 - smoothstep(R * 0.6, R, r);
    vec2 gp = vUv * vec2(uAspect, 1.0) * 18.0;
    vec2 h = hash2(floor(gp));
    float spark = exp(-length(fract(gp) - 0.2 - 0.6 * h) * 16.0) * step(0.6, h.x) * (0.5 + 0.5 * sin(uTime * 6.0 + h.y * 40.0));
    vec3 sc = mix(mix(uWashColor, vec3(1.0), 0.5), hue(h.y + uTime * 0.3), uRainbow);
    vec3 wc = mix(uWashColor, hue(r * 1.2 - uTime * 0.4), uWashRainbow);
    c = wc * (exp(-x * x) * 1.6 + inside * 0.5) + sc * spark * inside * 1.5;
  }
  gl_FragColor = vec4(c * uAlpha, 1.0);
}`;

/** wash_<色> の色（加算なので少し淡く）。 */
const WASH: Partial<Record<FlashStyle, readonly [number, number, number]>> = {
  wash_blue: [0.25, 0.55, 1.0],
  wash_green: [0.2, 1.0, 0.45],
  wash_red: [1.0, 0.15, 0.2],
  wash_gold: [1.0, 0.78, 0.25],
  wash_rainbow: [1.0, 1.0, 1.0],
};

interface Active {
  readonly style: FlashStyle;
  readonly start: number;
  readonly ms: number;
}

/**
 * 最前面の全画面フラッシュ（spec/43）。加算の全画面クアッドを本描画の後に重ねる。
 * 回数は FlashLimiter で 3回/秒に抑え、reduced-motion ではフェードに置き換える（どちらも設定で外せない）。
 * ブルームの ON/OFF もここで仲介する（bloom キューの期間だけ bloomStrength が正）。
 */
export class FlashLayer {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly limiter = new FlashLimiter();
  private active: Active | null = null;
  private bloomUntil = -Infinity;
  private bloomValue = 0;
  reducedMotion = false;
  /** wash の起点（画面の uv。盤面が液晶の中心を毎フレーム入れる）。 */
  readonly origin = new Vector2(0.5, 0.5);
  private readonly size = new Vector2();

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uAlpha: { value: 0 },
        uRainbow: { value: 0 },
        uTime: { value: 0 },
        uWash: { value: 0 },
        uWashRainbow: { value: 0 },
        uProg: { value: 0 },
        uWashColor: { value: new Vector3() },
        uOrigin: { value: this.origin },
        uAspect: { value: 1 },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** フラッシュを始める（offsetMs は途中からの頭出し）。3回/秒を超える分は断って false。 */
  flash(style: FlashStyle, ms: number, nowMs: number, offsetMs = 0): boolean {
    if (!this.limiter.allow(nowMs)) return false;
    this.active = { style, start: nowMs - offsetMs, ms };
    return true;
  }

  bloom(strength: number, ms: number, nowMs: number, offsetMs = 0): void {
    this.bloomUntil = nowMs - offsetMs + ms;
    this.bloomValue = strength;
  }

  /** いま掛けるブルームの強さ（0 なら composer を通さない）。 */
  bloomStrength(nowMs: number): number {
    return nowMs < this.bloomUntil ? this.bloomValue : 0;
  }

  alpha(nowMs: number): number {
    const a = this.active;
    return a ? flashAlpha(nowMs - a.start, a.ms, this.reducedMotion) : 0;
  }

  /** 本描画の後に呼ぶ。光っていなければ何もしない。 */
  render(renderer: WebGLRenderer, nowMs: number): void {
    const a = this.active;
    const alpha = this.alpha(nowMs);
    if (!a || alpha <= 0) {
      if (a && nowMs - a.start >= a.ms) this.active = null;
      return;
    }
    const u = this.material.uniforms;
    u.uAlpha!.value = alpha;
    const wash = WASH[a.style];
    u.uRainbow!.value = a.style === 'rainbow' || a.style === 'wash_gold' || a.style === 'wash_rainbow' ? 1 : 0;
    u.uWashRainbow!.value = a.style === 'wash_rainbow' ? 1 : 0;
    u.uTime!.value = nowMs / 1000;
    u.uWash!.value = wash ? 1 : 0;
    if (wash) {
      (u.uWashColor!.value as Vector3).set(...wash);
      u.uProg!.value = Math.min(1, (nowMs - a.start) / a.ms);
      renderer.getDrawingBufferSize(this.size);
      u.uAspect!.value = this.size.x / Math.max(1, this.size.y);
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  /** 演出の停止時（光とブルームを消す。回数の記録は残す）。 */
  clear(): void {
    this.active = null;
    this.bloomUntil = -Infinity;
  }

  dispose(): void {
    this.material.dispose();
    (this.scene.children[0] as Mesh).geometry.dispose();
  }
}
