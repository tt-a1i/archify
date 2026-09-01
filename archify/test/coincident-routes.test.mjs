import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const archifyBin = path.join(__dirname, '..', 'bin', 'archify.mjs');

test('anti-parallel connections with labelAt fail showcase composition', async () => {
  const json = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Two directions between one pair',
      quality_profile: 'showcase',
      viewBox: [900, 420],
    },
    components: [
      { id: 'graph', type: 'backend', label: 'the graph', pos: [80, 170], size: [200, 62] },
      { id: 'engine', type: 'backend', label: 'the engine', pos: [430, 170], size: [200, 62] },
    ],
    connections: [
      { id: 'reads', from: 'graph', to: 'engine', label: 'lists', labelAt: [355, 150] },
      { id: 'declares', from: 'engine', to: 'graph', label: 'declares', labelAt: [355, 260] },
    ],
  };

  const tempInput = path.join(__dirname, 'temp-antiparallel-labelat.json');
  const tempOutput = path.join(__dirname, 'temp-antiparallel-labelat.html');

  try {
    fs.writeFileSync(tempInput, JSON.stringify(json, null, 2));

    // Should throw due to coincident routes
    await assert.rejects(
      async () => {
        await execAsync(
          `node "${archifyBin}" deliver architecture "${tempInput}" "${tempOutput}" --quality showcase --json`
        );
      },
      (err) => {
        const output = err.stdout || err.stderr || err.message;
        return output.includes('composition/coincident-routes') &&
               output.includes('identical geometry');
      },
      'Should reject anti-parallel connections with labelAt'
    );
  } finally {
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
  }
});

test('anti-parallel connections without labelAt pass with automatic spreading', async () => {
  const json = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Two directions, auto spread',
      quality_profile: 'showcase',
      viewBox: [900, 420],
    },
    components: [
      { id: 'graph', type: 'backend', label: 'the graph', pos: [80, 170], size: [200, 62] },
      { id: 'engine', type: 'backend', label: 'the engine', pos: [430, 170], size: [200, 62] },
    ],
    connections: [
      { id: 'reads', from: 'graph', to: 'engine', label: 'lists' },
      { id: 'declares', from: 'engine', to: 'graph', label: 'declares' },
    ],
  };

  const tempInput = path.join(__dirname, 'temp-antiparallel-auto.json');
  const tempOutput = path.join(__dirname, 'temp-antiparallel-auto.html');

  try {
    fs.writeFileSync(tempInput, JSON.stringify(json, null, 2));

    const { stdout } = await execAsync(
      `node "${archifyBin}" deliver architecture "${tempInput}" "${tempOutput}" --quality showcase --json`
    );

    const result = JSON.parse(stdout);
    assert.equal(result.ok, true, 'Should pass validation with automatic spreading');
    assert.equal(result.validation.errors, 0, 'Should have no errors');

    // Verify the output file exists
    assert.ok(fs.existsSync(tempOutput), 'Should create output HTML');

    // Read and verify routes are actually separated
    const html = fs.readFileSync(tempOutput, 'utf-8');
    const readsMatch = html.match(/data-composition-id="reads"[^>]*data-composition-points="([^"]+)"/);
    const declaresMatch = html.match(/data-composition-id="declares"[^>]*data-composition-points="([^"]+)"/);

    if (readsMatch && declaresMatch) {
      const readsPoints = readsMatch[1];
      const declaresPoints = declaresMatch[1];
      assert.notEqual(readsPoints, declaresPoints, 'Routes should be separated');

      // Check they are not exact reverses either
      const readsArr = readsPoints.split(';');
      const declaresArr = declaresPoints.split(';');
      const readsReversed = [...readsArr].reverse().join(';');
      assert.notEqual(readsReversed, declaresPoints, 'Routes should not be exact reverses');
    }
  } finally {
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
  }
});

test('same-direction connections with labelAt are detected if coincident', async () => {
  const json = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Two same-direction with labelAt',
      quality_profile: 'showcase',
      viewBox: [900, 420],
    },
    components: [
      { id: 'a', type: 'backend', label: 'A', pos: [80, 170], size: [200, 62] },
      { id: 'b', type: 'backend', label: 'B', pos: [430, 170], size: [200, 62] },
    ],
    connections: [
      { id: 'conn1', from: 'a', to: 'b', label: 'first', labelAt: [355, 190] },
      { id: 'conn2', from: 'a', to: 'b', label: 'second', labelAt: [355, 210] },
    ],
  };

  const tempInput = path.join(__dirname, 'temp-samedirection-labelat.json');
  const tempOutput = path.join(__dirname, 'temp-samedirection-labelat.html');

  try {
    fs.writeFileSync(tempInput, JSON.stringify(json, null, 2));

    await assert.rejects(
      async () => {
        await execAsync(
          `node "${archifyBin}" deliver architecture "${tempInput}" "${tempOutput}" --quality showcase --json`
        );
      },
      (err) => {
        const output = err.stdout || err.stderr || err.message;
        return output.includes('composition/coincident-routes') &&
               output.includes('same direction');
      },
      'Should reject same-direction connections with coincident routes'
    );
  } finally {
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
  }
});

test('non-showcase quality does not enforce coincident route check', async () => {
  const json = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Standard quality',
      // No quality_profile = standard
      viewBox: [900, 420],
    },
    components: [
      { id: 'graph', type: 'backend', label: 'the graph', pos: [80, 170], size: [200, 62] },
      { id: 'engine', type: 'backend', label: 'the engine', pos: [430, 170], size: [200, 62] },
    ],
    connections: [
      { id: 'reads', from: 'graph', to: 'engine', label: 'lists', labelAt: [355, 150] },
      { id: 'declares', from: 'engine', to: 'graph', label: 'declares', labelAt: [355, 260] },
    ],
  };

  const tempInput = path.join(__dirname, 'temp-standard-quality.json');
  const tempOutput = path.join(__dirname, 'temp-standard-quality.html');

  try {
    fs.writeFileSync(tempInput, JSON.stringify(json, null, 2));

    const { stdout } = await execAsync(
      `node "${archifyBin}" deliver architecture "${tempInput}" "${tempOutput}" --json`
    );

    const result = JSON.parse(stdout);
    // Standard quality should pass (not enforcing coincident route check)
    assert.equal(result.ok, true, 'Standard quality should pass without coincident route check');
  } finally {
    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
  }
});
