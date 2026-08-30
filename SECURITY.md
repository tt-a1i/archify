# Security Policy

Archify welcomes responsible security reports. Please report suspected
vulnerabilities privately so maintainers can investigate and coordinate
remediation before public disclosure.

## Supported versions

Archify is under active development. Please report vulnerabilities affecting
the latest stable release or current `main`.

Reports affecting older releases are also welcome. Include the exact version
or commit so maintainers can determine the affected range. This policy does
not promise maintenance or backports for older releases.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository when that
option is available.

Include, when available:

- the affected Archify version or commit;
- the installation method, operating system, Node.js version, and relevant
  host or agent;
- the affected command, component, or entry point;
- a minimal reproduction or proof of concept;
- the security impact and conditions required to reproduce it;
- a suggested mitigation or workaround, if known.

Use a minimal, redacted reproduction. Do not publish exploit details,
credentials, access tokens, secrets, private repository content, personal
data, or customer data in public issues, discussions, pull requests, logs,
screenshots, generated artifacts, or package tests.

If private vulnerability reporting is unavailable, open a public issue asking
the maintainers for a private security contact. Do not include vulnerability
details in that issue.

## Coordinated disclosure

Please keep vulnerability details private while the report is being triaged
and, when applicable, while a fix is being prepared.

Coordinate public disclosure with the maintainers through the private reporting
channel so affected users can be given accurate remediation guidance.

## Non-security bugs

Use [the bug report form](.github/ISSUE_TEMPLATE/bug-report.yml) for
functional, rendering, validation, compatibility, packaging, or documentation
defects that do not create a security impact.

If you are unsure whether a finding is security-sensitive, report it privately.
