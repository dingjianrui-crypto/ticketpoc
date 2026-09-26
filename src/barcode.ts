import { Buffer } from "buffer";
import jpeg from "jpeg-js";
import qrcode from "qrcode-generator";

// jpeg-js uses Buffer only to construct its output. This browser-compatible
// implementation keeps the encoder usable in the Workers runtime.
if (!(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer = Buffer;
}

const QUIET_ZONE = 4;
const SVG_MODULE_SIZE = 7;
const JPEG_MODULE_SIZE = 7;

const FONT: Record<string, string[]> = {
  "0":["111","101","101","101","111"], "1":["010","110","010","010","111"],
  "2":["111","001","111","100","111"], "3":["111","001","111","001","111"],
  "4":["101","101","111","001","001"], "5":["111","100","111","001","111"],
  "6":["111","100","111","101","111"], "7":["111","001","010","010","010"],
  "8":["111","101","111","101","111"], "9":["111","101","111","001","111"],
  a:["010","101","111","101","101"], b:["110","101","110","101","110"],
  c:["011","100","100","100","011"], d:["110","101","101","101","110"],
  e:["111","100","110","100","111"], f:["111","100","110","100","100"],
};

function qrMatrix(value: string): { size: number; dark: (row: number, col: number) => boolean } {
  const qr = qrcode(0, "M");
  qr.addData(value, "Byte");
  qr.make();
  return { size: qr.getModuleCount(), dark: (row, col) => qr.isDark(row, col) };
}

function darkPath(value: string): { size: number; path: string } {
  const qr = qrMatrix(value);
  const commands: string[] = [];
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (qr.dark(row, col)) commands.push(`M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`);
    }
  }
  return { size: qr.size, path: commands.join("") };
}

export function barcodeSvg(value: string): string {
  const qr = darkPath(value);
  const imageModules = qr.size + QUIET_ZONE * 2;
  const imagePixels = imageModules * SVG_MODULE_SIZE;
  const textHeight = 52;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${imagePixels}" height="${imagePixels + textHeight}" viewBox="0 0 ${imageModules} ${imageModules + textHeight / SVG_MODULE_SIZE}" role="img" aria-label="Ticket QR code ${value}" shape-rendering="crispEdges">
<rect width="100%" height="100%" fill="white"/>
<path d="${qr.path}" fill="black"/>
<g fill="black" text-anchor="middle" font-family="ui-monospace,monospace" font-size="1.35" shape-rendering="auto">
<text x="${imageModules / 2}" y="${imageModules + 2.8}">${value.slice(0, 32)}</text>
<text x="${imageModules / 2}" y="${imageModules + 5}">${value.slice(32)}</text>
</g>
</svg>`;
}

export function barcodeJpeg(value: string): Uint8Array {
  const qr = qrMatrix(value);
  const qrPixels = (qr.size + QUIET_ZONE * 2) * JPEG_MODULE_SIZE;
  const width = Math.max(qrPixels, 320);
  const height = qrPixels + 58;
  const qrLeft = Math.floor((width - qrPixels) / 2);
  const rgba = new Uint8Array(width * height * 4);
  rgba.fill(255);

  const pixel = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    rgba[at] = rgba[at + 1] = rgba[at + 2] = 0;
  };

  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (!qr.dark(row, col)) continue;
      const left = qrLeft + (col + QUIET_ZONE) * JPEG_MODULE_SIZE;
      const top = (row + QUIET_ZONE) * JPEG_MODULE_SIZE;
      for (let x = left; x < left + JPEG_MODULE_SIZE; x += 1) {
        for (let y = top; y < top + JPEG_MODULE_SIZE; y += 1) pixel(x, y);
      }
    }
  }

  const drawText = (text: string, y: number) => {
    const glyphScale = 2;
    const glyphWidth = 4 * glyphScale;
    const total = text.length * glyphWidth - glyphScale;
    const left = Math.floor((width - total) / 2);
    Array.from(text).forEach((char, charIndex) => {
      FONT[char].forEach((row, rowIndex) => {
        Array.from(row).forEach((bit, colIndex) => {
          if (bit !== "1") return;
          for (let dx = 0; dx < glyphScale; dx += 1) {
            for (let dy = 0; dy < glyphScale; dy += 1) {
              pixel(left + charIndex * glyphWidth + colIndex * glyphScale + dx, y + rowIndex * glyphScale + dy);
            }
          }
        });
      });
    });
  };
  drawText(value.slice(0, 32), qrPixels + 16);
  drawText(value.slice(32), qrPixels + 34);

  return jpeg.encode({ data: rgba, width, height }, 90).data;
}
