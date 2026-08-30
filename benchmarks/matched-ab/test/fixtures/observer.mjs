const variant = process.env.ARCHIFY_BENCHMARK_VARIANT;
const delayMs = variant === 'A' ? 70 : 5;
const started = performance.now();
while (performance.now() - started < delayMs) {
  // Deterministic CPU work keeps this fixture independent of timer implementation.
}

const fixedConfig = JSON.parse(process.env.ARCHIFY_BENCHMARK_CONFIG_JSON ?? '{}');
const semanticCoverage = {
  facts: ['fact:source', 'fact:sink'],
  nodes: ['node:api', 'node:db'],
  messages: ['message:request', 'message:reply'],
  views: ['view:light-desktop', 'view:dark-mobile'],
};
if (fixedConfig.dropSemanticCoverageFor === variant) {
  semanticCoverage.facts.pop();
  semanticCoverage.nodes.pop();
  semanticCoverage.messages.pop();
  semanticCoverage.views.pop();
}
process.stdout.write(`${JSON.stringify({
  semanticCoverage,
  observedConfig: fixedConfig,
})}\n`);
