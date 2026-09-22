import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("annotate.py")
SPEC = importlib.util.spec_from_file_location("authoring_annotate", MODULE_PATH)
annotate = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(annotate)


class AnnotateTests(unittest.TestCase):
    def test_archify_stages_keep_combined_work_explicit(self):
        cases = {
            "validate": "combined_validation",
            "check": "artifact_check",
            "render": "layout_render",
            "browser-check": "combined_browser_quality",
            "visual-check": "combined_browser_quality",
            "deliver": "combined_pipeline",
        }
        for operation, expected in cases.items():
            with self.subTest(operation=operation):
                phase, _ = annotate.classify(
                    f"/bin/zsh -lc 'node archify/bin/archify.mjs {operation} candidate.json'"
                )
                self.assertEqual(phase, expected)

    def test_compound_shell_commands_are_unknown(self):
        for command in (
            "/bin/zsh -lc 'node archify/bin/archify.mjs validate candidate.json && cat candidate.json'",
            "/bin/zsh -lc 'node archify/bin/archify.mjs check diagram.html | cat'",
            "/bin/zsh -lc 'node archify/bin/archify.mjs validate candidate.json > validate.json'",
            "node archify/bin/archify.mjs validate candidate.json && cat candidate.json",
        ):
            with self.subTest(command=command):
                self.assertEqual(annotate.classify(command)[0], "unknown")

    def test_observer_path_placeholders_do_not_hide_real_compounds(self):
        finalize = "/bin/zsh -lc 'node bin/archify.mjs finalize architecture <WORKSPACE>/candidate.json <WORKSPACE>/diagram.html --repo-root <WORKSPACE>/source --quality showcase --json'"
        self.assertEqual(annotate.classify(finalize)[0], "combined_pipeline")
        redirected = finalize[:-1] + " > <WORKSPACE>/finalize.json'"
        self.assertEqual(annotate.classify(redirected)[0], "unknown")
        redacted = "/bin/zsh -lc 'node bin/archify.mjs finalize <REDACTED> <WORKSPACE>/diagram.html'"
        self.assertEqual(annotate.classify(redacted)[0], "unknown")

    def test_only_conservative_simple_reads_are_labeled(self):
        self.assertEqual(annotate.classify("/bin/zsh -lc 'cat archify/SKILL.md'")[0], "run_setup")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'sed -n 1,20p source/index.js'")[0], "evidence_read")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'nl -ba source/index.js'")[0], "evidence_read")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'sed -i 1d source/index.js'")[0], "unknown")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'sed -n '1,20p; s/a/b/' source/index.js'")[0], "unknown")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'head source/index.js'")[0], "unknown")

    def test_known_git_read_operations_remain_classified(self):
        self.assertEqual(annotate.classify("/bin/zsh -lc 'git show HEAD:source/index.js'")[0], "repo_discovery")
        self.assertEqual(annotate.classify("/bin/zsh -lc 'git status --short'")[0], "repo_discovery")


if __name__ == "__main__":
    unittest.main()
