# Security Policy

## Reporting a Vulnerability

token-meter runs entirely on the user's own machine and never phones home:
no telemetry, no network calls, no third-party services. The dashboard
backend opens `state.db` **read-only** and never writes to it.

If you still find a security issue (e.g. the plugin mishandling paths,
permissions, or data), please report it privately instead of opening a
public issue:

- Open a GitHub issue with the `security` label (recommended for
  non-critical issues), or
- Contact the maintainer directly via a private GitHub discussion / email
  listed on the profile.

Please include: the affected version, a minimal reproduction, and what you
expected vs what happened. Do not include credentials or personal data in
reports.
