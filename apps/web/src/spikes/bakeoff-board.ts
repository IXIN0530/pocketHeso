import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
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
  MeshPhysicalMaterial,
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
  TubeGeometry,
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
import { BALL_RADIUS_MM, type Board, type BoardYakumono, type Vec2 } from '@ph/core';
import { LCD_RECT, bakeBoard, bakeGlare, bakeHall, bakeLogo, bakeSoftDot, bakeSymbolAtlas } from './bakeoff-art.ts';
import { BallPlayer, MAX_BALLS } from './bakeoff-balls.ts';
import { LcdReels } from './bakeoff-lcd.ts';
import { summarize, type FrameStats } from './frame-stats.ts';

export interface DrawInfo {
  calls: number;
  triangles: number;
}

/** 当たり演出の長さ（ブルームを ON にしておく時間）。 */
const WIN_MS = 3000;

// 奥行き（spec/50）: 盤面板 0 → 液晶 +3 → 玉・釘 +7 → 役物 +8 → ガラス +16 → 枠 +10〜+26。
const Z_LCD = 3;
const Z_BALL = 7;
const Z_YAKU = 8;
const Z_GLASS = 16;
const Z_FRAME_FACE = 26;

// 筐体（盤面中心が原点のワールド座標 mm）。
const CAB_HALF_W = 248;
const CAB_TOP = 300;
const PANEL_BOTTOM = -250;
const TRAY_BOTTOM = -346;

/** 役物の見た目（盤面 JSON の id ごと）。periodS は spec/23 の値が来るまでの仮。 */
const YAKU_STYLE: Record<string, { blades: number; color: number; periodS: number; pay: number }> = {
  windmill: { blades: 4, color: 0x35e0ff, periodS: 2.0, pay: 1 },
  'spinner-r': { blades: 3, color: 0xff3fb4, periodS: 1.6, pay: 2 },
  'pocket-l': { blades: 6, color: 0xffb020, periodS: 2.8, pay: 3 },
  'pocket-r': { blades: 6, color: 0xffb020, periodS: 2.4, pay: 3 },
  'gate-l': { blades: 2, color: 0x7dff4a, periodS: 1.2, pay: 1 },
  'gate-r': { blades: 2, color: 0x7dff4a, periodS: 1.2, pay: 1 },
  'center-top': { blades: 8, color: 0xffd84a, periodS: 3.6, pay: 5 },
  'center-bottom': { blades: 5, color: 0xff4050, periodS: 2.2, pay: 2 },
};
const YAKU_DEFAULT = { blades: 4, color: 0xffffff, periodS: 2, pay: 1 };

interface Yaku {
  group: Group;
  data: BoardYakumono;
  omega: number;
  angle: number;
  turns: number;
  pay: number;
}

interface Lamp {
  phase: number;
}

/**
 * BAKEOFF: default.json の盤面を Three.js で描くスパイク（spec/50 の構成・奥行き・質感に従う）。
 * 盤面板は Canvas 2D の1枚、釘は InstancedMesh 1つ、玉は Core の BallSimulator の軌跡を毎フレーム補間。
 * タップで当たり演出（虹の加算クアッド＋ブルーム3秒）。
 */
export class BakeoffBoard {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 50, 6000);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly board: Board;
  private readonly player: BallPlayer;
  private readonly lcd: LcdReels;
  private readonly ballMeshes: Mesh[] = [];
  private readonly ballShadows: InstancedMesh;
  private readonly yaku: Yaku[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly lampMesh: InstancedMesh;
  private readonly domeMats: MeshStandardMaterial[] = [];
  private readonly ledLine: ShaderMaterial;
  private readonly rainbow: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly hesoMat: MeshStandardMaterial;
  private readonly lcdLight: PointLight;
  private readonly hesoLight: PointLight;
  private readonly host: HTMLElement;
  private readonly popLayer: HTMLElement;
  private readonly resizeObs: ResizeObserver;
  private readonly tmp = new Object3D();
  private readonly v = new Vector3();
  private readonly c = new Color();
  private frameMs: number[] = [];
  private last = 0;
  private elapsed = 0;
  private winMs = -1;
  private hesoFlash = 0;
  private homeDist = 1400;
  private readonly homeY = (CAB_TOP + TRAY_BOTTOM) / 2;

  constructor(host: HTMLElement, popLayer: HTMLElement, board: Board, dirs: readonly Vec2[]) {
    this.host = host;
    this.popLayer = popLayer;
    this.board = board;
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

    const atlas = tex(bakeSymbolAtlas());
    this.lcd = new LcdReels(atlas);
    this.scene.add(this.buildLcd());

    this.scene.add(this.buildCabinet());
    this.lampMesh = this.buildLamps();
    this.scene.add(this.lampMesh);
    this.ledLine = ledLineMaterial();
    this.scene.add(this.buildLedLine());
    this.scene.add(this.buildGlass());

    // 玉: ジオメトリとマテリアルを全玉で共有（spec/50）。
    const ballGeo = new SphereGeometry(BALL_RADIUS_MM, 28, 18);
    const ballMat = new MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 });
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

    const rt = new WebGLRenderTarget(1, 1, { samples: 4, type: HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // しきい値 1.2 で emissive（ランプ・液晶・虹）だけを光らせる（spec/50）。
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.7, 0.35, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.player = new BallPlayer(board, dirs, performance.now());
    this.resize();
    // 最初のフレームより前に定位置へ（ポップの画面座標がカメラに依存するため）。
    this.updateCamera();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.setRunning(true);
  }

  get info(): DrawInfo {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  /** 当たり演出（3秒。連打したら頭から）。 */
  win(): void {
    this.winMs = 0;
    this.lcd.win();
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
    // 筐体が縦横どちらにも収まる距離。
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    const needH = (CAB_TOP - TRAY_BOTTOM + 30) / 2 / t;
    const needW = (CAB_HALF_W * 2 + 30) / 2 / (t * this.camera.aspect);
    this.homeDist = Math.max(needH, needW) + 60;
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

    this.player.grow(4);
    this.player.update(now, (kind, x, y) => {
      if (kind !== 'start1') return;
      this.lcd.addHold();
      this.hesoFlash = 1;
      this.toWorld(x, y, Z_BALL, this.v);
      this.pop('+3', this.v, '#ff7a9a');
    });
    this.hesoFlash = Math.max(0, this.hesoFlash - dt / 500);
    this.updateBalls();
    this.updateYakumono(dt, winLevel);
    this.lcd.update(dt, winLevel);
    this.updateLamps(sec, winLevel, white);
    this.updateCamera();

    this.rainbow.visible = winning;
    if (winning) {
      const u = this.rainbow.material.uniforms;
      u.uTime!.value = sec;
      u.uAmt!.value = winLevel * (0.5 + 0.5 * Math.abs(Math.sin(this.winMs * 0.011)));
      u.uWhite!.value = white;
    }

    // ブルームは当たり演出の3秒だけ（常時は重いので使わない, spec/50）。
    if (winning) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private updateBalls(): void {
    const balls = this.player.balls;
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

  private updateYakumono(dt: number, winLevel: number): void {
    const speed = 1 + winLevel * 2.5;
    for (const y of this.yaku) {
      y.angle += y.omega * speed * (dt / 1000);
      y.group.rotation.z = y.angle;
      const turns = Math.floor(Math.abs(y.angle) / (Math.PI * 2));
      if (turns > y.turns) {
        y.turns = turns;
        // 1周ごとに「+玉数」（当たり中は画面が騒がしいので出さない）。
        if (winLevel === 0) this.pop(`+${y.pay}`, y.group.position, '#ffe27a');
      }
    }
  }

  private updateLamps(sec: number, winLevel: number, white: number): void {
    const reach = this.lcd.reach ? 1 : 0;
    const blink = Math.sin(sec * 50) > 0 ? 1 : 0.35;
    for (let i = 0; i < this.lamps.length; i++) {
      const p = this.lamps[i]?.phase ?? 0;
      // 通常: 金とピンクの流れる追いかけ。
      const wave = 0.5 + 0.5 * Math.sin(p * 0.55 - sec * 5);
      this.c.setHSL(wave > 0.5 ? 0.11 : 0.9, 0.95, 0.55);
      let k = 0.35 + 2.2 * wave * wave * wave;
      if (reach) {
        this.c.setHSL(0.99, 1, 0.5);
        k = 0.4 + 2.6 * (Math.sin(sec * 18 + p * 0.3) > 0 ? 1 : 0.1);
      }
      if (winLevel > 0) {
        this.c.setHSL((p * 0.045 + sec * 1.4) % 1, 1, 0.55);
        k = (1 + 1.5 * winLevel) * blink;
      }
      this.c.multiplyScalar(k + this.hesoFlash * 1.2 + white * 3);
      this.lampMesh.setColorAt(i, this.c);
    }
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;

    this.domeMats.forEach((m, i) => {
      if (winLevel > 0) m.emissive.setHSL((sec * 1.2 + i * 0.5) % 1, 1, 0.5);
      else if (reach) m.emissive.setHSL(0.99, 1, 0.5);
      else m.emissive.setHSL(i ? 0.55 : 0.92, 0.9, 0.5);
      m.emissiveIntensity = 1.2 + 0.8 * Math.sin(sec * (reach ? 20 : 3) + i * Math.PI) + winLevel * 2.5 * blink;
    });

    const u = this.ledLine.uniforms;
    u.uTime!.value = sec;
    u.uWin!.value = winLevel;
    u.uReach!.value = reach;
    u.uBoost!.value = this.hesoFlash * 0.8 + white * 2;

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

  private updateCamera(): void {
    // 当たりの瞬間だけ寄って揺らし、1.2 秒で定位置に戻す。
    let zoom = 1;
    let shake = 0;
    if (this.winMs >= 0) {
      const w = this.winMs;
      zoom = w < 180 ? 1 - 0.07 * (w / 180) : 1 - 0.07 * Math.max(0, 1 - (w - 180) / 1000);
      shake = Math.max(0, 1 - w / 600) * 3;
    }
    const d = this.homeDist * zoom;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    // 正面からわずかに見上げる。
    this.camera.position.set(sx, this.homeY - 45 + sy, d);
    this.camera.lookAt(sx * 0.5, this.homeY + sy * 0.5, 0);
  }

  /** 画面上の小さな数字ポップ（DOM。3D には入れない）。 */
  private pop(text: string, world: Vector3, color: string): void {
    this.v.copy(world).project(this.camera);
    const x = ((this.v.x + 1) / 2) * this.host.clientWidth;
    const y = ((1 - this.v.y) / 2) * this.host.clientHeight;
    const el = document.createElement('span');
    el.textContent = text;
    el.style.cssText =
      `position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);color:${color};` +
      'font:italic 800 13px -apple-system,system-ui,sans-serif;text-shadow:0 0 6px rgba(0,0,0,.9),0 0 10px ' +
      `${color};pointer-events:none;white-space:nowrap;`;
    this.popLayer.appendChild(el);
    const a = el.animate(
      [
        { opacity: 0, transform: 'translate(-50%,-30%) scale(0.6)' },
        { opacity: 1, transform: 'translate(-50%,-80%) scale(1.1)', offset: 0.2 },
        { opacity: 0, transform: 'translate(-50%,-220%) scale(1)' },
      ],
      { duration: 900, easing: 'ease-out' },
    );
    a.onfinish = () => el.remove();
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
    const petal = new Shape();
    const w = len * (st.blades <= 2 ? 0.28 : 0.42);
    petal.moveTo(0, len * 0.15);
    petal.bezierCurveTo(w, len * 0.3, w * 0.9, len * 0.85, 0, len);
    petal.bezierCurveTo(-w * 0.9, len * 0.85, -w, len * 0.3, 0, len * 0.15);
    const parts: BufferGeometry[] = [];
    for (let k = 0; k < st.blades; k++) {
      const b = new ExtrudeGeometry(petal, { depth: 2, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.6, bevelSegments: 2, curveSegments: 8 });
      b.translate(0, 0, -1);
      b.rotateZ((k / st.blades) * Math.PI * 2);
      parts.push(b);
    }
    const blades = new Mesh(
      mergeGeometries(parts) ?? new BufferGeometry(),
      new MeshStandardMaterial({
        color: st.color,
        emissive: st.color,
        emissiveIntensity: 0.35,
        metalness: 0.1,
        roughness: 0.18,
        transparent: true,
        opacity: 0.88,
      }),
    );
    parts.forEach((p) => p.dispose());
    g.add(blades);
    const hub = new Mesh(new CylinderGeometry(1, 1, 1, 24), new MeshStandardMaterial({ color: 0xffd060, metalness: 1, roughness: 0.18 }));
    hub.rotation.x = Math.PI / 2;
    hub.scale.set(len * 0.3, 5, len * 0.3);
    g.add(hub);
    this.toWorld(y.p.x, y.p.y, Z_YAKU, g.position);
    const dir = this.yaku.length % 2 ? -1 : 1;
    this.yaku.push({ group: g, data: y, omega: (dir * Math.PI * 2) / st.periodS, angle: 0, turns: 0, pay: st.pay });
    return g;
  }

  private buildLcd(): Group {
    const g = new Group();
    const { x, y, w, h } = LCD_RECT;
    const screen = new Mesh(new PlaneGeometry(w, h), this.lcd.material);
    this.toWorld(x + w / 2, y + h / 2, Z_LCD, screen.position);
    g.add(screen);
    // 金の額縁（玉の中心より奥に置く）。
    const outer = roundedRectShape(w + 10, h + 10, 8);
    outer.holes.push(roundedRectShape(w, h, 4));
    const bezel = new Mesh(
      new ExtrudeGeometry(outer, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 2, curveSegments: 6 }),
      new MeshStandardMaterial({ color: 0xffcf6a, metalness: 1, roughness: 0.2 }),
    );
    bezel.position.copy(screen.position);
    bezel.position.z = Z_LCD + 0.2;
    g.add(bezel);
    return g;
  }

  private buildCabinet(): Group {
    const g = new Group();
    const bw = this.board.widthMm / 2 + 1;
    const bh = this.board.heightMm / 2 + 1;
    // 本体の枠（盤面の窓をくり抜いた厚板、パール調のクリア塗装）。
    const panel = new Shape();
    panel.moveTo(-CAB_HALF_W + 28, PANEL_BOTTOM);
    panel.lineTo(CAB_HALF_W - 28, PANEL_BOTTOM);
    panel.quadraticCurveTo(CAB_HALF_W, PANEL_BOTTOM, CAB_HALF_W, PANEL_BOTTOM + 28);
    panel.lineTo(CAB_HALF_W, CAB_TOP - 60);
    panel.quadraticCurveTo(CAB_HALF_W, CAB_TOP, CAB_HALF_W - 60, CAB_TOP);
    panel.lineTo(-CAB_HALF_W + 60, CAB_TOP);
    panel.quadraticCurveTo(-CAB_HALF_W, CAB_TOP, -CAB_HALF_W, CAB_TOP - 60);
    panel.lineTo(-CAB_HALF_W, PANEL_BOTTOM + 28);
    panel.quadraticCurveTo(-CAB_HALF_W, PANEL_BOTTOM, -CAB_HALF_W + 28, PANEL_BOTTOM);
    panel.holes.push(roundedRectShape(bw * 2, bh * 2, 16));
    const pearl = new MeshPhysicalMaterial({
      color: 0x120a26,
      metalness: 0.2,
      roughness: 0.34,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
    const body = new Mesh(new ExtrudeGeometry(panel, { depth: 10, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 3, curveSegments: 16 }), pearl);
    body.position.z = 13;
    g.add(body);

    // 窓の金縁。
    const rim = roundedRectShape(bw * 2 + 12, bh * 2 + 12, 20);
    rim.holes.push(roundedRectShape(bw * 2, bh * 2, 16));
    const gold = new MeshStandardMaterial({ color: 0xffcf6a, metalness: 1, roughness: 0.16 });
    const rimMesh = new Mesh(new ExtrudeGeometry(rim, { depth: 1.5, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2, bevelSegments: 2, curveSegments: 12 }), gold);
    rimMesh.position.z = Z_FRAME_FACE + 0.3;
    g.add(rimMesh);

    // 上部: ロゴと左右のドームランプ。
    const logo = new Mesh(
      new PlaneGeometry(300, 56),
      new MeshBasicMaterial({ map: tex(bakeLogo()), transparent: true, depthWrite: false, toneMapped: false }),
    );
    logo.position.set(0, (bh + CAB_TOP) / 2 + 2, Z_FRAME_FACE + 0.6);
    g.add(logo);
    const domeGeo = new SphereGeometry(17, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    domeGeo.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      const m = new MeshStandardMaterial({ color: 0x401020, emissive: 0xff40a0, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0 });
      this.domeMats.push(m);
      const d = new Mesh(domeGeo, m);
      d.position.set(side * 205, logo.position.y, Z_FRAME_FACE);
      d.scale.z = 0.7;
      g.add(d);
    }

    // 下部の上皿（手前に張り出した箱）＋クロームの縁＋ハンドル。
    const tray = roundedRectShape(CAB_HALF_W * 2, PANEL_BOTTOM - TRAY_BOTTOM - 4, 26);
    const trayMesh = new Mesh(new ExtrudeGeometry(tray, { depth: 30, bevelEnabled: true, bevelThickness: 4, bevelSize: 4, bevelSegments: 3, curveSegments: 12 }), pearl);
    trayMesh.position.set(0, (PANEL_BOTTOM + TRAY_BOTTOM) / 2 - 2, 13);
    g.add(trayMesh);
    const chrome = new MeshStandardMaterial({ color: 0xf0f2f8, metalness: 1, roughness: 0.1 });
    const lip = new Mesh(new BoxGeometry(CAB_HALF_W * 2 - 30, 4, 5), chrome);
    lip.position.set(0, PANEL_BOTTOM - 6, 48);
    g.add(lip);
    const ring = new Mesh(new TorusGeometry(22, 5, 14, 40), chrome);
    ring.position.set(200, TRAY_BOTTOM + 42, 50);
    g.add(ring);
    const knob = new Mesh(
      new CylinderGeometry(13, 13, 12, 28),
      new MeshPhysicalMaterial({ color: 0xd01830, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
    );
    knob.rotation.x = Math.PI / 2;
    knob.position.set(200, TRAY_BOTTOM + 42, 54);
    g.add(knob);
    return g;
  }

  /** 枠ランプ（LED の粒）。InstancedMesh 1つで、色を instanceColor → emissive に流す。 */
  private buildLamps(): InstancedMesh {
    const pos: [number, number, number][] = [];
    // 左右の柱（下から上へ）。
    for (let i = 0; i < 13; i++) {
      const y = -215 + i * 36;
      pos.push([-235, y, Z_FRAME_FACE]);
    }
    // 上端（左→右）。
    for (let i = 0; i < 15; i++) pos.push([-196 + i * 28, CAB_TOP - 10, Z_FRAME_FACE - 1]);
    for (let i = 12; i >= 0; i--) pos.push([235, -215 + i * 36, Z_FRAME_FACE]);
    // 上皿の前面。
    for (let i = 0; i < 12; i++) pos.push([-215 + i * 30, TRAY_BOTTOM + 24, 47.5]);
    const mat = new MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.2, metalness: 0 });
    mat.onBeforeCompile = (s) => {
      // instanceColor を emissive にも掛ける（1回の draw call で粒ごとに色を変える）。
      s.fragmentShader = s.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif',
      );
    };
    const geo = new SphereGeometry(5, 14, 10);
    const mesh = new InstancedMesh(geo, mat, pos.length);
    pos.forEach(([x, y, z], i) => {
      this.tmp.position.set(x, y, z);
      this.tmp.scale.set(1, 1, 0.6);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(i, this.tmp.matrix);
      mesh.setColorAt(i, this.c.setRGB(1, 1, 1));
      this.lamps.push({ phase: i });
    });
    this.tmp.scale.set(1, 1, 1);
    return mesh;
  }

  /** 窓を一周する LED ライン（色が流れる）。 */
  private buildLedLine(): Mesh {
    const hw = this.board.widthMm / 2 + 11;
    const hh = this.board.heightMm / 2 + 11;
    const r = 22;
    const pts: Vector3[] = [];
    const corner = (cx: number, cy: number, a0: number) => {
      for (let k = 0; k <= 8; k++) {
        const a = a0 + (k / 8) * (Math.PI / 2);
        pts.push(new Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Z_FRAME_FACE + 1.6));
      }
    };
    corner(hw - r, hh - r, 0);
    corner(-hw + r, hh - r, Math.PI / 2);
    corner(-hw + r, -hh + r, Math.PI);
    corner(hw - r, -hh + r, Math.PI * 1.5);
    const curve = new CatmullRomCurve3(pts, true, 'centripetal');
    const m = new Mesh(new TubeGeometry(curve, 360, 2.6, 8, true), this.ledLine);
    return m;
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
    const r = BALL_RADIUS_MM;
    const pos: [number, number, number][] = [];
    const baseY = PANEL_BOTTOM - 3 + r;
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < 22; k++) pos.push([-205 + (row % 2) * r + k * r * 2, baseY, 32 + row * 9.5]);
    }
    for (let k = 4; k < 14; k++) pos.push([-205 + r * 2 + k * r * 2, baseY + r * 1.6, 37]);
    const mesh = new InstancedMesh(geo, mat, pos.length);
    pos.forEach(([x, y, z], i) => {
      this.tmp.position.set(x, y, z);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(i, this.tmp.matrix);
    });
    return mesh;
  }
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

/** 窓まわりの LED ライン。通常は金とピンクが流れ、リーチで赤、当たりで虹。 */
function ledLineMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWin: { value: 0 }, uReach: { value: 0 }, uBoost: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWin, uReach, uBoost;
      varying vec2 vUv;
      ${HUE_GLSL}
      void main() {
        float x = vUv.x;
        float core = 1.0 - abs(vUv.y - 0.5) * 1.6;
        float dash = smoothstep(0.55, 1.0, sin(x * 90.0 - uTime * 9.0));
        vec3 base = mix(vec3(1.0, 0.62, 0.18), vec3(1.0, 0.22, 0.65), 0.5 + 0.5 * sin(x * 18.0 - uTime * 2.2));
        vec3 col = base * (0.55 + dash * 1.1);
        col = mix(col, vec3(1.0, 0.05, 0.08) * (0.6 + 1.4 * step(0.0, sin(uTime * 22.0 + x * 40.0))), uReach);
        col = mix(col, hue(x * 4.0 - uTime * 1.8) * (1.4 + dash * 1.2), uWin);
        col = col * core + uBoost;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}

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
