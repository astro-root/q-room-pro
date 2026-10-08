import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dark = [16, 19, 24, 255];
const mint = [131, 240, 194, 255];

function roundedBackground(x, y) {
  const nearestX = Math.max(112, Math.min(400, x));
  const nearestY = Math.max(112, Math.min(400, y));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= 112 ** 2;
}

function inMark(x, y) {
  const ringDistance = Math.abs(Math.hypot(x - 256, y - 256) - 164);
  if (ringDistance <= 19) return true;
  const ax = 332, ay = 333, bx = 426, by = 427;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= 21) return true;
  return Math.hypot(x - 256, y - 256) <= 42;
}

function raster(size, { background = true, markScale = 1 } = {}) {
  const output = Buffer.alloc(size * size * 4);
  const samples = 3;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / size * 512;
          const py = (y + (sy + 0.5) / samples) / size * 512;
          const bx = 256 + (px - 256) / markScale;
          const by = 256 + (py - 256) / markScale;
          const color = inMark(bx, by) ? mint : background && roundedBackground(px, py) ? dark : [0, 0, 0, 0];
          const opacity = color[3] / 255;
          red += color[0] * opacity; green += color[1] * opacity; blue += color[2] * opacity; alpha += opacity;
        }
      }
      const index = (y * size + x) * 4;
      const total = samples * samples;
      output[index] = alpha ? Math.round(red / alpha) : 0;
      output[index + 1] = alpha ? Math.round(green / alpha) : 0;
      output[index + 2] = alpha ? Math.round(blue / alpha) : 0;
      output[index + 3] = Math.round(alpha / total * 255);
    }
  }
  return output;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function png(width, height, pixels) {
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) pixels.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function splashRaster(width, height, markFraction = 0.34) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = dark[0]; pixels[index + 1] = dark[1]; pixels[index + 2] = dark[2]; pixels[index + 3] = 255;
  }
  const markSize = Math.round(Math.min(width, height) * markFraction);
  const mark = raster(markSize, { background: false, markScale: 0.82 });
  const left = Math.floor((width - markSize) / 2);
  const top = Math.floor((height - markSize) / 2);
  for (let y = 0; y < markSize; y += 1) {
    for (let x = 0; x < markSize; x += 1) {
      const from = (y * markSize + x) * 4;
      const alpha = mark[from + 3] / 255;
      if (!alpha) continue;
      const to = ((top + y) * width + left + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) pixels[to + channel] = Math.round(mark[from + channel] * alpha + pixels[to + channel] * (1 - alpha));
    }
  }
  return pixels;
}

async function savePng(path, width, height, pixels) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png(width, height, pixels));
}

const androidDensities = [
  ["mdpi", 48, 108], ["hdpi", 72, 162], ["xhdpi", 96, 216], ["xxhdpi", 144, 324], ["xxxhdpi", 192, 432],
];
for (const [density, iconSize, foregroundSize] of androidDensities) {
  const directory = resolve(projectRoot, `android/app/src/main/res/mipmap-${density}`);
  const icon = raster(iconSize);
  const foreground = raster(foregroundSize, { background: false, markScale: 0.82 });
  await savePng(resolve(directory, "ic_launcher.png"), iconSize, iconSize, icon);
  await savePng(resolve(directory, "ic_launcher_round.png"), iconSize, iconSize, icon);
  await savePng(resolve(directory, "ic_launcher_foreground.png"), foregroundSize, foregroundSize, foreground);
}

const iosIcon = raster(1024);
await savePng(resolve(projectRoot, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), 1024, 1024, iosIcon);

const splashDirectory = resolve(projectRoot, "ios/App/App/Assets.xcassets/Splash.imageset");
const iosSplashSize = 2732;
const iosSplash = png(iosSplashSize, iosSplashSize, splashRaster(iosSplashSize, iosSplashSize, 0.28));
await mkdir(splashDirectory, { recursive: true });
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await writeFile(resolve(splashDirectory, name), iosSplash);
}

const androidSplashes = [
  ["drawable/splash.png", 480, 320],
  ["drawable-port-mdpi/splash.png", 320, 480], ["drawable-port-hdpi/splash.png", 480, 800], ["drawable-port-xhdpi/splash.png", 720, 1280], ["drawable-port-xxhdpi/splash.png", 960, 1600], ["drawable-port-xxxhdpi/splash.png", 1280, 1920],
  ["drawable-land-mdpi/splash.png", 480, 320], ["drawable-land-hdpi/splash.png", 800, 480], ["drawable-land-xhdpi/splash.png", 1280, 720], ["drawable-land-xxhdpi/splash.png", 1600, 960], ["drawable-land-xxxhdpi/splash.png", 1920, 1280],
];
for (const [relativePath, width, height] of androidSplashes) {
  await savePng(resolve(projectRoot, "android/app/src/main/res", relativePath), width, height, splashRaster(width, height));
}
