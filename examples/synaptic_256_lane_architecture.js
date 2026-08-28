/**
 * SynapticChain 256-Lane Parallel State Machine Architecture Diagram for Archify
 *
 * Demonstrates visual animated sequencing of 256 gap-tolerant watermark bitmap lanes
 * executing concurrent transactions with sub-500ms DAG-primary BFT finality.
 */

export const synapticArchitectureDiagram = {
  title: "SynapticChain Layer-1: 256-Lane Parallel Nonce & x402 Execution Pipeline",
  type: "state-flow",
  theme: "cyber-rust",
  nodes: [
    {
      id: "ai_client",
      label: "Autonomous AI Agent Swarm",
      type: "client",
      details: "Dispatches 256 concurrent micro-actions simultaneously"
    },
    {
      id: "lane_router",
      label: "256-Lane Nonce Watermark Dispatcher",
      type: "scheduler",
      details: "ADR-062: Gap-tolerant watermark bitmap per account"
    },
    {
      id: "parallel_vm",
      label: "SynapticVM Parallel Execution Core",
      type: "runtime",
      details: "Rayon multi-threaded stack VM with compile-time AST scheduling"
    },
    {
      id: "scbft_dag",
      label: "SCBFT Quorum & SATA Elastic Batching",
      type: "consensus",
      details: "Sub-500ms deterministic DAG finality with zero mempool congestion"
    },
    {
      id: "x402_gateway",
      label: "Native HTTP 402 Settlement Rail",
      type: "micropayment",
      details: "$0.0008 per inference token / API query settlement"
    }
  ],
  edges: [
    { from: "ai_client", to: "lane_router", label: "Parallel Tx Batches (Lanes 0..255)" },
    { from: "lane_router", to: "parallel_vm", label: "Lock-Free Slot Assignment" },
    { from: "parallel_vm", to: "scbft_dag", label: "State Delta Commit (Sub-500ms)" },
    { from: "parallel_vm", to: "x402_gateway", label: "Micro-Settlement Receipt (<300ms)" }
  ],
  metadata: {
    runtime: "Rust (Edition 2021)",
    concurrencyLanes: 256,
    bftFinality: "<500ms",
    license: "BSL-1.1",
    github: "https://github.com/Synaptics-Lab"
  }
};
