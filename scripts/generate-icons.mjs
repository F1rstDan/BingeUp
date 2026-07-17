// 生成扩展品牌图标（16/32/48/128）。
//
// 约束：不引入 sharp / canvas 等图像依赖。这里用纯 Node（内置 zlib）以 4× 超采样
// 绘制矢量化的几何图形并抗锯齿，产出清晰的小尺寸 PNG，直接提交到 public/icon/。
//
// 设计：蓝色圆角方底（品牌蓝渐变）+ 白色向上箭头（“升级”意象）+ 黄色星星点缀，
// 与吉祥物配色一致，且在 16px 下依然可读。
//
// 用法：node scripts/generate-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icon');

// ── 颜色（sRGB 0..255）───────────────────────────────────────
const BLUE_TOP = [34, 155, 240]; // #229bf0
const BLUE_BOTTOM = [7, 104, 181]; // #0768b5
const WHITE = [255, 255, 255];
const STAR = [255, 201, 71]; // #ffc947

/** 归一化坐标下的圆角方底半径（相对边长）。 */
const CORNER_RADIUS = 0.22;

/**
 * 计算点到线段的最短距离（归一化坐标）。用于以“描边宽度”绘制箭头。
 */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 圆角矩形覆盖判断（整个画布为 0..1）。 */
function insideRoundedSquare(x, y) {
  const r = CORNER_RADIUS;
  const dx = Math.max(r - x, x - (1 - r), 0);
  const dy = Math.max(r - y, y - (1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

/** 五角星覆盖判断：以 (cx,cy) 为中心，outer/inner 为外/内半径。 */
function insideStar(x, y, cx, cy, outer, inner) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    // 从正上方开始，顺时针排列顶点。
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 采样单个（超采样后的）像素，返回 [r,g,b,a]（0..255）。
 * 分层合成：透明背景 → 蓝色圆角方底 → 黄色星星 → 白色箭头。
 */
function sampleColor(x, y) {
  let color = [0, 0, 0, 0];

  if (insideRoundedSquare(x, y)) {
    // 竖直渐变，营造轻微立体感。
    const t = y;
    const r = Math.round(BLUE_TOP[0] + (BLUE_BOTTOM[0] - BLUE_TOP[0]) * t);
    const g = Math.round(BLUE_TOP[1] + (BLUE_BOTTOM[1] - BLUE_TOP[1]) * t);
    const b = Math.round(BLUE_TOP[2] + (BLUE_BOTTOM[2] - BLUE_TOP[2]) * t);
    color = [r, g, b, 255];
  }

  // 星星（箭头顶端上方的点缀）。
  if (insideStar(x, y, 0.5, 0.26, 0.135, 0.058)) {
    color = [STAR[0], STAR[1], STAR[2], 255];
  }

  // 向上箭头（“升级”意象）：两条从底部斜上汇聚到顶点的粗描边。
  const apex = [0.5, 0.46];
  const left = [0.235, 0.72];
  const right = [0.765, 0.72];
  const halfWidth = 0.075;
  const dLeft = distanceToSegment(x, y, left[0], left[1], apex[0], apex[1]);
  const dRight = distanceToSegment(x, y, right[0], right[1], apex[0], apex[1]);
  if (Math.min(dLeft, dRight) <= halfWidth) {
    color = [WHITE[0], WHITE[1], WHITE[2], 255];
  }

  return color;
}

/** 渲染并 SUPERSAMPLE 降采样，返回 size×size 的 RGBA 缓冲区。 */
function renderIcon(size) {
  const hi = size * SUPERSAMPLE;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const nx = (px * SUPERSAMPLE + sx + 0.5) / hi;
          const ny = (py * SUPERSAMPLE + sy + 0.5) / hi;
          const [cr, cg, cb, ca] = sampleColor(nx, ny);
          // 预乘 alpha 累加，避免边缘出现深色描边。
          r += (cr * ca) / 255;
          g += (cg * ca) / 255;
          b += (cb * ca) / 255;
          a += ca;
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = a / samples;
      const offset = (py * size + px) * 4;
      if (alpha <= 0) {
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 0;
      } else {
        // 反预乘，得到直通 alpha 颜色。
        pixels[offset] = Math.round((r / samples) * (255 / alpha));
        pixels[offset + 1] = Math.round((g / samples) * (255 / alpha));
        pixels[offset + 2] = Math.round((b / samples) * (255 / alpha));
        pixels[offset + 3] = Math.round(alpha);
      }
    }
  }
  return pixels;
}

// ── PNG 编码 ────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前置一个 filter 字节（0 = None）。
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 主流程 ──────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const pixels = renderIcon(size);
  const png = encodePng(size, pixels);
  const file = resolve(OUT_DIR, `${size}.png`);
  writeFileSync(file, png);
  process.stdout.write(`生成 ${file}（${png.length} 字节）\n`);
}
