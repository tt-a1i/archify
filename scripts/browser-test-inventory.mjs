// Shared by PR CI and tag releases. WebM decoding stays in test:webm.
// Adjacent heavy suites use opposite indices for CI's two modulo shards.
export const browserTestFiles = [
  'finalize-browser.test.mjs',
  'desktop-reader-browser.test.mjs',
  'reader-readability-maintained-browser.test.mjs',
  'reader-layout-browser.test.mjs',
  'reader-layout-settle-browser.test.mjs',
  'reader-cards-overflow-browser.test.mjs',
  'joint-layout-browser.test.mjs',
  'sequence-header-clearance.test.mjs',
  'sequence-width-default-browser.test.mjs',
  'compact-header-clearance.test.mjs',
  'architecture-reading-size-browser.test.mjs',
  'export-cleanup-browser.test.mjs',
  'i18n-browser.test.mjs',
  'offline-font-browser.test.mjs',
  'viewer-chrome-layout.test.mjs',
  'semantic-radar.test.mjs',
  'viewer-camera-browser.test.mjs',
  'viewer-radar-scroll-browser.test.mjs',
  'motion-governor-browser.test.mjs',
  'finder-browser.test.mjs',
  'intent-trace-browser.test.mjs',
  'semantic-lens-browser.test.mjs',
  'reading-address-browser.test.mjs',
  'route-probe-browser.test.mjs',
  'focus-browser.test.mjs',
  'passport-explanation-browser.test.mjs',
  'drilldown-context-browser.test.mjs',
  'crossover-state-browser.test.mjs',
  'semantic-passport-move-browser.test.mjs',
  'export-browser.test.mjs',
  'menu-modifier-browser.test.mjs',
  'export-selection-browser.test.mjs',
  'sequence-note-export-browser.test.mjs',
  'viewer-identifiers-browser.test.mjs',
  'repository-evidence-browser.test.mjs',
  'repository-evidence-types-browser.test.mjs',
  'tree-branches-browser.test.mjs',
  'class-motion-browser.test.mjs',
  'dataflow-label-visibility-browser.test.mjs',
  'workflow-edge-label-contrast-browser.test.mjs',
  'edge-label-contrast-browser.test.mjs',
  'lifecycle-note-contrast-browser.test.mjs',
  'sequence-segment-contrast-browser.test.mjs',
  'toolbar-keyboard-browser.test.mjs',
  'bottom-node-index-browser.test.mjs',
  'explainer-browser.test.mjs',
  'code-analysis-browser.test.mjs',
  'code-analysis-boundary-browser.test.mjs',
  'code-analysis-complexity-browser.test.mjs',
  'code-analysis-review-browser.test.mjs',
  'code-analysis-task-browser.test.mjs',
  'code-analysis-workbench-browser.test.mjs',
  'code-analysis-standalone-browser.test.mjs',
  'story-browser.test.mjs',
  // Benchmark observers and real export integration require this explicit Chrome lane.
  'diagram-quality-e2e-browser.test.mjs',
];

// Only these independent reader assets have narrowed source ownership. Keep
// every generic/mixed suite: filenames alone do not prove renderer isolation.
export function selectBrowserTests(scope, owners, changed) {
  if (!['core', 'full', 'docs'].includes(scope) || !Array.isArray(owners) || !Array.isArray(changed)) {
    throw new Error('Invalid browser CI selection');
  }
  const moduleOwners = ['code-analysis', 'explainer', 'story'];
  const allowed = [...moduleOwners, 'renderer', 'viewer', 'authoring', 'schema', 'site', 'artifact', 'delta', 'readme',
    'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall'];
  if (owners.some(owner => !allowed.includes(owner))) throw new Error('Unknown browser CI owner');
  if (changed.some(file => !/^test\/[^/]+\.test\.mjs$/.test(file))) throw new Error('Invalid changed browser test path');
  if (scope !== 'core' || !owners.length || owners.some(owner => !moduleOwners.includes(owner))) return browserTestFiles;
  return browserTestFiles.filter(file => {
    // path-contract-allow: portable-logical-path -- Inventory basenames identify test owners, not native filesystem containment.
    const owner = moduleOwners.find(owner => file === `${owner}-browser.test.mjs` || file.startsWith(`${owner}-`));
    return !owner || owners.includes(owner) || changed.includes(`test/${file}`);
  });
}
