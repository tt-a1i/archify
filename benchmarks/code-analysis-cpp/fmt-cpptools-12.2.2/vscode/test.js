const vscode = require('vscode');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    samples: [], counts: { positiveExpectedIncluded: 0, positiveMissing: 0,
      unresolvedWithDefinition: 0, unresolvedWithoutDefinition: 0 } };
  try {
    const settings = vscode.workspace.getConfiguration('C_Cpp');
    await settings.update('default.compileCommands', database, vscode.ConfigurationTarget.Global);
    await settings.update('intelliSenseEngine', 'default', vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension('ms-vscode.cpptools');
    if (!extension) throw Error('Microsoft C/C++ extension is unavailable');
    report.cpptools = extension.packageJSON.version;
    await extension.activate();
    for (const row of input.samples) {
      const context = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, row.context)));
      await vscode.window.showTextDocument(context);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, row.file)));
      await vscode.window.showTextDocument(document);
      const position = new vscode.Position(row.position.line, row.position.character);
      let actual = [], attempts = 0, error = null;
      for (attempts = 1; attempts <= 8; attempts++) {
        try {
          actual = normalize(await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, position), root);
          error = null;
          if (row.category === 'unresolved-call' ? actual.length : includesExpected(row, actual)) break;
        } catch (failure) { error = String(failure); }
        await delay(500);
      }
      const matched = row.category === 'unresolved-call' ? actual.length > 0 : includesExpected(row, actual);
      if (row.category === 'unresolved-call') report.counts[matched ? 'unresolvedWithDefinition' : 'unresolvedWithoutDefinition']++;
      else report.counts[matched ? 'positiveExpectedIncluded' : 'positiveMissing']++;
      report.samples.push({ category: row.category, file: row.file, context: row.context,
        position: row.position, actual, attempts, ...(error ? { error } : {}) });
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
  } catch (failure) { report.fatalError = String(failure); }
  finally { fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
  if (report.fatalError) throw Error(report.fatalError);
};
