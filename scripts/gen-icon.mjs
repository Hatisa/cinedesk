/**
 * 生成应用图标 resources/icon.png（1024×1024）。
 *
 * 不引入任何图形库——直接手写 PNG 编码（IHDR/IDAT/IEND + CRC32 + zlib deflate），
 * 这样图标可以随代码一起版本管理，CI 里也不需要额外安装工具。
 *
 * 用法：node scripts/gen-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const SS = 2; // 2× 超采样，边缘更平滑
const W = SIZE * SS;

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  // 每行前置一个 filter byte (0 = None)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 绘制 ---------- */
const lerp = (a, b, t) => a + (b - a) * t;

/** 圆角矩形内部判定（归一化坐标 0..1） */
function inRoundRect(x, y, r) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 三角形内部判定（叉积同号） */
function inTriangle(px, py, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b);
  const d2 = sign([px, py], b, c);
  const d3 = sign([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// 背景：深色渐变（左上偏蓝 → 右下近黑）
const BG_TOP = [26, 38, 62];
const BG_BOTTOM = [9, 12, 20];
// 播放三角：亮蓝渐变
const FG_TOP = [104, 166, 255];
const FG_BOTTOM = [56, 108, 232];

const RADIUS = 0.225;
// 三角顶点（视觉居中：几何重心略右移，看起来才在正中）
const TRI = [
  [0.385, 0.29],
  [0.385, 0.71],
  [0.735, 0.5],
];

function sample(x, y) {
  // x, y 为 0..1 归一化坐标
  if (!inRoundRect(x, y, RADIUS)) return [0, 0, 0, 0];

  const t = Math.min(1, Math.max(0, (x + y) / 2));
  const bg = [
    Math.round(lerp(BG_TOP[0], BG_BOTTOM[0], t)),
    Math.round(lerp(BG_TOP[1], BG_BOTTOM[1], t)),
    Math.round(lerp(BG_TOP[2], BG_BOTTOM[2], t)),
  ];

  if (inTriangle(x, y, TRI[0], TRI[1], TRI[2])) {
    const ty = Math.min(1, Math.max(0, (y - 0.29) / 0.42));
    return [
      Math.round(lerp(FG_TOP[0], FG_BOTTOM[0], ty)),
      Math.round(lerp(FG_TOP[1], FG_BOTTOM[1], ty)),
      Math.round(lerp(FG_TOP[2], FG_BOTTOM[2], ty)),
      255,
    ];
  }
  return [bg[0], bg[1], bg[2], 255];
}

function render() {
  // 先在超采样分辨率上逐点采样，再按 SS×SS 平均降采样做抗锯齿
  const hi = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++) {
    const ny = (y + 0.5) / W;
    for (let x = 0; x < W; x++) {
      const nx = (x + 0.5) / W;
      const [r, g, b, a] = sample(nx, ny);
      const o = (y * W + x) * 4;
      hi[o] = r;
      hi[o + 1] = g;
      hi[o + 2] = b;
      hi[o + 3] = a;
    }
  }

  const out = Buffer.alloc(SIZE * SIZE * 4);
  const n = SS * SS;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * W + (x * SS + dx)) * 4;
          r += hi[o];
          g += hi[o + 1];
          b += hi[o + 2];
          a += hi[o + 3];
        }
      }
      const o = (y * SIZE + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
mkdirSync(dir, { recursive: true });
const file = resolve(dir, 'icon.png');
writeFileSync(file, encodePng(SIZE, SIZE, render()));
console.log(`已生成 ${file} (${SIZE}×${SIZE})`);
