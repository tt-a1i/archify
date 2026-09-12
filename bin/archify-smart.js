#!/usr/bin/env node

const { runSmartPipeline } = require('../lib/smart-pipeline');
const { detectAgent } = require('../lib/agent-detector');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const options = {
    agent: null,
    modelLow: null,
    modelMedium: null,
    modelHigh: null,
    dir: '.',
    keep: false,
    output: 'archify-diagram.html',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--agent': options.agent = args[++i]; break;
      case '--model-low': options.modelLow = args[++i]; break;
      case '--model-medium': options.modelMedium = args[++i]; break;
      case '--model-high': options.modelHigh = args[++i]; break;
      case '--dir': options.dir = args[++i]; break;
      case '--keep': options.keep = true; break;
      case '--output': options.output = args[++i]; break;
      case '--help':
        console.log(`
Usage: archify smart [options]

Options:
  --agent <codex|claude>     force agent (default: auto-detect)
  --model-low <model>        model for discovery (default: gpt-5.4-mini or haiku)
  --model-medium <model>     model for dependencies (default: same as low)
  --model-high <model>       model for synthesis (default: gpt-5.6-terra or sonnet)
  --keep                     keep intermediate files
  --output <file>            output HTML file (default: archify-diagram.html)
  --dir <path>               repository root (default: .)
  --help                     show this help
        `);
        process.exit(0);
    }
  }

  if (!options.agent) {
    options.agent = detectAgent();
  }

  // Set defaults based on agent
  if (!options.modelLow) {
    options.modelLow = options.agent === 'codex' ? 'gpt-5.4-mini' : 'haiku';
  }
  if (!options.modelMedium) {
    options.modelMedium = options.modelLow;
  }
  if (!options.modelHigh) {
    options.modelHigh = options.agent === 'codex' ? 'gpt-5.6-terra' : 'sonnet';
  }

  await runSmartPipeline(options);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
