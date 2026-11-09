#!/usr/bin/env python3
"""Replay the original 20 cases with the corrected bytes answer frozen here.

Only bytes-try-get-int differs: its two calls are trait-declaration
candidates, call A's caller kind is trait-default-method, and call B starts at
the receiver (2836:13) in a macro-generated method. All other case files are
copies of the previous batch.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE.parent / "code-analysis-go-rust-investigation-batch-20261108"
sys.path.insert(0, str(HARNESS))
import run  # noqa: E402

run.CASES = HERE / "cases20"
sys.argv[0] = str(HARNESS / "run.py")
sys.exit(run.main())
