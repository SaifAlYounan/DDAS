# Security Policy

DDAS is self-hosted software that routes authority decisions; its integrity
guarantees (deterministic classification, hash-chained audit log) are security
properties. Treat correctness bugs in the engine's invariants as security issues.

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub Security Advisories
(Security tab → "Report a vulnerability") rather than public issues.
You will get an acknowledgement within 7 days.

## Scope of interest

- Engine invariant violations (a classification that is not monotone,
  not reproducible, or that lowers a tier post-composition)
- Audit-chain tamper vectors
- Extraction-layer injection (documents crafted to hide or fabricate facts)
- AuthN/AuthZ bypasses in the API or console
