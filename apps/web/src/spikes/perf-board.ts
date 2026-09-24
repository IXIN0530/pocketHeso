import { Application, ColorMatrixFilter, Container, Graphics, RenderTexture, Sprite, Text, Texture } from 'pixi.js';

export interface PerfOptions {
  balls: number;
  yakumono: number;
  rainbow: boolean;
  hueFilter: boolean;
}

export interface FrameStats {
  fps: number;
  p95Ms: number;
  maxMs: number;
  frames: number;
}

interface Ball {
  s: Sprite;
  vx: number;
  vy: number;
}

const BOARD_W = 360;
const BOARD_H = 480;
const GRAVITY = 0.0006; // px/ms²

/**
 * P0-T5: spec/50 の性能目標（20玉＋役物8＋液晶演出＋全画面の虹フラッシュ）に近い負荷を Pixi で再現する。
 * 盤面座標は 360x480 固定で、表示サイズに合わせて拡大縮小する。
 */
export class PerfBoard {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly ballLayer = new Container();
  private readonly yakuLayer = new Container();
  private readonly reels: Text[] = [];
  private readonly balls: Ball[] = [];
  private readonly hue = new ColorMatrixFilter();
  private rainbow: Sprite | null = null;
  private ballTexture: Texture | null = null;
  private elapsed = 0;
  private frameMs: number[] = [];
  private opts: PerfOptions;
  private destroyed = false;
  private ready = false;

  constructor(opts: PerfOptions) {
    this.opts = opts;
  }

  get rendererName(): string {
    return this.ready ? this.app.renderer.name : '-';
  }

  async init(host: HTMLElement, resolution: number): Promise<void> {
    await this.app.init({
      resizeTo: host,
      resolution,
      autoDensity: true,
      antialias: true,
      background: '#0b0e24',
      preference: 'webgl',
    });
    if (this.destroyed) {
      this.app.destroy(true, { children: true, texture: true });
      return;
    }
    this.ready = true;
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);

    this.world.addChild(this.bakeBoard(resolution));
    this.world.addChild(this.buildLcd());
    this.world.addChild(this.yakuLayer, this.ballLayer);

    this.ballTexture = this.app.renderer.generateTexture(
      new Graphics().circle(6, 6, 6).fill(0xd8dde8).circle(4, 4, 2).fill(0xffffff),
    );
    this.rainbow = new Sprite(rainbowTexture());
    this.rainbow.blendMode = 'add';
    this.app.stage.addChild(this.rainbow);

    this.apply(this.opts);
    this.layout();
    this.app.renderer.on('resize', () => this.layout());
    this.app.ticker.add((t) => this.tick(t.deltaMS));
  }

  apply(opts: PerfOptions): void {
    this.opts = opts;
    if (!this.ready) return;
    this.syncBalls();
    this.syncYakumono();
    if (this.rainbow) this.rainbow.visible = opts.rainbow;
    this.app.stage.filters = opts.hueFilter ? [this.hue] : [];
  }

  setRunning(running: boolean): void {
    if (!this.ready) return;
    if (running) this.app.ticker.start();
    else this.app.ticker.stop();
  }

  /** 直近の計測窓の統計を返して窓をリセットする。 */
  takeStats(): FrameStats {
    const f = this.frameMs;
    this.frameMs = [];
    if (f.length === 0) return { fps: 0, p95Ms: 0, maxMs: 0, frames: 0 };
    const total = f.reduce((a, b) => a + b, 0);
    const sorted = [...f].sort((a, b) => a - b);
    return {
      fps: (f.length * 1000) / total,
      p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
      maxMs: sorted[sorted.length - 1] ?? 0,
      frames: f.length,
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.ready) this.app.destroy(true, { children: true, texture: true });
    this.ready = false;
  }

  private layout(): void {
    const { width, height } = this.app.screen;
    const scale = Math.min(width / BOARD_W, height / BOARD_H);
    this.world.scale.set(scale);
    this.world.position.set((width - BOARD_W * scale) / 2, (height - BOARD_H * scale) / 2);
    if (this.rainbow) {
      this.rainbow.width = width;
      this.rainbow.height = height;
    }
  }

  /** 釘数百本を1枚の RenderTexture に焼く（spec/50 の方針どおり）。 */
  private bakeBoard(resolution: number): Sprite {
    const g = new Graphics().roundRect(0, 0, BOARD_W, BOARD_H, 16).fill(0x1c2a5a);
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 14; col++) {
        const x = 18 + col * 24 + (row % 2) * 12;
        const y = 40 + row * 14;
        if (x < BOARD_W - 10) g.circle(x, y, 1.6);
      }
    }
    g.fill(0xc9b27a);
    const rt = RenderTexture.create({ width: BOARD_W, height: BOARD_H, resolution });
    this.app.renderer.render({ container: g, target: rt });
    g.destroy();
    return new Sprite(rt);
  }

  private buildLcd(): Container {
    const lcd = new Container();
    lcd.position.set(110, 150);
    lcd.addChild(new Graphics().roundRect(0, 0, 140, 90, 8).fill(0x05060f).stroke({ color: 0xe8b840, width: 2 }));
    const mask = new Graphics().rect(4, 4, 132, 82).fill(0xffffff);
    const strip = new Container();
    strip.mask = mask;
    lcd.addChild(mask, strip);
    for (let i = 0; i < 3; i++) {
      const t = new Text({
        text: '1\n2\n3\n4\n5\n6\n7\n8\n9\n1',
        style: { fill: 0xffffff, fontSize: 40, fontWeight: 'bold', lineHeight: 44, align: 'center' },
      });
      t.x = 14 + i * 44;
      strip.addChild(t);
      this.reels.push(t);
    }
    return lcd;
  }

  private syncBalls(): void {
    if (!this.ballTexture) return;
    while (this.balls.length < this.opts.balls) {
      const s = new Sprite(this.ballTexture);
      s.anchor.set(0.5);
      const b = { s, vx: 0, vy: 0 };
      respawn(b);
      b.s.y = Math.random() * BOARD_H;
      this.ballLayer.addChild(s);
      this.balls.push(b);
    }
    while (this.balls.length > this.opts.balls) this.balls.pop()?.s.destroy();
  }

  private syncYakumono(): void {
    const n = this.opts.yakumono;
    while (this.yakuLayer.children.length < n) {
      const i = this.yakuLayer.children.length;
      const blades = new Container();
      for (let k = 0; k < 4; k++) {
        const b = new Graphics().poly([0, 0, 22, -6, 22, 6]).fill(0xe8b840);
        b.rotation = (k * Math.PI) / 2;
        blades.addChild(b);
      }
      blades.addChild(new Graphics().circle(0, 0, 5).fill(0xff5a7a));
      blades.position.set(50 + (i % 4) * 87, i < 4 ? 100 : 320);
      this.yakuLayer.addChild(blades);
    }
    while (this.yakuLayer.children.length > n) this.yakuLayer.children.at(-1)?.destroy({ children: true });
  }

  private tick(dt: number): void {
    this.frameMs.push(dt);
    this.elapsed += dt;
    const step = Math.min(dt, 50);

    for (const b of this.balls) {
      b.vy += GRAVITY * step;
      b.s.x += b.vx * step;
      b.s.y += b.vy * step;
      if (b.s.x < 8 || b.s.x > BOARD_W - 8) b.vx = -b.vx;
      if (b.s.y > BOARD_H - 8) respawn(b);
    }
    this.yakuLayer.children.forEach((c, i) => {
      c.rotation += (step / 1000) * (1.5 + i * 0.3);
    });
    this.reels.forEach((t, i) => {
      t.y = -((this.elapsed * (0.25 + i * 0.07)) % (44 * 9));
    });
    if (this.rainbow?.visible) this.rainbow.alpha = 0.35 + 0.25 * Math.sin(this.elapsed / 120);
    if (this.opts.hueFilter) this.hue.hue((this.elapsed / 5) % 360, false);
  }
}

function respawn(b: Ball): void {
  b.s.x = 20 + Math.random() * 40;
  b.s.y = 10;
  b.vx = 0.05 + Math.random() * 0.08;
  b.vy = 0;
}

function rainbowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 256, 256);
    ['#ff004c', '#ff9a00', '#fff200', '#2bff5b', '#00b3ff', '#7a3cff', '#ff00d4'].forEach((col, i, a) =>
      g.addColorStop(i / (a.length - 1), col),
    );
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return Texture.from(c);
}
