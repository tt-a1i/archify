import * as tsAdapter from './ts/index.mjs';
import * as pyAdapter from './py/index.mjs';
import { fail } from './shared/diagnostics.mjs';

const ADAPTERS = [tsAdapter, pyAdapter];

export function selectAdapter(root, config, requested) {
  const supported = ADAPTERS.map((a) => a.id);
  if (requested) {
    const adapter = ADAPTERS.find((a) => a.id === requested);
    if (!adapter) fail('extract/adapter-unknown', `No language adapter named "${requested}".`, {
      subject: { option: '--language' }, evidence: { requested, supported },
      supportedFixes: ['choose one of the supported adapters'],
    });
    return adapter;
  }
  const detected = ADAPTERS.filter((a) => a.detect(root, config));
  if (!detected.length) fail('extract/adapter-undetected', 'No language adapter matched the analyzed directory.', {
    subject: { root }, evidence: { supported },
    supportedFixes: ['point at a directory containing JS/TS or Python sources', 'pass --language explicitly'],
  });
  if (detected.length > 1) fail('extract/adapter-ambiguous', 'More than one language adapter matches; choose one explicitly.', {
    subject: { root }, evidence: { detected: detected.map((a) => a.id) },
    supportedFixes: detected.map((a) => `pass --language ${a.id}`).concat(['exclude the other language in the config']),
  });
  return detected[0];
}
