const laneDefinitions = Object.freeze([
  ['intake', '请求接入与身份核验', 'frontend'],
  ['policy', '策略评估与风险判定', 'security'],
  ['runtime', '运行时编排与工具执行', 'backend'],
  ['data', '数据持久化与审计留痕', 'database'],
  ['observe', '可观测性与人工处置', 'cloud'],
]);

const stepLabels = Object.freeze([
  '接收并规范化外部请求',
  '补全项目上下文与约束',
  '执行确定性策略判定',
  '编排受限工具调用计划',
  '提交结果与审计证据',
  '确认交付状态并关闭',
]);

export function largeAdaptiveWorkflow() {
  const lanes = laneDefinitions.map(([id, label], index) => ({
    id,
    label,
    ...(index === 4 ? { variant: 'exception' } : {}),
  }));
  const nodes = laneDefinitions.flatMap(([lane, laneLabel, type], laneIndex) => (
    stepLabels.map((step, col) => ({
      id: `${lane}-${col}`,
      lane,
      col,
      type,
      label: step,
      sublabel: `${laneLabel} · 第 ${col + 1} 阶段`,
      width: 168,
      ...(col === 2 ? { tag: laneIndex % 2 ? 'POLICY' : 'CHECKPOINT' } : {}),
    }))
  ));
  const horizontalEdges = laneDefinitions.flatMap(([lane], laneIndex) => (
    stepLabels.slice(0, -1).map((_, col) => ({
      id: `${lane}-step-${col}`,
      from: `${lane}-${col}`,
      to: `${lane}-${col + 1}`,
      role: laneIndex === 0 ? 'main' : 'branch',
      ...(col === 1 ? { label: '保留完整语义与来源证据后继续处理' } : {}),
    }))
  ));
  const verticalEdges = stepLabels.flatMap((_, col) => (
    laneDefinitions.slice(0, -1).map(([lane], laneIndex) => ({
      id: `handoff-${lane}-${col}`,
      from: `${lane}-${col}`,
      to: `${laneDefinitions[laneIndex + 1][0]}-${col}`,
      role: 'async',
    }))
  ));
  const recoveryEdge = {
    id: 'bounded-recovery-loop',
    from: 'observe-0',
    to: 'intake-0',
    role: 'error',
    variant: 'security',
    route: 'return-left',
  };

  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: '大型自适应工作流验收图',
      subtitle: '30 个节点、50 条关系、长中文标签、跨泳道交接与有界恢复回路',
      output: 'large-adaptive.workflow.html',
      locale: 'zh-CN',
      quality_profile: 'showcase',
      visual_preset: 'signal-flow',
      animation: 'none',
      views: laneDefinitions.map(([lane, label]) => ({
        id: `${lane}-chapter`,
        label,
        focus: stepLabels.map((_, col) => `${lane}-${col}`),
        note: `聚焦${label}，可随时返回完整总览。`,
      })),
    },
    lanes,
    phases: [
      { id: 'understand', label: '理解与约束', fromCol: 0, toCol: 1 },
      { id: 'decide', label: '判定与执行', fromCol: 2, toCol: 3 },
      { id: 'deliver', label: '交付与确认', fromCol: 4, toCol: 5 },
    ],
    mainPath: stepLabels.map((_, col) => `intake-${col}`),
    nodes,
    edges: [...horizontalEdges, ...verticalEdges, recoveryEdge],
  };
}
