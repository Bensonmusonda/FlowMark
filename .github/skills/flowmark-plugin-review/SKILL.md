---
name: flowmark-plugin-review
description: Review or debug changes to FlowMark sandbox plugins and their host API. Use when auditing a plugin manifest, capability use, IPC boundary, panel/custom-view lifecycle, or a plugin-related bug.
---

# FlowMark plugin review

Review the sandbox implementation and the affected plugin as one contract. Unless the user asks for a fix, report findings rather than modifying code.

## Review workflow

1. Read the relevant guide in `docs/plugins/`, then inspect the actual changed diff.
2. Identify the execution context for each changed file: primary plugin window, panel iframe, custom-view iframe, or main renderer/host.
3. Compare every plugin API use with `manifest-schema.json`, `plugin-preload.js`, `request-authorizer.js`, and the corresponding `plugin-host.js` handler. A renderer-side check alone is not authorization.
4. Check that the plugin declares only permissions it uses. Pay special attention to direct `file.write`, clipboard reads, and network access.
5. Check host-side validation for IDs, paths, payload types, JSON serialization/size, and ownership when unregistering commands or views.
6. Check lifecycle cleanup: disable/failure should remove plugin-owned menu items, commands, slash commands, panels, and custom-view registrations; callbacks must not outlive their plugin window.
7. Distinguish documented behavior from unsupported assumptions:
   - Panel and custom-view frames do not receive `flowmarkPlugin`.
   - Custom-view state messages are not general RPC.
   - The `entry_point` loader uses classic scripts, not ES modules.
   - `extensions` do not automatically route file opening.
8. Run the smallest relevant test. For host-contract changes, run `node test-stage4.mjs`, then `npm test` and `npm run build` as appropriate.

## Security-sensitive implementation facts

- The installer does not show a separate per-permission approval dialog.
- Host IPC authorization is defined in `request-authorizer.js`; new request or event channels must be explicitly mapped and tested.
- `file.write` writes to a caller-provided path, and the network handler has no plugin-specific origin allowlist.
- Panel and custom-view entry paths are checked to remain inside the plugin directory. The primary `entry_point` is currently checked for existence but not directory containment; treat this as a hardening concern for third-party distribution.
- The Electron sandbox and context isolation reduce reach but do not eliminate risks from granted host capabilities or resource abuse.

## Reporting

For each finding, include severity, concise impact, the affected file and line, and a concrete safe remediation. Separate confirmed implementation defects from design limitations or roadmap proposals. Do not report a theoretical concern as exploitable without evidence, and do not claim a capability exists merely because a proposal mentions it.
