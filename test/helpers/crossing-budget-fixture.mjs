import fs from 'node:fs';
import path from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Usage: node test/helpers/crossing-budget-fixture.mjs <output.html>');

const arrows = Array.from({ length: 120 }, (_, index) => {
  const y = 10 + index * 3;
  const points = Array.from({ length: 101 }, (_, step) => [
    20 + Math.ceil(step / 2) * 20,
    y + Math.floor(step / 2) % 2,
  ]);
  const d = `M${points.map(([x, pointY], step) => step ? `L${x} ${pointY}` : `${x} ${pointY}`).join('')}`;
  return `<path id="r${index}" data-edge-id="r${index}" data-edge-from="from-${index}" data-edge-to="to-${index}" d="${d}" class="a-default" marker-end="url(#arrowhead)"/>`;
}).join('');

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, `<!doctype html><svg viewBox="0 0 2100 400" data-quality-profile="standard">${arrows}</svg>`);
