import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('./SourceBindings.java', import.meta.url));
const HEADER = 'file\tline\tcolumn\tendLine\tendColumn\tkind\towner\tmethod\ttargetFile\ttargetLine\ttargetColumn\ttext';
const position = call => [call.file, call.line, call.column, call.endLine, call.endColumn].join(':');

function readBindings(file, callers) {
  const [header, ...lines] = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
  if (header !== HEADER) throw new Error('invalid-output');
  const bindings = new Map();
  for (const line of lines) {
    const columns = line.split('\t');
    if (columns.length !== 12) throw new Error('invalid-output');
    const [source, startLine, startColumn, endLine, endColumn, kind, owner, method, targetFile, targetLine, targetColumn] = columns;
    const row = { file: source, line: Number(startLine), column: Number(startColumn), endLine: Number(endLine),
      endColumn: Number(endColumn), kind, owner, method, targetFile, targetLine: Number(targetLine), targetColumn: Number(targetColumn) };
    const key = position(row);
    if (bindings.has(key)) throw new Error('duplicate-binding');
    bindings.set(key, row);
  }
  if (callers.some(call => !bindings.has(position(call)))) throw new Error('inventory-mismatch');
  return bindings;
}

// The JDK sees a temporary copy of the captured sources, with no project
// directory, source path, classpath, annotation processors or build execution.
// Maven source-set and declared direct-dependency evidence determines each
// compiler group and remains a separate guard on every emitted target.
export function enrichCallsWithJdk(units, projects, capturedFiles, release) {
  const command = process.env.ARCHIFY_JAVA || 'java';
  const sorted = [...units].sort((a, b) => a.file.localeCompare(b.file));
  const sourceTexts = new Map(capturedFiles.map(file => [file.path, file.sourceText]));
  const files = sorted.map(unit => unit.file);
  const groups = new Map();
  for (const unit of sorted) {
    const visible = files.filter(file => projects.evidence(unit.file, [{ file }]) !== null);
    const key = visible.join('\0');
    if (!groups.has(key)) groups.set(key, { files: visible, callers: [] });
    groups.get(key).callers.push(unit);
  }
  const targets = new Map();
  for (const unit of units) for (const [items, declarationOnly] of [[unit.functions, false], [unit.methodDeclarations, true]]) {
    for (const item of items) {
      const key = `${item.file}:${item.sourceRange.line}:${item.sourceRange.column}:${item.name}`;
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push({ item, declarationOnly });
    }
  }
  const result = { mode: 'unavailable', version: null, release, analyzedFiles: 0, groups: groups.size, failedGroups: [],
    newTargets: 0, correctedTargets: 0, rejectedTargets: 0, declarationOnlyTargets: 0 };
  // A lexical candidate from a different captured build module still needs
  // project evidence, even when the optional compiler cannot run.
  for (const unit of units) for (const call of unit.calls) if (call.target) {
    const evidence = projects.evidence(call.file, [{ file: call.target.file || call.file }]);
    if (evidence === null) {
      result.rejectedTargets += 1;
      delete call.target; delete call.buildEvidence; delete call.qualifierAncestry;
      call.resolution = 'unresolved'; call.reason = 'java-compiler-build-scope';
    } else if (evidence.length) call.buildEvidence = evidence;
  }
  if (!groups.size) return result;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-java-bindings-'));
  try {
    const sourceRoot = path.join(temporary, 'sources');
    for (const unit of sorted) {
      const destination = path.resolve(sourceRoot, unit.file);
      if (!destination.startsWith(sourceRoot + path.sep)) throw new Error('captured source path escaped temporary snapshot');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, sourceTexts.get(unit.file), 'utf8');
    }
    const environment = { ...process.env, CLASSPATH: '' };
    delete environment.JAVA_TOOL_OPTIONS;
    delete environment._JAVA_OPTIONS;
    delete environment.JDK_JAVA_OPTIONS;
    const deadline = Date.now() + 120000;
    let index = 0;
    for (const group of groups.values()) {
      if (Date.now() >= deadline) {
        result.failedGroups.push({ exampleFile: group.callers[0].file, reason: 'time-budget' });
        continue;
      }
      const manifest = path.join(temporary, `${index}.files`);
      const output = path.join(temporary, `${index}.tsv`);
      index += 1;
      fs.writeFileSync(manifest, group.files.map(file => Buffer.from(file, 'utf8').toString('base64')).join('\n') + '\n');
      const run = spawnSync(command, [HELPER, '--files', sourceRoot, manifest, output, ...(release === null ? [] : [String(release)])], {
        cwd: temporary, env: environment, encoding: 'utf8', timeout: Math.max(1, Math.min(60000, deadline - Date.now())), maxBuffer: 16 * 1024 * 1024,
      });
      let bindings;
      try {
        if (run.error || run.status !== 0) throw new Error(run.error?.code === 'ENOENT' ? 'jdk-unavailable'
          : run.error?.code === 'ETIMEDOUT' ? 'timeout' : 'compiler-error');
        bindings = readBindings(output, group.callers.flatMap(unit => unit.calls));
      } catch (error) {
        result.failedGroups.push({ exampleFile: group.callers[0].file, reason: error.message });
        continue;
      }
      result.version = run.stdout.match(/\bjdk=([^\s]+)/)?.[1] || result.version;
      result.analyzedFiles += group.callers.length;
      for (const unit of group.callers) for (const call of unit.calls) {
        const row = bindings.get(position(call));
        const evidence = row.targetFile ? projects.evidence(call.file, [{ file: row.targetFile }]) : null;
        const candidates = row.targetFile && evidence !== null
          ? targets.get(`${row.targetFile}:${row.targetLine}:${row.targetColumn}:${row.method}`) || [] : [];
        if (row.targetFile && evidence === null) {
          if (call.target) result.rejectedTargets += 1;
          delete call.target; delete call.buildEvidence; delete call.qualifierAncestry;
          call.resolution = 'unresolved'; call.reason = 'java-compiler-build-scope';
          continue;
        }
        if (candidates.length !== 1) {
          if (call.target) {
            result.rejectedTargets += 1;
            delete call.target; delete call.buildEvidence; delete call.qualifierAncestry;
            call.resolution = 'unresolved'; call.reason = 'java-compiler-conflict';
          }
          continue;
        }
        const { item: fn, declarationOnly } = candidates[0];
        if (declarationOnly) result.declarationOnlyTargets += 1;
        const target = { file: fn.file, name: fn.name,
          line: fn.sourceRange.line, column: fn.sourceRange.column };
        const same = call.target && (call.target.file || call.file) === target.file
          && call.target.name === target.name && call.target.line === target.line && call.target.column === target.column;
        if (same) {
          if (evidence.length) call.buildEvidence = evidence;
          continue;
        }
        if (call.target) result.correctedTargets += 1;
        else result.newTargets += 1;
        call.resolution = 'java-compiler-source-method';
        call.target = target;
        if (evidence.length) call.buildEvidence = evidence;
        else delete call.buildEvidence;
        delete call.qualifierAncestry;
        delete call.reason;
      }
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  result.mode = result.analyzedFiles === 0 ? 'unavailable' : result.failedGroups.length ? 'partial' : 'complete';
  return result;
}
