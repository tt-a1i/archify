const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { runAgent } = require('./agent-detector');
const { discoveryPrompt, depsPrompt, getSynthesisPrompt } = require('./prompts');

const execAsync = promisify(exec);

async function runSmartPipeline(options) {
  const tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.archify-tmp-'));
  const archifyBin = path.join(__dirname, '..', 'bin', 'archify.mjs');

  try {
    console.log('Stage 1: Discovery (Low reasoning)');
    await runAgent(
      options.agent,
      options.modelLow,
      discoveryPrompt,
      path.join(tmpDir, 'discovery.txt')
    );

    console.log('Stage 2: Dependency extraction (Medium reasoning)');
    await runAgent(
      options.agent,
      options.modelMedium,
      depsPrompt,
      path.join(tmpDir, 'deps.txt')
    );

    console.log('Stage 3: Architectural synthesis (High reasoning)');
    const discovery = await fs.readFile(path.join(tmpDir, 'discovery.txt'), 'utf8');
    const deps = await fs.readFile(path.join(tmpDir, 'deps.txt'), 'utf8');
    const synthesisPrompt = getSynthesisPrompt(discovery, deps);

    await runAgent(
      options.agent,
      options.modelHigh,
      synthesisPrompt,
      path.join(tmpDir, 'diagram.json'),
      true // synthesis mode: suppress extra commentary
    );

    console.log('Validating JSON IR...');
    await execAsync(`node ${archifyBin} validate ${path.join(tmpDir, 'diagram.json')}`);

    console.log('Rendering diagram...');
    await execAsync(`node ${archifyBin} render ${path.join(tmpDir, 'diagram.json')} ${options.output}`);

    console.log(`Diagram generated: ${options.output}`);
  } catch (err) {
    console.error('Pipeline failed:', err.message);
    throw err;
  } finally {
    if (!options.keep) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } else {
      console.log(`Intermediate files kept in: ${tmpDir}`);
    }
  }
}

module.exports = { runSmartPipeline };
