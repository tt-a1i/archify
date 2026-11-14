// Browser presentation and file handoff for the same receipt the CLI emits.
(function () {
  'use strict';
  var errors = {
    'invalid-task': 'Invalid task or mismatched task findings.',
    'wrong-task-findings': 'Invalid task or mismatched task findings.',
    'wrong-task-snapshot': 'The task does not match the previous analysis.',
    'invalid-checks': 'Invalid project check results.',
    'wrong-checks-snapshot': 'Check results do not match this task and analysis pair.',
  };
  var outcomes = {
    'not-detected': 'No longer detected', 'still-detected': 'Still detected',
    'evidence-changed': 'Evidence changed', inconclusive: 'Inconclusive',
  };
  var reports = {
    'same-bytes': 'Same report bytes; an external rerun is unproven.',
    'different-bytes': 'Different report bytes do not prove a fresh or equivalent external run.',
    unknown: 'External report identity could not be compared.',
  };
  var checkStates = { passed: 'Passed', failed: 'Failed', skipped: 'Skipped', 'not-run': 'Not run' };

  function append(parent, tag, text) {
    var el = document.createElement(tag);
    if (text) el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function render(preview, receipt, tr) {
    var analysis = receipt.analysis;
    append(preview, 'p', receipt.taskId + ' · ' + tr('Before') + ' ' + receipt.before.snapshotId.slice(0, 12)
      + ' · ' + tr('After') + ' ' + receipt.after.snapshotId.slice(0, 12));
    append(preview, 'h4', tr('Analysis observations'));
    append(preview, 'p', tr(analysis.comparable ? 'Comparable analysis runs.' : 'Limited analysis comparison.')
      + (analysis.reasons.length ? ' (' + analysis.reasons.join(', ') + ')' : ''));
    if (analysis.comparable) append(preview, 'p', tr('New findings across the captured scope: {count}', { count: analysis.newCount }));
    var list = append(preview, 'ul');
    analysis.selected.forEach(function (row) {
      var item = append(list, 'li', row.code + ' · ' + tr(outcomes[row.outcome]));
      if (row.outcome !== row.observed) append(item, 'div', tr('Observed: {outcome}', { outcome: tr(outcomes[row.observed]) }));
      if (row.limitation) append(item, 'div', row.limitation);
      if (row.externalReport) append(item, 'div', tr(reports[row.externalReport]));
    });
    append(preview, 'h4', tr('Project checks'));
    var checks = receipt.projectChecks.checks;
    append(preview, 'p', tr(checks.length
      ? 'Reported for this pair; Archify did not run or independently verify these checks.'
      : 'No project check results reported.'));
    if (checks.length) {
      var projectList = append(preview, 'ul');
      checks.forEach(function (check) { append(projectList, 'li', check.name + ' · ' + tr(checkStates[check.status])); });
    }
  }

  window.__archifyWireVerification = function (host, context, tr) {
    var details = host.querySelector('.verify-change');
    if (!context || !details) return;
    var form = details.querySelector('form'), status = details.querySelector('.verify-status');
    var preview = details.querySelector('.verify-preview'), template = details.querySelector('.verify-template');
    var download = details.querySelector('.verify-download'), input = details.querySelector('.verify-task');
    var checks = details.querySelector('.verify-checks');
    var result = null, revision = 0;
    function clear() {
      revision += 1;
      result = null;
      status.textContent = '';
      preview.replaceChildren();
      template.disabled = download.disabled = true;
    }
    async function read(file) {
      if (!file || file.size > 2 * 1024 * 1024) throw new Error(tr('Select a JSON file up to 2 MiB.'));
      try { return JSON.parse(await file.text()); }
      catch { throw new Error(tr('Could not read the selected JSON file.')); }
    }
    input.addEventListener('change', clear);
    checks.addEventListener('change', clear);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      clear();
      var ticket = revision;
      try {
        var files = await Promise.all([read(input.files[0]), checks.files.length ? read(checks.files[0]) : undefined]);
        if (revision !== ticket || !details.isConnected) return;
        var evaluated = window.__archifyEvaluateVerification(context, files[0], files[1]);
        if (evaluated.error) throw new Error(tr(errors[evaluated.error]));
        result = evaluated;
        render(preview, result.receipt, tr);
        template.disabled = download.disabled = false;
      } catch (error) {
        if (revision === ticket) status.textContent = error.message;
      }
    });
    template.addEventListener('click', function () {
      if (result) window.__archifyDownloadJson(result.checksTemplate, result.receipt.taskId + '.checks.json');
    });
    download.addEventListener('click', function () {
      if (result) window.__archifyDownloadJson(result.receipt, result.receipt.taskId + '.verification.json');
    });
  };

  window.__archifyDownloadJson = function (value, name) {
    var url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };
})();
