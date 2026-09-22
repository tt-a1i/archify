"""Clone only the public, exact revisions in this benchmark's task manifest."""
import argparse
import json
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent


def git(directory, *arguments):
    return subprocess.check_output(['git', *arguments], cwd=directory, text=True).strip()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=pathlib.Path, required=True,
                        help='An empty directory for the three pinned source repositories')
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    tasks = json.loads((HERE / 'tasks.json').read_text())['tasks']
    for task in tasks:
        destination = args.root / task['id']
        if destination.exists():
            assert git(destination, 'rev-parse', 'HEAD') == task['revision'], destination
            assert not git(destination, 'status', '--porcelain=v1'), destination
            assert git(destination, 'remote', 'get-url', 'origin').removesuffix('.git') == task['url']
        else:
            subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout',
                            task['url'], str(destination)], check=True)
            subprocess.run(['git', 'checkout', '--detach', task['revision']],
                           cwd=destination, check=True)
        assert git(destination, 'rev-parse', 'HEAD') == task['revision']
        print(json.dumps({'repository': task['id'], 'revision': task['revision'],
                          'path': str(destination.resolve())}), flush=True)
