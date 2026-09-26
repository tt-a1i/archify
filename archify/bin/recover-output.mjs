import { recoverRetiredPublication } from '../renderers/shared/atomic-output.mjs';

function usage(stream = process.stderr) {
  stream.write('Usage: node bin/recover-output.mjs <private-recovery-directory> [--json]\n');
}

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  usage(process.stdout);
} else {
  let json = false;
  let recoveryDirectory;
  let invalid = false;
  for (const argument of args) {
    if (argument === '--json' && !json) {
      json = true;
    } else if (argument.startsWith('-') || recoveryDirectory !== undefined) {
      invalid = true;
    } else {
      recoveryDirectory = argument;
    }
  }

  if (invalid || recoveryDirectory === undefined) {
    usage();
    process.exitCode = 64;
  } else {
    const result = recoverRetiredPublication(recoveryDirectory);
    if (json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      const reason = result.reason?.code || 'publication-recovery-unknown';
      process.stdout.write(`${result.status}: ${reason}\n`);
    }
    // A complete prior recovery is idempotent. A preserved target is a safe,
    // deliberate non-action that needs the operator to inspect the claimant.
    process.exitCode = ['recovered', 'absent'].includes(result.status)
      ? 0
      : result.status === 'preserved' ? 2 : 1;
  }
}
