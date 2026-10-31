import { createHash } from 'node:crypto';

export const MAPPING_SHA256 = 'e04fea9bb1b29fce4926311c6101ad12d8d8d98efaa5eb2f0659a4828557b4cf';
export const ORIGIN_COMMIT = 'dcedd53856b82d3e403a9651dca0e15840496942';
export const ORIGIN_PATH = 'experiments/task-review-map/output/complete/mapping.json';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = message => { throw new Error(message); };
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,49}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 300 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
function keys(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) reject(`Unsupported ${label} fields`);
}

// This is a projector of one frozen report, not another Git/ref verifier.
export function project(mappingBytes, sidecar) {
  if (sha256(mappingBytes) !== MAPPING_SHA256) reject('Frozen mapping digest mismatch; references are not reverified here');
  const mapping = JSON.parse(mappingBytes.toString('utf8'));
  if (mapping.testExecution !== 'not-run') reject('Only the frozen not-run mapping is supported');
  const nodes = new Map(mapping.nodes.map(node => [node.id, node]));
  const node = nodeId => {
    const value = nodes.get(nodeId);
    if (!value) reject(`Unknown node: ${nodeId}`);
    if (value.status !== 'reference-matches' || !value.ref || typeof value.excerpt !== 'string') reject(`Unavailable reference: ${nodeId}`);
    return value;
  };
  keys(sidecar, ['version', 'author', 'knownTests', 'flows'], 'sidecar');
  if (sidecar.version !== 1 || !text(sidecar.author)) reject('Expected version 1 and a statement author');
  if (!Array.isArray(sidecar.knownTests) || sidecar.knownTests.length > 20 || new Set(sidecar.knownTests).size !== sidecar.knownTests.length) reject('Expected unique known test node IDs');
  sidecar.knownTests.forEach(node);
  if (sidecar.knownTests.length !== 1 || sidecar.knownTests[0] !== 'regression') reject('Frozen fixture has exactly one known test: regression');
  if (!Array.isArray(sidecar.flows) || !sidecar.flows.length || sidecar.flows.length > 4) reject('Expected 1–4 bounded flows');
  const ids = new Set();
  const flows = sidecar.flows.map(flow => {
    keys(flow, ['id', 'title', 'scope', 'synthetic', 'path', 'details', 'testLinks'], 'flow');
    if (!id(flow.id) || ids.has(flow.id) || !text(flow.title) || !text(flow.scope)) reject('Invalid or duplicate flow identity');
    ids.add(flow.id);
    if (flow.synthetic !== undefined && typeof flow.synthetic !== 'boolean') reject('synthetic must be boolean');
    if (!Array.isArray(flow.path) || !flow.path.length || flow.path.length > 20 || new Set(flow.path).size !== flow.path.length) reject('Expected 1–20 unique step nodes');
    if (!Array.isArray(flow.details) || flow.details.length !== flow.path.length || !flow.details.every(text)) reject('Each step needs one authored detail');
    flow.path.forEach(step => { node(step); if (!['guard', 'report'].includes(step)) reject('Only guard/report are behavior steps in this frozen fixture'); });
    // A claimed walk must use an existing directed declaration; it is not a trace.
    for (let i = 1; i < flow.path.length; i++) {
      if (!mapping.edges.some(edge => edge.from === flow.path[i - 1] && edge.to === flow.path[i])) reject('Path has no declared directed relationship');
    }
    if (!Array.isArray(flow.testLinks) || flow.testLinks.length > 30) reject('Expected bounded testLinks');
    const links = new Set();
    for (const link of flow.testLinks) {
      keys(link, ['test', 'step', 'why'], 'test link');
      node(link.test); node(link.step);
      if (!sidecar.knownTests.includes(link.test) || !flow.path.includes(link.step) || !text(link.why)) reject('Test link must name a known test and a step in this flow');
      const key = `${link.test}:${link.step}`;
      if (links.has(key)) reject('Duplicate test association');
      links.add(key);
    }
    return { id: flow.id, title: flow.title, scope: flow.scope, synthetic: flow.synthetic === true,
      steps: flow.path.map((step, i) => ({ node: step, detail: flow.details[i],
        tests: flow.testLinks.filter(link => link.step === step).map(link => ({ ...link, execution: 'not-run', referenceStatus: node(link.test).status })) })),
      unassignedTests: sidecar.knownTests.filter(test => !flow.testLinks.some(link => link.test === test)) };
  });
  return { version: 1, kind: 'authored-flow-test-projection', mappingSha256: MAPPING_SHA256,
    mappingOrigin: { commit: ORIGIN_COMMIT, path: ORIGIN_PATH }, sidecarSha256: sha256(JSON.stringify(sidecar)),
    author: sidecar.author, repository: mapping.repository, base: mapping.base, head: mapping.head,
    testExecution: mapping.testExecution,
    meaning: 'Paths and test associations are authored statements. Matching references do not prove semantic correctness, execution or test coverage.',
    knownTests: sidecar.knownTests, flows };
}

const prose = (id, value) => ({ id, type: 'prose', text: value });
const literal = value => String(value).replace(/[\\`*_\[\]<>]/g, '\\$&');
export function toExplainer(mappingBytes, sidecar) {
  const projection = project(mappingBytes, sidecar);
  const mapping = JSON.parse(mappingBytes.toString('utf8'));
  const byId = new Map(mapping.nodes.map(node => [node.id, node]));
  const stepIds = [...new Set(projection.flows.flatMap(flow => flow.steps.map(step => step.node)))];
  const usedIds = [...new Set(stepIds.concat(projection.knownTests))];
  const sourceUrl = node => `${mapping.repository}/blob/${mapping[node.ref.side]}/${node.ref.path}#L${node.ref.start}-L${node.ref.end}`;
  const diagram = { schema_version: 1, diagram_type: 'architecture',
    meta: { title: '同一组变更节点', output: 'change-path.html', locale: 'zh-CN', quality_profile: 'showcase', repository: { url: mapping.repository, revision: mapping.head } },
    components: stepIds.map((nodeId, i) => {
      const n = byId.get(nodeId);
      return { id: n.id, type: 'backend', label: n.label, sublabel: '作者声明 · 非运行轨迹', pos: [40 + i * 390, 50], size: [240, 90],
        sources: [{ path: n.ref.path, line: n.ref.start, end_line: n.ref.end, label: '固定 head 源码' }] };
    }), connections: mapping.edges.filter(edge => stepIds.includes(edge.from) && stepIds.includes(edge.to)).map(edge => ({ ...edge })) };
  const flowBlocks = [];
  for (const flow of projection.flows) {
    flowBlocks.push(prose(`${flow.id}-scope`, `**${literal(flow.title)}**。${flow.synthetic ? '合成对照。' : ''}${literal(flow.scope)}。`));
    flowBlocks.push({ id: `${flow.id}-steps`, type: 'steps', items: flow.steps.map((step, index) => ({
      id: `${flow.id}-step-${index}`, text: literal(byId.get(step.node).label),
      detail: `${literal(step.detail)} ${step.tests.length ? step.tests.map(test => `声明关联：[${literal(byId.get(test.test).label)}](block:source-${test.test})；未执行。${literal(test.why)}`).join(' ') : '此步骤未声明测试关联。'}`,
      target: { diagram: 'change-path', node: step.node } })) });
    flowBlocks.push(prose(`${flow.id}-unassigned`, flow.unassignedTests.length
      ? `本路径未分配的已知测试：${flow.unassignedTests.map(test => `[${literal(byId.get(test).label)}](block:source-${test})`).join('、')}。未分配不等于没有测试。`
      : '本路径的已知测试均有声明关联；未执行，不表示测试覆盖完整。'));
  }
  const sources = usedIds.map(nodeId => { const n = byId.get(nodeId); return { id: `ref-${n.id}`, title: `${n.label} · ${n.ref.path}:${n.ref.start}–${n.ref.end}`, url: sourceUrl(n) }; });
  return { schema_version: 1, diagram_type: 'explainer', meta: { id: 'task-flow-tests', title: '这条改动路径，关联了哪个测试？', locale: 'zh-CN' },
    answer: { summary: '逐步对照测试关联声明；所列历史测试未执行。', reasons: [`${projection.flows.length} 条声明路径复用同一份固定 Git 映射。`, '步骤、测试关联与未分配测试分开呈现。', '引用吻合只说明代码指针吻合。'], scope: '固定历史提交 · 作者编写路径 · 非运行轨迹' },
    panels: [{ id: 'paths', title: '沿同一张图比较路径与测试声明', span: 12, blocks: [
      { id: 'scope-warning', type: 'callout', level: 'warning', title: '声明关联，未执行', text: '路径与关联由实验作者编写。源码引用吻合不证明代码正确或测试通过。正常路径未分配回归测试，不表示它没有测试。' },
      { id: 'change-path', type: 'diagram', diagramType: 'architecture', spec: diagram,
        nodeBlocks: Object.fromEntries(stepIds.map(id => [id, `why-${id}`])) }, ...flowBlocks] },
    ...usedIds.map(nodeId => { const n = byId.get(nodeId); return { id: `node-${n.id}`, title: n.label, span: 12, blocks: [
      prose(`why-${n.id}`, literal(n.why)),
      prose(`citation-${n.id}`, `[固定源码位置](source:ref-${n.id})。复用原映射的引用吻合结果，本轮未重做 Git 核对。${projection.knownTests.includes(n.id) ? '测试源码，不是执行结果。' : ''}`),
      { id: `source-${n.id}`, type: 'snippet', title: `${n.ref.side} · L${n.ref.start}–L${n.ref.end} · 原映射摘录`, language: 'js', text: n.excerpt }
    ] }; })], sources };
}
