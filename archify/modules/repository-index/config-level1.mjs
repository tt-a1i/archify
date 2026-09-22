import fs from 'node:fs';
import path from 'node:path';

// Level 1 reads bounded configuration prefixes and returns selected identifiers.
// Callers should treat those identifiers as potentially sensitive local data.
export const DEFAULT_LIMITS = Object.freeze({
  maximumFiles: 250,
  maximumBytesPerFile: 512 * 1024,
  maximumTotalBytes: 16 * 1024 * 1024,
  maximumFactItems: 50,
});
const MAX_FACT_ITEMS = DEFAULT_LIMITS.maximumFactItems;
let factLimitReached = false;

function unique(values) {
  const items = [...new Set(values.filter(Boolean))];
  if (items.length > MAX_FACT_ITEMS) factLimitReached = true;
  return items.slice(0, MAX_FACT_ITEMS);
}

function limited(values) {
  if (values.length > MAX_FACT_ITEMS) factLimitReached = true;
  return values.slice(0, MAX_FACT_ITEMS);
}

function matches(text, pattern, group = 1) {
  return unique([...text.matchAll(pattern)].map((match) => match[group]?.trim()));
}

function first(text, pattern, group = 1) {
  return text.match(pattern)?.[group]?.trim() || null;
}

function quotedValues(text) {
  return matches(text, /["']([^"']+)["']/g);
}

function safeReference(value) {
  if (!value) return value;
  // Terraform module sources may prefix a URL with git::, while URL userinfo
  // and query parameters can both carry credentials. They are not needed to
  // identify the source repository during diagram exploration.
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1');
}

function commandPaths(command) {
  return unique(String(command || '').match(/[A-Za-z0-9_./\\-]+\.(?:[cm]?[jt]sx?|pyw?|go|rs|java|kt|cs|rb|php|sh|ps1)\b/gi) || []);
}

function yamlSectionKeys(text, sectionName) {
  const lines = text.split(/\r?\n/);
  const keys = [];
  let sectionIndent = null;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (sectionIndent === null) {
      if (new RegExp(`^${sectionName}:\\s*$`, 'i').test(line.trim())) sectionIndent = indent;
      continue;
    }
    if (indent <= sectionIndent) break;
    if (indent === sectionIndent + 2) {
      const key = line.trim().match(/^([^:#][^:]*):/)?.[1]?.trim();
      if (key) keys.push(key);
    }
  }
  return unique(keys);
}

// Items of a top-level `key:` list, e.g. conda `channels:` or pnpm `packages:`.
// Scoped to that block so an identically named value elsewhere is not picked up.
function yamlSequence(text, sectionName) {
  const items = [];
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent === 0) {
      inSection = new RegExp(`^${sectionName}:\\s*$`, 'i').test(line.trim());
      continue;
    }
    if (!inSection) continue;
    const item = line.trim().match(/^-\s*["']?([^\s"'#]+)/)?.[1];
    if (item) items.push(item);
  }
  return unique(items);
}

function parsePackageJson(text) {
  try {
    const value = JSON.parse(text);
    const workspaces = Array.isArray(value.workspaces) ? value.workspaces
      : Array.isArray(value.workspaces?.packages) ? value.workspaces.packages : [];
    return {
      name: typeof value.name === 'string' ? value.name : null,
      workspaces: unique(workspaces),
      scripts: unique(Object.keys(value.scripts || {})),
      entryScriptFiles: Object.fromEntries(limited(Object.entries(value.scripts || {})
        .filter(([name, command]) => /^(?:start|dev|serve|server|api|worker)$/i.test(name) && typeof command === 'string')
        .map(([name, command]) => [name, commandPaths(command)])
        .filter(([, files]) => files.length))),
      // `bin` and `main` are declared runtime entries, stronger evidence than a script.
      binaries: Object.fromEntries(limited(Object.entries(typeof value.bin === 'string' ? { [value.name || 'default']: value.bin } : (value.bin || {}))
        .filter(([, target]) => typeof target === 'string'))),
      main: typeof value.main === 'string' ? value.main : null,
      runtimeDependencies: unique([
        ...Object.keys(value.dependencies || {}),
        ...Object.keys(value.optionalDependencies || {}),
      ]),
    };
  } catch {
    return { parseError: 'invalid-json' };
  }
}

function parsePyproject(text) {
  const projectDependencies = first(text, /^dependencies\s*=\s*\[([\s\S]*?)\]/m);
  const poetry = first(text, /^\[tool\.poetry\.dependencies\]\s*([\s\S]*?)(?=^\[|(?![\s\S]))/m) || '';
  return {
    name: first(text, /^name\s*=\s*["']([^"']+)["']/m),
    dependencies: unique([
      ...quotedValues(projectDependencies || '').map((value) => value.split(/[<>=!~\s[]/, 1)[0]),
      ...matches(poetry, /^([A-Za-z0-9_.-]+)\s*=/gm),
    ]),
    scripts: matches(first(text, /^\[project\.scripts\]\s*([\s\S]*?)(?=^\[|(?![\s\S]))/m) || '', /^([^#=\s]+)\s*=/gm),
  };
}

function parseGoMod(text) {
  return {
    module: first(text, /^module\s+(\S+)/m),
    go: first(text, /^go\s+(\S+)/m),
    // Both forms: a `require (...)` block line, and a single-line `require path v1.2.3`.
    requires: matches(text, /^\s*(?:require\s+)?([A-Za-z0-9_.~/-]+)\s+v\S+/gm),
    replaces: matches(text, /^replace\s+(\S+)/gm),
  };
}

function tomlSection(text, name) {
  return first(text, new RegExp(`^\\[${name.replaceAll('.', '\\.')}\\]\\s*([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm')) || '';
}

function parseCargo(text) {
  return {
    name: first(tomlSection(text, 'package'), /^name\s*=\s*["']([^"']+)["']/m),
    workspaceMembers: quotedValues(first(tomlSection(text, 'workspace'), /^members\s*=\s*\[([\s\S]*?)\]/m) || ''),
    dependencies: unique([
      ...matches(tomlSection(text, 'dependencies'), /^([A-Za-z0-9_.-]+)\s*=/gm),
      ...matches(tomlSection(text, 'workspace.dependencies'), /^([A-Za-z0-9_.-]+)\s*=/gm),
    ]),
  };
}

function parsePom(text) {
  const coordinates = {
    groupId: first(text, /<groupId>\s*([^<]+)\s*<\/groupId>/i),
    artifactId: first(text, /<artifactId>\s*([^<]+)\s*<\/artifactId>/i),
    packaging: first(text, /<packaging>\s*([^<]+)\s*<\/packaging>/i),
  };
  return {
    ...coordinates,
    modules: matches(text, /<module>\s*([^<]+)\s*<\/module>/gi),
    dependencies: unique(matches(text, /<artifactId>\s*([^<]+)\s*<\/artifactId>/gi)
      .filter((value) => value !== coordinates.artifactId)),
  };
}

function parseGradle(text) {
  return {
    plugins: unique([
      ...matches(text, /\bid\s*(?:\(|\s)["']([^"']+)["']/g),
      ...matches(text, /\bapply\s+plugin:\s*["']([^"']+)["']/g),
    ]),
    dependencies: unique([
      ...matches(text, /\b(?:api|implementation|compileOnly|runtimeOnly)\s*(?:\(|\s)["']([^:"']+:[^:"']+)/g),
      ...matches(text, /\bproject\s*\(\s*["']([^"']+)["']/g),
    ]),
    includedProjects: limited(matches(text, /\binclude\s*(?:\(|\s)([^\r\n]+)/g).flatMap(quotedValues)),
  };
}

function parseCsproj(text) {
  return {
    targetFrameworks: unique([
      ...matches(text, /<TargetFramework>\s*([^<]+)\s*<\/TargetFramework>/gi),
      ...matches(text, /<TargetFrameworks>\s*([^<]+)\s*<\/TargetFrameworks>/gi).flatMap((value) => value.split(';')),
    ]),
    projectReferences: matches(text, /<ProjectReference\s+Include=["']([^"']+)["']/gi),
    packageReferences: matches(text, /<PackageReference\s+Include=["']([^"']+)["']/gi),
  };
}

function parseDockerfile(text) {
  const images = [];
  const stages = [];
  for (const match of text.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/gim)) {
    images.push(match[1]);
    if (match[2]) stages.push(match[2]);
  }
  return {
    baseImages: unique(images),
    stages: unique(stages),
    exposedPorts: unique(matches(text, /^EXPOSE\s+([^\r\n#]+)/gim).flatMap((value) => value.split(/\s+/))),
    hasEntrypoint: Boolean(first(text, /^ENTRYPOINT\s+([^\r\n]+)/im)),
    hasCommand: Boolean(first(text, /^CMD\s+([^\r\n]+)/im)),
  };
}

function parseCompose(text) {
  const lines = text.split(/\r?\n/);
  const services = [];
  let inServices = false;
  let current = null;
  let inDependsOn = false;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent === 0) {
      inServices = /^services:\s*$/.test(line.trim());
      current = null;
      inDependsOn = false;
      continue;
    }
    if (!inServices) continue;
    if (indent === 2) {
      const name = line.trim().match(/^([^:#][^:]*):/)?.[1]?.trim();
      current = name ? { name, image: null, build: null, dependsOn: [] } : null;
      if (current) services.push(current);
      inDependsOn = false;
      continue;
    }
    if (!current) continue;
    if (indent === 4) {
      inDependsOn = /^depends_on:\s*$/.test(line.trim());
      current.image ||= safeReference(first(line, /^\s*image:\s*["']?([^\s"'#]+)/i));
      current.build ||= safeReference(first(line, /^\s*build:\s*["']?([^\r\n"'#]+)/i));
      const inline = first(line, /^\s*depends_on:\s*\[([^\]]+)\]/i);
      if (inline) current.dependsOn.push(...inline.split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')));
      continue;
    }
    if (inDependsOn && indent === 6) {
      const dependency = line.trim().match(/^(?:-\s*)?([^:#\s][^:\s]*)(?::|$)/)?.[1];
      if (dependency) current.dependsOn.push(dependency);
    }
  }
  return {
    services: limited(services).map((service) => ({
      ...service,
      dependsOn: unique(service.dependsOn),
    })),
    networks: yamlSectionKeys(text, 'networks'),
    volumes: yamlSectionKeys(text, 'volumes'),
  };
}

function parseKubernetes(text) {
  return {
    kinds: matches(text, /^kind:\s*["']?([^\s"']+)/gim),
    names: matches(text, /^\s{2}name:\s*["']?([^\s"']+)/gim),
    images: matches(text, /^\s+image:\s*["']?([^\s"']+)/gim).map(safeReference),
    serviceAccounts: matches(text, /^\s+serviceAccountName:\s*["']?([^\s"']+)/gim),
  };
}

function parseTerraform(text) {
  return {
    requiredProviders: matches(text, /^\s*([A-Za-z0-9_-]+)\s*=\s*\{/gm),
    resources: matches(text, /\bresource\s+["']([^"']+)["']\s+["']([^"']+)["']/g, 1),
    dataSources: matches(text, /\bdata\s+["']([^"']+)["']\s+["']([^"']+)["']/g, 1),
    modules: matches(text, /\bmodule\s+["']([^"']+)["']/g),
    moduleSources: matches(text, /^\s*source\s*=\s*["']([^"']+)["']/gm).map(safeReference),
  };
}

function parseOpenApi(text) {
  try {
    const value = JSON.parse(text);
    return {
      title: value.info?.title || null,
      version: value.info?.version || null,
      paths: unique(Object.keys(value.paths || {})),
      tags: unique((value.tags || []).map((tag) => tag?.name)),
    };
  } catch {
    const pathBlock = text.match(/^paths:\s*\n([\s\S]*?)(?=^[A-Za-z][^:\n]*:\s*$|(?![\s\S]))/m)?.[1] || '';
    return {
      title: first(text, /^\s+title:\s*["']?([^\r\n"']+)/m),
      version: first(text, /^\s+version:\s*["']?([^\r\n"']+)/m),
      paths: matches(pathBlock, /^\s{2}(\/[^:]+):/gm),
    };
  }
}

function parseProto(text) {
  return {
    package: first(text, /^package\s+([^;]+);/m),
    imports: matches(text, /^import\s+(?:public\s+|weak\s+)?["']([^"']+)["'];/gm),
    services: matches(text, /^\s*service\s+(\w+)\s*\{/gm),
    rpcs: matches(text, /^\s*rpc\s+(\w+)\s*\(/gm),
    messages: matches(text, /^\s*message\s+(\w+)\s*\{/gm),
  };
}

function parseRequirements(text) {
  const names = [];
  const includes = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (/^-r\s+|^--requirement\s+/.test(line)) { includes.push(line.split(/\s+/)[1]); continue; }
    if (line.startsWith('-')) continue;
    if (/^(?:https?|git\+|file:|\.|\/)/i.test(line)) continue; // URLs and paths may carry credentials; never echoed
    const name = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1];
    if (name) names.push(name.toLowerCase());
  }
  return { dependencies: unique(names), includes: unique(includes.map(safeReference)) };
}

function parsePipfile(text) {
  return {
    dependencies: matches(tomlSection(text, 'packages'), /^([A-Za-z0-9_.-]+)\s*=/gm).map((name) => name.toLowerCase()),
    scripts: matches(tomlSection(text, 'scripts'), /^([A-Za-z0-9_.-]+)\s*=/gm),
  };
}

function parseSetupCfg(text) {
  const options = first(text, /^\[options\]\s*([\s\S]*?)(?=^\[|(?![\s\S]))/m) || '';
  const requires = first(options, /^install_requires\s*=\s*([\s\S]*?)(?=^\S|(?![\s\S]))/m) || '';
  return {
    name: first(text, /^\[metadata\]\s*[\s\S]*?^name\s*=\s*(\S+)/m),
    dependencies: unique(requires.split(/\r?\n/).map((line) => line.trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1]?.toLowerCase())),
    // Entry points nest one level: `console_scripts =` names the group at column 0,
    // and the indented lines under it are the actual commands.
    scripts: matches(first(text, /^\[options\.entry_points\]\s*([\s\S]*?)(?=^\[|(?![\s\S]))/m) || '', /^[ \t]+([A-Za-z0-9_.-]+)\s*=/gm),
  };
}

function parseCondaEnvironment(text) {
  return {
    name: first(text, /^name:\s*["']?([^\r\n"'#]+)/m),
    channels: yamlSequence(text, 'channels'),
    // A conda dependency carries its pin inline (`python=3.11`); keep only the name.
    dependencies: unique(yamlSequence(text, 'dependencies').map((item) => item.split(/[=<>!\s]/, 1)[0].toLowerCase())),
  };
}

function parseProcfile(text) {
  return {
    processes: Object.fromEntries(matches(text, /^([A-Za-z0-9_-]+):\s*\S/gm).map((name) => [name, commandPaths(first(text, new RegExp(`^${name}:\\s*([^\\r\\n]+)`, 'm')))])),
  };
}

function parsePnpmWorkspace(text) {
  return { packages: yamlSequence(text, 'packages') };
}

function parseHelmChart(text) {
  return {
    name: first(text, /^name:\s*["']?([^\r\n"'#]+)/m),
    dependencies: matches(first(text, /^dependencies:\s*\n([\s\S]*)/m) || '', /^\s*-\s*name:\s*["']?([^\s"'#]+)/gm),
  };
}

function parseGitlabCi(text) {
  const reserved = new Set(['stages', 'variables', 'default', 'include', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script']);
  const jobs = [];
  for (const raw of text.split(/\r?\n/)) {
    const key = raw.match(/^([A-Za-z0-9_.-]+):\s*$/)?.[1];
    if (key && !reserved.has(key) && !key.startsWith('.')) jobs.push(key);
  }
  return {
    stages: yamlSequence(text, 'stages'),
    jobs: unique(jobs),
    images: matches(text, /^\s*image:\s*["']?([^\s"'#]+)/gim).map(safeReference),
  };
}

function parseAzurePipeline(text) {
  return {
    stages: matches(text, /^\s*-\s*stage:\s*["']?([^\s"'#]+)/gim),
    jobs: matches(text, /^\s*-\s*job:\s*["']?([^\s"'#]+)/gim),
    pools: matches(text, /^\s*vmImage:\s*["']?([^\r\n"'#]+)/gim),
  };
}

function parseCiWorkflow(text) {
  return {
    jobs: yamlSectionKeys(text, 'jobs'),
    runners: matches(text, /^\s+runs-on:\s*["']?([^\r\n"'#]+)/gim),
    actions: matches(text, /^\s+-?\s*uses:\s*["']?([^\s"'#]+)/gim),
  };
}

export function configurationKind(record) {
  const lower = record.path.toLowerCase();
  const basename = path.posix.basename(lower);
  const parent = path.posix.dirname(lower);
  if (basename === 'package.json') return 'package-json';
  if (basename === 'pnpm-workspace.yaml' || basename === 'pnpm-workspace.yml') return 'pnpm-workspace';
  if (basename === 'pyproject.toml') return 'pyproject';
  if (basename === 'setup.cfg') return 'setup-cfg';
  if (basename === 'pipfile') return 'pipfile';
  if (/^requirements(?:[-_.][a-z0-9_.-]+)?\.txt$/.test(basename) || (/(^|\/)requirements$/.test(parent) && basename.endsWith('.txt'))) return 'python-requirements';
  if (basename === 'environment.yml' || basename === 'environment.yaml' || basename === 'conda.yml' || basename === 'conda.yaml') return 'conda-environment';
  if (basename === 'procfile') return 'procfile';
  if (basename === 'go.mod') return 'go-mod';
  if (basename === 'cargo.toml') return 'cargo';
  if (basename === 'pom.xml') return 'maven';
  if (basename === 'build.gradle' || basename === 'build.gradle.kts' || basename === 'settings.gradle' || basename === 'settings.gradle.kts') return 'gradle';
  if (basename.endsWith('.csproj')) return 'dotnet';
  if (/^dockerfile(?:\..+)?$/.test(basename) || /\.dockerfile$/.test(basename)) return 'dockerfile';
  if (/^(?:docker-)?compose(?:\.[^/]+)?\.ya?ml$/.test(basename)) return 'docker-compose';
  if (/\.proto$/.test(lower)) return 'protobuf';
  if (/^(?:openapi|swagger)(?:\.[^/]+)?\.(?:json|ya?ml)$/.test(basename)) return 'openapi';
  if (/\.tf(?:vars)?$/.test(lower)) return 'terraform';
  if (basename === '.gitlab-ci.yml' || basename === '.gitlab-ci.yaml') return 'gitlab-ci';
  if (/^azure-pipelines(?:[-.][^/]+)?\.ya?ml$/.test(basename)) return 'azure-pipeline';
  if (lower.startsWith('.github/workflows/') || /(^|\/)(?:ci|pipelines?)\/.+\.ya?ml$/.test(lower)) return 'ci-workflow';
  if (basename === 'chart.yaml' || basename === 'chart.yml') return 'helm-chart';
  if (/(^|\/)(?:k8s|kubernetes|manifests|deploy|helm)(\/|$)/.test(lower) && /\.ya?ml$/.test(basename)) return 'kubernetes';
  // Any other YAML is read (within the limits) and kept only if it is a Kubernetes manifest.
  if (/\.ya?ml$/.test(basename)) return 'yaml-candidate';
  return null;
}

function configurationDirectory(record) {
  const segments = record.path.split('/');
  if (segments.length === 1) return '.';
  return segments.slice(0, Math.min(2, segments.length - 1)).join('/');
}

function compareConfigurationEntries(left, right) {
  const leftCandidate = left.kind === 'yaml-candidate';
  const rightCandidate = right.kind === 'yaml-candidate';
  if (leftCandidate !== rightCandidate) return leftCandidate ? 1 : -1;
  return left.kind.localeCompare(right.kind)
    || left.directory.localeCompare(right.directory)
    || left.record.path.localeCompare(right.record.path);
}

// Configuration coverage is deterministic and score-free. Each queue represents
// one configuration family in one directory area; round-robin selection prevents
// a large manifest directory from hiding smaller ecosystems elsewhere in a repo.
export function buildConfigurationPlan(records) {
  const queues = new Map();
  for (const record of records) {
    const kind = configurationKind(record);
    if (!kind) continue;
    const directory = configurationDirectory(record);
    const key = `${kind}\0${directory}`;
    const queue = queues.get(key) || [];
    queue.push({ record, kind, directory });
    queues.set(key, queue);
  }
  const orderedQueues = [...queues.values()]
    .map((queue) => queue.sort((left, right) => left.record.path.localeCompare(right.record.path)))
    .sort((left, right) => compareConfigurationEntries(left[0], right[0]));
  const ordered = [];
  for (let offset = 0; ; offset += 1) {
    let appended = false;
    for (const queue of orderedQueues) {
      if (offset < queue.length) {
        ordered.push(queue[offset]);
        appended = true;
      }
    }
    if (!appended) return ordered;
  }
}

// A YAML file outside the well-known directories counts as Kubernetes only when its content says so.
function resolveCandidateKind(kind, text) {
  if (kind !== 'yaml-candidate') return kind;
  return /^apiVersion:\s*\S+/m.test(text) && /^kind:\s*\S+/m.test(text) ? 'kubernetes' : null;
}

function parseByKind(kind, text) {
  switch (kind) {
    case 'package-json': return parsePackageJson(text);
    case 'pyproject': return parsePyproject(text);
    case 'go-mod': return parseGoMod(text);
    case 'cargo': return parseCargo(text);
    case 'maven': return parsePom(text);
    case 'gradle': return parseGradle(text);
    case 'dotnet': return parseCsproj(text);
    case 'dockerfile': return parseDockerfile(text);
    case 'docker-compose': return parseCompose(text);
    case 'kubernetes': return parseKubernetes(text);
    case 'terraform': return parseTerraform(text);
    case 'openapi': return parseOpenApi(text);
    case 'protobuf': return parseProto(text);
    case 'ci-workflow': return parseCiWorkflow(text);
    case 'gitlab-ci': return parseGitlabCi(text);
    case 'azure-pipeline': return parseAzurePipeline(text);
    case 'python-requirements': return parseRequirements(text);
    case 'pipfile': return parsePipfile(text);
    case 'setup-cfg': return parseSetupCfg(text);
    case 'conda-environment': return parseCondaEnvironment(text);
    case 'procfile': return parseProcfile(text);
    case 'pnpm-workspace': return parsePnpmWorkspace(text);
    case 'helm-chart': return parseHelmChart(text);
    default: return {};
  }
}

export function buildConfigurationLevel1(root, records, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const batch = Number(options.batch ?? 1);
  if (!Number.isSafeInteger(batch) || batch < 1) throw new Error('Level 1 batch must be a positive integer.');
  if (!Number.isSafeInteger(limits.maximumFiles) || limits.maximumFiles < 1) throw new Error('Level 1 maximumFiles must be a positive integer.');
  const all = buildConfigurationPlan(records);
  const totalBatches = Math.max(1, Math.ceil(all.length / limits.maximumFiles));
  const start = (batch - 1) * limits.maximumFiles;
  const page = all.slice(start, start + limits.maximumFiles);

  const parsed = [];
  const totals = { bytesRead: 0, unreadable: 0 };
  const candidateCounts = { inspected: 0, rejected: 0 };

  const read = (entry, remainingEntries) => {
    const remainingBytes = Math.max(0, limits.maximumTotalBytes - totals.bytesRead);
    // Reserve a fair share for every file in the page. This preserves the total
    // byte bound without silently dropping the tail of a configuration batch.
    const fairShare = Math.floor(remainingBytes / Math.max(1, remainingEntries));
    const bytes = Math.min(entry.record.size, limits.maximumBytesPerFile, fairShare);
    const descriptor = fs.openSync(path.join(root, ...entry.record.path.split('/')), 'r');
    try {
      const buffer = Buffer.allocUnsafe(bytes);
      const read = bytes ? fs.readSync(descriptor, buffer, 0, bytes, 0) : 0;
      totals.bytesRead += read;
      return { text: buffer.subarray(0, read).toString('utf8'), truncated: entry.record.size > bytes };
    } finally {
      fs.closeSync(descriptor);
    }
  };

  for (let index = 0; index < page.length; index += 1) {
    const entry = page[index];
    let content;
    try { content = read(entry, page.length - index); } catch { totals.unreadable += 1; continue; }
    if (entry.kind === 'yaml-candidate') candidateCounts.inspected += 1;
    const kind = resolveCandidateKind(entry.kind, content.text);
    if (!kind) {
      candidateCounts.rejected += 1;
      continue;
    }
    factLimitReached = false;
    const facts = parseByKind(kind, content.text);
    parsed.push({
      path: entry.record.path,
      module: entry.record.modulePath,
      kind,
      truncated: content.truncated,
      factsTruncated: factLimitReached,
      facts,
    });
  }

  parsed.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const cumulative = all.slice(0, Math.min(all.length, start + page.length));
  const coveredDirectories = new Set(cumulative.map((entry) => entry.directory));
  const coveredKinds = new Set(cumulative.map((entry) => entry.kind));
  const allDirectories = new Set(all.map((entry) => entry.directory));
  const allKinds = new Set(all.map((entry) => entry.kind));
  const nextBatch = batch < totalBatches ? batch + 1 : null;
  const boundarySummary = summarizeBoundaries(parsed);
  return {
    name: 'configuration-boundaries',
    sourceBodiesIncluded: false,
    batch,
    batchSize: limits.maximumFiles,
    totalBatches,
    candidateFiles: all.length,
    inspectedFiles: page.length,
    consideredFiles: parsed.length,
    parsedFiles: parsed.length,
    rejectedFiles: candidateCounts.rejected,
    skippedByLimit: 0,
    unreadable: totals.unreadable,
    bytesRead: totals.bytesRead,
    candidates: candidateCounts,
    limits,
    coverage: {
      surfaced: cumulative.length,
      total: all.length,
      complete: cumulative.length === all.length,
      directories: { covered: coveredDirectories.size, total: allDirectories.size },
      kinds: { covered: coveredKinds.size, total: allKinds.size },
      nextBatch,
    },
    boundaries: boundarySummary.boundaries,
    boundariesTruncated: boundarySummary.truncated,
    configurations: parsed,
  };
}

// Cross-file roll-up: the same facts regrouped by what an architecture diagram
// asks first — which services exist, what depends on what, where the runtime
// starts, what gets deployed, which APIs are exposed, and what CI gates run.
// Every item names the configuration it came from so it can be checked.
export function summarizeBoundaries(parsed) {
  const services = [];
  const dependencies = [];
  const entrypoints = [];
  const deployment = [];
  const apis = [];
  const ci = [];
  let truncated = false;
  const push = (list, item) => {
    if (list.length < MAX_FACT_ITEMS) list.push(item);
    else truncated = true;
  };
  for (const { path: file, kind, facts } of parsed) {
    switch (kind) {
      case 'package-json':
        if (facts.name) push(services, { name: facts.name, kind: 'node-package', source: file });
        for (const pattern of facts.workspaces || []) push(dependencies, { from: facts.name || file, to: pattern, relation: 'workspace', source: file });
        for (const [binary, target] of Object.entries(facts.binaries || {})) push(entrypoints, { name: binary, files: [target], kind: 'npm-bin', source: file });
        if (facts.main) push(entrypoints, { name: `${facts.name || file}:main`, files: [facts.main], kind: 'npm-main', source: file });
        for (const [script, files] of Object.entries(facts.entryScriptFiles || {})) push(entrypoints, { name: `${facts.name || file}:${script}`, files, kind: 'npm-script', source: file });
        break;
      case 'pyproject':
      case 'setup-cfg':
        if (facts.name) push(services, { name: facts.name, kind: 'python-project', source: file });
        for (const script of facts.scripts || []) push(entrypoints, { name: script, files: [], kind: 'console-script', source: file });
        break;
      case 'pipfile':
        for (const script of facts.scripts || []) push(entrypoints, { name: script, files: [], kind: 'pipenv-script', source: file });
        break;
      case 'conda-environment':
        if (facts.name) push(services, { name: facts.name, kind: 'conda-environment', source: file });
        break;
      case 'procfile':
        for (const [name, files] of Object.entries(facts.processes || {})) push(entrypoints, { name, files, kind: 'process', source: file });
        break;
      case 'pnpm-workspace':
        for (const pattern of facts.packages || []) push(dependencies, { from: file, to: pattern, relation: 'workspace', source: file });
        break;
      case 'go-mod':
        if (facts.module) push(services, { name: facts.module, kind: 'go-module', source: file });
        for (const target of facts.replaces || []) push(dependencies, { from: facts.module || file, to: target, relation: 'replace', source: file });
        break;
      case 'cargo':
        if (facts.name) push(services, { name: facts.name, kind: 'rust-package', source: file });
        for (const member of facts.workspaceMembers || []) push(dependencies, { from: facts.name || file, to: member, relation: 'workspace', source: file });
        break;
      case 'maven':
        if (facts.artifactId) push(services, { name: facts.artifactId, kind: 'maven-artifact', source: file });
        for (const module of facts.modules || []) push(dependencies, { from: facts.artifactId || file, to: module, relation: 'module', source: file });
        break;
      case 'gradle':
        for (const project of facts.includedProjects || []) push(dependencies, { from: file, to: project, relation: 'included-project', source: file });
        for (const project of (facts.dependencies || []).filter((value) => value.startsWith(':'))) push(dependencies, { from: file, to: project, relation: 'project', source: file });
        break;
      case 'dotnet':
        push(services, { name: path.posix.basename(file, path.posix.extname(file)), kind: 'dotnet-project', source: file });
        for (const reference of facts.projectReferences || []) push(dependencies, { from: file, to: reference, relation: 'project-reference', source: file });
        break;
      case 'dockerfile':
        push(deployment, { kind: 'container-image', name: file, baseImages: facts.baseImages, ports: facts.exposedPorts, source: file });
        if (facts.hasEntrypoint || facts.hasCommand) push(entrypoints, { name: file, files: [], kind: 'container-command', source: file });
        break;
      case 'docker-compose':
        for (const service of facts.services || []) {
          push(services, { name: service.name, kind: 'compose-service', image: service.image, build: service.build, source: file });
          for (const target of service.dependsOn || []) push(dependencies, { from: service.name, to: target, relation: 'depends_on', source: file });
        }
        break;
      case 'kubernetes':
        push(deployment, { kind: 'kubernetes', resources: facts.kinds, names: facts.names, images: facts.images, source: file });
        break;
      case 'helm-chart':
        push(deployment, { kind: 'helm-chart', name: facts.name, dependencies: facts.dependencies, source: file });
        break;
      case 'terraform':
        push(deployment, { kind: 'terraform', resources: facts.resources, modules: facts.modules, source: file });
        break;
      case 'openapi':
        push(apis, { kind: 'openapi', title: facts.title, paths: facts.paths, source: file });
        break;
      case 'protobuf':
        if ((facts.services || []).length) push(apis, { kind: 'grpc', package: facts.package, services: facts.services, rpcs: facts.rpcs, source: file });
        break;
      case 'ci-workflow':
      case 'gitlab-ci':
      case 'azure-pipeline':
        push(ci, { kind, jobs: facts.jobs || [], stages: facts.stages || [], source: file });
        break;
      default:
        break;
    }
  }
  return { boundaries: { services, dependencies, entrypoints, deployment, apis, ci }, truncated };
}
