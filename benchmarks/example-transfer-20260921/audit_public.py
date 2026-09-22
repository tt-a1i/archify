"""Post-run exposure and censored timing audit; never save raw session content."""
import argparse
import datetime
import importlib.util
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent


def read(path):
    return json.loads(path.read_text())


def audit(out, name, agent):
    record = out / name
    start = read(record / 'start.json')
    day = datetime.datetime.fromtimestamp(start['full_start_epoch']).strftime('%Y/%m/%d')
    sessions = []
    for path in (pathlib.Path.home() / '.codex/sessions' / day).glob('*.jsonl'):
        with path.open() as stream:
            meta = json.loads(stream.readline()).get('payload', {})
        origin = meta.get('source', {})
        if isinstance(origin, dict) and origin.get('subagent', {}).get('thread_spawn', {}).get('agent_path') == agent:
            sessions.append(path)
    assert len(sessions) == 1
    spec = importlib.util.spec_from_file_location('public_trace', HERE.parent / 'source-tools-20260921/trace_extract.py')
    trace = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(trace)
    calls, events, identity = {}, [], {}
    markers = {
        'example_diagram_title': 'Document Publisher Controller',
        'example_source_pin': 'f1182e57f67d321c61817a6249f82c2720113f88',
        'example_source_function': 'createPublisher(',
    }
    for line in sessions[0].read_text().splitlines():
        item = json.loads(line)
        value, kind, stamp = item.get('payload', {}), item.get('type'), item.get('timestamp')
        subtype = value.get('type')
        if kind == 'turn_context':
            identity = {key: value.get(key) for key in ('model', 'effort')}
        elif kind == 'event_msg' and subtype in ('task_started', 'task_complete', 'turn_aborted', 'error', 'task_failed'):
            events.append({'timestamp': stamp, 'event': subtype})
        elif kind == 'response_item' and subtype in ('function_call', 'custom_tool_call'):
            command = str(value.get('input', value.get('arguments', '')))
            accesses = [label for label, token in {
                'guide': 'library-worked-example.md', 'example_json': 'publisher.architecture.json',
                'example_directory': 'document-publisher', 'example_preview': 'preview.png',
            }.items() if token in command]
            calls[value.get('call_id')] = {
                'tool': value.get('name'), 'started_at': stamp,
                'categories': trace.categories(command), 'literal_access_markers': accesses,
            }
        elif kind == 'response_item' and subtype in ('function_call_output', 'custom_tool_call_output'):
            call = calls.get(value.get('call_id'))
            if call:
                call['completed_at'] = stamp
                call['observed_tool_seconds'] = trace.epoch(stamp) - trace.epoch(call['started_at'])
                output = str(value.get('output', ''))
                call['public_output_markers'] = [label for label, marker in markers.items() if marker in output]
    task_start = next(e['timestamp'] for e in events if e['event'] == 'task_started')
    ends = [e for e in events if e['event'] in ('task_complete', 'turn_aborted', 'task_failed')]
    end = ends[-1] if ends else None
    receipt = read(record / 'receipt.json')
    first = receipt.get('first_complete_seconds')
    elapsed = trace.epoch(end['timestamp']) - trace.epoch(task_start) if end else None
    result = {
        'run': name, 'identity': identity, 'events': events, 'tool_calls': list(calls.values()),
        'native_observed_until_terminal_seconds': elapsed,
        'full_observed_until_terminal_seconds': trace.epoch(end['timestamp']) - start['full_start_epoch'] if end else None,
        'terminal_event': end['event'] if end else None,
        'first_candidate_seconds': receipt['start_epoch'] + first - trace.epoch(task_start) if first is not None else None,
        'native_cap_seconds': 600, 'over_cap_seconds': max(0, elapsed - 600) if elapsed is not None else None,
        'censored': bool(end and end['event'] != 'task_complete'),
        'limits': 'Post-run diagnostic, not the frozen eligibility extractor. Censored elapsed time is not successful latency. Literal command/output markers are evidence of access, not comprehension; absence does not exclude dynamic paths. Payloads and reasoning are not retained. No surfaced error does not prove absence of provider/network retries.',
    }
    (record / 'public-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    return {key: value for key, value in result.items() if key not in ('tool_calls', 'events', 'limits')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=pathlib.Path)
    parser.add_argument('--run', required=True)
    parser.add_argument('--agent', required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.out, args.run, args.agent)))
