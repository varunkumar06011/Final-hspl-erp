const fs = require('fs');
const zlib = require('zlib');
const file = process.argv[2];
const buf = fs.readFileSync(file);
// find all stream objects
let idx = 0;
const texts = [];
while ((idx = buf.indexOf('stream', idx)) !== -1) {
  let start = idx + 6;
  if (buf[start] === 13) start++;
  if (buf[start] === 10) start++;
  const end = buf.indexOf('endstream', start);
  if (end === -1) break;
  const data = buf.slice(start, end);
  try {
    const inflated = zlib.inflateSync(data);
    const s = inflated.toString('latin1');
    // extract hex strings <...> and literal (...) from Tj/TJ ops
    const hexRe = /<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = hexRe.exec(s))) {
      const hex = m[1];
      let out = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        const code = parseInt(hex.substr(i, 2), 16);
        out += code === 0 ? '' : String.fromCharCode(code);
      }
      out = out.replace(/^﻿/, '');
      if (out.trim()) texts.push(out);
    }
    const litRe = /\(([^)]*)\)\s*Tj/g;
    while ((m = litRe.exec(s))) if (m[1].trim()) texts.push(m[1]);
  } catch {}
  idx = end;
}
console.log(texts.join('\n'));
