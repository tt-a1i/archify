import json
from pathlib import Path
import tempfile
import unittest

from trace_extract import extract


class TraceChecks(unittest.TestCase):
    def test_extracts_intervals_and_adoption_without_payload_leakage(self):
        rows = [
            {'type': 'event_msg', 'timestamp': '2026-01-01T00:00:00Z', 'payload': {'type': 'task_started'}},
            {'type': 'turn_context', 'payload': {'model': 'model', 'effort': 'medium'}},
            {'type': 'response_item', 'payload': {'type': 'reasoning', 'text': 'PRIVATE_CANARY'}},
            {'type': 'response_item', 'timestamp': '2026-01-01T00:00:01Z', 'payload': {'type': 'custom_tool_call', 'name': 'exec', 'call_id': 'c', 'input': 'ast-grep outline source; PRIVATE_CANARY'}},
            {'type': 'response_item', 'timestamp': '2026-01-01T00:00:02Z', 'payload': {'type': 'custom_tool_call_output', 'call_id': 'c', 'output': 'PRIVATE_CANARY'}},
            {'type': 'event_msg', 'timestamp': '2026-01-01T00:00:03Z', 'payload': {'type': 'task_complete', 'last_agent_message': 'PRIVATE_CANARY'}},
        ]
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / 'trace.jsonl'
            p.write_text('\n'.join(json.dumps(x) for x in rows))
            result = extract(p, {'start_epoch': 1767225600, 'first_complete_seconds': 2.5, 'observed_seconds': 5, 'max_poll_gap_seconds': .1})
        self.assertEqual(result['native_task_seconds'], 3)
        self.assertEqual(result['outline_calls'], 1)
        self.assertEqual(result['tool_calls'][0]['observed_tool_seconds'], 1)
        self.assertEqual(result['first_complete_from_native_start_seconds'], 2.5)
        self.assertNotIn('PRIVATE_CANARY', json.dumps(result))

    def test_incomplete_trace_is_not_a_success(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / 'trace.jsonl'
            p.write_text(json.dumps({'type': 'event_msg', 'timestamp': '2026-01-01T00:00:00Z', 'payload': {'type': 'task_started'}}))
            with self.assertRaises(ValueError):
                extract(p, {})


if __name__ == '__main__':
    unittest.main()
