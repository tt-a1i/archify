import assert from 'node:assert/strict';
import test from 'node:test';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

// Historical first draft: a constrained long rejection branch crosses a drop
// branch under the default port ordering. All source constraints must survive.
const fixture = {
  "schema_version": 2,
  "diagram_type": "workflow",
  "meta": {
    "title": "退货处理流程",
    "locale": "zh-CN",
    "quality_profile": "showcase",
    "output": "diagram.html"
  },
  "lanes": [
    {
      "id": "intake",
      "label": "申请与资格"
    },
    {
      "id": "parcel",
      "label": "包裹处理"
    },
    {
      "id": "outcome",
      "label": "检验与结果",
      "variant": "exception"
    }
  ],
  "mainPath": [
    "return_request",
    "eligibility_check",
    "receive_parcel",
    "inspect",
    "refund"
  ],
  "nodes": [
    {
      "id": "return_request",
      "lane": "intake",
      "col": 0,
      "type": "external",
      "label": "Return Request",
      "sublabel": "提交退货申请",
      "icon": "person"
    },
    {
      "id": "eligibility_check",
      "lane": "intake",
      "col": 2,
      "type": "security",
      "label": "Eligibility Check",
      "sublabel": "判断退货资格",
      "icon": "decision"
    },
    {
      "id": "reject",
      "lane": "outcome",
      "col": 4,
      "type": "security",
      "label": "Reject",
      "sublabel": "拒绝退货",
      "icon": "failure"
    },
    {
      "id": "receive_parcel",
      "lane": "parcel",
      "col": 2,
      "type": "backend",
      "label": "Receive Parcel",
      "sublabel": "接收退回包裹",
      "icon": "briefcase"
    },
    {
      "id": "inspect",
      "lane": "parcel",
      "col": 4,
      "type": "security",
      "label": "Inspect",
      "sublabel": "检查包裹状态",
      "icon": "decision"
    },
    {
      "id": "refund",
      "lane": "outcome",
      "col": 5,
      "type": "backend",
      "label": "Refund",
      "sublabel": "执行退款",
      "icon": "success"
    }
  ],
  "edges": [
    {
      "id": "submit",
      "from": "return_request",
      "to": "eligibility_check",
      "label": "submit",
      "variant": "emphasis",
      "role": "main"
    },
    {
      "id": "ineligible",
      "from": "eligibility_check",
      "to": "reject",
      "label": "ineligible",
      "variant": "security",
      "role": "error",
      "fromSide": "bottom",
      "toSide": "top"
    },
    {
      "id": "eligible",
      "from": "eligibility_check",
      "to": "receive_parcel",
      "label": "eligible",
      "variant": "emphasis",
      "role": "main",
      "route": "drop"
    },
    {
      "id": "arrived",
      "from": "receive_parcel",
      "to": "inspect",
      "label": "arrived",
      "variant": "emphasis",
      "role": "main"
    },
    {
      "id": "accepted",
      "from": "inspect",
      "to": "refund",
      "label": "accepted",
      "variant": "emphasis",
      "role": "main",
      "route": "drop"
    },
    {
      "id": "damaged",
      "from": "inspect",
      "to": "reject",
      "label": "damaged",
      "variant": "security",
      "role": "error",
      "route": "drop"
    }
  ],
  "semanticChecks": {
    "allowedRoots": [
      "return_request"
    ],
    "allowedTerminals": [
      "refund",
      "reject"
    ],
    "requiredEdges": [
      {
        "from": "return_request",
        "to": "eligibility_check"
      },
      {
        "from": "eligibility_check",
        "to": "reject"
      },
      {
        "from": "eligibility_check",
        "to": "receive_parcel"
      },
      {
        "from": "receive_parcel",
        "to": "inspect"
      },
      {
        "from": "inspect",
        "to": "refund"
      },
      {
        "from": "inspect",
        "to": "reject"
      }
    ]
  }
};

test('relative drop forks recover without changing source constraints or semantics', () => {
  const workflow = structuredClone(fixture);
  const before = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(workflow, before);
  assert.deepEqual(result.receipt.nodes.map(n => [n.id, n.lane, n.col]).sort(), workflow.nodes.map(n => [n.id, n.lane, n.col]).sort());
  assert.deepEqual(result.receipt.edges.map(e => [e.id, e.from, e.to]).sort(), workflow.edges.map(e => [e.id, e.from, e.to]).sort());
  assert.deepEqual(result.receipt.labels.map(l => l.label).sort(), workflow.edges.map(e => e.label).sort());
  const constrained = result.receipt.edges.find(e => e.id === 'ineligible').points;
  assert.equal(constrained[0][0], constrained[1][0]);
  assert.ok(constrained[1][1] > constrained[0][1], 'authored bottom departure');
  assert.equal(constrained.at(-1)[0], constrained.at(-2)[0]);
  assert.ok(constrained.at(-2)[1] < constrained.at(-1)[1], 'authored top arrival');
});

test('relative drop recovery is stable when eligible forks exceed the retry limit', () => {
  const workflow = structuredClone(fixture);
  // Four already-routable forks must not push the original repairable fork
  // outside the retry budget when authored arrays are reversed.
  for (const prefix of ['z_first_', 'z_second_']) {
    const copy = structuredClone(fixture);
    for (const lane of copy.lanes) lane.id = prefix + lane.id;
    for (const node of copy.nodes) {
      node.id = prefix + node.id;
      node.lane = prefix + node.lane;
    }
    for (const edge of copy.edges) {
      edge.id = prefix + edge.id;
      edge.from = prefix + edge.from;
      edge.to = prefix + edge.to;
      delete edge.fromSide;
      delete edge.toSide;
    }
    workflow.lanes.push(...copy.lanes);
    workflow.nodes.push(...copy.nodes);
    workflow.edges.push(...copy.edges);
    workflow.semanticChecks.allowedRoots.push(...copy.semanticChecks.allowedRoots.map(id => prefix + id));
    workflow.semanticChecks.allowedTerminals.push(...copy.semanticChecks.allowedTerminals.map(id => prefix + id));
    workflow.semanticChecks.requiredEdges.push(...copy.semanticChecks.requiredEdges.map(edge => ({
      from: prefix + edge.from, to: prefix + edge.to,
    })));
  }
  const first = compileWorkflow({ workflow: structuredClone(workflow), qualityProfile: 'showcase' });
  const reordered = structuredClone(workflow);
  reordered.edges.reverse();
  reordered.nodes.reverse();
  const second = compileWorkflow({ workflow: reordered, qualityProfile: 'showcase' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  assert.deepEqual(second.receipt.edges, first.receipt.edges);
  assert.deepEqual(second.receipt.labels, first.receipt.labels);
});
