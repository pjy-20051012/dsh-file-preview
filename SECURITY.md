# Security Policy

## Reporting a Vulnerability

Please report security issues privately to the repository maintainers — do not
open a public issue with exploit details. Include:

- The dsh version and platform (Windows/macOS/Linux).
- Steps to reproduce.
- Impact and, if known, a suggested fix.

## Security model

- All endpoints verify the peer socket address AND the Host header; only
  loopback callers are served. Do not expose these endpoints through a reverse
  proxy to a LAN or the internet.
- The preview endpoints are strictly read-only; no endpoint writes files.
- `open`/`reveal` launch native programs only on the local machine, in the
  same way the user opening a file themselves would.
- The plugin never reads credentials, never sends data to external networks.
