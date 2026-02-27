# Agent Guidance

## Linting Is Mandatory (Zero Complaints Policy)

Linting is mandatory when you make source code changes that can affect program
execution. When linting is required, you must run the full lint pipeline,
inspect the output, and ensure there are zero lint complaints.

### When To Run Linting

You must follow these rules strictly:
- Always run `make lint` (never run `npm run lint` directly). `make lint`
  runs auto-fix by default.
- Use `make lint-dry` for check-only runs. This is mainly for setup and
  validation.
- During active TypeScript/JavaScript implementation, run lint checks
  frequently (for example, after each meaningful code change) so style and
  structure issues are caught early.
- In repos with multiple languages, this frequent linting requirement applies
  only to TypeScript/JavaScript work.
- Run linting only after source code changes that affect runtime behavior
  (for example, changes to `.ts`, `.tsx`, `.js`, or similar code files).
- Do not run linting after changes limited to JSON, Markdown, shell commands,
  configuration-only edits, or documentation updates.
- Do not run linting merely because the user asked a question. Only lint after
  you have finished making execution-affecting code changes.

Zero complaints means:
- No warnings.
- No errors.
- No duplication.
- No unused code.
- No “acceptable for now” lint violations of any kind.

If any linter reports a complaint, you must fix it immediately. You must not
silence, bypass, or weaken linting rules. Specifically, do not:
- Comment out lint errors.
- Disable rules inline or via config.
- Loosen rule severity.
- Increase thresholds (for example, duplication thresholds).
- Add exclusions to hide violations.

## Edge Cases Require User Approval

The only time a lint complaint may be ignored is when there is a truly
compelling reason. In that case:
- You must explicitly inform the user.
- You must obtain the user’s approval before ignoring the lint.
- You must not change lint configuration as a workaround.

There is a strict zero percent duplication policy. Do not raise duplication
thresholds under any circumstances without explicit user approval.
