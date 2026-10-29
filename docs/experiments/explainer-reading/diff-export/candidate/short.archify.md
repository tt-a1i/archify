# What does this one-line change say? {#short-diff}

The synthetic example changes a timeout from 100 to 200. It is a fitting-width control.

@answer scope="Illustrative diff fixture"
@meta locale=en style=editorial

## Which value changes? {#change}

@diff id=short-change caption="Synthetic timeout setting"
```diff
@@ -1 +1 @@
-timeout = 100
+timeout = 200
```

## What remains unchanged? {#after}

The old and new line numbers each start at one.
