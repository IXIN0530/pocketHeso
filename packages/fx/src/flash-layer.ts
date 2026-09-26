import {
  AdditiveBlending,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
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
varying vec2 vUv;
vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
void main() {
  vec3 c = mix(vec3(1.0), hue(vUv.y * 0.8 + vUv.x * 0.2 + uTime * 0.5), uRainbow);
  gl_FragColor = vec4(c * uAlpha, 1.0);
}`;

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

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uAlpha: { value: 0 }, uRainbow: { value: 0 }, uTime: { value: 0 } },
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
    u.uRainbow!.value = a.style === 'rainbow' ? 1 : 0;
    u.uTime!.value = nowMs / 1000;
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
