const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const BASE = 1024;
const SCALE = 3;
const SIZE = BASE * SCALE;
const ROOT = path.resolve(__dirname, '..');
const OUT_ICON = path.join(ROOT, 'assets', 'icon.png');
const OUT_IOS = path.join(ROOT, 'ios', 'FindIt', 'Images.xcassets', 'AppIcon.appiconset', 'App-Icon-1024x1024@1x.png');

const png = new PNG({ width: SIZE, height: SIZE, colorType: 6 });

function rgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ];
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function put(x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const a = alpha / 255;
  png.data[i] = Math.round(color[0] * a + png.data[i] * (1 - a));
  png.data[i + 1] = Math.round(color[1] * a + png.data[i + 1] * (1 - a));
  png.data[i + 2] = Math.round(color[2] * a + png.data[i + 2] * (1 - a));
  png.data[i + 3] = 255;
}

function s(v) {
  return Math.round(v * SCALE);
}

function fillBackground() {
  const top = rgb('#FBF5EB');
  const bottom = rgb('#EADCC9');
  const glow = rgb('#FFF8EF');

  for (let y = 0; y < SIZE; y += 1) {
    const t = y / (SIZE - 1);
    for (let x = 0; x < SIZE; x += 1) {
      const i = (y * SIZE + x) * 4;
      const diagonal = (x / SIZE + (1 - y / SIZE)) / 2;
      const g = Math.max(0, 1 - Math.hypot(x / SIZE - 0.22, y / SIZE - 0.16) / 0.88) * 0.12;
      const texture = (((x * 17 + y * 31) % 29) - 14) * 0.22;
      png.data[i] = Math.min(255, mix(top[0], bottom[0], t) * (1 - g) + glow[0] * g + texture + diagonal * 3);
      png.data[i + 1] = Math.min(255, mix(top[1], bottom[1], t) * (1 - g) + glow[1] * g + texture + diagonal * 2);
      png.data[i + 2] = Math.min(255, mix(top[2], bottom[2], t) * (1 - g) + glow[2] * g + texture);
      png.data[i + 3] = 255;
    }
  }
}

function fillRoundedRect(x, y, w, h, r, color, alpha = 255) {
  const x0 = s(x);
  const y0 = s(y);
  const x1 = s(x + w);
  const y1 = s(y + h);
  const rr = s(r);

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const cx = Math.max(x0 + rr, Math.min(px, x1 - rr));
      const cy = Math.max(y0 + rr, Math.min(py, y1 - rr));
      if ((px - cx) ** 2 + (py - cy) ** 2 <= rr ** 2) put(px, py, color, alpha);
    }
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fillPolygon(points, color, alpha = 255) {
  const pts = points.map(([x, y]) => [s(x), s(y)]);
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(SIZE - 1, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(SIZE - 1, Math.max(...ys));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, pts)) put(x, y, color, alpha);
    }
  }
}

function fillCircle(cx, cy, r, color, alpha = 255) {
  const x0 = s(cx - r);
  const x1 = s(cx + r);
  const y0 = s(cy - r);
  const y1 = s(cy + r);
  const cxx = s(cx);
  const cyy = s(cy);
  const rr = s(r) ** 2;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if ((x - cxx) ** 2 + (y - cyy) ** 2 <= rr) put(x, y, color, alpha);
    }
  }
}

function strokeCircle(cx, cy, r, width, color, alpha = 255) {
  const outer = s(r + width / 2);
  const inner = s(r - width / 2);
  const x0 = s(cx) - outer;
  const x1 = s(cx) + outer;
  const y0 = s(cy) - outer;
  const y1 = s(cy) + outer;
  const cxx = s(cx);
  const cyy = s(cy);
  const outer2 = outer ** 2;
  const inner2 = inner ** 2;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d2 = (x - cxx) ** 2 + (y - cyy) ** 2;
      if (d2 <= outer2 && d2 >= inner2) put(x, y, color, alpha);
    }
  }
}

function strokeLine(x1, y1, x2, y2, width, color, alpha = 255) {
  const ax = s(x1);
  const ay = s(y1);
  const bx = s(x2);
  const by = s(y2);
  const half = s(width / 2);
  const minX = Math.max(0, Math.min(ax, bx) - half);
  const maxX = Math.min(SIZE - 1, Math.max(ax, bx) + half);
  const minY = Math.max(0, Math.min(ay, by) - half);
  const maxY = Math.min(SIZE - 1, Math.max(ay, by) + half);
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
      const px = ax + t * vx;
      const py = ay + t * vy;
      if ((x - px) ** 2 + (y - py) ** 2 <= half ** 2) put(x, y, color, alpha);
    }
  }
}

function downsample() {
  const out = new PNG({ width: BASE, height: BASE, colorType: 6 });
  const samples = SCALE * SCALE;
  for (let y = 0; y < BASE; y += 1) {
    for (let x = 0; x < BASE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = 0; yy < SCALE; yy += 1) {
        for (let xx = 0; xx < SCALE; xx += 1) {
          const src = ((y * SCALE + yy) * SIZE + (x * SCALE + xx)) * 4;
          r += png.data[src];
          g += png.data[src + 1];
          b += png.data[src + 2];
        }
      }
      const dst = (y * BASE + x) * 4;
      out.data[dst] = Math.round(r / samples);
      out.data[dst + 1] = Math.round(g / samples);
      out.data[dst + 2] = Math.round(b / samples);
      out.data[dst + 3] = 255;
    }
  }
  return out;
}

function writePng(file, image) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(image));
}

const teal = rgb('#103D3D');
const tealShadow = rgb('#102D2F');
const cream = rgb('#FBF5EB');
const gold = rgb('#F6D06E');
const coral = rgb('#E87055');
const brown = rgb('#5D4F43');

fillBackground();

fillPolygon(
  [
    [512, 178],
    [788, 416],
    [724, 466],
    [512, 284],
    [300, 466],
    [236, 416]
  ],
  brown,
  34
);
fillRoundedRect(302, 370, 420, 468, 92, brown, 36);

fillPolygon(
  [
    [512, 150],
    [790, 390],
    [724, 438],
    [512, 256],
    [300, 438],
    [234, 390]
  ],
  teal
);
fillRoundedRect(292, 340, 440, 484, 92, teal);

fillRoundedRect(360, 438, 152, 48, 24, gold);
fillRoundedRect(360, 524, 124, 48, 24, coral, 235);
fillRoundedRect(360, 610, 154, 48, 24, cream, 228);

strokeLine(690, 692, 800, 802, 96, tealShadow, 250);
strokeLine(690, 692, 800, 802, 60, cream, 255);
strokeCircle(570, 566, 158, 84, tealShadow, 250);
strokeCircle(570, 566, 158, 52, cream, 255);

fillCircle(570, 562, 112, coral);
fillPolygon(
  [
    [470, 604],
    [670, 604],
    [570, 724]
  ],
  coral
);
fillCircle(570, 557, 35, cream);

const finalIcon = downsample();
writePng(OUT_ICON, finalIcon);
writePng(OUT_IOS, finalIcon);

console.log(`Wrote ${OUT_ICON}`);
console.log(`Wrote ${OUT_IOS}`);
