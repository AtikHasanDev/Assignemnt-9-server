import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}

// Deterministic device illustrations for demo records; no external stock assets.
export function deviceIllustration(category) {
  const width = 640, height = 420, pixels = Buffer.alloc(width * height * 3);
  const paper = [232, 239, 224], ink = [25, 53, 56], lime = [213, 241, 136], glass = [116, 154, 151], white = [250, 252, 247];
  function rect(x, y, w, h, color) {
    for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) for (let col = Math.max(0, x); col < Math.min(width, x + w); col++) {
      const offset = (row * width + col) * 3; pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2];
    }
  }
  function circle(cx, cy, radius, color) {
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) rect(x, y, 1, 1, color);
  }
  rect(0, 0, width, height, paper); circle(320, 200, 160, [222, 231, 208]); rect(150, 343, 340, 7, [192, 207, 181]);
  if (category === 'Smartphone') {
    rect(246, 62, 148, 276, ink); rect(258, 89, 124, 210, glass); rect(282, 138, 73, 10, lime); rect(282, 159, 54, 10, white); circle(320, 318, 7, lime);
  } else if (category === 'Laptop & PC' || category === 'TV') {
    rect(180, 90, 280, 184, ink); rect(194, 104, 252, 154, glass); rect(233, 143, 173, 12, lime); rect(233, 171, 129, 9, white);
    if (category === 'TV') { rect(304, 274, 32, 50, ink); rect(255, 320, 130, 14, ink); }
    else { rect(160, 274, 320, 32, ink); rect(275, 278, 90, 12, lime); }
  } else if (category === 'AC') {
    rect(131, 117, 378, 153, ink); rect(144, 130, 352, 105, white); rect(160, 244, 320, 13, glass); circle(462, 154, 6, lime); for (let x = 210; x < 460; x += 70) rect(x, 288, 5, 37, glass);
  } else if (category === 'Refrigerator') {
    rect(224, 58, 192, 282, ink); rect(236, 70, 168, 88, white); rect(236, 170, 168, 158, glass); rect(250, 95, 10, 38, ink); rect(250, 187, 10, 52, ink); rect(370, 88, 20, 20, lime);
  } else if (category === 'Washing Machine') {
    rect(207, 85, 226, 250, ink); rect(219, 97, 202, 50, white); circle(385, 121, 12, lime); rect(233, 115, 60, 12, glass); circle(320, 235, 73, white); circle(320, 235, 57, glass); circle(320, 235, 38, ink); rect(290, 244, 60, 12, lime);
  } else {
    rect(272, 107, 96, 96, ink); rect(285, 63, 18, 44, ink); rect(337, 63, 18, 44, ink); rect(309, 203, 22, 108, ink); rect(235, 298, 96, 22, ink); circle(320, 154, 24, lime); rect(397, 169, 16, 91, glass); rect(376, 197, 58, 14, glass);
  }
  circle(155, 83, 12, lime); circle(486, 309, 10, glass);
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
