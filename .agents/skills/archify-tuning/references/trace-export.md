# Trace export

Use this input when generation ran outside Devin CLI. Export the relevant sessions with the host's supported tools, then normalize tool names and arguments to the format below. Keep the export in the external tuning home; it can contain source-project content. The collector does not discover or parse another agent's private database.

```sh
node .agents/skills/archify-tuning/scripts/collect.mjs <round> --trace-export <trace.json> --dump
```

The JSON object has `schemaVersion: 1` and a `sessions` array. Each session has an `id` and chronological `messages`. Its user task must name the absolute `<round>/<diagram-type>` directory created by `round.mjs`, so collection can associate the session with one diagram.

```json
{
  "schemaVersion": 1,
  "sessions": [{
    "id": "workflow-run-1",
    "messages": [
      { "role": "user", "content": "Create the diagram in /absolute/round/workflow" },
      {
        "role": "assistant",
        "content": "Write the first candidate.",
        "tool_calls": [{
          "id": "write-1",
          "name": "write",
          "arguments": {
            "file_path": "/absolute/round/workflow/.archify/example/candidate.json",
            "content": "{\"diagram_type\":\"workflow\"}"
          }
        }]
      },
      { "role": "tool", "tool_call_id": "write-1", "content": "Written" }
    ]
  }]
}
```

The shortened candidate above illustrates encoding only; retain the full actual candidate in an export. Normalize `read` to `{ "file_path": "..." }`, `write` to `{ "file_path": "...", "content": "..." }`, and `exec` to `{ "command": "..." }`. Tool results are strings linked by `tool_call_id`. Preserve command output, including nonzero failures and unknown outcomes. A first draft created through a patch or shell command needs a corresponding normalized `write` event containing its actual first JSON, not the final repaired version.

Keep final candidates in the round directories specified by the prompts. Missing drafts, results or final files are missing evidence; never fabricate events or replace them with successful summaries. Content-change counts flag items to inspect and do not establish factual or semantic equivalence.
