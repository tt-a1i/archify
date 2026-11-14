// The rule registry. Every rule is a module exporting { code, dimension,
// severity, confidence, run({ graph, config, facts }) -> Finding[] } and
// optionally enabled(config, facts). Adding a rule means adding its file and
// one line here; the order is the order rules run in, and findings are sorted
// afterwards, so it never changes an id.
import * as importCycle from './coupling/import-cycle.mjs';
import * as cycle from './coupling/cycle.mjs';
import * as hub from './coupling/hub.mjs';
import * as internalLeak from './coupling/internal-leak.mjs';
import * as concentration from './coupling/concentration.mjs';
import * as boundary from './architecture/boundary.mjs';
import * as complexity from './complexity/function.mjs';
import * as duplicate from './redundancy/duplicate-block.mjs';

import * as genericName from './organization/generic-name.mjs';

export const RULES = [importCycle, cycle, hub, concentration, internalLeak, boundary, complexity, duplicate, genericName];

// evaluate/index.mjs runs the duplicate scan once for this rule and pins its ranges.
export { duplicate as duplicateBlock };

// The jscpd scan behind the duplicate rule. evaluate/index.mjs runs it once per
// evaluation; other callers reach it through evaluate/index.mjs.
export { analyzeDuplicates, duplicateOptions, DUPLICATE_RULE, JSCPD_VERSION } from './redundancy/jscpd.mjs';

// Layer statistics the overview shows next to boundary findings.
export { layerCounts } from './architecture/boundary.mjs';
