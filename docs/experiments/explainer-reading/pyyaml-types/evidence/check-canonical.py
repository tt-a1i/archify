from pathlib import Path
import hashlib
import json
import yaml

root = Path(__file__).parent
case = Path('/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/pyyaml-types')
probe = json.loads((root / 'source/probe-1.json').read_text())
states = json.loads((root / 'canonical-browser.json').read_text())
for state in states:
    assert state['width'] == state['pageWidth']
    assert all(item['client'] == item['scroll'] for item in state['tables'] + state['code'])
    table = state['tables'][0]['rows']
    assert len(table) == 9
    for cells, observed in zip(table[1:], probe['scalars']):
        assert 'flag: ' + cells[0] + '\n' == observed['input']
        assert cells[1:] == [observed['repr'], observed['pythonType']]
        value = yaml.safe_load('flag: ' + cells[0])['flag']
        assert [repr(value), type(value).__name__] == cells[1:]
    if state['width'] == 1440:
        panels = {panel['id']: panel for panel in state['panels']}
        assert panels['results']['top'] == panels['reproduce']['top']
        for upper, lower in [('results', 'mechanism'), ('reproduce', 'keys')]:
            assert panels[lower]['top'] >= panels[upper]['top'] + panels[upper]['height']
assert (root / 'canonical-copied.py').read_bytes() == (root / 'candidate-2-copied.py').read_bytes()
print(json.dumps({
    'fourStatesTablesMatchAllEightProbeCases': True,
    'canonicalCodeMatchesExecutedCandidateBytes': True,
    'pageTablesAndCodeFitFourStates': True,
    'desktopTableCodeTopsAlignAndLowerPanelsDoNotOverlap': True,
    'canonicalHtmlSha256': hashlib.sha256((case / 'candidate.html').read_bytes()).hexdigest(),
}, indent=2))
