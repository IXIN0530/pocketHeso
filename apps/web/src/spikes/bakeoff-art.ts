import type { Board } from '@ph/core';

/**
 * BAKEOFF: 起動時に1回だけ Canvas 2D で焼く絵（盤面板・図柄アトラス・背景・ガラスの映り込み・ロゴ・ぼかし点）。
 * 毎フレームの Canvas 再描画はしない（spec/50）。座標は盤面 JSON のまま（左上原点・+y 下）で描く。
 */

/** 液晶の位置（盤面座標 mm）。盤面 JSON に液晶枠が無いので、ヘソの上の中央に置く。 */
export const LCD_RECT = { x: 125, y: 150, w: 160, h: 104 } as const;

const PX_PER_MM = 4;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D が使えません');
  return [c, ctx];
}

/** 決定論は不要（見た目だけ）だが、焼くたびに星の配置が変わらないよう簡易乱数を使う。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 盤面板（セル画）。釘・役物の影もここに焼き込む（光源は左上）。 */
export function bakeBoard(board: Board): HTMLCanvasElement {
  const W = board.widthMm;
  const H = board.heightMm;
  const [c, ctx] = canvas(W * PX_PER_MM, H * PX_PER_MM);
  ctx.scale(PX_PER_MM, PX_PER_MM);
  const cx = LCD_RECT.x + LCD_RECT.w / 2;
  const cy = LCD_RECT.y + LCD_RECT.h / 2;
  const rnd = lcg(20260926);

  // 地: 液晶を中心にした宇宙っぽい放射グラデーション。
  const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy + 40, 360);
  bg.addColorStop(0, '#5a2bb0');
  bg.addColorStop(0.35, '#2c1470');
  bg.addColorStop(0.7, '#140a3e');
  bg.addColorStop(1, '#07041a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 放射状の光条（交互に薄く）。
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 36; i++) {
    const a0 = (i / 36) * Math.PI * 2;
    const a1 = a0 + Math.PI / 36;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 700, a0, a1);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? 'rgba(255,170,255,0.045)' : 'rgba(120,200,255,0.03)';
    ctx.fill();
  }
  ctx.restore();

  // ガラス片のような面（液晶の中心から放射。筐体の装甲の面分割に合わせる）。
  const shards: [[number, number], [number, number]][] = [
    [[0, 0], [130, 0]],
    [[300, 0], [420, 0]],
    [[420, 290], [420, 430]],
    [[0, 350], [0, 210]],
    [[150, 460], [270, 460]],
  ];
  for (const [[x0, y0], [x1, y1]] of shards) {
    const g = ctx.createLinearGradient(cx, cy, (x0 + x1) / 2, (y0 + y1) / 2);
    g.addColorStop(0, 'rgba(185,150,255,0.16)');
    g.addColorStop(1, 'rgba(120,200,255,0.02)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.closePath();
    ctx.fill();
  }

  // 氷色の細い回路線（左右の上から液晶の脇へ、下はヘソを囲む台形）。
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const trace = (pts: [number, number][], a: number) => {
    ctx.strokeStyle = `rgba(205,238,255,${a})`;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  ctx.lineWidth = 0.9;
  trace([[0, 170], [100, 110], [100, 30]], 0.35);
  trace([[420, 150], [320, 90], [320, 20]], 0.35);
  trace([[60, 460], [150, 270], [260, 270], [350, 460]], 0.3);
  ctx.lineWidth = 2.4;
  trace([[4, 176], [100, 116]], 0.1);
  trace([[416, 156], [320, 96]], 0.1);

  // 同心の軌道線。
  ctx.lineWidth = 0.8;
  for (let r = 70; r < 360; r += 42) {
    ctx.strokeStyle = `rgba(190,225,255,${0.16 - r / 3000})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.15, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 星（点と十字のきらめき）。
  for (let i = 0; i < 420; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const a = 0.25 + rnd() * 0.6;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.25 + rnd() * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const s = 3 + rnd() * 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 0.35, y - s, 0.7, s * 2);
    ctx.fillRect(x - s, y - 0.35, s * 2, 0.7);
  }

  // 発射レーン（右端の溝）と上部の返し。
  const lane = ctx.createLinearGradient(388, 0, 418, 0);
  lane.addColorStop(0, '#0b0b16');
  lane.addColorStop(0.5, '#1d1d2e');
  lane.addColorStop(1, '#0b0b16');
  ctx.fillStyle = lane;
  ctx.fillRect(388, 110, 30, 350);

  // アウト口（下端）。
  const out = ctx.createLinearGradient(0, 440, 0, H);
  out.addColorStop(0, 'rgba(0,0,0,0)');
  out.addColorStop(1, 'rgba(0,0,0,0.95)');
  ctx.fillStyle = out;
  ctx.fillRect(0, 440, 388, 20);

  // 液晶の左右に張り出すアクセント色の板（センター役物の翼）。
  for (const sx of [-1, 1]) {
    const ex = sx < 0 ? LCD_RECT.x : LCD_RECT.x + LCD_RECT.w;
    const g = ctx.createLinearGradient(ex, LCD_RECT.y, ex + sx * 40, LCD_RECT.y + 90);
    g.addColorStop(0, '#b996ff');
    g.addColorStop(0.5, '#7a3cff');
    g.addColorStop(1, '#35108a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ex, LCD_RECT.y);
    ctx.lineTo(ex + sx * 35, LCD_RECT.y + 16);
    ctx.lineTo(ex + sx * 41, LCD_RECT.y + 60);
    ctx.lineTo(ex, LCD_RECT.y + 90);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(235,245,255,0.8)';
    ctx.stroke();
  }

  // 液晶の落ち影。
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 10 * PX_PER_MM;
  ctx.shadowOffsetX = 2 * PX_PER_MM;
  ctx.shadowOffsetY = 3 * PX_PER_MM;
  ctx.fillStyle = '#000';
  roundRect(ctx, LCD_RECT.x - 5, LCD_RECT.y - 5, LCD_RECT.w + 10, LCD_RECT.h + 10, 8);
  ctx.fill();
  ctx.restore();

  // ヘソの的（同心円の光）と START の文字。
  const heso = board.sensors.find((s) => s.kind === 'start1');
  if (heso) {
    const hx = heso.x + heso.w / 2;
    const hy = heso.y + heso.h / 2;
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 34);
    glow.addColorStop(0, 'rgba(255,90,90,0.75)');
    glow.addColorStop(0.5, 'rgba(255,60,120,0.25)');
    glow.addColorStop(1, 'rgba(255,60,120,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(hx - 40, hy - 40, 80, 80);
    ctx.lineWidth = 1;
    for (const r of [14, 20, 27]) {
      ctx.strokeStyle = `rgba(255,220,150,${0.7 - r / 50})`;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = 'italic 900 7px -apple-system, "Helvetica Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff3c8';
    ctx.shadowColor = '#ff4070';
    ctx.shadowBlur = 3 * PX_PER_MM;
    ctx.fillText('START', hx, hy + 22);
    ctx.shadowBlur = 0;
  }

  // 役物の台座（金の縁取りの円盤）と落ち影。
  for (const y of board.yakumono) {
    const [x, yy] = [y.p.x, y.p.y];
    const r = y.r + 5;
    const sh = ctx.createRadialGradient(x + 2, yy + 3, r * 0.6, x + 2, yy + 3, r + 4);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(x + 2, yy + 3, r + 4, 0, Math.PI * 2);
    ctx.fill();
    const disc = ctx.createRadialGradient(x - r * 0.3, yy - r * 0.3, 1, x, yy, r);
    disc.addColorStop(0, '#3d2a7a');
    disc.addColorStop(1, '#120a30');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(x, yy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(205,238,255,0.55)';
    ctx.stroke();
  }

  // 釘の落ち影（3D の釘と位置を合わせる）。
  for (const pin of board.pins) {
    const x = pin.p.x + 1.6;
    const y = pin.p.y + 2.2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 3);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 3, y - 3, 6, 6);
  }

  // 周辺減光。
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  return c;
}

/** 図柄アトラス（3x3 マス、1〜9）。7 は赤金、偶数は青、奇数は緑。 */
export const ATLAS_CELL = 256;
export function bakeSymbolAtlas(): HTMLCanvasElement {
  const [c, ctx] = canvas(ATLAS_CELL * 3, ATLAS_CELL * 3);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'italic 900 210px "Arial Black", -apple-system, "Helvetica Neue", sans-serif';
  for (let n = 0; n < 9; n++) {
    const x = (n % 3) * ATLAS_CELL + ATLAS_CELL / 2;
    const y = Math.floor(n / 3) * ATLAS_CELL + ATLAS_CELL / 2 + 8;
    const digit = String(n + 1);
    const [top, bottom] =
      n === 6 ? ['#fff6a0', '#ff2a3a'] : n % 2 === 1 ? ['#c8f0ff', '#1f6bff'] : ['#e8ffc0', '#18b04a'];
    ctx.lineJoin = 'round';
    ctx.lineWidth = 26;
    ctx.strokeStyle = '#140820';
    ctx.strokeText(digit, x, y);
    ctx.lineWidth = 12;
    ctx.strokeStyle = n === 6 ? '#ffd24a' : '#ffffff';
    ctx.strokeText(digit, x, y);
    const g = ctx.createLinearGradient(0, y - 90, 0, y + 90);
    g.addColorStop(0, top);
    g.addColorStop(0.55, bottom);
    g.addColorStop(1, '#200018');
    ctx.fillStyle = g;
    ctx.fillText(digit, x, y);
    // 上半分のつや。
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - ATLAS_CELL / 2, y - 100, ATLAS_CELL, 80);
    ctx.clip();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x - ATLAS_CELL / 2, y - 100, ATLAS_CELL, 80);
    ctx.restore();
  }
  return c;
}

/** ホールの背景（隣の台の光がぼけて見える感じ）。 */
export function bakeHall(): HTMLCanvasElement {
  const [c, ctx] = canvas(256, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#0d0820');
  g.addColorStop(0.6, '#07051a');
  g.addColorStop(1, '#020108');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  const rnd = lcg(7);
  ctx.globalCompositeOperation = 'lighter';
  const hues = [320, 280, 200, 45, 10];
  for (let i = 0; i < 40; i++) {
    const x = rnd() < 0.5 ? rnd() * 50 : 206 + rnd() * 50;
    const y = rnd() * 400;
    const r = 6 + rnd() * 22;
    const h = hues[i % hues.length] ?? 0;
    const b = ctx.createRadialGradient(x, y, 0, x, y, r);
    b.addColorStop(0, `hsla(${h},90%,60%,0.22)`);
    b.addColorStop(1, `hsla(${h},90%,60%,0)`);
    ctx.fillStyle = b;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

/** ガラスの映り込み（斜めの帯）。ガラスの emissiveMap として加算で使う。 */
export function bakeGlare(): HTMLCanvasElement {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  ctx.save();
  ctx.translate(128, 128);
  ctx.rotate(-0.6);
  for (const [x, w, a] of [
    [-70, 60, 0.35],
    [-20, 10, 0.6],
    [60, 26, 0.18],
  ] as const) {
    const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w, -200, w * 2, 400);
  }
  ctx.restore();
  return c;
}

/** 白→黒のぼかし点（不透明。alphaMap に使う）。 */
export function bakeSoftDot(): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.5, '#888');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}
