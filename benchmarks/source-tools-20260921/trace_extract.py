"""Extract public timing/categories; never persist reasoning or tool payloads."""

import argparse
import datetime
import json
import pathlib
import re


def epoch(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def categories(command):
    result = []
    if 'ast-grep' in command and 'outline' in command:
        result.append('tool-help' if '--help' in command else 'ast-outline')
    if re.search(r'apply_patch|write_text|writeFile|json\.dump|cat\s*[^\n]*>', command):
        result.append('artifact-write')
    elif re.search(r'\b(?:cat|sed|head|nl|rg)\b|read_text|readFile', command):
        result.append('read-or-search')
    if 'git ' in command:
        result.append('repository-metadata')
    if 'archify.mjs' in command:
        result += re.findall(r'\b(finalize|validate|deliver|browser-check|visual-check)\b', command)
    if not result:
        result.append('other-tool')
    return sorted(set(result))


def extract(session, receipt):
    start = end = None
    identity = {}
    calls = {}
    surfaced_faults = []
    usage = None
    with session.open() as stream:
        for line in stream:
            item = json.loads(line)
            kind = item.get('type')
            value = item.get('payload', {})
            subkind = value.get('type')
            stamp = item.get('timestamp')
            if kind == 'turn_context':
                identity = {k: value.get(k) for k in ('model', 'effort')}
            if kind == 'event_msg':
                if subkind == 'task_started':
                    if start is not None:
                        raise ValueError('Multiple turns; this extractor expects a fresh single-turn subject')
                    start = stamp
                elif subkind == 'task_complete':
                    end = stamp
                elif subkind in ('error', 'turn_aborted', 'task_failed'):
                    surfaced_faults.append({'event': subkind, 'timestamp': stamp})
            if kind == 'token_usage_record':
                usage = value.get('turn_token_usage')
            if kind != 'response_item':
                continue
            # Explicitly ignore reasoning and ordinary message contents.
            if subkind in ('function_call', 'custom_tool_call'):
                ident = value.get('call_id')
                calls[ident] = {'tool': value.get('name'), 'started_at': stamp,
                               'categories': categories(str(value.get('input', value.get('arguments', ''))))}
            elif subkind in ('function_call_output', 'custom_tool_call_output'):
                call = calls.get(value.get('call_id'))
                if call:
                    call['completed_at'] = stamp
                    call['observed_tool_seconds'] = epoch(stamp) - epoch(call['started_at'])
    if not start or not end:
        raise ValueError('No completed native task interval')
    first = receipt.get('first_complete_seconds')
    first_relative = (receipt['start_epoch'] + first - epoch(start)) if first is not None else None
    return {
        'identity': identity, 'task_started_at': start, 'task_completed_at': end,
        'native_task_seconds': epoch(end) - epoch(start),
        'first_complete_from_native_start_seconds': first_relative,
        'external_observer_seconds': receipt['observed_seconds'],
        'observer_max_gap_seconds': receipt['max_poll_gap_seconds'],
        'tool_calls': list(calls.values()),
        'outline_calls': sum('ast-outline' in x['categories'] for x in calls.values()),
        'surfaced_faults': surfaced_faults, 'reported_turn_usage': usage,
        'unknown': ['internal requests', 'network retries', 'server timing', 'hidden reasoning time'],
        'limits': 'Tool categories are coarse lexical metadata. Tool output, arguments, prose and reasoning are not retained. No surfaced error does not prove no network retry.',
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--session', type=pathlib.Path, required=True)
    p.add_argument('--receipt', type=pathlib.Path, required=True)
    p.add_argument('--out', type=pathlib.Path, required=True)
    a = p.parse_args()
    result = extract(a.session, json.loads(a.receipt.read_text()))
    a.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('tool_calls', 'reported_turn_usage')}))


if __name__ == '__main__':
    main()
