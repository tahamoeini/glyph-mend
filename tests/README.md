# Python Test Layout

- `unit/` tests isolated parsing, cleanup, semantics, export, quality, and workspace
  behavior.
- `integration/` tests compose the extraction pipeline and resumable workflow.
- `interfaces/` tests command-line normalization, GUI helper behavior, and progress
  reporting.

Run the complete Python suite from the repository root:

```bash
python -m pytest
```

Target one area when iterating:

```bash
python -m pytest tests/unit
python -m pytest tests/integration
python -m pytest tests/interfaces
```
