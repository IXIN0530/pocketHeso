// 大当たり中の液晶の表示（D-077）を 2D Canvas に描き、液晶のシェーダーへテクスチャで重ねる。
// 描き直すのは中身（ラウンド・玉・出玉）が変わった時と、告知が動いている間（約30回/秒）だけ。
import { CanvasTexture, SRGBColorSpace } from 'three';
import { HUD_BONUS_MS, HUD_RESULT_MS, HUD_START_MS, type HudView } from './jackpot-hud.ts';
import type { LcdResultKind } from './lcd-timeline.ts';

/** 液晶と同じ縦横比（160:104）。 */
const W = 640;
const H = 416;
const FONT = '"Hiragino Sans", "Arial Black", -apple-system, sans-serif';
/** 告知の入り（拡大から戻る）と出（薄くなる）の時間。 */
const IN_MS = 320;
const OUT_MS = 400;

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

type Paint = 'gold' | 'rainbow' | 'ice' | 'green' | 'white';

const RESULT_TEXT: Record<LcdResultKind, { main: string; paint: Paint }> = {
  rushIn: { main: 'RUSH突入', paint: 'gold' },
  ltIn: { main: 'LT突入', paint: 'rainbow' },
  rushOn: { main: 'RUSH継続', paint: 'gold' },
  rushEnd: { main: 'RUSH終了', paint: 'ice' },
  jitanIn: { main: '時短突入', paint: 'green' },
  end: { main: '大当たり終了', paint: 'white' },
};

function resultSub(v: Extract<HudView, { k: 'result' }>): string {
  switch (v.kind) {
    case 'rushIn':
    case 'jitanIn':
      return v.spins > 0 ? `${v.spins}回  +${fmt(v.payout)}玉` : `+${fmt(v.payout)}玉`;
    case 'ltIn':
      return v.spins > 0 ? `${v.spins}回  ${v.chain}連` : `${v.chain}連`;
    case 'rushOn':
      return `${v.chain}連  ${fmt(v.balls)}玉`;
    case 'rushEnd':
      return `${v.chain}連  合計${fmt(v.balls)}玉`;
    case 'end':
      return `+${fmt(v.payout)}玉`;
  }
}

/** 入りの拡大（1.6 倍から少し行き過ぎて 1 へ）。 */
function popScale(t: number): number {
  const k = Math.min(1, t / IN_MS);
  return 1 + 0.6 * (1 - k) * (1 - k) - 0.08 * Math.sin(k * Math.PI);
}

function fadeOut(t: number, total: number): number {
  return Math.max(0, Math.min(1, (total - t) / OUT_MS));
}

export class HudCanvas {
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private key = '';
  /** 背景（図柄）を暗くする量（0..1）。シェーダーの uHudDim。 */
  dim = 0;
  /** 何か描いている。 */
  visible = false;
  /** reduced-motion: 入りの拡大をしない。 */
  calm = false;
  /** 液晶の隅に称号「殿堂入り」を常に出す（見た目の解放, spec/25）。 */
  title = false;

  constructor() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D が使えません');
    this.ctx = ctx;
    this.texture = new CanvasTexture(c);
    this.texture.colorSpace = SRGBColorSpace;
  }

  /** 表示を反映する（変わらなければ描き直さない）。 */
  update(v: HudView | null): void {
    const key = (v ? this.keyOf(v) : '') + (this.title ? '|t' : '');
    this.visible = v !== null || this.title;
    this.dim = !v ? 0 : v.k === 'round' ? 0.75 : 0.6 * fadeOut(v.t, HUD_RESULT_MS);
    if (key === this.key) return;
    this.key = key;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    if (v?.k === 'round') this.drawRound(v);
    else if (v?.k === 'result') this.drawResult(v);
    if (this.title) this.text('殿堂入り', W - 18, 30, 26, 'gold', { align: 'right', alpha: 0.9 });
    this.texture.needsUpdate = true;
  }

  private keyOf(v: HudView): string {
    // 動いている間は約30回/秒で描き直す。
    const step = (t: number, until: number) => (t < until ? Math.floor(t / 33) : -1);
    if (v.k === 'round') {
      return `r|${v.round}|${v.rounds}|${v.inRound}|${v.balls}|${v.chain}|${step(v.t, HUD_START_MS + 400)}|${v.bonus ? step(v.bonus.t, HUD_BONUS_MS) : -2}`;
    }
    return `x|${v.kind}|${v.payout}|${v.chain}|${v.balls}|${v.spins}|${step(v.t, HUD_RESULT_MS)}`;
  }

  private paint(kind: Paint, y0: number, y1: number): CanvasGradient | string {
    const g = this.ctx.createLinearGradient(0, y0, 0, y1);
    switch (kind) {
      case 'gold':
        g.addColorStop(0, '#fff7c2');
        g.addColorStop(0.45, '#ffd23a');
        g.addColorStop(0.55, '#e89a00');
        g.addColorStop(1, '#fff0a0');
        return g;
      case 'ice':
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.5, '#8fe6ff');
        g.addColorStop(1, '#d8f6ff');
        return g;
      case 'green':
        g.addColorStop(0, '#eaffd8');
        g.addColorStop(0.5, '#4be07a');
        g.addColorStop(1, '#c8ffd8');
        return g;
      case 'rainbow': {
        const h = this.ctx.createLinearGradient(0, 0, W, 0);
        ['#ff4d6d', '#ffb238', '#fff35c', '#4be07a', '#4dc3ff', '#b36bff'].forEach((c, i, a) => h.addColorStop(i / (a.length - 1), c));
        return h;
      }
      case 'white':
        return '#ffffff';
    }
  }

  /** 黒い縁取りの文字（中心 x, y。scale は中心からの拡大）。 */
  private text(s: string, x: number, y: number, px: number, fill: Paint, opts: { scale?: number; alpha?: number; align?: CanvasTextAlign } = {}): number {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha *= opts.alpha ?? 1;
    ctx.translate(x, y);
    const sc = this.calm ? 1 : (opts.scale ?? 1);
    ctx.scale(sc, sc);
    ctx.font = `italic 900 ${px}px ${FONT}`;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // 横幅に収める。
    const w = ctx.measureText(s).width;
    if (w > W - 40) ctx.scale((W - 40) / w, (W - 40) / w);
    ctx.lineWidth = Math.max(6, px * 0.16);
    ctx.strokeStyle = '#000000';
    ctx.strokeText(s, 0, 0);
    ctx.fillStyle = this.paint(fill, -px / 2, px / 2);
    ctx.fillText(s, 0, 0);
    ctx.restore();
    return w;
  }

  /** 告知の下地（横長の暗い帯）。 */
  private band(y: number, h: number, alpha: number): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.2, `rgba(0,0,0,${0.6 * alpha})`);
    g.addColorStop(0.8, `rgba(0,0,0,${0.6 * alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - h / 2, W, h);
  }

  private drawRound(v: Extract<HudView, { k: 'round' }>): void {
    // 始めは「大当たり nR」を大きく出し、ラウンドの表示へ切り替える。
    if (v.t < HUD_START_MS) {
      const a = fadeOut(v.t, HUD_START_MS);
      this.band(H * 0.45, H * 0.62, a);
      this.text('大当たり', W / 2, H * 0.36, 120, 'rainbow', { scale: popScale(v.t), alpha: a });
      this.text(`${v.rounds}R`, W / 2, H * 0.6, 76, 'gold', { scale: popScale(Math.max(0, v.t - 150)), alpha: a });
      if (v.chain > 0) this.text(`RUSH ${v.chain}連目`, W / 2, H * 0.77, 40, 'white', { alpha: a });
      return;
    }
    const a = Math.min(1, (v.t - HUD_START_MS) / 300);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = a;
    if (v.chain > 0) this.text(`RUSH ${v.chain}連目`, 20, 36, 30, 'gold', { align: 'left' });
    this.text('ROUND', W / 2, H * 0.15, 38, 'gold');
    // ラウンド数（大きく）と「/ 全ラウンド」。
    const num = String(v.round);
    ctx.font = `italic 900 150px ${FONT}`;
    const nw = ctx.measureText(num).width;
    const tail = `  / ${v.rounds}`;
    ctx.font = `italic 900 50px ${FONT}`;
    const tw = ctx.measureText(tail).width;
    const x0 = (W - nw - tw) / 2;
    this.text(num, x0 + nw / 2, H * 0.4, 150, 'white');
    this.text(tail, x0 + nw, H * 0.46, 50, 'white', { align: 'left' });
    // アタッカーに入った玉（1ラウンド count 個）。
    const gap = Math.min(44, (W - 120) / v.count);
    const px0 = W / 2 - (gap * (v.count - 1)) / 2;
    for (let i = 0; i < v.count; i++) {
      const x = px0 + i * gap;
      const y = H * 0.64;
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      if (i < v.inRound) {
        const g = ctx.createRadialGradient(x - 4, y - 5, 2, x, y, 14);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.5, '#ffd23a');
        g.addColorStop(1, '#c07000');
        ctx.fillStyle = g;
        ctx.shadowColor = '#ffcc33';
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.stroke();
      }
    }
    // 獲得出玉（「獲得 1,234玉」を1行で真ん中に）。
    const parts: [string, number, Paint][] = [['獲得 ', 30, 'white'], [fmt(v.balls), 66, 'gold'], ['玉', 30, 'white']];
    const widths = parts.map(([t, px]) => {
      ctx.font = `italic 900 ${px}px ${FONT}`;
      return ctx.measureText(t).width;
    });
    let x = (W - widths.reduce((a, b) => a + b, 0)) / 2;
    parts.forEach(([t, px, paint], i) => {
      this.text(t, x, H * 0.77 + (px < 40 ? 6 : 0), px, paint, { align: 'left' });
      x += widths[i]!;
    });
    ctx.restore();
    // 上乗せ（LT）。
    if (v.bonus) {
      const b = fadeOut(v.bonus.t, HUD_BONUS_MS);
      this.band(H * 0.42, H * 0.5, b);
      this.text('上乗せ', W / 2, H * 0.32, 60, 'white', { scale: popScale(v.bonus.t), alpha: b });
      this.text(`+${v.bonus.add}R`, W / 2, H * 0.52, 110, 'rainbow', { scale: popScale(Math.max(0, v.bonus.t - 120)), alpha: b });
    }
  }

  private drawResult(v: Extract<HudView, { k: 'result' }>): void {
    const a = Math.min(1, v.t / 150) * fadeOut(v.t, HUD_RESULT_MS);
    const r = RESULT_TEXT[v.kind];
    this.band(H * 0.45, H * 0.56, a);
    this.text(r.main, W / 2, H * 0.4, 112, r.paint, { scale: popScale(v.t), alpha: a });
    this.text(resultSub(v), W / 2, H * 0.62, 46, 'white', { alpha: a * Math.min(1, Math.max(0, (v.t - 200) / 200)) });
  }
}
