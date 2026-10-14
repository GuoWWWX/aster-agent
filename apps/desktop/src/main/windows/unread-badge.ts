import { deflateSync } from "node:zlib";

const glyphs: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
};
function chunk(name: string, bytes: Buffer): Buffer {
  const type = Buffer.from(name); const data = Buffer.concat([type, bytes]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, checksum]);
}
/** A transparent PNG works for Electron's Windows overlay without a canvas or SVG decoder. */
export function unreadBadgePng(count: number): Buffer {
  const size = 32; const pixels = Buffer.alloc(size * (size * 4 + 1));
  const paint = (x: number, y: number, color: readonly number[]): void => {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let channel = 0; channel < 4; channel += 1) pixels[offset + channel] = color[channel] ?? 0;
  };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 <= 15 ** 2) paint(x, y, [55, 89, 190, 255]);
  }
  const text = count > 99 ? "99+" : String(Math.max(1, Math.floor(count)));
  const scale = text.length === 3 ? 2 : 3; const width = (text.length * 4 - 1) * scale;
  const left = Math.floor((size - width) / 2); const top = Math.floor((size - 5 * scale) / 2);
  [...text].forEach((char, index) => {
    glyphs[char]?.forEach((row, y) => [...row].forEach((pixel, x) => {
      if (pixel !== "1") return;
      for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) paint(left + index * 4 * scale + x * scale + dx, top + y * scale + dy, [255, 255, 255, 255]);
    }));
  });
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
