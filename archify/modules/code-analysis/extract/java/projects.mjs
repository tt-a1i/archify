// Declared, direct Maven project source evidence. No Maven, plugins, profiles,
// artifact resolution or upstream code is executed.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { fail } from '../shared/diagnostics.mjs';
import { JAVA_BUILD_MARKERS } from '../shared/files.mjs';

const NS = 'http://maven.apache.org/POM/4.0.0';
const elements = node => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
const children = (node, name) => elements(node).filter(n => n.localName === name && ['', NS].includes(n.namespaceURI || ''));
function one(node, name) {
  const found = children(node, name);
  if (found.length > 1) throw new Error('duplicate ' + name);
  return found[0];
}
function scalar(node, name) {
  const child = one(node, name);
  if (!child) return null;
  if (elements(child).length) throw new Error('non-scalar ' + name);
  return child.textContent.trim();
}
const point = (file, node) => ({ file, line: node?.lineNumber || 1, column: node?.columnNumber || 1 });
function properties(node) {
  const result = Object.create(null);
  for (const child of elements(one(node, 'properties'))) {
    if (Object.hasOwn(result, child.localName) || elements(child).length) throw new Error('ambiguous property');
    result[child.localName] = child.textContent.trim();
  }
  return result;
}
const fields = ['groupId', 'artifactId', 'version', 'type', 'classifier', 'scope'];
const coordinate = d => [d.groupId, d.artifactId, d.version].join(':');
const depKey = d => [d.groupId, d.artifactId, d.type || 'jar', d.classifier || ''].join(':');
function dependencies(node, file) {
  return children(one(node, 'dependencies'), 'dependency').map(child =>
    ({ ...Object.fromEntries(fields.map(name => [name, scalar(child, name)])), point: point(file, child) }));
}
function local(file, relative) {
  if (!relative || relative.includes('\\') || path.posix.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) return null;
  const name = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative));
  return name === '..' || name.startsWith('../') ? null : name;
}
function expand(value, props) {
  if (value === null || value === undefined) return value;
  const visit = (text, seen) => text.replace(/\$\{([^}]+)\}/g, (whole, key) => {
    if (seen.has(key) || !Object.hasOwn(props, key)) return whole;
    return visit(props[key], new Set([...seen, key]));
  });
  const result = visit(value, new Set());
  return result.includes('$' + '{') ? null : result;
}
function mergeDeps(parent, own) {
  const result = new Map(parent.map(d => [depKey(d), d]));
  const seen = new Set();
  for (const item of own) {
    const key = depKey(item);
    if (seen.has(key)) throw new Error('duplicate dependency ' + key);
    seen.add(key);
    const previous = result.get(key) || {};
    result.set(key, { ...previous, ...Object.fromEntries(Object.entries(item).filter(([,v]) => v !== null)) });
  }
  return [...result.values()];
}

export function projectScope(contents, packageMarkers) {
  const raw = new Map(), effective = new Map(), used = new Map(), problems = [];
  const markers = packageMarkers.filter(file => JAVA_BUILD_MARKERS.includes(path.posix.basename(file)));
  const roots = markers.map(file => ({ file, root: path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file) + '/' }))
    .sort((a,b) => b.root.length - a.root.length || a.file.localeCompare(b.file));
  const owner = file => roots.find(entry => file.startsWith(entry.root));
  function read(file) {
    if (raw.has(file)) return raw.get(file);
    raw.set(file, null);
    const bytes = contents.get(file);
    if (!bytes) { problems.push({ file, reason: 'parent-or-project-not-captured' }); return null; }
    let sourceText;
    try { sourceText = new TextDecoder('utf-8', { fatal:true, ignoreBOM:true }).decode(bytes); }
    catch { fail('extract/java-metadata-encoding','Captured Maven metadata must be UTF-8.',{ subject:{file}, supportedFixes:['convert this POM to UTF-8 or exclude it from the source-only capture'] }); }
    used.set(file, { file, sourceText, sha256: createHash('sha256').update(bytes).digest('hex') });
    try {
      if (/<!DOCTYPE|<!ENTITY/i.test(sourceText)) throw new Error('DTD/entity declarations are not modeled');
      const document = new DOMParser({ locator: true, onError(level, message) { throw new Error(message); } })
        .parseFromString(sourceText.replace(/^\uFEFF/, ' '), 'application/xml');
      const node = document.documentElement;
      if (node.localName !== 'project' || !['', NS].includes(node.namespaceURI || '')) throw new Error('not a Maven project');
      const parent = one(node, 'parent');
      const result = { file, point: point(file,node), groupId: scalar(node,'groupId'), artifactId: scalar(node,'artifactId'),
        version: scalar(node,'version'), packaging: scalar(node,'packaging') || 'jar', props: properties(node),
        parent: parent && { groupId: scalar(parent,'groupId'), artifactId: scalar(parent,'artifactId'), version: scalar(parent,'version'),
          path: scalar(parent,'relativePath') ?? '../pom.xml' },
        deps: dependencies(node,file), management: dependencies(one(node,'dependencyManagement'),file),
        modules: children(one(node,'modules'),'module').map(n => n.textContent.trim()),
        profiles: children(one(node,'profiles'),'profile'),
        customLayout: Boolean(one(one(node,'build'),'sourceDirectory') || one(one(node,'build'),'testSourceDirectory')) };
      raw.set(file,result); return result;
    } catch (error) { problems.push({ file, reason: 'unsupported-or-invalid-pom', detail: error.message }); return null; }
  }
  function model(file) {
    if (effective.has(file)) return effective.get(file);
    effective.set(file,null);
    const pom = read(file); if (!pom) return null;
    try {
      const parentFile = pom.parent && local(file,pom.parent.path);
      const parent = pom.parent && parentFile ? model(parentFile) : null;
      if (pom.parent && (!parent || coordinate(parent) !== coordinate(pom.parent))) throw new Error('parent identity unavailable or mismatched');
      const props = { ...(parent?.props || {}), ...pom.props };
      const groupId = pom.groupId || parent?.groupId, version = pom.version || parent?.version;
      if (!groupId || !version || !pom.artifactId || [groupId,version,pom.artifactId].some(v => v.includes('$' + '{'))) throw new Error('project coordinates not literal');
      Object.assign(props, { 'project.groupId':groupId,'project.artifactId':pom.artifactId,'project.version':version,
        'pom.groupId':groupId,'pom.artifactId':pom.artifactId,'pom.version':version });
      const deps = mergeDeps(parent?.rawDependencies || [],pom.deps);
      const management = mergeDeps(parent?.rawManagement || [],pom.management);
      if (management.some(d => d.type==='pom' && d.scope==='import')) throw new Error('imported BOM management is not resolved');
      let critical = JSON.stringify([deps,management,groupId,version]);
      const referenced = new Set();
      for (let previous; previous !== critical;) {
        previous = critical;
        for (const [,key] of previous.matchAll(/\$\{([^}]+)\}/g)) if (!referenced.has(key)) {
          referenced.add(key); if (Object.hasOwn(props,key)) critical += props[key];
        }
      }
      const conditionalProperties=[...(parent?.conditionalProperties || []),...pom.profiles.flatMap(profile=>Object.keys(properties(profile)))];
      const conditional = pom.profiles.some(profile => one(profile,'dependencies') || one(profile,'dependencyManagement') || one(profile,'modules')
        || one(one(profile,'build'),'sourceDirectory') || one(one(profile,'build'),'testSourceDirectory'));
      if (conditional || conditionalProperties.some(key=>referenced.has(key)) || pom.customLayout) throw new Error('conditional dependencies or custom source layout');
      const resolvedManagement = management.map(d => Object.fromEntries(Object.entries(d).map(([k,v]) => [k,typeof v === 'string' ? expand(v,props) : v])));
      const resolved = deps.map(d => {
        const expanded = Object.fromEntries(Object.entries(d).map(([k,v]) => [k,typeof v === 'string' ? expand(v,props) : v]));
        const managed = resolvedManagement.find(m => depKey(m) === depKey(expanded)) || {};
        return { ...managed, ...Object.fromEntries(Object.entries(expanded).filter(([,v]) => v !== null)) };
      });
      const result = { file, groupId, artifactId:pom.artifactId, version, packaging:pom.packaging, props,
        chain:[file,...(parent?.chain || [])], rawDependencies:deps, rawManagement:management, dependencies:resolved,
        modules:pom.modules, conditionalProperties, profileIds:pom.profiles.map(p => scalar(p,'id')) };
      for (const d of resolved) if (!d.groupId || !d.artifactId || !d.version) problems.push({file,reason:'dependency-coordinates-unresolved',artifactId:d.artifactId || null});
      effective.set(file,result); return result;
    } catch (error) { problems.push({file,reason:'project-model-unavailable',detail:error.message}); return null; }
  }
  for (const marker of markers) {
    if (path.posix.basename(marker)==='pom.xml') model(marker);
    else problems.push({file:marker,reason:'unmodeled-gradle-build'});
  }
  const projects = [...effective.values()].filter(Boolean);
  const byCoordinate = new Map();
  for (const p of projects) {
    const key = coordinate(p); if (!byCoordinate.has(key)) byCoordinate.set(key,[]);
    byCoordinate.get(key).push(p);
  }
  function inReactor(from,to) {
    return from.chain.some(file => to.chain.includes(file) && (() => {
      const aggregator=read(file);
      const members=aggregator?.modules.map(name => local(file,name.endsWith('.xml') || name.endsWith('.pom') ? name : name+'/pom.xml')) || [];
      return (file===from.file || members.includes(from.file)) && (file===to.file || members.includes(to.file));
    })());
  }
  function sourceSet(file,root) {
    const relative=file.slice(root.length);
    return relative.startsWith('src/main/java/') ? 'main' : relative.startsWith('src/test/java/') ? 'test' : null;
  }
  return {
    evidence(caller,points) {
      const own=owner(caller);
      if (points.every(p => owner(p.file)?.root === own?.root)) return [];
      const from=own?.file.endsWith('/pom.xml') || own?.file==='pom.xml' ? model(own.file) : null;
      const callerSet=own && sourceSet(caller,own.root);
      if (!from || !callerSet) return null;
      const evidence = new Map();
      for (const target of points) {
        const targetRoot=owner(target.file); if (targetRoot?.root===own.root) continue;
        const to=targetRoot && model(targetRoot.file), targetSet=targetRoot && sourceSet(target.file,targetRoot.root);
        if (!to || to.packaging!=='jar' || !targetSet || !inReactor(from,to)) return null;
        const candidates=(byCoordinate.get(coordinate(to)) || []).filter(p=>inReactor(from,p));
        if (candidates.length!==1 || candidates[0].file!==to.file) return null;
        const matches=from.dependencies.filter(d => coordinate(d)===coordinate(to) &&
          (callerSet==='test' ? ['compile','provided','runtime','test'].includes(d.scope || 'compile') : ['compile','provided'].includes(d.scope || 'compile')) &&
          (targetSet==='main' ? (d.type || 'jar')==='jar' && !d.classifier : d.type==='test-jar' && (!d.classifier || d.classifier==='tests')));
        if (matches.length!==1) return null;
        for (const file of [...from.chain,...to.chain]) evidence.set(file,read(file).point);
      }
      return [...evidence.values()];
    },
    get scope() {
      return { language:'java', build:{model:'maven-declared-direct-projects-v1',execution:'none',dependencyDepth:1,
        properties:'captured-defaults-only',profiles:'not-executed',sourceLayouts:['src/main/java','src/test/java']},
        metadata:[...used.values()].sort((a,b)=>a.file.localeCompare(b.file)),
        projects:projects.map(p=>({file:p.file,groupId:p.groupId,artifactId:p.artifactId,version:p.version,packaging:p.packaging,
          parents:p.chain.slice(1),profiles:p.profileIds,dependencies:p.dependencies})),
        unknowns:problems, limitations:[
          'Declared direct jar/test-jar source candidates only, with unique captured coordinates and a shared literal reactor declaration. No Maven/Gradle execution, artifact resolution or complete classpath proof.',
          'Only conventional main/test source layouts and captured default properties are used. Relevant profiles, unresolved or unavailable parents/properties, duplicate coordinates and Gradle configurations cannot grant cross-project targets.',
          'New inputs and profile/CLI/settings/plugin activation outside the recorded metadata are not re-resolved. Existing no-parent/global source candidates retain their earlier contract; new dependency evidence does not rebind historical captures or establish runtime loading, argument applicability or complete impact.',
        ] };
    },
  };
}
