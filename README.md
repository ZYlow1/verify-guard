# verify-guard

A DeepSeek Harness plugin. It looks at a session's working directory once per
project and injects one user-role notice so the agent cannot silently skip the
project's verification gate.

## What it does

1. On every `agent/pre-step`, resolves the session working directory and walks up to the
   nearest directory carrying a project marker: `.git`, `pyproject.toml`, `package.json`,
   `requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, or any
   `*.sln`.
2. Not a project (for example a scratch or launcher directory) → nothing is injected.
3. A project with a baseline (`.dsh/verify/verify.ps1`, `.dsh/verify/verify.sh`,
   `verify.ps1`, or `verify.sh`) → the notice names the exact command to run and the rule
   that a run is required before claiming completion.
4. A project without a baseline → the notice says to scan read-only and propose a baseline
   before touching code.

## Configuration

Open **Plugins** in the sidebar, find the **dsh-verify-guard** bundle, expand it, and press
**Configure** on the `verify-guard` row. The page writes the row's `config` into the
profile's `cordis.patch.yml`; the row restarts when the value changes.

| Setting | Values | Default | Effect |
|---|---|---|---|
| Inject the reminder | on / off | on | Off stops all notices and registers no per-step listener. The plugin stays loaded. |
| When to remind | Once per project | ✔ | One notice per project root, repeated only when the root or its baseline changes. |
| | Every step | | A notice before every model step. Strongest and noisiest. |
| | Only without a baseline | | Silent for projects that already have `verify.ps1` or `verify.sh`. |

The same fields can be set by hand in the patch:

```yaml
- id: verify-guard
  name: dsh-verify-guard
  config:
    enabled: true
    notice: project
```

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
- `Every step` multiplies the notice by the number of steps, and every notice is a user
  message in the transcript. It is there for sessions that must not drift, not for comfort.

## Development

`detect.js` holds the framework-free core; `index.js` wires it into the harness and
declares the row `Config`; `client.js` is the browser half that registers the
configuration page. `node test/detect.test.mjs` covers detection, text, configuration
reading, and the notice decisions.

The row `Config` needs `@deepseek-ai/schemastery`. A bundle linked into a profile resolves
bare imports from its own directory, not from the dsh installation, so run `pnpm install`
in this directory before installing or reloading the bundle. `.npmrc` pins
`node-linker=hoisted` because the linked directory is resolved by its real path, and
pnpm's default symlinked layout leaves `@deepseek-ai/cosmokit` where that resolution cannot
reach it.

The browser half needs a page reload after it changes; the host half reloads on the next
profile recomposition, such as switching the row off and on in **Plugins**.
