# CI and local verification

## When GitHub Actions runs

The web platform and Companion workflows run only when a pull request is opened (subject to their path filters) or when manually dispatched. Pushes do not start workflows. Python checks and release builds are manual-only, so they do not consume hosted minutes during normal web or Companion work. Select the release tag as the workflow ref when manually dispatching a release. Artifact uploads and portable Companion builds are also manual-only.

## Run Linux checks locally with Docker

From the repository root in PowerShell:

```powershell
pwsh -NoProfile -File tools/ci/run-docker.ps1
```

The runner focuses on the web platform first, then Companion: it runs browser licensing/security checks, lint, type checks, tests, production build, Companion formatting, Clippy, Rust tests, dependency policy, and browser-to-runtime E2E. It builds a reusable tool image once, then runs checks in disposable containers. The repository is mounted read-only and copied inside each container, so generated files do not alter the checkout. Containers are removed automatically after each run, including failure paths. Dependency and build caches live in five dedicated Docker volumes to speed up later runs; the runner serializes local executions and removes stale containers it owns at startup.

The image and package caches are kept to avoid reinstalling toolchains and dependencies on each run. Use `-RebuildImage` after changing the Dockerfile. To remove the image after the checks:

```powershell
pwsh -NoProfile -File tools/ci/run-docker.ps1 -RemoveImage
```

To remove the five local CI cache volumes after a run:

```powershell
pwsh -NoProfile -File tools/ci/run-docker.ps1 -ClearCache
```

Python packaging checks remain available through manual dispatch of the Python workflow and are outside this focused local path. Docker validates Linux behavior only. Windows and macOS verification for the web platform and Companion still requires the hosted workflow, which runs when a pull request is opened or when manually dispatched.