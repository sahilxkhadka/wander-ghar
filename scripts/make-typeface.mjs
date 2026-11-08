// Convert a WOFF/TTF font into a three.js typeface JSON (FontLoader format), keeping only the
// glyphs the tour needs so the bundle stays small.
// usage: node scripts/make-typeface.mjs <font.woff> <out.json> [chars]
import opentype from 'opentype.js';
import fs from 'node:fs';

const [src, out, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,·-&\'’!'] = process.argv.slice(2);
const font = opentype.parse(Uint8Array.from(fs.readFileSync(src)).buffer);
const r = (v) => Math.round(v);
const glyphs = {};
for (const ch of new Set(chars)) {
  const g = font.charToGlyph(ch);
  if (!g || (g.index === 0 && ch !== ' ')) continue;
  const o = g.path.commands.map((c) => {
    switch (c.type) {
      case 'M': return `m ${r(c.x)} ${r(c.y)}`;
      case 'L': return `l ${r(c.x)} ${r(c.y)}`;
      case 'Q': return `q ${r(c.x)} ${r(c.y)} ${r(c.x1)} ${r(c.y1)}`;
      case 'C': return `b ${r(c.x)} ${r(c.y)} ${r(c.x1)} ${r(c.y1)} ${r(c.x2)} ${r(c.y2)}`;
      default: return '';
    }
  }).filter(Boolean).join(' ');
  const bb = g.getBoundingBox();
  glyphs[ch] = { ha: r(g.advanceWidth), x_min: r(bb.x1), x_max: r(bb.x2), o };
}
const h = font.tables.head, post = font.tables.post;
fs.writeFileSync(out, JSON.stringify({
  glyphs,
  familyName: font.names.fontFamily?.en ?? 'font',
  ascender: font.ascender,
  descender: font.descender,
  underlinePosition: post?.underlinePosition ?? -100,
  underlineThickness: post?.underlineThickness ?? 50,
  boundingBox: { xMin: h.xMin, yMin: h.yMin, xMax: h.xMax, yMax: h.yMax },
  resolution: font.unitsPerEm,
  original_font_information: { license: 'SIL Open Font License 1.1' },
}));
console.log('wrote', out, Object.keys(glyphs).length, 'glyphs');
