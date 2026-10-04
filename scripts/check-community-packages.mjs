#!/usr/bin/env node

// Validates community/packages/*.json against the community package contract
// (community/package.schema.json). Dependency-free by design: the registry is
// community-facing and must be checkable without installing anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootFlag = process.argv.indexOf('--root');
const repoRoot = rootFlag === -1 ? scriptRoot : path.resolve(process.argv[rootFlag + 1] || '');

export const PACKAGE_TYPES = Object.freeze(['skill', 'recipe', 'brand-marks', 'locale', 'wrapper']);
export const REQUIRED_FIELDS = Object.freeze(['name', 'type', 'summary', 'author', 'repository', 'archify', 'schemaVersions']);
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, 'homepage', 'tags', 'evidence']);
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const HTTPS_PATTERN = /^https:\/\/[^\s\\/?#@]+(?:[/?#][^\s\\]*)?$/;
const ARCHIFY_RANGE_PATTERN = /^(\^|~)\d+\.\d+\.\d+$|^\d+\.\d+\.\d+$|^>=\d+\.\d+\.\d+ <\d+\.\d+\.\d+$/;
const TAG_PATTERN = /^[a-z0-9-]{1,32}$/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function isHttpsUrl(value) {
  if (!isString(value) || /[\s\\\u0000-\u001f\u007f]/.test(value) || !HTTPS_PATTERN.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

// JSON Schema measures strings in Unicode code points, not UTF-16 units.
function textLength(value) {
  return [...value].length;
}

function unknownFields(value, allowed, subject, fail) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${subject}: unknown field "${key}".`);
  }
}

export function validatePackage(value) {
  const failures = [];
  const fail = (message) => failures.push(message);

  if (!isPlainObject(value)) {
    return ['entry must be a JSON object.'];
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) fail(`missing required field "${field}".`);
  }
  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field)) fail(`unknown field "${field}" (allowed: ${[...ALLOWED_FIELDS].join(', ')}).`);
  }
  if (failures.length) return failures;

  if (!isString(value.name) || !NAME_PATTERN.test(value.name)) {
    fail('name must be lowercase kebab-case (3-64 chars, letters/digits/hyphens).');
  }
  if (!PACKAGE_TYPES.includes(value.type)) {
    fail(`type must be one of: ${PACKAGE_TYPES.join(', ')}.`);
  }

  if (!isPlainObject(value.summary)) {
    fail('summary must be an object with "en" and "zh" strings.');
  } else {
    unknownFields(value.summary, ['en', 'zh'], 'summary', fail);
    const { en, zh } = value.summary;
    if (!isString(en) || textLength(en) < 10 || textLength(en) > 160) fail('summary.en must be 10-160 characters.');
    if (!isString(zh) || textLength(zh) < 6 || textLength(zh) > 120) fail('summary.zh must be 6-120 characters.');
  }

  if (!isPlainObject(value.author) || !isString(value.author.name) || !value.author.name.trim()) {
    fail('author must be an object with a non-empty "name".');
  } else {
    unknownFields(value.author, ['name', 'url'], 'author', fail);
    if (textLength(value.author.name) > 80) fail('author.name must be at most 80 characters.');
    if ('url' in value.author && !isHttpsUrl(value.author.url)) fail('author.url must be an https:// URL.');
  }

  if (!isHttpsUrl(value.repository)) fail('repository must be an https:// URL.');
  if (!isString(value.archify) || !ARCHIFY_RANGE_PATTERN.test(value.archify)) {
    fail('archify must be a version range like ^3.0.1 or >=3.0.0 <4.0.0.');
  }

  if (!Array.isArray(value.schemaVersions) || value.schemaVersions.length === 0) {
    fail('schemaVersions must be a non-empty array of positive integers.');
  } else {
    if (value.schemaVersions.some((entry) => !Number.isInteger(entry) || entry < 1)) {
      fail('schemaVersions entries must be positive integers.');
    }
    if (new Set(value.schemaVersions).size !== value.schemaVersions.length) {
      fail('schemaVersions entries must be unique.');
    }
  }

  if ('homepage' in value && !isHttpsUrl(value.homepage)) fail('homepage must be an https:// URL.');

  if ('tags' in value) {
    if (!Array.isArray(value.tags) || value.tags.length > 6 || value.tags.some((tag) => !isString(tag) || !TAG_PATTERN.test(tag))) {
      fail('tags must be at most 6 lowercase alphanumeric/hyphen strings.');
    } else if (new Set(value.tags).size !== value.tags.length) {
      fail('tags must be unique.');
    }
  }

  if ('evidence' in value) {
    if (!Array.isArray(value.evidence) || value.evidence.length > 8) {
      fail('evidence must be an array of at most 8 {label, url} entries.');
    } else {
      value.evidence.forEach((item, index) => {
        if (!isPlainObject(item) || !isString(item.label) || !item.label.trim() || !isHttpsUrl(item.url)) {
          fail(`evidence[${index}] must be {label: string, url: https:// URL}.`);
        } else {
          unknownFields(item, ['label', 'url'], `evidence[${index}]`, fail);
          if (textLength(item.label) > 80) fail(`evidence[${index}].label must be at most 80 characters.`);
        }
      });
    }
  }

  return failures;
}

// Shared by the file-system validator and the website's build-time glob.
export function validatePackageEntries(packageFiles) {
  const failures = [];
  const entries = [];
  if (packageFiles.length === 0) failures.push('community/packages/ contains no package metadata files.');
  const seen = new Set();
  for (const [file, value] of packageFiles) {
    for (const failure of validatePackage(value)) failures.push(`${file}: ${failure}`);
    if (isPlainObject(value)) {
      const expectedFile = `${value.name}.json`;
      // path-contract-allow: portable-logical-path -- Registry file names are logical identifiers, not native paths.
      if (isString(value.name) && file !== expectedFile) {
        failures.push(`${file}: file name must match the name field (${expectedFile}).`);
      }
      if (seen.has(value.name)) failures.push(`${file}: duplicate package name "${value.name}".`);
      seen.add(value.name);
      entries.push(value);
    }
  }
  return { entries, failures };
}

export function validateRegistry(root = repoRoot) {
  const packagesDir = path.join(root, 'community', 'packages');
  let files;
  try {
    files = fs.readdirSync(packagesDir).filter((entry) => entry.endsWith('.json')).sort();
  } catch {
    return { entries: [], failures: ['community/packages/ is missing or unreadable.'] };
  }
  const parsed = [];
  const failures = [];
  for (const file of files) {
    try {
      parsed.push([file, JSON.parse(fs.readFileSync(path.join(packagesDir, file), 'utf8'))]);
    } catch (error) {
      failures.push(`${file}: not valid JSON (${error.message}).`);
    }
  }
  const result = validatePackageEntries(parsed);
  return { entries: result.entries, failures: [...failures, ...result.failures] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { entries, failures } = validateRegistry(repoRoot);
  for (const failure of failures) console.error(`✗ ${failure}`);
  if (failures.length) {
    console.error(`\ncommunity registry: ${failures.length} problem(s) across ${entries.length} package(s).`);
    process.exitCode = 1;
  } else {
    console.log(`community registry: ${entries.length} package(s) OK (${entries.map((entry) => entry.name).join(', ')}).`);
  }
}
