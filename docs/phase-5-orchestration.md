# Phase 5 Orchestration — Second Adapter

**Integration branch:** `phase-5-second-adapter`  
**Base:** `main` at `8fcfb76`  
**Target adapter:** Claude Code  
**Main-merge policy:** Phase 5 must not be merged into `main` without explicit approval.

## Objective

Add the second host adapter while reusing the existing contract, core, shim,
host, CLI, and installer safety rules. Adapter-specific behavior stays inside
the adapter package. Any shared-package change requires a written contract-fix
justification and PRD §24 entry.

## Worktree allocation

| Worktree branch | Responsibility | Integration evidence |
| --- | --- | --- |
| `phase-5-claude-code-adapter` | Package boundary, lifecycle, capabilities, public exports | Capability schema and lifecycle tests |
| `phase-5-claude-code-normalizer` | Host signal mapping and fixture normalization | Recorded fixtures, redaction, duplicates, confidence |
| `phase-5-claude-code-tests` | Adapter-focused test expansion and hostile inputs | Full adapter fixture replay suite |
| `phase-5-shared-contract-tests` | Shared suite for OpenCode and Claude Code | No unsupported emission, valid events, interleaving/no cross-talk |
| `phase-5-claude-code-install` | Install/uninstall and coexistence behavior | Idempotence, backup, containment, OpenCode coexistence |
| `phase-5-docs-verification` | Live-smoke record, capability matrix, docs, exit checklist | Evidence and release-readiness review |

All worktrees start at the Phase 5 integration base. Workers must commit on
their own branches using the repository's conventional prefixes (`feat:`,
`test:`, `docs:`, or `merge:`). No worker may merge directly to `main`.

## Execution order

1. Confirm Claude Code runtime/version signals and existing Phase 0 scorecard evidence.
2. Build the adapter skeleton and truthful capability declaration.
3. Implement normalization only for verified signals; mark other signals unsupported.
4. Add recorded fixtures before relying on live-host behavior.
5. Add install/uninstall with coexistence tests against OpenCode.
6. Run the shared adapter contract suite against both adapters.
7. Run the interleaved multi-adapter history/no-cross-talk test.
8. Record live-smoke observations and downgrade declarations for mismatches.
9. Reconcile documentation and run the complete Phase 5 exit gates.
10. Prepare a PR from `phase-5-second-adapter` to `main`; stop for explicit merge approval.

## Integration gates

### Required automated gates

```text
npm run lint
npm run deps:check
npm run typecheck
npm test
npm run build
npm run ci
```

The GitHub baseline must be green. The previous failed run on `b21dcbc` was
caused by a Windows runner latency p95 spike (2871 ms versus 500 ms) and a
fresh SQLite bootstrap timeout; both passed on the subsequent `main` run.
If either repeats, capture the run ID and stabilize or document the test before
claiming Phase 5 is green.

### Adapter gates

- Capability declarations are schema-valid and every authoritative signal has source evidence.
- Unsupported event types cannot be emitted.
- No prompt, command, tool, model, or other free-text payload crosses the adapter boundary.
- Duplicate host callbacks are idempotent.
- Hostile project/session names remain bounded and safe.
- OpenCode and Claude Code events remain isolated by adapter/session identity.
- Shared contract tests pass without core changes, or every necessary contract fix is documented.
- Installing or uninstalling Claude Code does not damage an OpenCode installation.
- Doctor and CLI capability reporting include both installed adapters.

## Exit criteria

- [ ] Claude Code adapter and installer are implemented.
- [ ] Recorded fixtures and adapter tests pass.
- [ ] Shared contract and interleaving tests pass.
- [ ] Live-smoke evidence is recorded and declarations match observations.
- [ ] Documentation and master plan are updated.
- [ ] Local `npm run ci` passes.
- [ ] GitHub Actions passes on the Phase 5 branch/PR.
- [ ] No Phase 5 merge into `main` occurs without explicit user approval.
