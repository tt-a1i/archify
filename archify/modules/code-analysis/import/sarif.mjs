import fs from 'node:fs';
import AjvDraft04 from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import { invalid, lineLocation, sourceSeverity } from './common.mjs';

let validate;
function validateReport(report) {
  if (!validate) {
    const ajv = new AjvDraft04({ allErrors: true, strict: false });
    addFormats(ajv);
    validate = ajv.compile(JSON.parse(fs.readFileSync(new URL('./vendor/sarif-schema-2.1.0.json', import.meta.url), 'utf8')));
  }
  if (!validate(report)) invalid('Input does not conform to the official SARIF 2.1.0 schema.', '/', { errors: validate.errors.slice(0, 20).map(e => ({ path: e.instancePath, message: e.message })) });
}

export function parseSarif(report) {
  validateReport(report);
  return report.runs.map((raw, runIndex) => {
    const driver = raw.tool.driver;
    const run = {
      key: JSON.stringify([driver.guid || driver.name, raw.automationDetails?.id || null]),
      tool: driver.name, version: driver.semanticVersion || driver.version || null,
      records: [], files: [], sourceTexts: [], sourceHashes: [], notices: [], suppressed: 0,
      incomplete: !Array.isArray(raw.results),
    };
    const notice = (code, message) => run.notices.push({ code, message });
    if (!Array.isArray(raw.results)) notice('external/results-missing', 'This SARIF run omitted results; it is not a positive empty scan.');
    if (Object.keys(raw.externalPropertyFileReferences || {}).length) {
      run.incomplete = true;
      notice('external/properties-not-loaded', 'SARIF external property files are not loaded; this import may omit externally stored data.');
    }
    for (const invocation of raw.invocations || []) {
      if (invocation.executionSuccessful === false) {
        run.incomplete = true;
        notice('external/tool-failed', 'The source tool reported executionSuccessful=false.');
      }
      for (const notification of [...(invocation.toolExecutionNotifications || []), ...(invocation.toolConfigurationNotifications || [])]) {
        notice('external/tool-notification', notification.message.text || notification.message.markdown || notification.message.id || 'Source tool notification');
        if (notification.level === 'error') run.incomplete = true;
      }
    }

    const artifactUri = (location, seen = new Set()) => {
      if (!location) return null;
      if (location.uri === undefined && location.index !== undefined && location.index >= 0) {
        if (seen.has(location.index) || !raw.artifacts?.[location.index]?.location) { run.incomplete = true; notice('external/artifact-unresolved', 'A SARIF artifact index could not be resolved.'); return null; }
        seen.add(location.index);
        return artifactUri(raw.artifacts[location.index].location, seen);
      }
      if (location.uri === undefined) return null;
      let value = location.uri;
      if (location.uriBaseId) {
        const bases = new Set();
        const resolveBase = id => {
          if (bases.has(id)) return null;
          bases.add(id);
          const base = raw.originalUriBaseIds?.[id];
          if (!base?.uri) return null;
          if (!base.uriBaseId) return base.uri;
          const parent = resolveBase(base.uriBaseId);
          if (!parent) return null;
          try { return new URL(base.uri, parent).href; } catch { return null; }
        };
        const base = resolveBase(location.uriBaseId);
        if (!base) { run.incomplete = true; notice('external/uri-base-unresolved', `Could not resolve SARIF URI base ${location.uriBaseId}.`); return null; }
        try { value = new URL(value, base).href; }
        catch { run.incomplete = true; notice('external/uri-base-unresolved', 'SARIF URI base is not an absolute URI.'); return null; }
      }
      // SARIF artifact paths are URI references, unlike native lint paths.
      // file: URLs are decoded later by repoPath; relative references need one
      // decode here (so a literal percent in a native filename is untouched).
      if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || /^[A-Za-z]:[\\/]/.test(value)) {
        if (/[?#]/.test(value)) { run.incomplete = true; notice('external/location-unresolved', 'A relative artifact URI has unsupported query or fragment components.'); return null; }
        try { value = decodeURIComponent(value); }
        catch { run.incomplete = true; notice('external/location-unresolved', 'An artifact URI could not be percent-decoded.'); return null; }
      }
      return value;
    };
    for (const artifact of raw.artifacts || []) {
      const file = artifactUri(artifact.location);
      if (!file) continue;
      run.files.push(file);
      if (typeof artifact.contents?.text === 'string') run.sourceTexts.push({ path: file, text: artifact.contents.text });
      const hash = artifact.hashes?.['sha-256'] || artifact.hashes?.sha256;
      if (typeof hash === 'string' && /^[a-fA-F0-9]{64}$/.test(hash)) run.sourceHashes.push({ path: file, sha256: hash.toLowerCase() });
    }
    const columnKind = raw.columnKind || 'utf16CodeUnits';
    (raw.results || []).forEach((result, resultIndex) => {
      if (['pass', 'notApplicable'].includes(result.kind)) return;
      if (result.suppressions?.some(s => s.status === undefined || s.status === 'accepted')) { run.suppressed++; return; }
      let component = driver;
      const reference = result.rule?.toolComponent;
      if (reference && (reference.index !== undefined || reference.guid !== undefined)) {
        component = reference.index !== undefined ? raw.tool.extensions?.[reference.index]
          : [driver, ...(raw.tool.extensions || [])].find(c => c.guid === reference.guid);
        if (!component) invalid('SARIF tool component reference does not identify an available driver or extension.', `/runs/${runIndex}/results/${resultIndex}/rule`);
      }
      const index = result.rule?.index ?? result.ruleIndex;
      let ruleId = result.ruleId || result.rule?.id || null;
      let rule = ruleId ? component.rules?.find(r => r.id === ruleId) || component.rules?.filter(r => ruleId.startsWith(`${r.id}/`)).sort((a, b) => b.id.length - a.id.length)[0] : null;
      if (result.rule?.guid) {
        rule = component.rules?.find(r => r.guid === result.rule.guid);
        if (!rule) { run.incomplete = true; notice('external/rule-unresolved', 'A SARIF rule GUID could not be resolved to an available descriptor.'); }
        else if (ruleId && rule.id !== ruleId && !ruleId.startsWith(`${rule.id}/`)) invalid('SARIF rule GUID conflicts with the declared rule id.', `/runs/${runIndex}/results/${resultIndex}/rule`);
      }
      if (index !== undefined && index >= 0) {
        const indexed = component.rules?.[index];
        if (!indexed || (ruleId && indexed.id !== ruleId && !ruleId.startsWith(`${indexed.id}/`)) || result.rule?.guid && indexed.guid !== result.rule.guid) invalid('SARIF ruleIndex does not identify the declared rule.', `/runs/${runIndex}/results/${resultIndex}`);
        rule = indexed; ruleId ||= rule.id;
      }
      ruleId ||= rule?.id || null;
      const message = messageText(result.message, rule?.messageStrings, component.globalMessageStrings);
      if (message === null) {
        run.incomplete = true;
        notice('external/message-unresolved', `Message template ${result.message.id || '(unknown)'} was not available.`);
      }
      const locations = [];
      for (const [role, reported] of [['primary', result.locations || []], ['related', result.relatedLocations || []]]) {
        for (const location of reported) {
          const physical = location.physicalLocation;
          const file = artifactUri(physical?.artifactLocation);
          if (!file) {
            run.incomplete = true;
            notice('external/location-unresolved', 'A SARIF location has no supported local artifact path.');
            // Retain logical-only and otherwise unsupported locations for audit.
            // Dropping a primary here would promote a related citation to it.
            locations.push({ ...location, role });
            continue;
          }
          const region = physical.region || {};
          locations.push({ ...lineLocation(file,
            { line: region.startLine, column: region.startColumn },
            { line: region.endLine, column: region.endColumn }, columnKind), role });
          if (region.startLine === undefined && ((region.charOffset !== undefined && region.charOffset >= 0) || physical.address || (region.byteOffset !== undefined && region.byteOffset >= 0))) {
            locations.at(-1).noSource = true;
            run.incomplete = true;
            notice('external/location-unsupported', 'Offset-only or binary SARIF regions have no inferred source line range.');
          }
          run.files.push(file);
        }
      }
      const fingerprints = Object.keys(result.fingerprints || {}).length ? result.fingerprints : null;
      const key = fingerprints && (Object.keys(fingerprints).find(k => k === 'primaryLocationLineHash') || Object.keys(fingerprints).sort().at(-1));
      // SARIF 3.27.17: partial values contribute to identity; no single one is
      // promised unique. Keep every contributor in a deterministic order.
      const partial = fingerprints ? [] : Object.entries(result.partialFingerprints || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const componentVersion = component.semanticVersion || component.version;
      const ambiguousComponent = !component.guid && [driver, ...(raw.tool.extensions || [])].filter(c => !c.guid && c.name === component.name).length > 1;
      if (ambiguousComponent) {
        run.incomplete = true;
        if (!run.notices.some(n => n.code === 'external/tool-component-identity-ambiguous')) notice('external/tool-component-identity-ambiguous', 'Same-named tool components without GUIDs can only be distinguished by their report indexes; a new report requires another review.');
      }
      const level = result.level ?? rule?.defaultConfiguration?.level ?? 'warning';
      const suggestions = (result.fixes || []).map(fix => messageText(fix.description) || 'The source tool supplied an edit; verify applicability before applying it.');
      run.records.push({
        ruleId, message: message === '' ? '(Empty source tool message)' : message ?? `Source message template: ${result.message.id}`,
        originalSeverity: level, severity: sourceSeverity(level),
        locations, ...(rule?.helpUri ? { helpUri: rule.helpUri } : {}),
        ...(key ? { fingerprint: `${key}:${fingerprints[key]}` } : partial.length ? { fingerprint: `sarif-partial/v1:${JSON.stringify(partial)}`, fingerprintPartial: true } : {}),
        origin: {
          sarifRun: runIndex,
          toolComponent: {
            name: component.name, ...(component.guid ? { guid: component.guid } : {}), ...(componentVersion ? { version: componentVersion } : {}),
            ...(ambiguousComponent ? { index: component === driver ? null : raw.tool.extensions.indexOf(component), identityAmbiguous: true } : {}),
          },
          ...(result.baselineState ? { baselineState: result.baselineState } : {}), ...(result.message.id ? { messageId: result.message.id } : {}), ...(result.rule?.guid ? { ruleGuid: result.rule.guid } : {}), ...(message === '' ? { sourceMessage: result.message } : {}),
        },
        suggestions, pointer: `/runs/${runIndex}/results/${resultIndex}`,
      });
    });
    return run;
  });
}

function messageText(message, rules = {}, globals = {}) {
  if (!message) return null;
  const template = message.text ?? message.markdown ?? rules?.[message.id]?.text ?? rules?.[message.id]?.markdown ?? globals?.[message.id]?.text ?? globals?.[message.id]?.markdown;
  if (typeof template !== 'string') return null;
  return template.replace(/\{\{|\}\}|\{(\d+)\}/g, (match, index) => match === '{{' ? '{' : match === '}}' ? '}' : message.arguments?.[Number(index)] ?? match);
}
