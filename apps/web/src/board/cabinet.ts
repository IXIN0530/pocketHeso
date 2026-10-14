import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Path,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
  type WebGLRenderer,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 筐体（枠）: Claude Design「PocketHeso 筐体デザイン」の採用案（パール × バイオレット）を立体にしたもの。
 * 形は図の SVG 座標（mm・盤面中心が原点・+y 下）をそのまま書き、y の反転は parsePath だけで行う。
 * 右半分だけ書いて左は flipX で作る（押し出しの面の向きは ExtrudeGeometry が直す）。
 * 参考にした最新機種の共通点: 翼形の柱・上部中央の円形役物・V 字に絞った下部と中央ボタン・
 * 線の LED・パール/クローム/スモークの3層・ベース＋アクセント1色。
 */

/** 筐体の外形（ワールド座標 mm、盤面中心が原点、+y 上）。カメラの収まり計算に使う。 */
export const CAB = { halfW: 288, top: 372, bottom: -446 } as const;

export interface CabinetPalette {
  body: number;
  trim: number;
  smoke: number;
  accent: number;
  led: number;
  /** パールの装甲の金属感（既定 0 = 樹脂）。クローム・金で上げる。 */
  metal?: number;
}

/** 配色（図の Palettes と同じ）。切り替えはここだけ。 */
export const PALETTES = {
  'pearl-violet': { body: 0xeef0f6, trim: 0x1a1922, smoke: 0x0b0b12, accent: 0x7a3cff, led: 0xcdeeff },
  'gunmetal-crimson': { body: 0x4a505d, trim: 0x101115, smoke: 0x08080b, accent: 0xe3122c, led: 0xffffff },
  chrome: { body: 0xd2d7e0, trim: 0x23262e, smoke: 0x0b0b12, accent: 0x9fb0c8, led: 0xe4faff, metal: 0.9 },
  gold: { body: 0xe9bd4c, trim: 0x2a1d08, smoke: 0x0b0a08, accent: 0xffc83a, led: 0xfff0c0, metal: 0.9 },
  'pearl-cyan': { body: 0xf1f4f8, trim: 0x161a22, smoke: 0x0a0c12, accent: 0x00aee0, led: 0xe4faff },
} as const satisfies Record<string, CabinetPalette>;

// 奥行き（spec/50 の「枠 +10〜+26」を前へ広げた。ボタン・ハンドルは手前に張り出す）。
const Z_BODY = 12;
/** 本体の前面（押し出し 10 ＋ベベル 2.5）の少し手前。本体に貼る部品はここから。 */
const Z_FACE = Z_BODY + 13;
const Z_PEARL = 24;
const Z_ACCENT = 29;

// ---- 形（SVG 座標。右半分 or 左右対称） ----
const BODY =
  'M 0 -372 L 60 -372 L 92 -350 L 200 -334 L 252 -316 Q 274 -310 274 -284 C 288 -200 290 -60 276 40 ' +
  'C 270 110 276 180 288 240 L 290 300 Q 290 324 274 334 L 264 420 Q 262 448 236 448 L 0 448 Z';
const SIDE_ARMOR =
  'M 229 -318 L 252 -312 Q 272 -306 270 -284 C 282 -190 284 -70 272 40 C 266 110 272 180 284 240 ' +
  'L 286 300 Q 286 322 268 330 L 254 316 C 248 240 244 160 248 80 C 252 -10 256 -130 246 -240 Z';
const SIDE_STRIPE =
  'M 246 -240 C 256 -130 252 -10 248 80 C 244 160 248 240 254 316 L 246 320 C 238 244 236 160 240 80 C 244 -10 247 -130 238 -242 Z';
const SIDE_CHANNEL =
  'M 224 -236 L 238 -242 C 247 -130 244 -10 240 80 C 236 160 238 244 246 320 L 232 322 C 226 244 224 160 224 80 Z';
const SIDE_CHANNEL_LED = 'M 231 -232 C 237 -120 234 -10 231 80 C 229 160 230 220 234 280';
const SIDE_FIN = 'M 284 240 L 286 300 L 266 282 Z';
const BROW =
  'M -222 -318 L -200 -330 L -92 -346 L -58 -366 L 58 -366 L 92 -346 L 200 -330 L 222 -318 L 238 -246 L -238 -246 Z';
const BROW_ACCENT = 'M 46 -354 L 92 -338 L 200 -322 L 224 -310 L 220 -302 L 196 -312 L 88 -328 L 42 -344 Z';
const BROW_LED = 'M 60 -334 L 196 -306';
const LOGO_PLATE = 'M -188 -284 L 188 -284 L 204 -266 L 188 -248 L -188 -248 L -204 -266 Z';
const V_PLATE = 'M 276 282 L 80 282 L 60 320 L 92 356 L 258 378 L 280 332 Z';
const V_ACCENT = 'M 92 356 L 258 378 L 262 369 L 98 347 Z';
const SPEAKER = 'M 258 388 L 96 366 L 62 402 L 62 430 L 258 430 Z';
const SPEAKER_IN = 'M 253 393 L 98 372 L 67 404 L 67 425 L 253 425 Z';
const HOUSING = 'M -86 252 L 86 252 L 72 350 L 0 408 L -72 350 Z';
const HOUSING_IN = 'M -76 260 L 76 260 L 63 344 L 0 395 L -63 344 Z';
const HOUSING_LED = 'M -76 260 L -63 344 L 0 395 L 63 344 L 76 260';

/** 窓（盤面の見える穴）とクロームの額。 */
const WIN = { halfW: 211, halfH: 231, r: 24 };
const BEZEL = { halfW: 218, halfH: 238, r: 30 };
const WIN_LED = { halfW: 221, halfH: 241, r: 32 };

const EMBLEM = { x: 0, y: -324, r: 36 };
const BUTTON = { x: 0, y: 312 };
const HANDLE = { x: 244, y: 398 };

/** SVG の path（M L Q C Z の絶対座標だけ）→ Shape。y を反転し、flipX で左右を反転する。 */
export function parsePath(d: string, flipX = false): Shape {
  const t = d.trim().split(/[\s,]+/);
  const s = new Shape();
  const sx = flipX ? -1 : 1;
  let i = 0;
  const x = () => Number(t[i++]) * sx;
  const y = () => -Number(t[i++]);
  while (i < t.length) {
    const c = t[i++];
    if (c === 'M') s.moveTo(x(), y());
    else if (c === 'L') s.lineTo(x(), y());
    else if (c === 'Q') s.quadraticCurveTo(x(), y(), x(), y());
    else if (c === 'C') s.bezierCurveTo(x(), y(), x(), y(), x(), y());
    else if (c !== 'Z') throw new Error(`未対応の path 命令: ${c}`);
  }
  return s;
}

/** 左右対称の外形: 右半分の path を左右に貼り合わせる（中心線 x=0 から始まり x=0 で終わる path）。 */
function mirroredShape(halfD: string): Shape {
  const right = parsePath(halfD).getPoints(24);
  const left = right.slice(1, -1).map((p) => new Vector2(-p.x, p.y)).reverse();
  return new Shape([...right, ...left]);
}

function roundedRect(hw: number, hh: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

function circle(x: number, y: number, r: number): Shape {
  const s = new Shape();
  s.absarc(x, -y, r, 0, Math.PI * 2, false);
  return s;
}

function ring(x: number, y: number, r0: number, r1: number): Shape {
  const s = circle(x, y, r1);
  const h = new Path();
  h.absarc(x, -y, r0, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

function extrude(shape: Shape, z: number, depth: number, bevel = 1.2): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 16,
  });
  g.translate(0, 0, z);
  return g;
}

/**
 * 成形品の樹脂パネル: 外形を変えずに（bevelOffset で内側から）縁を大きく丸める。
 * 丸い縁が照明の帯を拾うことで、平らな板ではなくつやのあるプラスチックに見える。
 */
function molded(shape: Shape, z: number, depth: number, round = 3): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: round,
    bevelSize: round,
    bevelOffset: -round,
    bevelSegments: 5,
    curveSegments: 20,
  });
  g.translate(0, 0, z);
  return g;
}

/** 形の違うジオメトリを1つに（draw call 1）。index の有無と groups を揃えてから結合する。 */
function merge(geos: BufferGeometry[]): BufferGeometry {
  const flat = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.clearGroups();
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    return n;
  });
  const out = mergeGeometries(flat) ?? new BufferGeometry();
  geos.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  return out;
}

/** 線の LED（path の点列 → 細い管）。aTint: 0 = 氷色、1 = アクセント色。 */
export function ledTube(points: Vector2[], z: number, radius: number, tint: number, closed = false): BufferGeometry {
  const curve = new CatmullRomCurve3(
    points.map((p) => new Vector3(p.x, p.y, z)),
    closed,
    'centripetal',
  );
  const segs = Math.max(24, Math.round(curve.getLength() / 3));
  const g = new TubeGeometry(curve, segs, radius, 8, closed);
  const n = g.attributes.position?.count ?? 0;
  g.setAttribute('aTint', new Float32BufferAttribute(new Float32Array(n).fill(tint), 1));
  return g;
}

function pathPoints(d: string, flipX = false, divisions = 40): Vector2[] {
  return parsePath(d, flipX).getSpacedPoints(divisions);
}

export interface CabinetState {
  sec: number;
  reach: number;
  win: number;
  /** ヘソ入賞などの一瞬の明るさ（0〜）。 */
  boost: number;
  /** 当たり中の点滅（0.35 or 1）。 */
  blink: number;
}

/**
 * 筐体一式。draw call: 本体・パール・アクセント・スモーク・クローム・LED・エンブレム・ボタン2・
 * スピーカー・ロゴ = 11（盤面側の液晶まわりの LED を足すと 12）。
 */
export class Cabinet {
  readonly group = new Group();
  readonly chrome: MeshStandardMaterial;
  readonly led: ShaderMaterial;
  private readonly emblem: ShaderMaterial;
  private readonly dome: MeshPhysicalMaterial;
  private readonly core: MeshBasicMaterial;
  private readonly accentMat: MeshPhysicalMaterial;
  private pal: CabinetPalette;
  private trimMat!: MeshPhysicalMaterial;
  private readonly c = new Color();
  private readonly glossy: MeshStandardMaterial[] = [];
  private readonly pearl: MeshPhysicalMaterial;
  private readonly smoke: MeshPhysicalMaterial;

  constructor(palette: CabinetPalette = PALETTES['pearl-violet']) {
    this.pal = palette;
    const g = this.group;

    // 本体（黒つや）: 外形から窓をくり抜く。
    const body = mirroredShape(BODY);
    body.holes.push(roundedRect(BEZEL.halfW - 1, BEZEL.halfH - 1, BEZEL.r));
    const trimMat = (this.trimMat = new MeshPhysicalMaterial({ color: palette.trim, metalness: 0.1, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.04 }));
    g.add(new Mesh(extrude(body, Z_BODY, 10, 2.5), trimMat));

    // パールの装甲（翼・眉・V 字の板）。
    // 白は地が明るくハイライトが埋もれるので、地を少し落としてクリアコートの映り込みで白さを出す。
    const pearl = (this.pearl = new MeshPhysicalMaterial({
      color: new Color(palette.body).multiplyScalar(0.93),
      metalness: 0,
      roughness: 0.2,
      // 樹脂の反射率 4% では白い地に映り込みが埋もれるので、下地の反射を強める（F0 ≈ 11%）。
      ior: 2.0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    }));
    moldedShading(pearl);
    g.add(
      new Mesh(
        merge([
          molded(parsePath(SIDE_ARMOR), Z_PEARL, 3.5, 3.5),
          molded(parsePath(SIDE_ARMOR, true), Z_PEARL, 3.5, 3.5),
          molded(parsePath(BROW), Z_PEARL, 3.5, 3.5),
          molded(parsePath(V_PLATE), Z_PEARL - 3, 3.5, 3.5),
          molded(parsePath(V_PLATE, true), Z_PEARL - 3, 3.5, 3.5),
        ]),
        pearl,
      ),
    );

    // アクセント色の帯（翼の内側・眉・V 字の板の下辺・翼の先・ハンドルのノブ）。
    this.accentMat = new MeshPhysicalMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.18,
      metalness: 0.55,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
    const knob = new CylinderGeometry(14, 14, 10, 32);
    knob.rotateX(Math.PI / 2);
    knob.translate(HANDLE.x, -HANDLE.y, 50);
    const accents: BufferGeometry[] = [knob];
    for (const flip of [false, true]) {
      accents.push(
        extrude(parsePath(SIDE_STRIPE, flip), Z_PEARL, 6, 0.8),
        extrude(parsePath(SIDE_FIN, flip), Z_ACCENT, 2.5, 0.8),
        extrude(parsePath(BROW_ACCENT, flip), Z_ACCENT + 1, 2.5, 0.8),
        extrude(parsePath(V_ACCENT, flip), Z_PEARL + 2, 2.5, 0.8),
      );
    }
    g.add(new Mesh(merge(accents), this.accentMat));

    // スモーク（翼の溝・ロゴ帯・ボタン台の内側・上皿の溝・スリット・エンブレムの地・台座）。
    // スモーク: 黒い透明樹脂（クリアコートで照明が映る）。
    const smoke = (this.smoke = new MeshPhysicalMaterial({ color: palette.smoke, metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03 }));
    const smokes: BufferGeometry[] = [
      extrude(parsePath(SIDE_CHANNEL), Z_PEARL - 2, 3, 0.6),
      extrude(parsePath(SIDE_CHANNEL, true), Z_PEARL - 2, 3, 0.6),
      extrude(parsePath(LOGO_PLATE), Z_ACCENT + 2, 2, 1),
      extrude(parsePath(HOUSING_IN), Z_ACCENT, 2, 0),
      extrude(circle(EMBLEM.x, EMBLEM.y, 37.5), Z_ACCENT + 1, 2, 0),
      extrude(circle(BUTTON.x, BUTTON.y, 38.5), Z_ACCENT + 3, 2, 0),
      extrude(circle(HANDLE.x, HANDLE.y, 21.5), 42, 4, 0),
      extrude(roundedRect(262, 6, 4), Z_FACE, 1, 0).translate(0, -438, 0),
    ];
    for (const sx of [-1, 1]) {
      smokes.push(extrude(roundedRect(72, 14, 10), Z_FACE, 1, 0).translate(sx * 142, -262, 0));
      // 翼の上部の斜めスリット。
      for (let k = 0; k < 3; k++) {
        const s = new ExtrudeGeometry(roundedRect(10, 1.6, 1.5), { depth: 1.5, bevelEnabled: false });
        s.rotateZ(sx * -0.72);
        s.translate(sx * (259 + k * 2), -(-259 + k * 16), Z_PEARL + 6.4);
        smokes.push(s);
      }
    }
    g.add(new Mesh(merge(smokes), smoke));

    // クローム（窓の額・エンブレムの輪・ボタン台と輪・ハンドル）。
    this.chrome = new MeshStandardMaterial({ color: 0xf2f4f8, metalness: 1, roughness: 0.08 });
    const bezel = roundedRect(BEZEL.halfW, BEZEL.halfH, BEZEL.r);
    bezel.holes.push(roundedRect(WIN.halfW, WIN.halfH, WIN.r));
    const housing = parsePath(HOUSING);
    housing.holes.push(parsePath(HOUSING_IN));
    const handleRing = new TorusGeometry(24.5, 3.6, 12, 48);
    handleRing.translate(HANDLE.x, -HANDLE.y, 46);
    const handleBar = new CylinderGeometry(2.4, 2.4, 28, 12);
    handleBar.translate(HANDLE.x, -HANDLE.y, 56);
    g.add(
      new Mesh(
        merge([
          extrude(bezel, Z_PEARL, 3, 1.4),
          extrude(ring(EMBLEM.x, EMBLEM.y, 37, 42), Z_ACCENT + 1, 4, 1.4),
          extrude(housing, Z_ACCENT, 3, 1.2),
          extrude(ring(BUTTON.x, BUTTON.y, 38, 44), Z_ACCENT + 3, 5, 1.6),
          handleRing,
          handleBar,
          ...[false, true].map((f) => {
            const frame = parsePath(SPEAKER, f);
            frame.holes.push(parsePath(SPEAKER_IN, f));
            return extrude(frame, Z_FACE, 1.5, 1);
          }),
          ...[-1, 1].map((sx) => {
            const lip = roundedRect(75, 17, 12);
            lip.holes.push(roundedRect(72, 14, 10));
            return extrude(lip, Z_FACE, 1.5, 0.8).translate(sx * 142, -262, 0);
          }),
        ]),
        this.chrome,
      ),
    );

    // 線の LED（窓の一周・翼の溝・眉・ロゴ帯の下線・ボタン台・台座）。流れる光のシェーダー1つ。
    this.led = cabinetLedMaterial(palette);
    const leds: BufferGeometry[] = [
      ledTube(roundedRect(WIN_LED.halfW, WIN_LED.halfH, WIN_LED.r).getSpacedPoints(220), Z_PEARL + 2, 2.2, 0, true),
      ledTube(pathPoints(HOUSING_LED, false, 60), Z_ACCENT + 3.4, 1.6, 0),
      ledTube(pathPoints('M -150 -251 L 150 -251', false, 20), Z_ACCENT + 4.4, 1.1, 1),
      ledTube(pathPoints('M -200 438 L 200 438', false, 30), Z_FACE + 1.4, 1.2, 1),
    ];
    for (const flip of [false, true]) {
      leds.push(
        ledTube(pathPoints(SIDE_CHANNEL_LED, flip, 80), Z_PEARL + 1.6, 2.2, 0),
        ledTube(pathPoints(BROW_LED, flip, 20), Z_PEARL + 7.4, 1.4, 0),
      );
    }
    g.add(new Mesh(merge2(leds), this.led));

    // エンブレム「HESO コア」（中心の同心円＋外周の LED の粒が回る）。
    this.emblem = emblemMaterial(palette);
    const em = new Mesh(new CircleGeometry(EMBLEM.r, 72), this.emblem);
    em.position.set(EMBLEM.x, -EMBLEM.y, Z_ACCENT + 3.2);
    g.add(em);

    // PUSH ボタン: 半透明のドームと中の発光コア。
    this.core = new MeshBasicMaterial({ color: palette.led, toneMapped: false });
    const core = new Mesh(new OctahedronGeometry(13, 0), this.core);
    core.scale.set(1, 1, 0.5);
    core.position.set(BUTTON.x, -BUTTON.y, Z_ACCENT + 7);
    g.add(core);
    this.dome = new MeshPhysicalMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.5,
      metalness: 0,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const domeGeo = new SphereGeometry(34, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    domeGeo.rotateX(Math.PI / 2);
    const dome = new Mesh(domeGeo, this.dome);
    dome.scale.set(1, 1, 0.55);
    dome.position.set(BUTTON.x, -BUTTON.y, Z_ACCENT + 4);
    g.add(dome);

    // スピーカー: ガンメタの穴あき金属板（穴の凹みは法線マップ、クロームの枠で囲む）。
    const [colorTex, normalTex] = bakeSpeakerMesh().map((c, i) => {
      const t = new CanvasTexture(c);
      if (i === 0) t.colorSpace = SRGBColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(1 / 14, 1 / 12);
      return t;
    }) as [CanvasTexture, CanvasTexture];
    const speakers = merge([new ShapeGeometry(parsePath(SPEAKER_IN), 4), new ShapeGeometry(parsePath(SPEAKER_IN, true), 4)]);
    speakers.translate(0, 0, Z_FACE + 0.5);
    g.add(
      new Mesh(
        speakers,
        new MeshStandardMaterial({ map: colorTex, normalMap: normalTex, normalScale: new Vector2(1.2, 1.2), metalness: 0.85, roughness: 0.32 }),
      ),
    );

    this.glossy.push(trimMat, pearl, this.accentMat, smoke, this.chrome, this.dome);

    // ロゴ帯の文字と PUSH の文字（1枚のテクスチャ、ジオメトリ2枚を結合）。
    const logoGeo = new PlaneGeometry(320, 30);
    remapUv(logoGeo, 0, 0.25, 1, 1);
    logoGeo.translate(0, 267, Z_ACCENT + 5.2);
    const pushGeo = new PlaneGeometry(40, 10);
    remapUv(pushGeo, 0.375, 0, 0.625, 0.25);
    pushGeo.translate(BUTTON.x, -372, Z_ACCENT + 3.2);
    const labels = new MeshBasicMaterial({ map: labelTexture(palette), transparent: true, depthWrite: false });
    g.add(new Mesh(merge([logoGeo, pushGeo]), labels));
  }

  /** 配色を差し替える（見た目の解放, spec/25）。形・材質の種類はそのまま、色と金属感だけ。ロゴの文字の絵は変えない。 */
  setPalette(p: CabinetPalette): void {
    this.pal = p;
    this.trimMat.color.setHex(p.trim);
    this.pearl.color.setHex(p.body).multiplyScalar(0.93);
    this.pearl.metalness = p.metal ?? 0;
    this.smoke.color.setHex(p.smoke);
    this.accentMat.color.setHex(p.accent);
    this.accentMat.emissive.setHex(p.accent);
    this.dome.color.setHex(p.accent);
    for (const m of [this.led, this.emblem]) {
      m.uniforms.uLed!.value.setHex(p.led);
      m.uniforms.uAccent!.value.setHex(p.accent);
    }
  }

  /** 筐体の材質（と盤面側で共有しているクローム）にだけ bakeCabinetEnv の映り込みを使う。 */
  setEnvironment(tex: Texture): void {
    for (const m of this.glossy) {
      m.envMap = tex;
      // アクセント色とスモークは映り込みで色が淡くならないよう控えめに。
      // クロームは反射率がほぼ 100% なので、照明の帯がブルームのしきい値（2.5）を超えないよう弱める。
      m.envMapIntensity = m === this.chrome ? 0.3 : m === this.accentMat || m === this.smoke ? 0.55 : 1;
      m.needsUpdate = true;
    }
  }

  update(s: CabinetState): void {
    const u = this.led.uniforms;
    u.uTime!.value = s.sec;
    u.uWin!.value = s.win;
    u.uReach!.value = s.reach;
    u.uBoost!.value = s.boost;
    const e = this.emblem.uniforms;
    e.uTime!.value = s.sec;
    e.uWin!.value = s.win;
    e.uReach!.value = s.reach;
    e.uBoost!.value = s.boost;

    // ボタン: 通常はゆっくり呼吸、リーチで赤の点滅、当たりで虹。
    if (s.win > 0) this.c.setHSL((s.sec * 1.2) % 1, 1, 0.55);
    else if (s.reach) this.c.setRGB(1, 0.05, 0.1);
    else this.c.setHex(this.pal.accent);
    this.dome.emissive.copy(this.c);
    this.dome.emissiveIntensity =
      0.45 + 0.25 * Math.sin(s.sec * (s.reach ? 18 : 2)) + s.win * 1.8 * s.blink + s.boost * 0.8;
    this.core.color.setHex(this.pal.led).multiplyScalar(0.9 + 0.5 * Math.sin(s.sec * 2) * 0.5 + s.win * 2 * s.blink + s.boost);
    this.accentMat.emissiveIntensity = 0.16 + 0.1 * Math.sin(s.sec * 1.6) + s.win * 0.6 * s.blink;
  }
}

/** aTint 付きの管を結合する（merge は aTint を消すので別に用意）。 */
function merge2(geos: BufferGeometry[]): BufferGeometry {
  const out = mergeGeometries(geos) ?? new BufferGeometry();
  geos.forEach((g) => g.dispose());
  return out;
}

/** PlaneGeometry の uv を atlas の一部 [u0,v0]-[u1,v1] に付け替える。 */
function remapUv(g: PlaneGeometry, u0: number, v0: number, u1: number, v1: number): void {
  const uv = g.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D が使えません');
  return [c, ctx];
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** 上 3/4 = ロゴ（クロームの斜体）、下段中央 = PUSH。透明地。 */
function labelTexture(p: CabinetPalette): CanvasTexture {
  const [c, ctx] = canvas(1024, 128);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // ロゴ（v 0.25〜1 = 上 96px）。
  ctx.font = 'italic 800 74px "Avenir Next Condensed", "Arial Narrow", -apple-system, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  ctx.lineJoin = 'round';
  ctx.shadowColor = css(p.accent);
  ctx.shadowBlur = 18;
  ctx.lineWidth = 6;
  ctx.strokeStyle = css(p.accent);
  ctx.strokeText('POCKET HESO', 512, 50);
  ctx.shadowBlur = 0;
  const g = ctx.createLinearGradient(0, 18, 0, 84);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#dfe4ee');
  g.addColorStop(0.55, '#ffffff');
  g.addColorStop(0.8, '#aab2c2');
  g.addColorStop(1, '#f4f6fa');
  ctx.fillStyle = g;
  ctx.fillText('POCKET HESO', 512, 50);
  // PUSH（v 0〜0.25 = 下 32px、u 0.375〜0.625 = 中央 256px）。
  ctx.font = 'italic 800 24px "Avenir Next", -apple-system, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillStyle = css(p.led);
  ctx.shadowColor = css(p.accent);
  ctx.shadowBlur = 8;
  ctx.fillText('PUSH', 512, 112);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * 成形品らしい陰影（パール用）: 窓の奥まりに近いほど暗く（簡易 AO）、上から下へわずかに暗く。
 * 一様な白ベタだと「デジタル素材」に見えるため（2026-09-26 のデザインへのコメント）。
 */
function moldedShading(m: MeshPhysicalMaterial): void {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCabPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCabPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCabPos;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 q = max(abs(vCabPos.xy - vec2(0.0, -4.0)) - vec2(${BEZEL.halfW.toFixed(1)}, ${BEZEL.halfH.toFixed(1)}), 0.0);
        float ao = mix(0.72, 1.0, smoothstep(0.0, 46.0, length(q)));
        float sky = mix(0.9, 1.03, smoothstep(-450.0, 380.0, vCabPos.y));
        diffuseColor.rgb *= ao * sky;`,
      );
  };
}

/** スピーカーの穴あき板（14mm × 12mm の繰り返し単位、8px/mm）。[色, 法線] を返す。 */
function bakeSpeakerMesh(): [HTMLCanvasElement, HTMLCanvasElement] {
  const PX = 8;
  const W = 14 * PX;
  const H = 12 * PX;
  const holes = [
    [3.5, 3],
    [10.5, 3],
    [0, 9],
    [7, 9],
    [14, 9],
    [0, -3],
    [7, -3],
    [14, -3],
    [3.5, 15],
    [10.5, 15],
  ] as const;
  const R = 2.1;
  const EDGE = 0.5;
  // 深さ: 穴の中は 1、縁は EDGE mm で丸く落ちる。
  const depth = (x: number, y: number) => {
    let d = 0;
    for (const [hx, hy] of holes) {
      const r = Math.hypot(x - hx, y - hy);
      d = Math.max(d, Math.min(1, Math.max(0, (R - r) / EDGE)));
    }
    return d;
  };
  const [cc, cctx] = canvas(W, H);
  const [nc, nctx] = canvas(W, H);
  const col = cctx.createImageData(W, H);
  const nor = nctx.createImageData(W, H);
  const e = 1 / PX;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / PX;
      const y = (j + 0.5) / PX;
      const d = depth(x, y);
      const k = (j * W + i) * 4;
      // 板は明るめのガンメタ、穴の奥は黒。
      const v = 92 - 86 * d;
      col.data[k] = v;
      col.data[k + 1] = v + 2;
      col.data[k + 2] = v + 8;
      col.data[k + 3] = 255;
      // 高さ = -深さ。canvas の +y は下向き、uv の +v は上向きなので dy の符号を反転。
      const dx = (depth(x + e, y) - depth(x - e, y)) / (2 * e);
      const dy = -(depth(x, y + e) - depth(x, y - e)) / (2 * e);
      const nx = dx * 0.35;
      const ny = dy * 0.35;
      const len = Math.hypot(nx, ny, 1);
      nor.data[k] = Math.round((nx / len * 0.5 + 0.5) * 255);
      nor.data[k + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      nor.data[k + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      nor.data[k + 3] = 255;
    }
  }
  cctx.putImageData(col, 0, 0);
  nctx.putImageData(nor, 0, 0);
  return [cc, nc];
}

/**
 * 筐体用の環境マップ（ホールの天井照明とソフトボックス）。
 * RoomEnvironment は一様な灰色でつやが見えないため、暗い背景に明るい帯を置き、
 * クリアコートとクロームに照明の帯が映るようにする。
 */
export function bakeCabinetEnv(renderer: WebGLRenderer): Texture {
  const env = new Scene();
  const bg = new SphereGeometry(40, 32, 16);
  const cols: number[] = [];
  const pos = bg.attributes.position;
  for (let i = 0; i < (pos?.count ?? 0); i++) {
    const t = ((pos?.getY(i) ?? 0) / 40 + 1) / 2; // 0 = 床, 1 = 天井
    const v = 0.04 + 0.2 * t * t;
    cols.push(v, v * 0.95, v * 1.2);
  }
  bg.setAttribute('color', new Float32BufferAttribute(cols, 3));
  env.add(new Mesh(bg, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));
  const panel = (w: number, h: number, x: number, y: number, z: number, color: number, k: number) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(k), side: DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  // 正面の上（見る人の頭上）の大きなソフトボックス → 平らな面に斜めの明るい帯。
  panel(16, 3.2, 0, 7, 12, 0xffffff, 6);
  // 平らな正面が映すのは真後ろ ±7° ほど（カメラが約 2.4m 離れるため）。その範囲に帯を置く:
  // 横の帯 → 眉の高さに横の映り込み、細い縦の照明 → 翼の面に縦の映り込み。
  panel(22, 0.55, 0, 2.35, 14, 0xffffff, 9);
  panel(0.3, 20, -1.48, 0, 14, 0xffffff, 10);
  panel(0.3, 20, 1.48, 0, 14, 0xffffff, 10);
  // 左右の縦長の照明 → 翼の丸い縁に縦のハイライト。
  panel(1.2, 16, -11, 2, 9, 0xf4f8ff, 6);
  panel(1.2, 16, 11, 2, 9, 0xf4f8ff, 6);
  // 天井の蛍光灯の列 → 上向きの縁に細い線。
  for (const z of [-8, -2, 4]) panel(24, 0.7, 0, 14, z, 0xffffff, 4);
  // ホールの色（隣の台の光）を少し。
  panel(6, 6, -16, -2, 2, 0xa060ff, 1.2);
  panel(6, 6, 16, -2, 2, 0x40c0ff, 1.0);
  const pmrem = new PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  env.traverse((o) => {
    if (o instanceof Mesh) {
      (o.geometry as BufferGeometry).dispose();
      (o.material as Material).dispose();
    }
  });
  return tex;
}

const HUE_GLSL = /* glsl */ `
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`;

/** 線の LED。通常は氷色に光の粒が流れ、アクセント色が呼吸。リーチで赤の点滅、当たりで虹。 */
function cabinetLedMaterial(p: CabinetPalette): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWin: { value: 0 },
      uReach: { value: 0 },
      uBoost: { value: 0 },
      uLed: { value: new Color(p.led) },
      uAccent: { value: new Color(p.accent) },
    },
    vertexShader: /* glsl */ `
      attribute float aTint;
      varying vec2 vUv;
      varying float vTint;
      void main() { vUv = uv; vTint = aTint; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWin, uReach, uBoost;
      uniform vec3 uLed, uAccent;
      varying vec2 vUv;
      varying float vTint;
      ${HUE_GLSL}
      void main() {
        float x = vUv.x;
        float core = 1.0 - abs(vUv.y - 0.5) * 1.4;
        float comet = pow(fract(x * 2.0 - uTime * 0.45), 12.0);
        float breathe = 0.5 + 0.5 * sin(uTime * 1.6);
        vec3 base = mix(uLed, uAccent * 1.6, vTint);
        vec3 col = base * (0.75 + 1.3 * comet) + uAccent * 0.35 * breathe * (1.0 - vTint);
        col = mix(col, vec3(1.0, 0.06, 0.1) * (0.5 + 1.6 * step(0.0, sin(uTime * 22.0 + x * 40.0))), uReach);
        col = mix(col, hue(x * 3.0 - uTime * 1.8) * (3.0 + 2.0 * comet), uWin);
        col = col * (0.6 + 0.4 * core) + uBoost;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}

/** エンブレム: 外周 24 粒の LED が回り、中心は同心円のレンズ（へそ）。 */
function emblemMaterial(p: CabinetPalette): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWin: { value: 0 },
      uReach: { value: 0 },
      uBoost: { value: 0 },
      uLed: { value: new Color(p.led) },
      uAccent: { value: new Color(p.accent) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWin, uReach, uBoost;
      uniform vec3 uLed, uAccent;
      varying vec2 vUv;
      ${HUE_GLSL}
      void main() {
        vec2 q = (vUv - 0.5) * ${(EMBLEM.r * 2).toFixed(1)};
        float r = length(q);
        float a = atan(q.y, q.x) / 6.28318 + 0.5;
        // 外周の粒（時計回りに追いかける光）。
        float seg = fract(a * 24.0);
        float dotOn = smoothstep(0.08, 0.2, seg) * (1.0 - smoothstep(0.72, 0.84, seg));
        float band = smoothstep(28.6, 29.6, r) * (1.0 - smoothstep(34.0, 35.0, r));
        float spin = uTime * (0.18 + uReach * 1.2 + uWin * 0.6);
        float chase = 0.3 + 1.8 * pow(fract(-a - spin), 7.0);
        vec3 ledCol = mix(uLed, vec3(1.0, 0.06, 0.1), uReach);
        ledCol = mix(ledCol, hue(a * 2.0 + uTime), uWin);
        vec3 col = ledCol * dotOn * band * chase;
        // 中心のレンズ。
        float lens = 1.0 - smoothstep(25.2, 26.2, r);
        float g = clamp(1.0 - r / 26.0, 0.0, 1.0);
        float pulse = 0.85 + 0.15 * sin(uTime * 2.4);
        vec3 lc = uAccent * (0.15 + 1.1 * g) + uLed * pow(g, 3.0) * 1.2 + vec3(1.0) * pow(g, 12.0) * 2.5;
        float rings = (1.0 - smoothstep(0.0, 0.8, abs(r - 12.0))) + (1.0 - smoothstep(0.0, 0.8, abs(r - 19.0)));
        lc = (lc + uLed * rings * 0.35) * pulse;
        lc = mix(lc, vec3(1.0, 0.08, 0.12) * (0.3 + 1.4 * g), uReach * 0.85);
        lc = mix(lc, hue(r * 0.04 - uTime) * (0.5 + 0.9 * g), uWin);
        col += lc * lens + uBoost * (band * dotOn + lens) * 0.6;
        col += vec3(0.015, 0.015, 0.03) * (1.0 - lens) * (1.0 - band);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}

