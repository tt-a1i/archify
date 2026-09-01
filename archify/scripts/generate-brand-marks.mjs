#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as simpleIcons from 'simple-icons';
import { CAPABILITY_MARKS } from '../renderers/shared/capability-marks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const catalogPath = path.join(root, 'brand-marks', 'catalog.json');
const rightsPath = path.join(root, 'brand-marks', 'rights.json');
const noticePath = path.join(root, 'THIRD_PARTY_BRAND_ASSETS.md');
const outputPath = path.join(root, 'renderers', 'shared', 'generated-brand-marks.mjs');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const rights = JSON.parse(fs.readFileSync(rightsPath, 'utf8'));
const notice = fs.readFileSync(noticePath, 'utf8');
const simpleIconsVersion = JSON.parse(fs.readFileSync(
  path.join(root, 'node_modules', 'simple-icons', 'package.json'),
  'utf8',
)).version;
if (rights.assetRevision !== `simple-icons@${simpleIconsVersion}`) {
  fail(`rights.json assetRevision must match simple-icons@${simpleIconsVersion}`);
}
const simpleBySlug = new Map(Object.values(simpleIcons)
  .filter((icon) => icon && typeof icon === 'object' && icon.slug && icon.path)
  .map((icon) => [icon.slug, icon]));

function normalizedList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function lookupForms(value) {
  const raw = String(value ?? '').trim().toLocaleLowerCase('en-US');
  if (!raw) return [];
  return [...new Set([
    raw,
    raw.replace(/[\s_]+/g, '-'),
    raw.replace(/[\s_.-]+/g, ''),
  ])];
}

function fail(message) {
  console.error(`brand catalog: ${message}`);
  process.exit(1);
}

if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.marks) || catalog.marks.length === 0) {
  fail('catalog.json must contain a non-empty schemaVersion 1 marks array');
}
if (rights.schemaVersion !== 1 || !rights.decisions || typeof rights.decisions !== 'object') {
  fail('rights.json must contain schemaVersion 1 decisions');
}

const expectedDecisionCounts = Object.freeze({ HOLD: 44, KEEP_WITH_NOTICE: 13, COUNSEL: 50 });
const capabilityIds = new Set(CAPABILITY_MARKS.map((mark) => mark.id));
const decisionById = new Map();
for (const [decision, expectedCount] of Object.entries(expectedDecisionCounts)) {
  const entries = rights.decisions[decision];
  if (!Array.isArray(entries) || entries.length !== expectedCount) {
    fail(`rights.json ${decision} must contain exactly ${expectedCount} IDs`);
  }
  for (const id of entries) {
    if (decisionById.has(id)) fail(`rights decision duplicated for ${id}`);
    decisionById.set(id, decision);
  }
}
for (const id of rights.decisions.KEEP_WITH_NOTICE) {
  const evidence = rights.notices?.[id]?.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.some((url) => !/^https:\/\//.test(url))) {
    fail(`KEEP_WITH_NOTICE ${id} requires at least one HTTPS evidence URL`);
  }
}
if (!rights.suggestedCapabilities || typeof rights.suggestedCapabilities !== 'object'
  || Array.isArray(rights.suggestedCapabilities)) {
  fail('rights.json must contain suggestedCapabilities for every HOLD ID');
}
if (Object.keys(rights.suggestedCapabilities).length !== rights.decisions.HOLD.length) {
  fail('rights.json suggestedCapabilities must cover exactly the HOLD IDs');
}
for (const id of rights.decisions.HOLD) {
  const capability = rights.suggestedCapabilities[id];
  if (!capabilityIds.has(capability)) fail(`HOLD ${id} has invalid suggested capability ${capability}`);
}
for (const id of Object.keys(rights.suggestedCapabilities)) {
  if (!rights.decisions.HOLD.includes(id)) fail(`suggested capability references non-HOLD ID ${id}`);
}

const ids = new Set();
const lookupKeys = new Map();
const domains = new Map();
const policies = [];
const generated = catalog.marks.map((entry, index) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id || '')) fail(`marks[${index}] has an invalid id`);
  if (ids.has(entry.id)) fail(`duplicate id ${entry.id}`);
  ids.add(entry.id);
  const rightsDecision = decisionById.get(entry.id);
  if (!rightsDecision) fail(`${entry.id} has no explicit rights decision`);

  const aliases = normalizedList(entry.aliases);
  const entryDomains = normalizedList(entry.domains).map((domain) => domain.toLowerCase());
  for (const key of [entry.id, ...aliases]) {
    for (const form of lookupForms(key)) {
      if (lookupKeys.has(form) && lookupKeys.get(form) !== entry.id) {
        fail(`lookup key ${JSON.stringify(key)} is shared by ${lookupKeys.get(form)} and ${entry.id}`);
      }
      lookupKeys.set(form, entry.id);
    }
  }
  for (const domain of entryDomains) {
    if (domains.has(domain) && domains.get(domain) !== entry.id) {
      fail(`domain ${domain} is shared by ${domains.get(domain)} and ${entry.id}`);
    }
    domains.set(domain, entry.id);
  }

  let mark;
  if (entry.simpleIcon) {
    const icon = simpleBySlug.get(entry.simpleIcon);
    if (!icon) fail(`${entry.id} references missing Simple Icons slug ${entry.simpleIcon}`);
    mark = {
      id: entry.id,
      title: entry.title || icon.title,
      category: entry.category,
      aliases,
      domains: entryDomains,
      viewBox: 24,
      hex: icon.hex,
      path: icon.path,
      provenance: {
        provider: 'Simple Icons',
        providerVersion: simpleIconsVersion,
        source: icon.source,
        ...(icon.guidelines ? { guidelines: icon.guidelines } : {}),
        ...(icon.license ? { license: icon.license } : {}),
      },
    };
  } else if (entry.custom) {
    const custom = entry.custom;
    if (!entry.title || !custom.path || !custom.source || !/^[0-9A-F]{6}$/i.test(custom.hex || '')) {
      fail(`${entry.id} custom mark requires title, path, source, and six-digit hex`);
    }
    mark = {
      id: entry.id,
      title: entry.title,
      category: entry.category,
      aliases,
      domains: entryDomains,
      viewBox: custom.viewBox || 24,
      hex: custom.hex.toUpperCase(),
      path: custom.path,
      provenance: {
        provider: 'Official brand asset',
        source: custom.source,
        ...(custom.guidelines ? { guidelines: custom.guidelines } : {}),
      },
    };
  } else {
    fail(`${entry.id} must provide simpleIcon or custom`);
  }
  if (!mark.category || !mark.title) fail(`${entry.id} is missing category or title`);
  for (const form of lookupForms(mark.title)) {
    if (lookupKeys.has(form) && lookupKeys.get(form) !== entry.id) {
      fail(`title ${JSON.stringify(mark.title)} is shared by ${lookupKeys.get(form)} and ${entry.id}`);
    }
    lookupKeys.set(form, entry.id);
  }
  const policy = {
    id: mark.id,
    title: mark.title,
    category: mark.category,
    aliases: mark.aliases,
    domains: mark.domains,
    rightsDecision,
    mitCovered: false,
    reviewedAt: rights.reviewedAt,
    assetRevision: rights.assetRevision,
    ...(rightsDecision === 'HOLD' ? { suggestedCapability: rights.suggestedCapabilities[entry.id] } : {}),
    ...(rightsDecision === 'KEEP_WITH_NOTICE' ? { evidence: rights.notices[entry.id].evidence } : {}),
  };
  policies.push(policy);
  return rightsDecision === 'HOLD' ? null : { ...mark, rightsDecision, mitCovered: false };
}).filter(Boolean).sort((left, right) => left.id.localeCompare(right.id));

for (const id of decisionById.keys()) {
  if (!ids.has(id)) fail(`rights.json contains unknown ID ${id}`);
}
if (ids.size !== decisionById.size) fail(`rights coverage mismatch: catalog=${ids.size}, decisions=${decisionById.size}`);
policies.sort((left, right) => left.id.localeCompare(right.id));
if (generated.length !== 63 || policies.length !== 107) {
  fail(`generated policy scope mismatch: renderable=${generated.length}, policies=${policies.length}`);
}
for (const id of rights.decisions.KEEP_WITH_NOTICE) {
  if (!notice.includes(`<!-- brand-notice:${id} -->`)) fail(`third-party notice is missing ${id}`);
}
for (const mark of generated) {
  const licenseType = mark.provenance.license?.type;
  if (licenseType && !notice.includes(`<!-- brand-license:${mark.id}:${licenseType} -->`)) {
    fail(`third-party notice is missing ${mark.id} ${licenseType} metadata`);
  }
}
for (const [id, entry] of Object.entries(rights.notices || {})) {
  if (entry.fullLicenseText && !notice.includes(`<!-- brand-license:${id}:${entry.fullLicenseText} -->`)) {
    fail(`third-party notice is missing ${id} ${entry.fullLicenseText} full-text marker`);
  }
}
if (!notice.includes('Copyright (c) 2011 Christopher Williams')
  || !notice.includes('Copyright 2010 Pallets')
  || !notice.includes('THE SOFTWARE IS PROVIDED "AS IS"')
  || !notice.includes('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"')) {
  fail('third-party notice is missing required MIT or BSD-3-Clause license text');
}
for (const requiredJenkinsNotice of [
  '[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)',
  'Attribution: [Jenkins project](https://jenkins.io/).',
  'Changes: normalized to a single SVG path and catalogue color.',
  'This derived asset is distributed under CC BY-SA 3.0.',
]) {
  if (!notice.includes(requiredJenkinsNotice)) {
    fail(`third-party notice is missing visible Jenkins obligation: ${requiredJenkinsNotice}`);
  }
}

const banner = `// Generated by scripts/generate-brand-marks.mjs from brand-marks/catalog.json and brand-marks/rights.json.\n// Simple Icons ${simpleIconsVersion}. Do not edit by hand.\n`;
const source = `${banner}export const BRAND_MARKS = Object.freeze(${JSON.stringify(generated, null, 2)});\n\nexport const BRAND_MARK_POLICIES = Object.freeze(${JSON.stringify(policies, null, 2)});\n`;

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, 'utf8').replace(/\r\n?/g, '\n')
    : '';
  if (current !== source) {
    console.error('generated brand marks are stale — run npm run generate:brand-marks');
    process.exit(1);
  }
} else {
  const temporary = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, source);
  fs.renameSync(temporary, outputPath);
  console.log(`generated ${path.relative(root, outputPath)} (${generated.length} renderable marks, ${policies.length} policies)`);
}
