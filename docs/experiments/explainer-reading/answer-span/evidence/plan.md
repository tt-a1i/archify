# Round 37: authored answer width

Problem: round36 NumPy paired view/copy programs have staggered desktop starts because the automatic conclusion shares the first row; adding an overview table repeats content and lengthens the page.

Hypothesis: optional @answer span=12 (formal answer.span integer 1..12, matching panels) can express a full-width conclusion followed by aligned paired panels without changing content or defaults. Reuse existing static packing and fixed-span browser behavior. No new runtime layout algorithm or grouping model.

Budget: 35 minutes / two implementation attempts; extend only for a concrete new failure. Fixed-input renderer/contract comparison, not an independent author or full-generation benchmark. The NumPy source, runtime, values and text remain frozen except the explicit answer span. Use real-repository benchmark convention with the existing NumPy discovery as context, not evidence of general author benefit.

Evidence: base rejects directive/new contract and fails exact static width; candidate parses/validates 1..12 and rejects invalid spans with location; static and browser placement preserve exact widths and phone stacking. Check NumPy before/after in 390/1440 light/dark, all styles after relayout, actual PNG export. Replay every existing index variant with frozen prepared inputs and require byte equality where answer span is absent. Focus parser/layout/renderer/browser suites, core and generated checks; regenerate validators and build ZIP twice with canonical Node, test extracted package. No merge, release, live install or human comprehension claim.
