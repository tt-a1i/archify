import * as tsAdapter from './ts/index.mjs';
import { fail } from './shared/diagnostics.mjs';

const ADAPTERS = [tsAdapter];

export function selectAdapter(root, config, requested) {
  if (requested) {
    const adapter = ADAPTERS.find((a) => a.id === requested);
    if (!adapter) fail('extract/adapter-unknown', `No language adapter named "${requested}".`, {
      subject: { option: '--language' },
      evidence: { requested, supported: ADAPTERS.map((a) => a.id) },
      supportedFixes: ['choose one of the supported adapters'],
    });
    return adapter;
  }
  const adapter = ADAPTERS.find((a) => a.detect(root, config));
  if (!adapter) fail('extract/adapter-undetected', 'No language adapter matched the analyzed directory.', {
    subject: { root },
    evidence: { supported: ADAPTERS.map((a) => a.id) },
    supportedFixes: ['point at a directory containing JS/TS sources', 'pass --language explicitly'],
  });
  return adapter;
}
