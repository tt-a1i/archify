import { fail } from '../../../extract/shared/diagnostics.mjs';

// Function complexity: functions whose cyclomatic complexity or block nesting
// reaches the configured thresholds. A high count is a maintenance signal (more
// paths to read and test), not a defect, so the strongest level is a warning.
// Function length is reported as evidence but never fires on its own.
//
// The rule runs only when the extractor measured functions (facts.functions is
// present; both the Python and the JS/TS adapters record them, counted the same
// way). Facts without them, such as raw facts written by an older version, leave
// the rule out of findings.rules, and complexity is reported as not checked.
// Test and generated files follow the module graph's exclusion policy.
//
// Thresholds (defaults below) can be set in the config:
//   "rules": { "complexity": { "function": { "info": { "complexity": 15, "nesting": 5 },
//                                            "warning": { "complexity": 25, "nesting": 6 } } } }
// The defaults follow the common radon grading (C from 11, D from 21, E from
// 31): info starts inside C, warning inside D. On a 180-file Python project
// they flag about 6% of functions, a quarter of those as warnings.
export const code = 'complexity/function';
export const dimension = 'complexity';
export const severity = 'warning';
export const confidence = 1;

export const DEFAULTS = { info: { complexity: 15, nesting: 5 }, warning: { complexity: 25, nesting: 6 } };

export function enabled(config, facts) {
  return Boolean(facts && Array.isArray(facts.functions));
}

// A threshold must be a whole number of 0 or more. Anything else (a string such as
// "oops", a negative, a fraction) would compare as NaN and silently match nothing,
// so a misconfigured run would report a clean result. Name the setting and stop.
function wholeNumber(value, where) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  fail('config/threshold-invalid', `The complexity threshold "${where}" must be a whole number of 0 or more, got ${JSON.stringify(value)}.`, {
    subject: { option: where },
    evidence: { value },
    supportedFixes: ['set it to a whole number, or remove it to use the default'],
  });
}

export function thresholds(config) {
  const custom = config?.rules?.complexity?.function || {};
  const level = (name, defaults) => {
    const source = custom[name] || {};
    return {
      complexity: source.complexity === undefined ? defaults.complexity : wholeNumber(source.complexity, `rules.complexity.function.${name}.complexity`),
      nesting: source.nesting === undefined ? defaults.nesting : wholeNumber(source.nesting, `rules.complexity.function.${name}.nesting`),
    };
  };
  return { info: level('info', DEFAULTS.info), warning: level('warning', DEFAULTS.warning) };
}

export function run({ graph, config, facts }) {
  if (!enabled(config, facts)) return [];
  const limits = thresholds(config);
  const excluded = new Set(graph.excluded.roles || []);
  const skip = new Set(facts.files.filter((f) => excluded.has(f.role)).map((f) => f.path));
  const reaches = (fn, level) => fn.complexity >= limits[level].complexity || fn.nesting >= limits[level].nesting;
  return facts.functions
    // Keep a function that reaches either level: a config may set a warning
    // threshold below its info threshold, and such a function must still be
    // reported (at the warning level) rather than dropped by the info filter.
    .filter((fn) => !skip.has(fn.file) && (reaches(fn, 'info') || reaches(fn, 'warning')))
    .sort((a, b) => b.complexity - a.complexity || b.nesting - a.nesting || compareText(a.file, b.file) || a.line - b.line)
    .map((fn) => {
      const level = reaches(fn, 'warning') ? 'warning' : 'info';
      const length = fn.endLine - fn.line + 1;
      const why = [
        fn.complexity >= limits[level].complexity ? `cyclomatic complexity ${fn.complexity}` : null,
        fn.nesting >= limits[level].nesting ? `nesting depth ${fn.nesting}` : null,
      ].filter(Boolean).join(' and ');
      return {
        code, dimension, severity: level, confidence,
        message: `${fn.qualname} in ${fn.file} has ${why} (${length} lines). More independent paths make it harder to read and to test fully; this is a maintenance signal, not a defect.`,
        subject: { file: fn.file, function: fn.qualname, line: fn.line, endLine: fn.endLine },
        evidence: {
          threshold: limits[level],
          // Both levels: the finding goes away only below both levels, whatever level it was reported at.
          thresholds: limits,
          complexity: fn.complexity,
          nesting: fn.nesting,
          deepestLine: fn.deepestLine,
          length,
        },
        supportedFixes: [
          'start at the deepest nested block: extract it into a named helper with its own tests',
          'replace long if/elif chains on one value with a lookup table or dispatch',
          'return early for edge cases so the main path is not nested',
          'if the branching is inherent, raise the threshold in the analysis config rather than splitting artificially',
        ],
      };
    });
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
