import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HalfFloatType,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { summarize, type FrameStats } from '../board/frame-stats.ts';

export interface ThreeOptions {
  balls: number;
  bloom: boolean;
  rainbow: boolean;
  glass: boolean;
}

export interface DrawInfo {
  calls: number;
  triangles: number;
}

// 盤面座標（単位 ≒ mm）。中心が原点、y は上向き。
const W = 360;
const H = 480;
const BALL_R = 5.5;
const NAIL_R = 1.3;
const GRAVITY = 0.0005; // 単位/ms²
const LCD = { x: 0, y: 40, w: 150, h: 110 };
const YAKU: readonly [number, number][] = [
  [-120, 160], [-40, 175], [40, 175], [120, 160],
  [-120, -120], [-40, -140], [40, -140], [120, -120],
];

interface Ball {
  m: Mesh;
  vx: number;
  vy: number;
  age: number;
}

/**
 * P0-T6: spec/50 の性能目標と同等の負荷を Three.js で立体に描く。素材は使わず、環境マップ（RoomEnvironment）と
 * 手続き生成のテクスチャだけで質感を出す（外部アセットのライセンス問題を避けるため）。
 */
export class ThreeBoard {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 10, 5000);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly balls: Ball[] = [];
  private readonly ballGeo = new SphereGeometry(BALL_R, 32, 16);
  private readonly ballMat = new MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 });
  private readonly nails: [number, number][] = [];
  private readonly yakumono: Group[] = [];
  private readonly lamps: MeshStandardMaterial[] = [];
  private readonly lcdCtx: CanvasRenderingContext2D | null;
  private readonly lcdTex: CanvasTexture;
  private readonly rainbow: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly glass: Mesh;
  private readonly host: HTMLElement;
  private readonly resizeObs: ResizeObserver;
  private opts: ThreeOptions;
  private frameMs: number[] = [];
  private last = 0;
  private elapsed = 0;
  private homeZ = 1000;
  private reachT = -1;

  constructor(host: HTMLElement, opts: ThreeOptions, pixelRatio: number) {
    this.host = host;
    this.opts = opts;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    // ブルームはパスを重ねるので、フレーム単位で draw call を数える。
    this.renderer.info.autoReset = false;
    host.appendChild(this.renderer.domElement);

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.background = new Color(0x05060f);
    pmrem.dispose();
    const key = new DirectionalLight(0xffffff, 1.2);
    key.position.set(-200, 300, 600);
    this.scene.add(key);

    this.scene.add(this.buildBoard());
    this.scene.add(this.buildNails());
    this.scene.add(this.buildFrame());
    for (const [x, y] of YAKU) {
      const g = windmill();
      g.position.set(x, y, 8);
      this.yakumono.push(g);
      this.scene.add(g);
    }

    const lcdCanvas = document.createElement('canvas');
    lcdCanvas.width = 300;
    lcdCanvas.height = 220;
    this.lcdCtx = lcdCanvas.getContext('2d');
    this.lcdTex = new CanvasTexture(lcdCanvas);
    this.lcdTex.colorSpace = SRGBColorSpace;
    const lcd = new Mesh(new PlaneGeometry(LCD.w, LCD.h), new MeshBasicMaterial({ map: this.lcdTex, toneMapped: false }));
    lcd.position.set(LCD.x, LCD.y, 3);
    this.scene.add(lcd);

    this.glass = new Mesh(
      new PlaneGeometry(W + 20, H + 20),
      // 黒の加算合成にして、環境の映り込み（鏡面反射）だけを足す。白く曇らせない。
      new MeshStandardMaterial({
        color: 0x000000,
        metalness: 0,
        roughness: 0.03,
        envMapIntensity: 0.25,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glass.position.z = 16;
    this.scene.add(this.glass);

    this.rainbow = new Mesh(new PlaneGeometry(2, 2), rainbowMaterial());
    this.rainbow.frustumCulled = false;
    this.rainbow.renderOrder = 999;
    this.scene.add(this.rainbow);

    const rt = new WebGLRenderTarget(1, 1, { samples: 4, type: HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.4, 0.3, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.apply(opts);
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.setRunning(true);
  }

  get info(): DrawInfo {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  apply(opts: ThreeOptions): void {
    this.opts = opts;
    this.bloom.enabled = opts.bloom;
    this.rainbow.visible = opts.rainbow;
    this.glass.visible = opts.glass;
    while (this.balls.length < opts.balls) {
      const b: Ball = { m: new Mesh(this.ballGeo, this.ballMat), vx: 0, vy: 0, age: 0 };
      respawn(b);
      b.m.position.y = -H / 2 + Math.random() * H;
      b.m.position.x = (Math.random() - 0.5) * (W - 40);
      this.scene.add(b.m);
      this.balls.push(b);
    }
    while (this.balls.length > opts.balls) {
      const b = this.balls.pop();
      if (b) this.scene.remove(b.m);
    }
  }

  /** リーチ演出を想定したカメラの寄り（液晶へ 1.2 秒で寄り、3 秒後に戻る）。 */
  reach(): void {
    this.reachT = 0;
  }

  setRunning(running: boolean): void {
    this.last = 0;
    this.renderer.setAnimationLoop(running ? (t) => this.frame(t) : null);
  }

  takeStats(): FrameStats {
    const f = this.frameMs;
    this.frameMs = [];
    return summarize(f);
  }

  destroy(): void {
    this.setRunning(false);
    this.resizeObs.disconnect();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // 盤面（枠込み）が縦横どちらにも収まる距離。
    const halfV = (this.camera.fov * Math.PI) / 360;
    const needH = (H + 60) / 2 / Math.tan(halfV);
    const needW = (W + 60) / 2 / (Math.tan(halfV) * this.camera.aspect);
    this.homeZ = Math.max(needH, needW);
    this.camera.updateProjectionMatrix();
  }

  private frame(now: number): void {
    this.renderer.info.reset();
    const dt = this.last === 0 ? 16.7 : now - this.last;
    this.last = now;
    this.frameMs.push(dt);
    this.elapsed += dt;
    const step = Math.min(dt, 50);

    for (let t = step; t > 0; t -= 4) this.physics(Math.min(4, t));
    this.yakumono.forEach((g, i) => {
      g.rotation.z += (step / 1000) * (1.5 + i * 0.3) * (i % 2 ? -1 : 1);
    });
    this.lamps.forEach((m, i) => m.emissive.setHSL((this.elapsed / 3000 + i / this.lamps.length) % 1, 1, 0.5));
    this.drawLcd();
    this.updateCamera(step);
    if (this.rainbow.visible) this.rainbow.material.uniforms.uTime!.value = this.elapsed / 1000;

    if (this.opts.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private physics(dt: number): void {
    const minD = BALL_R + NAIL_R;
    for (const b of this.balls) {
      const p = b.m.position;
      b.age += dt;
      b.vy -= GRAVITY * dt;
      p.x += b.vx * dt;
      p.y += b.vy * dt;
      for (const [nx, ny] of this.nails) {
        const dx = p.x - nx;
        const dy = p.y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const ux = dx / d;
        const uy = dy / d;
        p.x = nx + ux * minD;
        p.y = ny + uy * minD;
        const vn = b.vx * ux + b.vy * uy;
        if (vn < 0) {
          b.vx -= 1.5 * vn * ux;
          b.vy -= 1.5 * vn * uy;
          b.vx += (Math.random() - 0.5) * 0.02;
        }
      }
      collideBox(b, LCD.x, LCD.y, LCD.w / 2 + BALL_R, LCD.h / 2 + BALL_R);
      if (p.x < -W / 2 + BALL_R || p.x > W / 2 - BALL_R) {
        p.x = Math.max(-W / 2 + BALL_R, Math.min(W / 2 - BALL_R, p.x));
        b.vx = -b.vx * 0.6;
      }
      if (p.y < -H / 2 - BALL_R || b.age > 15000) respawn(b);
      b.m.rotation.z -= (b.vx * dt) / BALL_R;
    }
  }

  private drawLcd(): void {
    const c = this.lcdCtx;
    if (!c) return;
    const { width: w, height: h } = c.canvas;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1b0a3a');
    g.addColorStop(1, '#3a0f2a');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.font = 'bold 72px -apple-system, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const off = (this.elapsed * (0.25 + i * 0.07)) % 90;
      const base = Math.floor((this.elapsed * (0.25 + i * 0.07)) / 90);
      for (let k = -1; k <= 1; k++) {
        const n = ((base + k) % 9) + 1;
        c.fillStyle = n === 7 ? '#ff4060' : '#ffffff';
        c.fillText(String(n), 55 + i * 95, h / 2 + k * 90 + off - 45);
      }
    }
    this.lcdTex.needsUpdate = true;
  }

  private updateCamera(dt: number): void {
    let k = 0;
    if (this.reachT >= 0) {
      this.reachT += dt;
      const t = this.reachT;
      k = t < 1200 ? smooth(t / 1200) : t < 4200 ? 1 : t < 5400 ? 1 - smooth((t - 4200) / 1200) : 0;
      if (t >= 5400) this.reachT = -1;
    }
    const home = new Vector3(0, -30, this.homeZ);
    const near = new Vector3(LCD.x, LCD.y - 20, 560);
    this.camera.position.lerpVectors(home, near, k);
    this.camera.lookAt(0, LCD.y * k, 0);
  }

  private buildBoard(): Mesh {
    const c = document.createElement('canvas');
    c.width = 720;
    c.height = 960;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(360, 380, 40, 360, 480, 620);
      g.addColorStop(0, '#2d4db0');
      g.addColorStop(0.6, '#152a6b');
      g.addColorStop(1, '#0a1233');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 720, 960);
      ctx.strokeStyle = 'rgba(255,215,120,0.35)';
      ctx.lineWidth = 6;
      for (let r = 120; r < 700; r += 70) {
        ctx.beginPath();
        ctx.arc(360, 400, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,230,160,0.9)';
      ctx.font = 'bold 56px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PocketHeso', 360, 880);
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const m = new Mesh(new PlaneGeometry(W, H), new MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 }));
    return m;
  }

  private buildNails(): InstancedMesh {
    for (let row = 0; row < 32; row++) {
      for (let col = 0; col < 15; col++) {
        const x = -W / 2 + 16 + col * 23 + (row % 2) * 11.5;
        const y = H / 2 - 50 - row * 13;
        if (x > W / 2 - 10) continue;
        if (Math.abs(x - LCD.x) < LCD.w / 2 + 12 && Math.abs(y - LCD.y) < LCD.h / 2 + 12) continue;
        if (YAKU.some(([yx, yy]) => (x - yx) ** 2 + (y - yy) ** 2 < 34 * 34)) continue;
        this.nails.push([x, y]);
      }
    }
    const geo = new CylinderGeometry(NAIL_R, NAIL_R, 14, 10);
    geo.rotateX(Math.PI / 2);
    const mesh = new InstancedMesh(geo, new MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.25 }), this.nails.length);
    const o = new Object3D();
    this.nails.forEach(([x, y], i) => {
      o.position.set(x, y, 7);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    return mesh;
  }

  private buildFrame(): Group {
    const g = new Group();
    const plastic = new MeshPhysicalMaterial({ color: 0x2a2d3a, metalness: 0.6, roughness: 0.3, clearcoat: 1 });
    const bars: [number, number, number, number][] = [
      [0, H / 2 + 20, W + 80, 40],
      [0, -H / 2 - 20, W + 80, 40],
      [-W / 2 - 20, 0, 40, H],
      [W / 2 + 20, 0, 40, H],
    ];
    for (const [x, y, w, h] of bars) {
      const m = new Mesh(new BoxGeometry(w, h, 30), plastic);
      m.position.set(x, y, 10);
      g.add(m);
    }
    const lampGeo = new SphereGeometry(7, 20, 12);
    for (let i = 0; i < 16; i++) {
      const mat = new MeshStandardMaterial({ color: 0x222222, emissive: 0xff0000, emissiveIntensity: 3 });
      this.lamps.push(mat);
      const side = i < 8 ? -1 : 1;
      const m = new Mesh(lampGeo, mat);
      m.position.set(side * (W / 2 + 20), H / 2 - 30 - (i % 8) * 60, 26);
      g.add(m);
    }
    return g;
  }
}

function windmill(): Group {
  const g = new Group();
  const gold = new MeshStandardMaterial({ color: 0xffc94a, metalness: 1, roughness: 0.2 });
  const blade = new BoxGeometry(24, 7, 3);
  for (let k = 0; k < 4; k++) {
    const b = new Mesh(blade, gold);
    const a = (k * Math.PI) / 2;
    b.position.set(Math.cos(a) * 12, Math.sin(a) * 12, 0);
    b.rotation.z = a;
    g.add(b);
  }
  const hub = new Mesh(new CylinderGeometry(5, 5, 6, 20), new MeshStandardMaterial({ color: 0xff3a6a, metalness: 0.3, roughness: 0.3 }));
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  return g;
}

function respawn(b: Ball): void {
  b.m.position.set(-W / 2 + 20 + Math.random() * 30, H / 2 - 12, 7);
  b.vx = 0.08 + Math.random() * 0.1;
  b.vy = 0;
  b.age = 0;
}

function collideBox(b: Ball, cx: number, cy: number, hw: number, hh: number): void {
  const p = b.m.position;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const px = hw - Math.abs(dx);
  const py = hh - Math.abs(dy);
  if (px <= 0 || py <= 0) return;
  if (px < py) {
    p.x += Math.sign(dx) * px;
    b.vx = Math.sign(dx) * Math.abs(b.vx) * 0.5;
  } else {
    p.y += Math.sign(dy) * py;
    b.vy = Math.sign(dy) * Math.abs(b.vy) * 0.5;
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 画面全体に加算で重ねる虹（クリップ空間に直接描く）。 */
function rainbowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        float a = 0.25 + 0.15 * sin(uTime * 8.0);
        gl_FragColor = vec4(hue(vUv.x * 0.7 + vUv.y * 0.5 - uTime * 0.4) * a, 1.0);
      }`,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
}
