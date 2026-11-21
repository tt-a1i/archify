const vscode = require('vscode');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const normalize = (locations, root) => (locations || []).map(location => {
  const uri = location.targetUri || location.uri;
  const range = location.targetSelectionRange || location.targetRange || location.range;
  return { file: path.relative(root, uri.fsPath).replaceAll(path.sep, '/'), line: range.start.line + 1 };
});
const includesExpected = (row, locations) => {
  const target = row.archify.target;
  return locations.some(item => item.file === target.file
    && (row.category === 'include' || item.line === target.line));
};

exports.run = async () => {
  const root = process.env.ARCHIFY_FMT_ROOT;
  const database = process.env.ARCHIFY_FMT_CDB;
  const output = process.env.ARCHIFY_FMT_CPPTOOLS_OUTPUT;
  const input = JSON.parse(fs.readFileSync(process.env.ARCHIFY_FMT_COMPARISON, 'utf8'));
  const report = { referenceSourceCommit: input.sourceCommit, vscode: vscode.version,
    cpptools: null,
    selectedDatabaseSha256: createHash('sha256').update(fs.readFileSync(database)).digest('hex'),
    referenceDatabaseSha256: input.environment.selectedDatabaseSha256,
    contextPolicy: 'Opening a source before a header does not verify the header\'s active translation unit. Header results establish navigation-location agreement only.',
    samples: [], counts: { positiveExpectedIncluded: 0, positiveMissing: 0,
      confirmedContextPositiveIncluded: 0, confirmedContextPositiveMissing: 0,
      headerContextUnverified: 0, unresolvedWithDefinition: 0, unresolvedWithoutDefinition: 0 } };
  let subscription;
  try {
    const settings = vscode.workspace.getConfiguration('C_Cpp');
    await settings.update('default.compileCommands', database, vscode.ConfigurationTarget.Global);
    await settings.update('intelliSenseEngine', 'default', vscode.ConfigurationTarget.Global);
    await settings.update('intelliSenseCachePath', path.join(process.env.ARCHIFY_FMT_PROFILE, 'cpp-cache'), vscode.ConfigurationTarget.Global);
    await settings.update('default.browse.databaseFilename', path.join(process.env.ARCHIFY_FMT_PROFILE, 'browse.db'), vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension('ms-vscode.cpptools');
    if (!extension) throw Error('Microsoft C/C++ extension is unavailable');
    report.cpptools = extension.packageJSON.version;
    const api = await extension.activate();
    // This is the readiness hook used by the pinned official reference tests.
    const hook = api.getTestApi(1).getTestHook();
    const ready = new Set(), pending = new Map();
    subscription = hook.IntelliSenseStatusChanged(status => {
      if (status.status !== 4 || !status.filename) return; // Status.IntelliSenseReady
      for (const [file, resolve] of pending) {
        if (path.basename(file) === status.filename || file === status.filename) resolve();
      }
    });
    const open = async file => {
      if (ready.has(file)) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, file)));
        await vscode.window.showTextDocument(document);
        return { document, readiness: 'previously-ready-unchanged-document' };
      }
      let timer;
      const completed = new Promise((resolve, reject) => {
        pending.set(file, resolve);
        timer = setTimeout(() => reject(Error(`No IntelliSenseReady event for ${file}`)), 20000);
      });
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, file)));
        await vscode.window.showTextDocument(document);
        await completed;
        ready.add(file);
        return { document, readiness: 'IntelliSenseReady' };
      } finally { clearTimeout(timer); pending.delete(file); }
    };
    for (const row of input.samples) {
      await open(row.context);
      const { document, readiness } = await open(row.file);
      const contextStatus = row.file === row.context ? 'translation-unit-entry' : 'unverified-header-association';
      const position = new vscode.Position(row.position.line, row.position.character);
      const locations = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, position);
      if (!Array.isArray(locations)) throw Error(`No completed definition response for ${row.file}`);
      const actual = normalize(locations, root);
      const matched = row.category === 'unresolved-call' ? actual.length > 0 : includesExpected(row, actual);
      if (row.category === 'unresolved-call') report.counts[matched ? 'unresolvedWithDefinition' : 'unresolvedWithoutDefinition']++;
      else report.counts[matched ? 'positiveExpectedIncluded' : 'positiveMissing']++;
      if (contextStatus === 'unverified-header-association') report.counts.headerContextUnverified++;
      else if (row.category !== 'unresolved-call') report.counts[matched ? 'confirmedContextPositiveIncluded' : 'confirmedContextPositiveMissing']++;
      report.samples.push({ category: row.category, file: row.file, context: row.context,
        contextStatus, readiness, position: row.position, actual, attempts: 1 });
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
  } catch (failure) { report.fatalError = String(failure); }
  finally { subscription?.dispose(); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
  if (report.fatalError) throw Error(report.fatalError);
};
