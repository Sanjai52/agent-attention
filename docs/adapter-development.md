# Adapter Development Guide

Status: scaffold. Written with the first adapter (Task 3.8) and refined with the
second (Task 5.6). Source of truth: `PRD.md` §9.2, §16, §17, §18.4.

## Sections (to be filled)

1. What an adapter is (and is not): normalization + capabilities only (PRD §16.7)
2. Choosing an execution model: in-process plugin vs hook shim (PRD §9.2)
3. Declaring capabilities honestly (`AdapterCapabilities`; `unsupported` is a valid answer)
4. Mapping signals: confidence rules, required `details`, no free text, no payloads
5. Testing: recorded fixtures first (D-08), mock host, live smoke not gating
6. Installing: merge semantics, backups, idempotence, no admin (PRD §18.4)
7. Capability downgrade procedure after a host upgrade (PRD §18.3)
8. Worked example: the two shipped adapters
