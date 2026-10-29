# Can a wrapped diff preserve literal text? {#literal-diff}

The synthetic rows include repeated spaces and long strings. Their bytes and old/new line numbers must remain intact.

@answer scope="Illustrative literal-text fixture"
@meta locale=en style=clean

## Which string changes? {#change}

@diff id=literal-change caption="Synthetic long strings with repeated spaces"
```diff
@@ -1,3 +1,3 @@
 function message() {
-  const message = "alpha beta  alpha beta  alpha beta  alpha beta  alpha beta  alpha beta  alpha beta  alpha beta  alpha beta  alpha beta  alpha beta  alpha beta  OLD-END";
+  const message = "甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  甲方  乙方  NEW-END";
 }
```

## Where does the change end? {#after}

The closing brace belongs after the replaced string, and this paragraph belongs after the diff.
