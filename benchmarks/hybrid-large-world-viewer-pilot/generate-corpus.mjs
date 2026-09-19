#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { largeAdaptiveWorkflow } from '../../archify/test/fixtures/large-adaptive-workflow.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.join(root, 'corpus');
const seed = 'archify-hybrid-large-world-v1';
const sizes = [30, 100, 300];

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digest(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

function workflow(size) {
  if (size === 30) return largeAdaptiveWorkflow();
  const columns = 6;
  const laneCount = Math.ceil(size / columns);
  const types = ['frontend', 'security', 'backend', 'database', 'cloud', 'messagebus'];
  const lanes = Array.from({ length: laneCount }, (_, lane) => ({
    id: `lane-${lane}`,
    label: `业务泳道 ${String(lane + 1).padStart(2, '0')} · 稳定职责边界`,
    ...(lane % 7 === 6 ? { variant: 'exception' } : {}),
  }));
  const nodes = Array.from({ length: size }, (_, index) => {
    const lane = Math.floor(index / columns);
    const col = index % columns;
    return {
      id: `w-${index}`,
      lane: `lane-${lane}`,
      col,
      type: types[lane % types.length],
      label: index % 5 === 0 ? `节点${index}负责跨模块一致性校验与完整证据交付` : `处理节点 ${index}`,
      sublabel: `lane ${lane + 1} · phase ${Math.floor(col / 2) + 1}`,
      width: 300,
      ...(index === 0 ? { tag: 'START' } : {}),
    };
  });
  const edges = [];
  for (let index = 0; index < size; index += 1) {
    const lane = Math.floor(index / columns);
    const col = index % columns;
    if (col < columns - 1 && index + 1 < size) {
      edges.push({ id: `w-h-${index}`, from: `w-${index}`, to: `w-${index + 1}`, role: lane === 0 ? 'main' : 'branch' });
    }
    if (index + columns < size) {
      edges.push({ id: `w-v-${index}`, from: `w-${index}`, to: `w-${index + columns}`, role: 'async' });
    }
  }
  edges.push({
    id: 'w-feedback',
    from: `w-${Math.floor((size - 1) / columns) * columns}`,
    to: 'w-0',
    role: 'error',
    variant: 'security',
    route: 'return-left',
  });
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: `Large-world Workflow ${size}`,
      subtitle: `${size} nodes · deterministic ${seed}`,
      output: `workflow-${size}.workflow.html`,
      locale: 'zh-CN',
      quality_profile: 'standard',
      visual_preset: 'blueprint',
      animation: 'none',
      views: [
        { id: 'readable-entry', label: '可读入口', focus: ['w-0'], note: '单节点入口必须达到 6px。' },
        { id: 'oversized-world', label: '完整大世界', focus: nodes.map(({ id }) => id), note: '完整性优先的超大目标。' },
      ],
    },
    lanes,
    phases: [
      { id: 'understand', label: '理解与约束', fromCol: 0, toCol: 1 },
      { id: 'decide', label: '判定与执行', fromCol: 2, toCol: 3 },
      { id: 'deliver', label: '交付与确认', fromCol: 4, toCol: 5 },
    ],
    mainPath: Array.from({ length: Math.min(columns, size) }, (_, index) => `w-${index}`),
    nodes,
    edges,
    cards: [
      { dot: 'cyan', title: 'Reader', items: ['固定阅读窗口', '完整 canonical world'] },
      { dot: 'emerald', title: 'Evidence', items: ['动态可读缩放', 'Reset 返回 Fit-all'] },
    ],
  };
}

function architecture(size) {
  const columns = size === 30 ? 5 : size === 100 ? 10 : size === 300 ? 30 : 40;
  const rows = Math.ceil(size / columns);
  const types = ['external', 'frontend', 'cloud', 'backend', 'database', 'security', 'messagebus'];
  const components = Array.from({ length: size }, (_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
      id: `a-${index}`,
      type: types[index % types.length],
      label: index % 5 === 0 ? `模块${index}承担跨边界服务编排与审计追踪职责` : `Module ${index}`,
      sublabel: `region ${Math.min(3, Math.floor(row * 4 / rows)) + 1}`,
      pos: size === 30 ? [180 + col * 320, 160 + row * 90] : [500 + col * 340, 500 + row * 130],
      size: [292, 64],
    };
  });
  const regions = Array.from({ length: 4 }, (_, region) => ({
    kind: 'region',
    label: `Region ${region + 1} · deterministic boundary`,
    wraps: components.filter((_, index) => Math.min(3, Math.floor(Math.floor(index / columns) * 4 / rows)) === region).map(({ id }) => id),
  })).filter(({ wraps }) => wraps.length);
  const connections = [];
  for (let index = 0; index < size; index += 1) {
    const col = index % columns;
    if (col < columns - 1 && index + 1 < size) connections.push({ id: `a-h-${index}`, from: `a-${index}`, to: `a-${index + 1}` });
    if (index + columns < size) connections.push({ id: `a-v-${index}`, from: `a-${index}`, to: `a-${index + columns}`, variant: 'dashed' });
  }
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: `Large-world Architecture ${size}`,
      subtitle: `${size} nodes · deterministic ${seed}`,
      output: `architecture-${size}.architecture.html`,
      quality_profile: 'standard',
      visual_preset: 'blueprint',
      animation: 'none',
      viewBox: size === 30
        ? [180 + (columns - 1) * 320 + 392, 160 + (rows - 1) * 90 + 200]
        : [500 + (columns - 1) * 340 + 700, 500 + (rows - 1) * 130 + 700],
      views: [
        { id: 'readable-entry', label: 'Readable entry', focus: ['a-0'], note: 'One complete readable node.' },
        { id: 'oversized-world', label: 'Whole system', focus: components.map(({ id }) => id), note: 'Completeness-first oversized target.' },
      ],
    },
    components,
    boundaries: regions,
    connections,
    cards: [
      { dot: 'cyan', title: 'Reader', items: ['Fixed reading viewport', 'Finite canonical world'] },
      { dot: 'emerald', title: 'Evidence', items: ['Readable local entry', 'Reset returns Fit-all'] },
    ],
  };
}

fs.mkdirSync(corpusRoot, { recursive: true });
const entries = [];
for (const type of ['workflow', 'architecture']) {
  for (const size of sizes) {
    const document = type === 'workflow' ? workflow(size) : architecture(size);
    const source = stableJson(document);
    const filename = `${type}-${size}.${type}.json`;
    fs.writeFileSync(path.join(corpusRoot, filename), source);
    const edges = type === 'workflow' ? document.edges : document.connections;
    entries.push({
      id: `${type}-${size}`,
      type,
      size,
      filename: `corpus/${filename}`,
      sourceSha256: digest(source),
      nodes: size,
      edges: edges.length,
      edgeDensity: edges.length / size,
      longLabelNodes: document[type === 'workflow' ? 'nodes' : 'components'].filter(({ label }) => [...label].length >= 12).length,
      regions: type === 'workflow' ? document.lanes.length : document.boundaries.length,
      validEntry: type === 'workflow' ? (size === 30 ? 'intake-0' : 'w-0') : 'a-0',
      oversizedGuidedTarget: type === 'workflow' && size === 30 ? 'all-nodes' : 'oversized-world',
      cards: Array.isArray(document.cards) ? document.cards.length : 0,
    });
  }
}

const manifest = {
  schemaVersion: 1,
  seed,
  generator: 'generate-corpus.mjs',
  entries,
  stress: [
    { id: 'workflow-1000', prerequisite: 'workflow-300 mandatory correctness and runtime gates', status: 'not-run: prerequisite-incomplete', generator: { type: 'workflow', size: 1000 } },
    { id: 'architecture-1000', prerequisite: 'architecture-300 mandatory correctness and runtime gates', status: 'not-run: prerequisite-incomplete', generator: { type: 'architecture', size: 1000 } },
  ],
};
fs.writeFileSync(path.join(root, 'manifest.json'), stableJson(manifest));
console.log(`generated ${entries.length} frozen corpus documents and manifest`);
