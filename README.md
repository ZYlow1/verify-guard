# verify-guard

A host-only DeepSeek Harness plugin. It looks at a session's working directory once per
project and injects one user-role notice so the agent cannot silently skip the project's
verification gate.

## What it does

1. On every `agent/pre-step`, resolves the session working directory and walks up to the
   nearest directory carrying a project marker: `.git`, `pyproject.toml`, `package.json`,
   `requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, or any
   `*.sln`.
2. Not a project (for example a scratch or launcher directory) → nothing is injected.
3. A project with a baseline (`.dsh/verify/verify.ps1`, `.dsh/verify/verify.sh`,
   `verify.ps1`, or `verify.sh`) → one notice naming the exact command to run and the rule
   that a run is required before claiming completion.
4. A project without a baseline → one notice saying to scan read-only and propose a
   baseline before touching code.

The notice repeats only when the verdict changes (different project root or the baseline
appears/disappears), so a session does not accumulate duplicates.

## What it deliberately does not do

- It never executes the baseline. Auto-running arbitrary project checks at session start
  is slow and can fail for unrelated environment reasons; the notice makes the run
  mandatory without pretending a result exists.
- It never edits files, installs anything, or changes configuration.
- It does not decide whether a run passed. That judgement belongs to the run's real output.

## Detection limits

- A project without one of the markers above is treated as a non-project.
- The walk stops at the filesystem root; a marker in a parent of the intended project root
  wins, exactly like the harness's own instruction discovery.
- Verdicts are cached per session object; a resumed session re-detects on its next step.
