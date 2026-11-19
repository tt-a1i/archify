/*! Python parser derived from microsoft/pyright 1.1.414 (MIT), Copyright Microsoft Corporation. See extract/py/upstream/LICENSE.txt and UPSTREAM.json. */

// extract/py/upstream/common/collectionUtils.ts
function appendArray(to, elementsToPush) {
  if (elementsToPush.length < 256) {
    to.push(...elementsToPush);
    return;
  }
  for (const elem of elementsToPush) {
    to.push(elem);
  }
}

// extract/py/upstream/common/debug.ts
function assert(expression, message, verboseDebugInfo, stackCrawlMark) {
  if (!expression) {
    if (verboseDebugInfo) {
      message += "\r\nVerbose Debug Information: " + (typeof verboseDebugInfo === "string" ? verboseDebugInfo : verboseDebugInfo());
    }
    fail(message ? "False expression: " + message : "False expression.", stackCrawlMark || assert);
  }
}
function fail(message, stackCrawlMark) {
  const e = new Error(message ? `Debug Failure. ${message}` : "Debug Failure.");
  if (Error.captureStackTrace) {
    Error.captureStackTrace(e, stackCrawlMark || fail);
  }
  throw e;
}

// extract/py/upstream/common/diagnostic.ts
var Diagnostic = class {
  constructor(category, message, range) {
    this.category = category;
    this.message = message;
    this.range = range;
  }
  category;
  message;
  range;
};

// extract/py/upstream/common/diagnosticSink.ts
var DiagnosticSink = class {
  diagnostics = [];
  keys = /* @__PURE__ */ new Set();
  fetchAndClear() {
    const result = this.diagnostics;
    this.diagnostics = [];
    this.keys.clear();
    return result;
  }
  addDiagnostic(diagnostic) {
    const { start, end } = diagnostic.range;
    const key = `${start.line}:${start.character}:${end.line}:${end.character}:${diagnostic.message}`;
    if (!this.keys.has(key)) {
      this.keys.add(key);
      this.diagnostics.push(diagnostic);
    }
    return diagnostic;
  }
  addError(message, range) {
    return this.addDiagnostic(new Diagnostic(0 /* Error */, message, range));
  }
};

// extract/py/upstream/common/positionUtils.ts
function convertOffsetToPosition(offset, lines) {
  if (lines.end === 0) {
    return {
      line: 0,
      character: 0
    };
  }
  const itemIndex = offset >= lines.end ? lines.count - 1 : lines.getItemContaining(offset);
  assert(itemIndex >= 0 && itemIndex <= lines.count);
  const lineRange = lines.getItemAt(itemIndex);
  assert(lineRange !== void 0);
  return {
    line: itemIndex,
    character: Math.max(0, Math.min(lineRange.length, offset - lineRange.start))
  };
}
function convertOffsetsToRange(startOffset, endOffset, lines) {
  const start = convertOffsetToPosition(startOffset, lines);
  if (lines.end !== 0 && endOffset >= startOffset) {
    const lineRange = lines.getItemAt(start.line);
    const lineEnd = lineRange.start + lineRange.length;
    if (endOffset >= lineRange.start && endOffset < lineEnd) {
      return {
        start,
        end: {
          line: start.line,
          character: endOffset - lineRange.start
        }
      };
    }
  }
  const end = convertOffsetToPosition(endOffset, lines);
  return { start, end };
}

// extract/py/upstream/common/pythonVersion.ts
var PythonVersion;
((PythonVersion2) => {
  function is(value) {
    if (value && typeof value.major === "number" && typeof value.minor === "number") {
      if (value.micro !== void 0 && typeof value.micro !== "number") {
        return false;
      }
      if (value.releaseLevel !== void 0 && typeof value.releaseLevel !== "string") {
        return false;
      }
      if (value.serial !== void 0 && typeof value.serial !== "number") {
        return false;
      }
      return true;
    }
    return false;
  }
  PythonVersion2.is = is;
  function create(major, minor, micro, releaseLevel, serial) {
    return {
      major,
      minor,
      micro,
      releaseLevel,
      serial
    };
  }
  PythonVersion2.create = create;
  function isEqualTo(version, other) {
    if (version.major !== other.major || version.minor !== other.minor) {
      return false;
    }
    if (version.micro === void 0 || other.micro === void 0) {
      return true;
    } else if (version.micro !== other.micro) {
      return false;
    }
    if (version.releaseLevel === void 0 || other.releaseLevel === void 0) {
      return true;
    } else if (version.releaseLevel !== other.releaseLevel) {
      return false;
    }
    if (version.serial === void 0 || other.serial === void 0) {
      return true;
    } else if (version.serial !== other.serial) {
      return false;
    }
    return true;
  }
  PythonVersion2.isEqualTo = isEqualTo;
  function isGreaterThan(version, other) {
    if (version.major > other.major) {
      return true;
    } else if (version.major < other.major) {
      return false;
    }
    if (version.minor > other.minor) {
      return true;
    } else if (version.minor < other.minor) {
      return false;
    }
    if (version.micro === void 0 || other.micro === void 0 || version.micro < other.micro) {
      return false;
    } else if (version.micro > other.micro) {
      return true;
    }
    if (version.releaseLevel === void 0 || other.releaseLevel === void 0 || version.releaseLevel < other.releaseLevel) {
      return false;
    } else if (version.releaseLevel > other.releaseLevel) {
      return true;
    }
    if (version.serial === void 0 || other.serial === void 0 || version.serial < other.serial) {
      return false;
    } else if (version.serial > other.serial) {
      return true;
    }
    return false;
  }
  PythonVersion2.isGreaterThan = isGreaterThan;
  function isGreaterOrEqualTo(version, other) {
    return isEqualTo(version, other) || isGreaterThan(version, other);
  }
  PythonVersion2.isGreaterOrEqualTo = isGreaterOrEqualTo;
  function isLessThan(version, other) {
    return !isGreaterOrEqualTo(version, other);
  }
  PythonVersion2.isLessThan = isLessThan;
  function isLessOrEqualTo(version, other) {
    return !isGreaterThan(version, other);
  }
  PythonVersion2.isLessOrEqualTo = isLessOrEqualTo;
  function toMajorMinorString(version) {
    return `${version.major}.${version.minor}`;
  }
  PythonVersion2.toMajorMinorString = toMajorMinorString;
  function toString(version) {
    let versString = toMajorMinorString(version);
    if (version.micro === void 0) {
      return versString;
    }
    versString += `.${version.micro}`;
    if (version.releaseLevel === void 0) {
      return versString;
    }
    versString += `.${version.releaseLevel}`;
    if (version.serial === void 0) {
      return versString;
    }
    versString += `.${version.serial}`;
    return versString;
  }
  PythonVersion2.toString = toString;
  function fromString(val) {
    const split = val.split(".");
    if (split.length < 2) {
      return void 0;
    }
    const major = parseInt(split[0], 10);
    const minor = parseInt(split[1], 10);
    if (isNaN(major) || isNaN(minor)) {
      return void 0;
    }
    let micro;
    if (split.length >= 3) {
      micro = parseInt(split[2], 10);
      if (isNaN(micro)) {
        micro = void 0;
      }
    }
    let releaseLevel;
    if (split.length >= 4) {
      const releaseLevels = ["alpha", "beta", "candidate", "final"];
      if (releaseLevels.some((level) => level === split[3])) {
        releaseLevel = split[3];
      }
    }
    let serial;
    if (split.length >= 5) {
      serial = parseInt(split[4], 10);
      if (isNaN(serial)) {
        serial = void 0;
      }
    }
    return create(major, minor, micro, releaseLevel, serial);
  }
  PythonVersion2.fromString = fromString;
})(PythonVersion || (PythonVersion = {}));
var pythonVersion3_0 = PythonVersion.create(3, 0);
var pythonVersion3_1 = PythonVersion.create(3, 1);
var pythonVersion3_2 = PythonVersion.create(3, 2);
var pythonVersion3_3 = PythonVersion.create(3, 3);
var pythonVersion3_4 = PythonVersion.create(3, 4);
var pythonVersion3_5 = PythonVersion.create(3, 5);
var pythonVersion3_6 = PythonVersion.create(3, 6);
var pythonVersion3_7 = PythonVersion.create(3, 7);
var pythonVersion3_8 = PythonVersion.create(3, 8);
var pythonVersion3_9 = PythonVersion.create(3, 9);
var pythonVersion3_10 = PythonVersion.create(3, 10);
var pythonVersion3_11 = PythonVersion.create(3, 11);
var pythonVersion3_12 = PythonVersion.create(3, 12);
var pythonVersion3_13 = PythonVersion.create(3, 13);
var pythonVersion3_14 = PythonVersion.create(3, 14);
var pythonVersion3_15 = PythonVersion.create(3, 15);
var latestStablePythonVersion = pythonVersion3_14;

// extract/py/upstream/common/textRange.ts
var TextRange;
((TextRange2) => {
  function create(start, length) {
    if (start < 0) {
      fail("start must be non-negative");
    }
    if (length < 0) {
      fail("length must be non-negative");
    }
    return { start, length };
  }
  TextRange2.create = create;
  function getEnd(range) {
    return range.start + range.length;
  }
  TextRange2.getEnd = getEnd;
  function contains(range, position) {
    return position >= range.start && position < getEnd(range);
  }
  TextRange2.contains = contains;
  function extend(range, extension) {
    let result = range;
    if (extension.start < result.start) {
      result = {
        start: extension.start,
        length: result.length + result.start - extension.start
      };
    }
    const extensionEnd = getEnd(extension);
    const resultEnd = getEnd(result);
    if (extensionEnd > resultEnd) {
      result = {
        start: result.start,
        length: result.length + extensionEnd - resultEnd
      };
    }
    return result;
  }
  TextRange2.extend = extend;
})(TextRange || (TextRange = {}));

// extract/py/upstream/localization/strings.ts
var strings_default = {
  "Diagnostic": {
    "annotationFormatString": {
      "message": "Type expressions cannot use format string literals (f-strings)",
      "comment": "'f-string' is the common English slang for a Python format string"
    },
    "annotationSpansStrings": "Type expressions cannot span multiple string literals",
    "annotationStringEscape": "Type expressions cannot contain escape characters",
    "assignmentExprInSubscript": "Assignment expressions within a subscript are supported only in Python 3.10 and newer",
    "awaitIllegal": {
      "message": 'Use of "await" requires Python 3.5 or newer',
      "comment": "{Locked='await'}"
    },
    "backticksIllegal": {
      "message": "Expressions surrounded by backticks are not supported in Python 3.x; use repr instead",
      "comment": "{Locked='repr'}"
    },
    "breakInExceptionGroup": {
      "message": '"break" is not allowed in an "except*" block',
      "comment": "{Locked='break','except*'}"
    },
    "breakOutsideLoop": {
      "message": '"break" can be used only within a loop',
      "comment": "{Locked='break'}"
    },
    "casePatternIsIrrefutable": "Irrefutable pattern is allowed only for the last case statement",
    "classTypeParametersIllegal": "Class type parameter syntax requires Python 3.12 or newer",
    "comprehensionInDict": {
      "message": "Comprehension cannot be used with other dictionary entries",
      "comment": "A comprehension is a 'set of looping and filtering instructions' applied to a collection to generate a new collection; the word may not be translatable"
    },
    "comprehensionInSet": {
      "message": "Comprehension cannot be used with other set entries",
      "comment": [
        "{Locked='set'}",
        "A comprehension is a 'set of looping and filtering instructions' applied to a collection to generate a new collection; the word may not be translatable"
      ]
    },
    "continueInExceptionGroup": {
      "message": '"continue" is not allowed in an "except*" block',
      "comment": "{Locked='continue','except*'}"
    },
    "continueOutsideLoop": {
      "message": '"continue" can be used only within a loop',
      "comment": "{Locked='continue'}"
    },
    "defaultValueNotAllowed": 'Parameter with "*" or "**" cannot have default value',
    "dictExpandIllegalInComprehension": {
      "message": "Dictionary expansion not allowed in comprehension",
      "comment": "A comprehension is a 'set of looping and filtering instructions' applied to a collection to generate a new collection; the word may not be translatable"
    },
    "dictKeyValuePairs": "Dictionary entries must contain key/value pairs",
    "duplicateArgsParam": 'Only one "*" parameter allowed',
    "duplicateCatchAll": {
      "message": "Only one catch-all except clause allowed",
      "comment": "{Locked='except'}"
    },
    "duplicateKwargsParam": 'Only one "**" parameter allowed',
    "duplicateKeywordOnly": 'Only one "*" separator allowed',
    "duplicateParam": 'Duplicate parameter "{name}"',
    "duplicateCapturePatternTarget": 'Capture target "{name}" cannot appear more than once within the same pattern',
    "duplicateStarPattern": 'Only one "*" pattern allowed in a pattern sequence',
    "duplicateStarStarPattern": 'Only one "**" entry allowed',
    "duplicatePositionOnly": 'Only one "/" parameter allowed',
    "duplicateUnpack": {
      "message": "Only one unpack operation allowed in list",
      "comment": "{Locked='list'}"
    },
    "exceptionGroupIncompatible": {
      "message": 'Exception group syntax ("except*") requires Python 3.11 or newer',
      "comment": "{Locked='except*'}"
    },
    "exceptGroupMismatch": {
      "message": 'Try statement cannot include both "except" and "except*"',
      "comment": "{Locked='except','except*'}"
    },
    "exceptGroupRequiresType": {
      "message": 'Exception group syntax ("except*") requires an exception type',
      "comment": "{Locked='except*'}"
    },
    "exceptRequiresParens": "Multiple exception types must be parenthesized prior to Python 3.14",
    "exceptWithAsRequiresParens": 'Multiple exception types must be parenthesized when using "as"',
    "expectedAfterDecorator": "Expected function or class declaration after decorator",
    "expectedArrow": 'Expected "->" followed by return type annotation',
    "expectedAssignRightHandExpr": 'Expected expression to the right of "="',
    "expectedBinaryRightHandExpr": "Expected expression to the right of operator",
    "expectedCase": {
      "message": 'Expected "case" statement',
      "comment": "{Locked='case'}"
    },
    "expectedClassName": "Expected class name",
    "expectedCloseBrace": '"{" was not closed',
    "expectedCloseBracket": '"[" was not closed',
    "expectedCloseParen": '"(" was not closed',
    "expectedColon": 'Expected ":"',
    "expectedComplexNumberLiteral": {
      "message": "Expected complex number literal for pattern matching",
      "comment": "Complex numbers are a mathematical concept consisting of a real number and an imaginary number"
    },
    "expectedDecoratorExpr": "Expression form not supported for decorator prior to Python 3.9",
    "expectedDecoratorNewline": "Expected new line at end of decorator",
    "expectedDelExpr": {
      "message": 'Expected expression after "del"',
      "comment": "{Locked='del'}"
    },
    "expectedElse": {
      "message": 'Expected "else"',
      "comment": "{Locked='else'}"
    },
    "expectedEquals": 'Expected "="',
    "expectedExpr": "Expected expression",
    "expectedIdentifier": "Expected identifier",
    "expectedImport": {
      "message": 'Expected "import"',
      "comment": "{Locked='import'}"
    },
    "expectedImportAlias": {
      "message": 'Expected symbol after "as"',
      "comment": "{Locked='as'}"
    },
    "expectedImportSymbols": {
      "message": 'Expected one or more symbol names after "import"',
      "comment": "{Locked='import'}"
    },
    "expectedIndentedBlock": "Expected indented block",
    "expectedIn": {
      "message": 'Expected "in"',
      "comment": "{Locked='in'}"
    },
    "expectedInExpr": {
      "message": 'Expected expression after "in"',
      "comment": "{Locked='in'}"
    },
    "expectedFunctionAfterAsync": {
      "message": 'Expected function definition after "async"',
      "comment": "{Locked='async'}"
    },
    "expectedFunctionName": {
      "message": 'Expected function name after "def"',
      "comment": "{Locked='def'}"
    },
    "expectedMemberName": 'Expected attribute name after "."',
    "expectedModuleName": "Expected module name",
    "expectedNameAfterAs": {
      "message": 'Expected symbol name after "as"',
      "comment": "{Locked='as'}"
    },
    "expectedNamedParameter": 'Keyword parameter must follow "*"',
    "expectedNewline": "Expected newline",
    "expectedNewlineOrSemicolon": "Statements must be separated by newlines or semicolons",
    "expectedOpenParen": 'Expected "("',
    "expectedParamName": "Expected parameter name",
    "expectedPatternExpr": "Expected pattern expression",
    "expectedPatternValue": {
      "message": 'Expected pattern value expression of the form "a.b"',
      "comment": "{Locked='a.b'}"
    },
    "expectedReturnExpr": {
      "message": 'Expected expression after "return"',
      "comment": "{Locked='return'}"
    },
    "expectedSliceIndex": "Expected index or slice expression",
    "expectedTypeParameterName": "Expected type parameter name",
    "expectedYieldExpr": {
      "message": "Expected expression in yield statement",
      "comment": "{Locked='yield'}"
    },
    "finallyBreak": {
      "message": 'A "break" cannot be used to exit a "finally" block',
      "comment": "{Locked='break', 'finally'}"
    },
    "finallyContinue": {
      "message": 'A "continue" cannot be used to exit a "finally" block',
      "comment": "{Locked='continue', 'finally'}"
    },
    "finallyReturn": {
      "message": 'A "return" cannot be used to exit a "finally" block',
      "comment": "{Locked='return', 'finally'}"
    },
    "formatStringBrace": {
      "message": "Single close brace not allowed within f-string literal; use double close brace",
      "comment": "'f-string' is the common English slang for a Python format string"
    },
    "formatStringBytes": {
      "message": "Format string literals (f-strings) cannot be binary",
      "comment": "'f-string' is the common English slang for a Python format string"
    },
    "formatStringDebuggingIllegal": {
      "message": 'F-string debugging specifier "=" requires Python 3.8 or newer',
      "comment": "'f-string' is the common English slang for a Python format string"
    },
    "formatStringExpectedConversion": {
      "message": 'Expected a conversion specifier after "!" in f-string',
      "comment": "'f-string' is the common English slang for a Python format string"
    },
    "formatStringInPattern": "Format string not allowed in pattern",
    "formatStringIllegal": {
      "message": "Format string literals (f-strings) require Python 3.6 or newer",
      "comment": "'f-string' is the common English slang for a Python format string"
    },
    "formatStringNestedFormatSpecifier": "Expressions nested too deeply within format string specifier",
    "formatStringTemplate": {
      "message": "Format string literals (f-strings) cannot also be template strings (t-strings)",
      "comment": "'f-string' is the common English slang for a Python format string, 't-string' is the common English slang for a Python template string"
    },
    "formatStringUnicode": {
      "message": "Format string literals (f-strings) cannot be unicode",
      "comment": "'f-string' is the common English slang for a Python format string"
    },
    "formatStringUnterminated": {
      "message": 'Unterminated expression in f-string; expecting "}"',
      "comment": "'f-string' is the common English slang for a Python format string"
    },
    "functionTypeParametersIllegal": "Function type parameter syntax requires Python 3.12 or newer",
    "generatorNotParenthesized": "Generator expressions must be parenthesized if not sole argument",
    "inconsistentIndent": "Unindent amount does not match previous indent",
    "inconsistentTabs": "Inconsistent use of tabs and spaces in indentation",
    "invalidIdentifierChar": "Invalid character in identifier",
    "invalidTokenChars": 'Invalid character "{text}" in token',
    "keyValueInSet": {
      "message": "Key/value pairs are not allowed within a set",
      "comment": "{Locked='set'}"
    },
    "keywordOnlyAfterArgs": 'Keyword-only argument separator not allowed after "*" parameter',
    "keywordParameterMissing": 'One or more keyword parameters must follow "*" parameter',
    "keywordSubscriptIllegal": "Keyword arguments within subscripts are not supported",
    "lazyImportIllegal": "Lazy import statement requires Python 3.15 or newer",
    "lazyImportWildcardIllegal": "Wildcard imports cannot be used with 'lazy'",
    "matchIncompatible": {
      "message": "Match statements require Python 3.10 or newer",
      "comment": [
        "{StrContains=i'match'}",
        "'match' is a keyword and should not be localized. It is only capitalized here because it is the first word in the sentence"
      ]
    },
    "maxParseDepthExceeded": "Maximum parse depth exceeded; break expression into smaller sub-expressions",
    "namedExceptAfterCatchAll": {
      "message": "A named except clause cannot appear after catch-all except clause",
      "comment": "{Locked='except'}"
    },
    "nonDefaultAfterDefault": "Non-default argument follows default argument",
    "operatorLessOrGreaterDeprecated": 'Operator "<>" is not supported in Python 3; use "!=" instead',
    "orPatternIrrefutable": {
      "message": 'Irrefutable pattern allowed only as the last subpattern in an "or" pattern',
      "comment": "{Locked='or'}"
    },
    "orPatternMissingName": {
      "message": 'All subpatterns within an "or" pattern must target the same names',
      "comment": "{Locked='or'}"
    },
    "paramAfterKwargsParam": 'Parameter cannot follow "**" parameter',
    "parenthesizedContextManagerIllegal": {
      "message": 'Parentheses within "with" statement requires Python 3.9 or newer',
      "comment": "{Locked='with'}"
    },
    "positionArgAfterNamedArg": "Positional argument cannot appear after keyword arguments",
    "positionArgAfterUnpackedDictArg": "Positional argument cannot appear after keyword argument unpacking",
    "positionOnlyAfterArgs": 'Position-only parameter separator not allowed after "*" parameter',
    "positionOnlyAfterKeywordOnly": '"/" parameter must appear before "*" parameter',
    "positionOnlyIncompatible": "Position-only parameter separator requires Python 3.8 or newer",
    "positionOnlyFirstParam": "Position-only parameter separator not allowed as first parameter",
    "relativeImportNotAllowed": {
      "message": 'Relative imports cannot be used with "import .a" form; use "from . import a" instead',
      "comment": "{Locked='import .a','from . import a'}"
    },
    "returnInExceptionGroup": {
      "message": '"return" is not allowed in an "except*" block',
      "comment": "{Locked='return','except*'}"
    },
    "returnOutsideFunction": {
      "message": '"return" can be used only within a function',
      "comment": "{Locked='return'}"
    },
    "starPatternInAsPattern": {
      "message": 'Star pattern cannot be used with "as" target',
      "comment": [
        "{Locked='as'}",
        "Star pattern refers to the use of the * (star) character to represent a variable length pattern match"
      ]
    },
    "starPatternInOrPattern": {
      "message": "Star pattern cannot be ORed within other patterns",
      "comment": [
        "Star pattern refers to the use of the * (star) character to represent a variable length pattern match",
        "'ORed' means joined together with a binary 'or' operation"
      ]
    },
    "starStarWildcardNotAllowed": '** cannot be used with wildcard "_"',
    "stringNonAsciiBytes": {
      "message": "Non-ASCII character not allowed in bytes string literal",
      "comment": "{Locked='ASCII'}"
    },
    "stringUnterminated": "String literal is unterminated",
    "sublistParamsIncompatible": {
      "message": "Sublist parameters are not supported in Python 3.x",
      "comment": "{StrContains=i'sublist'}"
    },
    "templateStringBytes": {
      "message": "Template string literals (t-strings) cannot be binary",
      "comment": "'t-string' is the common English slang for a Python template string"
    },
    "templateStringIllegal": {
      "message": "Template string literals (t-strings) require Python 3.14 or newer",
      "comment": "'t-string' is the common English slang for a Python template string"
    },
    "templateStringUnicode": {
      "message": "Template string literals (t-strings) cannot be unicode",
      "comment": "'t-string' is the common English slang for a Python template string"
    },
    "trailingCommaInFromImport": "Trailing comma not allowed without surrounding parentheses",
    "tryWithoutExcept": {
      "message": "Try statement must have at least one except or finally clause",
      "comment": [
        "{Locked='except','finally'}",
        "{StrContains=i'try'}",
        "'try' is a keyword and should not be localized. It is only capitalized here because it is the first word in the sentence"
      ]
    },
    "typeAliasStatementIllegal": "Type alias statement requires Python 3.12 or newer",
    "typeParameterBoundNotAllowed": {
      "message": "Bound or constraint cannot be used with a variadic type parameter or ParamSpec",
      "comment": [
        "{Locked='ParamSpec'}",
        "'variadic' means that it accepts a variable number of arguments"
      ]
    },
    "typeParametersMissing": "At least one type parameter must be specified",
    "typeVarDefaultIllegal": "Type variable default types require Python 3.13 or newer",
    "unexpectedAsyncToken": {
      "message": 'Expected "def", "with" or "for" to follow "async"',
      "comment": "{Locked='def','with','for','async'}"
    },
    "unexpectedEof": "Unexpected EOF",
    "unexpectedExprToken": "Unexpected token at end of expression",
    "unexpectedIndent": "Unexpected indentation",
    "unexpectedUnindent": "Unindent not expected",
    "unpackedDictSubscriptIllegal": "Dictionary unpack operator in subscript is not allowed",
    "unpackedSubscriptIllegal": "Unpack operator in subscript requires Python 3.11 or newer",
    "unpackIllegalInComprehension": {
      "message": "Unpack operation not allowed in comprehension",
      "comment": "A comprehension is a 'set of looping and filtering instructions' applied to a collection to generate a new collection; the word may not be translatable"
    },
    "unpackInDict": "Unpack operation not allowed in dictionaries",
    "unpackInSet": {
      "message": "Unpack operator not allowed within a set",
      "comment": "{Locked='set'}"
    },
    "unpackOperatorNotAllowed": "Unpack operation is not allowed in this context",
    "unpackTuplesIllegal": {
      "message": "Unpack operation not allowed in tuples prior to Python 3.8",
      "comment": "'tuple' is a keyword and should not be localized, but here it is pluralized"
    },
    "varAnnotationIllegal": {
      "message": "Type annotations for variables requires Python 3.6 or newer; use type comment for compatibility with previous versions",
      "comment": "{Locked='type'}"
    },
    "walrusIllegal": 'Operator ":=" requires Python 3.8 or newer',
    "walrusNotAllowed": 'Operator ":=" is not allowed in this context without surrounding parentheses',
    "walrusNotAllowedInComprehension": 'Operator ":=" is not allowed within a comprehension iterable expression',
    "yieldFromIllegal": {
      "message": 'Use of "yield from" requires Python 3.3 or newer',
      "comment": "{Locked='yield from'}"
    },
    "zeroCaseStatementsFound": {
      "message": "Match statement must include at least one case statement",
      "comment": [
        "{Locked='case'}",
        "{StrContains=i'match'}",
        "'match' is a keyword and should not be localized. It is only capitalized here because it is the first word in the sentence"
      ]
    }
  },
  "DiagnosticAddendum": {
    "orPatternMissingName": "Missing names: {name}"
  }
};

// extract/py/upstream/localization/localize.ts
var ParameterizedString = class {
  constructor(_formatString) {
    this._formatString = _formatString;
  }
  _formatString;
  format(params) {
    let str = this._formatString;
    Object.keys(params).forEach((key) => {
      str = str.replace(new RegExp(`{${key}}`, "g"), params[key].toString());
    });
    return str;
  }
  getFormatString() {
    return this._formatString;
  }
};
function getRawString(key) {
  const [group, name] = key.split(".");
  const value = strings_default[group]?.[name];
  if (!value) throw new Error(`Missing parser diagnostic: ${key}`);
  return typeof value === "string" ? value : value.message;
}
var Localizer;
((Localizer2) => {
  let Diagnostic2;
  ((Diagnostic3) => {
    Diagnostic3.annotationFormatString = () => getRawString("Diagnostic.annotationFormatString");
    Diagnostic3.annotationSpansStrings = () => getRawString("Diagnostic.annotationSpansStrings");
    Diagnostic3.annotationStringEscape = () => getRawString("Diagnostic.annotationStringEscape");
    Diagnostic3.assignmentExprInSubscript = () => getRawString("Diagnostic.assignmentExprInSubscript");
    Diagnostic3.awaitIllegal = () => getRawString("Diagnostic.awaitIllegal");
    Diagnostic3.backticksIllegal = () => getRawString("Diagnostic.backticksIllegal");
    Diagnostic3.breakInExceptionGroup = () => getRawString("Diagnostic.breakInExceptionGroup");
    Diagnostic3.breakOutsideLoop = () => getRawString("Diagnostic.breakOutsideLoop");
    Diagnostic3.casePatternIsIrrefutable = () => getRawString("Diagnostic.casePatternIsIrrefutable");
    Diagnostic3.classTypeParametersIllegal = () => getRawString("Diagnostic.classTypeParametersIllegal");
    Diagnostic3.comprehensionInDict = () => getRawString("Diagnostic.comprehensionInDict");
    Diagnostic3.comprehensionInSet = () => getRawString("Diagnostic.comprehensionInSet");
    Diagnostic3.continueInExceptionGroup = () => getRawString("Diagnostic.continueInExceptionGroup");
    Diagnostic3.continueOutsideLoop = () => getRawString("Diagnostic.continueOutsideLoop");
    Diagnostic3.defaultValueNotAllowed = () => getRawString("Diagnostic.defaultValueNotAllowed");
    Diagnostic3.dictExpandIllegalInComprehension = () => getRawString("Diagnostic.dictExpandIllegalInComprehension");
    Diagnostic3.dictKeyValuePairs = () => getRawString("Diagnostic.dictKeyValuePairs");
    Diagnostic3.duplicateArgsParam = () => getRawString("Diagnostic.duplicateArgsParam");
    Diagnostic3.duplicateCatchAll = () => getRawString("Diagnostic.duplicateCatchAll");
    Diagnostic3.duplicateKwargsParam = () => getRawString("Diagnostic.duplicateKwargsParam");
    Diagnostic3.duplicateKeywordOnly = () => getRawString("Diagnostic.duplicateKeywordOnly");
    Diagnostic3.duplicateParam = () => new ParameterizedString(getRawString("Diagnostic.duplicateParam"));
    Diagnostic3.duplicateCapturePatternTarget = () => new ParameterizedString(getRawString("Diagnostic.duplicateCapturePatternTarget"));
    Diagnostic3.duplicateStarPattern = () => getRawString("Diagnostic.duplicateStarPattern");
    Diagnostic3.duplicateStarStarPattern = () => getRawString("Diagnostic.duplicateStarStarPattern");
    Diagnostic3.duplicatePositionOnly = () => getRawString("Diagnostic.duplicatePositionOnly");
    Diagnostic3.duplicateUnpack = () => getRawString("Diagnostic.duplicateUnpack");
    Diagnostic3.exceptionGroupIncompatible = () => getRawString("Diagnostic.exceptionGroupIncompatible");
    Diagnostic3.exceptGroupMismatch = () => getRawString("Diagnostic.exceptGroupMismatch");
    Diagnostic3.exceptGroupRequiresType = () => getRawString("Diagnostic.exceptGroupRequiresType");
    Diagnostic3.exceptRequiresParens = () => getRawString("Diagnostic.exceptRequiresParens");
    Diagnostic3.exceptWithAsRequiresParens = () => getRawString("Diagnostic.exceptWithAsRequiresParens");
    Diagnostic3.expectedAfterDecorator = () => getRawString("Diagnostic.expectedAfterDecorator");
    Diagnostic3.expectedArrow = () => getRawString("Diagnostic.expectedArrow");
    Diagnostic3.expectedAssignRightHandExpr = () => getRawString("Diagnostic.expectedAssignRightHandExpr");
    Diagnostic3.expectedBinaryRightHandExpr = () => getRawString("Diagnostic.expectedBinaryRightHandExpr");
    Diagnostic3.expectedCase = () => getRawString("Diagnostic.expectedCase");
    Diagnostic3.expectedClassName = () => getRawString("Diagnostic.expectedClassName");
    Diagnostic3.expectedCloseBrace = () => getRawString("Diagnostic.expectedCloseBrace");
    Diagnostic3.expectedCloseBracket = () => getRawString("Diagnostic.expectedCloseBracket");
    Diagnostic3.expectedCloseParen = () => getRawString("Diagnostic.expectedCloseParen");
    Diagnostic3.expectedColon = () => getRawString("Diagnostic.expectedColon");
    Diagnostic3.expectedComplexNumberLiteral = () => getRawString("Diagnostic.expectedComplexNumberLiteral");
    Diagnostic3.expectedDecoratorExpr = () => getRawString("Diagnostic.expectedDecoratorExpr");
    Diagnostic3.expectedDecoratorNewline = () => getRawString("Diagnostic.expectedDecoratorNewline");
    Diagnostic3.expectedDelExpr = () => getRawString("Diagnostic.expectedDelExpr");
    Diagnostic3.expectedElse = () => getRawString("Diagnostic.expectedElse");
    Diagnostic3.expectedEquals = () => getRawString("Diagnostic.expectedEquals");
    Diagnostic3.expectedExpr = () => getRawString("Diagnostic.expectedExpr");
    Diagnostic3.expectedIdentifier = () => getRawString("Diagnostic.expectedIdentifier");
    Diagnostic3.expectedImport = () => getRawString("Diagnostic.expectedImport");
    Diagnostic3.expectedImportAlias = () => getRawString("Diagnostic.expectedImportAlias");
    Diagnostic3.expectedImportSymbols = () => getRawString("Diagnostic.expectedImportSymbols");
    Diagnostic3.expectedIndentedBlock = () => getRawString("Diagnostic.expectedIndentedBlock");
    Diagnostic3.expectedIn = () => getRawString("Diagnostic.expectedIn");
    Diagnostic3.expectedInExpr = () => getRawString("Diagnostic.expectedInExpr");
    Diagnostic3.expectedFunctionAfterAsync = () => getRawString("Diagnostic.expectedFunctionAfterAsync");
    Diagnostic3.expectedFunctionName = () => getRawString("Diagnostic.expectedFunctionName");
    Diagnostic3.expectedMemberName = () => getRawString("Diagnostic.expectedMemberName");
    Diagnostic3.expectedModuleName = () => getRawString("Diagnostic.expectedModuleName");
    Diagnostic3.expectedNameAfterAs = () => getRawString("Diagnostic.expectedNameAfterAs");
    Diagnostic3.expectedNamedParameter = () => getRawString("Diagnostic.expectedNamedParameter");
    Diagnostic3.expectedNewline = () => getRawString("Diagnostic.expectedNewline");
    Diagnostic3.expectedNewlineOrSemicolon = () => getRawString("Diagnostic.expectedNewlineOrSemicolon");
    Diagnostic3.expectedOpenParen = () => getRawString("Diagnostic.expectedOpenParen");
    Diagnostic3.expectedParamName = () => getRawString("Diagnostic.expectedParamName");
    Diagnostic3.expectedPatternExpr = () => getRawString("Diagnostic.expectedPatternExpr");
    Diagnostic3.expectedPatternValue = () => getRawString("Diagnostic.expectedPatternValue");
    Diagnostic3.expectedReturnExpr = () => getRawString("Diagnostic.expectedReturnExpr");
    Diagnostic3.expectedSliceIndex = () => getRawString("Diagnostic.expectedSliceIndex");
    Diagnostic3.expectedTypeParameterName = () => getRawString("Diagnostic.expectedTypeParameterName");
    Diagnostic3.expectedYieldExpr = () => getRawString("Diagnostic.expectedYieldExpr");
    Diagnostic3.finallyBreak = () => getRawString("Diagnostic.finallyBreak");
    Diagnostic3.finallyContinue = () => getRawString("Diagnostic.finallyContinue");
    Diagnostic3.finallyReturn = () => getRawString("Diagnostic.finallyReturn");
    Diagnostic3.formatStringBrace = () => getRawString("Diagnostic.formatStringBrace");
    Diagnostic3.formatStringBytes = () => getRawString("Diagnostic.formatStringBytes");
    Diagnostic3.formatStringDebuggingIllegal = () => getRawString("Diagnostic.formatStringDebuggingIllegal");
    Diagnostic3.formatStringExpectedConversion = () => getRawString("Diagnostic.formatStringExpectedConversion");
    Diagnostic3.formatStringInPattern = () => getRawString("Diagnostic.formatStringInPattern");
    Diagnostic3.formatStringIllegal = () => getRawString("Diagnostic.formatStringIllegal");
    Diagnostic3.formatStringNestedFormatSpecifier = () => getRawString("Diagnostic.formatStringNestedFormatSpecifier");
    Diagnostic3.formatStringTemplate = () => getRawString("Diagnostic.formatStringTemplate");
    Diagnostic3.formatStringUnicode = () => getRawString("Diagnostic.formatStringUnicode");
    Diagnostic3.formatStringUnterminated = () => getRawString("Diagnostic.formatStringUnterminated");
    Diagnostic3.functionTypeParametersIllegal = () => getRawString("Diagnostic.functionTypeParametersIllegal");
    Diagnostic3.generatorNotParenthesized = () => getRawString("Diagnostic.generatorNotParenthesized");
    Diagnostic3.inconsistentIndent = () => getRawString("Diagnostic.inconsistentIndent");
    Diagnostic3.inconsistentTabs = () => getRawString("Diagnostic.inconsistentTabs");
    Diagnostic3.invalidIdentifierChar = () => getRawString("Diagnostic.invalidIdentifierChar");
    Diagnostic3.invalidTokenChars = () => new ParameterizedString(getRawString("Diagnostic.invalidTokenChars"));
    Diagnostic3.keyValueInSet = () => getRawString("Diagnostic.keyValueInSet");
    Diagnostic3.keywordOnlyAfterArgs = () => getRawString("Diagnostic.keywordOnlyAfterArgs");
    Diagnostic3.keywordParameterMissing = () => getRawString("Diagnostic.keywordParameterMissing");
    Diagnostic3.keywordSubscriptIllegal = () => getRawString("Diagnostic.keywordSubscriptIllegal");
    Diagnostic3.lazyImportIllegal = () => getRawString("Diagnostic.lazyImportIllegal");
    Diagnostic3.lazyImportWildcardIllegal = () => getRawString("Diagnostic.lazyImportWildcardIllegal");
    Diagnostic3.matchIncompatible = () => getRawString("Diagnostic.matchIncompatible");
    Diagnostic3.maxParseDepthExceeded = () => getRawString("Diagnostic.maxParseDepthExceeded");
    Diagnostic3.namedExceptAfterCatchAll = () => getRawString("Diagnostic.namedExceptAfterCatchAll");
    Diagnostic3.nonDefaultAfterDefault = () => getRawString("Diagnostic.nonDefaultAfterDefault");
    Diagnostic3.operatorLessOrGreaterDeprecated = () => getRawString("Diagnostic.operatorLessOrGreaterDeprecated");
    Diagnostic3.orPatternIrrefutable = () => getRawString("Diagnostic.orPatternIrrefutable");
    Diagnostic3.orPatternMissingName = () => getRawString("Diagnostic.orPatternMissingName");
    Diagnostic3.paramAfterKwargsParam = () => getRawString("Diagnostic.paramAfterKwargsParam");
    Diagnostic3.parenthesizedContextManagerIllegal = () => getRawString("Diagnostic.parenthesizedContextManagerIllegal");
    Diagnostic3.positionArgAfterNamedArg = () => getRawString("Diagnostic.positionArgAfterNamedArg");
    Diagnostic3.positionArgAfterUnpackedDictArg = () => getRawString("Diagnostic.positionArgAfterUnpackedDictArg");
    Diagnostic3.positionOnlyAfterArgs = () => getRawString("Diagnostic.positionOnlyAfterArgs");
    Diagnostic3.positionOnlyAfterKeywordOnly = () => getRawString("Diagnostic.positionOnlyAfterKeywordOnly");
    Diagnostic3.positionOnlyIncompatible = () => getRawString("Diagnostic.positionOnlyIncompatible");
    Diagnostic3.positionOnlyFirstParam = () => getRawString("Diagnostic.positionOnlyFirstParam");
    Diagnostic3.relativeImportNotAllowed = () => getRawString("Diagnostic.relativeImportNotAllowed");
    Diagnostic3.returnInExceptionGroup = () => getRawString("Diagnostic.returnInExceptionGroup");
    Diagnostic3.returnOutsideFunction = () => getRawString("Diagnostic.returnOutsideFunction");
    Diagnostic3.starPatternInAsPattern = () => getRawString("Diagnostic.starPatternInAsPattern");
    Diagnostic3.starPatternInOrPattern = () => getRawString("Diagnostic.starPatternInOrPattern");
    Diagnostic3.starStarWildcardNotAllowed = () => getRawString("Diagnostic.starStarWildcardNotAllowed");
    Diagnostic3.stringNonAsciiBytes = () => getRawString("Diagnostic.stringNonAsciiBytes");
    Diagnostic3.stringUnterminated = () => getRawString("Diagnostic.stringUnterminated");
    Diagnostic3.sublistParamsIncompatible = () => getRawString("Diagnostic.sublistParamsIncompatible");
    Diagnostic3.templateStringBytes = () => getRawString("Diagnostic.templateStringBytes");
    Diagnostic3.templateStringIllegal = () => getRawString("Diagnostic.templateStringIllegal");
    Diagnostic3.templateStringUnicode = () => getRawString("Diagnostic.templateStringUnicode");
    Diagnostic3.trailingCommaInFromImport = () => getRawString("Diagnostic.trailingCommaInFromImport");
    Diagnostic3.tryWithoutExcept = () => getRawString("Diagnostic.tryWithoutExcept");
    Diagnostic3.typeAliasStatementIllegal = () => getRawString("Diagnostic.typeAliasStatementIllegal");
    Diagnostic3.typeParameterBoundNotAllowed = () => getRawString("Diagnostic.typeParameterBoundNotAllowed");
    Diagnostic3.typeParametersMissing = () => getRawString("Diagnostic.typeParametersMissing");
    Diagnostic3.typeVarDefaultIllegal = () => getRawString("Diagnostic.typeVarDefaultIllegal");
    Diagnostic3.unexpectedAsyncToken = () => getRawString("Diagnostic.unexpectedAsyncToken");
    Diagnostic3.unexpectedEof = () => getRawString("Diagnostic.unexpectedEof");
    Diagnostic3.unexpectedExprToken = () => getRawString("Diagnostic.unexpectedExprToken");
    Diagnostic3.unexpectedIndent = () => getRawString("Diagnostic.unexpectedIndent");
    Diagnostic3.unexpectedUnindent = () => getRawString("Diagnostic.unexpectedUnindent");
    Diagnostic3.unpackedDictSubscriptIllegal = () => getRawString("Diagnostic.unpackedDictSubscriptIllegal");
    Diagnostic3.unpackedSubscriptIllegal = () => getRawString("Diagnostic.unpackedSubscriptIllegal");
    Diagnostic3.unpackIllegalInComprehension = () => getRawString("Diagnostic.unpackIllegalInComprehension");
    Diagnostic3.unpackInDict = () => getRawString("Diagnostic.unpackInDict");
    Diagnostic3.unpackInSet = () => getRawString("Diagnostic.unpackInSet");
    Diagnostic3.unpackOperatorNotAllowed = () => getRawString("Diagnostic.unpackOperatorNotAllowed");
    Diagnostic3.unpackTuplesIllegal = () => getRawString("Diagnostic.unpackTuplesIllegal");
    Diagnostic3.varAnnotationIllegal = () => getRawString("Diagnostic.varAnnotationIllegal");
    Diagnostic3.walrusIllegal = () => getRawString("Diagnostic.walrusIllegal");
    Diagnostic3.walrusNotAllowed = () => getRawString("Diagnostic.walrusNotAllowed");
    Diagnostic3.walrusNotAllowedInComprehension = () => getRawString("Diagnostic.walrusNotAllowedInComprehension");
    Diagnostic3.yieldFromIllegal = () => getRawString("Diagnostic.yieldFromIllegal");
    Diagnostic3.zeroCaseStatementsFound = () => getRawString("Diagnostic.zeroCaseStatementsFound");
  })(Diagnostic2 = Localizer2.Diagnostic || (Localizer2.Diagnostic = {}));
  let DiagnosticAddendum;
  ((DiagnosticAddendum2) => {
    DiagnosticAddendum2.orPatternMissingName = () => new ParameterizedString(getRawString("DiagnosticAddendum.orPatternMissingName"));
  })(DiagnosticAddendum = Localizer2.DiagnosticAddendum || (Localizer2.DiagnosticAddendum = {}));
})(Localizer || (Localizer = {}));
var LocMessage = Localizer.Diagnostic;
var LocAddendum = Localizer.DiagnosticAddendum;

// extract/py/upstream/parser/tokenizerTypes.ts
var softKeywords = [
  9 /* Debug */,
  26 /* Match */,
  6 /* Case */,
  36 /* Type */,
  25 /* Lazy */
];
var Token;
((Token4) => {
  function create(type, start, length) {
    return {
      start,
      length,
      type
    };
  }
  Token4.create = create;
})(Token || (Token = {}));
var IndentToken;
((IndentToken3) => {
  function create(start, length, indentAmount, isIndentAmbiguous) {
    return {
      start,
      length,
      type: 3 /* Indent */,
      isIndentAmbiguous,
      indentAmount
    };
  }
  IndentToken3.create = create;
})(IndentToken || (IndentToken = {}));
var DedentToken;
((DedentToken3) => {
  function create(start, length, indentAmount, matchesIndent, isDedentAmbiguous) {
    return {
      start,
      length,
      type: 4 /* Dedent */,
      indentAmount,
      matchesIndent,
      isDedentAmbiguous
    };
  }
  DedentToken3.create = create;
})(DedentToken || (DedentToken = {}));
var NewLineToken;
((NewLineToken2) => {
  function create(start, length, newLineType) {
    return {
      start,
      length,
      type: 2 /* NewLine */,
      newLineType
    };
  }
  NewLineToken2.create = create;
})(NewLineToken || (NewLineToken = {}));
var KeywordToken;
((KeywordToken3) => {
  function create(start, length, keywordType) {
    return {
      start,
      length,
      type: 8 /* Keyword */,
      keywordType
    };
  }
  KeywordToken3.create = create;
  function isSoftKeyword(token) {
    return softKeywords.some((t) => token.keywordType === t);
  }
  KeywordToken3.isSoftKeyword = isSoftKeyword;
})(KeywordToken || (KeywordToken = {}));
var StringToken;
((StringToken4) => {
  function create(start, length, flags, escapedValue, prefixLength) {
    const quoteMarkLength = flags & 4 /* Triplicate */ ? 3 : 1;
    return {
      start,
      length,
      type: 5 /* String */,
      flags,
      escapedValue,
      prefixLength,
      quoteMarkLength
    };
  }
  StringToken4.create = create;
})(StringToken || (StringToken = {}));
var FStringStartToken;
((FStringStartToken4) => {
  function create(start, length, flags, prefixLength) {
    const quoteMarkLength = flags & 4 /* Triplicate */ ? 3 : 1;
    return {
      start,
      length,
      type: 24 /* FStringStart */,
      flags,
      prefixLength,
      quoteMarkLength
    };
  }
  FStringStartToken4.create = create;
})(FStringStartToken || (FStringStartToken = {}));
var FStringMiddleToken;
((FStringMiddleToken5) => {
  function create(start, length, flags, escapedValue) {
    const token = {
      start,
      length,
      type: 25 /* FStringMiddle */,
      flags,
      escapedValue
    };
    return token;
  }
  FStringMiddleToken5.create = create;
})(FStringMiddleToken || (FStringMiddleToken = {}));
var FStringEndToken;
((FStringEndToken4) => {
  function create(start, length, flags) {
    const token = {
      start,
      length,
      type: 26 /* FStringEnd */,
      flags
    };
    return token;
  }
  FStringEndToken4.create = create;
})(FStringEndToken || (FStringEndToken = {}));
var NumberToken;
((NumberToken4) => {
  function create(start, length, value, isInteger, isImaginary) {
    return {
      start,
      length,
      type: 6 /* Number */,
      isInteger,
      isImaginary,
      value
    };
  }
  NumberToken4.create = create;
})(NumberToken || (NumberToken = {}));
var OperatorToken;
((OperatorToken3) => {
  function create(start, length, operatorType) {
    return {
      start,
      length,
      type: 9 /* Operator */,
      operatorType
    };
  }
  OperatorToken3.create = create;
})(OperatorToken || (OperatorToken = {}));
var IdentifierToken;
((IdentifierToken3) => {
  function create(start, length, value) {
    let normalizedValue = value;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 127) {
        normalizedValue = value.normalize("NFKC");
        break;
      }
    }
    return {
      start,
      length,
      type: 7 /* Identifier */,
      value: normalizedValue
    };
  }
  IdentifierToken3.create = create;
})(IdentifierToken || (IdentifierToken = {}));

// extract/py/upstream/parser/parseNodes.ts
var _nextNodeId = 1;
function getNextNodeId() {
  return _nextNodeId++;
}
function extendRange(node, newRange) {
  const extendedRange = TextRange.extend(node, newRange);
  node.start = extendedRange.start;
  node.length = extendedRange.length;
}
var ModuleNode;
((ModuleNode3) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 36 /* Module */,
      id: _nextNodeId++,
      parent: void 0,
      d: { statements: [] }
    };
    return node;
  }
  ModuleNode3.create = create;
})(ModuleNode || (ModuleNode = {}));
var SuiteNode;
((SuiteNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 50 /* Suite */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        statements: [],
        typeComment: void 0
      }
    };
    return node;
  }
  SuiteNode2.create = create;
})(SuiteNode || (SuiteNode = {}));
var IfNode;
((IfNode2) => {
  function create(ifOrElifToken, testExpr, ifSuite, elseSuite) {
    const node = {
      start: ifOrElifToken.start,
      length: ifOrElifToken.length,
      nodeType: 22 /* If */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: ifOrElifToken,
        testExpr,
        ifSuite,
        elseSuite
      }
    };
    testExpr.parent = node;
    ifSuite.parent = node;
    extendRange(node, testExpr);
    extendRange(node, ifSuite);
    if (elseSuite) {
      extendRange(node, elseSuite);
      elseSuite.parent = node;
    }
    return node;
  }
  IfNode2.create = create;
})(IfNode || (IfNode = {}));
var WhileNode;
((WhileNode2) => {
  function create(whileToken, testExpr, whileSuite) {
    const node = {
      start: whileToken.start,
      length: whileToken.length,
      nodeType: 57 /* While */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: whileToken,
        testExpr,
        whileSuite
      }
    };
    testExpr.parent = node;
    whileSuite.parent = node;
    extendRange(node, whileSuite);
    return node;
  }
  WhileNode2.create = create;
})(WhileNode || (WhileNode = {}));
var ForNode;
((ForNode2) => {
  function create(forToken, targetExpr, iterableExpr, forSuite) {
    const node = {
      start: forToken.start,
      length: forToken.length,
      nodeType: 29 /* For */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: forToken,
        targetExpr,
        iterableExpr,
        forSuite
      }
    };
    targetExpr.parent = node;
    iterableExpr.parent = node;
    forSuite.parent = node;
    extendRange(node, forSuite);
    return node;
  }
  ForNode2.create = create;
})(ForNode || (ForNode = {}));
var ComprehensionForNode;
((ComprehensionForNode2) => {
  function create(startToken, targetExpr, iterableExpr) {
    const node = {
      start: startToken.start,
      length: startToken.length,
      nodeType: 12 /* ComprehensionFor */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        targetExpr,
        iterableExpr
      }
    };
    targetExpr.parent = node;
    iterableExpr.parent = node;
    extendRange(node, targetExpr);
    extendRange(node, iterableExpr);
    return node;
  }
  ComprehensionForNode2.create = create;
})(ComprehensionForNode || (ComprehensionForNode = {}));
var ComprehensionIfNode;
((ComprehensionIfNode2) => {
  function create(ifToken, testExpr) {
    const node = {
      start: ifToken.start,
      length: ifToken.length,
      nodeType: 13 /* ComprehensionIf */,
      id: _nextNodeId++,
      parent: void 0,
      d: { testExpr }
    };
    testExpr.parent = node;
    extendRange(node, testExpr);
    return node;
  }
  ComprehensionIfNode2.create = create;
})(ComprehensionIfNode || (ComprehensionIfNode = {}));
var TryNode;
((TryNode2) => {
  function create(tryToken, trySuite) {
    const node = {
      start: tryToken.start,
      length: tryToken.length,
      nodeType: 53 /* Try */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: tryToken,
        trySuite,
        exceptClauses: []
      }
    };
    trySuite.parent = node;
    extendRange(node, trySuite);
    return node;
  }
  TryNode2.create = create;
})(TryNode || (TryNode = {}));
var ExceptNode;
((ExceptNode2) => {
  function create(exceptToken, exceptSuite, isExceptGroup) {
    const node = {
      start: exceptToken.start,
      length: exceptToken.length,
      nodeType: 28 /* Except */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        exceptSuite,
        isExceptGroup,
        exceptToken
      }
    };
    exceptSuite.parent = node;
    extendRange(node, exceptSuite);
    return node;
  }
  ExceptNode2.create = create;
})(ExceptNode || (ExceptNode = {}));
var FunctionNode;
((FunctionNode4) => {
  function create(defToken, name, suite, typeParams) {
    const node = {
      start: defToken.start,
      length: defToken.length,
      nodeType: 31 /* Function */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: defToken,
        decorators: [],
        isAsync: false,
        name,
        typeParams,
        params: [],
        returnAnnotation: void 0,
        funcAnnotationComment: void 0,
        suite
      }
    };
    name.parent = node;
    suite.parent = node;
    if (typeParams) {
      typeParams.parent = node;
    }
    extendRange(node, suite);
    return node;
  }
  FunctionNode4.create = create;
})(FunctionNode || (FunctionNode = {}));
var ParameterNode;
((ParameterNode3) => {
  function create(startToken, paramCategory) {
    const node = {
      start: startToken.start,
      length: startToken.length,
      nodeType: 41 /* Parameter */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        category: paramCategory,
        name: void 0,
        annotation: void 0,
        annotationComment: void 0,
        defaultValue: void 0
      }
    };
    return node;
  }
  ParameterNode3.create = create;
})(ParameterNode || (ParameterNode = {}));
var ClassNode;
((ClassNode2) => {
  function create(classToken, name, suite, typeParams) {
    const node = {
      start: classToken.start,
      length: classToken.length,
      nodeType: 10 /* Class */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: classToken,
        decorators: [],
        name,
        typeParams,
        arguments: [],
        suite
      }
    };
    name.parent = node;
    suite.parent = node;
    if (typeParams) {
      typeParams.parent = node;
    }
    extendRange(node, suite);
    return node;
  }
  ClassNode2.create = create;
  function createDummyForDecorators(decorators2) {
    const node = {
      start: decorators2[0].start,
      length: 0,
      nodeType: 10 /* Class */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: {
          type: 8 /* Keyword */,
          start: 0,
          length: 0
        },
        decorators: decorators2,
        name: {
          start: decorators2[0].start,
          length: 0,
          nodeType: 38 /* Name */,
          id: 0,
          parent: void 0,
          d: {
            token: {
              type: 7 /* Identifier */,
              start: 0,
              length: 0,
              value: ""
            },
            value: ""
          }
        },
        typeParams: void 0,
        arguments: [],
        suite: {
          start: decorators2[0].start,
          length: 0,
          nodeType: 50 /* Suite */,
          id: 0,
          parent: void 0,
          d: { statements: [], typeComment: void 0 }
        }
      }
    };
    decorators2.forEach((decorator) => {
      decorator.parent = node;
      extendRange(node, decorator);
    });
    node.d.name.parent = node;
    node.d.suite.parent = node;
    return node;
  }
  ClassNode2.createDummyForDecorators = createDummyForDecorators;
})(ClassNode || (ClassNode = {}));
var WithNode;
((WithNode2) => {
  function create(withToken, suite) {
    const node = {
      start: withToken.start,
      length: withToken.length,
      nodeType: 58 /* With */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: withToken,
        withItems: [],
        suite
      }
    };
    suite.parent = node;
    extendRange(node, suite);
    return node;
  }
  WithNode2.create = create;
})(WithNode || (WithNode = {}));
var WithItemNode;
((WithItemNode2) => {
  function create(expr) {
    const node = {
      start: expr.start,
      length: expr.length,
      nodeType: 59 /* WithItem */,
      id: _nextNodeId++,
      parent: void 0,
      d: { expr }
    };
    expr.parent = node;
    return node;
  }
  WithItemNode2.create = create;
})(WithItemNode || (WithItemNode = {}));
var DecoratorNode;
((DecoratorNode2) => {
  function create(atToken, expr) {
    const node = {
      start: atToken.start,
      length: atToken.length,
      nodeType: 16 /* Decorator */,
      id: _nextNodeId++,
      parent: void 0,
      d: { expr }
    };
    expr.parent = node;
    extendRange(node, expr);
    return node;
  }
  DecoratorNode2.create = create;
})(DecoratorNode || (DecoratorNode = {}));
var StatementListNode;
((StatementListNode2) => {
  function create(atToken) {
    const node = {
      start: atToken.start,
      length: atToken.length,
      nodeType: 47 /* StatementList */,
      id: _nextNodeId++,
      parent: void 0,
      d: { firstToken: atToken, statements: [] }
    };
    return node;
  }
  StatementListNode2.create = create;
})(StatementListNode || (StatementListNode = {}));
var ErrorNode;
((ErrorNode2) => {
  function create(initialRange, category, child, decorators2) {
    const node = {
      start: initialRange.start,
      length: initialRange.length,
      nodeType: 0 /* Error */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        category,
        child,
        decorators: decorators2
      }
    };
    if (child) {
      child.parent = node;
      extendRange(node, child);
    }
    if (decorators2) {
      decorators2.forEach((decorator) => {
        decorator.parent = node;
      });
      if (decorators2.length > 0) {
        extendRange(node, decorators2[0]);
      }
    }
    return node;
  }
  ErrorNode2.create = create;
})(ErrorNode || (ErrorNode = {}));
var UnaryOperationNode;
((UnaryOperationNode2) => {
  function create(operatorToken, expr, operator) {
    const node = {
      start: operatorToken.start,
      length: operatorToken.length,
      nodeType: 55 /* UnaryOperation */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        operator,
        operatorToken,
        expr,
        hasParens: false
      }
    };
    expr.parent = node;
    extendRange(node, expr);
    return node;
  }
  UnaryOperationNode2.create = create;
})(UnaryOperationNode || (UnaryOperationNode = {}));
var BinaryOperationNode;
((BinaryOperationNode2) => {
  function create(leftExpr, rightExpr, operatorToken, operator) {
    const node = {
      start: leftExpr.start,
      length: leftExpr.length,
      nodeType: 7 /* BinaryOperation */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        leftExpr,
        operatorToken,
        operator,
        rightExpr,
        hasParens: false
      }
    };
    leftExpr.parent = node;
    rightExpr.parent = node;
    extendRange(node, rightExpr);
    return node;
  }
  BinaryOperationNode2.create = create;
})(BinaryOperationNode || (BinaryOperationNode = {}));
var AssignmentExpressionNode;
((AssignmentExpressionNode2) => {
  function create(name, walrusToken, rightExpr) {
    const node = {
      start: name.start,
      length: name.length,
      nodeType: 4 /* AssignmentExpression */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        name,
        walrusToken,
        rightExpr,
        hasParens: false
      }
    };
    name.parent = node;
    rightExpr.parent = node;
    extendRange(node, rightExpr);
    return node;
  }
  AssignmentExpressionNode2.create = create;
})(AssignmentExpressionNode || (AssignmentExpressionNode = {}));
var AssignmentNode;
((AssignmentNode2) => {
  function create(leftExpr, rightExpr) {
    const node = {
      start: leftExpr.start,
      length: leftExpr.length,
      nodeType: 3 /* Assignment */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        leftExpr,
        rightExpr
      }
    };
    leftExpr.parent = node;
    rightExpr.parent = node;
    extendRange(node, rightExpr);
    return node;
  }
  AssignmentNode2.create = create;
})(AssignmentNode || (AssignmentNode = {}));
var TypeParameterNode;
((TypeParameterNode2) => {
  function create(name, typeParamKind, boundExpr, defaultExpr) {
    const node = {
      start: name.start,
      length: name.length,
      nodeType: 75 /* TypeParameter */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        name,
        typeParamKind,
        boundExpr,
        defaultExpr
      }
    };
    name.parent = node;
    if (boundExpr) {
      boundExpr.parent = node;
      extendRange(node, boundExpr);
    }
    if (defaultExpr) {
      defaultExpr.parent = node;
      extendRange(node, defaultExpr);
    }
    return node;
  }
  TypeParameterNode2.create = create;
})(TypeParameterNode || (TypeParameterNode = {}));
var TypeParameterListNode;
((TypeParameterListNode2) => {
  function create(startToken, endToken, params) {
    const node = {
      start: startToken.start,
      length: startToken.length,
      nodeType: 76 /* TypeParameterList */,
      id: _nextNodeId++,
      parent: void 0,
      d: { params }
    };
    extendRange(node, endToken);
    params.forEach((param) => {
      extendRange(node, param);
      param.parent = node;
    });
    return node;
  }
  TypeParameterListNode2.create = create;
})(TypeParameterListNode || (TypeParameterListNode = {}));
var TypeAliasNode;
((TypeAliasNode2) => {
  function create(typeToken, name, expr, typeParams) {
    const node = {
      start: typeToken.start,
      length: typeToken.length,
      nodeType: 77 /* TypeAlias */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: typeToken,
        name,
        typeParams,
        expr
      }
    };
    name.parent = node;
    expr.parent = node;
    if (typeParams) {
      typeParams.parent = node;
    }
    extendRange(node, expr);
    return node;
  }
  TypeAliasNode2.create = create;
})(TypeAliasNode || (TypeAliasNode = {}));
var TypeAnnotationNode;
((TypeAnnotationNode2) => {
  function create(valueExpr, annotation) {
    const node = {
      start: valueExpr.start,
      length: valueExpr.length,
      nodeType: 54 /* TypeAnnotation */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        valueExpr,
        annotation
      }
    };
    valueExpr.parent = node;
    annotation.parent = node;
    extendRange(node, annotation);
    return node;
  }
  TypeAnnotationNode2.create = create;
})(TypeAnnotationNode || (TypeAnnotationNode = {}));
var FunctionAnnotationNode;
((FunctionAnnotationNode2) => {
  function create(openParenToken, isEllipsis, paramAnnotations, returnAnnotation) {
    const node = {
      start: openParenToken.start,
      length: openParenToken.length,
      nodeType: 62 /* FunctionAnnotation */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        isEllipsis,
        paramAnnotations,
        returnAnnotation
      }
    };
    paramAnnotations.forEach((p) => {
      p.parent = node;
    });
    returnAnnotation.parent = node;
    extendRange(node, returnAnnotation);
    return node;
  }
  FunctionAnnotationNode2.create = create;
})(FunctionAnnotationNode || (FunctionAnnotationNode = {}));
var AugmentedAssignmentNode;
((AugmentedAssignmentNode2) => {
  function create(leftExpr, rightExpr, operator, destExpr) {
    const node = {
      start: leftExpr.start,
      length: leftExpr.length,
      nodeType: 5 /* AugmentedAssignment */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        leftExpr,
        operator,
        rightExpr,
        destExpr
      }
    };
    leftExpr.parent = node;
    rightExpr.parent = node;
    destExpr.parent = node;
    extendRange(node, rightExpr);
    return node;
  }
  AugmentedAssignmentNode2.create = create;
})(AugmentedAssignmentNode || (AugmentedAssignmentNode = {}));
var AwaitNode;
((AwaitNode2) => {
  function create(awaitToken, expr) {
    const node = {
      start: awaitToken.start,
      length: awaitToken.length,
      nodeType: 6 /* Await */,
      id: _nextNodeId++,
      parent: void 0,
      d: { expr, awaitToken, hasParens: false }
    };
    expr.parent = node;
    extendRange(node, expr);
    return node;
  }
  AwaitNode2.create = create;
})(AwaitNode || (AwaitNode = {}));
var TernaryNode;
((TernaryNode2) => {
  function create(ifExpr, testExpr, elseExpr) {
    const node = {
      start: ifExpr.start,
      length: ifExpr.length,
      nodeType: 51 /* Ternary */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        ifExpr,
        testExpr,
        elseExpr
      }
    };
    ifExpr.parent = node;
    testExpr.parent = node;
    elseExpr.parent = node;
    extendRange(node, elseExpr);
    return node;
  }
  TernaryNode2.create = create;
})(TernaryNode || (TernaryNode = {}));
var UnpackNode;
((UnpackNode2) => {
  function create(starToken, expr) {
    const node = {
      start: starToken.start,
      length: starToken.length,
      nodeType: 56 /* Unpack */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        expr,
        starToken
      }
    };
    expr.parent = node;
    extendRange(node, expr);
    return node;
  }
  UnpackNode2.create = create;
})(UnpackNode || (UnpackNode = {}));
var TupleNode;
((TupleNode2) => {
  function create(range, hasParens) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 52 /* Tuple */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        items: [],
        hasParens
      }
    };
    return node;
  }
  TupleNode2.create = create;
})(TupleNode || (TupleNode = {}));
var CallNode;
((CallNode2) => {
  function create(leftExpr, args) {
    const node = {
      start: leftExpr.start,
      length: leftExpr.length,
      nodeType: 9 /* Call */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        leftExpr,
        args
      }
    };
    leftExpr.parent = node;
    if (args.length > 0) {
      args.forEach((arg) => {
        arg.parent = node;
      });
      extendRange(node, args[args.length - 1]);
    }
    return node;
  }
  CallNode2.create = create;
})(CallNode || (CallNode = {}));
var ComprehensionNode;
((ComprehensionNode2) => {
  function create(expr, isGenerator) {
    const node = {
      start: expr.start,
      length: expr.length,
      nodeType: 11 /* Comprehension */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        expr,
        forIfNodes: [],
        isGenerator,
        hasParens: false
      }
    };
    expr.parent = node;
    return node;
  }
  ComprehensionNode2.create = create;
})(ComprehensionNode || (ComprehensionNode = {}));
var IndexNode;
((IndexNode2) => {
  function create(leftExpr, items, trailingComma, closeBracketToken) {
    const node = {
      start: leftExpr.start,
      length: leftExpr.length,
      nodeType: 27 /* Index */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        leftExpr,
        items,
        trailingComma
      }
    };
    leftExpr.parent = node;
    items.forEach((item) => {
      item.parent = node;
    });
    extendRange(node, closeBracketToken);
    return node;
  }
  IndexNode2.create = create;
})(IndexNode || (IndexNode = {}));
var SliceNode;
((SliceNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 46 /* Slice */,
      id: _nextNodeId++,
      parent: void 0,
      d: {}
    };
    return node;
  }
  SliceNode2.create = create;
})(SliceNode || (SliceNode = {}));
var YieldNode;
((YieldNode2) => {
  function create(yieldToken, expr) {
    const node = {
      start: yieldToken.start,
      length: yieldToken.length,
      nodeType: 60 /* Yield */,
      id: _nextNodeId++,
      parent: void 0,
      d: { expr }
    };
    if (expr) {
      expr.parent = node;
      extendRange(node, expr);
    }
    return node;
  }
  YieldNode2.create = create;
})(YieldNode || (YieldNode = {}));
var YieldFromNode;
((YieldFromNode2) => {
  function create(yieldToken, expr) {
    const node = {
      start: yieldToken.start,
      length: yieldToken.length,
      nodeType: 61 /* YieldFrom */,
      id: _nextNodeId++,
      parent: void 0,
      d: { expr }
    };
    expr.parent = node;
    extendRange(node, expr);
    return node;
  }
  YieldFromNode2.create = create;
})(YieldFromNode || (YieldFromNode = {}));
var MemberAccessNode;
((MemberAccessNode2) => {
  function create(leftExpr, member) {
    const node = {
      start: leftExpr.start,
      length: leftExpr.length,
      nodeType: 35 /* MemberAccess */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        leftExpr,
        member
      }
    };
    leftExpr.parent = node;
    member.parent = node;
    extendRange(node, member);
    return node;
  }
  MemberAccessNode2.create = create;
})(MemberAccessNode || (MemberAccessNode = {}));
var LambdaNode;
((LambdaNode2) => {
  function create(lambdaToken, expr) {
    const node = {
      start: lambdaToken.start,
      length: lambdaToken.length,
      nodeType: 33 /* Lambda */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        params: [],
        expr
      }
    };
    expr.parent = node;
    extendRange(node, expr);
    return node;
  }
  LambdaNode2.create = create;
})(LambdaNode || (LambdaNode = {}));
var NameNode;
((NameNode2) => {
  function create(nameToken) {
    const node = {
      start: nameToken.start,
      length: nameToken.length,
      nodeType: 38 /* Name */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        token: nameToken,
        value: nameToken.value
      }
    };
    return node;
  }
  NameNode2.create = create;
})(NameNode || (NameNode = {}));
var ConstantNode;
((ConstantNode2) => {
  function create(token) {
    const node = {
      start: token.start,
      length: token.length,
      nodeType: 14 /* Constant */,
      id: _nextNodeId++,
      parent: void 0,
      d: { constType: token.keywordType }
    };
    return node;
  }
  ConstantNode2.create = create;
})(ConstantNode || (ConstantNode = {}));
var EllipsisNode;
((EllipsisNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 21 /* Ellipsis */,
      id: _nextNodeId++,
      parent: void 0,
      d: {}
    };
    return node;
  }
  EllipsisNode2.create = create;
})(EllipsisNode || (EllipsisNode = {}));
var NumberNode;
((NumberNode2) => {
  function create(token) {
    const node = {
      start: token.start,
      length: token.length,
      nodeType: 40 /* Number */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        value: token.value,
        isInteger: token.isInteger,
        isImaginary: token.isImaginary
      }
    };
    return node;
  }
  NumberNode2.create = create;
})(NumberNode || (NumberNode = {}));
var StringNode;
((StringNode2) => {
  function create(token, value) {
    const node = {
      start: token.start,
      length: token.length,
      nodeType: 49 /* String */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        token,
        value
      }
    };
    return node;
  }
  StringNode2.create = create;
})(StringNode || (StringNode = {}));
var FormatStringNode;
((FormatStringNode3) => {
  function create(startToken, endToken, middleTokens, fieldExprs, formatExprs) {
    const node = {
      start: startToken.start,
      length: startToken.length,
      nodeType: 30 /* FormatString */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        token: startToken,
        middleTokens,
        fieldExprs,
        formatExprs,
        value: ""
      }
    };
    fieldExprs.forEach((expr) => {
      expr.parent = node;
      extendRange(node, expr);
    });
    if (formatExprs) {
      formatExprs.forEach((expr) => {
        expr.parent = node;
        extendRange(node, expr);
      });
    }
    if (endToken) {
      extendRange(node, endToken);
    }
    return node;
  }
  FormatStringNode3.create = create;
})(FormatStringNode || (FormatStringNode = {}));
var StringListNode;
((StringListNode2) => {
  function create(strings) {
    const node = {
      start: strings[0].start,
      length: strings[0].length,
      nodeType: 48 /* StringList */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        strings,
        hasParens: false
      }
    };
    if (strings.length > 0) {
      strings.forEach((str) => {
        str.parent = node;
      });
      extendRange(node, strings[strings.length - 1]);
    }
    return node;
  }
  StringListNode2.create = create;
})(StringListNode || (StringListNode = {}));
var DictionaryNode;
((DictionaryNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 18 /* Dictionary */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        items: []
      }
    };
    return node;
  }
  DictionaryNode2.create = create;
})(DictionaryNode || (DictionaryNode = {}));
var DictionaryKeyEntryNode;
((DictionaryKeyEntryNode2) => {
  function create(keyExpr, valueExpr) {
    const node = {
      start: keyExpr.start,
      length: keyExpr.length,
      nodeType: 20 /* DictionaryKeyEntry */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        keyExpr,
        valueExpr
      }
    };
    keyExpr.parent = node;
    valueExpr.parent = node;
    extendRange(node, valueExpr);
    return node;
  }
  DictionaryKeyEntryNode2.create = create;
})(DictionaryKeyEntryNode || (DictionaryKeyEntryNode = {}));
var DictionaryExpandEntryNode;
((DictionaryExpandEntryNode2) => {
  function create(expr) {
    const node = {
      start: expr.start,
      length: expr.length,
      nodeType: 19 /* DictionaryExpandEntry */,
      id: _nextNodeId++,
      parent: void 0,
      d: { expr }
    };
    expr.parent = node;
    return node;
  }
  DictionaryExpandEntryNode2.create = create;
})(DictionaryExpandEntryNode || (DictionaryExpandEntryNode = {}));
var SetNode;
((SetNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 45 /* Set */,
      id: _nextNodeId++,
      parent: void 0,
      d: { items: [] }
    };
    return node;
  }
  SetNode2.create = create;
})(SetNode || (SetNode = {}));
var ListNode;
((ListNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 34 /* List */,
      id: _nextNodeId++,
      parent: void 0,
      d: { items: [] }
    };
    return node;
  }
  ListNode2.create = create;
})(ListNode || (ListNode = {}));
var ArgumentNode;
((ArgumentNode3) => {
  function create(startToken, valueExpr, argCategory) {
    const node = {
      start: startToken ? startToken.start : valueExpr.start,
      length: startToken ? startToken.length : valueExpr.length,
      nodeType: 1 /* Argument */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        argCategory,
        name: void 0,
        valueExpr
      }
    };
    valueExpr.parent = node;
    extendRange(node, valueExpr);
    return node;
  }
  ArgumentNode3.create = create;
})(ArgumentNode || (ArgumentNode = {}));
var DelNode;
((DelNode2) => {
  function create(delToken) {
    const node = {
      start: delToken.start,
      length: delToken.length,
      nodeType: 17 /* Del */,
      id: _nextNodeId++,
      parent: void 0,
      d: { targets: [] }
    };
    return node;
  }
  DelNode2.create = create;
})(DelNode || (DelNode = {}));
var PassNode;
((PassNode2) => {
  function create(passToken) {
    const node = {
      start: passToken.start,
      length: passToken.length,
      nodeType: 42 /* Pass */,
      id: _nextNodeId++,
      parent: void 0,
      d: {}
    };
    return node;
  }
  PassNode2.create = create;
})(PassNode || (PassNode = {}));
var ImportNode;
((ImportNode2) => {
  function create(importToken) {
    const node = {
      start: importToken.start,
      length: importToken.length,
      nodeType: 23 /* Import */,
      id: _nextNodeId++,
      parent: void 0,
      d: { list: [] }
    };
    return node;
  }
  ImportNode2.create = create;
})(ImportNode || (ImportNode = {}));
var ModuleNameNode;
((ModuleNameNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 37 /* ModuleName */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        leadingDots: 0,
        nameParts: []
      }
    };
    return node;
  }
  ModuleNameNode2.create = create;
})(ModuleNameNode || (ModuleNameNode = {}));
var ImportAsNode;
((ImportAsNode2) => {
  function create(module) {
    const node = {
      start: module.start,
      length: module.length,
      nodeType: 24 /* ImportAs */,
      id: _nextNodeId++,
      parent: void 0,
      d: { module }
    };
    module.parent = node;
    return node;
  }
  ImportAsNode2.create = create;
})(ImportAsNode || (ImportAsNode = {}));
var ImportFromNode;
((ImportFromNode2) => {
  function create(fromToken, module) {
    const node = {
      start: fromToken.start,
      length: fromToken.length,
      nodeType: 25 /* ImportFrom */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        module,
        imports: [],
        isWildcardImport: false
      }
    };
    module.parent = node;
    extendRange(node, module);
    return node;
  }
  ImportFromNode2.create = create;
})(ImportFromNode || (ImportFromNode = {}));
var ImportFromAsNode;
((ImportFromAsNode2) => {
  function create(name) {
    const node = {
      start: name.start,
      length: name.length,
      nodeType: 26 /* ImportFromAs */,
      id: _nextNodeId++,
      parent: void 0,
      d: { name }
    };
    name.parent = node;
    return node;
  }
  ImportFromAsNode2.create = create;
})(ImportFromAsNode || (ImportFromAsNode = {}));
var GlobalNode;
((GlobalNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 32 /* Global */,
      id: _nextNodeId++,
      parent: void 0,
      d: { targets: [] }
    };
    return node;
  }
  GlobalNode2.create = create;
})(GlobalNode || (GlobalNode = {}));
var NonlocalNode;
((NonlocalNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 39 /* Nonlocal */,
      id: _nextNodeId++,
      parent: void 0,
      d: { targets: [] }
    };
    return node;
  }
  NonlocalNode2.create = create;
})(NonlocalNode || (NonlocalNode = {}));
var AssertNode;
((AssertNode2) => {
  function create(assertToken, testExpr) {
    const node = {
      start: assertToken.start,
      length: assertToken.length,
      nodeType: 2 /* Assert */,
      id: _nextNodeId++,
      parent: void 0,
      d: { testExpr }
    };
    testExpr.parent = node;
    extendRange(node, testExpr);
    return node;
  }
  AssertNode2.create = create;
})(AssertNode || (AssertNode = {}));
var BreakNode;
((BreakNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 8 /* Break */,
      id: _nextNodeId++,
      parent: void 0,
      d: {}
    };
    return node;
  }
  BreakNode2.create = create;
})(BreakNode || (BreakNode = {}));
var ContinueNode;
((ContinueNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 15 /* Continue */,
      id: _nextNodeId++,
      parent: void 0,
      d: {}
    };
    return node;
  }
  ContinueNode2.create = create;
})(ContinueNode || (ContinueNode = {}));
var ReturnNode;
((ReturnNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 44 /* Return */,
      id: _nextNodeId++,
      parent: void 0,
      d: {}
    };
    return node;
  }
  ReturnNode2.create = create;
})(ReturnNode || (ReturnNode = {}));
var RaiseNode;
((RaiseNode2) => {
  function create(range) {
    const node = {
      start: range.start,
      length: range.length,
      nodeType: 43 /* Raise */,
      id: _nextNodeId++,
      parent: void 0,
      d: {}
    };
    return node;
  }
  RaiseNode2.create = create;
})(RaiseNode || (RaiseNode = {}));
var MatchNode;
((MatchNode2) => {
  function create(matchToken, expr) {
    const node = {
      start: matchToken.start,
      length: matchToken.length,
      nodeType: 63 /* Match */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        firstToken: matchToken,
        expr,
        cases: []
      }
    };
    expr.parent = node;
    extendRange(node, expr);
    return node;
  }
  MatchNode2.create = create;
})(MatchNode || (MatchNode = {}));
var CaseNode;
((CaseNode2) => {
  function create(caseToken, pattern, isIrrefutable, guardExpr, suite) {
    const node = {
      start: caseToken.start,
      length: caseToken.length,
      nodeType: 64 /* Case */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        pattern,
        isIrrefutable,
        guardExpr,
        suite
      }
    };
    extendRange(node, suite);
    pattern.parent = node;
    suite.parent = node;
    if (guardExpr) {
      guardExpr.parent = node;
    }
    return node;
  }
  CaseNode2.create = create;
})(CaseNode || (CaseNode = {}));
var PatternSequenceNode;
((PatternSequenceNode2) => {
  function create(firstToken, entries) {
    const starEntryIndex = entries.findIndex(
      (entry) => entry.d.orPatterns.length === 1 && entry.d.orPatterns[0].nodeType === 69 /* PatternCapture */ && entry.d.orPatterns[0].d.isStar
    );
    const node = {
      start: firstToken.start,
      length: firstToken.length,
      nodeType: 65 /* PatternSequence */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        entries,
        starEntryIndex: starEntryIndex >= 0 ? starEntryIndex : void 0
      }
    };
    if (entries.length > 0) {
      extendRange(node, entries[entries.length - 1]);
    }
    entries.forEach((entry) => {
      entry.parent = node;
    });
    return node;
  }
  PatternSequenceNode2.create = create;
})(PatternSequenceNode || (PatternSequenceNode = {}));
var PatternAsNode;
((PatternAsNode2) => {
  function create(orPatterns, target) {
    const node = {
      start: orPatterns[0].start,
      length: orPatterns[0].length,
      nodeType: 66 /* PatternAs */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        orPatterns,
        target
      }
    };
    if (orPatterns.length > 1) {
      extendRange(node, orPatterns[orPatterns.length - 1]);
    }
    orPatterns.forEach((pattern) => {
      pattern.parent = node;
    });
    if (target) {
      extendRange(node, target);
      target.parent = node;
    }
    return node;
  }
  PatternAsNode2.create = create;
})(PatternAsNode || (PatternAsNode = {}));
var PatternLiteralNode;
((PatternLiteralNode2) => {
  function create(expr) {
    const node = {
      start: expr.start,
      length: expr.length,
      nodeType: 67 /* PatternLiteral */,
      id: _nextNodeId++,
      parent: void 0,
      d: { expr }
    };
    expr.parent = node;
    return node;
  }
  PatternLiteralNode2.create = create;
})(PatternLiteralNode || (PatternLiteralNode = {}));
var PatternClassNode;
((PatternClassNode2) => {
  function create(className, args) {
    const node = {
      start: className.start,
      length: className.length,
      nodeType: 68 /* PatternClass */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        className,
        args
      }
    };
    className.parent = node;
    args.forEach((arg) => {
      arg.parent = node;
    });
    if (args.length > 0) {
      extendRange(node, args[args.length - 1]);
    }
    return node;
  }
  PatternClassNode2.create = create;
})(PatternClassNode || (PatternClassNode = {}));
var PatternClassArgumentNode;
((PatternClassArgumentNode2) => {
  function create(pattern, name) {
    const node = {
      start: pattern.start,
      length: pattern.length,
      nodeType: 74 /* PatternClassArgument */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        pattern,
        name
      }
    };
    pattern.parent = node;
    if (name) {
      extendRange(node, name);
      name.parent = node;
    }
    return node;
  }
  PatternClassArgumentNode2.create = create;
})(PatternClassArgumentNode || (PatternClassArgumentNode = {}));
var PatternCaptureNode;
((PatternCaptureNode2) => {
  function create(target, starToken) {
    const node = {
      start: target.start,
      length: target.length,
      nodeType: 69 /* PatternCapture */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        target,
        isStar: starToken !== void 0,
        isWildcard: target.d.value === "_"
      }
    };
    target.parent = node;
    if (starToken) {
      extendRange(node, starToken);
    }
    return node;
  }
  PatternCaptureNode2.create = create;
})(PatternCaptureNode || (PatternCaptureNode = {}));
var PatternMappingNode;
((PatternMappingNode2) => {
  function create(startToken, entries) {
    const node = {
      start: startToken.start,
      length: startToken.length,
      nodeType: 70 /* PatternMapping */,
      id: _nextNodeId++,
      parent: void 0,
      d: { entries }
    };
    if (entries.length > 0) {
      extendRange(node, entries[entries.length - 1]);
    }
    entries.forEach((entry) => {
      entry.parent = node;
    });
    return node;
  }
  PatternMappingNode2.create = create;
})(PatternMappingNode || (PatternMappingNode = {}));
var PatternMappingKeyEntryNode;
((PatternMappingKeyEntryNode2) => {
  function create(keyPattern, valuePattern) {
    const node = {
      start: keyPattern.start,
      length: keyPattern.length,
      nodeType: 71 /* PatternMappingKeyEntry */,
      id: _nextNodeId++,
      parent: void 0,
      d: {
        keyPattern,
        valuePattern
      }
    };
    keyPattern.parent = node;
    valuePattern.parent = node;
    extendRange(node, valuePattern);
    return node;
  }
  PatternMappingKeyEntryNode2.create = create;
})(PatternMappingKeyEntryNode || (PatternMappingKeyEntryNode = {}));
var PatternMappingExpandEntryNode;
((PatternMappingExpandEntryNode2) => {
  function create(starStarToken, target) {
    const node = {
      start: starStarToken.start,
      length: starStarToken.length,
      nodeType: 72 /* PatternMappingExpandEntry */,
      id: _nextNodeId++,
      parent: void 0,
      d: { target }
    };
    target.parent = node;
    extendRange(node, target);
    return node;
  }
  PatternMappingExpandEntryNode2.create = create;
})(PatternMappingExpandEntryNode || (PatternMappingExpandEntryNode = {}));
var PatternValueNode;
((PatternValueNode2) => {
  function create(expr) {
    const node = {
      start: expr.start,
      length: expr.length,
      nodeType: 73 /* PatternValue */,
      id: _nextNodeId++,
      parent: void 0,
      d: { expr }
    };
    expr.parent = node;
    return node;
  }
  PatternValueNode2.create = create;
})(PatternValueNode || (PatternValueNode = {}));

// extract/py/upstream/parser/stringTokenUtils.ts
function completeUnescapedString(incomplete, originalString) {
  const newValue = incomplete.valueParts.join("");
  const value = originalString !== newValue ? newValue : originalString;
  return {
    ...incomplete,
    value
  };
}
function getUnescapedString(stringToken, elideCrlf = true) {
  const escapedString = stringToken.escapedValue;
  const isRaw = (stringToken.flags & 8 /* Raw */) !== 0;
  if (isRaw) {
    return {
      value: escapedString,
      unescapeErrors: [],
      nonAsciiInBytes: false
    };
  }
  const isBytes = (stringToken.flags & 32 /* Bytes */) !== 0;
  let hasEscapeOrNewLine = false;
  let nonAsciiInBytes = false;
  for (let index = 0; index < escapedString.length; index++) {
    const curChar = escapedString.charCodeAt(index);
    if (curChar === 13 /* CarriageReturn */ || curChar === 10 /* LineFeed */ || curChar === 92 /* Backslash */) {
      hasEscapeOrNewLine = true;
      break;
    }
    if (isBytes && curChar >= 128) {
      nonAsciiInBytes = true;
    }
  }
  if (!hasEscapeOrNewLine) {
    return {
      value: escapedString,
      unescapeErrors: [],
      nonAsciiInBytes
    };
  }
  let strOffset = 0;
  const output = {
    valueParts: [],
    unescapeErrors: [],
    nonAsciiInBytes: false
  };
  const addInvalidEscapeOffset = () => {
    if (!isRaw) {
      output.unescapeErrors.push({
        offset: strOffset - 1,
        length: 2,
        errorType: 0 /* InvalidEscapeSequence */
      });
    }
  };
  const getEscapedCharacter = (offset = 0) => {
    if (strOffset + offset >= escapedString.length) {
      return 3 /* EndOfText */;
    }
    return escapedString.charCodeAt(strOffset + offset);
  };
  const scanHexEscape = (digitCount) => {
    let foundIllegalHexDigit = false;
    let hexValue = 0;
    let localValue = "";
    for (let i = 0; i < digitCount; i++) {
      const charCode = getEscapedCharacter(1 + i);
      if (!_isHexCharCode(charCode)) {
        foundIllegalHexDigit = true;
        break;
      }
      hexValue = 16 * hexValue + _getHexDigitValue(charCode);
    }
    if (foundIllegalHexDigit) {
      addInvalidEscapeOffset();
      localValue = "\\" + String.fromCharCode(getEscapedCharacter());
      strOffset++;
    } else {
      localValue = String.fromCharCode(hexValue);
      strOffset += 1 + digitCount;
    }
    return localValue;
  };
  const appendOutputChar = (charCode) => {
    const char = String.fromCharCode(charCode);
    output.valueParts.push(char);
  };
  while (true) {
    let curChar = getEscapedCharacter();
    if (curChar === 3 /* EndOfText */) {
      return completeUnescapedString(output, escapedString);
    }
    if (curChar === 92 /* Backslash */) {
      strOffset++;
      if (isRaw) {
        appendOutputChar(curChar);
        continue;
      }
      curChar = getEscapedCharacter();
      let localValue = "";
      if (curChar === 13 /* CarriageReturn */ || curChar === 10 /* LineFeed */) {
        if (curChar === 13 /* CarriageReturn */ && getEscapedCharacter(1) === 10 /* LineFeed */) {
          if (isRaw) {
            localValue += String.fromCharCode(curChar);
          }
          strOffset++;
          curChar = getEscapedCharacter();
        }
        if (isRaw) {
          localValue = "\\" + localValue + String.fromCharCode(curChar);
        }
        strOffset++;
      } else {
        if (isRaw) {
          localValue = "\\" + String.fromCharCode(curChar);
          strOffset++;
        } else {
          switch (curChar) {
            case 92 /* Backslash */:
            case 39 /* SingleQuote */:
            case 34 /* DoubleQuote */:
              localValue = String.fromCharCode(curChar);
              strOffset++;
              break;
            case 97 /* a */:
              localValue = "\x07";
              strOffset++;
              break;
            case 98 /* b */:
              localValue = "\b";
              strOffset++;
              break;
            case 102 /* f */:
              localValue = "\f";
              strOffset++;
              break;
            case 110 /* n */:
              localValue = "\n";
              strOffset++;
              break;
            case 114 /* r */:
              localValue = "\r";
              strOffset++;
              break;
            case 116 /* t */:
              localValue = "	";
              strOffset++;
              break;
            case 118 /* v */:
              localValue = "\v";
              strOffset++;
              break;
            case 120 /* x */:
              localValue = scanHexEscape(2);
              break;
            case 78 /* N */: {
              let foundIllegalChar = false;
              let charCount = 1;
              if (isBytes) {
                foundIllegalChar = true;
              }
              if (getEscapedCharacter(charCount) !== 123 /* OpenBrace */) {
                foundIllegalChar = true;
              } else {
                charCount++;
                while (true) {
                  const lookaheadChar = getEscapedCharacter(charCount);
                  if (lookaheadChar === 125 /* CloseBrace */) {
                    break;
                  } else if (!_isAlphaNumericChar(lookaheadChar) && lookaheadChar !== 45 /* Hyphen */ && !_isWhitespaceChar(lookaheadChar)) {
                    foundIllegalChar = true;
                    break;
                  } else {
                    charCount++;
                  }
                }
              }
              if (foundIllegalChar) {
                addInvalidEscapeOffset();
                localValue = "\\" + String.fromCharCode(curChar);
                strOffset++;
              } else {
                localValue = "-";
                strOffset += 1 + charCount;
              }
              break;
            }
            case 117 /* u */:
            case 85 /* U */:
              if (isBytes) {
                addInvalidEscapeOffset();
              }
              localValue = scanHexEscape(curChar === 117 /* u */ ? 4 : 8);
              break;
            default:
              if (_isOctalCharCode(curChar)) {
                let octalCode = curChar - 48 /* _0 */;
                strOffset++;
                curChar = getEscapedCharacter();
                if (_isOctalCharCode(curChar)) {
                  octalCode = octalCode * 8 + curChar - 48 /* _0 */;
                  strOffset++;
                  curChar = getEscapedCharacter();
                  if (_isOctalCharCode(curChar)) {
                    octalCode = octalCode * 8 + curChar - 48 /* _0 */;
                    strOffset++;
                  }
                }
                localValue = String.fromCharCode(octalCode);
              } else {
                localValue = "\\";
                addInvalidEscapeOffset();
              }
              break;
          }
        }
      }
      output.valueParts.push(localValue);
    } else if (curChar === 10 /* LineFeed */ || curChar === 13 /* CarriageReturn */) {
      if (curChar === 13 /* CarriageReturn */ && getEscapedCharacter(1) === 10 /* LineFeed */) {
        if (!elideCrlf) {
          appendOutputChar(curChar);
        }
        strOffset++;
        curChar = getEscapedCharacter();
      }
      appendOutputChar(curChar);
      strOffset++;
    } else {
      if (isBytes && curChar >= 128) {
        output.nonAsciiInBytes = true;
      }
      appendOutputChar(curChar);
      strOffset++;
    }
  }
}
function _isWhitespaceChar(charCode) {
  return charCode === 32 /* Space */ || charCode === 9 /* Tab */;
}
function _isAlphaNumericChar(charCode) {
  if (charCode >= 48 /* _0 */ && charCode <= 57 /* _9 */) {
    return true;
  }
  if (charCode >= 97 /* a */ && charCode <= 122 /* z */) {
    return true;
  }
  if (charCode >= 65 /* A */ && charCode <= 90 /* Z */) {
    return true;
  }
  return false;
}
function _isOctalCharCode(charCode) {
  return charCode >= 48 /* _0 */ && charCode <= 55 /* _7 */;
}
function _isHexCharCode(charCode) {
  if (charCode >= 48 /* _0 */ && charCode <= 57 /* _9 */) {
    return true;
  }
  if (charCode >= 97 /* a */ && charCode <= 102 /* f */) {
    return true;
  }
  if (charCode >= 65 /* A */ && charCode <= 70 /* F */) {
    return true;
  }
  return false;
}
function _getHexDigitValue(charCode) {
  if (charCode >= 48 /* _0 */ && charCode <= 57 /* _9 */) {
    return charCode - 48 /* _0 */;
  }
  if (charCode >= 97 /* a */ && charCode <= 102 /* f */) {
    return charCode - 97 /* a */ + 10;
  }
  if (charCode >= 65 /* A */ && charCode <= 70 /* F */) {
    return charCode - 65 /* A */ + 10;
  }
  return 0;
}

// extract/py/upstream/common/core.ts
function cloneStr(str) {
  if (str.length < 13) {
    return str;
  }
  return Buffer.from(str, "utf8").toString("utf8");
}

// extract/py/upstream/common/textRangeCollection.ts
var TextRangeCollection = class {
  _items;
  // Index most recently returned by getItemContaining. Offsets converted in
  // bulk (e.g. one per completion item or reference) cluster on the same or an
  // adjacent line, so remembering the last hit lets consecutive lookups skip the
  // binary search. It is only ever used as a hint that is re-validated on each
  // call, so it never changes the returned result.
  _lastHitIndex = 0;
  constructor(items) {
    this._items = items;
  }
  get start() {
    return this._items.length > 0 ? this._items[0].start : 0;
  }
  get end() {
    const lastItem = this._items[this._items.length - 1];
    return this._items.length > 0 ? lastItem.start + lastItem.length : 0;
  }
  get length() {
    return this.end - this.start;
  }
  get count() {
    return this._items.length;
  }
  contains(position) {
    return position >= this.start && position < this.end;
  }
  getItemAt(index) {
    if (index < 0 || index >= this._items.length) {
      fail("index is out of range");
    }
    return this._items[index];
  }
  // Returns the nearest item prior to the position.
  // The position may not be contained within the item.
  getItemAtPosition(position) {
    if (this.count === 0) {
      return -1;
    }
    if (position < this.start) {
      return -1;
    }
    if (position > this.end) {
      return -1;
    }
    let min = 0;
    let max = this.count - 1;
    while (min < max) {
      const mid = min + (max - min >> 1);
      const item = this._items[mid];
      if (position >= item.start) {
        if (mid >= this.count - 1 || position < this._items[mid + 1].start) {
          return mid;
        }
      }
      if (position < item.start) {
        max = mid - 1;
      } else {
        min = mid + 1;
      }
    }
    return min;
  }
  getItemContaining(position) {
    if (this.count === 0) {
      return -1;
    }
    if (position < this.start) {
      return -1;
    }
    if (position > this.end) {
      return -1;
    }
    const lastHit = this._lastHitIndex;
    if (lastHit >= 0 && lastHit < this._items.length) {
      const item = this._items[lastHit];
      if (item !== void 0 && TextRange.contains(item, position)) {
        return lastHit;
      }
      const nextIndex = lastHit + 1;
      if (nextIndex < this._items.length) {
        const nextItem = this._items[nextIndex];
        if (nextItem !== void 0 && TextRange.contains(nextItem, position)) {
          this._lastHitIndex = nextIndex;
          return nextIndex;
        }
      }
    }
    const index = getIndexContaining(this._items, position);
    if (index >= 0) {
      this._lastHitIndex = index;
    }
    return index;
  }
};
function getIndexContaining(arr, position, inRange = TextRange.contains) {
  if (arr.length === 0) {
    return -1;
  }
  let min = 0;
  let max = arr.length - 1;
  while (min <= max) {
    const mid = Math.floor(min + (max - min) / 2);
    const element = findNonNullElement(arr, mid, min, max);
    if (element === void 0) {
      return -1;
    }
    if (inRange(element.item, position)) {
      return element.index;
    }
    const nextElement = findNonNullElement(arr, mid + 1, mid + 1, max);
    if (nextElement === void 0) {
      return -1;
    }
    if (mid < arr.length - 1 && TextRange.getEnd(element.item) <= position && position < nextElement.item.start) {
      return -1;
    }
    if (position < element.item.start) {
      max = mid - 1;
    } else {
      min = mid + 1;
    }
  }
  return -1;
}
function findNonNullElement(arr, position, min, max) {
  const item = arr[position];
  if (item) {
    return { index: position, item };
  }
  for (let i = position + 1; i <= max; i++) {
    const item2 = arr[i];
    if (item2) {
      return { index: i, item: item2 };
    }
  }
  for (let i = position - 1; i >= min; i--) {
    const item2 = arr[i];
    if (item2) {
      return { index: i, item: item2 };
    }
  }
  return void 0;
}

// extract/py/upstream/parser/unicode.ts
var unicodeLu = [
  [65, 90],
  [192, 214],
  [216, 222],
  256,
  258,
  260,
  262,
  264,
  266,
  268,
  270,
  272,
  274,
  276,
  278,
  280,
  282,
  284,
  286,
  288,
  290,
  292,
  294,
  296,
  298,
  300,
  302,
  304,
  306,
  308,
  310,
  313,
  315,
  317,
  319,
  321,
  323,
  325,
  327,
  330,
  332,
  334,
  336,
  338,
  340,
  342,
  344,
  346,
  348,
  350,
  352,
  354,
  356,
  358,
  360,
  362,
  364,
  366,
  368,
  370,
  372,
  374,
  [376, 377],
  379,
  381,
  [385, 386],
  388,
  [390, 391],
  [393, 395],
  [398, 401],
  [403, 404],
  [406, 408],
  [412, 413],
  [415, 416],
  418,
  420,
  [422, 423],
  425,
  428,
  [430, 431],
  [433, 435],
  437,
  [439, 440],
  444,
  452,
  455,
  458,
  461,
  463,
  465,
  467,
  469,
  471,
  473,
  475,
  478,
  480,
  482,
  484,
  486,
  488,
  490,
  492,
  494,
  497,
  500,
  [502, 504],
  506,
  508,
  510,
  512,
  514,
  516,
  518,
  520,
  522,
  524,
  526,
  528,
  530,
  532,
  534,
  536,
  538,
  540,
  542,
  544,
  546,
  548,
  550,
  552,
  554,
  556,
  558,
  560,
  562,
  [570, 571],
  [573, 574],
  577,
  [579, 582],
  584,
  586,
  588,
  590,
  880,
  882,
  886,
  895,
  902,
  [904, 906],
  908,
  [910, 911],
  [913, 929],
  [931, 939],
  975,
  [978, 980],
  984,
  986,
  988,
  990,
  992,
  994,
  996,
  998,
  1e3,
  1002,
  1004,
  1006,
  1012,
  1015,
  [1017, 1018],
  [1021, 1071],
  1120,
  1122,
  1124,
  1126,
  1128,
  1130,
  1132,
  1134,
  1136,
  1138,
  1140,
  1142,
  1144,
  1146,
  1148,
  1150,
  1152,
  1162,
  1164,
  1166,
  1168,
  1170,
  1172,
  1174,
  1176,
  1178,
  1180,
  1182,
  1184,
  1186,
  1188,
  1190,
  1192,
  1194,
  1196,
  1198,
  1200,
  1202,
  1204,
  1206,
  1208,
  1210,
  1212,
  1214,
  [1216, 1217],
  1219,
  1221,
  1223,
  1225,
  1227,
  1229,
  1232,
  1234,
  1236,
  1238,
  1240,
  1242,
  1244,
  1246,
  1248,
  1250,
  1252,
  1254,
  1256,
  1258,
  1260,
  1262,
  1264,
  1266,
  1268,
  1270,
  1272,
  1274,
  1276,
  1278,
  1280,
  1282,
  1284,
  1286,
  1288,
  1290,
  1292,
  1294,
  1296,
  1298,
  1300,
  1302,
  1304,
  1306,
  1308,
  1310,
  1312,
  1314,
  1316,
  1318,
  1320,
  1322,
  1324,
  1326,
  [1329, 1366],
  [4256, 4293],
  4295,
  4301,
  [5024, 5109],
  7305,
  [7312, 7354],
  [7357, 7359],
  7680,
  7682,
  7684,
  7686,
  7688,
  7690,
  7692,
  7694,
  7696,
  7698,
  7700,
  7702,
  7704,
  7706,
  7708,
  7710,
  7712,
  7714,
  7716,
  7718,
  7720,
  7722,
  7724,
  7726,
  7728,
  7730,
  7732,
  7734,
  7736,
  7738,
  7740,
  7742,
  7744,
  7746,
  7748,
  7750,
  7752,
  7754,
  7756,
  7758,
  7760,
  7762,
  7764,
  7766,
  7768,
  7770,
  7772,
  7774,
  7776,
  7778,
  7780,
  7782,
  7784,
  7786,
  7788,
  7790,
  7792,
  7794,
  7796,
  7798,
  7800,
  7802,
  7804,
  7806,
  7808,
  7810,
  7812,
  7814,
  7816,
  7818,
  7820,
  7822,
  7824,
  7826,
  7828,
  7838,
  7840,
  7842,
  7844,
  7846,
  7848,
  7850,
  7852,
  7854,
  7856,
  7858,
  7860,
  7862,
  7864,
  7866,
  7868,
  7870,
  7872,
  7874,
  7876,
  7878,
  7880,
  7882,
  7884,
  7886,
  7888,
  7890,
  7892,
  7894,
  7896,
  7898,
  7900,
  7902,
  7904,
  7906,
  7908,
  7910,
  7912,
  7914,
  7916,
  7918,
  7920,
  7922,
  7924,
  7926,
  7928,
  7930,
  7932,
  7934,
  [7944, 7951],
  [7960, 7965],
  [7976, 7983],
  [7992, 7999],
  [8008, 8013],
  8025,
  8027,
  8029,
  8031,
  [8040, 8047],
  [8120, 8123],
  [8136, 8139],
  [8152, 8155],
  [8168, 8172],
  [8184, 8187],
  8450,
  8455,
  [8459, 8461],
  [8464, 8466],
  8469,
  [8473, 8477],
  8484,
  8486,
  8488,
  [8490, 8493],
  [8496, 8499],
  [8510, 8511],
  8517,
  8579,
  [11264, 11311],
  11360,
  [11362, 11364],
  11367,
  11369,
  11371,
  [11373, 11376],
  11378,
  11381,
  [11390, 11392],
  11394,
  11396,
  11398,
  11400,
  11402,
  11404,
  11406,
  11408,
  11410,
  11412,
  11414,
  11416,
  11418,
  11420,
  11422,
  11424,
  11426,
  11428,
  11430,
  11432,
  11434,
  11436,
  11438,
  11440,
  11442,
  11444,
  11446,
  11448,
  11450,
  11452,
  11454,
  11456,
  11458,
  11460,
  11462,
  11464,
  11466,
  11468,
  11470,
  11472,
  11474,
  11476,
  11478,
  11480,
  11482,
  11484,
  11486,
  11488,
  11490,
  11499,
  11501,
  11506,
  42560,
  42562,
  42564,
  42566,
  42568,
  42570,
  42572,
  42574,
  42576,
  42578,
  42580,
  42582,
  42584,
  42586,
  42588,
  42590,
  42592,
  42594,
  42596,
  42598,
  42600,
  42602,
  42604,
  42624,
  42626,
  42628,
  42630,
  42632,
  42634,
  42636,
  42638,
  42640,
  42642,
  42644,
  42646,
  42648,
  42650,
  42786,
  42788,
  42790,
  42792,
  42794,
  42796,
  42798,
  42802,
  42804,
  42806,
  42808,
  42810,
  42812,
  42814,
  42816,
  42818,
  42820,
  42822,
  42824,
  42826,
  42828,
  42830,
  42832,
  42834,
  42836,
  42838,
  42840,
  42842,
  42844,
  42846,
  42848,
  42850,
  42852,
  42854,
  42856,
  42858,
  42860,
  42862,
  42873,
  42875,
  [42877, 42878],
  42880,
  42882,
  42884,
  42886,
  42891,
  42893,
  42896,
  42898,
  42902,
  42904,
  42906,
  42908,
  42910,
  42912,
  42914,
  42916,
  42918,
  42920,
  [42922, 42926],
  [42928, 42932],
  42934,
  42936,
  42938,
  42940,
  42942,
  42944,
  42946,
  [42948, 42951],
  42953,
  [42955, 42956],
  42960,
  42966,
  42968,
  42970,
  42972,
  42997,
  [65313, 65338],
  [66560, 66599],
  [66736, 66771],
  [66928, 66938],
  [66940, 66954],
  [66956, 66962],
  [66964, 66965],
  [68736, 68786],
  [68944, 68965],
  [71840, 71871],
  [93760, 93791],
  [119808, 119833],
  [119860, 119885],
  [119912, 119937],
  119964,
  [119966, 119967],
  119970,
  [119973, 119974],
  [119977, 119980],
  [119982, 119989],
  [120016, 120041],
  [120068, 120069],
  [120071, 120074],
  [120077, 120084],
  [120086, 120092],
  [120120, 120121],
  [120123, 120126],
  [120128, 120132],
  120134,
  [120138, 120144],
  [120172, 120197],
  [120224, 120249],
  [120276, 120301],
  [120328, 120353],
  [120380, 120405],
  [120432, 120457],
  [120488, 120512],
  [120546, 120570],
  [120604, 120628],
  [120662, 120686],
  [120720, 120744],
  120778,
  [125184, 125217]
];
var unicodeLuSurrogate = {
  55297: [
    [56320, 56359],
    // 0x10400..0x10427
    [56496, 56531],
    // 0x104B0..0x104D3
    [56688, 56698],
    // 0x10570..0x1057A
    [56700, 56714],
    // 0x1057C..0x1058A
    [56716, 56722],
    // 0x1058C..0x10592
    [56724, 56725]
    // 0x10594..0x10595
  ],
  55299: [
    [56448, 56498],
    // 0x10C80..0x10CB2
    [56656, 56677]
    // 0x10D50..0x10D65
  ],
  55302: [
    [56480, 56511]
    // 0x118A0..0x118BF
  ],
  55323: [
    [56896, 56927]
    // 0x16E40..0x16E5F
  ],
  55349: [
    [56320, 56345],
    // 0x1D400..0x1D419
    [56372, 56397],
    // 0x1D434..0x1D44D
    [56424, 56449],
    // 0x1D468..0x1D481
    56476,
    // 0x1D49C
    [56478, 56479],
    // 0x1D49E..0x1D49F
    56482,
    // 0x1D4A2
    [56485, 56486],
    // 0x1D4A5..0x1D4A6
    [56489, 56492],
    // 0x1D4A9..0x1D4AC
    [56494, 56501],
    // 0x1D4AE..0x1D4B5
    [56528, 56553],
    // 0x1D4D0..0x1D4E9
    [56580, 56581],
    // 0x1D504..0x1D505
    [56583, 56586],
    // 0x1D507..0x1D50A
    [56589, 56596],
    // 0x1D50D..0x1D514
    [56598, 56604],
    // 0x1D516..0x1D51C
    [56632, 56633],
    // 0x1D538..0x1D539
    [56635, 56638],
    // 0x1D53B..0x1D53E
    [56640, 56644],
    // 0x1D540..0x1D544
    56646,
    // 0x1D546
    [56650, 56656],
    // 0x1D54A..0x1D550
    [56684, 56709],
    // 0x1D56C..0x1D585
    [56736, 56761],
    // 0x1D5A0..0x1D5B9
    [56788, 56813],
    // 0x1D5D4..0x1D5ED
    [56840, 56865],
    // 0x1D608..0x1D621
    [56892, 56917],
    // 0x1D63C..0x1D655
    [56944, 56969],
    // 0x1D670..0x1D689
    [57e3, 57024],
    // 0x1D6A8..0x1D6C0
    [57058, 57082],
    // 0x1D6E2..0x1D6FA
    [57116, 57140],
    // 0x1D71C..0x1D734
    [57174, 57198],
    // 0x1D756..0x1D76E
    [57232, 57256],
    // 0x1D790..0x1D7A8
    57290
    // 0x1D7CA
  ],
  55354: [
    [56576, 56609]
    // 0x1E900..0x1E921
  ]
};
var unicodeLl = [
  [97, 122],
  181,
  [223, 246],
  [248, 255],
  257,
  259,
  261,
  263,
  265,
  267,
  269,
  271,
  273,
  275,
  277,
  279,
  281,
  283,
  285,
  287,
  289,
  291,
  293,
  295,
  297,
  299,
  301,
  303,
  305,
  307,
  309,
  [311, 312],
  314,
  316,
  318,
  320,
  322,
  324,
  326,
  [328, 329],
  331,
  333,
  335,
  337,
  339,
  341,
  343,
  345,
  347,
  349,
  351,
  353,
  355,
  357,
  359,
  361,
  363,
  365,
  367,
  369,
  371,
  373,
  375,
  378,
  380,
  [382, 384],
  387,
  389,
  392,
  [396, 397],
  402,
  405,
  [409, 411],
  414,
  417,
  419,
  421,
  424,
  [426, 427],
  429,
  432,
  436,
  438,
  [441, 442],
  [445, 447],
  454,
  457,
  460,
  462,
  464,
  466,
  468,
  470,
  472,
  474,
  [476, 477],
  479,
  481,
  483,
  485,
  487,
  489,
  491,
  493,
  [495, 496],
  499,
  501,
  505,
  507,
  509,
  511,
  513,
  515,
  517,
  519,
  521,
  523,
  525,
  527,
  529,
  531,
  533,
  535,
  537,
  539,
  541,
  543,
  545,
  547,
  549,
  551,
  553,
  555,
  557,
  559,
  561,
  [563, 569],
  572,
  [575, 576],
  578,
  583,
  585,
  587,
  589,
  [591, 659],
  [661, 687],
  881,
  883,
  887,
  [891, 893],
  912,
  [940, 974],
  [976, 977],
  [981, 983],
  985,
  987,
  989,
  991,
  993,
  995,
  997,
  999,
  1001,
  1003,
  1005,
  [1007, 1011],
  1013,
  1016,
  [1019, 1020],
  [1072, 1119],
  1121,
  1123,
  1125,
  1127,
  1129,
  1131,
  1133,
  1135,
  1137,
  1139,
  1141,
  1143,
  1145,
  1147,
  1149,
  1151,
  1153,
  1163,
  1165,
  1167,
  1169,
  1171,
  1173,
  1175,
  1177,
  1179,
  1181,
  1183,
  1185,
  1187,
  1189,
  1191,
  1193,
  1195,
  1197,
  1199,
  1201,
  1203,
  1205,
  1207,
  1209,
  1211,
  1213,
  1215,
  1218,
  1220,
  1222,
  1224,
  1226,
  1228,
  [1230, 1231],
  1233,
  1235,
  1237,
  1239,
  1241,
  1243,
  1245,
  1247,
  1249,
  1251,
  1253,
  1255,
  1257,
  1259,
  1261,
  1263,
  1265,
  1267,
  1269,
  1271,
  1273,
  1275,
  1277,
  1279,
  1281,
  1283,
  1285,
  1287,
  1289,
  1291,
  1293,
  1295,
  1297,
  1299,
  1301,
  1303,
  1305,
  1307,
  1309,
  1311,
  1313,
  1315,
  1317,
  1319,
  1321,
  1323,
  1325,
  1327,
  [1376, 1416],
  [4304, 4346],
  [4349, 4351],
  [5112, 5117],
  [7296, 7304],
  7306,
  [7424, 7467],
  [7531, 7543],
  [7545, 7578],
  7681,
  7683,
  7685,
  7687,
  7689,
  7691,
  7693,
  7695,
  7697,
  7699,
  7701,
  7703,
  7705,
  7707,
  7709,
  7711,
  7713,
  7715,
  7717,
  7719,
  7721,
  7723,
  7725,
  7727,
  7729,
  7731,
  7733,
  7735,
  7737,
  7739,
  7741,
  7743,
  7745,
  7747,
  7749,
  7751,
  7753,
  7755,
  7757,
  7759,
  7761,
  7763,
  7765,
  7767,
  7769,
  7771,
  7773,
  7775,
  7777,
  7779,
  7781,
  7783,
  7785,
  7787,
  7789,
  7791,
  7793,
  7795,
  7797,
  7799,
  7801,
  7803,
  7805,
  7807,
  7809,
  7811,
  7813,
  7815,
  7817,
  7819,
  7821,
  7823,
  7825,
  7827,
  [7829, 7837],
  7839,
  7841,
  7843,
  7845,
  7847,
  7849,
  7851,
  7853,
  7855,
  7857,
  7859,
  7861,
  7863,
  7865,
  7867,
  7869,
  7871,
  7873,
  7875,
  7877,
  7879,
  7881,
  7883,
  7885,
  7887,
  7889,
  7891,
  7893,
  7895,
  7897,
  7899,
  7901,
  7903,
  7905,
  7907,
  7909,
  7911,
  7913,
  7915,
  7917,
  7919,
  7921,
  7923,
  7925,
  7927,
  7929,
  7931,
  7933,
  [7935, 7943],
  [7952, 7957],
  [7968, 7975],
  [7984, 7991],
  [8e3, 8005],
  [8016, 8023],
  [8032, 8039],
  [8048, 8061],
  [8064, 8071],
  [8080, 8087],
  [8096, 8103],
  [8112, 8116],
  [8118, 8119],
  8126,
  [8130, 8132],
  [8134, 8135],
  [8144, 8147],
  [8150, 8151],
  [8160, 8167],
  [8178, 8180],
  [8182, 8183],
  8458,
  [8462, 8463],
  8467,
  8495,
  8500,
  8505,
  [8508, 8509],
  [8518, 8521],
  8526,
  8580,
  [11312, 11359],
  11361,
  [11365, 11366],
  11368,
  11370,
  11372,
  11377,
  [11379, 11380],
  [11382, 11387],
  11393,
  11395,
  11397,
  11399,
  11401,
  11403,
  11405,
  11407,
  11409,
  11411,
  11413,
  11415,
  11417,
  11419,
  11421,
  11423,
  11425,
  11427,
  11429,
  11431,
  11433,
  11435,
  11437,
  11439,
  11441,
  11443,
  11445,
  11447,
  11449,
  11451,
  11453,
  11455,
  11457,
  11459,
  11461,
  11463,
  11465,
  11467,
  11469,
  11471,
  11473,
  11475,
  11477,
  11479,
  11481,
  11483,
  11485,
  11487,
  11489,
  [11491, 11492],
  11500,
  11502,
  11507,
  [11520, 11557],
  11559,
  11565,
  42561,
  42563,
  42565,
  42567,
  42569,
  42571,
  42573,
  42575,
  42577,
  42579,
  42581,
  42583,
  42585,
  42587,
  42589,
  42591,
  42593,
  42595,
  42597,
  42599,
  42601,
  42603,
  42605,
  42625,
  42627,
  42629,
  42631,
  42633,
  42635,
  42637,
  42639,
  42641,
  42643,
  42645,
  42647,
  42649,
  42651,
  42787,
  42789,
  42791,
  42793,
  42795,
  42797,
  [42799, 42801],
  42803,
  42805,
  42807,
  42809,
  42811,
  42813,
  42815,
  42817,
  42819,
  42821,
  42823,
  42825,
  42827,
  42829,
  42831,
  42833,
  42835,
  42837,
  42839,
  42841,
  42843,
  42845,
  42847,
  42849,
  42851,
  42853,
  42855,
  42857,
  42859,
  42861,
  42863,
  [42865, 42872],
  42874,
  42876,
  42879,
  42881,
  42883,
  42885,
  42887,
  42892,
  42894,
  42897,
  [42899, 42901],
  42903,
  42905,
  42907,
  42909,
  42911,
  42913,
  42915,
  42917,
  42919,
  42921,
  42927,
  42933,
  42935,
  42937,
  42939,
  42941,
  42943,
  42945,
  42947,
  42952,
  42954,
  42957,
  42961,
  42963,
  42965,
  42967,
  42969,
  42971,
  42998,
  43002,
  [43824, 43866],
  [43872, 43880],
  [43888, 43967],
  [64256, 64262],
  [64275, 64279],
  [65345, 65370],
  [66600, 66639],
  [66776, 66811],
  [66967, 66977],
  [66979, 66993],
  [66995, 67001],
  [67003, 67004],
  [68800, 68850],
  [68976, 68997],
  [71872, 71903],
  [93792, 93823],
  [119834, 119859],
  [119886, 119892],
  [119894, 119911],
  [119938, 119963],
  [119990, 119993],
  119995,
  [119997, 120003],
  [120005, 120015],
  [120042, 120067],
  [120094, 120119],
  [120146, 120171],
  [120198, 120223],
  [120250, 120275],
  [120302, 120327],
  [120354, 120379],
  [120406, 120431],
  [120458, 120485],
  [120514, 120538],
  [120540, 120545],
  [120572, 120596],
  [120598, 120603],
  [120630, 120654],
  [120656, 120661],
  [120688, 120712],
  [120714, 120719],
  [120746, 120770],
  [120772, 120777],
  120779,
  [122624, 122633],
  [122635, 122654],
  [122661, 122666],
  [125218, 125251]
];
var unicodeLlSurrogate = {
  55297: [
    [56360, 56399],
    // 0x10428..0x1044F
    [56536, 56571],
    // 0x104D8..0x104FB
    [56727, 56737],
    // 0x10597..0x105A1
    [56739, 56753],
    // 0x105A3..0x105B1
    [56755, 56761],
    // 0x105B3..0x105B9
    [56763, 56764]
    // 0x105BB..0x105BC
  ],
  55299: [
    [56512, 56562],
    // 0x10CC0..0x10CF2
    [56688, 56709]
    // 0x10D70..0x10D85
  ],
  55302: [
    [56512, 56543]
    // 0x118C0..0x118DF
  ],
  55323: [
    [56928, 56959]
    // 0x16E60..0x16E7F
  ],
  55349: [
    [56346, 56371],
    // 0x1D41A..0x1D433
    [56398, 56404],
    // 0x1D44E..0x1D454
    [56406, 56423],
    // 0x1D456..0x1D467
    [56450, 56475],
    // 0x1D482..0x1D49B
    [56502, 56505],
    // 0x1D4B6..0x1D4B9
    56507,
    // 0x1D4BB
    [56509, 56515],
    // 0x1D4BD..0x1D4C3
    [56517, 56527],
    // 0x1D4C5..0x1D4CF
    [56554, 56579],
    // 0x1D4EA..0x1D503
    [56606, 56631],
    // 0x1D51E..0x1D537
    [56658, 56683],
    // 0x1D552..0x1D56B
    [56710, 56735],
    // 0x1D586..0x1D59F
    [56762, 56787],
    // 0x1D5BA..0x1D5D3
    [56814, 56839],
    // 0x1D5EE..0x1D607
    [56866, 56891],
    // 0x1D622..0x1D63B
    [56918, 56943],
    // 0x1D656..0x1D66F
    [56970, 56997],
    // 0x1D68A..0x1D6A5
    [57026, 57050],
    // 0x1D6C2..0x1D6DA
    [57052, 57057],
    // 0x1D6DC..0x1D6E1
    [57084, 57108],
    // 0x1D6FC..0x1D714
    [57110, 57115],
    // 0x1D716..0x1D71B
    [57142, 57166],
    // 0x1D736..0x1D74E
    [57168, 57173],
    // 0x1D750..0x1D755
    [57200, 57224],
    // 0x1D770..0x1D788
    [57226, 57231],
    // 0x1D78A..0x1D78F
    [57258, 57282],
    // 0x1D7AA..0x1D7C2
    [57284, 57289],
    // 0x1D7C4..0x1D7C9
    57291
    // 0x1D7CB
  ],
  55351: [
    [57088, 57097],
    // 0x1DF00..0x1DF09
    [57099, 57118],
    // 0x1DF0B..0x1DF1E
    [57125, 57130]
    // 0x1DF25..0x1DF2A
  ],
  55354: [
    [56610, 56643]
    // 0x1E922..0x1E943
  ]
};
var unicodeLt = [
  453,
  456,
  459,
  498,
  [8072, 8079],
  [8088, 8095],
  [8104, 8111],
  8124,
  8140,
  8188
];
var unicodeLo = [
  170,
  186,
  443,
  [448, 451],
  660,
  [1488, 1514],
  [1519, 1522],
  [1568, 1599],
  [1601, 1610],
  [1646, 1647],
  [1649, 1747],
  1749,
  [1774, 1775],
  [1786, 1788],
  1791,
  1808,
  [1810, 1839],
  [1869, 1957],
  1969,
  [1994, 2026],
  [2048, 2069],
  [2112, 2136],
  [2144, 2154],
  [2160, 2183],
  [2185, 2190],
  [2208, 2248],
  [2308, 2361],
  2365,
  2384,
  [2392, 2401],
  [2418, 2432],
  [2437, 2444],
  [2447, 2448],
  [2451, 2472],
  [2474, 2480],
  2482,
  [2486, 2489],
  2493,
  2510,
  [2524, 2525],
  [2527, 2529],
  [2544, 2545],
  2556,
  [2565, 2570],
  [2575, 2576],
  [2579, 2600],
  [2602, 2608],
  [2610, 2611],
  [2613, 2614],
  [2616, 2617],
  [2649, 2652],
  2654,
  [2674, 2676],
  [2693, 2701],
  [2703, 2705],
  [2707, 2728],
  [2730, 2736],
  [2738, 2739],
  [2741, 2745],
  2749,
  2768,
  [2784, 2785],
  2809,
  [2821, 2828],
  [2831, 2832],
  [2835, 2856],
  [2858, 2864],
  [2866, 2867],
  [2869, 2873],
  2877,
  [2908, 2909],
  [2911, 2913],
  2929,
  2947,
  [2949, 2954],
  [2958, 2960],
  [2962, 2965],
  [2969, 2970],
  2972,
  [2974, 2975],
  [2979, 2980],
  [2984, 2986],
  [2990, 3001],
  3024,
  [3077, 3084],
  [3086, 3088],
  [3090, 3112],
  [3114, 3129],
  3133,
  [3160, 3162],
  3165,
  [3168, 3169],
  3200,
  [3205, 3212],
  [3214, 3216],
  [3218, 3240],
  [3242, 3251],
  [3253, 3257],
  3261,
  [3293, 3294],
  [3296, 3297],
  [3313, 3314],
  [3332, 3340],
  [3342, 3344],
  [3346, 3386],
  3389,
  3406,
  [3412, 3414],
  [3423, 3425],
  [3450, 3455],
  [3461, 3478],
  [3482, 3505],
  [3507, 3515],
  3517,
  [3520, 3526],
  [3585, 3632],
  [3634, 3635],
  [3648, 3653],
  [3713, 3714],
  3716,
  [3718, 3722],
  [3724, 3747],
  3749,
  [3751, 3760],
  [3762, 3763],
  3773,
  [3776, 3780],
  [3804, 3807],
  3840,
  [3904, 3911],
  [3913, 3948],
  [3976, 3980],
  [4096, 4138],
  4159,
  [4176, 4181],
  [4186, 4189],
  4193,
  [4197, 4198],
  [4206, 4208],
  [4213, 4225],
  4238,
  [4352, 4680],
  [4682, 4685],
  [4688, 4694],
  4696,
  [4698, 4701],
  [4704, 4744],
  [4746, 4749],
  [4752, 4784],
  [4786, 4789],
  [4792, 4798],
  4800,
  [4802, 4805],
  [4808, 4822],
  [4824, 4880],
  [4882, 4885],
  [4888, 4954],
  [4992, 5007],
  [5121, 5740],
  [5743, 5759],
  [5761, 5786],
  [5792, 5866],
  [5873, 5880],
  [5888, 5905],
  [5919, 5937],
  [5952, 5969],
  [5984, 5996],
  [5998, 6e3],
  [6016, 6067],
  6108,
  [6176, 6210],
  [6212, 6264],
  [6272, 6276],
  [6279, 6312],
  6314,
  [6320, 6389],
  [6400, 6430],
  [6480, 6509],
  [6512, 6516],
  [6528, 6571],
  [6576, 6601],
  [6656, 6678],
  [6688, 6740],
  [6917, 6963],
  [6981, 6988],
  [7043, 7072],
  [7086, 7087],
  [7098, 7141],
  [7168, 7203],
  [7245, 7247],
  [7258, 7287],
  [7401, 7404],
  [7406, 7411],
  [7413, 7414],
  7418,
  [8501, 8504],
  [11568, 11623],
  [11648, 11670],
  [11680, 11686],
  [11688, 11694],
  [11696, 11702],
  [11704, 11710],
  [11712, 11718],
  [11720, 11726],
  [11728, 11734],
  [11736, 11742],
  12294,
  12348,
  [12353, 12438],
  12447,
  [12449, 12538],
  12543,
  [12549, 12591],
  [12593, 12686],
  [12704, 12735],
  [12784, 12799],
  [13312, 19903],
  [19968, 40980],
  [40982, 42124],
  [42192, 42231],
  [42240, 42507],
  [42512, 42527],
  [42538, 42539],
  42606,
  [42656, 42725],
  42895,
  42999,
  [43003, 43009],
  [43011, 43013],
  [43015, 43018],
  [43020, 43042],
  [43072, 43123],
  [43138, 43187],
  [43250, 43255],
  43259,
  [43261, 43262],
  [43274, 43301],
  [43312, 43334],
  [43360, 43388],
  [43396, 43442],
  [43488, 43492],
  [43495, 43503],
  [43514, 43518],
  [43520, 43560],
  [43584, 43586],
  [43588, 43595],
  [43616, 43631],
  [43633, 43638],
  43642,
  [43646, 43695],
  43697,
  [43701, 43702],
  [43705, 43709],
  43712,
  43714,
  [43739, 43740],
  [43744, 43754],
  43762,
  [43777, 43782],
  [43785, 43790],
  [43793, 43798],
  [43808, 43814],
  [43816, 43822],
  [43968, 44002],
  [44032, 55203],
  [55216, 55238],
  [55243, 55291],
  [63744, 64109],
  [64112, 64217],
  64285,
  [64287, 64296],
  [64298, 64310],
  [64312, 64316],
  64318,
  [64320, 64321],
  [64323, 64324],
  [64326, 64433],
  [64467, 64829],
  [64848, 64911],
  [64914, 64967],
  [65008, 65019],
  [65136, 65140],
  [65142, 65276],
  [65382, 65391],
  [65393, 65437],
  [65440, 65470],
  [65474, 65479],
  [65482, 65487],
  [65490, 65495],
  [65498, 65500],
  [65536, 65547],
  [65549, 65574],
  [65576, 65594],
  [65596, 65597],
  [65599, 65613],
  [65616, 65629],
  [65664, 65786],
  [66176, 66204],
  [66208, 66256],
  [66304, 66335],
  [66349, 66368],
  [66370, 66377],
  [66384, 66421],
  [66432, 66461],
  [66464, 66499],
  [66504, 66511],
  [66640, 66717],
  [66816, 66855],
  [66864, 66915],
  [67008, 67059],
  [67072, 67382],
  [67392, 67413],
  [67424, 67431],
  [67584, 67589],
  67592,
  [67594, 67637],
  [67639, 67640],
  67644,
  [67647, 67669],
  [67680, 67702],
  [67712, 67742],
  [67808, 67826],
  [67828, 67829],
  [67840, 67861],
  [67872, 67897],
  [67968, 68023],
  [68030, 68031],
  68096,
  [68112, 68115],
  [68117, 68119],
  [68121, 68149],
  [68192, 68220],
  [68224, 68252],
  [68288, 68295],
  [68297, 68324],
  [68352, 68405],
  [68416, 68437],
  [68448, 68466],
  [68480, 68497],
  [68608, 68680],
  [68864, 68899],
  [68938, 68941],
  68943,
  [69248, 69289],
  [69296, 69297],
  [69314, 69316],
  [69376, 69404],
  69415,
  [69424, 69445],
  [69488, 69505],
  [69552, 69572],
  [69600, 69622],
  [69635, 69687],
  [69745, 69746],
  69749,
  [69763, 69807],
  [69840, 69864],
  [69891, 69926],
  69956,
  69959,
  [69968, 70002],
  70006,
  [70019, 70066],
  [70081, 70084],
  70106,
  70108,
  [70144, 70161],
  [70163, 70187],
  [70207, 70208],
  [70272, 70278],
  70280,
  [70282, 70285],
  [70287, 70301],
  [70303, 70312],
  [70320, 70366],
  [70405, 70412],
  [70415, 70416],
  [70419, 70440],
  [70442, 70448],
  [70450, 70451],
  [70453, 70457],
  70461,
  70480,
  [70493, 70497],
  [70528, 70537],
  70539,
  70542,
  [70544, 70581],
  70583,
  70609,
  70611,
  [70656, 70708],
  [70727, 70730],
  [70751, 70753],
  [70784, 70831],
  [70852, 70853],
  70855,
  [71040, 71086],
  [71128, 71131],
  [71168, 71215],
  71236,
  [71296, 71338],
  71352,
  [71424, 71450],
  [71488, 71494],
  [71680, 71723],
  [71935, 71942],
  71945,
  [71948, 71955],
  [71957, 71958],
  [71960, 71983],
  71999,
  72001,
  [72096, 72103],
  [72106, 72144],
  72161,
  72163,
  72192,
  [72203, 72242],
  72250,
  72272,
  [72284, 72329],
  72349,
  [72368, 72440],
  [72640, 72672],
  [72704, 72712],
  [72714, 72750],
  72768,
  [72818, 72847],
  [72960, 72966],
  [72968, 72969],
  [72971, 73008],
  73030,
  [73056, 73061],
  [73063, 73064],
  [73066, 73097],
  73112,
  [73440, 73458],
  73474,
  [73476, 73488],
  [73490, 73523],
  73648,
  [73728, 74649],
  [74880, 75075],
  [77712, 77808],
  [77824, 78895],
  [78913, 78918],
  [78944, 82938],
  [82944, 83526],
  [90368, 90397],
  [92160, 92728],
  [92736, 92766],
  [92784, 92862],
  [92880, 92909],
  [92928, 92975],
  [93027, 93047],
  [93053, 93071],
  [93507, 93546],
  [93952, 94026],
  94032,
  [94208, 100343],
  [100352, 101589],
  [101631, 101640],
  [110592, 110882],
  110898,
  [110928, 110930],
  110933,
  [110948, 110951],
  [110960, 111355],
  [113664, 113770],
  [113776, 113788],
  [113792, 113800],
  [113808, 113817],
  122634,
  [123136, 123180],
  123214,
  [123536, 123565],
  [123584, 123627],
  [124112, 124138],
  [124368, 124397],
  124400,
  [124896, 124902],
  [124904, 124907],
  [124909, 124910],
  [124912, 124926],
  [124928, 125124],
  [126464, 126467],
  [126469, 126495],
  [126497, 126498],
  126500,
  126503,
  [126505, 126514],
  [126516, 126519],
  126521,
  126523,
  126530,
  126535,
  126537,
  126539,
  [126541, 126543],
  [126545, 126546],
  126548,
  126551,
  126553,
  126555,
  126557,
  126559,
  [126561, 126562],
  126564,
  [126567, 126570],
  [126572, 126578],
  [126580, 126583],
  [126585, 126588],
  126590,
  [126592, 126601],
  [126603, 126619],
  [126625, 126627],
  [126629, 126633],
  [126635, 126651],
  [131072, 173791],
  [173824, 177977],
  [177984, 178205],
  [178208, 183969],
  [183984, 191456],
  [191472, 192093],
  [194560, 195101],
  [196608, 201546],
  [201552, 205743]
];
var unicodeLoSurrogate = {
  55296: [
    [56320, 56331],
    // 0x10000..0x1000B
    [56333, 56358],
    // 0x1000D..0x10026
    [56360, 56378],
    // 0x10028..0x1003A
    [56380, 56381],
    // 0x1003C..0x1003D
    [56383, 56397],
    // 0x1003F..0x1004D
    [56400, 56413],
    // 0x10050..0x1005D
    [56448, 56570],
    // 0x10080..0x100FA
    [56960, 56988],
    // 0x10280..0x1029C
    [56992, 57040],
    // 0x102A0..0x102D0
    [57088, 57119],
    // 0x10300..0x1031F
    [57133, 57152],
    // 0x1032D..0x10340
    [57154, 57161],
    // 0x10342..0x10349
    [57168, 57205],
    // 0x10350..0x10375
    [57216, 57245],
    // 0x10380..0x1039D
    [57248, 57283],
    // 0x103A0..0x103C3
    [57288, 57295]
    // 0x103C8..0x103CF
  ],
  55297: [
    [56400, 56477],
    // 0x10450..0x1049D
    [56576, 56615],
    // 0x10500..0x10527
    [56624, 56675],
    // 0x10530..0x10563
    [56768, 56819],
    // 0x105C0..0x105F3
    [56832, 57142],
    // 0x10600..0x10736
    [57152, 57173],
    // 0x10740..0x10755
    [57184, 57191]
    // 0x10760..0x10767
  ],
  55298: [
    [56320, 56325],
    // 0x10800..0x10805
    56328,
    // 0x10808
    [56330, 56373],
    // 0x1080A..0x10835
    [56375, 56376],
    // 0x10837..0x10838
    56380,
    // 0x1083C
    [56383, 56405],
    // 0x1083F..0x10855
    [56416, 56438],
    // 0x10860..0x10876
    [56448, 56478],
    // 0x10880..0x1089E
    [56544, 56562],
    // 0x108E0..0x108F2
    [56564, 56565],
    // 0x108F4..0x108F5
    [56576, 56597],
    // 0x10900..0x10915
    [56608, 56633],
    // 0x10920..0x10939
    [56704, 56759],
    // 0x10980..0x109B7
    [56766, 56767],
    // 0x109BE..0x109BF
    56832,
    // 0x10A00
    [56848, 56851],
    // 0x10A10..0x10A13
    [56853, 56855],
    // 0x10A15..0x10A17
    [56857, 56885],
    // 0x10A19..0x10A35
    [56928, 56956],
    // 0x10A60..0x10A7C
    [56960, 56988],
    // 0x10A80..0x10A9C
    [57024, 57031],
    // 0x10AC0..0x10AC7
    [57033, 57060],
    // 0x10AC9..0x10AE4
    [57088, 57141],
    // 0x10B00..0x10B35
    [57152, 57173],
    // 0x10B40..0x10B55
    [57184, 57202],
    // 0x10B60..0x10B72
    [57216, 57233]
    // 0x10B80..0x10B91
  ],
  55299: [
    [56320, 56392],
    // 0x10C00..0x10C48
    [56576, 56611],
    // 0x10D00..0x10D23
    [56650, 56653],
    // 0x10D4A..0x10D4D
    56655,
    // 0x10D4F
    [56960, 57001],
    // 0x10E80..0x10EA9
    [57008, 57009],
    // 0x10EB0..0x10EB1
    [57026, 57028],
    // 0x10EC2..0x10EC4
    [57088, 57116],
    // 0x10F00..0x10F1C
    57127,
    // 0x10F27
    [57136, 57157],
    // 0x10F30..0x10F45
    [57200, 57217],
    // 0x10F70..0x10F81
    [57264, 57284],
    // 0x10FB0..0x10FC4
    [57312, 57334]
    // 0x10FE0..0x10FF6
  ],
  55300: [
    [56323, 56375],
    // 0x11003..0x11037
    [56433, 56434],
    // 0x11071..0x11072
    56437,
    // 0x11075
    [56451, 56495],
    // 0x11083..0x110AF
    [56528, 56552],
    // 0x110D0..0x110E8
    [56579, 56614],
    // 0x11103..0x11126
    56644,
    // 0x11144
    56647,
    // 0x11147
    [56656, 56690],
    // 0x11150..0x11172
    56694,
    // 0x11176
    [56707, 56754],
    // 0x11183..0x111B2
    [56769, 56772],
    // 0x111C1..0x111C4
    56794,
    // 0x111DA
    56796,
    // 0x111DC
    [56832, 56849],
    // 0x11200..0x11211
    [56851, 56875],
    // 0x11213..0x1122B
    [56895, 56896],
    // 0x1123F..0x11240
    [56960, 56966],
    // 0x11280..0x11286
    56968,
    // 0x11288
    [56970, 56973],
    // 0x1128A..0x1128D
    [56975, 56989],
    // 0x1128F..0x1129D
    [56991, 57e3],
    // 0x1129F..0x112A8
    [57008, 57054],
    // 0x112B0..0x112DE
    [57093, 57100],
    // 0x11305..0x1130C
    [57103, 57104],
    // 0x1130F..0x11310
    [57107, 57128],
    // 0x11313..0x11328
    [57130, 57136],
    // 0x1132A..0x11330
    [57138, 57139],
    // 0x11332..0x11333
    [57141, 57145],
    // 0x11335..0x11339
    57149,
    // 0x1133D
    57168,
    // 0x11350
    [57181, 57185],
    // 0x1135D..0x11361
    [57216, 57225],
    // 0x11380..0x11389
    57227,
    // 0x1138B
    57230,
    // 0x1138E
    [57232, 57269],
    // 0x11390..0x113B5
    57271,
    // 0x113B7
    57297,
    // 0x113D1
    57299
    // 0x113D3
  ],
  55301: [
    [56320, 56372],
    // 0x11400..0x11434
    [56391, 56394],
    // 0x11447..0x1144A
    [56415, 56417],
    // 0x1145F..0x11461
    [56448, 56495],
    // 0x11480..0x114AF
    [56516, 56517],
    // 0x114C4..0x114C5
    56519,
    // 0x114C7
    [56704, 56750],
    // 0x11580..0x115AE
    [56792, 56795],
    // 0x115D8..0x115DB
    [56832, 56879],
    // 0x11600..0x1162F
    56900,
    // 0x11644
    [56960, 57002],
    // 0x11680..0x116AA
    57016,
    // 0x116B8
    [57088, 57114],
    // 0x11700..0x1171A
    [57152, 57158]
    // 0x11740..0x11746
  ],
  55302: [
    [56320, 56363],
    // 0x11800..0x1182B
    [56575, 56582],
    // 0x118FF..0x11906
    56585,
    // 0x11909
    [56588, 56595],
    // 0x1190C..0x11913
    [56597, 56598],
    // 0x11915..0x11916
    [56600, 56623],
    // 0x11918..0x1192F
    56639,
    // 0x1193F
    56641,
    // 0x11941
    [56736, 56743],
    // 0x119A0..0x119A7
    [56746, 56784],
    // 0x119AA..0x119D0
    56801,
    // 0x119E1
    56803,
    // 0x119E3
    56832,
    // 0x11A00
    [56843, 56882],
    // 0x11A0B..0x11A32
    56890,
    // 0x11A3A
    56912,
    // 0x11A50
    [56924, 56969],
    // 0x11A5C..0x11A89
    56989,
    // 0x11A9D
    [57008, 57080],
    // 0x11AB0..0x11AF8
    [57280, 57312]
    // 0x11BC0..0x11BE0
  ],
  55303: [
    [56320, 56328],
    // 0x11C00..0x11C08
    [56330, 56366],
    // 0x11C0A..0x11C2E
    56384,
    // 0x11C40
    [56434, 56463],
    // 0x11C72..0x11C8F
    [56576, 56582],
    // 0x11D00..0x11D06
    [56584, 56585],
    // 0x11D08..0x11D09
    [56587, 56624],
    // 0x11D0B..0x11D30
    56646,
    // 0x11D46
    [56672, 56677],
    // 0x11D60..0x11D65
    [56679, 56680],
    // 0x11D67..0x11D68
    [56682, 56713],
    // 0x11D6A..0x11D89
    56728,
    // 0x11D98
    [57056, 57074],
    // 0x11EE0..0x11EF2
    57090,
    // 0x11F02
    [57092, 57104],
    // 0x11F04..0x11F10
    [57106, 57139],
    // 0x11F12..0x11F33
    57264
    // 0x11FB0
  ],
  55304: [
    [56320, 57241]
    // 0x12000..0x12399
  ],
  55305: [
    [56448, 56643]
    // 0x12480..0x12543
  ],
  55307: [
    [57232, 57328]
    // 0x12F90..0x12FF0
  ],
  55308: [
    [56320, 57343]
    // 0x13000..0x133FF
  ],
  55309: [
    [56320, 56367],
    // 0x13400..0x1342F
    [56385, 56390],
    // 0x13441..0x13446
    [56416, 57343]
    // 0x13460..0x137FF
  ],
  55310: [
    [56320, 57343]
    // 0x13800..0x13BFF
  ],
  55311: [
    [56320, 57343]
    // 0x13C00..0x13FFF
  ],
  55312: [
    [56320, 57338]
    // 0x14000..0x143FA
  ],
  55313: [
    [56320, 56902]
    // 0x14400..0x14646
  ],
  55320: [
    [56576, 56605]
    // 0x16100..0x1611D
  ],
  55322: [
    [56320, 56888],
    // 0x16800..0x16A38
    [56896, 56926],
    // 0x16A40..0x16A5E
    [56944, 57022],
    // 0x16A70..0x16ABE
    [57040, 57069],
    // 0x16AD0..0x16AED
    [57088, 57135],
    // 0x16B00..0x16B2F
    [57187, 57207],
    // 0x16B63..0x16B77
    [57213, 57231]
    // 0x16B7D..0x16B8F
  ],
  55323: [
    [56643, 56682],
    // 0x16D43..0x16D6A
    [57088, 57162],
    // 0x16F00..0x16F4A
    57168
    // 0x16F50
  ],
  55324: [
    [56320, 57343]
    // 0x17000..0x173FF
  ],
  55325: [
    [56320, 57343]
    // 0x17400..0x177FF
  ],
  55326: [
    [56320, 57343]
    // 0x17800..0x17BFF
  ],
  55327: [
    [56320, 57343]
    // 0x17C00..0x17FFF
  ],
  55328: [
    [56320, 57343]
    // 0x18000..0x183FF
  ],
  55329: [
    [56320, 57335]
    // 0x18400..0x187F7
  ],
  55330: [
    [56320, 57343]
    // 0x18800..0x18BFF
  ],
  55331: [
    [56320, 56533],
    // 0x18C00..0x18CD5
    [56575, 56584]
    // 0x18CFF..0x18D08
  ],
  55340: [
    [56320, 56610],
    // 0x1B000..0x1B122
    56626,
    // 0x1B132
    [56656, 56658],
    // 0x1B150..0x1B152
    56661,
    // 0x1B155
    [56676, 56679],
    // 0x1B164..0x1B167
    [56688, 57083]
    // 0x1B170..0x1B2FB
  ],
  55343: [
    [56320, 56426],
    // 0x1BC00..0x1BC6A
    [56432, 56444],
    // 0x1BC70..0x1BC7C
    [56448, 56456],
    // 0x1BC80..0x1BC88
    [56464, 56473]
    // 0x1BC90..0x1BC99
  ],
  55351: [
    57098
    // 0x1DF0A
  ],
  55352: [
    [56576, 56620],
    // 0x1E100..0x1E12C
    56654,
    // 0x1E14E
    [56976, 57005],
    // 0x1E290..0x1E2AD
    [57024, 57067]
    // 0x1E2C0..0x1E2EB
  ],
  55353: [
    [56528, 56554],
    // 0x1E4D0..0x1E4EA
    [56784, 56813],
    // 0x1E5D0..0x1E5ED
    56816,
    // 0x1E5F0
    [57312, 57318],
    // 0x1E7E0..0x1E7E6
    [57320, 57323],
    // 0x1E7E8..0x1E7EB
    [57325, 57326],
    // 0x1E7ED..0x1E7EE
    [57328, 57342]
    // 0x1E7F0..0x1E7FE
  ],
  55354: [
    [56320, 56516]
    // 0x1E800..0x1E8C4
  ],
  55355: [
    [56832, 56835],
    // 0x1EE00..0x1EE03
    [56837, 56863],
    // 0x1EE05..0x1EE1F
    [56865, 56866],
    // 0x1EE21..0x1EE22
    56868,
    // 0x1EE24
    56871,
    // 0x1EE27
    [56873, 56882],
    // 0x1EE29..0x1EE32
    [56884, 56887],
    // 0x1EE34..0x1EE37
    56889,
    // 0x1EE39
    56891,
    // 0x1EE3B
    56898,
    // 0x1EE42
    56903,
    // 0x1EE47
    56905,
    // 0x1EE49
    56907,
    // 0x1EE4B
    [56909, 56911],
    // 0x1EE4D..0x1EE4F
    [56913, 56914],
    // 0x1EE51..0x1EE52
    56916,
    // 0x1EE54
    56919,
    // 0x1EE57
    56921,
    // 0x1EE59
    56923,
    // 0x1EE5B
    56925,
    // 0x1EE5D
    56927,
    // 0x1EE5F
    [56929, 56930],
    // 0x1EE61..0x1EE62
    56932,
    // 0x1EE64
    [56935, 56938],
    // 0x1EE67..0x1EE6A
    [56940, 56946],
    // 0x1EE6C..0x1EE72
    [56948, 56951],
    // 0x1EE74..0x1EE77
    [56953, 56956],
    // 0x1EE79..0x1EE7C
    56958,
    // 0x1EE7E
    [56960, 56969],
    // 0x1EE80..0x1EE89
    [56971, 56987],
    // 0x1EE8B..0x1EE9B
    [56993, 56995],
    // 0x1EEA1..0x1EEA3
    [56997, 57001],
    // 0x1EEA5..0x1EEA9
    [57003, 57019]
    // 0x1EEAB..0x1EEBB
  ],
  55360: [
    [56320, 57343]
    // 0x20000..0x203FF
  ],
  55361: [
    [56320, 57343]
    // 0x20400..0x207FF
  ],
  55362: [
    [56320, 57343]
    // 0x20800..0x20BFF
  ],
  55363: [
    [56320, 57343]
    // 0x20C00..0x20FFF
  ],
  55364: [
    [56320, 57343]
    // 0x21000..0x213FF
  ],
  55365: [
    [56320, 57343]
    // 0x21400..0x217FF
  ],
  55366: [
    [56320, 57343]
    // 0x21800..0x21BFF
  ],
  55367: [
    [56320, 57343]
    // 0x21C00..0x21FFF
  ],
  55368: [
    [56320, 57343]
    // 0x22000..0x223FF
  ],
  55369: [
    [56320, 57343]
    // 0x22400..0x227FF
  ],
  55370: [
    [56320, 57343]
    // 0x22800..0x22BFF
  ],
  55371: [
    [56320, 57343]
    // 0x22C00..0x22FFF
  ],
  55372: [
    [56320, 57343]
    // 0x23000..0x233FF
  ],
  55373: [
    [56320, 57343]
    // 0x23400..0x237FF
  ],
  55374: [
    [56320, 57343]
    // 0x23800..0x23BFF
  ],
  55375: [
    [56320, 57343]
    // 0x23C00..0x23FFF
  ],
  55376: [
    [56320, 57343]
    // 0x24000..0x243FF
  ],
  55377: [
    [56320, 57343]
    // 0x24400..0x247FF
  ],
  55378: [
    [56320, 57343]
    // 0x24800..0x24BFF
  ],
  55379: [
    [56320, 57343]
    // 0x24C00..0x24FFF
  ],
  55380: [
    [56320, 57343]
    // 0x25000..0x253FF
  ],
  55381: [
    [56320, 57343]
    // 0x25400..0x257FF
  ],
  55382: [
    [56320, 57343]
    // 0x25800..0x25BFF
  ],
  55383: [
    [56320, 57343]
    // 0x25C00..0x25FFF
  ],
  55384: [
    [56320, 57343]
    // 0x26000..0x263FF
  ],
  55385: [
    [56320, 57343]
    // 0x26400..0x267FF
  ],
  55386: [
    [56320, 57343]
    // 0x26800..0x26BFF
  ],
  55387: [
    [56320, 57343]
    // 0x26C00..0x26FFF
  ],
  55388: [
    [56320, 57343]
    // 0x27000..0x273FF
  ],
  55389: [
    [56320, 57343]
    // 0x27400..0x277FF
  ],
  55390: [
    [56320, 57343]
    // 0x27800..0x27BFF
  ],
  55391: [
    [56320, 57343]
    // 0x27C00..0x27FFF
  ],
  55392: [
    [56320, 57343]
    // 0x28000..0x283FF
  ],
  55393: [
    [56320, 57343]
    // 0x28400..0x287FF
  ],
  55394: [
    [56320, 57343]
    // 0x28800..0x28BFF
  ],
  55395: [
    [56320, 57343]
    // 0x28C00..0x28FFF
  ],
  55396: [
    [56320, 57343]
    // 0x29000..0x293FF
  ],
  55397: [
    [56320, 57343]
    // 0x29400..0x297FF
  ],
  55398: [
    [56320, 57343]
    // 0x29800..0x29BFF
  ],
  55399: [
    [56320, 57343]
    // 0x29C00..0x29FFF
  ],
  55400: [
    [56320, 57343]
    // 0x2A000..0x2A3FF
  ],
  55401: [
    [56320, 57055],
    // 0x2A400..0x2A6DF
    [57088, 57343]
    // 0x2A700..0x2A7FF
  ],
  55402: [
    [56320, 57343]
    // 0x2A800..0x2ABFF
  ],
  55403: [
    [56320, 57343]
    // 0x2AC00..0x2AFFF
  ],
  55404: [
    [56320, 57343]
    // 0x2B000..0x2B3FF
  ],
  55405: [
    [56320, 57145],
    // 0x2B400..0x2B739
    [57152, 57343]
    // 0x2B740..0x2B7FF
  ],
  55406: [
    [56320, 56349],
    // 0x2B800..0x2B81D
    [56352, 57343]
    // 0x2B820..0x2BBFF
  ],
  55407: [
    [56320, 57343]
    // 0x2BC00..0x2BFFF
  ],
  55408: [
    [56320, 57343]
    // 0x2C000..0x2C3FF
  ],
  55409: [
    [56320, 57343]
    // 0x2C400..0x2C7FF
  ],
  55410: [
    [56320, 57343]
    // 0x2C800..0x2CBFF
  ],
  55411: [
    [56320, 56993],
    // 0x2CC00..0x2CEA1
    [57008, 57343]
    // 0x2CEB0..0x2CFFF
  ],
  55412: [
    [56320, 57343]
    // 0x2D000..0x2D3FF
  ],
  55413: [
    [56320, 57343]
    // 0x2D400..0x2D7FF
  ],
  55414: [
    [56320, 57343]
    // 0x2D800..0x2DBFF
  ],
  55415: [
    [56320, 57343]
    // 0x2DC00..0x2DFFF
  ],
  55416: [
    [56320, 57343]
    // 0x2E000..0x2E3FF
  ],
  55417: [
    [56320, 57343]
    // 0x2E400..0x2E7FF
  ],
  55418: [
    [56320, 57312],
    // 0x2E800..0x2EBE0
    [57328, 57343]
    // 0x2EBF0..0x2EBFF
  ],
  55419: [
    [56320, 56925]
    // 0x2EC00..0x2EE5D
  ],
  55422: [
    [56320, 56861]
    // 0x2F800..0x2FA1D
  ],
  55424: [
    [56320, 57343]
    // 0x30000..0x303FF
  ],
  55425: [
    [56320, 57343]
    // 0x30400..0x307FF
  ],
  55426: [
    [56320, 57343]
    // 0x30800..0x30BFF
  ],
  55427: [
    [56320, 57343]
    // 0x30C00..0x30FFF
  ],
  55428: [
    [56320, 57162],
    // 0x31000..0x3134A
    [57168, 57343]
    // 0x31350..0x313FF
  ],
  55429: [
    [56320, 57343]
    // 0x31400..0x317FF
  ],
  55430: [
    [56320, 57343]
    // 0x31800..0x31BFF
  ],
  55431: [
    [56320, 57343]
    // 0x31C00..0x31FFF
  ],
  55432: [
    [56320, 57263]
    // 0x32000..0x323AF
  ]
};
var unicodeLm = [
  [688, 705],
  [710, 721],
  [736, 740],
  748,
  750,
  884,
  890,
  1369,
  1600,
  [1765, 1766],
  [2036, 2037],
  2042,
  2074,
  2084,
  2088,
  2249,
  2417,
  3654,
  3782,
  4348,
  6103,
  6211,
  6823,
  [7288, 7293],
  [7468, 7530],
  7544,
  [7579, 7615],
  8305,
  8319,
  [8336, 8348],
  [11388, 11389],
  11631,
  11823,
  12293,
  [12337, 12341],
  12347,
  [12445, 12446],
  [12540, 12542],
  40981,
  [42232, 42237],
  42508,
  42623,
  [42652, 42653],
  [42775, 42783],
  42864,
  42888,
  [42994, 42996],
  [43e3, 43001],
  43471,
  43494,
  43632,
  43741,
  [43763, 43764],
  [43868, 43871],
  43881,
  65392,
  [65438, 65439],
  [67456, 67461],
  [67463, 67504],
  [67506, 67514],
  68942,
  68975,
  [92992, 92995],
  [93504, 93506],
  [93547, 93548],
  [94099, 94111],
  [94176, 94177],
  94179,
  [110576, 110579],
  [110581, 110587],
  [110589, 110590],
  [122928, 122989],
  [123191, 123197],
  124139,
  125259
];
var unicodeLmSurrogate = {
  55297: [
    [57216, 57221],
    // 0x10780..0x10785
    [57223, 57264],
    // 0x10787..0x107B0
    [57266, 57274]
    // 0x107B2..0x107BA
  ],
  55299: [
    56654,
    // 0x10D4E
    56687
    // 0x10D6F
  ],
  55322: [
    [57152, 57155]
    // 0x16B40..0x16B43
  ],
  55323: [
    [56640, 56642],
    // 0x16D40..0x16D42
    [56683, 56684],
    // 0x16D6B..0x16D6C
    [57235, 57247],
    // 0x16F93..0x16F9F
    [57312, 57313],
    // 0x16FE0..0x16FE1
    57315
    // 0x16FE3
  ],
  55339: [
    [57328, 57331],
    // 0x1AFF0..0x1AFF3
    [57333, 57339],
    // 0x1AFF5..0x1AFFB
    [57341, 57342]
    // 0x1AFFD..0x1AFFE
  ],
  55352: [
    [56368, 56429],
    // 0x1E030..0x1E06D
    [56631, 56637]
    // 0x1E137..0x1E13D
  ],
  55353: [
    56555
    // 0x1E4EB
  ],
  55354: [
    56651
    // 0x1E94B
  ]
};
var unicodeNl = [
  [5870, 5872],
  [8544, 8578],
  [8581, 8584],
  12295,
  [12321, 12329],
  [12344, 12346],
  [42726, 42735],
  [65856, 65908],
  66369,
  66378,
  [66513, 66517],
  [74752, 74862]
];
var unicodeNlSurrogate = {
  55296: [
    [56640, 56692],
    // 0x10140..0x10174
    57153,
    // 0x10341
    57162,
    // 0x1034A
    [57297, 57301]
    // 0x103D1..0x103D5
  ],
  55305: [
    [56320, 56430]
    // 0x12400..0x1246E
  ]
};
var unicodeMn = [
  [768, 879],
  [1155, 1159],
  [1425, 1469],
  1471,
  [1473, 1474],
  [1476, 1477],
  1479,
  [1552, 1562],
  [1611, 1631],
  1648,
  [1750, 1756],
  [1759, 1764],
  [1767, 1768],
  [1770, 1773],
  1809,
  [1840, 1866],
  [1958, 1968],
  [2027, 2035],
  2045,
  [2070, 2073],
  [2075, 2083],
  [2085, 2087],
  [2089, 2093],
  [2137, 2139],
  [2199, 2207],
  [2250, 2273],
  [2275, 2306],
  2362,
  2364,
  [2369, 2376],
  2381,
  [2385, 2391],
  [2402, 2403],
  2433,
  2492,
  [2497, 2500],
  2509,
  [2530, 2531],
  2558,
  [2561, 2562],
  2620,
  [2625, 2626],
  [2631, 2632],
  [2635, 2637],
  2641,
  [2672, 2673],
  2677,
  [2689, 2690],
  2748,
  [2753, 2757],
  [2759, 2760],
  2765,
  [2786, 2787],
  [2810, 2815],
  2817,
  2876,
  2879,
  [2881, 2884],
  2893,
  [2901, 2902],
  [2914, 2915],
  2946,
  3008,
  3021,
  3072,
  3076,
  3132,
  [3134, 3136],
  [3142, 3144],
  [3146, 3149],
  [3157, 3158],
  [3170, 3171],
  3201,
  3260,
  3263,
  3270,
  [3276, 3277],
  [3298, 3299],
  [3328, 3329],
  [3387, 3388],
  [3393, 3396],
  3405,
  [3426, 3427],
  3457,
  3530,
  [3538, 3540],
  3542,
  3633,
  [3636, 3642],
  [3655, 3662],
  3761,
  [3764, 3772],
  [3784, 3790],
  [3864, 3865],
  3893,
  3895,
  3897,
  [3953, 3966],
  [3968, 3972],
  [3974, 3975],
  [3981, 3991],
  [3993, 4028],
  4038,
  [4141, 4144],
  [4146, 4151],
  [4153, 4154],
  [4157, 4158],
  [4184, 4185],
  [4190, 4192],
  [4209, 4212],
  4226,
  [4229, 4230],
  4237,
  4253,
  [4957, 4959],
  [5906, 5908],
  [5938, 5939],
  [5970, 5971],
  [6002, 6003],
  [6068, 6069],
  [6071, 6077],
  6086,
  [6089, 6099],
  6109,
  [6155, 6157],
  6159,
  [6277, 6278],
  6313,
  [6432, 6434],
  [6439, 6440],
  6450,
  [6457, 6459],
  [6679, 6680],
  6683,
  6742,
  [6744, 6750],
  6752,
  6754,
  [6757, 6764],
  [6771, 6780],
  6783,
  [6832, 6845],
  [6847, 6862],
  [6912, 6915],
  6964,
  [6966, 6970],
  6972,
  6978,
  [7019, 7027],
  [7040, 7041],
  [7074, 7077],
  [7080, 7081],
  [7083, 7085],
  7142,
  [7144, 7145],
  7149,
  [7151, 7153],
  [7212, 7219],
  [7222, 7223],
  [7376, 7378],
  [7380, 7392],
  [7394, 7400],
  7405,
  7412,
  [7416, 7417],
  [7616, 7679],
  [8400, 8412],
  8417,
  [8421, 8432],
  [11503, 11505],
  11647,
  [11744, 11775],
  [12330, 12333],
  [12441, 12442],
  42607,
  [42612, 42621],
  [42654, 42655],
  [42736, 42737],
  43010,
  43014,
  43019,
  [43045, 43046],
  43052,
  [43204, 43205],
  [43232, 43249],
  43263,
  [43302, 43309],
  [43335, 43345],
  [43392, 43394],
  43443,
  [43446, 43449],
  [43452, 43453],
  43493,
  [43561, 43566],
  [43569, 43570],
  [43573, 43574],
  43587,
  43596,
  43644,
  43696,
  [43698, 43700],
  [43703, 43704],
  [43710, 43711],
  43713,
  [43756, 43757],
  43766,
  44005,
  44008,
  44013,
  64286,
  [65024, 65039],
  [65056, 65071],
  66045,
  66272,
  [66422, 66426],
  [68097, 68099],
  [68101, 68102],
  [68108, 68111],
  [68152, 68154],
  68159,
  [68325, 68326],
  [68900, 68903],
  [68969, 68973],
  [69291, 69292],
  [69372, 69375],
  [69446, 69456],
  [69506, 69509],
  69633,
  [69688, 69702],
  69744,
  [69747, 69748],
  [69759, 69761],
  [69811, 69814],
  [69817, 69818],
  69826,
  [69888, 69890],
  [69927, 69931],
  [69933, 69940],
  70003,
  [70016, 70017],
  [70070, 70078],
  [70089, 70092],
  70095,
  [70191, 70193],
  70196,
  [70198, 70199],
  70206,
  70209,
  70367,
  [70371, 70378],
  [70400, 70401],
  [70459, 70460],
  70464,
  [70502, 70508],
  [70512, 70516],
  [70587, 70592],
  70606,
  70608,
  70610,
  [70625, 70626],
  [70712, 70719],
  [70722, 70724],
  70726,
  70750,
  [70835, 70840],
  70842,
  [70847, 70848],
  [70850, 70851],
  [71090, 71093],
  [71100, 71101],
  [71103, 71104],
  [71132, 71133],
  [71219, 71226],
  71229,
  [71231, 71232],
  71339,
  71341,
  [71344, 71349],
  71351,
  71453,
  71455,
  [71458, 71461],
  [71463, 71467],
  [71727, 71735],
  [71737, 71738],
  [71995, 71996],
  71998,
  72003,
  [72148, 72151],
  [72154, 72155],
  72160,
  [72193, 72202],
  [72243, 72248],
  [72251, 72254],
  72263,
  [72273, 72278],
  [72281, 72283],
  [72330, 72342],
  [72344, 72345],
  [72752, 72758],
  [72760, 72765],
  72767,
  [72850, 72871],
  [72874, 72880],
  [72882, 72883],
  [72885, 72886],
  [73009, 73014],
  73018,
  [73020, 73021],
  [73023, 73029],
  73031,
  [73104, 73105],
  73109,
  73111,
  [73459, 73460],
  [73472, 73473],
  [73526, 73530],
  73536,
  73538,
  73562,
  78912,
  [78919, 78933],
  [90398, 90409],
  [90413, 90415],
  [92912, 92916],
  [92976, 92982],
  94031,
  [94095, 94098],
  94180,
  [113821, 113822],
  [118528, 118573],
  [118576, 118598],
  [119143, 119145],
  [119163, 119170],
  [119173, 119179],
  [119210, 119213],
  [119362, 119364],
  [121344, 121398],
  [121403, 121452],
  121461,
  121476,
  [121499, 121503],
  [121505, 121519],
  [122880, 122886],
  [122888, 122904],
  [122907, 122913],
  [122915, 122916],
  [122918, 122922],
  123023,
  [123184, 123190],
  123566,
  [123628, 123631],
  [124140, 124143],
  [124398, 124399],
  [125136, 125142],
  [125252, 125258],
  [917760, 917999]
];
var unicodeMnSurrogate = {
  55296: [
    56829,
    // 0x101FD
    57056,
    // 0x102E0
    [57206, 57210]
    // 0x10376..0x1037A
  ],
  55298: [
    [56833, 56835],
    // 0x10A01..0x10A03
    [56837, 56838],
    // 0x10A05..0x10A06
    [56844, 56847],
    // 0x10A0C..0x10A0F
    [56888, 56890],
    // 0x10A38..0x10A3A
    56895,
    // 0x10A3F
    [57061, 57062]
    // 0x10AE5..0x10AE6
  ],
  55299: [
    [56612, 56615],
    // 0x10D24..0x10D27
    [56681, 56685],
    // 0x10D69..0x10D6D
    [57003, 57004],
    // 0x10EAB..0x10EAC
    [57084, 57087],
    // 0x10EFC..0x10EFF
    [57158, 57168],
    // 0x10F46..0x10F50
    [57218, 57221]
    // 0x10F82..0x10F85
  ],
  55300: [
    56321,
    // 0x11001
    [56376, 56390],
    // 0x11038..0x11046
    56432,
    // 0x11070
    [56435, 56436],
    // 0x11073..0x11074
    [56447, 56449],
    // 0x1107F..0x11081
    [56499, 56502],
    // 0x110B3..0x110B6
    [56505, 56506],
    // 0x110B9..0x110BA
    56514,
    // 0x110C2
    [56576, 56578],
    // 0x11100..0x11102
    [56615, 56619],
    // 0x11127..0x1112B
    [56621, 56628],
    // 0x1112D..0x11134
    56691,
    // 0x11173
    [56704, 56705],
    // 0x11180..0x11181
    [56758, 56766],
    // 0x111B6..0x111BE
    [56777, 56780],
    // 0x111C9..0x111CC
    56783,
    // 0x111CF
    [56879, 56881],
    // 0x1122F..0x11231
    56884,
    // 0x11234
    [56886, 56887],
    // 0x11236..0x11237
    56894,
    // 0x1123E
    56897,
    // 0x11241
    57055,
    // 0x112DF
    [57059, 57066],
    // 0x112E3..0x112EA
    [57088, 57089],
    // 0x11300..0x11301
    [57147, 57148],
    // 0x1133B..0x1133C
    57152,
    // 0x11340
    [57190, 57196],
    // 0x11366..0x1136C
    [57200, 57204],
    // 0x11370..0x11374
    [57275, 57280],
    // 0x113BB..0x113C0
    57294,
    // 0x113CE
    57296,
    // 0x113D0
    57298,
    // 0x113D2
    [57313, 57314]
    // 0x113E1..0x113E2
  ],
  55301: [
    [56376, 56383],
    // 0x11438..0x1143F
    [56386, 56388],
    // 0x11442..0x11444
    56390,
    // 0x11446
    56414,
    // 0x1145E
    [56499, 56504],
    // 0x114B3..0x114B8
    56506,
    // 0x114BA
    [56511, 56512],
    // 0x114BF..0x114C0
    [56514, 56515],
    // 0x114C2..0x114C3
    [56754, 56757],
    // 0x115B2..0x115B5
    [56764, 56765],
    // 0x115BC..0x115BD
    [56767, 56768],
    // 0x115BF..0x115C0
    [56796, 56797],
    // 0x115DC..0x115DD
    [56883, 56890],
    // 0x11633..0x1163A
    56893,
    // 0x1163D
    [56895, 56896],
    // 0x1163F..0x11640
    57003,
    // 0x116AB
    57005,
    // 0x116AD
    [57008, 57013],
    // 0x116B0..0x116B5
    57015,
    // 0x116B7
    57117,
    // 0x1171D
    57119,
    // 0x1171F
    [57122, 57125],
    // 0x11722..0x11725
    [57127, 57131]
    // 0x11727..0x1172B
  ],
  55302: [
    [56367, 56375],
    // 0x1182F..0x11837
    [56377, 56378],
    // 0x11839..0x1183A
    [56635, 56636],
    // 0x1193B..0x1193C
    56638,
    // 0x1193E
    56643,
    // 0x11943
    [56788, 56791],
    // 0x119D4..0x119D7
    [56794, 56795],
    // 0x119DA..0x119DB
    56800,
    // 0x119E0
    [56833, 56842],
    // 0x11A01..0x11A0A
    [56883, 56888],
    // 0x11A33..0x11A38
    [56891, 56894],
    // 0x11A3B..0x11A3E
    56903,
    // 0x11A47
    [56913, 56918],
    // 0x11A51..0x11A56
    [56921, 56923],
    // 0x11A59..0x11A5B
    [56970, 56982],
    // 0x11A8A..0x11A96
    [56984, 56985]
    // 0x11A98..0x11A99
  ],
  55303: [
    [56368, 56374],
    // 0x11C30..0x11C36
    [56376, 56381],
    // 0x11C38..0x11C3D
    56383,
    // 0x11C3F
    [56466, 56487],
    // 0x11C92..0x11CA7
    [56490, 56496],
    // 0x11CAA..0x11CB0
    [56498, 56499],
    // 0x11CB2..0x11CB3
    [56501, 56502],
    // 0x11CB5..0x11CB6
    [56625, 56630],
    // 0x11D31..0x11D36
    56634,
    // 0x11D3A
    [56636, 56637],
    // 0x11D3C..0x11D3D
    [56639, 56645],
    // 0x11D3F..0x11D45
    56647,
    // 0x11D47
    [56720, 56721],
    // 0x11D90..0x11D91
    56725,
    // 0x11D95
    56727,
    // 0x11D97
    [57075, 57076],
    // 0x11EF3..0x11EF4
    [57088, 57089],
    // 0x11F00..0x11F01
    [57142, 57146],
    // 0x11F36..0x11F3A
    57152,
    // 0x11F40
    57154,
    // 0x11F42
    57178
    // 0x11F5A
  ],
  55309: [
    56384,
    // 0x13440
    [56391, 56405]
    // 0x13447..0x13455
  ],
  55320: [
    [56606, 56617],
    // 0x1611E..0x16129
    [56621, 56623]
    // 0x1612D..0x1612F
  ],
  55322: [
    [57072, 57076],
    // 0x16AF0..0x16AF4
    [57136, 57142]
    // 0x16B30..0x16B36
  ],
  55323: [
    57167,
    // 0x16F4F
    [57231, 57234],
    // 0x16F8F..0x16F92
    57316
    // 0x16FE4
  ],
  55343: [
    [56477, 56478]
    // 0x1BC9D..0x1BC9E
  ],
  55347: [
    [57088, 57133],
    // 0x1CF00..0x1CF2D
    [57136, 57158]
    // 0x1CF30..0x1CF46
  ],
  55348: [
    [56679, 56681],
    // 0x1D167..0x1D169
    [56699, 56706],
    // 0x1D17B..0x1D182
    [56709, 56715],
    // 0x1D185..0x1D18B
    [56746, 56749],
    // 0x1D1AA..0x1D1AD
    [56898, 56900]
    // 0x1D242..0x1D244
  ],
  55350: [
    [56832, 56886],
    // 0x1DA00..0x1DA36
    [56891, 56940],
    // 0x1DA3B..0x1DA6C
    56949,
    // 0x1DA75
    56964,
    // 0x1DA84
    [56987, 56991],
    // 0x1DA9B..0x1DA9F
    [56993, 57007]
    // 0x1DAA1..0x1DAAF
  ],
  55352: [
    [56320, 56326],
    // 0x1E000..0x1E006
    [56328, 56344],
    // 0x1E008..0x1E018
    [56347, 56353],
    // 0x1E01B..0x1E021
    [56355, 56356],
    // 0x1E023..0x1E024
    [56358, 56362],
    // 0x1E026..0x1E02A
    56463,
    // 0x1E08F
    [56624, 56630],
    // 0x1E130..0x1E136
    57006,
    // 0x1E2AE
    [57068, 57071]
    // 0x1E2EC..0x1E2EF
  ],
  55353: [
    [56556, 56559],
    // 0x1E4EC..0x1E4EF
    [56814, 56815]
    // 0x1E5EE..0x1E5EF
  ],
  55354: [
    [56528, 56534],
    // 0x1E8D0..0x1E8D6
    [56644, 56650]
    // 0x1E944..0x1E94A
  ],
  56128: [
    [56576, 56815]
    // 0xE0100..0xE01EF
  ]
};
var unicodeMc = [
  2307,
  2363,
  [2366, 2368],
  [2377, 2380],
  [2382, 2383],
  [2434, 2435],
  [2494, 2496],
  [2503, 2504],
  [2507, 2508],
  2519,
  2563,
  [2622, 2624],
  2691,
  [2750, 2752],
  2761,
  [2763, 2764],
  [2818, 2819],
  2878,
  2880,
  [2887, 2888],
  [2891, 2892],
  2903,
  [3006, 3007],
  [3009, 3010],
  [3014, 3016],
  [3018, 3020],
  3031,
  [3073, 3075],
  [3137, 3140],
  [3202, 3203],
  3262,
  [3264, 3268],
  [3271, 3272],
  [3274, 3275],
  [3285, 3286],
  3315,
  [3330, 3331],
  [3390, 3392],
  [3398, 3400],
  [3402, 3404],
  3415,
  [3458, 3459],
  [3535, 3537],
  [3544, 3551],
  [3570, 3571],
  [3902, 3903],
  3967,
  [4139, 4140],
  4145,
  4152,
  [4155, 4156],
  [4182, 4183],
  [4194, 4196],
  [4199, 4205],
  [4227, 4228],
  [4231, 4236],
  4239,
  [4250, 4252],
  5909,
  5940,
  6070,
  [6078, 6085],
  [6087, 6088],
  [6435, 6438],
  [6441, 6443],
  [6448, 6449],
  [6451, 6456],
  [6681, 6682],
  6741,
  6743,
  6753,
  [6755, 6756],
  [6765, 6770],
  6916,
  6965,
  6971,
  [6973, 6977],
  [6979, 6980],
  7042,
  7073,
  [7078, 7079],
  7082,
  7143,
  [7146, 7148],
  7150,
  [7154, 7155],
  [7204, 7211],
  [7220, 7221],
  7393,
  7415,
  [12334, 12335],
  [43043, 43044],
  43047,
  [43136, 43137],
  [43188, 43203],
  [43346, 43347],
  43395,
  [43444, 43445],
  [43450, 43451],
  [43454, 43456],
  [43567, 43568],
  [43571, 43572],
  43597,
  43643,
  43645,
  43755,
  [43758, 43759],
  43765,
  [44003, 44004],
  [44006, 44007],
  [44009, 44010],
  44012,
  69632,
  69634,
  69762,
  [69808, 69810],
  [69815, 69816],
  69932,
  [69957, 69958],
  70018,
  [70067, 70069],
  [70079, 70080],
  70094,
  [70188, 70190],
  [70194, 70195],
  70197,
  [70368, 70370],
  [70402, 70403],
  [70462, 70463],
  [70465, 70468],
  [70471, 70472],
  [70475, 70477],
  70487,
  [70498, 70499],
  [70584, 70586],
  70594,
  70597,
  [70599, 70602],
  [70604, 70605],
  70607,
  [70709, 70711],
  [70720, 70721],
  70725,
  [70832, 70834],
  70841,
  [70843, 70846],
  70849,
  [71087, 71089],
  [71096, 71099],
  71102,
  [71216, 71218],
  [71227, 71228],
  71230,
  71340,
  [71342, 71343],
  71350,
  71454,
  [71456, 71457],
  71462,
  [71724, 71726],
  71736,
  [71984, 71989],
  [71991, 71992],
  71997,
  72e3,
  72002,
  [72145, 72147],
  [72156, 72159],
  72164,
  72249,
  [72279, 72280],
  72343,
  72751,
  72766,
  72873,
  72881,
  72884,
  [73098, 73102],
  [73107, 73108],
  73110,
  [73461, 73462],
  73475,
  [73524, 73525],
  [73534, 73535],
  73537,
  [90410, 90412],
  [94033, 94087],
  [94192, 94193],
  [119141, 119142],
  [119149, 119154]
];
var unicodeMcSurrogate = {
  55300: [
    56320,
    // 0x11000
    56322,
    // 0x11002
    56450,
    // 0x11082
    [56496, 56498],
    // 0x110B0..0x110B2
    [56503, 56504],
    // 0x110B7..0x110B8
    56620,
    // 0x1112C
    [56645, 56646],
    // 0x11145..0x11146
    56706,
    // 0x11182
    [56755, 56757],
    // 0x111B3..0x111B5
    [56767, 56768],
    // 0x111BF..0x111C0
    56782,
    // 0x111CE
    [56876, 56878],
    // 0x1122C..0x1122E
    [56882, 56883],
    // 0x11232..0x11233
    56885,
    // 0x11235
    [57056, 57058],
    // 0x112E0..0x112E2
    [57090, 57091],
    // 0x11302..0x11303
    [57150, 57151],
    // 0x1133E..0x1133F
    [57153, 57156],
    // 0x11341..0x11344
    [57159, 57160],
    // 0x11347..0x11348
    [57163, 57165],
    // 0x1134B..0x1134D
    57175,
    // 0x11357
    [57186, 57187],
    // 0x11362..0x11363
    [57272, 57274],
    // 0x113B8..0x113BA
    57282,
    // 0x113C2
    57285,
    // 0x113C5
    [57287, 57290],
    // 0x113C7..0x113CA
    [57292, 57293],
    // 0x113CC..0x113CD
    57295
    // 0x113CF
  ],
  55301: [
    [56373, 56375],
    // 0x11435..0x11437
    [56384, 56385],
    // 0x11440..0x11441
    56389,
    // 0x11445
    [56496, 56498],
    // 0x114B0..0x114B2
    56505,
    // 0x114B9
    [56507, 56510],
    // 0x114BB..0x114BE
    56513,
    // 0x114C1
    [56751, 56753],
    // 0x115AF..0x115B1
    [56760, 56763],
    // 0x115B8..0x115BB
    56766,
    // 0x115BE
    [56880, 56882],
    // 0x11630..0x11632
    [56891, 56892],
    // 0x1163B..0x1163C
    56894,
    // 0x1163E
    57004,
    // 0x116AC
    [57006, 57007],
    // 0x116AE..0x116AF
    57014,
    // 0x116B6
    57118,
    // 0x1171E
    [57120, 57121],
    // 0x11720..0x11721
    57126
    // 0x11726
  ],
  55302: [
    [56364, 56366],
    // 0x1182C..0x1182E
    56376,
    // 0x11838
    [56624, 56629],
    // 0x11930..0x11935
    [56631, 56632],
    // 0x11937..0x11938
    56637,
    // 0x1193D
    56640,
    // 0x11940
    56642,
    // 0x11942
    [56785, 56787],
    // 0x119D1..0x119D3
    [56796, 56799],
    // 0x119DC..0x119DF
    56804,
    // 0x119E4
    56889,
    // 0x11A39
    [56919, 56920],
    // 0x11A57..0x11A58
    56983
    // 0x11A97
  ],
  55303: [
    56367,
    // 0x11C2F
    56382,
    // 0x11C3E
    56489,
    // 0x11CA9
    56497,
    // 0x11CB1
    56500,
    // 0x11CB4
    [56714, 56718],
    // 0x11D8A..0x11D8E
    [56723, 56724],
    // 0x11D93..0x11D94
    56726,
    // 0x11D96
    [57077, 57078],
    // 0x11EF5..0x11EF6
    57091,
    // 0x11F03
    [57140, 57141],
    // 0x11F34..0x11F35
    [57150, 57151],
    // 0x11F3E..0x11F3F
    57153
    // 0x11F41
  ],
  55320: [
    [56618, 56620]
    // 0x1612A..0x1612C
  ],
  55323: [
    [57169, 57223],
    // 0x16F51..0x16F87
    [57328, 57329]
    // 0x16FF0..0x16FF1
  ],
  55348: [
    [56677, 56678],
    // 0x1D165..0x1D166
    [56685, 56690]
    // 0x1D16D..0x1D172
  ]
};
var unicodeNd = [
  [48, 57],
  [1632, 1641],
  [1776, 1785],
  [1984, 1993],
  [2406, 2415],
  [2534, 2543],
  [2662, 2671],
  [2790, 2799],
  [2918, 2927],
  [3046, 3055],
  [3174, 3183],
  [3302, 3311],
  [3430, 3439],
  [3558, 3567],
  [3664, 3673],
  [3792, 3801],
  [3872, 3881],
  [4160, 4169],
  [4240, 4249],
  [6112, 6121],
  [6160, 6169],
  [6470, 6479],
  [6608, 6617],
  [6784, 6793],
  [6800, 6809],
  [6992, 7001],
  [7088, 7097],
  [7232, 7241],
  [7248, 7257],
  [42528, 42537],
  [43216, 43225],
  [43264, 43273],
  [43472, 43481],
  [43504, 43513],
  [43600, 43609],
  [44016, 44025],
  [65296, 65305],
  [66720, 66729],
  [68912, 68921],
  [68928, 68937],
  [69734, 69743],
  [69872, 69881],
  [69942, 69951],
  [70096, 70105],
  [70384, 70393],
  [70736, 70745],
  [70864, 70873],
  [71248, 71257],
  [71360, 71369],
  [71376, 71395],
  [71472, 71481],
  [71904, 71913],
  [72016, 72025],
  [72688, 72697],
  [72784, 72793],
  [73040, 73049],
  [73120, 73129],
  [73552, 73561],
  [90416, 90425],
  [92768, 92777],
  [92864, 92873],
  [93008, 93017],
  [93552, 93561],
  [118e3, 118009],
  [120782, 120831],
  [123200, 123209],
  [123632, 123641],
  [124144, 124153],
  [124401, 124410],
  [125264, 125273],
  [130032, 130041]
];
var unicodeNdSurrogate = {
  55297: [
    [56480, 56489]
    // 0x104A0..0x104A9
  ],
  55299: [
    [56624, 56633],
    // 0x10D30..0x10D39
    [56640, 56649]
    // 0x10D40..0x10D49
  ],
  55300: [
    [56422, 56431],
    // 0x11066..0x1106F
    [56560, 56569],
    // 0x110F0..0x110F9
    [56630, 56639],
    // 0x11136..0x1113F
    [56784, 56793],
    // 0x111D0..0x111D9
    [57072, 57081]
    // 0x112F0..0x112F9
  ],
  55301: [
    [56400, 56409],
    // 0x11450..0x11459
    [56528, 56537],
    // 0x114D0..0x114D9
    [56912, 56921],
    // 0x11650..0x11659
    [57024, 57033],
    // 0x116C0..0x116C9
    [57040, 57059],
    // 0x116D0..0x116E3
    [57136, 57145]
    // 0x11730..0x11739
  ],
  55302: [
    [56544, 56553],
    // 0x118E0..0x118E9
    [56656, 56665],
    // 0x11950..0x11959
    [57328, 57337]
    // 0x11BF0..0x11BF9
  ],
  55303: [
    [56400, 56409],
    // 0x11C50..0x11C59
    [56656, 56665],
    // 0x11D50..0x11D59
    [56736, 56745],
    // 0x11DA0..0x11DA9
    [57168, 57177]
    // 0x11F50..0x11F59
  ],
  55320: [
    [56624, 56633]
    // 0x16130..0x16139
  ],
  55322: [
    [56928, 56937],
    // 0x16A60..0x16A69
    [57024, 57033],
    // 0x16AC0..0x16AC9
    [57168, 57177]
    // 0x16B50..0x16B59
  ],
  55323: [
    [56688, 56697]
    // 0x16D70..0x16D79
  ],
  55347: [
    [56560, 56569]
    // 0x1CCF0..0x1CCF9
  ],
  55349: [
    [57294, 57343]
    // 0x1D7CE..0x1D7FF
  ],
  55352: [
    [56640, 56649],
    // 0x1E140..0x1E149
    [57072, 57081]
    // 0x1E2F0..0x1E2F9
  ],
  55353: [
    [56560, 56569],
    // 0x1E4F0..0x1E4F9
    [56817, 56826]
    // 0x1E5F1..0x1E5FA
  ],
  55354: [
    [56656, 56665]
    // 0x1E950..0x1E959
  ],
  55358: [
    [57328, 57337]
    // 0x1FBF0..0x1FBF9
  ]
};
var unicodePc = [
  95,
  [8255, 8256],
  8276,
  [65075, 65076],
  [65101, 65103],
  65343
];

// extract/py/upstream/parser/characters.ts
var _identifierCharFastTableSize = 256;
var _identifierCharFastTable = new Array(_identifierCharFastTableSize);
var _identifierCharMap = {};
var _surrogateCharMap = {};
var _identifierCharMapInitialized = false;
function isIdentifierStartChar(char, nextChar) {
  if (char < _identifierCharFastTableSize) {
    return _identifierCharFastTable[char] === 1 /* StartIdentifierChar */;
  }
  if (!_identifierCharMapInitialized) {
    _buildIdentifierLookupTable(false);
    _identifierCharMapInitialized = true;
  }
  let charCategory;
  if (nextChar !== void 0) {
    charCategory = _lookUpSurrogate(char, nextChar);
  } else {
    charCategory = _identifierCharMap[char];
  }
  return charCategory === 1 /* StartIdentifierChar */;
}
function isIdentifierChar(char, nextChar) {
  if (char < _identifierCharFastTableSize) {
    return _identifierCharFastTable[char] === 1 /* StartIdentifierChar */ || _identifierCharFastTable[char] === 2 /* IdentifierChar */;
  }
  if (!_identifierCharMapInitialized) {
    _buildIdentifierLookupTable(false);
    _identifierCharMapInitialized = true;
  }
  let charCategory;
  if (nextChar !== void 0) {
    charCategory = _lookUpSurrogate(char, nextChar);
  } else {
    charCategory = _identifierCharMap[char];
  }
  return charCategory === 1 /* StartIdentifierChar */ || charCategory === 2 /* IdentifierChar */;
}
function isSurrogateChar(char) {
  if (char < _identifierCharFastTableSize) {
    return false;
  }
  if (!_identifierCharMapInitialized) {
    _buildIdentifierLookupTable(false);
    _identifierCharMapInitialized = true;
  }
  return _identifierCharMap[char] === 3 /* SurrogateChar */;
}
function isWhiteSpace(ch) {
  return ch === 32 /* Space */ || ch === 9 /* Tab */ || ch === 12 /* FormFeed */;
}
function isLineBreak(ch) {
  return ch === 13 /* CarriageReturn */ || ch === 10 /* LineFeed */;
}
function isDecimal(ch) {
  return ch >= 48 /* _0 */ && ch <= 57 /* _9 */ || ch === 95 /* Underscore */;
}
function isHex(ch) {
  return isDecimal(ch) || ch >= 97 /* a */ && ch <= 102 /* f */ || ch >= 65 /* A */ && ch <= 70 /* F */ || ch === 95 /* Underscore */;
}
function isOctal(ch) {
  return ch >= 48 /* _0 */ && ch <= 55 /* _7 */ || ch === 95 /* Underscore */;
}
function isBinary(ch) {
  return ch === 48 /* _0 */ || ch === 49 /* _1 */ || ch === 95 /* Underscore */;
}
function _lookUpSurrogate(char, nextChar) {
  if (_identifierCharMap[char] !== 3 /* SurrogateChar */) {
    return 0 /* NotIdentifierChar */;
  }
  const surrogateTable = _surrogateCharMap[char];
  if (!surrogateTable) {
    return 0 /* NotIdentifierChar */;
  }
  return surrogateTable[nextChar];
}
var _specialStartIdentifierChars = [
  95 /* Underscore */,
  6277,
  6278,
  8472,
  8494,
  12443,
  12444
];
var _startIdentifierCharRanges = [
  _specialStartIdentifierChars,
  unicodeLu,
  unicodeLl,
  unicodeLt,
  unicodeLo,
  unicodeLm,
  unicodeNl
];
var _startCharSurrogateRanges = [
  unicodeLuSurrogate,
  unicodeLlSurrogate,
  unicodeLoSurrogate,
  unicodeLmSurrogate,
  unicodeNlSurrogate
];
var _specialIdentifierChars = [
  183,
  903,
  4969,
  4970,
  4971,
  4972,
  4973,
  4974,
  4975,
  4976,
  4977,
  6618
];
var _identifierCharRanges = [
  _specialIdentifierChars,
  unicodeMn,
  unicodeMc,
  unicodeNd,
  unicodePc
];
var _identifierCharSurrogateRanges = [
  unicodeMnSurrogate,
  unicodeMcSurrogate,
  unicodeNdSurrogate
];
function _buildIdentifierLookupTableFromUnicodeRangeTable(table, category, fastTableOnly, fastTable, fullTable) {
  for (let entryIndex = 0; entryIndex < table.length; entryIndex++) {
    const entry = table[entryIndex];
    let rangeStart;
    let rangeEnd;
    if (Array.isArray(entry)) {
      rangeStart = entry[0];
      rangeEnd = entry[1];
    } else {
      rangeStart = rangeEnd = entry;
    }
    for (let i = rangeStart; i <= rangeEnd; i++) {
      if (i < _identifierCharFastTableSize) {
        fastTable[i] = category;
      } else {
        fullTable[i] = category;
      }
    }
    if (fastTableOnly && rangeStart >= _identifierCharFastTableSize) {
      break;
    }
  }
}
function _buildIdentifierLookupTableFromSurrogateRangeTable(surrogateTable, category) {
  for (const surrogateChar in surrogateTable) {
    if (!_surrogateCharMap[surrogateChar]) {
      _surrogateCharMap[surrogateChar] = {};
      _identifierCharMap[surrogateChar] = 3 /* SurrogateChar */;
    }
    _buildIdentifierLookupTableFromUnicodeRangeTable(
      surrogateTable[surrogateChar],
      category,
      /* fastTableOnly */
      false,
      _surrogateCharMap[surrogateChar],
      _surrogateCharMap[surrogateChar]
    );
  }
}
function _buildIdentifierLookupTable(fastTableOnly) {
  _identifierCharFastTable.fill(0 /* NotIdentifierChar */);
  _identifierCharRanges.forEach((table) => {
    _buildIdentifierLookupTableFromUnicodeRangeTable(
      table,
      2 /* IdentifierChar */,
      fastTableOnly,
      _identifierCharFastTable,
      _identifierCharMap
    );
  });
  _startIdentifierCharRanges.forEach((table) => {
    _buildIdentifierLookupTableFromUnicodeRangeTable(
      table,
      1 /* StartIdentifierChar */,
      fastTableOnly,
      _identifierCharFastTable,
      _identifierCharMap
    );
  });
  if (!fastTableOnly) {
    for (const surrogateTable of _identifierCharSurrogateRanges) {
      _buildIdentifierLookupTableFromSurrogateRangeTable(surrogateTable, 2 /* IdentifierChar */);
    }
    for (const surrogateTable of _startCharSurrogateRanges) {
      _buildIdentifierLookupTableFromSurrogateRangeTable(surrogateTable, 1 /* StartIdentifierChar */);
    }
  }
}
_buildIdentifierLookupTable(true);

// extract/py/upstream/parser/characterStream.ts
var CharacterStream = class {
  _text;
  _position;
  _currentChar;
  _isEndOfStream;
  constructor(text) {
    this._text = text;
    this._position = 0;
    this._currentChar = text.length > 0 ? text.charCodeAt(0) : 0;
    this._isEndOfStream = text.length === 0;
  }
  get position() {
    return this._position;
  }
  set position(value) {
    this._position = value;
    this._checkBounds();
  }
  get currentChar() {
    return this._currentChar;
  }
  get nextChar() {
    return this.position + 1 < this._text.length ? this._text.charCodeAt(this.position + 1) : 0;
  }
  get prevChar() {
    return this.position - 1 >= 0 ? this._text.charCodeAt(this.position - 1) : 0;
  }
  get length() {
    return this._text.length;
  }
  getText() {
    return this._text;
  }
  // We also expose a (non-property) method that is
  // the equivalent of currentChar above. This allows
  // us to work around assumptions in the TypeScript
  // compiler that method calls (e.g. moveNext()) don't
  // modify properties.
  getCurrentChar() {
    return this._currentChar;
  }
  isEndOfStream() {
    return this._isEndOfStream;
  }
  lookAhead(offset) {
    const pos = this._position + offset;
    return pos < 0 || pos >= this._text.length ? 0 : this._text.charCodeAt(pos);
  }
  advance(offset) {
    this.position += offset;
  }
  moveNext() {
    if (this._position < this._text.length - 1) {
      this._position += 1;
      this._currentChar = this._text.charCodeAt(this._position);
      return true;
    }
    this.advance(1);
    return !this.isEndOfStream();
  }
  isAtWhiteSpace() {
    return isWhiteSpace(this.currentChar);
  }
  isAtLineBreak() {
    return isLineBreak(this.currentChar);
  }
  skipLineBreak() {
    if (this._currentChar === 13 /* CarriageReturn */) {
      this.moveNext();
      if (this.currentChar === 10 /* LineFeed */) {
        this.moveNext();
      }
    } else if (this._currentChar === 10 /* LineFeed */) {
      this.moveNext();
    }
  }
  skipWhitespace() {
    const text = this._text;
    const len = text.length;
    let pos = this._position;
    while (pos < len) {
      const ch = text.charCodeAt(pos);
      if (ch === 32 /* Space */ || ch === 9 /* Tab */ || ch === 12 /* FormFeed */) {
        pos++;
      } else {
        break;
      }
    }
    if (pos !== this._position) {
      this._position = pos;
      if (pos >= len) {
        this._isEndOfStream = true;
        this._position = len;
        this._currentChar = 0;
      } else {
        this._currentChar = text.charCodeAt(pos);
      }
    }
  }
  skipToEol() {
    while (!this.isEndOfStream() && !this.isAtLineBreak()) {
      this.moveNext();
    }
  }
  skipToWhitespace() {
    while (!this.isEndOfStream() && !this.isAtWhiteSpace()) {
      this.moveNext();
    }
  }
  charCodeAt(index) {
    return this._text.charCodeAt(index);
  }
  _checkBounds() {
    if (this._position < 0) {
      this._position = 0;
    }
    this._isEndOfStream = this._position >= this._text.length;
    if (this._isEndOfStream) {
      this._position = this._text.length;
    }
    this._currentChar = this._isEndOfStream ? 0 : this._text.charCodeAt(this._position);
  }
};

// extract/py/upstream/parser/tokenizer.ts
var _keywords = /* @__PURE__ */ new Map([
  ["and", 0 /* And */],
  ["as", 1 /* As */],
  ["assert", 2 /* Assert */],
  ["async", 3 /* Async */],
  ["await", 4 /* Await */],
  ["break", 5 /* Break */],
  ["case", 6 /* Case */],
  ["class", 7 /* Class */],
  ["continue", 8 /* Continue */],
  ["__debug__", 9 /* Debug */],
  ["def", 10 /* Def */],
  ["del", 11 /* Del */],
  ["elif", 12 /* Elif */],
  ["else", 13 /* Else */],
  ["except", 14 /* Except */],
  ["finally", 16 /* Finally */],
  ["for", 17 /* For */],
  ["from", 18 /* From */],
  ["global", 19 /* Global */],
  ["if", 20 /* If */],
  ["import", 21 /* Import */],
  ["in", 22 /* In */],
  ["is", 23 /* Is */],
  ["lambda", 24 /* Lambda */],
  ["lazy", 25 /* Lazy */],
  ["match", 26 /* Match */],
  ["nonlocal", 28 /* Nonlocal */],
  ["not", 29 /* Not */],
  ["or", 30 /* Or */],
  ["pass", 31 /* Pass */],
  ["raise", 32 /* Raise */],
  ["return", 33 /* Return */],
  ["try", 35 /* Try */],
  ["type", 36 /* Type */],
  ["while", 37 /* While */],
  ["with", 38 /* With */],
  ["yield", 39 /* Yield */],
  ["False", 15 /* False */],
  ["None", 27 /* None */],
  ["True", 34 /* True */]
]);
var _keywordFirstCharTable = (() => {
  const table = new Array(128).fill(false);
  for (const kw of _keywords.keys()) {
    const code = kw.charCodeAt(0);
    if (code < 128) {
      table[code] = true;
    }
  }
  return table;
})();
var _keywordMinLen = 2;
var _keywordMaxLen = 9;
var _keywordEntriesByFirstChar = (() => {
  const entriesByFirstChar = new Array(128);
  for (const [text, type] of _keywords.entries()) {
    const firstCharCode = text.charCodeAt(0);
    if (firstCharCode < 128) {
      const entries = entriesByFirstChar[firstCharCode] ?? (entriesByFirstChar[firstCharCode] = []);
      entries.push({ text, type });
    }
  }
  return entriesByFirstChar;
})();
function getKeywordTypeFromTextSlice(text, start, length) {
  if (length < _keywordMinLen || length > _keywordMaxLen) {
    return void 0;
  }
  const firstCharCode = text.charCodeAt(start);
  if (firstCharCode >= 128 || !_keywordFirstCharTable[firstCharCode]) {
    return void 0;
  }
  const candidates = _keywordEntriesByFirstChar[firstCharCode];
  if (!candidates) {
    return void 0;
  }
  for (const candidate of candidates) {
    if (candidate.text.length === length && text.startsWith(candidate.text, start)) {
      return candidate.type;
    }
  }
  return void 0;
}
var _operatorInfo = {
  [0 /* Add */]: 1 /* Unary */ | 2 /* Binary */,
  [1 /* AddEqual */]: 4 /* Assignment */,
  [2 /* Assign */]: 4 /* Assignment */,
  [3 /* BitwiseAnd */]: 2 /* Binary */,
  [4 /* BitwiseAndEqual */]: 4 /* Assignment */,
  [5 /* BitwiseInvert */]: 1 /* Unary */,
  [6 /* BitwiseOr */]: 2 /* Binary */,
  [7 /* BitwiseOrEqual */]: 4 /* Assignment */,
  [8 /* BitwiseXor */]: 2 /* Binary */,
  [9 /* BitwiseXorEqual */]: 4 /* Assignment */,
  [10 /* Divide */]: 2 /* Binary */,
  [11 /* DivideEqual */]: 4 /* Assignment */,
  [12 /* Equals */]: 2 /* Binary */ | 8 /* Comparison */,
  [13 /* FloorDivide */]: 2 /* Binary */,
  [14 /* FloorDivideEqual */]: 4 /* Assignment */,
  [15 /* GreaterThan */]: 2 /* Binary */ | 8 /* Comparison */,
  [16 /* GreaterThanOrEqual */]: 2 /* Binary */ | 8 /* Comparison */,
  [17 /* LeftShift */]: 2 /* Binary */,
  [18 /* LeftShiftEqual */]: 4 /* Assignment */,
  [19 /* LessOrGreaterThan */]: 2 /* Binary */ | 8 /* Comparison */ | 16 /* Deprecated */,
  [20 /* LessThan */]: 2 /* Binary */ | 8 /* Comparison */,
  [21 /* LessThanOrEqual */]: 2 /* Binary */ | 8 /* Comparison */,
  [22 /* MatrixMultiply */]: 2 /* Binary */,
  [23 /* MatrixMultiplyEqual */]: 4 /* Assignment */,
  [24 /* Mod */]: 2 /* Binary */,
  [25 /* ModEqual */]: 4 /* Assignment */,
  [26 /* Multiply */]: 2 /* Binary */,
  [27 /* MultiplyEqual */]: 4 /* Assignment */,
  [28 /* NotEquals */]: 2 /* Binary */ | 8 /* Comparison */,
  [29 /* Power */]: 2 /* Binary */,
  [30 /* PowerEqual */]: 4 /* Assignment */,
  [31 /* RightShift */]: 2 /* Binary */,
  [32 /* RightShiftEqual */]: 4 /* Assignment */,
  [33 /* Subtract */]: 2 /* Binary */,
  [34 /* SubtractEqual */]: 4 /* Assignment */,
  [36 /* And */]: 2 /* Binary */,
  [37 /* Or */]: 2 /* Binary */,
  [38 /* Not */]: 1 /* Unary */,
  [39 /* Is */]: 2 /* Binary */,
  [40 /* IsNot */]: 2 /* Binary */,
  [41 /* In */]: 2 /* Binary */,
  [42 /* NotIn */]: 2 /* Binary */
};
var _unsetSingleCharOperatorType = -1;
var _singleCharOperatorTypeTable = (() => {
  const table = new Int16Array(128);
  table.fill(_unsetSingleCharOperatorType);
  table[61 /* Equal */] = 2 /* Assign */;
  table[43 /* Plus */] = 0 /* Add */;
  table[45 /* Hyphen */] = 33 /* Subtract */;
  table[42 /* Asterisk */] = 26 /* Multiply */;
  table[47 /* Slash */] = 10 /* Divide */;
  table[38 /* Ampersand */] = 3 /* BitwiseAnd */;
  table[124 /* Bar */] = 6 /* BitwiseOr */;
  table[94 /* Caret */] = 8 /* BitwiseXor */;
  table[37 /* Percent */] = 24 /* Mod */;
  table[126 /* Tilde */] = 5 /* BitwiseInvert */;
  table[64 /* At */] = 22 /* MatrixMultiply */;
  table[60 /* Less */] = 20 /* LessThan */;
  table[62 /* Greater */] = 15 /* GreaterThan */;
  return table;
})();
var _singleCharEqualOperatorTypeTable = (() => {
  const table = new Int16Array(128);
  table.fill(_unsetSingleCharOperatorType);
  table[43 /* Plus */] = 1 /* AddEqual */;
  table[45 /* Hyphen */] = 34 /* SubtractEqual */;
  table[42 /* Asterisk */] = 27 /* MultiplyEqual */;
  table[47 /* Slash */] = 11 /* DivideEqual */;
  table[38 /* Ampersand */] = 4 /* BitwiseAndEqual */;
  table[124 /* Bar */] = 7 /* BitwiseOrEqual */;
  table[94 /* Caret */] = 9 /* BitwiseXorEqual */;
  table[37 /* Percent */] = 25 /* ModEqual */;
  table[64 /* At */] = 23 /* MatrixMultiplyEqual */;
  return table;
})();
function getTwoCharKey(char1, char2) {
  return char1 << 8 | char2;
}
var _twoCharOperatorTypeMap = /* @__PURE__ */ new Map([
  [getTwoCharKey(61 /* Equal */, 61 /* Equal */), 12 /* Equals */],
  [getTwoCharKey(33 /* ExclamationMark */, 61 /* Equal */), 28 /* NotEquals */],
  [getTwoCharKey(60 /* Less */, 61 /* Equal */), 21 /* LessThanOrEqual */],
  [getTwoCharKey(62 /* Greater */, 61 /* Equal */), 16 /* GreaterThanOrEqual */],
  [getTwoCharKey(60 /* Less */, 62 /* Greater */), 19 /* LessOrGreaterThan */]
]);
var _twoCharSpecialTokenTypeMap = /* @__PURE__ */ new Map([
  [getTwoCharKey(45 /* Hyphen */, 62 /* Greater */), 21 /* Arrow */]
]);
var _repeatedCharOperatorTypeTable = (() => {
  const table = new Int16Array(128);
  table.fill(_unsetSingleCharOperatorType);
  table[42 /* Asterisk */] = 29 /* Power */;
  table[47 /* Slash */] = 13 /* FloorDivide */;
  table[60 /* Less */] = 17 /* LeftShift */;
  table[62 /* Greater */] = 31 /* RightShift */;
  return table;
})();
var _repeatedCharEqualOperatorTypeTable = (() => {
  const table = new Int16Array(128);
  table.fill(_unsetSingleCharOperatorType);
  table[42 /* Asterisk */] = 30 /* PowerEqual */;
  table[47 /* Slash */] = 14 /* FloorDivideEqual */;
  table[60 /* Less */] = 18 /* LeftShiftEqual */;
  table[62 /* Greater */] = 32 /* RightShiftEqual */;
  return table;
})();
var _byteOrderMarker = 65279;
var defaultTabSize = 8;
var _canStartString = (() => {
  const table = new Array(128).fill(false);
  table[39 /* SingleQuote */] = true;
  table[34 /* DoubleQuote */] = true;
  for (const ch of [102 /* f */, 70 /* F */, 114 /* r */, 82 /* R */, 98 /* b */, 66 /* B */, 117 /* u */, 85 /* U */, 116 /* t */, 84 /* T */]) {
    table[ch] = true;
  }
  return table;
})();
var _asciiIdentifierContinue = (() => {
  const table = new Array(128).fill(false);
  for (let i = 0; i < 128; i++) {
    if (isIdentifierChar(i)) {
      table[i] = true;
    }
  }
  return table;
})();
var _asciiIdentifierStart = (() => {
  const table = new Array(128).fill(false);
  for (let i = 0; i < 128; i++) {
    if (isIdentifierStartChar(i)) {
      table[i] = true;
    }
  }
  return table;
})();
function detachSubstring(text, start, end) {
  let result = "";
  for (let i = start; i < end; i++) {
    result += text.charAt(i);
  }
  return result;
}
function removeUnderscoresFromRange(text, start, end) {
  let firstUnderscoreIndex = -1;
  for (let i = start; i < end; i++) {
    if (text.charCodeAt(i) === 95 /* Underscore */) {
      firstUnderscoreIndex = i;
      break;
    }
  }
  if (firstUnderscoreIndex < 0) {
    return text.slice(start, end);
  }
  let result = text.slice(start, firstUnderscoreIndex);
  for (let i = firstUnderscoreIndex + 1; i < end; i++) {
    if (text.charCodeAt(i) !== 95 /* Underscore */) {
      result += text[i];
    }
  }
  return result;
}
var Tokenizer = class _Tokenizer {
  _cs = new CharacterStream("");
  _tokens = [];
  _prevLineStart = 0;
  _parenDepth = 0;
  _lineRanges = [];
  _indentAmounts = [];
  _fStringStack = [];
  _activeFString;
  // Direct-mapped identifier intern cache. Indexed by a cheap hash of
  // (firstChar, lastChar, length). On a hit (slot defined and string
  // equals the current source range), reuse the cached string instead of
  // re-allocating via detachSubstring. Collisions simply overwrite the
  // slot — no chaining, O(1) lookup, no Map overhead. Sized as a power of
  // two so the mask is a single AND.
  static _identifierCacheSize = 2048;
  static _identifierCacheMask = _Tokenizer._identifierCacheSize - 1;
  _identifierCache = new Array(_Tokenizer._identifierCacheSize);
  tokenize(text, start, length) {
    if (start === void 0) {
      start = 0;
    } else if (start < 0 || start > text.length) {
      throw new Error(`Invalid range start (start=${start}, text.length=${text.length})`);
    }
    if (length === void 0) {
      length = text.length;
    } else if (length < 0 || start + length > text.length) {
      throw new Error(`Invalid range length (start=${start}, length=${length}, text.length=${text.length})`);
    } else if (start + length < text.length) {
      text = text.slice(0, start + length);
    }
    this._cs = new CharacterStream(text);
    this._cs.position = start;
    this._tokens = [];
    this._prevLineStart = 0;
    this._parenDepth = 0;
    this._lineRanges = [];
    this._indentAmounts = [];
    this._identifierCache.fill(void 0);
    const end = start + length;
    if (start === 0) {
      this._readIndentationAfterNewLine();
    }
    while (!this._cs.isEndOfStream()) {
      this._addNextToken();
      if (this._cs.position >= end) {
        break;
      }
    }
    while (this._activeFString) {
      this._tokens.push(
        FStringEndToken.create(
          this._cs.position,
          0,
          this._activeFString.startToken.flags | 65536 /* Unterminated */
        )
      );
      this._activeFString = this._fStringStack.pop();
    }
    if (this._tokens.length === 0 || this._tokens[this._tokens.length - 1].type !== 2 /* NewLine */) {
      if (this._parenDepth === 0) {
        this._tokens.push(NewLineToken.create(this._cs.position, 0, 3 /* Implied */));
      }
    }
    this._setIndent(
      this._cs.position,
      0,
      0,
      /* isSpacePresent */
      false,
      /* isTabPresent */
      false
    );
    this._tokens.push(Token.create(1 /* EndOfStream */, this._cs.position, 0));
    this._addLineRange();
    if (this._lineRanges.length > 0) {
      const lastLine = this._lineRanges[this._lineRanges.length - 1];
      const lastCharOfLastLine = text.charCodeAt(lastLine.start + lastLine.length - 1);
      if (lastCharOfLastLine === 13 /* CarriageReturn */ || lastCharOfLastLine === 10 /* LineFeed */) {
        this._lineRanges.push({ start: this._cs.position, length: 0 });
      }
    }
    return {
      tokens: new TextRangeCollection(this._tokens),
      lines: new TextRangeCollection(this._lineRanges)
    };
  }
  static getOperatorInfo(operatorType) {
    return _operatorInfo[operatorType];
  }
  static isOperatorAssignment(operatorType) {
    if (operatorType === void 0 || _operatorInfo[operatorType] === void 0) {
      return false;
    }
    return (_operatorInfo[operatorType] & 4 /* Assignment */) !== 0;
  }
  static isOperatorComparison(operatorType) {
    if (operatorType === void 0 || _operatorInfo[operatorType] === void 0) {
      return false;
    }
    return (_operatorInfo[operatorType] & 8 /* Comparison */) !== 0;
  }
  _addNextToken() {
    if (this._activeFString && (!this._activeFString.activeReplacementField || this._activeFString.activeReplacementField.inFormatSpecifier)) {
      this._handleFStringMiddle();
    } else {
      this._cs.skipWhitespace();
    }
    if (this._cs.isEndOfStream()) {
      return;
    }
    if (!this._handleCharacter()) {
      this._cs.moveNext();
    }
  }
  // Consumes one or more characters from the character stream and pushes
  // tokens onto the token list. Returns true if the caller should advance
  // to the next character.
  _handleCharacter() {
    const currentChar = this._cs.currentChar;
    if (currentChar < 128 && _canStartString[currentChar]) {
      const stringPrefixLength = this._getStringPrefixLength();
      if (stringPrefixLength >= 0) {
        let stringPrefix = "";
        if (stringPrefixLength > 0) {
          stringPrefix = this._cs.getText().slice(this._cs.position, this._cs.position + stringPrefixLength);
          this._cs.advance(stringPrefixLength);
        }
        const quoteTypeFlags = this._getQuoteTypeFlags(stringPrefix);
        if (quoteTypeFlags !== 0 /* None */) {
          this._handleString(quoteTypeFlags, stringPrefixLength);
          return true;
        }
      }
    }
    if (this._cs.currentChar === 35 /* Hash */) {
      this._cs.skipToEol();
      return true;
    }
    switch (this._cs.currentChar) {
      case _byteOrderMarker: {
        if (this._cs.position === 0) {
          return false;
        }
        return this._handleInvalid();
      }
      case 13 /* CarriageReturn */: {
        const length = this._cs.nextChar === 10 /* LineFeed */ ? 2 : 1;
        const newLineType = length === 2 ? 2 /* CarriageReturnLineFeed */ : 0 /* CarriageReturn */;
        this._handleNewLine(length, newLineType);
        return true;
      }
      case 10 /* LineFeed */: {
        this._handleNewLine(1, 1 /* LineFeed */);
        return true;
      }
      case 92 /* Backslash */: {
        if (this._cs.nextChar === 13 /* CarriageReturn */) {
          const advance = this._cs.lookAhead(2) === 10 /* LineFeed */ ? 3 : 2;
          if (this._cs.position + advance >= this._cs.length) {
            return this._handleInvalid();
          }
          this._cs.advance(advance);
          this._addLineRange();
          if (this._tokens.length > 0 && this._tokens[this._tokens.length - 1].type === 2 /* NewLine */) {
            this._readIndentationAfterNewLine();
          }
          return true;
        }
        if (this._cs.nextChar === 10 /* LineFeed */) {
          const advance = 2;
          if (this._cs.position + advance >= this._cs.length) {
            return this._handleInvalid();
          }
          this._cs.advance(advance);
          this._addLineRange();
          if (this._tokens.length > 0 && this._tokens[this._tokens.length - 1].type === 2 /* NewLine */) {
            this._readIndentationAfterNewLine();
          }
          return true;
        }
        return this._handleInvalid();
      }
      case 40 /* OpenParenthesis */: {
        this._parenDepth++;
        this._tokens.push(Token.create(13 /* OpenParenthesis */, this._cs.position, 1));
        break;
      }
      case 41 /* CloseParenthesis */: {
        if (this._parenDepth > 0) {
          this._parenDepth--;
        }
        this._tokens.push(Token.create(14 /* CloseParenthesis */, this._cs.position, 1));
        break;
      }
      case 91 /* OpenBracket */: {
        this._parenDepth++;
        this._tokens.push(Token.create(15 /* OpenBracket */, this._cs.position, 1));
        break;
      }
      case 93 /* CloseBracket */: {
        if (this._parenDepth > 0) {
          this._parenDepth--;
        }
        this._tokens.push(Token.create(16 /* CloseBracket */, this._cs.position, 1));
        break;
      }
      case 123 /* OpenBrace */: {
        this._parenDepth++;
        this._tokens.push(Token.create(17 /* OpenCurlyBrace */, this._cs.position, 1));
        if (this._activeFString) {
          if (!this._activeFString.activeReplacementField || this._activeFString.activeReplacementField.inFormatSpecifier) {
            if (this._activeFString.activeReplacementField) {
              this._activeFString.replacementFieldStack.push(this._activeFString.activeReplacementField);
            }
            this._activeFString.activeReplacementField = {
              inFormatSpecifier: false,
              parenDepth: this._parenDepth
            };
          }
        }
        break;
      }
      case 125 /* CloseBrace */: {
        if (this._activeFString && this._activeFString.activeReplacementField?.parenDepth === this._parenDepth) {
          this._activeFString.activeReplacementField = this._activeFString.replacementFieldStack.pop();
        }
        if (this._parenDepth > 0) {
          this._parenDepth--;
        }
        this._tokens.push(Token.create(18 /* CloseCurlyBrace */, this._cs.position, 1));
        break;
      }
      case 44 /* Comma */: {
        this._tokens.push(Token.create(12 /* Comma */, this._cs.position, 1));
        break;
      }
      case 96 /* Backtick */: {
        this._tokens.push(Token.create(22 /* Backtick */, this._cs.position, 1));
        break;
      }
      case 59 /* Semicolon */: {
        this._tokens.push(Token.create(11 /* Semicolon */, this._cs.position, 1));
        break;
      }
      case 58 /* Colon */: {
        if (this._cs.nextChar === 61 /* Equal */) {
          if (!this._activeFString || !this._activeFString.activeReplacementField || this._activeFString.activeReplacementField.parenDepth !== this._parenDepth) {
            this._tokens.push(
              OperatorToken.create(this._cs.position, 2, 35 /* Walrus */)
            );
            this._cs.advance(1);
            break;
          }
        }
        this._tokens.push(Token.create(10 /* Colon */, this._cs.position, 1));
        if (this._activeFString?.activeReplacementField && this._parenDepth === this._activeFString.activeReplacementField.parenDepth) {
          this._activeFString.activeReplacementField.inFormatSpecifier = true;
        }
        break;
      }
      default: {
        if (this._isPossibleNumber()) {
          if (this._tryNumber()) {
            return true;
          }
        }
        if (this._cs.currentChar === 46 /* Period */) {
          if (this._cs.nextChar === 46 /* Period */ && this._cs.lookAhead(2) === 46 /* Period */) {
            this._tokens.push(Token.create(19 /* Ellipsis */, this._cs.position, 3));
            this._cs.advance(3);
            return true;
          }
          this._tokens.push(Token.create(20 /* Dot */, this._cs.position, 1));
          break;
        }
        if (!this._tryIdentifier()) {
          if (!this._tryOperator()) {
            return this._handleInvalid();
          }
        }
        return true;
      }
    }
    return false;
  }
  _addLineRange() {
    const lineLength = this._cs.position - this._prevLineStart;
    if (lineLength > 0) {
      this._lineRanges.push({ start: this._prevLineStart, length: lineLength });
    }
    this._prevLineStart = this._cs.position;
  }
  _handleNewLine(length, newLineType) {
    if (this._parenDepth === 0 && newLineType !== 3 /* Implied */) {
      if (this._tokens.length === 0 || this._tokens[this._tokens.length - 1].type !== 2 /* NewLine */) {
        this._tokens.push(NewLineToken.create(this._cs.position, length, newLineType));
      }
    }
    this._cs.advance(length);
    this._addLineRange();
    this._readIndentationAfterNewLine();
  }
  _readIndentationAfterNewLine() {
    let tab1Spaces = 0;
    let tab8Spaces = 0;
    let isTabPresent = false;
    let isSpacePresent = false;
    const startOffset = this._cs.position;
    while (!this._cs.isEndOfStream()) {
      switch (this._cs.currentChar) {
        case 32 /* Space */:
          tab1Spaces++;
          tab8Spaces++;
          isSpacePresent = true;
          this._cs.moveNext();
          break;
        case 9 /* Tab */:
          tab1Spaces++;
          tab8Spaces += defaultTabSize - tab8Spaces % defaultTabSize;
          isTabPresent = true;
          this._cs.moveNext();
          break;
        case 12 /* FormFeed */:
          tab1Spaces = 0;
          tab8Spaces = 0;
          isTabPresent = false;
          isSpacePresent = false;
          this._cs.moveNext();
          break;
        case 35 /* Hash */:
        case 10 /* LineFeed */:
        case 13 /* CarriageReturn */:
          return;
        default:
          this._setIndent(startOffset, tab1Spaces, tab8Spaces, isSpacePresent, isTabPresent);
          return;
      }
    }
  }
  // The caller must specify two space count values. The first assumes
  // that tabs are translated into one-space tab stops. The second assumes
  // that tabs are translated into eight-space tab stops.
  _setIndent(startOffset, tab1Spaces, tab8Spaces, isSpacePresent, isTabPresent) {
    if (this._parenDepth > 0) {
      return;
    }
    if (this._indentAmounts.length === 0) {
      if (tab8Spaces > 0) {
        this._indentAmounts.push({
          tab1Spaces,
          tab8Spaces,
          isSpacePresent,
          isTabPresent
        });
        this._tokens.push(IndentToken.create(startOffset, tab1Spaces, tab8Spaces, false));
      }
    } else {
      const prevTabInfo = this._indentAmounts[this._indentAmounts.length - 1];
      if (prevTabInfo.tab8Spaces < tab8Spaces) {
        const isIndentAmbiguous = (prevTabInfo.isSpacePresent && isTabPresent || prevTabInfo.isTabPresent && isSpacePresent) && prevTabInfo.tab1Spaces >= tab1Spaces;
        this._indentAmounts.push({
          tab1Spaces,
          tab8Spaces,
          isSpacePresent,
          isTabPresent
        });
        this._tokens.push(
          IndentToken.create(startOffset, tab1Spaces, tab8Spaces, isIndentAmbiguous)
        );
      } else if (prevTabInfo.tab8Spaces === tab8Spaces) {
        if (prevTabInfo.isSpacePresent && isTabPresent || prevTabInfo.isTabPresent && isSpacePresent) {
          this._tokens.push(
            IndentToken.create(startOffset, tab1Spaces, tab8Spaces, true)
          );
        }
      } else {
        let isDedentAmbiguous = prevTabInfo.isSpacePresent && isTabPresent || prevTabInfo.isTabPresent && isSpacePresent;
        const dedentPoints = [];
        while (this._indentAmounts.length > 0 && this._indentAmounts[this._indentAmounts.length - 1].tab8Spaces > tab8Spaces) {
          dedentPoints.push(
            this._indentAmounts.length > 1 ? this._indentAmounts[this._indentAmounts.length - 2].tab8Spaces : 0
          );
          this._indentAmounts.pop();
        }
        dedentPoints.forEach((dedentAmount, index) => {
          const matchesIndent = index < dedentPoints.length - 1 || dedentAmount === tab8Spaces;
          const actualDedentAmount = index < dedentPoints.length - 1 ? dedentAmount : tab8Spaces;
          this._tokens.push(
            DedentToken.create(
              this._cs.position,
              0,
              actualDedentAmount,
              matchesIndent,
              isDedentAmbiguous
            )
          );
          isDedentAmbiguous = false;
        });
      }
    }
  }
  _tryIdentifier() {
    const cs = this._cs;
    const text = cs.getText();
    const textLen = text.length;
    const start = cs.position;
    const firstChar = cs.currentChar;
    let pos = start;
    if (firstChar < 128) {
      if (!_asciiIdentifierStart[firstChar]) {
        return false;
      }
      pos++;
      while (pos < textLen) {
        const ch = text.charCodeAt(pos);
        if (ch < 128 && _asciiIdentifierContinue[ch]) {
          pos++;
        } else {
          break;
        }
      }
      if (pos < textLen && text.charCodeAt(pos) >= 128) {
        cs.advance(pos - start);
        this._swallowNonAsciiIdentifierChars();
        pos = cs.position;
      } else {
        cs.advance(pos - start);
      }
    } else {
      if (isIdentifierStartChar(firstChar)) {
        cs.moveNext();
      } else if (isIdentifierStartChar(firstChar, cs.nextChar)) {
        cs.moveNext();
        cs.moveNext();
      } else {
        return false;
      }
      this._swallowNonAsciiIdentifierChars();
      pos = cs.position;
    }
    if (pos > start) {
      const end = pos;
      const length = end - start;
      const keywordType = getKeywordTypeFromTextSlice(text, start, length);
      if (keywordType !== void 0) {
        this._tokens.push(KeywordToken.create(start, length, keywordType));
      } else {
        const value = this._internIdentifier(text, start, end, length);
        this._tokens.push(IdentifierToken.create(start, length, value));
      }
      return true;
    }
    return false;
  }
  // Per-tokenize identifier intern cache. Direct-mapped, so collisions
  // simply replace the slot. Common identifiers (self, cls, True, None,
  // str, int, dict, etc.) get deduplicated to a single string object,
  // avoiding repeated detachSubstring allocations for the same name.
  _internIdentifier(text, start, end, length) {
    const firstChar = text.charCodeAt(start);
    const lastChar = text.charCodeAt(end - 1);
    const hash = firstChar * 31 + lastChar * 7 + length & _Tokenizer._identifierCacheMask;
    const cached = this._identifierCache[hash];
    if (cached !== void 0 && cached.length === length && text.startsWith(cached, start)) {
      return cached;
    }
    const value = detachSubstring(text, start, end);
    this._identifierCache[hash] = value;
    return value;
  }
  // Generic identifier-continue loop that handles unicode + surrogate pairs.
  // Falls back to this when the fast ASCII loop encounters a non-ASCII char.
  _swallowNonAsciiIdentifierChars() {
    while (true) {
      if (isIdentifierChar(this._cs.currentChar)) {
        this._cs.moveNext();
      } else if (isIdentifierChar(this._cs.currentChar, this._cs.nextChar)) {
        this._cs.moveNext();
        this._cs.moveNext();
      } else {
        break;
      }
    }
  }
  _isPossibleNumber() {
    if (isDecimal(this._cs.currentChar)) {
      return true;
    }
    if (this._cs.currentChar === 46 /* Period */ && isDecimal(this._cs.nextChar)) {
      return true;
    }
    return false;
  }
  _tryNumber() {
    const start = this._cs.position;
    if (this._cs.currentChar === 48 /* _0 */) {
      let radix = 0;
      let leadingChars = 0;
      if ((this._cs.nextChar === 120 /* x */ || this._cs.nextChar === 88 /* X */) && isHex(this._cs.lookAhead(2))) {
        this._cs.advance(2);
        leadingChars = 2;
        while (isHex(this._cs.currentChar)) {
          this._cs.moveNext();
        }
        radix = 16;
      } else if ((this._cs.nextChar === 98 /* b */ || this._cs.nextChar === 66 /* B */) && isBinary(this._cs.lookAhead(2))) {
        this._cs.advance(2);
        leadingChars = 2;
        while (isBinary(this._cs.currentChar)) {
          this._cs.moveNext();
        }
        radix = 2;
      } else if ((this._cs.nextChar === 111 /* o */ || this._cs.nextChar === 79 /* O */) && isOctal(this._cs.lookAhead(2))) {
        this._cs.advance(2);
        leadingChars = 2;
        while (isOctal(this._cs.currentChar)) {
          this._cs.moveNext();
        }
        radix = 8;
      }
      if (radix > 0) {
        const end = this._cs.position;
        const text = this._cs.getText();
        const simpleIntText = removeUnderscoresFromRange(text, start, end);
        let intValue = parseInt(simpleIntText.slice(leadingChars), radix);
        if (!isNaN(intValue)) {
          const bigIntValue = BigInt(simpleIntText);
          if (!isFinite(intValue) || intValue < Number.MIN_SAFE_INTEGER || intValue > Number.MAX_SAFE_INTEGER) {
            intValue = bigIntValue;
          }
          this._tokens.push(
            NumberToken.create(start, end - start, intValue, true, false)
          );
          return true;
        }
      }
    }
    let isDecimalInteger = false;
    let mightBeFloatingPoint = false;
    if (this._cs.currentChar >= 49 /* _1 */ && this._cs.currentChar <= 57 /* _9 */) {
      while (isDecimal(this._cs.currentChar)) {
        mightBeFloatingPoint = true;
        this._cs.moveNext();
      }
      isDecimalInteger = this._cs.currentChar !== 46 /* Period */ && this._cs.currentChar !== 101 /* e */ && this._cs.currentChar !== 69 /* E */;
    }
    if (this._cs.currentChar === 48 /* _0 */) {
      mightBeFloatingPoint = true;
      while (this._cs.currentChar === 48 /* _0 */ || this._cs.currentChar === 95 /* Underscore */) {
        this._cs.moveNext();
      }
      isDecimalInteger = this._cs.currentChar !== 46 /* Period */ && this._cs.currentChar !== 101 /* e */ && this._cs.currentChar !== 69 /* E */ && (this._cs.currentChar < 49 /* _1 */ || this._cs.currentChar > 57 /* _9 */);
    }
    if (isDecimalInteger) {
      const textEnd = this._cs.position;
      const sourceText = this._cs.getText();
      const simpleIntText = removeUnderscoresFromRange(sourceText, start, textEnd);
      let intValue = parseInt(simpleIntText, 10);
      if (!isNaN(intValue)) {
        let isImaginary = false;
        let tokenLength = textEnd - start;
        const bigIntValue = BigInt(simpleIntText);
        if (!isFinite(intValue) || bigIntValue < Number.MIN_SAFE_INTEGER || bigIntValue > Number.MAX_SAFE_INTEGER) {
          intValue = bigIntValue;
        }
        if (this._cs.currentChar === 106 /* j */ || this._cs.currentChar === 74 /* J */) {
          isImaginary = true;
          this._cs.moveNext();
          tokenLength += 1;
        }
        this._tokens.push(
          NumberToken.create(start, tokenLength, intValue, true, isImaginary)
        );
        return true;
      }
    }
    this._cs.position = start;
    if (mightBeFloatingPoint || this._cs.currentChar === 46 /* Period */ && this._cs.nextChar >= 48 /* _0 */ && this._cs.nextChar <= 57 /* _9 */) {
      if (this._skipFloatingPointCandidate()) {
        const floatEnd = this._cs.position;
        const floatText = removeUnderscoresFromRange(this._cs.getText(), start, floatEnd);
        const value = parseFloat(floatText);
        if (!isNaN(value)) {
          let isImaginary = false;
          let tokenLength = floatEnd - start;
          if (this._cs.currentChar === 106 /* j */ || this._cs.currentChar === 74 /* J */) {
            isImaginary = true;
            this._cs.moveNext();
            tokenLength += 1;
          }
          this._tokens.push(
            NumberToken.create(start, tokenLength, value, false, isImaginary)
          );
          return true;
        }
      }
    }
    this._cs.position = start;
    return false;
  }
  _tryOperator() {
    const currentChar = this._cs.currentChar;
    let length = 0;
    const nextChar = this._cs.nextChar;
    let operatorType;
    if (currentChar < 128 && nextChar < 128) {
      const twoCharKey = currentChar << 8 | nextChar;
      const specialTokenType = _twoCharSpecialTokenTypeMap.get(twoCharKey);
      if (specialTokenType !== void 0) {
        this._tokens.push(Token.create(specialTokenType, this._cs.position, 2));
        this._cs.advance(2);
        return true;
      }
      const twoCharOperatorType = _twoCharOperatorTypeMap.get(twoCharKey);
      if (twoCharOperatorType !== void 0) {
        this._tokens.push(OperatorToken.create(this._cs.position, 2, twoCharOperatorType));
        this._cs.advance(2);
        return true;
      }
      if (currentChar === nextChar) {
        const repeatedOperatorType = _repeatedCharOperatorTypeTable[currentChar];
        if (repeatedOperatorType !== _unsetSingleCharOperatorType) {
          const hasTrailingEqual = this._cs.lookAhead(2) === 61 /* Equal */;
          const repeatedLength = hasTrailingEqual ? 3 : 2;
          const operatorType2 = hasTrailingEqual ? _repeatedCharEqualOperatorTypeTable[currentChar] : repeatedOperatorType;
          this._tokens.push(
            OperatorToken.create(
              this._cs.position,
              repeatedLength,
              operatorType2
            )
          );
          this._cs.advance(repeatedLength);
          return true;
        }
      }
    }
    if (currentChar < 128) {
      const singleCharOperatorType = _singleCharOperatorTypeTable[currentChar];
      if (singleCharOperatorType !== _unsetSingleCharOperatorType) {
        const equalOperatorType = _singleCharEqualOperatorTypeTable[currentChar];
        if (nextChar === 61 /* Equal */ && equalOperatorType !== _unsetSingleCharOperatorType) {
          length = 2;
          operatorType = equalOperatorType;
        } else {
          length = 1;
          operatorType = singleCharOperatorType;
        }
        this._tokens.push(OperatorToken.create(this._cs.position, length, operatorType));
        this._cs.advance(length);
        return true;
      }
    }
    if (currentChar === 33 /* ExclamationMark */ && this._activeFString) {
      this._tokens.push(Token.create(23 /* ExclamationMark */, this._cs.position, 1));
      this._cs.advance(1);
      return true;
    }
    return false;
  }
  _handleInvalid() {
    const start = this._cs.position;
    while (true) {
      if (this._cs.currentChar === 10 /* LineFeed */ || this._cs.currentChar === 13 /* CarriageReturn */ || this._cs.isAtWhiteSpace() || this._cs.isEndOfStream()) {
        break;
      }
      if (isSurrogateChar(this._cs.currentChar)) {
        this._cs.moveNext();
        this._cs.moveNext();
      } else {
        this._cs.moveNext();
      }
    }
    const length = this._cs.position - start;
    if (length > 0) {
      this._tokens.push(Token.create(0 /* Invalid */, start, length));
      return true;
    }
    return false;
  }
  _getStringPrefixLength() {
    if (this._cs.currentChar === 39 /* SingleQuote */ || this._cs.currentChar === 34 /* DoubleQuote */) {
      return 0;
    }
    if (this._cs.nextChar === 39 /* SingleQuote */ || this._cs.nextChar === 34 /* DoubleQuote */) {
      switch (this._cs.currentChar) {
        case 102 /* f */:
        case 70 /* F */:
        case 114 /* r */:
        case 82 /* R */:
        case 98 /* b */:
        case 66 /* B */:
        case 117 /* u */:
        case 85 /* U */:
        case 116 /* t */:
        case 84 /* T */:
          return 1;
        default:
          break;
      }
    }
    if (this._cs.lookAhead(2) === 39 /* SingleQuote */ || this._cs.lookAhead(2) === 34 /* DoubleQuote */) {
      const prefix = this._cs.getText().slice(this._cs.position, this._cs.position + 2).toLowerCase();
      switch (prefix) {
        case "rf":
        case "fr":
        case "rt":
        case "tr":
        case "br":
        case "rb":
          return 2;
        default:
          break;
      }
    }
    return -1;
  }
  _getQuoteTypeFlags(prefix) {
    let flags = 0 /* None */;
    prefix = prefix.toLowerCase();
    for (let i = 0; i < prefix.length; i++) {
      switch (prefix[i]) {
        case "u":
          flags |= 16 /* Unicode */;
          break;
        case "b":
          flags |= 32 /* Bytes */;
          break;
        case "r":
          flags |= 8 /* Raw */;
          break;
        case "f":
          flags |= 64 /* Format */;
          break;
        case "t":
          flags |= 128 /* Template */;
          break;
      }
    }
    if (this._cs.currentChar === 39 /* SingleQuote */) {
      flags |= 1 /* SingleQuote */;
      if (this._cs.nextChar === 39 /* SingleQuote */ && this._cs.lookAhead(2) === 39 /* SingleQuote */) {
        flags |= 4 /* Triplicate */;
      }
    } else if (this._cs.currentChar === 34 /* DoubleQuote */) {
      flags |= 2 /* DoubleQuote */;
      if (this._cs.nextChar === 34 /* DoubleQuote */ && this._cs.lookAhead(2) === 34 /* DoubleQuote */) {
        flags |= 4 /* Triplicate */;
      }
    }
    return flags;
  }
  _handleString(flags, stringPrefixLength) {
    const start = this._cs.position - stringPrefixLength;
    if (flags & (64 /* Format */ | 128 /* Template */)) {
      if (flags & 4 /* Triplicate */) {
        this._cs.advance(3);
      } else {
        this._cs.moveNext();
      }
      const end = this._cs.position;
      const fStringStartToken = FStringStartToken.create(
        start,
        end - start,
        flags,
        stringPrefixLength
      );
      const fStringContext = {
        startToken: fStringStartToken,
        replacementFieldStack: []
      };
      if (this._activeFString) {
        this._fStringStack.push(this._activeFString);
      }
      this._activeFString = fStringContext;
      this._tokens.push(fStringStartToken);
    } else {
      if (flags & 4 /* Triplicate */) {
        this._cs.advance(3);
      } else {
        this._cs.moveNext();
      }
      const stringLiteralInfo = this._skipToEndOfStringLiteral(flags);
      const end = this._cs.position;
      if ((stringLiteralInfo.flags & 65536 /* Unterminated */) !== 0 && this._activeFString?.activeReplacementField) {
        if ((flags & (32 /* Bytes */ | 16 /* Unicode */ | 8 /* Raw */ | 64 /* Format */ | 128 /* Template */)) === 0) {
          const quoteTypeMask = 4 /* Triplicate */ | 2 /* DoubleQuote */ | 1 /* SingleQuote */;
          if ((this._activeFString.startToken.flags & quoteTypeMask) === (flags & quoteTypeMask)) {
            this._cs.position = start;
            while (this._activeFString.replacementFieldStack.length > 0) {
              this._activeFString.activeReplacementField = this._activeFString.replacementFieldStack.pop();
            }
            this._parenDepth = this._activeFString.activeReplacementField.parenDepth - 1;
            this._activeFString.activeReplacementField = void 0;
            return;
          }
        }
      }
      this._tokens.push(
        StringToken.create(
          start,
          end - start,
          stringLiteralInfo.flags,
          stringLiteralInfo.escapedValue,
          stringPrefixLength
        )
      );
    }
  }
  // Scans for either the FString end token or a replacement field.
  _handleFStringMiddle() {
    const activeFString = this._activeFString;
    const inFormatSpecifier = !!this._activeFString.activeReplacementField?.inFormatSpecifier;
    const start = this._cs.position;
    const flags = activeFString.startToken.flags;
    const stringLiteralInfo = this._skipToEndOfStringLiteral(flags, inFormatSpecifier);
    const end = this._cs.position;
    const isUnterminated = (stringLiteralInfo.flags & 65536 /* Unterminated */) !== 0;
    const sawReplacementFieldStart = (stringLiteralInfo.flags & 256 /* ReplacementFieldStart */) !== 0;
    const sawReplacementFieldEnd = (stringLiteralInfo.flags & 512 /* ReplacementFieldEnd */) !== 0;
    const sawEndQuote = !isUnterminated && !sawReplacementFieldStart && !sawReplacementFieldEnd;
    let middleTokenLength = end - start;
    if (sawEndQuote) {
      middleTokenLength -= activeFString.startToken.quoteMarkLength;
    }
    if (middleTokenLength > 0 || isUnterminated) {
      this._tokens.push(
        FStringMiddleToken.create(
          start,
          middleTokenLength,
          stringLiteralInfo.flags,
          stringLiteralInfo.escapedValue
        )
      );
    }
    if (sawEndQuote) {
      this._tokens.push(
        FStringEndToken.create(
          start + middleTokenLength,
          activeFString.startToken.quoteMarkLength,
          stringLiteralInfo.flags
        )
      );
      this._activeFString = this._fStringStack.pop();
    } else if (isUnterminated) {
      this._activeFString = this._fStringStack.pop();
    }
  }
  _skipToEndOfStringLiteral(flags, inFormatSpecifier = false) {
    const quoteChar = flags & 1 /* SingleQuote */ ? 39 /* SingleQuote */ : 34 /* DoubleQuote */;
    const isTriplicate = (flags & 4 /* Triplicate */) !== 0;
    const isFString = (flags & (64 /* Format */ | 128 /* Template */)) !== 0;
    let isInNamedUnicodeEscape = false;
    const start = this._cs.position;
    let escapedValueLength = 0;
    const getEscapedValue = () => cloneStr(this._cs.getText().slice(start, start + escapedValueLength));
    while (true) {
      if (this._cs.isEndOfStream()) {
        flags |= 65536 /* Unterminated */;
        return {
          escapedValue: getEscapedValue(),
          flags
        };
      }
      if (this._cs.currentChar === 92 /* Backslash */) {
        escapedValueLength++;
        this._cs.moveNext();
        if (!isInNamedUnicodeEscape && this._cs.getCurrentChar() === 78 /* N */ && this._cs.nextChar === 123 /* OpenBrace */) {
          flags |= 1024 /* NamedUnicodeEscape */;
          isInNamedUnicodeEscape = true;
        } else {
          const isEscapedQuote = this._cs.getCurrentChar() === 39 /* SingleQuote */ || this._cs.getCurrentChar() === 34 /* DoubleQuote */;
          const isEscapedNewLine = this._cs.getCurrentChar() === 13 /* CarriageReturn */ || this._cs.getCurrentChar() === 10 /* LineFeed */;
          const isEscapedBackslash = this._cs.getCurrentChar() === 92 /* Backslash */;
          if (!isFString || isEscapedBackslash || isEscapedQuote || isEscapedNewLine) {
            if (isEscapedNewLine) {
              if (this._cs.getCurrentChar() === 13 /* CarriageReturn */ && this._cs.nextChar === 10 /* LineFeed */) {
                escapedValueLength++;
                this._cs.moveNext();
              }
              escapedValueLength++;
              this._cs.moveNext();
              this._addLineRange();
            } else {
              escapedValueLength++;
              this._cs.moveNext();
            }
          }
        }
      } else if (this._cs.currentChar === 10 /* LineFeed */ || this._cs.currentChar === 13 /* CarriageReturn */) {
        if (!isTriplicate) {
          if (!isFString || !this._activeFString?.activeReplacementField) {
            flags |= 65536 /* Unterminated */;
            return {
              escapedValue: getEscapedValue(),
              flags
            };
          }
        }
        if (this._cs.currentChar === 13 /* CarriageReturn */ && this._cs.nextChar === 10 /* LineFeed */) {
          escapedValueLength++;
          this._cs.moveNext();
        }
        escapedValueLength++;
        this._cs.moveNext();
        this._addLineRange();
      } else if (!isTriplicate && this._cs.currentChar === quoteChar) {
        this._cs.moveNext();
        break;
      } else if (isTriplicate && this._cs.currentChar === quoteChar && this._cs.nextChar === quoteChar && this._cs.lookAhead(2) === quoteChar) {
        this._cs.advance(3);
        break;
      } else if (!isInNamedUnicodeEscape && isFString && this._cs.currentChar === 123 /* OpenBrace */) {
        if (inFormatSpecifier || this._cs.nextChar !== 123 /* OpenBrace */) {
          flags |= 256 /* ReplacementFieldStart */;
          break;
        } else {
          escapedValueLength++;
          this._cs.moveNext();
          escapedValueLength++;
          this._cs.moveNext();
        }
      } else if (isInNamedUnicodeEscape && this._cs.currentChar === 125 /* CloseBrace */) {
        isInNamedUnicodeEscape = false;
        escapedValueLength++;
        this._cs.moveNext();
      } else if (isFString && this._cs.currentChar === 125 /* CloseBrace */) {
        if (inFormatSpecifier || this._cs.nextChar !== 125 /* CloseBrace */) {
          flags |= 512 /* ReplacementFieldEnd */;
          break;
        } else {
          escapedValueLength++;
          this._cs.moveNext();
          escapedValueLength++;
          this._cs.moveNext();
        }
      } else {
        escapedValueLength++;
        this._cs.moveNext();
      }
    }
    return {
      escapedValue: getEscapedValue(),
      flags
    };
  }
  _skipFloatingPointCandidate() {
    const start = this._cs.position;
    this._skipFractionalNumber();
    if (this._cs.position > start) {
      if (this._cs.currentChar === 101 /* e */ || this._cs.currentChar === 69 /* E */) {
        this._cs.moveNext();
        this._skipDecimalNumber(
          /* allowSign */
          true
        );
      }
    }
    return this._cs.position > start;
  }
  _skipFractionalNumber() {
    this._skipDecimalNumber(false);
    if (this._cs.currentChar === 46 /* Period */) {
      this._cs.moveNext();
    }
    this._skipDecimalNumber(false);
  }
  _skipDecimalNumber(allowSign) {
    if (allowSign && (this._cs.currentChar === 45 /* Hyphen */ || this._cs.currentChar === 43 /* Plus */)) {
      this._cs.moveNext();
    }
    while (isDecimal(this._cs.currentChar)) {
      this._cs.moveNext();
    }
  }
};

// extract/py/upstream/parser/parser.ts
var commentRegEx = /^(\s*#\s*type:\s*)([^\r\n]*)/;
var ignoreCommentRegEx = /^ignore(\s|\[|$)/;
var ParseOptions = class {
  pythonVersion = latestStablePythonVersion;
};
var maxChildNodeDepth = 4096;
var Parser = class _Parser {
  _fileContents;
  _tokenizerOutput;
  _tokens;
  _tokenCount = 0;
  _tokenIndex = 0;
  _areErrorsSuppressed = false;
  _parseOptions = new ParseOptions();
  _diagSink = new DiagnosticSink();
  _isInLoop = false;
  _isInFunction = false;
  _isInExceptionGroup = false;
  _isParsingTypeAnnotation = false;
  _isParsingIndexTrailer = false;
  _isParsingQuotedText = false;
  _isInFinallyBlock = false;
  _isInFinallyLoop = false;
  _assignmentExpressionsAllowed = true;
  _typingImportAliases = [];
  _typingSymbolAliases = /* @__PURE__ */ new Map();
  _maxChildDepthMap = /* @__PURE__ */ new Map();
  parseSourceFile(fileContents, parseOptions, diagSink) {
    this._startNewParse(fileContents, 0, fileContents.length, parseOptions, diagSink);
    const moduleNode = ModuleNode.create({ start: 0, length: fileContents.length });
    while (!this._atEof()) {
      if (!this._consumeTokenIfType(2 /* NewLine */)) {
        const nextToken = this._peekToken();
        if (nextToken.type === 3 /* Indent */) {
          this._getNextToken();
          const indentToken = nextToken;
          if (indentToken.isIndentAmbiguous) {
            this._addSyntaxError(LocMessage.inconsistentTabs(), indentToken);
          } else {
            this._addSyntaxError(LocMessage.unexpectedIndent(), nextToken);
          }
        }
        const statement = this._parseStatement();
        if (!statement) {
          this._consumeTokensUntilType([2 /* NewLine */]);
        } else {
          statement.parent = moduleNode;
          moduleNode.d.statements.push(statement);
        }
      }
    }
    assert(this._tokenizerOutput !== void 0);
    return { parseTree: moduleNode, tokenizerOutput: this._tokenizerOutput };
  }
  _parseTypeComment(token, parse) {
    const parser = new _Parser();
    parser._typingSymbolAliases = new Map(this._typingSymbolAliases);
    parser._isParsingQuotedText = true;
    const diagSink = new DiagnosticSink();
    parser._startNewParse(this._fileContents, token.start, token.length, this._parseOptions, diagSink);
    const parseTree = parse(parser);
    parser._consumeTokenIfType(2 /* NewLine */);
    if (!parser._atEof()) {
      parser._addSyntaxError(LocMessage.unexpectedExprToken(), parser._peekToken());
    }
    return { parseTree, diagnostics: diagSink.fetchAndClear() };
  }
  _startNewParse(fileContents, textOffset, textLength, parseOptions, diagSink) {
    this._fileContents = fileContents;
    this._parseOptions = parseOptions;
    this._diagSink = diagSink;
    const tokenizer = new Tokenizer();
    this._tokenizerOutput = tokenizer.tokenize(fileContents, textOffset, textLength);
    this._tokens = this._tokenizerOutput.tokens;
    this._tokenCount = this._tokens.count;
    this._tokenIndex = 0;
  }
  // stmt: simple_stmt | compound_stmt
  // compound_stmt: if_stmt | while_stmt | for_stmt | try_stmt | with_stmt
  //   | funcdef | classdef | decorated | async_stmt
  _parseStatement() {
    if (this._consumeTokenIfType(4 /* Dedent */)) {
      this._addSyntaxError(LocMessage.unexpectedUnindent(), this._peekToken());
    }
    switch (this._peekKeywordType()) {
      case 20 /* If */:
        return this._parseIfStatement();
      case 37 /* While */:
        return this._parseWhileStatement();
      case 17 /* For */:
        return this._parseForStatement();
      case 35 /* Try */:
        return this._parseTryStatement();
      case 38 /* With */:
        return this._parseWithStatement();
      case 10 /* Def */:
        return this._parseFunctionDef();
      case 7 /* Class */:
        return this._parseClassDef();
      case 3 /* Async */:
        return this._parseAsyncStatement();
      case 26 /* Match */: {
        const peekToken = this._peekToken(1);
        let isInvalidMatchToken = false;
        if (peekToken.type === 10 /* Colon */ || peekToken.type === 11 /* Semicolon */ || peekToken.type === 12 /* Comma */ || peekToken.type === 20 /* Dot */ || peekToken.type === 2 /* NewLine */ || peekToken.type === 1 /* EndOfStream */) {
          isInvalidMatchToken = true;
        } else if (peekToken.type === 9 /* Operator */) {
          const operatorToken = peekToken;
          if (operatorToken.operatorType !== 26 /* Multiply */ && operatorToken.operatorType !== 0 /* Add */ && operatorToken.operatorType !== 5 /* BitwiseInvert */ && operatorToken.operatorType !== 33 /* Subtract */) {
            isInvalidMatchToken = true;
          }
        }
        if (!isInvalidMatchToken) {
          const matchStatement = this._parseMatchStatement();
          if (matchStatement) {
            return matchStatement;
          }
        }
        break;
      }
    }
    if (this._peekOperatorType() === 22 /* MatrixMultiply */) {
      return this._parseDecorated();
    }
    return this._parseSimpleStatement();
  }
  // async_stmt: 'async' (funcdef | with_stmt | for_stmt)
  _parseAsyncStatement() {
    const asyncToken = this._getKeywordToken(3 /* Async */);
    switch (this._peekKeywordType()) {
      case 10 /* Def */:
        return this._parseFunctionDef(asyncToken);
      case 38 /* With */:
        return this._parseWithStatement(asyncToken);
      case 17 /* For */:
        return this._parseForStatement(asyncToken);
    }
    this._addSyntaxError(LocMessage.unexpectedAsyncToken(), asyncToken);
    return void 0;
  }
  // lazy_import_stmt: "lazy" import_stmt | "lazy" from_import_stmt
  _parseLazyImportStatement() {
    const lazyToken = this._getKeywordToken(25 /* Lazy */);
    if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_15)) {
      this._addSyntaxError(LocMessage.lazyImportIllegal(), lazyToken);
    }
    const nextToken = this._peekToken();
    let node;
    if (nextToken.type === 8 /* Keyword */ && nextToken.keywordType === 18 /* From */) {
      node = this._parseFromStatement();
    } else {
      node = this._parseImportStatement();
    }
    extendRange(node, lazyToken);
    if (node.nodeType === 25 /* ImportFrom */ && node.d.isWildcardImport) {
      this._addSyntaxError(LocMessage.lazyImportWildcardIllegal(), node.d.wildcardToken ?? lazyToken);
    }
    return node;
  }
  // type_alias_stmt: "type" name [type_param_seq] = expr
  _parseTypeAliasStatement() {
    const typeToken = this._getKeywordToken(36 /* Type */);
    if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_12)) {
      this._addSyntaxError(LocMessage.typeAliasStatementIllegal(), typeToken);
    }
    const nameToken = this._getTokenIfIdentifier();
    assert(nameToken !== void 0);
    const name = NameNode.create(nameToken);
    let typeParameters2;
    if (this._peekToken().type === 15 /* OpenBracket */) {
      typeParameters2 = this._parseTypeParameterList();
    }
    const assignToken = this._peekToken();
    if (assignToken.type !== 9 /* Operator */ || assignToken.operatorType !== 2 /* Assign */) {
      this._addSyntaxError(LocMessage.expectedEquals(), assignToken);
    } else {
      this._getNextToken();
    }
    const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
    this._isParsingTypeAnnotation = true;
    const expression = this._parseTestExpression(
      /* allowAssignmentExpression */
      false
    );
    this._isParsingTypeAnnotation = wasParsingTypeAnnotation;
    return TypeAliasNode.create(typeToken, name, expression, typeParameters2);
  }
  // type_param_seq: '[' (type_param ',')+ ']'
  _parseTypeParameterList() {
    const typeVariableNodes = [];
    const openBracketToken = this._getNextToken();
    assert(openBracketToken.type === 15 /* OpenBracket */);
    while (true) {
      const firstToken = this._peekToken();
      if (firstToken.type === 16 /* CloseBracket */) {
        if (typeVariableNodes.length === 0) {
          this._addSyntaxError(LocMessage.typeParametersMissing(), this._peekToken());
        }
        break;
      }
      const typeVarNode = this._parseTypeParameter();
      if (!typeVarNode) {
        break;
      }
      typeVariableNodes.push(typeVarNode);
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        break;
      }
    }
    const closingToken = this._peekToken();
    if (closingToken.type !== 16 /* CloseBracket */) {
      this._addSyntaxError(LocMessage.expectedCloseBracket(), this._peekToken());
      this._consumeTokensUntilType([2 /* NewLine */, 16 /* CloseBracket */, 10 /* Colon */]);
    } else {
      this._getNextToken();
    }
    return TypeParameterListNode.create(openBracketToken, closingToken, typeVariableNodes);
  }
  // type_param: ['*' | '**'] NAME [':' bound_expr] ['=' default_expr]
  _parseTypeParameter() {
    let typeParamCategory = 0 /* TypeVar */;
    if (this._consumeTokenIfOperator(26 /* Multiply */)) {
      typeParamCategory = 1 /* TypeVarTuple */;
    } else if (this._consumeTokenIfOperator(29 /* Power */)) {
      typeParamCategory = 2 /* ParamSpec */;
    }
    const nameToken = this._getTokenIfIdentifier();
    if (!nameToken) {
      this._addSyntaxError(LocMessage.expectedTypeParameterName(), this._peekToken());
      return void 0;
    }
    const name = NameNode.create(nameToken);
    let boundExpression;
    if (this._consumeTokenIfType(10 /* Colon */)) {
      boundExpression = this._parseExpression(
        /* allowUnpack */
        false
      );
      if (typeParamCategory !== 0 /* TypeVar */) {
        this._addSyntaxError(LocMessage.typeParameterBoundNotAllowed(), boundExpression);
      }
    }
    let defaultExpression;
    if (this._consumeTokenIfOperator(2 /* Assign */)) {
      defaultExpression = this._parseExpression(
        /* allowUnpack */
        typeParamCategory === 1 /* TypeVarTuple */
      );
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_13)) {
        this._addSyntaxError(LocMessage.typeVarDefaultIllegal(), defaultExpression);
      }
    }
    return TypeParameterNode.create(
      name,
      typeParamCategory,
      boundExpression,
      defaultExpression
    );
  }
  // match_stmt: "match" subject_expr ':' NEWLINE INDENT case_block+ DEDENT
  // subject_expr:
  //     | star_named_expression ',' star_named_expressions?
  //     | named_expression
  _parseMatchStatement() {
    let smellsLikeMatchStatement = false;
    this._suppressErrors(() => {
      const curTokenIndex = this._tokenIndex;
      this._getKeywordToken(26 /* Match */);
      const expression = this._parseTestOrStarListAsExpression(
        /* allowAssignmentExpression */
        true,
        /* allowMultipleUnpack */
        true,
        12 /* MissingPatternSubject */,
        () => LocMessage.expectedReturnExpr()
      );
      smellsLikeMatchStatement = expression.nodeType !== 0 /* Error */ && this._peekToken().type === 10 /* Colon */;
      this._tokenIndex = curTokenIndex;
    });
    if (!smellsLikeMatchStatement) {
      return void 0;
    }
    const matchToken = this._getKeywordToken(26 /* Match */);
    const subjectExpression = this._parseTestOrStarListAsExpression(
      /* allowAssignmentExpression */
      true,
      /* allowMultipleUnpack */
      true,
      12 /* MissingPatternSubject */,
      () => LocMessage.expectedReturnExpr()
    );
    const matchNode = MatchNode.create(matchToken, subjectExpression);
    const nextToken = this._peekToken();
    if (!this._consumeTokenIfType(10 /* Colon */)) {
      this._addSyntaxError(LocMessage.expectedColon(), nextToken);
      if (this._consumeTokensUntilType([2 /* NewLine */, 10 /* Colon */])) {
        this._getNextToken();
      }
    } else {
      extendRange(matchNode, nextToken);
      if (!this._consumeTokenIfType(2 /* NewLine */)) {
        this._addSyntaxError(LocMessage.expectedNewline(), nextToken);
      } else {
        const possibleIndent = this._peekToken();
        if (!this._consumeTokenIfType(3 /* Indent */)) {
          this._addSyntaxError(LocMessage.expectedIndentedBlock(), this._peekToken());
        } else {
          const indentToken = possibleIndent;
          if (indentToken.isIndentAmbiguous) {
            this._addSyntaxError(LocMessage.inconsistentTabs(), indentToken);
          }
        }
        while (true) {
          const possibleUnexpectedIndent = this._peekToken();
          if (possibleUnexpectedIndent.type === 3 /* Indent */) {
            this._getNextToken();
            const indentToken = possibleUnexpectedIndent;
            if (indentToken.isIndentAmbiguous) {
              this._addSyntaxError(LocMessage.inconsistentTabs(), indentToken);
            } else {
              this._addSyntaxError(LocMessage.unexpectedIndent(), possibleUnexpectedIndent);
            }
          }
          const caseStatement = this._parseCaseStatement();
          if (!caseStatement) {
            if (this._consumeTokensUntilType([2 /* NewLine */, 10 /* Colon */])) {
              this._getNextToken();
            }
          } else {
            caseStatement.parent = matchNode;
            matchNode.d.cases.push(caseStatement);
          }
          const dedentToken = this._peekToken();
          if (this._consumeTokenIfType(4 /* Dedent */)) {
            if (!dedentToken.matchesIndent) {
              this._addSyntaxError(LocMessage.inconsistentIndent(), dedentToken);
            }
            if (dedentToken.isDedentAmbiguous) {
              this._addSyntaxError(LocMessage.inconsistentTabs(), dedentToken);
            }
            break;
          }
          if (this._peekTokenType() === 1 /* EndOfStream */) {
            break;
          }
        }
      }
      if (matchNode.d.cases.length > 0) {
        extendRange(matchNode, matchNode.d.cases[matchNode.d.cases.length - 1]);
      } else {
        this._addSyntaxError(LocMessage.zeroCaseStatementsFound(), matchToken);
      }
    }
    if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_10)) {
      this._addSyntaxError(LocMessage.matchIncompatible(), matchToken);
    }
    for (let i = 0; i < matchNode.d.cases.length - 1; i++) {
      const caseNode = matchNode.d.cases[i];
      if (!caseNode.d.guardExpr && caseNode.d.isIrrefutable) {
        this._addSyntaxError(LocMessage.casePatternIsIrrefutable(), caseNode.d.pattern);
      }
    }
    return matchNode;
  }
  // case_block: "case" patterns [guard] ':' block
  // patterns: sequence_pattern | as_pattern
  // guard: 'if' named_expression
  _parseCaseStatement() {
    const caseToken = this._peekToken();
    if (!this._consumeTokenIfKeyword(6 /* Case */)) {
      this._addSyntaxError(LocMessage.expectedCase(), caseToken);
      return void 0;
    }
    const patternList = this._parsePatternSequence();
    let casePattern;
    if (patternList.parseError) {
      casePattern = patternList.parseError;
    } else if (patternList.list.length === 0) {
      this._addSyntaxError(LocMessage.expectedPatternExpr(), this._peekToken());
      casePattern = ErrorNode.create(caseToken, 11 /* MissingPattern */);
    } else if (patternList.list.length === 1 && !patternList.trailingComma) {
      const pattern = patternList.list[0].d.orPatterns[0];
      if (pattern.nodeType === 69 /* PatternCapture */ && pattern.d.isStar) {
        casePattern = PatternSequenceNode.create(patternList.list[0], patternList.list);
      } else {
        casePattern = patternList.list[0];
      }
    } else {
      casePattern = PatternSequenceNode.create(patternList.list[0], patternList.list);
    }
    if (casePattern.nodeType !== 0 /* Error */) {
      const globalNameMap = /* @__PURE__ */ new Map();
      const localNameMap = /* @__PURE__ */ new Map();
      this._reportDuplicatePatternCaptureTargets(casePattern, globalNameMap, localNameMap);
    }
    let guardExpression;
    if (this._consumeTokenIfKeyword(20 /* If */)) {
      guardExpression = this._parseTestExpression(
        /* allowAssignmentExpression */
        true
      );
    }
    const suite = this._parseSuite(this._isInFunction);
    return CaseNode.create(
      caseToken,
      casePattern,
      this._isPatternIrrefutable(casePattern),
      guardExpression,
      suite
    );
  }
  // PEP 634 defines the concept of an "irrefutable" pattern - a pattern that
  // will always be matched.
  _isPatternIrrefutable(node) {
    if (node.nodeType === 69 /* PatternCapture */) {
      return true;
    }
    if (node.nodeType === 66 /* PatternAs */) {
      return node.d.orPatterns.some((pattern) => this._isPatternIrrefutable(pattern));
    }
    return false;
  }
  // Reports any situations where a capture target (a variable that receives part of a pattern)
  // appears twice within the same pattern. This is complicated by the fact that duplicate targets
  // are allowed in separate "or" clauses, so we need to track the targets we've seen globally
  // as well as the targets we've seen locally within the current "or" clause.
  _reportDuplicatePatternCaptureTargets(node, globalNameMap, localNameMap) {
    const reportTargetIfDuplicate = (nameNode) => {
      if (globalNameMap.has(nameNode.d.value) || localNameMap.has(nameNode.d.value)) {
        this._addSyntaxError(
          LocMessage.duplicateCapturePatternTarget().format({
            name: nameNode.d.value
          }),
          nameNode
        );
      } else {
        localNameMap.set(nameNode.d.value, nameNode);
      }
    };
    switch (node.nodeType) {
      case 65 /* PatternSequence */: {
        node.d.entries.forEach((subpattern) => {
          this._reportDuplicatePatternCaptureTargets(subpattern, globalNameMap, localNameMap);
        });
        break;
      }
      case 68 /* PatternClass */: {
        node.d.args.forEach((arg) => {
          this._reportDuplicatePatternCaptureTargets(arg.d.pattern, globalNameMap, localNameMap);
        });
        break;
      }
      case 66 /* PatternAs */: {
        if (node.d.target) {
          reportTargetIfDuplicate(node.d.target);
        }
        const orLocalNameMaps = node.d.orPatterns.map((subpattern) => {
          const orLocalNameMap = /* @__PURE__ */ new Map();
          this._reportDuplicatePatternCaptureTargets(subpattern, localNameMap, orLocalNameMap);
          return orLocalNameMap;
        });
        const combinedLocalOrNameMap = /* @__PURE__ */ new Map();
        orLocalNameMaps.forEach((orLocalNameMap) => {
          orLocalNameMap.forEach((node2) => {
            if (!combinedLocalOrNameMap.has(node2.d.value)) {
              combinedLocalOrNameMap.set(node2.d.value, node2);
              reportTargetIfDuplicate(node2);
            }
          });
        });
        break;
      }
      case 69 /* PatternCapture */: {
        if (!node.d.isWildcard) {
          reportTargetIfDuplicate(node.d.target);
        }
        break;
      }
      case 70 /* PatternMapping */: {
        node.d.entries.forEach((mapEntry) => {
          if (mapEntry.nodeType === 72 /* PatternMappingExpandEntry */) {
            reportTargetIfDuplicate(mapEntry.d.target);
          } else {
            this._reportDuplicatePatternCaptureTargets(mapEntry.d.keyPattern, globalNameMap, localNameMap);
            this._reportDuplicatePatternCaptureTargets(
              mapEntry.d.valuePattern,
              globalNameMap,
              localNameMap
            );
          }
        });
        break;
      }
      case 67 /* PatternLiteral */:
      case 73 /* PatternValue */:
      case 0 /* Error */: {
        break;
      }
    }
  }
  _getPatternTargetNames(node, nameSet) {
    switch (node.nodeType) {
      case 65 /* PatternSequence */: {
        node.d.entries.forEach((subpattern) => {
          this._getPatternTargetNames(subpattern, nameSet);
        });
        break;
      }
      case 68 /* PatternClass */: {
        node.d.args.forEach((arg) => {
          this._getPatternTargetNames(arg.d.pattern, nameSet);
        });
        break;
      }
      case 66 /* PatternAs */: {
        if (node.d.target) {
          nameSet.add(node.d.target.d.value);
        }
        node.d.orPatterns.forEach((subpattern) => {
          this._getPatternTargetNames(subpattern, nameSet);
        });
        break;
      }
      case 69 /* PatternCapture */: {
        if (!node.d.isWildcard) {
          nameSet.add(node.d.target.d.value);
        }
        break;
      }
      case 70 /* PatternMapping */: {
        node.d.entries.forEach((mapEntry) => {
          if (mapEntry.nodeType === 72 /* PatternMappingExpandEntry */) {
            nameSet.add(mapEntry.d.target.d.value);
          } else {
            this._getPatternTargetNames(mapEntry.d.keyPattern, nameSet);
            this._getPatternTargetNames(mapEntry.d.valuePattern, nameSet);
          }
        });
        break;
      }
      case 67 /* PatternLiteral */:
      case 73 /* PatternValue */:
      case 0 /* Error */: {
        break;
      }
    }
  }
  _parsePatternSequence() {
    const patternList = this._parseExpressionListGeneric(() => this._parsePatternAs());
    const starEntries = patternList.list.filter(
      (entry) => entry.d.orPatterns.length === 1 && entry.d.orPatterns[0].nodeType === 69 /* PatternCapture */ && entry.d.orPatterns[0].d.isStar
    );
    if (starEntries.length > 1) {
      this._addSyntaxError(LocMessage.duplicateStarPattern(), starEntries[1].d.orPatterns[0]);
    }
    return patternList;
  }
  // as_pattern: or_pattern ['as' NAME]
  // or_pattern: '|'.pattern_atom+
  _parsePatternAs() {
    const orPatterns = [];
    while (true) {
      const patternAtom = this._parsePatternAtom();
      orPatterns.push(patternAtom);
      if (!this._consumeTokenIfOperator(6 /* BitwiseOr */)) {
        break;
      }
    }
    if (orPatterns.length > 1) {
      orPatterns.forEach((patternAtom) => {
        if (patternAtom.nodeType === 69 /* PatternCapture */ && patternAtom.d.isStar) {
          this._addSyntaxError(LocMessage.starPatternInOrPattern(), patternAtom);
        }
      });
    }
    let target;
    if (this._consumeTokenIfKeyword(1 /* As */)) {
      const nameToken = this._getTokenIfIdentifier();
      if (nameToken) {
        target = NameNode.create(nameToken);
      } else {
        this._addSyntaxError(LocMessage.expectedNameAfterAs(), this._peekToken());
      }
    }
    if (target && orPatterns.length === 1 && orPatterns[0].nodeType === 69 /* PatternCapture */ && orPatterns[0].d.isStar) {
      this._addSyntaxError(LocMessage.starPatternInAsPattern(), orPatterns[0]);
    }
    orPatterns.forEach((orPattern, index) => {
      if (index < orPatterns.length - 1 && this._isPatternIrrefutable(orPattern)) {
        this._addSyntaxError(LocMessage.orPatternIrrefutable(), orPattern);
      }
    });
    const fullNameSet = /* @__PURE__ */ new Set();
    orPatterns.forEach((orPattern) => {
      this._getPatternTargetNames(orPattern, fullNameSet);
    });
    orPatterns.forEach((orPattern) => {
      const localNameSet = /* @__PURE__ */ new Set();
      this._getPatternTargetNames(orPattern, localNameSet);
      if (localNameSet.size < fullNameSet.size) {
        const missingNames = Array.from(fullNameSet.keys()).filter((name) => !localNameSet.has(name));
        const detail = LocAddendum.orPatternMissingName().format({
          name: missingNames.map((name) => `"${name}"`).join(", ")
        });
        this._addSyntaxError(LocMessage.orPatternMissingName() + "\n  " + detail, orPattern);
      }
    });
    return PatternAsNode.create(orPatterns, target);
  }
  // pattern_atom:
  //     | literal_pattern
  //     | name_or_attr
  //     | '(' as_pattern ')'
  //     | '[' [sequence_pattern] ']'
  //     | '(' [sequence_pattern] ')'
  //     | '{' [items_pattern] '}'
  //     | name_or_attr '(' [pattern_arguments ','?] ')'
  // name_or_attr: attr | NAME
  // attr: name_or_attr '.' NAME
  // sequence_pattern: ','.maybe_star_pattern+ ','?
  // maybe_star_pattern: '*' NAME | pattern
  // items_pattern: ','.key_value_pattern+ ','?
  _parsePatternAtom() {
    const patternLiteral = this._parsePatternLiteral();
    if (patternLiteral) {
      return patternLiteral;
    }
    const patternCaptureOrValue = this._parsePatternCaptureOrValue();
    if (patternCaptureOrValue) {
      const openParenToken = this._peekToken();
      if (patternCaptureOrValue.nodeType === 0 /* Error */ || !this._consumeTokenIfType(13 /* OpenParenthesis */)) {
        return patternCaptureOrValue;
      }
      const args = this._parseClassPatternArgList();
      const classNameExpr = patternCaptureOrValue.nodeType === 69 /* PatternCapture */ ? patternCaptureOrValue.d.target : patternCaptureOrValue.d.expr;
      const classPattern = PatternClassNode.create(classNameExpr, args);
      if (!this._consumeTokenIfType(14 /* CloseParenthesis */)) {
        this._addSyntaxError(LocMessage.expectedCloseParen(), openParenToken);
        this._consumeTokensUntilType([2 /* NewLine */]);
        extendRange(classPattern, this._peekToken());
      }
      return classPattern;
    }
    const nextToken = this._peekToken();
    const nextOperator = this._peekOperatorType();
    if (nextOperator === 26 /* Multiply */) {
      const starToken = this._getNextToken();
      const identifierToken = this._getTokenIfIdentifier();
      if (!identifierToken) {
        this._addSyntaxError(LocMessage.expectedIdentifier(), this._peekToken());
        return ErrorNode.create(starToken, 2 /* MissingExpression */);
      } else {
        return PatternCaptureNode.create(
          NameNode.create(identifierToken),
          starToken
        );
      }
    }
    if (nextToken.type === 13 /* OpenParenthesis */ || nextToken.type === 15 /* OpenBracket */) {
      const startToken = this._getNextToken();
      const patternList = this._parsePatternSequence();
      let casePattern;
      if (patternList.parseError) {
        casePattern = patternList.parseError;
      } else if (patternList.list.length === 1 && !patternList.trailingComma && startToken.type === 13 /* OpenParenthesis */) {
        const pattern = patternList.list[0].d.orPatterns[0];
        if (pattern.nodeType === 69 /* PatternCapture */ && pattern.d.isStar) {
          casePattern = PatternSequenceNode.create(startToken, patternList.list);
        } else {
          casePattern = patternList.list[0];
        }
        extendRange(casePattern, nextToken);
      } else {
        casePattern = PatternSequenceNode.create(startToken, patternList.list);
      }
      const endToken = this._peekToken();
      if (this._consumeTokenIfType(
        nextToken.type === 13 /* OpenParenthesis */ ? 14 /* CloseParenthesis */ : 16 /* CloseBracket */
      )) {
        extendRange(casePattern, endToken);
      } else {
        this._addSyntaxError(
          nextToken.type === 13 /* OpenParenthesis */ ? LocMessage.expectedCloseParen() : LocMessage.expectedCloseBracket(),
          nextToken
        );
        this._consumeTokensUntilType([
          10 /* Colon */,
          nextToken.type === 13 /* OpenParenthesis */ ? 14 /* CloseParenthesis */ : 16 /* CloseBracket */
        ]);
      }
      return casePattern;
    } else if (nextToken.type === 17 /* OpenCurlyBrace */) {
      const firstToken = this._getNextToken();
      const mappingPattern = this._parsePatternMapping(firstToken);
      const lastToken = this._peekToken();
      if (this._consumeTokenIfType(18 /* CloseCurlyBrace */)) {
        extendRange(mappingPattern, lastToken);
      } else {
        this._addSyntaxError(LocMessage.expectedCloseBrace(), nextToken);
        this._consumeTokensUntilType([10 /* Colon */, 18 /* CloseCurlyBrace */]);
      }
      return mappingPattern;
    }
    return this._handleExpressionParseError(
      11 /* MissingPattern */,
      LocMessage.expectedPatternExpr()
    );
  }
  // pattern_arguments:
  //     | positional_patterns [',' keyword_patterns]
  //     | keyword_patterns
  // positional_patterns: ','.as_pattern+
  // keyword_patterns: ','.keyword_pattern+
  _parseClassPatternArgList() {
    const argList = [];
    let sawKeywordArg = false;
    while (true) {
      const nextTokenType = this._peekTokenType();
      if (nextTokenType === 14 /* CloseParenthesis */ || nextTokenType === 2 /* NewLine */ || nextTokenType === 1 /* EndOfStream */) {
        break;
      }
      const arg = this._parseClassPatternArgument();
      if (arg.d.name) {
        sawKeywordArg = true;
      } else if (sawKeywordArg && !arg.d.name) {
        this._addSyntaxError(LocMessage.positionArgAfterNamedArg(), arg);
      }
      argList.push(arg);
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        break;
      }
    }
    return argList;
  }
  // keyword_pattern: NAME '=' as_pattern
  _parseClassPatternArgument() {
    const firstToken = this._peekToken();
    const secondToken = this._peekToken(1);
    let keywordName;
    if ((firstToken.type === 7 /* Identifier */ || firstToken.type === 8 /* Keyword */) && secondToken.type === 9 /* Operator */ && secondToken.operatorType === 2 /* Assign */) {
      const classNameToken = this._getTokenIfIdentifier();
      if (classNameToken !== void 0) {
        keywordName = NameNode.create(classNameToken);
        this._getNextToken();
      }
    }
    const pattern = this._parsePatternAs();
    return PatternClassArgumentNode.create(pattern, keywordName);
  }
  // literal_pattern:
  //     | signed_number
  //     | signed_number '+' NUMBER
  //     | signed_number '-' NUMBER
  //     | strings
  //     | 'None'
  //     | 'True'
  //     | 'False'
  _parsePatternLiteral() {
    const nextToken = this._peekToken();
    const nextOperator = this._peekOperatorType();
    if (nextToken.type === 6 /* Number */ || nextOperator === 33 /* Subtract */) {
      return this._parsePatternLiteralNumber();
    }
    if (nextToken.type === 5 /* String */) {
      const stringList = this._parseAtom();
      assert(stringList.nodeType === 48 /* StringList */);
      stringList.d.strings.forEach((stringAtom) => {
        if (stringAtom.nodeType === 30 /* FormatString */) {
          this._addSyntaxError(LocMessage.formatStringInPattern(), stringAtom);
        }
      });
      return PatternLiteralNode.create(stringList);
    }
    if (nextToken.type === 8 /* Keyword */) {
      const keywordToken = nextToken;
      if (keywordToken.keywordType === 15 /* False */ || keywordToken.keywordType === 34 /* True */ || keywordToken.keywordType === 27 /* None */) {
        return PatternLiteralNode.create(this._parseAtom());
      }
    }
    return void 0;
  }
  // signed_number: NUMBER | '-' NUMBER
  _parsePatternLiteralNumber() {
    const expression = this._parseArithmeticExpression();
    let realValue;
    let imagValue;
    if (expression.nodeType === 7 /* BinaryOperation */) {
      if (expression.d.operator === 33 /* Subtract */ || expression.d.operator === 0 /* Add */) {
        realValue = expression.d.leftExpr;
        imagValue = expression.d.rightExpr;
      }
    } else {
      realValue = expression;
    }
    if (realValue) {
      if (realValue.nodeType === 55 /* UnaryOperation */ && realValue.d.operator === 33 /* Subtract */) {
        realValue = realValue.d.expr;
      }
      if (realValue.nodeType !== 40 /* Number */ || imagValue !== void 0 && realValue.d.isImaginary) {
        this._addSyntaxError(LocMessage.expectedComplexNumberLiteral(), expression);
        imagValue = void 0;
      }
    }
    if (imagValue) {
      if (imagValue.nodeType === 55 /* UnaryOperation */ && imagValue.d.operator === 33 /* Subtract */) {
        imagValue = imagValue.d.expr;
      }
      if (imagValue.nodeType !== 40 /* Number */ || !imagValue.d.isImaginary) {
        this._addSyntaxError(LocMessage.expectedComplexNumberLiteral(), expression);
      }
    }
    return PatternLiteralNode.create(expression);
  }
  _parsePatternMapping(firstToken) {
    const itemList = this._parseExpressionListGeneric(() => this._parsePatternMappingItem());
    if (itemList.list.length > 0) {
      const starStarEntries = itemList.list.filter(
        (entry) => entry.nodeType === 72 /* PatternMappingExpandEntry */
      );
      if (starStarEntries.length > 1) {
        this._addSyntaxError(LocMessage.duplicateStarStarPattern(), starStarEntries[1]);
      }
      return PatternMappingNode.create(firstToken, itemList.list);
    }
    return itemList.parseError || ErrorNode.create(this._peekToken(), 11 /* MissingPattern */);
  }
  // key_value_pattern:
  //     | (literal_pattern | attr) ':' as_pattern
  //     | '**' NAME
  _parsePatternMappingItem() {
    let keyExpression;
    const doubleStar = this._peekToken();
    if (this._consumeTokenIfOperator(29 /* Power */)) {
      const identifierToken = this._getTokenIfIdentifier();
      if (!identifierToken) {
        this._addSyntaxError(LocMessage.expectedIdentifier(), this._peekToken());
        return ErrorNode.create(this._peekToken(), 11 /* MissingPattern */);
      }
      const nameNode = NameNode.create(identifierToken);
      if (identifierToken.value === "_") {
        this._addSyntaxError(LocMessage.starStarWildcardNotAllowed(), nameNode);
      }
      return PatternMappingExpandEntryNode.create(doubleStar, nameNode);
    }
    const patternLiteral = this._parsePatternLiteral();
    if (patternLiteral) {
      keyExpression = patternLiteral;
    } else {
      const patternCaptureOrValue = this._parsePatternCaptureOrValue();
      if (patternCaptureOrValue) {
        if (patternCaptureOrValue.nodeType === 73 /* PatternValue */) {
          keyExpression = patternCaptureOrValue;
        } else {
          this._addSyntaxError(LocMessage.expectedPatternValue(), patternCaptureOrValue);
          keyExpression = ErrorNode.create(
            this._peekToken(),
            11 /* MissingPattern */
          );
        }
      }
    }
    if (!keyExpression) {
      this._addSyntaxError(LocMessage.expectedPatternExpr(), this._peekToken());
      keyExpression = ErrorNode.create(
        this._peekToken(),
        11 /* MissingPattern */
      );
    }
    let valuePattern;
    if (!this._consumeTokenIfType(10 /* Colon */)) {
      this._addSyntaxError(LocMessage.expectedColon(), this._peekToken());
      valuePattern = ErrorNode.create(
        this._peekToken(),
        11 /* MissingPattern */
      );
    } else {
      valuePattern = this._parsePatternAs();
    }
    return PatternMappingKeyEntryNode.create(keyExpression, valuePattern);
  }
  _parsePatternCaptureOrValue() {
    const nextToken = this._peekToken();
    if (nextToken.type === 7 /* Identifier */ || nextToken.type === 8 /* Keyword */) {
      let nameOrMember;
      while (true) {
        const identifierToken = this._getTokenIfIdentifier();
        if (identifierToken) {
          const nameNode = NameNode.create(identifierToken);
          nameOrMember = nameOrMember ? MemberAccessNode.create(nameOrMember, nameNode) : nameNode;
        } else {
          this._addSyntaxError(LocMessage.expectedIdentifier(), this._peekToken());
          break;
        }
        if (!this._consumeTokenIfType(20 /* Dot */)) {
          break;
        }
      }
      if (!nameOrMember) {
        this._addSyntaxError(LocMessage.expectedIdentifier(), this._peekToken());
        return ErrorNode.create(this._peekToken(), 11 /* MissingPattern */);
      }
      if (nameOrMember.nodeType === 35 /* MemberAccess */) {
        return PatternValueNode.create(nameOrMember);
      }
      return PatternCaptureNode.create(nameOrMember);
    }
    return void 0;
  }
  // if_stmt: 'if' test_suite ('elif' test_suite)* ['else' suite]
  // test_suite: test suite
  // test: or_test ['if' or_test 'else' test] | lambdef
  _parseIfStatement(keywordType = 20 /* If */) {
    const ifOrElifToken = this._getKeywordToken(keywordType);
    const test = this._parseTestExpression(
      /* allowAssignmentExpression */
      true
    );
    const suite = this._parseSuite(this._isInFunction);
    const ifNode = IfNode.create(ifOrElifToken, test, suite);
    if (this._consumeTokenIfKeyword(13 /* Else */)) {
      ifNode.d.elseSuite = this._parseSuite(this._isInFunction);
      ifNode.d.elseSuite.parent = ifNode;
      extendRange(ifNode, ifNode.d.elseSuite);
    } else if (this._peekKeywordType() === 12 /* Elif */) {
      ifNode.d.elseSuite = this._parseIfStatement(12 /* Elif */);
      ifNode.d.elseSuite.parent = ifNode;
      extendRange(ifNode, ifNode.d.elseSuite);
    }
    return ifNode;
  }
  _parseExceptSuite(isExceptionGroup, callback) {
    const wasInExceptionGroup = this._isInExceptionGroup;
    if (isExceptionGroup) {
      this._isInExceptionGroup = true;
    }
    const result = callback();
    this._isInExceptionGroup = wasInExceptionGroup;
    return result;
  }
  _parseLoopSuite() {
    const wasInLoop = this._isInLoop;
    const wasInExceptionGroup = this._isInExceptionGroup;
    this._isInExceptionGroup = false;
    this._isInLoop = true;
    const wasInFinallyLoop = this._isInFinallyLoop;
    this._isInFinallyLoop = false;
    let typeComment;
    const suite = this._parseSuite(this._isInFunction, () => {
      const comment = this._getTypeAnnotationCommentText();
      if (comment) {
        typeComment = comment;
      }
    });
    this._isInLoop = wasInLoop;
    this._isInFinallyLoop = wasInFinallyLoop;
    this._isInExceptionGroup = wasInExceptionGroup;
    if (typeComment) {
      suite.d.typeComment = typeComment;
    }
    return suite;
  }
  // suite: ':' (simple_stmt | NEWLINE INDENT stmt+ DEDENT)
  _parseSuite(isFunction = false, postColonCallback) {
    const nextToken = this._peekToken();
    const suite = SuiteNode.create(nextToken);
    if (!this._consumeTokenIfType(10 /* Colon */)) {
      this._addSyntaxError(LocMessage.expectedColon(), nextToken);
      if (this._consumeTokensUntilType([2 /* NewLine */, 10 /* Colon */])) {
        if (this._peekTokenType() === 10 /* Colon */) {
          this._getNextToken();
        } else if (this._peekToken(1).type !== 3 /* Indent */) {
          this._getNextToken();
          return suite;
        }
      }
    }
    if (postColonCallback) {
      postColonCallback();
    }
    const wasFunction = this._isInFunction;
    this._isInFunction = isFunction;
    if (this._consumeTokenIfType(2 /* NewLine */)) {
      if (postColonCallback) {
        postColonCallback();
      }
      const possibleIndent = this._peekToken();
      if (!this._consumeTokenIfType(3 /* Indent */)) {
        this._addSyntaxError(LocMessage.expectedIndentedBlock(), this._peekToken());
        return suite;
      }
      const bodyIndentToken = possibleIndent;
      if (bodyIndentToken.isIndentAmbiguous) {
        this._addSyntaxError(LocMessage.inconsistentTabs(), bodyIndentToken);
      }
      while (true) {
        const nextToken2 = this._peekToken();
        if (nextToken2.type === 3 /* Indent */) {
          this._getNextToken();
          const indentToken = nextToken2;
          if (indentToken.isIndentAmbiguous) {
            this._addSyntaxError(LocMessage.inconsistentTabs(), indentToken);
          } else {
            this._addSyntaxError(LocMessage.unexpectedIndent(), nextToken2);
          }
        } else if (nextToken2.type === 4 /* Dedent */) {
          const dedentToken = nextToken2;
          this._reportDedentInconsistencies(dedentToken);
          if (suite.d.statements.length > 0) {
            this._consumeTokenIfType(4 /* Dedent */);
          } else {
            extendRange(suite, dedentToken);
          }
          if (!bodyIndentToken || dedentToken.indentAmount < bodyIndentToken.indentAmount) {
            break;
          } else if (dedentToken.indentAmount === bodyIndentToken.indentAmount) {
            const nextToken3 = this._peekToken();
            if (this._consumeTokenIfType(4 /* Dedent */)) {
              extendRange(suite, nextToken3);
              break;
            }
          }
        }
        const statement = this._parseStatement();
        if (!statement) {
          this._consumeTokensUntilType([2 /* NewLine */]);
        } else {
          statement.parent = suite;
          suite.d.statements.push(statement);
        }
        if (this._peekTokenType() === 1 /* EndOfStream */) {
          break;
        }
      }
    } else {
      const simpleStatement = this._parseSimpleStatement();
      suite.d.statements.push(simpleStatement);
      simpleStatement.parent = suite;
    }
    if (suite.d.statements.length > 0) {
      extendRange(suite, suite.d.statements[suite.d.statements.length - 1]);
    }
    this._isInFunction = wasFunction;
    return suite;
  }
  // Reports indentation inconsistencies (inconsistent indent / ambiguous tabs) for a terminating
  // dedent token. Shared by _parseSuite's notebook-mode empty-suite branch and its normal dedent
  // branch so the two sites can't drift apart.
  _reportDedentInconsistencies(dedentToken) {
    if (!dedentToken.matchesIndent) {
      this._addSyntaxError(LocMessage.inconsistentIndent(), dedentToken);
    }
    if (dedentToken.isDedentAmbiguous) {
      this._addSyntaxError(LocMessage.inconsistentTabs(), dedentToken);
    }
  }
  // for_stmt: [async] 'for' exprlist 'in' testlist suite ['else' suite]
  _parseForStatement(asyncToken) {
    const forToken = this._getKeywordToken(17 /* For */);
    const targetExpr = this._parseExpressionListAsPossibleTuple(
      2 /* MissingExpression */,
      () => LocMessage.expectedExpr(),
      forToken
    );
    let seqExpr;
    let forSuite;
    let elseSuite;
    if (!this._consumeTokenIfKeyword(22 /* In */)) {
      seqExpr = this._handleExpressionParseError(0 /* MissingIn */, LocMessage.expectedIn());
      forSuite = SuiteNode.create(TextRange.create(
        this._peekToken().start,
        /* length */
        0
      ));
    } else {
      seqExpr = this._parseTestOrStarListAsExpression(
        /* allowAssignmentExpression */
        false,
        /* allowMultipleUnpack */
        true,
        2 /* MissingExpression */,
        () => LocMessage.expectedInExpr()
      );
      forSuite = this._parseLoopSuite();
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_9)) {
        if (seqExpr.nodeType === 52 /* Tuple */ && !seqExpr.d.hasParens) {
          let sawStar = false;
          seqExpr.d.items.forEach((expr) => {
            if (expr.nodeType === 56 /* Unpack */ && !sawStar) {
              this._addSyntaxError(LocMessage.unpackOperatorNotAllowed(), expr);
              sawStar = true;
            }
          });
        }
      }
      if (this._consumeTokenIfKeyword(13 /* Else */)) {
        elseSuite = this._parseSuite(this._isInFunction);
      }
    }
    const forNode = ForNode.create(forToken, targetExpr, seqExpr, forSuite);
    forNode.d.elseSuite = elseSuite;
    if (elseSuite) {
      extendRange(forNode, elseSuite);
      elseSuite.parent = forNode;
    }
    if (asyncToken) {
      forNode.d.isAsync = true;
      forNode.d.asyncToken = asyncToken;
      extendRange(forNode, asyncToken);
    }
    if (forSuite.d.typeComment) {
      forNode.d.typeComment = forSuite.d.typeComment;
    }
    return forNode;
  }
  // comp_iter: comp_for | comp_if
  _tryParseComprehension(target, isGenerator) {
    const compFor = this._tryParseCompForStatement();
    if (!compFor) {
      return void 0;
    }
    if (target.nodeType === 56 /* Unpack */) {
      this._addSyntaxError(LocMessage.unpackIllegalInComprehension(), target);
    } else if (target.nodeType === 19 /* DictionaryExpandEntry */) {
      this._addSyntaxError(LocMessage.dictExpandIllegalInComprehension(), target);
    }
    const compNode = ComprehensionNode.create(target, isGenerator);
    const forIfList = [compFor];
    while (true) {
      const compIter = this._tryParseCompForStatement() || this._tryParseCompIfStatement();
      if (!compIter) {
        break;
      }
      compIter.parent = compNode;
      forIfList.push(compIter);
    }
    compNode.d.forIfNodes = forIfList;
    if (forIfList.length > 0) {
      forIfList.forEach((comp) => {
        comp.parent = compNode;
      });
      extendRange(compNode, forIfList[forIfList.length - 1]);
    }
    return compNode;
  }
  // comp_for: ['async'] 'for' exprlist 'in' or_test [comp_iter]
  _tryParseCompForStatement() {
    const startTokenKeywordType = this._peekKeywordType();
    if (startTokenKeywordType === 3 /* Async */) {
      const nextToken = this._peekToken(1);
      if (nextToken.type !== 8 /* Keyword */ || nextToken.keywordType !== 17 /* For */) {
        return void 0;
      }
    } else if (startTokenKeywordType !== 17 /* For */) {
      return void 0;
    }
    let asyncToken;
    if (this._peekKeywordType() === 3 /* Async */) {
      asyncToken = this._getKeywordToken(3 /* Async */);
    }
    const forToken = this._getKeywordToken(17 /* For */);
    const targetExpr = this._parseExpressionListAsPossibleTuple(
      2 /* MissingExpression */,
      () => LocMessage.expectedExpr(),
      forToken
    );
    let seqExpr;
    if (!this._consumeTokenIfKeyword(22 /* In */)) {
      seqExpr = this._handleExpressionParseError(0 /* MissingIn */, LocMessage.expectedIn());
    } else {
      this._disallowAssignmentExpression(() => {
        seqExpr = this._parseOrTest();
      });
    }
    const compForNode = ComprehensionForNode.create(
      asyncToken || forToken,
      targetExpr,
      seqExpr
    );
    if (asyncToken) {
      compForNode.d.isAsync = true;
      compForNode.d.asyncToken = asyncToken;
    }
    return compForNode;
  }
  // comp_if: 'if' test_nocond [comp_iter]
  // comp_iter: comp_for | comp_if
  _tryParseCompIfStatement() {
    if (this._peekKeywordType() !== 20 /* If */) {
      return void 0;
    }
    const ifToken = this._getKeywordToken(20 /* If */);
    const ifExpr = this._tryParseLambdaExpression() || this._parseAssignmentExpression(
      /* disallowAssignmentExpression */
      true
    );
    const compIfNode = ComprehensionIfNode.create(ifToken, ifExpr);
    return compIfNode;
  }
  // while_stmt: 'while' test suite ['else' suite]
  _parseWhileStatement() {
    const whileToken = this._getKeywordToken(37 /* While */);
    const whileNode = WhileNode.create(
      whileToken,
      this._parseTestExpression(
        /* allowAssignmentExpression */
        true
      ),
      this._parseLoopSuite()
    );
    if (this._consumeTokenIfKeyword(13 /* Else */)) {
      whileNode.d.elseSuite = this._parseSuite(this._isInFunction);
      whileNode.d.elseSuite.parent = whileNode;
      extendRange(whileNode, whileNode.d.elseSuite);
    }
    return whileNode;
  }
  // try_stmt: ('try' suite
  //         ((except_clause suite)+
  //             ['else' suite]
  //             ['finally' suite] |
  //         'finally' suite))
  // except_clause: 'except' [test ['as' NAME]]
  _parseTryStatement() {
    const tryToken = this._getKeywordToken(35 /* Try */);
    const trySuite = this._parseSuite(this._isInFunction);
    const tryNode = TryNode.create(tryToken, trySuite);
    let sawCatchAllExcept = false;
    let reportedExceptGroupMismatch = false;
    while (true) {
      const exceptToken = this._peekToken();
      if (!this._consumeTokenIfKeyword(14 /* Except */)) {
        break;
      }
      const possibleStarToken = this._peekToken();
      let isExceptGroup = false;
      if (this._consumeTokenIfOperator(26 /* Multiply */)) {
        if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_11)) {
          this._addSyntaxError(LocMessage.exceptionGroupIncompatible(), possibleStarToken);
        }
        isExceptGroup = true;
        if (!reportedExceptGroupMismatch && tryNode.d.exceptClauses.some((clause) => !clause.d.isExceptGroup)) {
          this._addSyntaxError(LocMessage.exceptGroupMismatch(), possibleStarToken);
          reportedExceptGroupMismatch = true;
        }
      } else {
        if (!reportedExceptGroupMismatch && tryNode.d.exceptClauses.some((clause) => clause.d.isExceptGroup)) {
          this._addSyntaxError(LocMessage.exceptGroupMismatch(), possibleStarToken);
          reportedExceptGroupMismatch = true;
        }
      }
      let typeExpr;
      let symbolName;
      let isAsKeywordAllowed = true;
      if (this._peekTokenType() !== 10 /* Colon */) {
        const listResult = this._parseExpressionListGeneric(
          () => this._parseTestExpression(
            /* allowAssignmentExpression */
            true
          )
        );
        if (listResult.parseError) {
          typeExpr = listResult.parseError;
        } else {
          typeExpr = this._makeExpressionOrTuple(
            listResult,
            /* enclosedInParens */
            false
          );
          if (listResult.list.length > 1) {
            if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_14)) {
              this._addSyntaxError(LocMessage.exceptRequiresParens(), typeExpr);
            }
            isAsKeywordAllowed = false;
          }
        }
        if (this._consumeTokenIfKeyword(1 /* As */)) {
          if (!isAsKeywordAllowed) {
            this._addSyntaxError(LocMessage.exceptWithAsRequiresParens(), typeExpr);
          }
          symbolName = this._getTokenIfIdentifier();
          if (!symbolName) {
            this._addSyntaxError(LocMessage.expectedNameAfterAs(), this._peekToken());
          }
        }
      } else if (isExceptGroup) {
        this._addSyntaxError(LocMessage.exceptGroupRequiresType(), this._peekToken());
      }
      if (!typeExpr) {
        if (sawCatchAllExcept) {
          this._addSyntaxError(LocMessage.duplicateCatchAll(), exceptToken);
        }
        sawCatchAllExcept = true;
      } else {
        if (sawCatchAllExcept) {
          this._addSyntaxError(LocMessage.namedExceptAfterCatchAll(), typeExpr);
        }
      }
      const exceptSuite = this._parseExceptSuite(isExceptGroup, () => this._parseSuite(this._isInFunction));
      const exceptNode = ExceptNode.create(exceptToken, exceptSuite, isExceptGroup);
      if (typeExpr) {
        exceptNode.d.typeExpr = typeExpr;
        exceptNode.d.typeExpr.parent = exceptNode;
      }
      if (symbolName) {
        exceptNode.d.name = NameNode.create(symbolName);
        exceptNode.d.name.parent = exceptNode;
      }
      tryNode.d.exceptClauses.push(exceptNode);
      exceptNode.parent = tryNode;
    }
    if (tryNode.d.exceptClauses.length > 0) {
      extendRange(tryNode, tryNode.d.exceptClauses[tryNode.d.exceptClauses.length - 1]);
      if (this._consumeTokenIfKeyword(13 /* Else */)) {
        tryNode.d.elseSuite = this._parseSuite(this._isInFunction);
        tryNode.d.elseSuite.parent = tryNode;
        extendRange(tryNode, tryNode.d.elseSuite);
      }
    }
    if (this._consumeTokenIfKeyword(16 /* Finally */)) {
      const wasInFinallyBlock = this._isInFinallyBlock;
      const wasInFinallyLoop = this._isInFinallyLoop;
      this._isInFinallyBlock = true;
      this._isInFinallyLoop = this._isInLoop;
      tryNode.d.finallySuite = this._parseSuite(this._isInFunction);
      this._isInFinallyBlock = wasInFinallyBlock;
      this._isInFinallyLoop = wasInFinallyLoop;
      tryNode.d.finallySuite.parent = tryNode;
      extendRange(tryNode, tryNode.d.finallySuite);
    }
    if (!tryNode.d.finallySuite && tryNode.d.exceptClauses.length === 0) {
      this._addSyntaxError(LocMessage.tryWithoutExcept(), tryToken);
    }
    return tryNode;
  }
  // funcdef: 'def' NAME parameters ['->' test] ':' suite
  // parameters: '(' [typedargslist] ')'
  _parseFunctionDef(asyncToken, decorators2) {
    const defToken = this._getKeywordToken(10 /* Def */);
    const nameToken = this._getTokenIfIdentifier();
    if (!nameToken) {
      this._addSyntaxError(LocMessage.expectedFunctionName(), defToken);
      return ErrorNode.create(
        defToken,
        10 /* MissingFunctionParameterList */,
        void 0,
        decorators2
      );
    }
    let typeParameters2;
    const possibleOpenBracket = this._peekToken();
    if (possibleOpenBracket.type === 15 /* OpenBracket */) {
      typeParameters2 = this._parseTypeParameterList();
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_12)) {
        this._addSyntaxError(LocMessage.functionTypeParametersIllegal(), typeParameters2);
      }
    }
    const openParenToken = this._peekToken();
    if (!this._consumeTokenIfType(13 /* OpenParenthesis */)) {
      this._addSyntaxError(LocMessage.expectedOpenParen(), this._peekToken());
      return ErrorNode.create(
        nameToken,
        10 /* MissingFunctionParameterList */,
        NameNode.create(nameToken),
        decorators2
      );
    }
    const paramList = this._parseVarArgsList(
      14 /* CloseParenthesis */,
      /* allowAnnotations */
      true
    );
    if (!this._consumeTokenIfType(14 /* CloseParenthesis */)) {
      this._addSyntaxError(LocMessage.expectedCloseParen(), openParenToken);
      this._consumeTokensUntilType([10 /* Colon */]);
    }
    let returnType;
    if (this._consumeTokenIfType(21 /* Arrow */)) {
      returnType = this._parseTypeAnnotation();
    }
    let functionTypeAnnotationToken;
    const wasInExceptionGroup = this._isInExceptionGroup;
    this._isInExceptionGroup = false;
    const wasInFinallyBlock = this._isInFinallyBlock;
    const wasInFinallyLoop = this._isInFinallyLoop;
    this._isInFinallyBlock = false;
    this._isInFinallyLoop = false;
    const suite = this._parseSuite(
      /* isFunction */
      true,
      () => {
        if (!functionTypeAnnotationToken) {
          functionTypeAnnotationToken = this._getTypeAnnotationCommentText();
        }
      }
    );
    this._isInExceptionGroup = wasInExceptionGroup;
    this._isInFinallyBlock = wasInFinallyBlock;
    this._isInFinallyLoop = wasInFinallyLoop;
    const functionNode = FunctionNode.create(
      defToken,
      NameNode.create(nameToken),
      suite,
      typeParameters2
    );
    if (asyncToken) {
      functionNode.d.isAsync = true;
      extendRange(functionNode, asyncToken);
    }
    functionNode.d.params = paramList;
    paramList.forEach((param) => {
      param.parent = functionNode;
    });
    if (decorators2) {
      functionNode.d.decorators = decorators2;
      decorators2.forEach((decorator) => {
        decorator.parent = functionNode;
      });
      if (decorators2.length > 0) {
        extendRange(functionNode, decorators2[0]);
      }
    }
    if (returnType) {
      functionNode.d.returnAnnotation = returnType;
      functionNode.d.returnAnnotation.parent = functionNode;
      extendRange(functionNode, returnType);
    }
    if (functionTypeAnnotationToken) {
      this._parseFunctionTypeAnnotationComment(functionTypeAnnotationToken, functionNode);
    }
    return functionNode;
  }
  // typedargslist: (
  //   tfpdef ['=' test] (',' tfpdef ['=' test])*
  //      [ ','
  //          [
  //              '*' [tfpdef] (',' tfpdef ['=' test])* [',' ['**' tfpdef [',']]]
  //              | '**' tfpdef [',']
  //          ]
  //      ]
  //   | '*' [tfpdef] (',' tfpdef ['=' test])* [',' ['**' tfpdef [',']]]
  //   | '**' tfpdef [','])
  // tfpdef: NAME [':' test]
  // vfpdef: NAME;
  _parseVarArgsList(terminator, allowAnnotations) {
    const paramMap = /* @__PURE__ */ new Map();
    const paramList = [];
    let sawDefaultParam = false;
    let reportedNonDefaultParamErr = false;
    let sawKeywordOnlySeparator = false;
    let sawPositionOnlySeparator = false;
    let sawKeywordOnlyParamAfterSeparator = false;
    let sawArgs = false;
    let sawKwArgs = false;
    while (true) {
      if (this._peekTokenType() === terminator) {
        break;
      }
      const param = this._parseParameter(allowAnnotations);
      if (!param) {
        this._consumeTokensUntilType([terminator]);
        break;
      }
      if (param.d.name) {
        const name = param.d.name.d.value;
        if (paramMap.has(name)) {
          this._addSyntaxError(LocMessage.duplicateParam().format({ name }), param.d.name);
        } else {
          paramMap.set(name, name);
        }
      } else if (param.d.category === 0 /* Simple */) {
        if (paramList.length === 0) {
          this._addSyntaxError(LocMessage.positionOnlyFirstParam(), param);
        }
      }
      if (param.d.category === 0 /* Simple */) {
        if (!param.d.name) {
          if (sawPositionOnlySeparator) {
            this._addSyntaxError(LocMessage.duplicatePositionOnly(), param);
          } else if (sawKeywordOnlySeparator) {
            this._addSyntaxError(LocMessage.positionOnlyAfterKeywordOnly(), param);
          } else if (sawArgs) {
            this._addSyntaxError(LocMessage.positionOnlyAfterArgs(), param);
          }
          sawPositionOnlySeparator = true;
        } else {
          if (sawKeywordOnlySeparator) {
            sawKeywordOnlyParamAfterSeparator = true;
          }
          if (param.d.defaultValue) {
            sawDefaultParam = true;
          } else if (sawDefaultParam && !sawKeywordOnlySeparator && !sawArgs) {
            if (!reportedNonDefaultParamErr) {
              this._addSyntaxError(LocMessage.nonDefaultAfterDefault(), param);
              reportedNonDefaultParamErr = true;
            }
          }
        }
      }
      paramList.push(param);
      if (param.d.category === 1 /* ArgsList */) {
        if (!param.d.name) {
          if (sawKeywordOnlySeparator) {
            this._addSyntaxError(LocMessage.duplicateKeywordOnly(), param);
          } else if (sawArgs) {
            this._addSyntaxError(LocMessage.keywordOnlyAfterArgs(), param);
          }
          sawKeywordOnlySeparator = true;
        } else {
          if (sawKeywordOnlySeparator || sawArgs) {
            this._addSyntaxError(LocMessage.duplicateArgsParam(), param);
          }
          sawArgs = true;
        }
      }
      if (param.d.category === 2 /* KwargsDict */) {
        if (sawKwArgs) {
          this._addSyntaxError(LocMessage.duplicateKwargsParam(), param);
        }
        sawKwArgs = true;
        if (sawKeywordOnlySeparator && !sawKeywordOnlyParamAfterSeparator) {
          this._addSyntaxError(LocMessage.keywordParameterMissing(), param);
        }
      } else if (sawKwArgs) {
        this._addSyntaxError(LocMessage.paramAfterKwargsParam(), param);
      }
      const foundComma = this._consumeTokenIfType(12 /* Comma */);
      if (allowAnnotations && !param.d.annotation) {
        const typeAnnotationComment = this._parseVariableTypeAnnotationComment();
        if (typeAnnotationComment) {
          param.d.annotationComment = typeAnnotationComment;
          param.d.annotationComment.parent = param;
          extendRange(param, param.d.annotationComment);
        }
      }
      if (!foundComma) {
        break;
      }
    }
    if (paramList.length > 0) {
      const lastParam = paramList[paramList.length - 1];
      if (lastParam.d.category === 1 /* ArgsList */ && !lastParam.d.name) {
        this._addSyntaxError(LocMessage.expectedNamedParameter(), lastParam);
      }
    }
    return paramList;
  }
  _parseParameter(allowAnnotations) {
    let starCount = 0;
    let slashCount = 0;
    const firstToken = this._peekToken();
    if (this._consumeTokenIfOperator(26 /* Multiply */)) {
      starCount = 1;
    } else if (this._consumeTokenIfOperator(29 /* Power */)) {
      starCount = 2;
    } else if (this._consumeTokenIfOperator(10 /* Divide */)) {
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_8)) {
        this._addSyntaxError(LocMessage.positionOnlyIncompatible(), firstToken);
      }
      slashCount = 1;
    }
    const paramName = this._getTokenIfIdentifier();
    if (!paramName) {
      if (starCount === 1) {
        const paramNode2 = ParameterNode.create(firstToken, 1 /* ArgsList */);
        return paramNode2;
      } else if (slashCount === 1) {
        const paramNode2 = ParameterNode.create(firstToken, 0 /* Simple */);
        return paramNode2;
      }
      if (this._peekTokenType() === 13 /* OpenParenthesis */) {
        const sublistStart = this._getNextToken();
        if (this._consumeTokensUntilType([14 /* CloseParenthesis */])) {
          this._getNextToken();
        }
        this._addSyntaxError(LocMessage.sublistParamsIncompatible(), sublistStart);
      } else {
        this._addSyntaxError(LocMessage.expectedParamName(), this._peekToken());
      }
    }
    let paramType = 0 /* Simple */;
    if (starCount === 1) {
      paramType = 1 /* ArgsList */;
    } else if (starCount === 2) {
      paramType = 2 /* KwargsDict */;
    }
    const paramNode = ParameterNode.create(firstToken, paramType);
    if (paramName) {
      paramNode.d.name = NameNode.create(paramName);
      paramNode.d.name.parent = paramNode;
      extendRange(paramNode, paramName);
    }
    if (allowAnnotations && this._consumeTokenIfType(10 /* Colon */)) {
      paramNode.d.annotation = this._parseTypeAnnotation(paramType === 1 /* ArgsList */);
      paramNode.d.annotation.parent = paramNode;
      extendRange(paramNode, paramNode.d.annotation);
    }
    if (this._consumeTokenIfOperator(2 /* Assign */)) {
      paramNode.d.defaultValue = this._parseTestExpression(
        /* allowAssignmentExpression */
        false
      );
      paramNode.d.defaultValue.parent = paramNode;
      extendRange(paramNode, paramNode.d.defaultValue);
      if (starCount > 0) {
        this._addSyntaxError(LocMessage.defaultValueNotAllowed(), paramNode.d.defaultValue);
      }
    }
    return paramNode;
  }
  // with_stmt: 'with' with_item (',' with_item)*  ':' suite
  // Python 3.10 adds support for optional parentheses around
  // with_item list.
  _parseWithStatement(asyncToken) {
    const withToken = this._getKeywordToken(38 /* With */);
    let withItemList = [];
    const possibleParen = this._peekToken();
    let isParenthesizedWithItemList = false;
    let isParenthesizedDisallowed = false;
    if (possibleParen.type === 13 /* OpenParenthesis */) {
      const openParenTokenIndex = this._tokenIndex;
      this._suppressErrors(() => {
        this._getNextToken();
        while (true) {
          withItemList.push(this._parseWithItem());
          if (!this._consumeTokenIfType(12 /* Comma */)) {
            break;
          }
          if (this._peekToken().type === 14 /* CloseParenthesis */) {
            break;
          }
        }
        if (this._peekToken().type === 14 /* CloseParenthesis */ && this._peekToken(1).type === 10 /* Colon */) {
          isParenthesizedWithItemList = true;
          isParenthesizedDisallowed = withItemList.length !== 1 || withItemList[0].d.target !== void 0;
        }
        this._tokenIndex = openParenTokenIndex;
        withItemList = [];
      });
    }
    if (isParenthesizedWithItemList) {
      this._consumeTokenIfType(13 /* OpenParenthesis */);
      if (isParenthesizedDisallowed && PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_9)) {
        this._addSyntaxError(LocMessage.parenthesizedContextManagerIllegal(), possibleParen);
      }
    }
    while (true) {
      withItemList.push(this._parseWithItem());
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        break;
      }
      if (this._peekToken().type === 14 /* CloseParenthesis */) {
        break;
      }
    }
    if (isParenthesizedWithItemList) {
      if (!this._consumeTokenIfType(14 /* CloseParenthesis */)) {
        this._addSyntaxError(LocMessage.expectedCloseParen(), possibleParen);
      }
    }
    let typeComment;
    const withSuite = this._parseSuite(this._isInFunction, () => {
      const comment = this._getTypeAnnotationCommentText();
      if (comment) {
        typeComment = comment;
      }
    });
    const withNode = WithNode.create(withToken, withSuite);
    if (asyncToken) {
      withNode.d.isAsync = true;
      withNode.d.asyncToken = asyncToken;
      extendRange(withNode, asyncToken);
    }
    if (typeComment) {
      withNode.d.typeComment = typeComment;
    }
    withNode.d.withItems = withItemList;
    withItemList.forEach((withItem) => {
      withItem.parent = withNode;
    });
    return withNode;
  }
  // with_item: test ['as' expr]
  _parseWithItem() {
    const expr = this._parseTestExpression(
      /* allowAssignmentExpression */
      true
    );
    const itemNode = WithItemNode.create(expr);
    if (this._consumeTokenIfKeyword(1 /* As */)) {
      itemNode.d.target = this._parseExpression(
        /* allowUnpack */
        false
      );
      itemNode.d.target.parent = itemNode;
      extendRange(itemNode, itemNode.d.target);
    }
    return itemNode;
  }
  // decorators: decorator+
  // decorated: decorators (classdef | funcdef | async_funcdef)
  _parseDecorated() {
    const decoratorList = [];
    while (true) {
      if (this._peekOperatorType() === 22 /* MatrixMultiply */) {
        decoratorList.push(this._parseDecorator());
      } else {
        break;
      }
    }
    const nextToken = this._peekToken();
    if (nextToken.type === 8 /* Keyword */) {
      if (nextToken.keywordType === 3 /* Async */) {
        this._getNextToken();
        if (this._peekKeywordType() !== 10 /* Def */) {
          this._addSyntaxError(LocMessage.expectedFunctionAfterAsync(), this._peekToken());
        } else {
          return this._parseFunctionDef(nextToken, decoratorList);
        }
      } else if (nextToken.keywordType === 10 /* Def */) {
        return this._parseFunctionDef(void 0, decoratorList);
      } else if (nextToken.keywordType === 7 /* Class */) {
        return this._parseClassDef(decoratorList);
      }
    }
    this._addSyntaxError(LocMessage.expectedAfterDecorator(), this._peekToken());
    return ClassNode.createDummyForDecorators(decoratorList);
  }
  // decorator: '@' dotted_name [ '(' [arglist] ')' ] NEWLINE
  _parseDecorator() {
    const atOperator = this._getNextToken();
    assert(atOperator.operatorType === 22 /* MatrixMultiply */);
    const expression = this._parseTestExpression(
      /* allowAssignmentExpression */
      true
    );
    if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_9)) {
      let isSupportedExpressionForm = false;
      if (this._isNameOrMemberAccessExpression(expression)) {
        isSupportedExpressionForm = true;
      } else if (expression.nodeType === 9 /* Call */ && this._isNameOrMemberAccessExpression(expression.d.leftExpr)) {
        isSupportedExpressionForm = true;
      }
      if (!isSupportedExpressionForm) {
        this._addSyntaxError(LocMessage.expectedDecoratorExpr(), expression);
      }
    }
    const decoratorNode = DecoratorNode.create(atOperator, expression);
    if (!this._consumeTokenIfType(2 /* NewLine */)) {
      this._addSyntaxError(LocMessage.expectedDecoratorNewline(), this._peekToken());
      this._consumeTokensUntilType([2 /* NewLine */]);
    }
    return decoratorNode;
  }
  _isNameOrMemberAccessExpression(expression) {
    if (expression.nodeType === 38 /* Name */) {
      return true;
    } else if (expression.nodeType === 35 /* MemberAccess */) {
      return this._isNameOrMemberAccessExpression(expression.d.leftExpr);
    }
    return false;
  }
  // classdef: 'class' NAME ['(' [arglist] ')'] suite
  _parseClassDef(decorators2) {
    const classToken = this._getKeywordToken(7 /* Class */);
    let nameToken = this._getTokenIfIdentifier();
    if (!nameToken) {
      this._addSyntaxError(LocMessage.expectedClassName(), this._peekToken());
      nameToken = IdentifierToken.create(0, 0, "");
    }
    let typeParameters2;
    const possibleOpenBracket = this._peekToken();
    if (possibleOpenBracket.type === 15 /* OpenBracket */) {
      typeParameters2 = this._parseTypeParameterList();
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_12)) {
        this._addSyntaxError(LocMessage.classTypeParametersIllegal(), typeParameters2);
      }
    }
    let argList = [];
    const openParenToken = this._peekToken();
    if (this._consumeTokenIfType(13 /* OpenParenthesis */)) {
      argList = this._parseArgList().args;
      if (!this._consumeTokenIfType(14 /* CloseParenthesis */)) {
        this._addSyntaxError(LocMessage.expectedCloseParen(), openParenToken);
      }
    }
    const suite = this._parseSuite(
      /* isFunction */
      false
    );
    const classNode = ClassNode.create(
      classToken,
      NameNode.create(nameToken),
      suite,
      typeParameters2
    );
    classNode.d.arguments = argList;
    argList.forEach((arg) => {
      arg.parent = classNode;
    });
    if (decorators2) {
      classNode.d.decorators = decorators2;
      if (decorators2.length > 0) {
        decorators2.forEach((decorator) => {
          decorator.parent = classNode;
        });
        extendRange(classNode, decorators2[0]);
      }
    }
    return classNode;
  }
  _parsePassStatement() {
    return PassNode.create(this._getKeywordToken(31 /* Pass */));
  }
  _parseBreakStatement() {
    const breakToken = this._getKeywordToken(5 /* Break */);
    if (!this._isInLoop) {
      this._addSyntaxError(LocMessage.breakOutsideLoop(), breakToken);
    } else if (this._isInExceptionGroup) {
      this._addSyntaxError(LocMessage.breakInExceptionGroup(), breakToken);
    }
    if (this._isInFinallyLoop && PythonVersion.isGreaterOrEqualTo(this._getLanguageVersion(), pythonVersion3_14)) {
      this._addSyntaxError(LocMessage.finallyBreak(), breakToken);
    }
    return BreakNode.create(breakToken);
  }
  _parseContinueStatement() {
    const continueToken = this._getKeywordToken(8 /* Continue */);
    if (!this._isInLoop) {
      this._addSyntaxError(LocMessage.continueOutsideLoop(), continueToken);
    } else if (this._isInExceptionGroup) {
      this._addSyntaxError(LocMessage.continueInExceptionGroup(), continueToken);
    }
    if (this._isInFinallyLoop && PythonVersion.isGreaterOrEqualTo(this._getLanguageVersion(), pythonVersion3_14)) {
      this._addSyntaxError(LocMessage.finallyContinue(), continueToken);
    }
    return ContinueNode.create(continueToken);
  }
  // return_stmt: 'return' [testlist]
  _parseReturnStatement() {
    const returnToken = this._getKeywordToken(33 /* Return */);
    const returnNode = ReturnNode.create(returnToken);
    if (!this._isInFunction) {
      this._addSyntaxError(LocMessage.returnOutsideFunction(), returnToken);
    } else if (this._isInExceptionGroup) {
      this._addSyntaxError(LocMessage.returnInExceptionGroup(), returnToken);
    }
    if (this._isInFinallyBlock && PythonVersion.isGreaterOrEqualTo(this._getLanguageVersion(), pythonVersion3_14)) {
      this._addSyntaxError(LocMessage.finallyReturn(), returnToken);
    }
    if (!this._isNextTokenNeverExpression()) {
      const returnExpr = this._parseTestOrStarListAsExpression(
        /* allowAssignmentExpression */
        true,
        /* allowMultipleUnpack */
        true,
        2 /* MissingExpression */,
        () => LocMessage.expectedReturnExpr()
      );
      this._reportConditionalErrorForStarTupleElement(returnExpr);
      returnNode.d.expr = returnExpr;
      returnNode.d.expr.parent = returnNode;
      extendRange(returnNode, returnExpr);
    }
    return returnNode;
  }
  // import_from: ('from' (('.' | '...')* dotted_name | ('.' | '...')+)
  //             'import' ('*' | '(' import_as_names ')' | import_as_names))
  // import_as_names: import_as_name (',' import_as_name)* [',']
  // import_as_name: NAME ['as' NAME]
  _parseFromStatement() {
    const fromToken = this._getKeywordToken(18 /* From */);
    const modName = this._parseDottedModuleName(
      /* allowJustDots */
      true
    );
    const importFromNode = ImportFromNode.create(fromToken, modName);
    const possibleInputToken = this._peekToken();
    if (!this._consumeTokenIfKeyword(21 /* Import */)) {
      this._addSyntaxError(LocMessage.expectedImport(), this._peekToken());
    } else {
      extendRange(importFromNode, possibleInputToken);
      const possibleStarToken = this._peekToken();
      if (this._consumeTokenIfOperator(26 /* Multiply */)) {
        extendRange(importFromNode, possibleStarToken);
        importFromNode.d.isWildcardImport = true;
        importFromNode.d.wildcardToken = possibleStarToken;
      } else {
        const openParenToken = this._peekToken();
        const inParen = this._consumeTokenIfType(13 /* OpenParenthesis */);
        let trailingCommaToken;
        while (true) {
          const importName = this._getTokenIfIdentifier();
          if (!importName) {
            break;
          }
          trailingCommaToken = void 0;
          const importFromAsNode = ImportFromAsNode.create(
            NameNode.create(importName)
          );
          if (this._consumeTokenIfKeyword(1 /* As */)) {
            const aliasName = this._getTokenIfIdentifier();
            if (!aliasName) {
              this._addSyntaxError(LocMessage.expectedImportAlias(), this._peekToken());
            } else {
              importFromAsNode.d.alias = NameNode.create(aliasName);
              importFromAsNode.d.alias.parent = importFromAsNode;
              extendRange(importFromAsNode, aliasName);
            }
          }
          importFromNode.d.imports.push(importFromAsNode);
          importFromAsNode.parent = importFromNode;
          extendRange(importFromNode, importFromAsNode);
          const nextToken = this._peekToken();
          if (!this._consumeTokenIfType(12 /* Comma */)) {
            break;
          }
          trailingCommaToken = nextToken;
        }
        if (importFromNode.d.imports.length === 0) {
          this._addSyntaxError(LocMessage.expectedImportSymbols(), this._peekToken());
        }
        if (inParen) {
          const nextToken = this._peekToken();
          if (!this._consumeTokenIfType(14 /* CloseParenthesis */)) {
            this._addSyntaxError(LocMessage.expectedCloseParen(), openParenToken);
          } else {
            extendRange(importFromNode, nextToken);
          }
        } else if (trailingCommaToken) {
          this._addSyntaxError(LocMessage.trailingCommaInFromImport(), trailingCommaToken);
        }
      }
    }
    let isTypingImport = false;
    if (importFromNode.d.module.d.nameParts.length === 1) {
      const firstNamePartValue = importFromNode.d.module.d.nameParts[0].d.value;
      if (firstNamePartValue === "typing" || firstNamePartValue === "typing_extensions") {
        isTypingImport = true;
      }
    }
    if (isTypingImport) {
      const typingSymbolsOfInterest = ["Literal", "TypeAlias", "Annotated"];
      if (importFromNode.d.isWildcardImport) {
        typingSymbolsOfInterest.forEach((s) => {
          this._typingSymbolAliases.set(s, s);
        });
      } else {
        importFromNode.d.imports.forEach((imp) => {
          if (typingSymbolsOfInterest.some((s) => s === imp.d.name.d.value)) {
            this._typingSymbolAliases.set(imp.d.alias?.d.value || imp.d.name.d.value, imp.d.name.d.value);
          }
        });
      }
    }
    return importFromNode;
  }
  // import_name: 'import' dotted_as_names
  // dotted_as_names: dotted_as_name (',' dotted_as_name)*
  // dotted_as_name: dotted_name ['as' NAME]
  _parseImportStatement() {
    const importToken = this._getKeywordToken(21 /* Import */);
    const importNode = ImportNode.create(importToken);
    while (true) {
      const modName = this._parseDottedModuleName();
      const importAsNode = ImportAsNode.create(modName);
      if (this._consumeTokenIfKeyword(1 /* As */)) {
        const aliasToken = this._getTokenIfIdentifier();
        if (aliasToken) {
          importAsNode.d.alias = NameNode.create(aliasToken);
          importAsNode.d.alias.parent = importAsNode;
          extendRange(importAsNode, importAsNode.d.alias);
        } else {
          this._addSyntaxError(LocMessage.expectedImportAlias(), this._peekToken());
        }
      }
      if (importAsNode.d.module.d.leadingDots > 0) {
        this._addSyntaxError(LocMessage.relativeImportNotAllowed(), importAsNode.d.module);
      }
      importNode.d.list.push(importAsNode);
      importAsNode.parent = importNode;
      if (modName.d.nameParts.length === 1) {
        const firstNamePartValue = modName.d.nameParts[0].d.value;
        if (firstNamePartValue === "typing" || firstNamePartValue === "typing_extensions") {
          this._typingImportAliases.push(importAsNode.d.alias?.d.value || firstNamePartValue);
        }
      }
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        break;
      }
    }
    if (importNode.d.list.length > 0) {
      extendRange(importNode, importNode.d.list[importNode.d.list.length - 1]);
    }
    return importNode;
  }
  // ('.' | '...')* dotted_name | ('.' | '...')+
  // dotted_name: NAME ('.' NAME)*
  _parseDottedModuleName(allowJustDots = false) {
    const moduleNameNode = ModuleNameNode.create(this._peekToken());
    while (true) {
      const token = this._getTokenIfType(19 /* Ellipsis */) ?? this._getTokenIfType(20 /* Dot */);
      if (token) {
        if (token.type === 19 /* Ellipsis */) {
          moduleNameNode.d.leadingDots += 3;
        } else {
          moduleNameNode.d.leadingDots++;
        }
        extendRange(moduleNameNode, token);
      } else {
        break;
      }
    }
    while (true) {
      const identifier = this._getTokenIfIdentifier();
      if (!identifier) {
        if (!allowJustDots || moduleNameNode.d.leadingDots === 0 || moduleNameNode.d.nameParts.length > 0) {
          this._addSyntaxError(LocMessage.expectedModuleName(), this._peekToken());
        }
        break;
      }
      const namePart = NameNode.create(identifier);
      moduleNameNode.d.nameParts.push(namePart);
      namePart.parent = moduleNameNode;
      extendRange(moduleNameNode, namePart);
      const nextToken = this._peekToken();
      if (!this._consumeTokenIfType(20 /* Dot */)) {
        break;
      }
      extendRange(moduleNameNode, nextToken);
    }
    return moduleNameNode;
  }
  _parseGlobalStatement() {
    const globalToken = this._getKeywordToken(19 /* Global */);
    const globalNode = GlobalNode.create(globalToken);
    globalNode.d.targets = this._parseNameList();
    if (globalNode.d.targets.length > 0) {
      globalNode.d.targets.forEach((name) => {
        name.parent = globalNode;
      });
      extendRange(globalNode, globalNode.d.targets[globalNode.d.targets.length - 1]);
    }
    return globalNode;
  }
  _parseNonlocalStatement() {
    const nonlocalToken = this._getKeywordToken(28 /* Nonlocal */);
    const nonlocalNode = NonlocalNode.create(nonlocalToken);
    nonlocalNode.d.targets = this._parseNameList();
    if (nonlocalNode.d.targets.length > 0) {
      nonlocalNode.d.targets.forEach((name) => {
        name.parent = nonlocalNode;
      });
      extendRange(nonlocalNode, nonlocalNode.d.targets[nonlocalNode.d.targets.length - 1]);
    }
    return nonlocalNode;
  }
  _parseNameList() {
    const nameList = [];
    while (true) {
      const name = this._getTokenIfIdentifier();
      if (!name) {
        this._addSyntaxError(LocMessage.expectedIdentifier(), this._peekToken());
        break;
      }
      nameList.push(NameNode.create(name));
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        break;
      }
    }
    return nameList;
  }
  // raise_stmt: 'raise' [test ['from' test]]
  // (old) raise_stmt: 'raise' [test [',' test [',' test]]]
  _parseRaiseStatement() {
    const raiseToken = this._getKeywordToken(32 /* Raise */);
    const raiseNode = RaiseNode.create(raiseToken);
    if (!this._isNextTokenNeverExpression()) {
      raiseNode.d.expr = this._parseTestExpression(
        /* allowAssignmentExpression */
        true
      );
      raiseNode.d.expr.parent = raiseNode;
      extendRange(raiseNode, raiseNode.d.expr);
      if (this._consumeTokenIfKeyword(18 /* From */)) {
        raiseNode.d.fromExpr = this._parseTestExpression(
          /* allowAssignmentExpression */
          true
        );
        raiseNode.d.fromExpr.parent = raiseNode;
        extendRange(raiseNode, raiseNode.d.fromExpr);
      }
    }
    return raiseNode;
  }
  // assert_stmt: 'assert' test [',' test]
  _parseAssertStatement() {
    const assertToken = this._getKeywordToken(2 /* Assert */);
    const expr = this._parseTestExpression(
      /* allowAssignmentExpression */
      false
    );
    const assertNode = AssertNode.create(assertToken, expr);
    if (this._consumeTokenIfType(12 /* Comma */)) {
      const exceptionExpr = this._parseTestExpression(
        /* allowAssignmentExpression */
        false
      );
      assertNode.d.exceptionExpr = exceptionExpr;
      assertNode.d.exceptionExpr.parent = assertNode;
      extendRange(assertNode, exceptionExpr);
    }
    return assertNode;
  }
  // del_stmt: 'del' exprlist
  _parseDelStatement() {
    const delToken = this._getKeywordToken(11 /* Del */);
    const exprListResult = this._parseExpressionList(
      /* allowStar */
      true
    );
    if (!exprListResult.parseError && exprListResult.list.length === 0) {
      this._addSyntaxError(LocMessage.expectedDelExpr(), this._peekToken());
    }
    const delNode = DelNode.create(delToken);
    delNode.d.targets = exprListResult.list;
    if (delNode.d.targets.length > 0) {
      delNode.d.targets.forEach((expr) => {
        expr.parent = delNode;
      });
      extendRange(delNode, delNode.d.targets[delNode.d.targets.length - 1]);
    }
    return delNode;
  }
  // yield_expr: 'yield' [yield_arg]
  // yield_arg: 'from' test | testlist
  _parseYieldExpression() {
    const yieldToken = this._getKeywordToken(39 /* Yield */);
    const nextToken = this._peekToken();
    if (this._consumeTokenIfKeyword(18 /* From */)) {
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_3)) {
        this._addSyntaxError(LocMessage.yieldFromIllegal(), nextToken);
      }
      return YieldFromNode.create(
        yieldToken,
        this._parseTestExpression(
          /* allowAssignmentExpression */
          false
        )
      );
    }
    let exprList;
    if (!this._isNextTokenNeverExpression()) {
      exprList = this._parseTestOrStarListAsExpression(
        /* allowAssignmentExpression */
        false,
        /* allowMultipleUnpack */
        true,
        2 /* MissingExpression */,
        () => LocMessage.expectedYieldExpr()
      );
      this._reportConditionalErrorForStarTupleElement(exprList);
    }
    return YieldNode.create(yieldToken, exprList);
  }
  _tryParseYieldExpression() {
    if (this._peekKeywordType() !== 39 /* Yield */) {
      return void 0;
    }
    return this._parseYieldExpression();
  }
  // simple_stmt: small_stmt (';' small_stmt)* [';'] NEWLINE
  _parseSimpleStatement() {
    const statement = StatementListNode.create(this._peekToken());
    while (true) {
      if (this._peekTokenType() === 0 /* Invalid */) {
        const invalidToken = this._getNextToken();
        const text = this._fileContents.substr(invalidToken.start, invalidToken.length);
        const firstCharCode = text.charCodeAt(0);
        const nextTok = this._peekToken();
        const nextNextTok = this._peekToken(1);
        const isBackslash = firstCharCode === 92 /* Backslash */;
        const isAtEofLineContinuation = isBackslash && nextTok.type === 2 /* NewLine */ && nextNextTok.type === 1 /* EndOfStream */;
        if (isAtEofLineContinuation) {
          this._addSyntaxError(LocMessage.unexpectedEof(), invalidToken);
        } else {
          this._addSyntaxError(
            LocMessage.invalidTokenChars().format({ text: `\\u${firstCharCode.toString(16)}` }),
            invalidToken
          );
        }
        this._consumeTokensUntilType([2 /* NewLine */]);
        break;
      }
      const smallStatement = this._parseSmallStatement();
      statement.d.statements.push(smallStatement);
      smallStatement.parent = statement;
      extendRange(statement, smallStatement);
      if (smallStatement.nodeType === 0 /* Error */) {
        break;
      }
      if (!this._consumeTokenIfType(11 /* Semicolon */)) {
        break;
      }
      const nextTokenType = this._peekTokenType();
      if (nextTokenType === 2 /* NewLine */ || nextTokenType === 1 /* EndOfStream */) {
        break;
      }
    }
    if (!this._consumeTokenIfType(2 /* NewLine */)) {
      this._addSyntaxError(LocMessage.expectedNewlineOrSemicolon(), this._peekToken());
    }
    return statement;
  }
  // small_stmt: (expr_stmt | del_stmt | pass_stmt | flow_stmt |
  //             import_stmt | global_stmt | nonlocal_stmt | assert_stmt)
  // flow_stmt: break_stmt | continue_stmt | return_stmt | raise_stmt | yield_stmt
  // import_stmt: import_name | import_from
  _parseSmallStatement() {
    switch (this._peekKeywordType()) {
      case 31 /* Pass */:
        return this._parsePassStatement();
      case 5 /* Break */:
        return this._parseBreakStatement();
      case 8 /* Continue */:
        return this._parseContinueStatement();
      case 33 /* Return */:
        return this._parseReturnStatement();
      case 18 /* From */:
        return this._parseFromStatement();
      case 21 /* Import */:
        return this._parseImportStatement();
      case 19 /* Global */:
        return this._parseGlobalStatement();
      case 28 /* Nonlocal */:
        return this._parseNonlocalStatement();
      case 32 /* Raise */:
        return this._parseRaiseStatement();
      case 2 /* Assert */:
        return this._parseAssertStatement();
      case 11 /* Del */:
        return this._parseDelStatement();
      case 39 /* Yield */:
        return this._parseYieldExpression();
      case 25 /* Lazy */: {
        const peekToken1 = this._peekToken(1);
        if (peekToken1.type === 8 /* Keyword */ && (peekToken1.keywordType === 21 /* Import */ || peekToken1.keywordType === 18 /* From */)) {
          return this._parseLazyImportStatement();
        }
        break;
      }
      case 36 /* Type */: {
        const peekToken1 = this._peekToken(1);
        const peekToken2 = this._peekToken(2);
        let isInvalidTypeToken = true;
        if (peekToken1.type === 7 /* Identifier */ || peekToken1.type === 8 /* Keyword */ && KeywordToken.isSoftKeyword(peekToken1)) {
          if (peekToken2.type === 15 /* OpenBracket */) {
            isInvalidTypeToken = false;
          } else if (peekToken2.type === 9 /* Operator */ && peekToken2.operatorType === 2 /* Assign */) {
            isInvalidTypeToken = false;
          }
        }
        if (!isInvalidTypeToken) {
          return this._parseTypeAliasStatement();
        }
        break;
      }
    }
    return this._parseExpressionStatement();
  }
  _makeExpressionOrTuple(exprListResult, enclosedInParens) {
    if (exprListResult.list.length === 1 && !exprListResult.trailingComma) {
      if (exprListResult.list[0].nodeType === 56 /* Unpack */) {
        this._addSyntaxError(LocMessage.unpackOperatorNotAllowed(), exprListResult.list[0]);
      }
      return exprListResult.list[0];
    }
    const tupleStartRange = exprListResult.list.length > 0 ? exprListResult.list[0] : this._peekToken(-1);
    const tupleNode = TupleNode.create(tupleStartRange, enclosedInParens);
    tupleNode.d.items = exprListResult.list;
    if (exprListResult.list.length > 0) {
      exprListResult.list.forEach((expr) => {
        expr.parent = tupleNode;
      });
      extendRange(tupleNode, exprListResult.list[exprListResult.list.length - 1]);
    }
    return tupleNode;
  }
  _parseExpressionListAsPossibleTuple(errorCategory, getErrorString, errorToken) {
    if (this._isNextTokenNeverExpression()) {
      this._addSyntaxError(getErrorString(), errorToken);
      return ErrorNode.create(errorToken, errorCategory);
    }
    const exprListResult = this._parseExpressionList(
      /* allowStar */
      true
    );
    if (exprListResult.parseError) {
      return exprListResult.parseError;
    }
    return this._makeExpressionOrTuple(
      exprListResult,
      /* enclosedInParens */
      false
    );
  }
  _parseTestListAsExpression(errorCategory, getErrorString) {
    if (this._isNextTokenNeverExpression()) {
      return this._handleExpressionParseError(errorCategory, getErrorString());
    }
    const exprListResult = this._parseTestExpressionList();
    if (exprListResult.parseError) {
      return exprListResult.parseError;
    }
    return this._makeExpressionOrTuple(
      exprListResult,
      /* enclosedInParens */
      false
    );
  }
  _parseTestOrStarListAsExpression(allowAssignmentExpression, allowMultipleUnpack, errorCategory, getErrorString) {
    if (this._isNextTokenNeverExpression()) {
      return this._handleExpressionParseError(errorCategory, getErrorString());
    }
    const exprListResult = this._parseTestOrStarExpressionList(allowAssignmentExpression, allowMultipleUnpack);
    if (exprListResult.parseError) {
      return exprListResult.parseError;
    }
    return this._makeExpressionOrTuple(
      exprListResult,
      /* enclosedInParens */
      false
    );
  }
  _parseExpressionList(allowStar) {
    return this._parseExpressionListGeneric(() => this._parseExpression(allowStar));
  }
  // testlist: test (',' test)* [',']
  _parseTestExpressionList() {
    return this._parseExpressionListGeneric(() => this._parseTestExpression(
      /* allowAssignmentExpression */
      false
    ));
  }
  _parseTestOrStarExpressionList(allowAssignmentExpression, allowMultipleUnpack) {
    const exprListResult = this._parseExpressionListGeneric(
      () => this._parseTestOrStarExpression(allowAssignmentExpression)
    );
    if (!allowMultipleUnpack && !exprListResult.parseError) {
      let sawStar = false;
      for (const expr of exprListResult.list) {
        if (expr.nodeType === 56 /* Unpack */) {
          if (sawStar) {
            this._addSyntaxError(LocMessage.duplicateUnpack(), expr);
            break;
          }
          sawStar = true;
        }
      }
    }
    return exprListResult;
  }
  // exp_or_star: expr | star_expr
  // expr: xor_expr ('|' xor_expr)*
  // star_expr: '*' expr
  _parseExpression(allowUnpack) {
    const startToken = this._peekToken();
    if (allowUnpack && this._consumeTokenIfOperator(26 /* Multiply */)) {
      return UnpackNode.create(startToken, this._parseExpression(
        /* allowUnpack */
        false
      ));
    }
    return this._parseBitwiseOrExpression();
  }
  // test_or_star: test | star_expr
  _parseTestOrStarExpression(allowAssignmentExpression) {
    if (this._peekOperatorType() === 26 /* Multiply */) {
      return this._parseExpression(
        /* allowUnpack */
        true
      );
    }
    return this._parseTestExpression(allowAssignmentExpression);
  }
  // test: or_test ['if' or_test 'else' test] | lambdef
  _parseTestExpression(allowAssignmentExpression) {
    if (this._peekKeywordType() === 24 /* Lambda */) {
      return this._parseLambdaExpression();
    }
    const ifExpr = this._parseAssignmentExpression(!allowAssignmentExpression);
    if (ifExpr.nodeType === 0 /* Error */) {
      return ifExpr;
    }
    if (!this._consumeTokenIfKeyword(20 /* If */)) {
      return ifExpr;
    }
    const testExpr = this._parseOrTest();
    if (testExpr.nodeType === 0 /* Error */) {
      return testExpr;
    }
    if (!this._consumeTokenIfKeyword(13 /* Else */)) {
      return TernaryNode.create(
        ifExpr,
        testExpr,
        this._handleExpressionParseError(1 /* MissingElse */, LocMessage.expectedElse())
      );
    }
    const elseExpr = this._parseTestExpression(
      /* allowAssignmentExpression */
      true
    );
    return TernaryNode.create(ifExpr, testExpr, elseExpr);
  }
  // assign_expr: NAME := test
  _parseAssignmentExpression(disallowAssignmentExpression = false) {
    const leftExpr = this._parseOrTest();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    if (leftExpr.nodeType !== 38 /* Name */) {
      return leftExpr;
    }
    const walrusToken = this._peekToken();
    if (!this._consumeTokenIfOperator(35 /* Walrus */)) {
      return leftExpr;
    }
    if (!this._assignmentExpressionsAllowed) {
      this._addSyntaxError(LocMessage.walrusNotAllowedInComprehension(), walrusToken);
    } else if (disallowAssignmentExpression) {
      this._addSyntaxError(LocMessage.walrusNotAllowed(), walrusToken);
    }
    if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_8)) {
      this._addSyntaxError(LocMessage.walrusIllegal(), walrusToken);
    }
    const rightExpr = this._parseTestExpression(
      /* allowAssignmentExpression */
      false
    );
    return AssignmentExpressionNode.create(leftExpr, walrusToken, rightExpr);
  }
  // or_test: and_test ('or' and_test)*
  _parseOrTest() {
    let leftExpr = this._parseAndTest();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    while (true) {
      const peekToken = this._peekToken();
      if (!this._consumeTokenIfKeyword(30 /* Or */)) {
        break;
      }
      const rightExpr = this._parseAndTest();
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, 37 /* Or */);
    }
    return leftExpr;
  }
  // and_test: not_test ('and' not_test)*
  _parseAndTest() {
    let leftExpr = this._parseNotTest();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    while (true) {
      const peekToken = this._peekToken();
      if (!this._consumeTokenIfKeyword(0 /* And */)) {
        break;
      }
      const rightExpr = this._parseNotTest();
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, 36 /* And */);
    }
    return leftExpr;
  }
  // not_test: 'not' not_test | comparison
  _parseNotTest() {
    const notToken = this._peekToken();
    if (this._consumeTokenIfKeyword(29 /* Not */)) {
      const notExpr = this._parseNotTest();
      return this._createUnaryOperationNode(notToken, notExpr, 38 /* Not */);
    }
    return this._parseComparison();
  }
  // comparison: expr (comp_op expr)*
  // comp_op: '<'|'>'|'=='|'>='|'<='|'<>'|'!='|'in'|'not' 'in'|'is'|'is' 'not'
  _parseComparison() {
    let leftExpr = this._parseBitwiseOrExpression();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    while (true) {
      let comparisonOperator;
      const peekToken = this._peekToken();
      if (Tokenizer.isOperatorComparison(this._peekOperatorType())) {
        comparisonOperator = this._peekOperatorType();
        if (comparisonOperator === 19 /* LessOrGreaterThan */) {
          this._addSyntaxError(LocMessage.operatorLessOrGreaterDeprecated(), peekToken);
          comparisonOperator = 28 /* NotEquals */;
        }
        this._getNextToken();
      } else if (this._consumeTokenIfKeyword(22 /* In */)) {
        comparisonOperator = 41 /* In */;
      } else if (this._consumeTokenIfKeyword(23 /* Is */)) {
        if (this._consumeTokenIfKeyword(29 /* Not */)) {
          comparisonOperator = 40 /* IsNot */;
        } else {
          comparisonOperator = 39 /* Is */;
        }
      } else if (this._peekKeywordType() === 29 /* Not */) {
        const tokenAfterNot = this._peekToken(1);
        if (tokenAfterNot.type === 8 /* Keyword */ && tokenAfterNot.keywordType === 22 /* In */) {
          this._getNextToken();
          this._getNextToken();
          comparisonOperator = 42 /* NotIn */;
        }
      }
      if (comparisonOperator === void 0) {
        break;
      }
      const rightExpr = this._parseComparison();
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, comparisonOperator);
    }
    return leftExpr;
  }
  // expr: xor_expr ('|' xor_expr)*
  _parseBitwiseOrExpression() {
    let leftExpr = this._parseBitwiseXorExpression();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    while (true) {
      const peekToken = this._peekToken();
      if (!this._consumeTokenIfOperator(6 /* BitwiseOr */)) {
        break;
      }
      const rightExpr = this._parseBitwiseXorExpression();
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, 6 /* BitwiseOr */);
    }
    return leftExpr;
  }
  // xor_expr: and_expr ('^' and_expr)*
  _parseBitwiseXorExpression() {
    let leftExpr = this._parseBitwiseAndExpression();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    while (true) {
      const peekToken = this._peekToken();
      if (!this._consumeTokenIfOperator(8 /* BitwiseXor */)) {
        break;
      }
      const rightExpr = this._parseBitwiseAndExpression();
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, 8 /* BitwiseXor */);
    }
    return leftExpr;
  }
  // and_expr: shift_expr ('&' shift_expr)*
  _parseBitwiseAndExpression() {
    let leftExpr = this._parseShiftExpression();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    while (true) {
      const peekToken = this._peekToken();
      if (!this._consumeTokenIfOperator(3 /* BitwiseAnd */)) {
        break;
      }
      const rightExpr = this._parseShiftExpression();
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, 3 /* BitwiseAnd */);
    }
    return leftExpr;
  }
  // shift_expr: arith_expr (('<<'|'>>') arith_expr)*
  _parseShiftExpression() {
    let leftExpr = this._parseArithmeticExpression();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    let peekToken = this._peekToken();
    let nextOperator = this._peekOperatorType();
    while (nextOperator === 17 /* LeftShift */ || nextOperator === 31 /* RightShift */) {
      this._getNextToken();
      const rightExpr = this._parseArithmeticExpression();
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, nextOperator);
      peekToken = this._peekToken();
      nextOperator = this._peekOperatorType();
    }
    return leftExpr;
  }
  // arith_expr: term (('+'|'-') term)*
  _parseArithmeticExpression() {
    let leftExpr = this._parseArithmeticTerm();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    let peekToken = this._peekToken();
    let nextOperator = this._peekOperatorType();
    while (nextOperator === 0 /* Add */ || nextOperator === 33 /* Subtract */) {
      this._getNextToken();
      const rightExpr = this._parseArithmeticTerm();
      if (rightExpr.nodeType === 0 /* Error */) {
        return rightExpr;
      }
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, nextOperator);
      peekToken = this._peekToken();
      nextOperator = this._peekOperatorType();
    }
    return leftExpr;
  }
  // term: factor (('*'|'@'|'/'|'%'|'//') factor)*
  _parseArithmeticTerm() {
    let leftExpr = this._parseArithmeticFactor();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    let peekToken = this._peekToken();
    let nextOperator = this._peekOperatorType();
    while (nextOperator === 26 /* Multiply */ || nextOperator === 22 /* MatrixMultiply */ || nextOperator === 10 /* Divide */ || nextOperator === 24 /* Mod */ || nextOperator === 13 /* FloorDivide */) {
      this._getNextToken();
      const rightExpr = this._parseArithmeticFactor();
      leftExpr = this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, nextOperator);
      peekToken = this._peekToken();
      nextOperator = this._peekOperatorType();
    }
    return leftExpr;
  }
  // factor: ('+'|'-'|'~') factor | power
  // power: atom_expr ['**' factor]
  _parseArithmeticFactor() {
    const nextToken = this._peekToken();
    const nextOperator = this._peekOperatorType();
    if (nextOperator === 0 /* Add */ || nextOperator === 33 /* Subtract */ || nextOperator === 5 /* BitwiseInvert */) {
      this._getNextToken();
      const expression = this._parseArithmeticFactor();
      return this._createUnaryOperationNode(nextToken, expression, nextOperator);
    }
    const leftExpr = this._parseAtomExpression();
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    const peekToken = this._peekToken();
    if (this._consumeTokenIfOperator(29 /* Power */)) {
      const rightExpr = this._parseArithmeticFactor();
      return this._createBinaryOperationNode(leftExpr, rightExpr, peekToken, 29 /* Power */);
    }
    return leftExpr;
  }
  // Determines whether the expression refers to a type exported by the typing
  // or typing_extensions modules. We can directly evaluate the types at binding
  // time. We assume here that the code isn't making use of some custom type alias
  // to refer to the typing types.
  _isTypingAnnotation(typeAnnotation, name) {
    if (typeAnnotation.nodeType === 38 /* Name */) {
      const alias = this._typingSymbolAliases.get(typeAnnotation.d.value);
      if (alias === name) {
        return true;
      }
    } else if (typeAnnotation.nodeType === 35 /* MemberAccess */) {
      if (typeAnnotation.d.leftExpr.nodeType === 38 /* Name */ && typeAnnotation.d.member.d.value === name) {
        const baseName = typeAnnotation.d.leftExpr.d.value;
        return this._typingImportAliases.some((alias) => alias === baseName);
      }
    }
    return false;
  }
  // atom_expr: ['await'] atom trailer*
  // trailer: '(' [arglist] ')' | '[' subscriptlist ']' | '.' NAME
  _parseAtomExpression() {
    let awaitToken;
    if (this._peekKeywordType() === 4 /* Await */) {
      awaitToken = this._getKeywordToken(4 /* Await */);
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_5)) {
        this._addSyntaxError(LocMessage.awaitIllegal(), awaitToken);
      }
    }
    let atomExpression = this._parseAtom();
    if (atomExpression.nodeType === 0 /* Error */) {
      return atomExpression;
    }
    while (true) {
      const startOfTrailerToken = this._peekToken();
      if (this._consumeTokenIfType(13 /* OpenParenthesis */)) {
        const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
        this._isParsingTypeAnnotation = false;
        const argListResult = this._parseArgList();
        const callNode = CallNode.create(atomExpression, argListResult.args);
        if (argListResult.args.length > 1 || argListResult.trailingComma) {
          argListResult.args.forEach((arg) => {
            if (arg.d.valueExpr.nodeType === 11 /* Comprehension */) {
              if (!arg.d.valueExpr.d.hasParens) {
                this._addSyntaxError(LocMessage.generatorNotParenthesized(), arg.d.valueExpr);
              }
            }
          });
        }
        const nextToken = this._peekToken();
        let isArgListTerminated = false;
        if (!this._consumeTokenIfType(14 /* CloseParenthesis */)) {
          this._addSyntaxError(LocMessage.expectedCloseParen(), startOfTrailerToken);
          this._consumeTokensUntilType([2 /* NewLine */]);
          extendRange(callNode, this._peekToken());
        } else {
          extendRange(callNode, nextToken);
          isArgListTerminated = true;
        }
        this._isParsingTypeAnnotation = wasParsingTypeAnnotation;
        const maxDepth = this._maxChildDepthMap.get(atomExpression.id) ?? 0;
        if (maxDepth >= maxChildNodeDepth) {
          atomExpression = ErrorNode.create(
            callNode,
            15 /* MaxDepthExceeded */
          );
          this._addSyntaxError(LocMessage.maxParseDepthExceeded(), atomExpression);
        } else {
          atomExpression = callNode;
          this._maxChildDepthMap.set(callNode.id, maxDepth + 1);
        }
        if (!isArgListTerminated) {
          break;
        }
      } else if (this._consumeTokenIfType(15 /* OpenBracket */)) {
        const wasParsingIndexTrailer = this._isParsingIndexTrailer;
        const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
        if (this._isTypingAnnotation(atomExpression, "Literal") || this._isTypingAnnotation(atomExpression, "Annotated")) {
          this._isParsingTypeAnnotation = false;
        }
        this._isParsingIndexTrailer = true;
        const subscriptList = this._parseSubscriptList();
        this._isParsingTypeAnnotation = wasParsingTypeAnnotation;
        this._isParsingIndexTrailer = wasParsingIndexTrailer;
        const closingToken = this._peekToken();
        const indexNode = IndexNode.create(
          atomExpression,
          subscriptList.list,
          subscriptList.trailingComma,
          closingToken
        );
        extendRange(indexNode, indexNode);
        if (!this._consumeTokenIfType(16 /* CloseBracket */)) {
          this._handleExpressionParseError(
            6 /* MissingIndexCloseBracket */,
            LocMessage.expectedCloseBracket(),
            startOfTrailerToken,
            indexNode
          );
        }
        const maxDepth = this._maxChildDepthMap.get(atomExpression.id) ?? 0;
        if (maxDepth >= maxChildNodeDepth) {
          atomExpression = ErrorNode.create(
            indexNode,
            15 /* MaxDepthExceeded */
          );
          this._addSyntaxError(LocMessage.maxParseDepthExceeded(), atomExpression);
        } else {
          atomExpression = indexNode;
          this._maxChildDepthMap.set(indexNode.id, maxDepth + 1);
        }
      } else if (this._consumeTokenIfType(20 /* Dot */)) {
        const memberName = this._getTokenIfIdentifier();
        if (!memberName) {
          return this._handleExpressionParseError(
            7 /* MissingMemberAccessName */,
            LocMessage.expectedMemberName(),
            startOfTrailerToken,
            atomExpression,
            [8 /* Keyword */]
          );
        }
        const memberAccessNode = MemberAccessNode.create(
          atomExpression,
          NameNode.create(memberName)
        );
        const maxDepth = this._maxChildDepthMap.get(atomExpression.id) ?? 0;
        if (maxDepth >= maxChildNodeDepth) {
          atomExpression = ErrorNode.create(
            memberAccessNode,
            15 /* MaxDepthExceeded */
          );
          this._addSyntaxError(LocMessage.maxParseDepthExceeded(), atomExpression);
        } else {
          atomExpression = memberAccessNode;
          this._maxChildDepthMap.set(memberAccessNode.id, maxDepth + 1);
        }
      } else {
        break;
      }
    }
    if (awaitToken) {
      return AwaitNode.create(awaitToken, atomExpression);
    }
    return atomExpression;
  }
  // subscriptlist: subscript (',' subscript)* [',']
  _parseSubscriptList() {
    const argList = [];
    let sawKeywordArg = false;
    let trailingComma = false;
    while (true) {
      const firstToken = this._peekToken();
      if (firstToken.type !== 10 /* Colon */ && this._isNextTokenNeverExpression()) {
        break;
      }
      let argType = 0 /* Simple */;
      if (this._consumeTokenIfOperator(26 /* Multiply */)) {
        argType = 1 /* UnpackedList */;
      } else if (this._consumeTokenIfOperator(29 /* Power */)) {
        argType = 2 /* UnpackedDictionary */;
      }
      const startOfSubscriptIndex = this._tokenIndex;
      let valueExpr = this._parsePossibleSlice();
      let nameIdentifier;
      if (argType === 0 /* Simple */) {
        if (this._consumeTokenIfOperator(2 /* Assign */)) {
          const nameExpr = valueExpr;
          valueExpr = this._parsePossibleSlice();
          if (nameExpr.nodeType === 38 /* Name */) {
            nameIdentifier = nameExpr.d.token;
          } else {
            this._addSyntaxError(LocMessage.expectedParamName(), nameExpr);
          }
        } else if (valueExpr.nodeType === 38 /* Name */ && this._peekOperatorType() === 35 /* Walrus */) {
          this._tokenIndex = startOfSubscriptIndex;
          valueExpr = this._parseTestExpression(
            /* allowAssignmentExpression */
            true
          );
          if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_10)) {
            this._addSyntaxError(LocMessage.assignmentExprInSubscript(), valueExpr);
          }
        }
      }
      const argNode = ArgumentNode.create(firstToken, valueExpr, argType);
      if (nameIdentifier) {
        argNode.d.name = NameNode.create(nameIdentifier);
        argNode.d.name.parent = argNode;
      }
      if (argNode.d.name) {
        sawKeywordArg = true;
      } else if (sawKeywordArg && argNode.d.argCategory === 0 /* Simple */) {
        this._addSyntaxError(LocMessage.positionArgAfterNamedArg(), argNode);
      }
      argList.push(argNode);
      if (argNode.d.name) {
        this._addSyntaxError(LocMessage.keywordSubscriptIllegal(), argNode.d.name);
      }
      if (argType !== 0 /* Simple */) {
        const unpackListAllowed = this._isParsingQuotedText || PythonVersion.isGreaterOrEqualTo(this._getLanguageVersion(), pythonVersion3_11);
        if (argType === 1 /* UnpackedList */ && !unpackListAllowed) {
          this._addSyntaxError(LocMessage.unpackedSubscriptIllegal(), argNode);
        }
        if (argType === 2 /* UnpackedDictionary */) {
          this._addSyntaxError(LocMessage.unpackedDictSubscriptIllegal(), argNode);
        }
      }
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        trailingComma = false;
        break;
      }
      trailingComma = true;
    }
    if (argList.length === 0) {
      const errorNode = this._handleExpressionParseError(
        3 /* MissingIndexOrSlice */,
        LocMessage.expectedSliceIndex(),
        /* targetToken */
        void 0,
        /* childNode */
        void 0,
        [16 /* CloseBracket */]
      );
      argList.push(ArgumentNode.create(this._peekToken(), errorNode, 0 /* Simple */));
    }
    return {
      list: argList,
      trailingComma
    };
  }
  // subscript: test | [test] ':' [test] [sliceop]
  // sliceop: ':' [test]
  _parsePossibleSlice() {
    const firstToken = this._peekToken();
    const sliceExpressions = [void 0, void 0, void 0];
    let sliceIndex = 0;
    let sawColon = false;
    while (true) {
      const nextTokenType = this._peekTokenType();
      if (nextTokenType === 16 /* CloseBracket */ || nextTokenType === 12 /* Comma */) {
        break;
      }
      if (nextTokenType !== 10 /* Colon */) {
        const allowAssignmentExpression = PythonVersion.isGreaterOrEqualTo(this._getLanguageVersion(), pythonVersion3_10);
        sliceExpressions[sliceIndex] = this._parseTestExpression(allowAssignmentExpression);
      }
      sliceIndex++;
      if (sliceIndex >= 3 || !this._consumeTokenIfType(10 /* Colon */)) {
        break;
      }
      sawColon = true;
    }
    if (!sawColon) {
      if (sliceExpressions[0]) {
        return sliceExpressions[0];
      }
      return ErrorNode.create(
        this._peekToken(),
        3 /* MissingIndexOrSlice */
      );
    }
    const sliceNode = SliceNode.create(firstToken);
    sliceNode.d.startValue = sliceExpressions[0];
    if (sliceNode.d.startValue) {
      sliceNode.d.startValue.parent = sliceNode;
    }
    sliceNode.d.endValue = sliceExpressions[1];
    if (sliceNode.d.endValue) {
      sliceNode.d.endValue.parent = sliceNode;
    }
    sliceNode.d.stepValue = sliceExpressions[2];
    if (sliceNode.d.stepValue) {
      sliceNode.d.stepValue.parent = sliceNode;
    }
    const extension = sliceExpressions[2] || sliceExpressions[1] || sliceExpressions[0];
    if (extension) {
      extendRange(sliceNode, extension);
    }
    return sliceNode;
  }
  // arglist: argument (',' argument)*  [',']
  _parseArgList() {
    const argList = [];
    let sawKeywordArg = false;
    let sawUnpackedKeywordArg = false;
    let trailingComma = false;
    while (true) {
      const nextTokenType = this._peekTokenType();
      if (nextTokenType === 14 /* CloseParenthesis */ || nextTokenType === 2 /* NewLine */ || nextTokenType === 1 /* EndOfStream */) {
        break;
      }
      trailingComma = false;
      const arg = this._parseArgument();
      if (arg.d.name) {
        sawKeywordArg = true;
      } else {
        if (sawKeywordArg && arg.d.argCategory === 0 /* Simple */) {
          this._addSyntaxError(LocMessage.positionArgAfterNamedArg(), arg);
        }
        if (sawUnpackedKeywordArg && arg.d.argCategory !== 2 /* UnpackedDictionary */) {
          this._addSyntaxError(LocMessage.positionArgAfterUnpackedDictArg(), arg);
        }
      }
      if (arg.d.argCategory === 2 /* UnpackedDictionary */) {
        sawUnpackedKeywordArg = true;
      }
      argList.push(arg);
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        break;
      }
      trailingComma = true;
    }
    return { args: argList, trailingComma };
  }
  // argument: ( test [comp_for] |
  //             test '=' test |
  //             '**' test |
  //             '*' test )
  _parseArgument() {
    const firstToken = this._peekToken();
    let argType = 0 /* Simple */;
    if (this._consumeTokenIfOperator(26 /* Multiply */)) {
      argType = 1 /* UnpackedList */;
    } else if (this._consumeTokenIfOperator(29 /* Power */)) {
      argType = 2 /* UnpackedDictionary */;
    }
    let valueExpr = this._parseTestExpression(
      /* allowAssignmentExpression */
      true
    );
    let nameIdentifier;
    if (argType === 0 /* Simple */) {
      if (this._consumeTokenIfOperator(2 /* Assign */)) {
        const nameExpr = valueExpr;
        valueExpr = this._parseTestExpression(
          /* allowAssignmentExpression */
          false
        );
        if (nameExpr.nodeType === 38 /* Name */) {
          nameIdentifier = nameExpr.d.token;
        } else {
          this._addSyntaxError(LocMessage.expectedParamName(), nameExpr);
        }
      } else {
        const comprehension = this._tryParseComprehension(
          valueExpr,
          /* isGenerator */
          true
        );
        if (comprehension) {
          valueExpr = comprehension;
        }
      }
    }
    const argNode = ArgumentNode.create(firstToken, valueExpr, argType);
    if (nameIdentifier) {
      argNode.d.name = NameNode.create(nameIdentifier);
      argNode.d.name.parent = argNode;
    }
    return argNode;
  }
  // atom: ('(' [yield_expr | testlist_comp] ')' |
  //     '[' [testlist_comp] ']' |
  //     '{' [dictorsetmaker] '}' |
  //     NAME | NUMBER | STRING+ | '...' | 'None' | 'True' | 'False' | '__debug__')
  _parseAtom() {
    const nextToken = this._peekToken();
    if (nextToken.type === 19 /* Ellipsis */) {
      return EllipsisNode.create(this._getNextToken());
    }
    if (nextToken.type === 6 /* Number */) {
      return NumberNode.create(this._getNextToken());
    }
    if (nextToken.type === 7 /* Identifier */) {
      return NameNode.create(this._getNextToken());
    }
    if (nextToken.type === 5 /* String */ || nextToken.type === 24 /* FStringStart */) {
      return this._parseStringList();
    }
    if (nextToken.type === 22 /* Backtick */) {
      this._getNextToken();
      this._addSyntaxError(LocMessage.backticksIllegal(), nextToken);
      const expressionNode = this._parseTestListAsExpression(
        2 /* MissingExpression */,
        () => LocMessage.expectedExpr()
      );
      this._consumeTokenIfType(22 /* Backtick */);
      return expressionNode;
    }
    if (nextToken.type === 13 /* OpenParenthesis */) {
      const possibleTupleNode = this._parseTupleAtom();
      if (possibleTupleNode.nodeType === 55 /* UnaryOperation */ || possibleTupleNode.nodeType === 6 /* Await */ || possibleTupleNode.nodeType === 7 /* BinaryOperation */) {
        possibleTupleNode.d.hasParens = true;
      }
      if (possibleTupleNode.nodeType === 48 /* StringList */ || possibleTupleNode.nodeType === 11 /* Comprehension */ || possibleTupleNode.nodeType === 4 /* AssignmentExpression */) {
        possibleTupleNode.d.hasParens = true;
      }
      return possibleTupleNode;
    } else if (nextToken.type === 15 /* OpenBracket */) {
      return this._parseListAtom();
    } else if (nextToken.type === 17 /* OpenCurlyBrace */) {
      return this._parseDictionaryOrSetAtom();
    }
    if (nextToken.type === 8 /* Keyword */) {
      const keywordToken = nextToken;
      if (keywordToken.keywordType === 15 /* False */ || keywordToken.keywordType === 34 /* True */ || keywordToken.keywordType === 9 /* Debug */ || keywordToken.keywordType === 27 /* None */) {
        return ConstantNode.create(this._getNextToken());
      }
      const keywordAsIdentifier = this._getTokenIfIdentifier();
      if (keywordAsIdentifier) {
        return NameNode.create(keywordAsIdentifier);
      }
    }
    return this._handleExpressionParseError(2 /* MissingExpression */, LocMessage.expectedExpr());
  }
  // Allocates a dummy "error expression" and consumes the remainder
  // of the tokens on the line for error recovery. A partially-completed
  // child node can be passed to help the completion provider determine
  // what to do.
  _handleExpressionParseError(category, errorMsg, targetToken, childNode, additionalStopTokens) {
    this._addSyntaxError(errorMsg, targetToken ?? this._peekToken());
    const stopTokens = [2 /* NewLine */];
    if (additionalStopTokens) {
      appendArray(stopTokens, additionalStopTokens);
    }
    const nextToken = this._peekToken();
    const initialRange = stopTokens.some((k) => nextToken.type === k) ? targetToken ?? childNode ?? TextRange.create(
      nextToken.start,
      /* length */
      0
    ) : nextToken;
    const expr = ErrorNode.create(initialRange, category, childNode);
    this._consumeTokensUntilType(stopTokens);
    return expr;
  }
  // lambdef: 'lambda' [varargslist] ':' test
  _parseLambdaExpression(allowConditional = true) {
    const lambdaToken = this._getKeywordToken(24 /* Lambda */);
    const argList = this._parseVarArgsList(
      10 /* Colon */,
      /* allowAnnotations */
      false
    );
    if (!this._consumeTokenIfType(10 /* Colon */)) {
      this._addSyntaxError(LocMessage.expectedColon(), this._peekToken());
    }
    let testExpr;
    if (allowConditional) {
      testExpr = this._parseTestExpression(
        /* allowAssignmentExpression */
        false
      );
    } else {
      testExpr = this._tryParseLambdaExpression(
        /* allowConditional */
        false
      ) || this._parseOrTest();
    }
    const lambdaNode = LambdaNode.create(lambdaToken, testExpr);
    lambdaNode.d.params = argList;
    argList.forEach((arg) => {
      arg.parent = lambdaNode;
    });
    return lambdaNode;
  }
  _tryParseLambdaExpression(allowConditional = true) {
    if (this._peekKeywordType() !== 24 /* Lambda */) {
      return void 0;
    }
    return this._parseLambdaExpression(allowConditional);
  }
  // ('(' [yield_expr | testlist_comp] ')'
  // testlist_comp: (test | star_expr) (comp_for | (',' (test | star_expr))* [','])
  _parseTupleAtom() {
    const startParen = this._getNextToken();
    assert(startParen.type === 13 /* OpenParenthesis */);
    const yieldExpr = this._tryParseYieldExpression();
    if (yieldExpr) {
      if (this._peekTokenType() !== 14 /* CloseParenthesis */) {
        return this._handleExpressionParseError(
          8 /* MissingTupleCloseParen */,
          LocMessage.expectedCloseParen(),
          startParen,
          yieldExpr
        );
      } else {
        extendRange(yieldExpr, this._getNextToken());
      }
      return yieldExpr;
    }
    const exprListResult = this._parseTestListWithComprehension(
      /* isGenerator */
      true
    );
    const tupleOrExpression = this._makeExpressionOrTuple(
      exprListResult,
      /* enclosedInParens */
      true
    );
    extendRange(tupleOrExpression, startParen);
    if (this._peekTokenType() !== 14 /* CloseParenthesis */) {
      return this._handleExpressionParseError(
        8 /* MissingTupleCloseParen */,
        LocMessage.expectedCloseParen(),
        startParen,
        exprListResult.parseError ?? tupleOrExpression
      );
    } else {
      extendRange(tupleOrExpression, this._getNextToken());
    }
    return tupleOrExpression;
  }
  // '[' [testlist_comp] ']'
  // testlist_comp: (test | star_expr) (comp_for | (',' (test | star_expr))* [','])
  _parseListAtom() {
    const startBracket = this._getNextToken();
    assert(startBracket.type === 15 /* OpenBracket */);
    const exprListResult = this._parseTestListWithComprehension(
      /* isGenerator */
      false
    );
    const closeBracket = this._peekToken();
    if (!this._consumeTokenIfType(16 /* CloseBracket */)) {
      return this._handleExpressionParseError(
        9 /* MissingListCloseBracket */,
        LocMessage.expectedCloseBracket(),
        startBracket,
        exprListResult.parseError ?? _createList()
      );
    }
    return _createList();
    function _createList() {
      const listAtom = ListNode.create(startBracket);
      if (closeBracket) {
        extendRange(listAtom, closeBracket);
      }
      if (exprListResult.list.length > 0) {
        exprListResult.list.forEach((expr) => {
          expr.parent = listAtom;
        });
        extendRange(listAtom, exprListResult.list[exprListResult.list.length - 1]);
      }
      listAtom.d.items = exprListResult.list;
      return listAtom;
    }
  }
  _parseTestListWithComprehension(isGenerator) {
    let sawComprehension = false;
    return this._parseExpressionListGeneric(
      () => {
        let expr = this._parseTestOrStarExpression(
          /* allowAssignmentExpression */
          true
        );
        const comprehension = this._tryParseComprehension(expr, isGenerator);
        if (comprehension) {
          expr = comprehension;
          sawComprehension = true;
        }
        return expr;
      },
      () => this._isNextTokenNeverExpression(),
      () => sawComprehension
    );
  }
  // '{' [dictorsetmaker] '}'
  // dictorsetmaker: (
  //    (dictentry (comp_for | (',' dictentry)* [',']))
  //    | (setentry (comp_for | (',' setentry)* [',']))
  // )
  // dictentry: (test ':' test | '**' expr)
  // setentry: test | star_expr
  _parseDictionaryOrSetAtom() {
    const startBrace = this._getNextToken();
    assert(startBrace.type === 17 /* OpenCurlyBrace */);
    const dictionaryEntries = [];
    const setEntries = [];
    let isDictionary = false;
    let isSet = false;
    let sawComprehension = false;
    let isFirstEntry = true;
    let trailingCommaToken;
    while (true) {
      if (this._peekTokenType() === 18 /* CloseCurlyBrace */) {
        break;
      }
      trailingCommaToken = void 0;
      let doubleStarExpression;
      let keyExpression;
      let valueExpression;
      const doubleStar = this._peekToken();
      if (this._consumeTokenIfOperator(29 /* Power */)) {
        doubleStarExpression = this._parseExpression(
          /* allowUnpack */
          false
        );
      } else {
        const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
        this._isParsingTypeAnnotation = false;
        keyExpression = this._parseTestOrStarExpression(
          /* allowAssignmentExpression */
          true
        );
        this._isParsingTypeAnnotation = wasParsingTypeAnnotation;
        let isWalrusAllowed = PythonVersion.isGreaterOrEqualTo(this._getLanguageVersion(), pythonVersion3_10);
        if (this._consumeTokenIfType(10 /* Colon */)) {
          valueExpression = this._parseTestExpression(
            /* allowAssignmentExpression */
            false
          );
          isWalrusAllowed = false;
        }
        if (!isWalrusAllowed && keyExpression.nodeType === 4 /* AssignmentExpression */ && !keyExpression.d.hasParens) {
          this._addSyntaxError(LocMessage.walrusNotAllowed(), keyExpression.d.walrusToken);
        }
      }
      if (keyExpression && valueExpression) {
        if (keyExpression.nodeType === 56 /* Unpack */) {
          this._addSyntaxError(LocMessage.unpackInDict(), keyExpression);
        }
        if (isSet) {
          this._addSyntaxError(LocMessage.keyValueInSet(), valueExpression);
        } else {
          const keyEntryNode = DictionaryKeyEntryNode.create(
            keyExpression,
            valueExpression
          );
          let dictEntry = keyEntryNode;
          const comprehension = this._tryParseComprehension(
            keyEntryNode,
            /* isGenerator */
            false
          );
          if (comprehension) {
            dictEntry = comprehension;
            sawComprehension = true;
            if (!isFirstEntry) {
              this._addSyntaxError(LocMessage.comprehensionInDict(), dictEntry);
            }
          }
          dictionaryEntries.push(dictEntry);
          isDictionary = true;
        }
      } else if (doubleStarExpression) {
        if (isSet) {
          this._addSyntaxError(LocMessage.unpackInSet(), doubleStarExpression);
        } else {
          const listEntryNode = DictionaryExpandEntryNode.create(doubleStarExpression);
          extendRange(listEntryNode, doubleStar);
          let expandEntryNode = listEntryNode;
          const comprehension = this._tryParseComprehension(
            listEntryNode,
            /* isGenerator */
            false
          );
          if (comprehension) {
            expandEntryNode = comprehension;
            sawComprehension = true;
            if (!isFirstEntry) {
              this._addSyntaxError(LocMessage.comprehensionInDict(), doubleStarExpression);
            }
          }
          dictionaryEntries.push(expandEntryNode);
          isDictionary = true;
        }
      } else {
        assert(keyExpression !== void 0);
        if (keyExpression) {
          if (isDictionary) {
            const missingValueErrorNode = ErrorNode.create(
              this._peekToken(),
              13 /* MissingDictValue */
            );
            const keyEntryNode = DictionaryKeyEntryNode.create(
              keyExpression,
              missingValueErrorNode
            );
            dictionaryEntries.push(keyEntryNode);
            this._addSyntaxError(LocMessage.dictKeyValuePairs(), keyExpression);
          } else {
            const comprehension = this._tryParseComprehension(
              keyExpression,
              /* isGenerator */
              false
            );
            if (comprehension) {
              keyExpression = comprehension;
              sawComprehension = true;
              if (!isFirstEntry) {
                this._addSyntaxError(LocMessage.comprehensionInSet(), keyExpression);
              }
            }
            setEntries.push(keyExpression);
            isSet = true;
          }
        }
      }
      if (sawComprehension) {
        break;
      }
      if (this._peekTokenType() !== 12 /* Comma */) {
        break;
      }
      trailingCommaToken = this._getNextToken();
      isFirstEntry = false;
    }
    let closeCurlyBrace = this._peekToken();
    if (!this._consumeTokenIfType(18 /* CloseCurlyBrace */)) {
      this._addSyntaxError(LocMessage.expectedCloseBrace(), startBrace);
      closeCurlyBrace = void 0;
    }
    if (isSet) {
      const setAtom = SetNode.create(startBrace);
      if (closeCurlyBrace) {
        extendRange(setAtom, closeCurlyBrace);
      }
      if (setEntries.length > 0) {
        extendRange(setAtom, setEntries[setEntries.length - 1]);
      }
      setEntries.forEach((entry) => {
        entry.parent = setAtom;
      });
      setAtom.d.items = setEntries;
      return setAtom;
    }
    const dictionaryAtom = DictionaryNode.create(startBrace);
    if (trailingCommaToken) {
      extendRange(dictionaryAtom, trailingCommaToken);
    }
    if (closeCurlyBrace) {
      extendRange(dictionaryAtom, closeCurlyBrace);
    }
    if (dictionaryEntries.length > 0) {
      dictionaryEntries.forEach((entry) => {
        entry.parent = dictionaryAtom;
      });
      extendRange(dictionaryAtom, dictionaryEntries[dictionaryEntries.length - 1]);
    }
    dictionaryAtom.d.items = dictionaryEntries;
    return dictionaryAtom;
  }
  _parseExpressionListGeneric(parser, terminalCheck = () => this._isNextTokenNeverExpression(), finalEntryCheck = () => false) {
    let trailingComma = false;
    const list = [];
    let parseError;
    while (true) {
      if (terminalCheck()) {
        break;
      }
      const expr = parser();
      if (expr.nodeType === 0 /* Error */) {
        parseError = expr;
        break;
      }
      list.push(expr);
      if (finalEntryCheck()) {
        break;
      }
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        trailingComma = false;
        break;
      }
      trailingComma = true;
    }
    return { trailingComma, list, parseError };
  }
  // expr_stmt: testlist_star_expr (annassign | augassign (yield_expr | testlist) |
  //                     ('=' (yield_expr | testlist_star_expr))*)
  // testlist_star_expr: (test|star_expr) (',' (test|star_expr))* [',']
  // annassign: ':' test ['=' (yield_expr | testlist_star_expr)]
  // augassign: ('+=' | '-=' | '*=' | '@=' | '/=' | '%=' | '&=' | '|=' | '^=' |
  //             '<<=' | '>>=' | '**=' | '//=')
  _parseExpressionStatement() {
    let leftExpr = this._parseTestOrStarListAsExpression(
      /* allowAssignmentExpression */
      false,
      /* allowMultipleUnpack */
      false,
      2 /* MissingExpression */,
      () => LocMessage.expectedExpr()
    );
    let annotationExpr;
    if (leftExpr.nodeType === 0 /* Error */) {
      return leftExpr;
    }
    if (this._consumeTokenIfType(10 /* Colon */)) {
      annotationExpr = this._parseTypeAnnotation();
      leftExpr = TypeAnnotationNode.create(leftExpr, annotationExpr);
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_6)) {
        this._addSyntaxError(LocMessage.varAnnotationIllegal(), annotationExpr);
      }
      if (!this._consumeTokenIfOperator(2 /* Assign */)) {
        return leftExpr;
      }
      const isTypeAliasDeclaration = this._isTypingAnnotation(annotationExpr, "TypeAlias");
      const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
      if (isTypeAliasDeclaration) {
        this._isParsingTypeAnnotation = true;
      }
      const rightExpr = this._tryParseYieldExpression() ?? this._parseTestOrStarListAsExpression(
        /* allowAssignmentExpression */
        false,
        /* allowMultipleUnpack */
        true,
        2 /* MissingExpression */,
        () => LocMessage.expectedAssignRightHandExpr()
      );
      this._isParsingTypeAnnotation = wasParsingTypeAnnotation;
      return AssignmentNode.create(leftExpr, rightExpr);
    }
    if (this._consumeTokenIfOperator(2 /* Assign */)) {
      return this._parseChainAssignments(leftExpr);
    }
    if (Tokenizer.isOperatorAssignment(this._peekOperatorType())) {
      const operatorToken = this._getNextToken();
      const rightExpr = this._tryParseYieldExpression() ?? this._parseTestOrStarListAsExpression(
        /* allowAssignmentExpression */
        false,
        /* allowMultipleUnpack */
        true,
        2 /* MissingExpression */,
        () => LocMessage.expectedBinaryRightHandExpr()
      );
      this._reportConditionalErrorForStarTupleElement(rightExpr, pythonVersion3_9);
      const destExpr = Object.assign({}, leftExpr);
      destExpr.id = getNextNodeId();
      return AugmentedAssignmentNode.create(
        leftExpr,
        rightExpr,
        operatorToken.operatorType,
        destExpr
      );
    }
    return leftExpr;
  }
  _parseChainAssignments(leftExpr) {
    const assignmentTargets = [leftExpr];
    let rightExpr;
    while (true) {
      rightExpr = this._tryParseYieldExpression() ?? this._parseTestOrStarListAsExpression(
        /* allowAssignmentExpression */
        false,
        /* allowMultipleUnpack */
        true,
        2 /* MissingExpression */,
        () => LocMessage.expectedAssignRightHandExpr()
      );
      if (rightExpr.nodeType === 0 /* Error */) {
        break;
      }
      if (!this._consumeTokenIfOperator(2 /* Assign */)) {
        break;
      }
      assignmentTargets.push(rightExpr);
    }
    let assignmentNode = AssignmentNode.create(assignmentTargets[0], rightExpr);
    const typeAnnotationComment = this._parseVariableTypeAnnotationComment();
    if (typeAnnotationComment) {
      if (assignmentTargets.length > 1) {
        assignmentNode.d.chainedAnnotationComment = typeAnnotationComment;
      } else {
        assignmentNode.d.annotationComment = typeAnnotationComment;
        assignmentNode.d.annotationComment.parent = assignmentNode;
        extendRange(assignmentNode, assignmentNode.d.annotationComment);
      }
    }
    assignmentTargets.forEach((target, index) => {
      if (index > 0) {
        assignmentNode = AssignmentNode.create(target, assignmentNode);
      }
    });
    return assignmentNode;
  }
  _parseFunctionTypeAnnotation() {
    const openParenToken = this._peekToken();
    if (!this._consumeTokenIfType(13 /* OpenParenthesis */)) {
      this._addSyntaxError(LocMessage.expectedOpenParen(), this._peekToken());
      return void 0;
    }
    let paramAnnotations = [];
    while (true) {
      const nextTokenType = this._peekTokenType();
      if (nextTokenType === 14 /* CloseParenthesis */ || nextTokenType === 2 /* NewLine */ || nextTokenType === 1 /* EndOfStream */) {
        break;
      }
      this._consumeTokenIfOperator(26 /* Multiply */) || this._consumeTokenIfOperator(29 /* Power */);
      const paramAnnotation = this._parseTypeAnnotation();
      paramAnnotations.push(paramAnnotation);
      if (!this._consumeTokenIfType(12 /* Comma */)) {
        break;
      }
    }
    if (!this._consumeTokenIfType(14 /* CloseParenthesis */)) {
      this._addSyntaxError(LocMessage.expectedCloseParen(), openParenToken);
      this._consumeTokensUntilType([10 /* Colon */]);
    }
    if (!this._consumeTokenIfType(21 /* Arrow */)) {
      this._addSyntaxError(LocMessage.expectedArrow(), this._peekToken());
      return void 0;
    }
    const returnType = this._parseTypeAnnotation();
    let isParamListEllipsis = false;
    if (paramAnnotations.length === 1 && paramAnnotations[0].nodeType === 21 /* Ellipsis */) {
      paramAnnotations = [];
      isParamListEllipsis = true;
    }
    return FunctionAnnotationNode.create(
      openParenToken,
      isParamListEllipsis,
      paramAnnotations,
      returnType
    );
  }
  _parseTypeAnnotation(allowUnpack = false) {
    const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
    this._isParsingTypeAnnotation = true;
    const startToken = this._peekToken();
    const isUnpack = this._consumeTokenIfOperator(26 /* Multiply */);
    if (isUnpack && allowUnpack && !this._isParsingQuotedText && PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_11)) {
      this._addSyntaxError(LocMessage.unpackedSubscriptIllegal(), startToken);
    }
    let result = this._parseTestExpression(
      /* allowAssignmentExpression */
      false
    );
    if (isUnpack) {
      result = UnpackNode.create(startToken, result);
    }
    this._isParsingTypeAnnotation = wasParsingTypeAnnotation;
    return result;
  }
  _reportStringTokenErrors(stringToken, unescapedResult) {
    if (stringToken.flags & 65536 /* Unterminated */) {
      this._addSyntaxError(LocMessage.stringUnterminated(), stringToken);
    }
    if (unescapedResult?.nonAsciiInBytes) {
      this._addSyntaxError(LocMessage.stringNonAsciiBytes(), stringToken);
    }
    if (stringToken.flags & 64 /* Format */) {
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_6)) {
        this._addSyntaxError(LocMessage.formatStringIllegal(), stringToken);
      }
      if (stringToken.flags & 32 /* Bytes */) {
        this._addSyntaxError(LocMessage.formatStringBytes(), stringToken);
      }
      if (stringToken.flags & 16 /* Unicode */) {
        this._addSyntaxError(LocMessage.formatStringUnicode(), stringToken);
      }
      if (stringToken.flags & 128 /* Template */) {
        this._addSyntaxError(LocMessage.formatStringTemplate(), stringToken);
      }
    }
    if (stringToken.flags & 128 /* Template */) {
      if (PythonVersion.isLessThan(this._getLanguageVersion(), pythonVersion3_14)) {
        this._addSyntaxError(LocMessage.templateStringIllegal(), stringToken);
      }
      if (stringToken.flags & 32 /* Bytes */) {
        this._addSyntaxError(LocMessage.templateStringBytes(), stringToken);
      }
      if (stringToken.flags & 16 /* Unicode */) {
        this._addSyntaxError(LocMessage.templateStringUnicode(), stringToken);
      }
    }
  }
  _makeStringNode(stringToken) {
    const unescapedResult = getUnescapedString(stringToken);
    this._reportStringTokenErrors(stringToken, unescapedResult);
    return StringNode.create(stringToken, unescapedResult.value);
  }
  _getTypeAnnotationCommentText() {
    if (this._tokenIndex === 0) {
      return void 0;
    }
    const curToken = this._tokenizerOutput.tokens.getItemAt(this._tokenIndex - 1);
    const nextToken = this._tokenizerOutput.tokens.getItemAt(this._tokenIndex);
    if (curToken.start + curToken.length === nextToken.start) {
      return void 0;
    }
    const interTokenContents = this._fileContents.slice(curToken.start + curToken.length, nextToken.start);
    const match = interTokenContents.match(commentRegEx);
    if (!match) {
      return void 0;
    }
    const typeString = match[2];
    if (typeString.trim().match(ignoreCommentRegEx)) {
      return void 0;
    }
    const tokenOffset = curToken.start + curToken.length + match[1].length;
    return StringToken.create(
      tokenOffset,
      typeString.length,
      0 /* None */,
      typeString,
      0
    );
  }
  _parseVariableTypeAnnotationComment() {
    const stringToken = this._getTypeAnnotationCommentText();
    if (!stringToken) {
      return void 0;
    }
    const stringNode = this._makeStringNode(stringToken);
    const stringListNode = StringListNode.create([stringNode]);
    const parseResults = this._parseTypeComment(stringToken, (parser) => parser._parseTypeAnnotation());
    parseResults.diagnostics.forEach((diag) => {
      this._addSyntaxError(diag.message, stringListNode);
    });
    return parseResults.parseTree;
  }
  _parseFunctionTypeAnnotationComment(stringToken, functionNode) {
    const stringNode = this._makeStringNode(stringToken);
    const stringListNode = StringListNode.create([stringNode]);
    const parseResults = this._parseTypeComment(stringToken, (parser) => parser._parseFunctionTypeAnnotation());
    parseResults.diagnostics.forEach((diag) => {
      this._addSyntaxError(diag.message, stringListNode);
    });
    const functionAnnotation = parseResults.parseTree;
    if (!functionAnnotation) {
      return;
    }
    functionNode.d.funcAnnotationComment = functionAnnotation;
    functionAnnotation.parent = functionNode;
    extendRange(functionNode, functionAnnotation);
  }
  _parseFStringReplacementField(fieldExpressions, middleTokens, formatExpressions, nestingDepth = 0) {
    let nextToken = this._getNextToken();
    assert(nextToken.type === 17 /* OpenCurlyBrace */);
    const expr = this._tryParseYieldExpression() ?? this._parseTestOrStarListAsExpression(
      /* allowAssignmentExpression */
      true,
      /* allowMultipleUnpack */
      true,
      2 /* MissingExpression */,
      () => LocMessage.expectedExpr()
    );
    fieldExpressions.push(expr);
    if (expr.nodeType === 0 /* Error */) {
      return false;
    }
    nextToken = this._peekToken();
    if (nextToken.type === 9 /* Operator */ && nextToken.operatorType === 2 /* Assign */) {
      if (PythonVersion.isLessThan(this._parseOptions.pythonVersion, pythonVersion3_8)) {
        this._addSyntaxError(LocMessage.formatStringDebuggingIllegal(), nextToken);
      }
      this._getNextToken();
      nextToken = this._peekToken();
    }
    if (nextToken.type === 23 /* ExclamationMark */) {
      this._getNextToken();
      nextToken = this._peekToken();
      if (nextToken.type !== 7 /* Identifier */) {
        this._addSyntaxError(LocMessage.formatStringExpectedConversion(), nextToken);
      } else {
        this._getNextToken();
        nextToken = this._peekToken();
      }
    }
    if (nextToken.type === 10 /* Colon */) {
      this._getNextToken();
      this._parseFStringFormatString(fieldExpressions, middleTokens, formatExpressions, nestingDepth);
      nextToken = this._peekToken();
    }
    if (nextToken.type !== 18 /* CloseCurlyBrace */) {
      this._addSyntaxError(LocMessage.formatStringUnterminated(), nextToken);
      return false;
    } else {
      this._getNextToken();
    }
    return true;
  }
  _parseFStringFormatString(fieldExpressions, middleTokens, formatExpressions, nestingDepth) {
    while (true) {
      const nextToken = this._peekToken();
      if (nextToken.type === 18 /* CloseCurlyBrace */ || nextToken.type === 26 /* FStringEnd */) {
        break;
      }
      if (nextToken.type === 25 /* FStringMiddle */) {
        this._getNextToken();
        continue;
      }
      if (nextToken.type === 17 /* OpenCurlyBrace */) {
        if (nestingDepth === 2) {
          this._addSyntaxError(LocMessage.formatStringNestedFormatSpecifier(), nextToken);
        }
        this._parseFStringReplacementField(fieldExpressions, middleTokens, formatExpressions, nestingDepth + 1);
        continue;
      }
      break;
    }
  }
  _parseFormatString(startToken) {
    const middleTokens = [];
    const fieldExpressions = [];
    const formatExpressions = [];
    let endToken = void 0;
    while (true) {
      const nextToken = this._peekToken();
      if (nextToken.type === 26 /* FStringEnd */) {
        endToken = nextToken;
        if ((endToken.flags & 65536 /* Unterminated */) !== 0) {
          this._addSyntaxError(LocMessage.stringUnterminated(), startToken);
        }
        this._getNextToken();
        break;
      }
      if (nextToken.type === 25 /* FStringMiddle */) {
        middleTokens.push(nextToken);
        this._getNextToken();
        continue;
      }
      if (nextToken.type === 17 /* OpenCurlyBrace */) {
        if (!this._parseFStringReplacementField(fieldExpressions, middleTokens, formatExpressions)) {
          if (this._consumeTokensUntilType([26 /* FStringEnd */, 2 /* NewLine */])) {
            if (this._peekToken().type === 26 /* FStringEnd */) {
              this._getNextToken();
            }
          }
          break;
        }
        continue;
      }
      if (nextToken.type !== 2 /* NewLine */) {
        if (this._consumeTokensUntilType([26 /* FStringEnd */])) {
          this._getNextToken();
        }
      }
      this._addSyntaxError(
        nextToken.type === 18 /* CloseCurlyBrace */ ? LocMessage.formatStringBrace() : LocMessage.stringUnterminated(),
        nextToken
      );
      break;
    }
    this._reportStringTokenErrors(startToken);
    return FormatStringNode.create(
      startToken,
      endToken,
      middleTokens,
      fieldExpressions,
      formatExpressions
    );
  }
  _createBinaryOperationNode(leftExpression, rightExpression, operatorToken, operator) {
    const binaryNode = BinaryOperationNode.create(
      leftExpression,
      rightExpression,
      operatorToken,
      operator
    );
    const leftMaxDepth = this._maxChildDepthMap.get(leftExpression.id) ?? 0;
    const rightMaxDepth = this._maxChildDepthMap.get(rightExpression.id) ?? 0;
    if (leftMaxDepth >= maxChildNodeDepth || rightMaxDepth >= maxChildNodeDepth) {
      this._addSyntaxError(LocMessage.maxParseDepthExceeded(), binaryNode);
      return ErrorNode.create(binaryNode, 15 /* MaxDepthExceeded */);
    }
    this._maxChildDepthMap.set(binaryNode.id, Math.max(leftMaxDepth, rightMaxDepth) + 1);
    return binaryNode;
  }
  _createUnaryOperationNode(operatorToken, expression, operator) {
    const unaryNode = UnaryOperationNode.create(operatorToken, expression, operator);
    const maxDepth = this._maxChildDepthMap.get(expression.id) ?? 0;
    if (maxDepth >= maxChildNodeDepth) {
      this._addSyntaxError(LocMessage.maxParseDepthExceeded(), unaryNode);
      return ErrorNode.create(unaryNode, 15 /* MaxDepthExceeded */);
    }
    this._maxChildDepthMap.set(unaryNode.id, maxDepth + 1);
    return unaryNode;
  }
  _parseStringList() {
    const stringList = [];
    while (true) {
      const nextToken = this._peekToken();
      if (nextToken.type === 5 /* String */) {
        stringList.push(this._makeStringNode(this._getNextToken()));
      } else if (nextToken.type === 24 /* FStringStart */) {
        stringList.push(this._parseFormatString(this._getNextToken()));
      } else {
        break;
      }
    }
    const stringNode = StringListNode.create(stringList);
    if (this._isParsingTypeAnnotation && this._isParsingQuotedText) {
      if (stringList.length > 1) {
        this._addSyntaxError(LocMessage.annotationSpansStrings(), stringNode);
      } else if (stringList[0].nodeType === 30 /* FormatString */) {
        this._addSyntaxError(LocMessage.annotationFormatString(), stringNode);
      } else {
        const token = stringList[0].d.token;
        const value = getUnescapedString(
          token,
          /* elideCrlf */
          false
        ).value;
        if (value.length !== token.length - token.prefixLength - 2 * token.quoteMarkLength) {
          this._addSyntaxError(LocMessage.annotationStringEscape(), stringNode);
        }
      }
    }
    return stringNode;
  }
  // Python 3.8 added support for star (unpack) expressions in tuples
  // following a return or yield statement in cases where the tuple
  // wasn't surrounded in parentheses.
  _reportConditionalErrorForStarTupleElement(possibleTupleExpr, pythonVersion = pythonVersion3_8) {
    if (possibleTupleExpr.nodeType !== 52 /* Tuple */) {
      return;
    }
    if (possibleTupleExpr.d.hasParens) {
      return;
    }
    if (PythonVersion.isGreaterOrEqualTo(this._parseOptions.pythonVersion, pythonVersion)) {
      return;
    }
    for (const expr of possibleTupleExpr.d.items) {
      if (expr.nodeType === 56 /* Unpack */) {
        this._addSyntaxError(LocMessage.unpackTuplesIllegal(), expr);
        return;
      }
    }
  }
  // Peeks at the next token and returns true if it can never
  // represent the start of an expression.
  _isNextTokenNeverExpression() {
    const nextToken = this._peekToken();
    switch (nextToken.type) {
      case 8 /* Keyword */: {
        switch (this._peekKeywordType()) {
          case 17 /* For */:
          case 22 /* In */:
          case 20 /* If */:
            return true;
        }
        break;
      }
      case 9 /* Operator */: {
        switch (this._peekOperatorType()) {
          case 1 /* AddEqual */:
          case 34 /* SubtractEqual */:
          case 27 /* MultiplyEqual */:
          case 11 /* DivideEqual */:
          case 25 /* ModEqual */:
          case 4 /* BitwiseAndEqual */:
          case 7 /* BitwiseOrEqual */:
          case 9 /* BitwiseXorEqual */:
          case 18 /* LeftShiftEqual */:
          case 32 /* RightShiftEqual */:
          case 30 /* PowerEqual */:
          case 14 /* FloorDivideEqual */:
          case 2 /* Assign */:
            return true;
        }
        break;
      }
      case 3 /* Indent */:
      case 4 /* Dedent */:
      case 2 /* NewLine */:
      case 1 /* EndOfStream */:
      case 11 /* Semicolon */:
      case 14 /* CloseParenthesis */:
      case 16 /* CloseBracket */:
      case 18 /* CloseCurlyBrace */:
      case 12 /* Comma */:
      case 10 /* Colon */:
      case 23 /* ExclamationMark */:
      case 25 /* FStringMiddle */:
      case 26 /* FStringEnd */:
        return true;
    }
    return false;
  }
  _disallowAssignmentExpression(callback) {
    const wasAllowed = this._assignmentExpressionsAllowed;
    this._assignmentExpressionsAllowed = false;
    callback();
    this._assignmentExpressionsAllowed = wasAllowed;
  }
  _getNextToken() {
    const token = this._tokens.getItemAt(this._tokenIndex);
    if (!this._atEof()) {
      this._tokenIndex++;
    }
    return token;
  }
  _atEof() {
    return this._tokenIndex >= this._tokenCount - 1;
  }
  _peekToken(count = 0) {
    const targetIndex = this._tokenIndex + count;
    if (targetIndex < 0) {
      return this._tokens.getItemAt(0);
    }
    if (targetIndex >= this._tokenCount) {
      return this._tokens.getItemAt(this._tokenCount - 1);
    }
    return this._tokens.getItemAt(targetIndex);
  }
  _peekTokenType() {
    return this._peekToken().type;
  }
  _peekKeywordType() {
    const nextToken = this._peekToken();
    if (nextToken.type !== 8 /* Keyword */) {
      return void 0;
    }
    return nextToken.keywordType;
  }
  _peekOperatorType() {
    const nextToken = this._peekToken();
    if (nextToken.type !== 9 /* Operator */) {
      return void 0;
    }
    return nextToken.operatorType;
  }
  _getTokenIfIdentifier() {
    const nextToken = this._peekToken();
    if (nextToken.type === 7 /* Identifier */) {
      return this._getNextToken();
    }
    if (nextToken.type === 0 /* Invalid */) {
      this._getNextToken();
      this._addSyntaxError(LocMessage.invalidIdentifierChar(), nextToken);
      return IdentifierToken.create(nextToken.start, nextToken.length, "");
    }
    if (nextToken.type === 8 /* Keyword */) {
      const keywordToken = nextToken;
      if (KeywordToken.isSoftKeyword(keywordToken)) {
        const keywordText = this._fileContents.substr(nextToken.start, nextToken.length);
        this._getNextToken();
        return IdentifierToken.create(nextToken.start, nextToken.length, keywordText);
      }
    }
    return void 0;
  }
  // Consumes tokens until the next one in the stream is
  // either a specified terminator or the end-of-stream
  // token.
  _consumeTokensUntilType(terminators) {
    while (true) {
      const token = this._peekToken();
      if (terminators.some((term) => term === token.type)) {
        return true;
      }
      if (token.type === 1 /* EndOfStream */) {
        return false;
      }
      this._getNextToken();
    }
  }
  _getTokenIfType(tokenType) {
    if (this._peekTokenType() === tokenType) {
      return this._getNextToken();
    }
    return void 0;
  }
  _consumeTokenIfType(tokenType) {
    return !!this._getTokenIfType(tokenType);
  }
  _consumeTokenIfKeyword(keywordType) {
    if (this._peekKeywordType() === keywordType) {
      this._getNextToken();
      return true;
    }
    return false;
  }
  _consumeTokenIfOperator(operatorType) {
    if (this._peekOperatorType() === operatorType) {
      this._getNextToken();
      return true;
    }
    return false;
  }
  _getKeywordToken(keywordType) {
    const keywordToken = this._getNextToken();
    assert(keywordToken.type === 8 /* Keyword */);
    assert(keywordToken.keywordType === keywordType);
    return keywordToken;
  }
  _getLanguageVersion() {
    return this._parseOptions.pythonVersion;
  }
  _suppressErrors(callback) {
    const errorsWereSuppressed = this._areErrorsSuppressed;
    try {
      this._areErrorsSuppressed = true;
      callback();
    } finally {
      this._areErrorsSuppressed = errorsWereSuppressed;
    }
  }
  _addSyntaxError(message, range) {
    assert(range !== void 0);
    if (!this._areErrorsSuppressed) {
      this._diagSink.addError(
        message,
        convertOffsetsToRange(range.start, range.start + range.length, this._tokenizerOutput.lines)
      );
    }
  }
};

// extract/py/upstream/parser/stringVersionChecks.ts
function validateStringVersion(node, lines, sink) {
  if (node.nodeType !== 48 /* StringList */) return;
  const containers = [];
  for (let current = node; current; current = current.parent)
    if (current.nodeType === 30 /* FormatString */) containers.push(current);
  if (!containers.length) return;
  for (const string of node.d.strings) {
    const tokens = string.nodeType === 49 /* String */ ? [string.d.token] : string.d.middleTokens;
    for (const token of tokens) {
      if (token.escapedValue.includes("\\")) {
        const start = token.start + (token.type === 5 /* String */ ? token.prefixLength + token.quoteMarkLength : 0);
        sink.addError("An f-string expression cannot include a backslash before Python 3.12", convertOffsetsToRange(start, start + 1, lines));
      }
    }
    const mask = 1 /* SingleQuote */ | 2 /* DoubleQuote */ | 4 /* Triplicate */;
    if (containers.some((container) => (container.d.token.flags & mask) === (string.d.token.flags & mask)))
      sink.addError("An f-string expression cannot reuse the enclosing quote before Python 3.12", convertOffsetsToRange(string.start, string.start + string.length, lines));
  }
}

// extract/py/syntax.ts
function parsePython(text, targetVersion = "3.14") {
  if (!/^3\.(?:[8-9]|1[0-4])$/.test(targetVersion)) throw new Error(`Unsupported target Python version: ${targetVersion}`);
  const options = new ParseOptions();
  options.pythonVersion = PythonVersion.create(...targetVersion.split(".").map(Number));
  const sink = new DiagnosticSink();
  const { parseTree, tokenizerOutput: { tokens, lines } } = new Parser().parseSourceFile(text, options, sink);
  if (Number(targetVersion.split(".")[1]) < 12)
    for (const node of walk(parseTree)) validateStringVersion(node, lines, sink);
  const errors = sink.fetchAndClear().filter((error) => error.category === 0 /* Error */);
  return { parseTree, tokens, errors };
}
function children(node) {
  const out = [];
  const append = (value) => {
    if (Array.isArray(value)) {
      for (const child of value) append(child);
    } else if (value && typeof value === "object" && "nodeType" in value && "start" in value) out.push(value);
  };
  for (const [key, value] of Object.entries(node.d))
    if (!["annotationComment", "chainedAnnotationComment", "funcAnnotationComment"].includes(key)) append(value);
  return out;
}
function* walk(node) {
  const pending = [node];
  while (pending.length) {
    const current = pending.pop();
    yield current;
    const next = children(current);
    for (let i = next.length - 1; i >= 0; i--) pending.push(next[i]);
  }
}

// extract/py/facts.ts
import { createHash } from "node:crypto";

// core/source-decoding.mjs
var PYTHON_CODECS = { utf_8: "utf-8", utf8: "utf-8", "utf-8": "utf-8", utf_8_sig: "utf-8", "utf-8-sig": "utf-8" };
var CP1252_HIGH = [8364, 65533, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 65533, 381, 65533, 65533, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 65533, 382, 376];
var CP1252_ALIASES = /* @__PURE__ */ new Set(["cp1252", "windows_1252", "1252"]);
function decodeCp1252(buffer, strict) {
  let out = "";
  for (const byte of buffer) {
    const code = byte >= 128 && byte < 160 ? CP1252_HIGH[byte - 128] : byte;
    if (strict && code === 65533) throw new Error("undefined cp1252 source byte");
    out += String.fromCharCode(code);
  }
  return out;
}
var LATIN1_ALIASES = /* @__PURE__ */ new Set(["latin_1", "latin1", "latin", "l1", "iso_8859_1", "iso8859_1", "8859", "cp819", "iso_latin_1", "iso_ir_100", "csisolatin1"]);
function isLatin1(declared) {
  const name = declared.replace(/[-\s.]/g, "_");
  return LATIN1_ALIASES.has(name) || /^(latin_1|iso_8859_1|iso_latin_1)_/.test(name);
}
function decodeSource(buffer, rel, { strict = false } = {}) {
  if (!/\.pyi?$/i.test(rel)) return buffer.toString("utf8");
  const bom = buffer[0] === 239 && buffer[1] === 187 && buffer[2] === 191;
  if (bom) buffer = buffer.subarray(3);
  const head = buffer.toString("latin1").split(/\r\n|\r|\n/, 2);
  let declared = null;
  for (const line of head) {
    const match = line.match(/^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/);
    if (match) {
      declared = match[1].toLowerCase();
      break;
    }
    if (!/^[ \t\f]*(#.*)?$/.test(line)) break;
  }
  if (!declared) return new TextDecoder("utf-8", { fatal: strict }).decode(buffer);
  if (bom && strict && !/^utf[-_]?8(?:[-_]sig)?$/.test(declared)) throw new Error("UTF-8 BOM disagrees with coding cookie");
  if (isLatin1(declared)) return buffer.toString("latin1");
  if (CP1252_ALIASES.has(declared.replace(/[-\s.]/g, "_"))) return decodeCp1252(buffer, strict);
  const label = PYTHON_CODECS[declared] || PYTHON_CODECS[declared.replace(/-/g, "_")] || declared.replace(/_/g, "-");
  if (strict && /^(ascii|us-ascii|us_ascii)$/.test(label) && buffer.some((byte) => byte > 127)) throw new Error("non-ASCII source byte");
  try {
    return new TextDecoder(label, { fatal: strict }).decode(buffer);
  } catch (error) {
    if (strict) throw error;
    return buffer.toString("utf8");
  }
}

// extract/py/facts.ts
var body = (node) => node.d.statements || (node.d.suite ? body(node.d.suite) : []);
var nameOf = (node) => node?.nodeType === 38 /* Name */ ? node.d.value : void 0;
var moduleName = (node) => (node.d.nameParts || []).map((part) => nameOf(part)).join(".");
var endOf = (node) => node.start + node.length;
function sourceContext(text, parsed) {
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
  const point = (offset) => {
    let low = 0, high = starts.length;
    while (low + 1 < high) {
      const middle = low + high >>> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
  const range = (start, end, digest = false) => ({
    ...point(start),
    endLine: point(end).line,
    endColumn: point(end).column,
    ...digest ? { sha256: createHash("sha256").update(text.slice(start, end)).digest("hex") } : {}
  });
  const tokenIndex = /* @__PURE__ */ new Map();
  const { tokens } = parsed;
  for (let index = 0; index < tokens.count; index++) tokenIndex.set(tokens.getItemAt(index).start, index);
  const functionStart = (node) => {
    const index = tokenIndex.get(node.d.firstToken.start);
    return node.d.isAsync && index > 0 ? tokens.getItemAt(index - 1).start : node.d.firstToken.start;
  };
  return { text, point, range, functionStart };
}
function irrefutable(pattern) {
  const d = pattern.d;
  if (pattern.nodeType === 69 /* PatternCapture */) return true;
  if (pattern.nodeType === 66 /* PatternAs */) return !d.target && d.orPatterns?.length === 1 && irrefutable(d.orPatterns[0]);
  return false;
}
function measureFunction(node, context) {
  let complexity = 1, nesting = 0, deepestLine = context.point(context.functionStart(node)).line;
  const pending = body(node).map((current) => ({ current, depth: 0, parent: node.d.suite })).reverse();
  while (pending.length) {
    const { current, depth, parent } = pending.pop();
    if ([31 /* Function */, 10 /* Class */].includes(current.nodeType)) continue;
    const d = current.d;
    if ([22 /* If */, 29 /* For */, 57 /* While */, 28 /* Except */, 51 /* Ternary */, 12 /* ComprehensionFor */, 13 /* ComprehensionIf */].includes(current.nodeType)) complexity++;
    if (current.nodeType === 7 /* BinaryOperation */ && [36 /* And */, 37 /* Or */].includes(d.operator)) complexity++;
    if (current.nodeType === 64 /* Case */ && (d.guardExpr || !irrefutable(d.pattern))) complexity++;
    let nextDepth = depth;
    if ([22 /* If */, 29 /* For */, 57 /* While */, 58 /* With */, 53 /* Try */, 63 /* Match */].includes(current.nodeType)) {
      const elif = current.nodeType === 22 /* If */ && parent?.nodeType === 22 /* If */ && parent.d.elseSuite === current;
      nextDepth = elif ? depth : depth + 1;
      if (nextDepth > nesting) {
        nesting = nextDepth;
        deepestLine = context.point(current.start).line;
      }
    }
    for (const child of children(current).reverse()) pending.push({ current: child, depth: nextDepth, parent: current });
  }
  return { complexity, nesting, deepestLine };
}
function functionFacts(tree, context) {
  const facts = [];
  const byNode = /* @__PURE__ */ new Map();
  const pending = [{ node: tree, prefix: "" }];
  while (pending.length) {
    const { node, prefix } = pending.pop();
    const d = node.d;
    if (node.nodeType === 31 /* Function */) {
      const fn = node;
      const start = context.functionStart(fn), end = endOf(node);
      const sourceRange = context.range(start, end, true);
      const fact = {
        name: d.name.d.value,
        qualname: prefix + d.name.d.value,
        line: sourceRange.line,
        endLine: sourceRange.endLine,
        sourceRange,
        definition: { kind: d.isAsync ? "AsyncFunctionDef" : "FunctionDef", sourceRange: context.range(node.start, end, true) },
        ...measureFunction(fn, context)
      };
      facts.push(fact);
      byNode.set(node, fact);
      for (const child of [...body(node)].reverse()) pending.push({ node: child, prefix: fact.qualname + ".<locals>." });
      continue;
    }
    if (node.nodeType === 33 /* Lambda */) continue;
    const next = node.nodeType === 10 /* Class */ ? prefix + d.name.d.value + "." : prefix;
    for (const child of children(node).reverse()) pending.push({ node: child, prefix: next });
  }
  facts.sort((a, b) => a.line - b.line || compareText(a.qualname, b.qualname));
  return { facts, byNode };
}
function bindingNames(target) {
  if (!target) return [];
  const d = target.d;
  if (target.nodeType === 38 /* Name */) return [d.value];
  if (target.nodeType === 54 /* TypeAnnotation */) return bindingNames(d.valueExpr);
  if ([52 /* Tuple */, 34 /* List */].includes(target.nodeType)) return d.items.flatMap(bindingNames);
  if (target.nodeType === 56 /* Unpack */) return bindingNames(d.expr);
  return [];
}
function moduleBindings(tree, context) {
  const seen = /* @__PURE__ */ new Map();
  const bind = (name, kind, node) => {
    const start = node.nodeType === 31 /* Function */ ? context.functionStart(node) : node.nodeType === 10 /* Class */ ? node.d.firstToken.start : node.start;
    if (!seen.has(name)) seen.set(name, { name, kind, line: context.point(start).line });
  };
  const visit = (node) => {
    const d = node.d;
    if ([31 /* Function */, 10 /* Class */].includes(node.nodeType)) {
      bind(d.name.d.value, node.nodeType === 10 /* Class */ ? "class" : "function", node);
      return;
    }
    if (node.nodeType === 3 /* Assignment */) {
      for (const name of bindingNames(d.leftExpr)) bind(name, "variable", node);
      visit(d.rightExpr);
      return;
    }
    if (node.nodeType === 5 /* AugmentedAssignment */) {
      for (const name of bindingNames(d.leftExpr)) bind(name, "variable", node);
      return;
    }
    if (node.nodeType === 23 /* Import */) {
      for (const item of d.list) bind(nameOf(item.d.alias) || moduleName(item.d.module).split(".")[0], "import", node);
      return;
    }
    if (node.nodeType === 25 /* ImportFrom */) {
      for (const item of d.imports) bind(nameOf(item.d.alias) || nameOf(item.d.name), "import", node);
      return;
    }
    if (node.nodeType === 53 /* Try */) {
      for (const child of [d.trySuite, d.elseSuite, d.finallySuite, ...d.exceptClauses]) if (child) visit(child);
      return;
    }
    if ([36 /* Module */, 50 /* Suite */, 47 /* StatementList */, 22 /* If */, 53 /* Try */, 28 /* Except */, 58 /* With */, 29 /* For */, 57 /* While */].includes(node.nodeType)) {
      for (const child of children(node)) visit(child);
    }
  };
  visit(tree);
  return [...seen.values()].sort((a, b) => a.line - b.line || compareText(a.name, b.name));
}
var compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function decodePython(bytes) {
  return decodeSource(Buffer.from(bytes), "source.py", { strict: true });
}
function literalString(node) {
  if (node?.nodeType !== 48 /* StringList */) return null;
  const values = node.d.strings;
  if (values.some((part) => part.nodeType !== 49 /* String */ || part.d.token.flags & 32 /* Bytes */)) return null;
  return values.map((part) => part.d.value).join("");
}

// extract/py/bindings.ts
var Scope = class {
  constructor(node, kind, parent) {
    this.node = node;
    this.kind = kind;
    this.parent = parent;
  }
  node;
  kind;
  parent;
  events = /* @__PURE__ */ new Map();
  declarations = /* @__PURE__ */ new Map();
  bind(binding) {
    const values = this.events.get(binding.name) || [];
    values.push(binding);
    this.events.set(binding.name, values);
  }
  unique(name) {
    const values = this.events.get(name)?.filter((value) => !value.attributeWrite);
    return values?.length === 1 && !values[0].conditional ? values[0] : void 0;
  }
};
var conditionalBlocks = /* @__PURE__ */ new Set([22 /* If */, 53 /* Try */, 29 /* For */, 57 /* While */, 63 /* Match */]);
var defaults = (node) => (node.d.params || []).flatMap((p) => p.d.defaultValue ? [p.d.defaultValue] : []);
var decorators = (node) => (node.d.decorators || []).map((d) => d.d.expr);
var headers = (node) => node.nodeType === 10 /* Class */ ? [...decorators(node), ...(node.d.arguments || []).map((a) => a.d.valueExpr)] : [...decorators(node), ...defaults(node)];
var annotations = (node) => [
  ...(node.d.params || []).flatMap((p) => p.d.annotation ? [p.d.annotation] : []),
  ...node.d.returnAnnotation ? [node.d.returnAnnotation] : []
];
var typeParameters = (node) => node.d.typeParams?.d.params || [];
function bindModule(tree) {
  const scopes = /* @__PURE__ */ new Map();
  const nodeScopes = /* @__PURE__ */ new Map();
  const suppressed = /* @__PURE__ */ new Set();
  const privateCalls = /* @__PURE__ */ new Set();
  const mutable = /* @__PURE__ */ new Set();
  const loaderMutable = /* @__PURE__ */ new Set();
  const create = (node, kind, nodes, parent, params = []) => {
    const scope = new Scope(node, kind, parent);
    scopes.set(node, scope);
    const add = (name, owner, conditional, loaderConditional, extra = {}) => scope.bind({ name, node: owner, at: endOf(owner), kind: "value", conditional, loaderConditional, ...extra });
    const target = (value, owner, conditional, loaderConditional, extra = {}) => {
      if (value?.nodeType === 52 /* Tuple */ || value?.nodeType === 34 /* List */) {
        value.d.items.forEach((item, index) => target(item, owner, conditional, loaderConditional, { ...extra, projection: [...extra.projection || [], index] }));
        return;
      }
      for (const name of bindingNames(value)) add(name, owner, conditional, loaderConditional, extra);
      if (value?.nodeType === 54 /* TypeAnnotation */) value = value.d.valueExpr;
      if (value?.nodeType === 35 /* MemberAccess */ && value.d.leftExpr.nodeType === 38 /* Name */)
        add(value.d.leftExpr.d.value, owner, conditional, loaderConditional, { ...extra, runtime: true, attributeWrite: value.d.member.d.value });
    };
    const scan = (current, conditional = false, loaderConditional = false) => {
      const d = current.d;
      if ([31 /* Function */, 10 /* Class */, 33 /* Lambda */].includes(current.nodeType)) {
        if (current.nodeType !== 33 /* Lambda */) add(
          d.name.d.value,
          current,
          conditional,
          loaderConditional,
          { kind: current.nodeType === 10 /* Class */ ? "class" : "function" }
        );
        for (const child of headers(current)) scan(child, conditional, loaderConditional);
        return;
      }
      if (current.nodeType === 11 /* Comprehension */) {
        for (const part of walk(current)) if (part.nodeType === 4 /* AssignmentExpression */)
          target(part.d.name, part, conditional, loaderConditional, { expr: part.d.rightExpr });
        return;
      }
      if ([32 /* Global */, 39 /* Nonlocal */].includes(current.nodeType)) {
        for (const value of d.targets) {
          scope.declarations.set(value.d.value, current.nodeType === 32 /* Global */ ? "global" : "nonlocal");
          mutable.add(value.d.value);
        }
        return;
      }
      if (current.nodeType === 23 /* Import */) {
        for (const item of d.list) add(
          nameOf(item.d.alias) || moduleName(item.d.module).split(".")[0],
          current,
          conditional,
          loaderConditional,
          { kind: "module", module: moduleName(item.d.module), level: 0, imported: item.d.alias ? "*" : moduleName(item.d.module).split(".")[0] }
        );
        return;
      }
      if (current.nodeType === 25 /* ImportFrom */) {
        if (d.isWildcardImport) add("*", current, conditional, loaderConditional);
        for (const item of d.imports) add(
          nameOf(item.d.alias) || nameOf(item.d.name),
          current,
          conditional,
          loaderConditional,
          { kind: "import", module: moduleName(d.module), level: d.module.d.leadingDots, imported: nameOf(item.d.name) }
        );
        return;
      }
      if ([3 /* Assignment */, 5 /* AugmentedAssignment */].includes(current.nodeType)) {
        target(d.leftExpr, current, conditional, loaderConditional, {
          expr: current.nodeType === 3 /* Assignment */ ? d.rightExpr : void 0,
          annotation: d.leftExpr.nodeType === 54 /* TypeAnnotation */ ? d.leftExpr.d.annotation : void 0
        });
        scan(d.rightExpr, conditional, loaderConditional);
        return;
      }
      if (current.nodeType === 54 /* TypeAnnotation */) {
        target(d.valueExpr, current, conditional, loaderConditional, { annotation: d.annotation, runtime: false });
        return;
      }
      if (current.nodeType === 4 /* AssignmentExpression */) {
        target(d.name, current, conditional, loaderConditional, { expr: d.rightExpr });
        scan(d.rightExpr, conditional, loaderConditional);
        return;
      }
      if (current.nodeType === 17 /* Del */) {
        for (const expr of d.targets) target(expr, current, conditional, loaderConditional);
        return;
      }
      if ([29 /* For */, 12 /* ComprehensionFor */].includes(current.nodeType)) target(d.targetExpr, current, true, true, { expr: d.iterableExpr, source: "iteration", async: Boolean(d.isAsync) });
      if (current.nodeType === 59 /* WithItem */) target(d.target, current, true, loaderConditional, { expr: d.expr, source: "context", async: Boolean((current.parent?.d).isAsync) });
      if (current.nodeType === 28 /* Except */ && d.name) target(d.name, current, true, true);
      if ([69 /* PatternCapture */, 66 /* PatternAs */, 72 /* PatternMappingExpandEntry */].includes(current.nodeType) && d.target && !d.isWildcard)
        target(d.target, current, true, loaderConditional);
      if (current.nodeType === 77 /* TypeAlias */) {
        target(d.name, current, conditional, loaderConditional);
        return;
      }
      const guarded = conditionalBlocks.has(current.nodeType);
      for (const child of flatChildren(current, true)) scan(child, conditional || guarded || current.nodeType === 58 /* With */, loaderConditional || guarded);
    };
    for (const current of nodes) scan(current);
    for (const param of params) if (param.d.name) add(param.d.name.d.value, param, false, false, { kind: "parameter", annotation: param.d.annotation });
    for (const name of scope.declarations.keys()) if (scope.events.has(name)) loaderMutable.add(name);
    return scope;
  };
  const module = create(tree, "module", body(tree));
  const visit = (node, scope, isAnnotation = false, inClass = false) => {
    nodeScopes.set(node, scope);
    const d = node.d;
    if (isAnnotation) suppressed.add(node);
    if (inClass && node.nodeType === 9 /* Call */) privateCalls.add(node);
    if ([31 /* Function */, 33 /* Lambda */].includes(node.nodeType)) {
      for (const value of headers(node)) visit(value, scope, isAnnotation, inClass);
      for (const value of [...annotations(node), ...typeParameters(node)]) visit(value, scope, true, inClass);
      let parent = scope;
      while (parent.kind === "class" && parent.parent) parent = parent.parent;
      const nodes = node.nodeType === 33 /* Lambda */ ? [d.expr] : body(node);
      const own = create(node, "function", nodes, parent, d.params);
      for (const param of typeParameters(node)) own.bind({ name: param.d.name.d.value, node: param, at: param.start, kind: "parameter", conditional: false, loaderConditional: false });
      for (const value of nodes) visit(value, own, isAnnotation, inClass);
      return;
    }
    if (node.nodeType === 10 /* Class */) {
      for (const value of decorators(node)) visit(value, scope, isAnnotation, inClass);
      const generic = typeParameters(node).length > 0;
      for (const arg of d.arguments || []) visit(arg.d.valueExpr, scope, isAnnotation || generic, inClass);
      for (const param of typeParameters(node)) visit(param, scope, true, inClass);
      const own = create(node, "class", body(node), scope);
      for (const param of typeParameters(node)) own.bind({ name: param.d.name.d.value, node: param, at: param.start, kind: "parameter", conditional: false, loaderConditional: false });
      for (const value of body(node)) visit(value, own, isAnnotation, true);
      return;
    }
    if (node.nodeType === 11 /* Comprehension */) {
      const first = d.forIfNodes[0];
      visit(first.d.iterableExpr, scope, isAnnotation, inClass);
      let parent = scope;
      while (parent.kind === "class" && parent.parent) parent = parent.parent;
      const own = create(node, "function", [...d.forIfNodes, d.expr], parent);
      for (const value of [first.d.targetExpr, ...d.forIfNodes.slice(1), d.expr]) visit(value, own, isAnnotation, inClass);
      return;
    }
    if (node.nodeType === 54 /* TypeAnnotation */) {
      visit(d.valueExpr, scope, isAnnotation, inClass);
      visit(d.annotation, scope, true, inClass);
      return;
    }
    if (node.nodeType === 77 /* TypeAlias */) {
      for (const child of children(node)) visit(child, scope, true, inClass);
      return;
    }
    for (const child of flatChildren(node, true)) visit(child, scope, isAnnotation, inClass);
  };
  visit(tree, module);
  const lookup = (scope, name, at, origin = scope) => {
    if (scope.declarations.has(name) || scope.events.has("*") || name === "__class__") return;
    if (scope.kind === "module") return mutable.has(name) ? void 0 : scope.unique(name);
    if (scope.events.has(name)) {
      const value = scope.unique(name);
      return scope === origin && scope.kind === "function" && value?.kind === "import" && value.at <= at ? value : void 0;
    }
    return scope.parent ? lookup(scope.parent, name, at, origin) : void 0;
  };
  const loader = (scope, name, at, deferred = false) => {
    if (scope.events.has("*")) return;
    const events = scope.events.get(name);
    let value;
    if (events) {
      if (deferred) {
        if (events.length === 1 && !loaderMutable.has(name) && !events[0].loaderConditional) value = events[0];
      } else value = events.filter((event) => event.at <= at && event.runtime !== false).at(-1);
      if (value?.kind === "module" && value.module === "importlib" && !value.loaderConditional) return "importlib";
      if (value?.kind === "import" && !value.level && value.module === "importlib" && value.imported === "import_module" && !value.loaderConditional) return "loader";
      if (value || deferred || scope.kind === "function") return;
    }
    if (scope.parent) {
      let parent = scope.parent;
      if (scope.declarations.get(name) === "global") while (parent.parent) parent = parent.parent;
      return loader(parent, name, at, deferred || scope.kind === "function");
    }
    return name === "__import__" && !loaderMutable.has(name) ? "loader" : void 0;
  };
  return { module, scopes, nodeScopes, suppressed, privateCalls, mutable, lookup, loader };
}
function flatChildren(node, flattenBooleans = false) {
  const out = [], pending = children(node).reverse();
  while (pending.length) {
    const child = pending.pop();
    if (child.nodeType === 7 /* BinaryOperation */ && (flattenBooleans || ![36 /* And */, 37 /* Or */].includes(child.d.operator))) {
      pending.push(...children(child).reverse());
    } else out.push(child);
  }
  return out;
}

// extract/py/collect.ts
function collectImports(tree, context, bindings) {
  const found = [];
  const counts = /* @__PURE__ */ new Map();
  for (const scope of bindings.scopes.values()) for (const [name, values] of scope.events) counts.set(name, (counts.get(name) || 0) + values.length);
  const checks = /* @__PURE__ */ new Map(), typing = /* @__PURE__ */ new Map();
  for (const [name, events] of bindings.module.events) {
    const value = events[0];
    if (events.length !== 1 || counts.get(name) !== 1 || value.conditional || value.level || value.module !== "typing") continue;
    if (value.kind === "module") typing.set(name, value.at);
    if (value.kind === "import" && value.imported === "TYPE_CHECKING") checks.set(name, value.at);
  }
  const emit = (node, flags, fields) => found.push({ ...context.point(node.start), ...fields, ...flags });
  const many = (nodes, flags) => {
    for (const node of nodes) if (node) visit(node, flags);
  };
  const visit = (node, flags) => {
    const d = node.d;
    if ([31 /* Function */, 33 /* Lambda */].includes(node.nodeType)) {
      many(typeParameters(node), { ...flags, lazy: true });
      many(headers(node), flags);
      many(annotations(node), { ...flags, conditional: true });
      many(node.nodeType === 33 /* Lambda */ ? [d.expr] : body(node), { ...flags, lazy: true });
      return;
    }
    if (node.nodeType === 10 /* Class */) {
      many(typeParameters(node), { ...flags, lazy: true });
      many([...headers(node), ...body(node)], flags);
      return;
    }
    if (node.nodeType === 77 /* TypeAlias */) {
      many([...typeParameters(node), d.expr], { ...flags, lazy: true });
      return;
    }
    if (node.nodeType === 22 /* If */) {
      let check = d.testExpr, negated = check.nodeType === 55 /* UnaryOperation */ && check.d.operator === 38 /* Not */;
      if (negated) check = check.d.expr;
      const typeCheck = check.nodeType === 38 /* Name */ ? (checks.get(check.d.value) ?? Infinity) < node.start : check.nodeType === 35 /* MemberAccess */ && check.d.member.d.value === "TYPE_CHECKING" && (typing.get(nameOf(check.d.leftExpr) || "") ?? Infinity) < node.start;
      visit(d.testExpr, flags);
      many([d.ifSuite], { ...flags, ...typeCheck ? negated ? {} : { typeOnly: true } : { conditional: true } });
      many([d.elseSuite], { ...flags, ...typeCheck ? negated ? { typeOnly: true } : {} : { conditional: true } });
      return;
    }
    if (node.nodeType === 53 /* Try */) {
      many([d.trySuite, ...d.exceptClauses, d.elseSuite], { ...flags, conditional: true });
      many([d.finallySuite], flags);
      return;
    }
    if (node.nodeType === 29 /* For */) {
      visit(d.iterableExpr, flags);
      many([d.targetExpr, d.forSuite, d.elseSuite], { ...flags, conditional: true });
      return;
    }
    if (node.nodeType === 57 /* While */) {
      visit(d.testExpr, flags);
      many([d.whileSuite, d.elseSuite], { ...flags, conditional: true });
      return;
    }
    if (node.nodeType === 63 /* Match */) {
      visit(d.expr, flags);
      many(d.cases, { ...flags, conditional: true });
      return;
    }
    if (node.nodeType === 51 /* Ternary */) {
      visit(d.testExpr, flags);
      many([d.ifExpr, d.elseExpr], { ...flags, conditional: true });
      return;
    }
    if (node.nodeType === 7 /* BinaryOperation */ && [36 /* And */, 37 /* Or */].includes(d.operator)) {
      const pending = [{ node, flags }];
      while (pending.length) {
        const item = pending.pop(), value = item.node.d;
        if (item.node.nodeType === 7 /* BinaryOperation */ && [36 /* And */, 37 /* Or */].includes(value.operator)) {
          pending.push({ node: value.rightExpr, flags: { ...item.flags, conditional: true } }, { node: value.leftExpr, flags: item.flags });
        } else visit(item.node, item.flags);
      }
      return;
    }
    if (node.nodeType === 11 /* Comprehension */) {
      const first = d.forIfNodes[0];
      visit(first.d.iterableExpr, flags);
      many([first.d.targetExpr, ...d.forIfNodes.slice(1), d.expr], { ...flags, conditional: true, ...d.isGenerator ? { lazy: true } : {} });
      return;
    }
    if (node.nodeType === 23 /* Import */) {
      for (const item of d.list) emit(node, flags, { kind: "static", level: 0, module: moduleName(item.d.module), names: ["*"] });
      return;
    }
    if (node.nodeType === 25 /* ImportFrom */) {
      emit(node, flags, {
        kind: "static",
        level: d.module.d.leadingDots,
        module: moduleName(d.module),
        names: d.isWildcardImport ? ["*"] : d.imports.map((item) => nameOf(item.d.name)).sort()
      });
      return;
    }
    if (node.nodeType === 9 /* Call */) {
      const scope = bindings.nodeScopes.get(node);
      const callee = d.leftExpr;
      const loader = callee.nodeType === 38 /* Name */ ? bindings.loader(scope, callee.d.value, node.start) === "loader" : callee.nodeType === 35 /* MemberAccess */ && callee.d.member.d.value === "import_module" && bindings.loader(scope, nameOf(callee.d.leftExpr) || "", node.start) === "importlib";
      if (loader) {
        const target = literalString(d.args[0]?.d.valueExpr);
        emit(node, flags, { kind: "dynamic", level: 0, module: target ?? "<computed>", names: [], ...target === null ? { opaque: true } : {} });
      }
    }
    many(flatChildren(node), flags);
  };
  visit(tree, {});
  return found.sort((a, b) => a.line - b.line || a.module.localeCompare(b.module));
}
function analyzeFile(path, bytes, targetVersion = "3.14", declarationsOnly = false) {
  const record = {
    path,
    loc: 0,
    sourceText: "",
    imports: [],
    symbols: [],
    functions: [],
    calls: [],
    definitions: /* @__PURE__ */ Object.create(null),
    importBindings: /* @__PURE__ */ Object.create(null),
    error: void 0
  };
  let text;
  try {
    text = decodePython(bytes);
  } catch (error) {
    record.error = error.message;
    return { record };
  }
  record.sourceText = text;
  record.loc = text ? text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).length - (/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]$/.test(text) ? 1 : 0) : 0;
  const parsed = parsePython(text, targetVersion), context = sourceContext(text, parsed);
  if (parsed.errors.length) {
    record.error = parsed.errors.map((error) => `${error.message} (line ${error.range.start.line + 1})`).join("; ");
    return { record };
  }
  const tree = parsed.parseTree;
  const bindings = bindModule(tree);
  record.imports = collectImports(tree, context, bindings);
  if (declarationsOnly) return { record, tree, bindings, context };
  const measured = functionFacts(tree, context);
  record.functions = measured.facts;
  record.symbols = moduleBindings(tree, context);
  const eligible = (binding) => binding?.kind === "function" && !binding.node.d.decorators.length ? measured.byNode.get(binding.node) : void 0;
  for (const name of bindings.module.events.keys()) {
    const candidate = bindings.lookup(bindings.module, name, Infinity), fn = eligible(candidate);
    if (fn) record.definitions[name] = { name: fn.name, ...fn.sourceRange };
    if (candidate?.kind === "import") record.importBindings[name] = { module: candidate.module, level: candidate.level, name: candidate.imported };
  }
  for (const node of walk(tree)) {
    if (node.nodeType !== 9 /* Call */) continue;
    const callee = node.d.leftExpr;
    const call = {
      ...context.range(node.start, endOf(node)),
      resolution: "unresolved",
      reason: callee.nodeType === 38 /* Name */ ? "no-local-function-binding" : "unsupported-callee"
    };
    const name = nameOf(callee);
    const privateName = name && bindings.privateCalls.has(node) && name.startsWith("__") && !name.endsWith("__");
    if (name && !privateName && !bindings.suppressed.has(node)) {
      const candidate = bindings.lookup(bindings.nodeScopes.get(node), name, node.start), fn = eligible(candidate);
      if (fn) {
        call.resolution = "same-file-function";
        delete call.reason;
        call.target = { name: fn.name, line: fn.line, column: fn.sourceRange.column };
      } else if (candidate?.kind === "import") call._import = { module: candidate.module, level: candidate.level, name: candidate.imported };
    }
    record.calls.push(call);
  }
  record.calls.sort((a, b) => a.line - b.line || a.column - b.column || a.endLine - b.endLine || a.endColumn - b.endColumn);
  return { record, tree, bindings, measured, context };
}

// extract/py/flow.ts
function reachingBindings(scope, name, at) {
  const events = (scope.events.get(name) || []).filter((event) => !event.attributeWrite);
  const parameters = events.filter((event) => event.kind === "parameter");
  const initial = { values: parameters.length ? parameters : [void 0], guards: [] };
  let fuel = 4096;
  const merge = (states) => {
    const live = states.filter((state) => Boolean(state));
    if (!live.length) return;
    return { values: [...new Set(live.flatMap((state) => state.values))], guards: live[0].guards.filter((guard) => live.every((state) => state.guards.some((other) => other.test === guard.test && other.positive === guard.positive))) };
  };
  const guarded = (state, test, positive) => ({ ...state, guards: [...state.guards, { test, positive }] });
  const assigned = (state, node) => {
    const values = events.filter((event) => event.node === node && event.kind !== "parameter");
    return values.length ? { values, guards: state.guards.filter((guard) => guard.test.start > node.start) } : state;
  };
  const possibleStores = (state, node) => ({ ...state, values: [.../* @__PURE__ */ new Set([...state.values, ...events.filter((event) => event.node.start >= node.start && event.at <= endOf(node))])] });
  const opaqueStores = (state, node, limit, includeRoot = false) => events.some((event) => (includeRoot || event.node !== node) && event.node.start >= node.start && event.at <= Math.min(limit, endOf(node))) ? { values: [void 0], guards: [] } : state;
  const confirmed = (state, test, positive) => {
    const after = opaqueStores(state, test, endOf(test), true);
    return after === state ? guarded(state, test, positive) : after;
  };
  const beforeTest = (state, test, limit) => {
    while (test.nodeType === 7 /* BinaryOperation */ && [36 /* And */, 37 /* Or */].includes(test.d.operator)) {
      const { leftExpr, rightExpr, operator } = test.d;
      if (limit < rightExpr.start) test = leftExpr;
      else {
        state = confirmed(state, leftExpr, operator === 36 /* And */);
        test = rightExpr;
      }
    }
    return state;
  };
  if (scope.node.nodeType === 11 /* Comprehension */) {
    const { expr, forIfNodes } = scope.node.d;
    const resultExpression = at >= expr.start && at < endOf(expr);
    let state = initial;
    for (const clause of forIfNodes) {
      if (!resultExpression && at < endOf(clause))
        return clause.nodeType === 13 /* ComprehensionIf */ ? beforeTest(state, clause.d.testExpr, at) : state;
      state = clause.nodeType === 13 /* ComprehensionIf */ ? confirmed(state, clause.d.testExpr, true) : assigned(state, clause);
    }
    return state;
  }
  const scan = (nodes, input, limit) => {
    let state = input;
    for (const node of nodes) {
      if (!state || node.start >= limit) break;
      if (--fuel < 0) return { values: [void 0], guards: [] };
      const d = node.d, inside = limit <= endOf(node);
      if (node.nodeType === 47 /* StatementList */ || node.nodeType === 50 /* Suite */) {
        state = scan(body(node), state, limit);
      } else if (node.nodeType === 2 /* Assert */) {
        const { testExpr, exceptionExpr } = node.d;
        if (inside) {
          if (limit <= endOf(testExpr)) return beforeTest(state, testExpr, limit);
          const failure = confirmed(state, testExpr, false);
          return exceptionExpr ? opaqueStores(failure, exceptionExpr, limit, true) : failure;
        }
        state = confirmed(state, testExpr, true);
      } else if (node.nodeType === 22 /* If */) {
        if (inside && limit <= endOf(d.testExpr)) return beforeTest(state, d.testExpr, limit);
        const yes = confirmed(state, d.testExpr, true), no = confirmed(state, d.testExpr, false);
        if (inside) return limit >= d.ifSuite.start && limit <= endOf(d.ifSuite) ? scan(body(d.ifSuite), yes, limit) : d.elseSuite ? scan([d.elseSuite], no, limit) : no;
        state = merge([scan(body(d.ifSuite), yes, Infinity), d.elseSuite ? scan([d.elseSuite], no, Infinity) : no]);
      } else if (node.nodeType === 29 /* For */ || node.nodeType === 57 /* While */) {
        const suite = d.forSuite || d.whileSuite;
        if (inside && limit < suite.start) return node.nodeType === 57 /* While */ ? possibleStores(state, suite) : state;
        state = opaqueStores(state, d.iterableExpr || d.testExpr, limit, true);
        const carried = possibleStores(state, suite);
        const entry = node.nodeType === 29 /* For */ ? assigned(carried, node) : carried;
        if (inside && limit <= endOf(suite)) return scan(body(suite), entry, limit);
        state = merge([state, scan(body(suite), entry, Infinity)]);
        if (state && d.elseSuite) state = merge([state, scan(body(d.elseSuite), state, inside ? limit : Infinity)]);
      } else if (node.nodeType === 58 /* With */) {
        for (const item of d.withItems) if (item.start < limit) state = assigned(state, item);
        if (inside && limit < d.suite.start) return state;
        const entered = state;
        state = scan(body(d.suite), entered, limit);
        if (!inside) state = merge([entered, state]);
      } else if (node.nodeType === 53 /* Try */) {
        if (inside && limit <= endOf(d.trySuite)) return scan(body(d.trySuite), state, limit);
        const interrupted = possibleStores(state, d.trySuite);
        const success = scan(body(d.trySuite), state, Infinity);
        if (inside && d.elseSuite && limit >= d.elseSuite.start && limit <= endOf(d.elseSuite))
          return success && scan(body(d.elseSuite), success, limit);
        const branches = [success && d.elseSuite ? scan(body(d.elseSuite), success, Infinity) : success];
        for (const handler of d.exceptClauses) {
          if (inside && limit >= handler.start && limit <= endOf(handler)) return scan(body(handler.d.exceptSuite), assigned(interrupted, handler), limit);
          branches.push(scan(body(handler.d.exceptSuite), assigned(interrupted, handler), Infinity));
        }
        state = merge(branches);
        if (d.finallySuite) state = scan(body(d.finallySuite), merge([state, interrupted]), inside ? limit : Infinity);
      } else if ([31 /* Function */, 10 /* Class */, 33 /* Lambda */].includes(node.nodeType)) {
        if (!inside) state = assigned(state, node);
      } else if (node.nodeType === 3 /* Assignment */ && !inside) {
        state = opaqueStores(state, node, limit);
        for (let target = node; ; target = target.d.rightExpr) {
          state = assigned(state, target);
          if (target.d.rightExpr.nodeType !== 3 /* Assignment */) break;
        }
      } else {
        state = opaqueStores(state, node, limit);
        if (!inside) state = assigned(state, node);
        if (!inside && [44 /* Return */, 43 /* Raise */, 8 /* Break */, 15 /* Continue */].includes(node.nodeType)) return;
      }
      if (inside) return state;
    }
    return state;
  };
  return scan(body(scope.node), initial, at) || { values: [void 0], guards: [] };
}

// extract/py/source.ts
var callableDecorators = ["contextmanager", "asynccontextmanager", "cache", "lru_cache", "singledispatch"];
function resolveSourceCalls(analyses, locate, declarations = []) {
  const captured = new Set(analyses.map((analysis) => analysis.record.path));
  const files = new Map([...analyses, ...declarations].filter((analysis) => analysis.tree).map((analysis) => [analysis.record.path, analysis]));
  const classOf = (file, node, instance = false, args = /* @__PURE__ */ new Map()) => ({ kind: "class", file, node, instance, args });
  const same = (a, b, depth = 0) => {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind || depth > 16) return false;
    if (a.kind === "scalar" && b.kind === "scalar") return a.type === b.type && a.literal === b.literal;
    if (a.kind === "class" && b.kind === "class" && a.instance !== b.instance) return false;
    if ("file" in a && "file" in b) return a.file === b.file && ("node" in a && "node" in b ? a.node === b.node && a.args.size === b.args.size && [...a.args].every(([name, value]) => same(value, b.args.get(name), depth + 1)) : a.kind === "module");
    if ("items" in a && "items" in b) return a.items.length === b.items.length && a.items.every((value, i) => same(value, b.items[i], depth + 1));
    if (a.kind === "mapping" && b.kind === "mapping") return same(a.key, b.key, depth + 1) && same(a.value, b.value, depth + 1);
    if (a.kind === "sequence" && b.kind === "sequence") return Boolean(a.async) === Boolean(b.async) && Boolean(a.generator) === Boolean(b.generator) && Boolean(a.mutable) === Boolean(b.mutable) && same(a.item, b.item, depth + 1) && same(a.send, b.send, depth + 1);
    if (a.kind === "context" && b.kind === "context") return Boolean(a.async) === Boolean(b.async) && same(a.item, b.item, depth + 1);
    if ("item" in a && "item" in b) return same(a.item, b.item, depth + 1);
    return a.kind === "none" || a.kind === "unknown";
  };
  const union = (values) => {
    const items = [];
    for (const value of values) for (const item of value?.kind === "union" ? value.items : [value || { kind: "unknown" }])
      if (!items.some((other) => same(item, other))) items.push(item);
    return items.length === 1 ? items[0] : items.length ? { kind: "union", items } : void 0;
  };
  const scopeOf = (file, node) => {
    for (let current = node; current; current = current.parent) {
      const scope = file.bindings.nodeScopes.get(current);
      if (scope) return scope;
    }
    return file.bindings.module;
  };
  const emptyList = (node) => node.nodeType === 34 /* List */ && !node.d.items.length;
  const typeBinding = (file, scope, name) => {
    const ordinary = scope.unique(name);
    if (ordinary) return ordinary;
    const values = scope.events.get(name)?.filter((value) => !value.attributeWrite);
    if (values?.length !== 1 || !["import", "module"].includes(values[0].kind) || locate(file.record.path, "typing", 0)) return;
    const point = file.context.point(values[0].node.start);
    return file.record.imports.some((item) => item.line === point.line && item.column === point.column && item.typeOnly && !item.conditional) ? values[0] : void 0;
  };
  const unshadowed = (scope, name) => {
    for (let current = scope; current; current = current.parent)
      if (current.events.has(name) || current.declarations.has(name) || current.events.has("*")) return false;
    return true;
  };
  const activeFields = [];
  const reachingValue = (scope, name, at) => {
    const { values } = reachingBindings(scope, name, at);
    return values.length === 1 ? values[0] : void 0;
  };
  function localCallable(scope, name, at) {
    for (let block = scope; block?.kind === "function"; block = block.parent) {
      if (block.declarations.has(name) || block.events.has("*")) return;
      if (!block.events.has(name)) continue;
      const value = block.unique(name);
      if (value?.kind === "function" && value.at <= at) return value;
      const writes = block.events.get(name);
      if (block === scope && writes.length === 1 && ["function", "import"].includes(writes[0].kind) && writes[0].conditional && reachingValue(block, name, at) === writes[0]) return writes[0];
      return;
    }
  }
  function nullableFunction(file, scope, name, at) {
    for (let block = scope; block; block = block.parent) {
      if (block.declarations.has(name) || block.events.has("*") || file.bindings.mutable.has(name)) return;
      const values = block.events.get(name);
      if (!values) continue;
      if (block.kind !== "module" || values.length < 2 || values.some((value) => !value.conditional)) return;
      const functions = values.filter((value) => value.kind === "function" && !value.node.d.decorators.length);
      if (functions.length === 1 && (scope.kind !== "module" || reachingBindings(block, name, at).values.includes(functions[0])) && values.every((value) => value === functions[0] || value.expr?.nodeType === 14 /* Constant */ && value.expr.d.constType === 27 /* None */))
        return { kind: "function", file, node: functions[0].node, args: /* @__PURE__ */ new Map() };
      return;
    }
  }
  const symbol = (file, scope, name, at, seen, substitutions, types = false, importsLeft = 2, origin = scope) => {
    if (substitutions.has(name)) return substitutions.get(name);
    if (scope.declarations.has(name) || file.bindings.mutable.has(name) || name === "__class__") return;
    const wildcard = scope.events.get("*")?.at(-1);
    if (wildcard && scope.kind !== "module") return;
    const values = scope.events.get(name)?.filter((value) => !value.attributeWrite);
    if (values?.length) {
      const local = scope.kind === "function" && scope === origin;
      const value = types ? typeBinding(file, scope, name) : scope.unique(name) ?? (local && values.length === 1 ? reachingValue(scope, name, at) : void 0);
      if (wildcard && (!value || value.conditional || value.at <= wildcard.at)) return;
      if (scope.kind === "function" && values.every((value2) => ["value", "parameter"].includes(value2.kind))) {
        if (!local && values.some((value2) => value2.at > at)) return;
        if (values.some((value2) => value2.annotation && standard(file, scopeOf(file, value2.annotation), value2.annotation, true) === "typing.Any")) return;
        return union(reachingBindings(scope, name, at).values.map((value2) => value2 && bindingShape(file, scope, value2, at, seen, substitutions)));
      }
      if (!value) return !types && scope.kind === "module" ? overloadGroup(file, scope, values) ?? platformDeclaration(file, scope, values, at) : void 0;
      if (value.kind === "class") return !value.node.d.decorators.length || knownDecorators(file, value.node, ["dataclass"]) ? classOf(file, value.node) : void 0;
      if (value.kind === "function") {
        if (scope.kind !== "module" && value.at > at) return;
        if (!value.node.d.decorators.length || knownDecorators(file, value.node, callableDecorators) || signatureDecorators(file, value.node, seen))
          return { kind: "function", file, node: value.node, args: substitutions };
        return;
      }
      if (value.kind === "import" || value.kind === "module") {
        if (value.kind === "import" && !importsLeft) return;
        if (scope.kind !== "module" && (scope !== origin || scope.kind !== "function" || value.at > at)) return;
        const module = value.kind === "module" && value.imported !== "*" ? value.imported : value.module;
        const target = locate(file.record.path, module, value.level || 0, value.kind === "import" ? value.imported : void 0);
        const other = target && files.get(target.file);
        if (!target || !other || seen.has(value.node)) return;
        if (target.module) return { kind: "module", file: other };
        return symbol(other, other.bindings.module, value.imported, Infinity, /* @__PURE__ */ new Set([...seen, value.node]), /* @__PURE__ */ new Map(), types, importsLeft - 1);
      }
      return bindingShape(file, scope, value, at, seen, substitutions);
    }
    return scope.parent ? symbol(file, scope.parent, name, at, seen, substitutions, types, importsLeft, origin) : void 0;
  };
  function bindingShape(file, scope, value, at, seen, substitutions) {
    if (seen.has(value.node)) return;
    const next = /* @__PURE__ */ new Set([...seen, value.node]);
    if (value.annotation) return annotation(file, scopeOf(file, value.annotation), value.annotation, value.at, next, substitutions);
    if (value.kind === "parameter") {
      if (scope.node.nodeType === 33 /* Lambda */)
        return callbackParameter(file, scope, value.node, at, next, substitutions);
      const method = scope.node;
      const parameters = method.d.params || [];
      if (parameters[0] === value.node) {
        let owner = method.parent;
        while (owner && ![31 /* Function */, 10 /* Class */].includes(owner.nodeType)) owner = owner.parent;
        if (owner?.nodeType === 10 /* Class */ && (!method.d.decorators.length || knownDecorators(file, method, ["property", "cached_property", "classmethod", "contextmanager", "asynccontextmanager"]) || abstractMethod(file, method) || propertyAccessor(file, method) || signatureDecorators(file, method, seen)))
          return classOf(file, owner, !knownDecorators(file, method, ["classmethod"]));
      }
      return;
    }
    if (!value.expr) return;
    let shape = expression(file, scopeOf(file, value.expr), value.expr, value.expr.start, next, substitutions);
    if (value.source === "iteration") shape = element(shape, Boolean(value.async));
    if (value.source === "context") {
      if (shape?.kind === "class") {
        const enter = member(shape, value.async ? "__aenter__" : "__enter__", at, next);
        shape = enter?.kind === "function" ? returns(enter, at, next) : void 0;
        if (value.async && shape?.kind === "awaitable") shape = shape.item;
      } else shape = shape?.kind === "context" && Boolean(shape.async) === Boolean(value.async) ? shape.item : void 0;
    }
    for (const index of value.projection || []) shape = shape?.kind === "tuple" ? shape.items[index] : void 0;
    return shape;
  }
  function standard(file, scope, node, types = false) {
    if (node.nodeType === 38 /* Name */) {
      const name = node.d.value;
      for (let current = scope; current; current = current.parent) {
        if (current.declarations.has(name) || current.events.has("*") || file.bindings.mutable.has(name)) return;
        if (!current.events.has(name)) continue;
        const value = types ? typeBinding(file, current, name) : current.unique(name);
        if (!value || current.kind !== "module" && value.at > node.start || value.level || !value.module) return;
        if (/^(?:typing|typing_extensions|collections|contextlib|contextvars|weakref|builtins|dataclasses|functools|abc|werkzeug|sys)(?:\.|$)/.test(value.module) && (locate(file.record.path, value.module, 0) || current.events.get(name)?.some((event) => event.attributeWrite))) return;
        if (value.kind === "import") return `${value.module}.${value.imported}`;
        if (value.kind === "module") return value.imported === "*" ? value.module : value.imported;
        return;
      }
      return unshadowed(scope, name) ? `builtins.${name}` : void 0;
    }
    if (node.nodeType === 35 /* MemberAccess */) {
      const left = standard(file, scope, node.d.leftExpr, types);
      return left && `${left}.${node.d.member.d.value}`;
    }
    return;
  }
  function propertyGroup(file, scope, name) {
    const entries = scope.events.get(name) || [];
    const getter = entries[0];
    if (!getter || getter.kind !== "function" || getter.conditional || !knownDecorators(file, getter.node, ["property"])) return;
    const accessors = /* @__PURE__ */ new Set();
    for (const entry of entries.slice(1)) {
      const decorators2 = entry.node.d.decorators || [], expr = decorators2[0]?.d.expr;
      if (entry.kind !== "function" || entry.conditional || decorators2.length !== 1 || expr?.nodeType !== 35 /* MemberAccess */ || nameOf(expr.d.leftExpr) !== name || !["setter", "deleter"].includes(expr.d.member.d.value) || accessors.has(expr.d.member.d.value)) return;
      accessors.add(expr.d.member.d.value);
    }
    return getter;
  }
  function propertyAccessor(file, method) {
    const scope = scopeOf(file, method);
    return scope.kind === "class" && Boolean(propertyGroup(file, scope, method.d.name.d.value));
  }
  function knownDecorators(file, node, allowed) {
    const decorators2 = node.d.decorators || [];
    return decorators2.length > 0 && decorators2.every((decorator) => {
      const expr = decorator.d.expr;
      const full = standard(file, scopeOf(file, node), expr), name = full?.split(".").at(-1);
      return Boolean(name && allowed.includes(name) && [
        "builtins.classmethod",
        "builtins.staticmethod",
        "builtins.property",
        "contextlib.contextmanager",
        "contextlib.asynccontextmanager",
        "dataclasses.dataclass",
        "functools.cache",
        "functools.lru_cache",
        "functools.singledispatch",
        "functools.cached_property",
        "abc.abstractmethod",
        "werkzeug.utils.cached_property"
      ].includes(full));
    });
  }
  function abstractMethod(file, node) {
    return node.d.decorators.length === 1 && knownDecorators(file, node, ["abstractmethod"]);
  }
  function overloadGroup(file, scope, bindings) {
    if (bindings.length < 3 || bindings.some((binding) => binding.conditional || binding.kind !== "function")) return;
    const declarations2 = bindings.map((binding) => binding.node);
    const node = declarations2.pop();
    if (node.d.decorators.length || node.d.isAsync || declarations2.some((declaration) => declaration.d.isAsync || declaration.d.decorators.length !== 1 || !["typing.overload", "typing_extensions.overload"].includes(
      standard(file, scope, declaration.d.decorators[0].d.expr)
    ))) return;
    return { kind: "function", file, node, args: /* @__PURE__ */ new Map(), overloads: declarations2 };
  }
  function platformGuard(file, scope, test) {
    const platform = (node) => {
      const alias = nameOf(node.nodeType === 35 /* MemberAccess */ ? node.d.leftExpr : node);
      const imported = alias && scope.unique(alias);
      return imported && imported.at < node.start && standard(file, scope, node) === "sys.platform";
    };
    const clause = (node) => {
      if (node.nodeType === 38 /* Name */) {
        const binding = scope.unique(node.d.value);
        if (!binding?.expr || binding.at > node.start || file.bindings.mutable.has(node.d.value)) return false;
        node = binding.expr;
      }
      if (node.nodeType === 7 /* BinaryOperation */)
        return [12 /* Equals */, 28 /* NotEquals */].includes(node.d.operator) && platform(node.d.leftExpr) && literalString(node.d.rightExpr) !== null;
      if (node.nodeType !== 9 /* Call */ || node.d.leftExpr.nodeType !== 35 /* MemberAccess */ || node.d.leftExpr.d.member.d.value !== "startswith") return false;
      const [part] = node.d.args;
      return node.d.args.length === 1 && part.d.argCategory === 0 /* Simple */ && !part.d.name && platform(node.d.leftExpr.d.leftExpr) && literalString(part.d.valueExpr) !== null;
    };
    return test.nodeType === 7 /* BinaryOperation */ && test.d.operator === 36 /* And */ ? clause(test.d.leftExpr) && clause(test.d.rightExpr) : clause(test);
  }
  function platformDeclaration(file, scope, bindings, at) {
    if (bindings.length !== 2 || bindings.some((binding) => binding.kind !== "function" || !binding.conditional)) return;
    const [first, last] = bindings.map((binding) => binding.node);
    const branch = first.parent?.parent;
    if (branch?.nodeType !== 22 /* If */ || branch.parent !== scope.node || branch.d.ifSuite !== first.parent || branch.d.elseSuite !== last.parent || endOf(branch) >= at || !platformGuard(file, scope, branch.d.testExpr)) return;
    const text = (node) => file.record.sourceText.slice(node.start, endOf(node));
    if ([first, last].some((fn) => fn.d.isAsync || fn.d.params.length || fn.d.typeParams || !fn.d.returnAnnotation || fn.d.decorators.length && (fn.d.decorators.length !== 1 || !knownDecorators(file, fn, ["contextmanager"])))) return;
    if (first.d.decorators.length !== last.d.decorators.length || text(first.d.returnAnnotation) !== text(last.d.returnAnnotation)) return;
    return { kind: "function", file, node: last, args: /* @__PURE__ */ new Map(), platformAlternative: true };
  }
  function scalarLiteral(node) {
    const text = literalString(node);
    if (text !== null) return { kind: "scalar", type: "str", literal: text };
    if (node?.nodeType === 14 /* Constant */ && [34 /* True */, 15 /* False */].includes(node.d.constType))
      return { kind: "scalar", type: "bool", literal: node.d.constType === 34 /* True */ };
    return;
  }
  function typeVariable(file, scope, name, fn) {
    const generic = fn && typeParameters(fn).find((param) => param.d.name.d.value === name);
    if (generic?.nodeType === 75 /* TypeParameter */) return generic.d.typeParamKind === 0 /* TypeVar */ ? { node: generic, bound: generic.d.boundExpr, scope } : void 0;
    if (file.bindings.mutable.has(name)) return;
    for (let current = scope; current; current = current.parent) {
      if (!current.events.has(name)) continue;
      const value = current.unique(name);
      if (value?.expr?.nodeType !== 9 /* Call */ || standard(file, current, value.expr.d.leftExpr) !== "typing.TypeVar") return;
      const [label, ...options] = value.expr.d.args;
      if (label?.d.argCategory !== 0 /* Simple */ || label.d.name || literalString(label.d.valueExpr) !== name || options.some((arg) => arg.d.argCategory !== 0 /* Simple */ || !arg.d.name)) return;
      const bounds = options.filter((arg) => nameOf(arg.d.name) === "bound");
      if (bounds.length > 1) return;
      return { node: value.node, bound: bounds[0]?.d.valueExpr, scope: current };
    }
    return;
  }
  function signatureDecorators(file, node, seen) {
    const decorators2 = node.d.decorators || [];
    if (!decorators2.length || seen.has(node) || seen.size > 64) return false;
    const next = /* @__PURE__ */ new Set([...seen, node]);
    return decorators2.every((decorator) => {
      const expr = decorator.d.expr;
      if (![38 /* Name */, 35 /* MemberAccess */].includes(expr.nodeType)) return false;
      const scope = scopeOf(file, node);
      let base = expr;
      while (base.nodeType === 35 /* MemberAccess */) base = base.d.leftExpr;
      const baseName = nameOf(base);
      if (!baseName) return false;
      for (let current = scope; current; current = current.parent) {
        const events = current.events.get(baseName);
        if (!events) continue;
        const binding = current.unique(baseName);
        if (!binding || binding.at > node.start || events.some((event) => event.attributeWrite)) return false;
        break;
      }
      const value = expression(file, scope, expr, node.start, next, /* @__PURE__ */ new Map());
      if (value?.kind !== "function" || value.node.d.decorators.length || value.file === file && value.node.start > node.start) return false;
      const d = value.node.d, params = d.params || [], name = nameOf(d.returnAnnotation);
      if (d.isAsync || params.length !== 1 || params[0].d.category !== 0 /* Simple */ || nameOf(params[0].d.annotation) !== name || !name) return false;
      const variable = typeVariable(value.file, scopeOf(value.file, value.node), name, value.node), bound = variable?.bound;
      const contract = bound?.nodeType === 27 /* Index */ ? standard(value.file, variable.scope, bound.d.leftExpr) : void 0;
      return contract === "typing.Callable" || contract === "collections.abc.Callable";
    });
  }
  function annotation(file, scope, node, at, seen, substitutions) {
    if (!node) return;
    if (node.nodeType === 48 /* StringList */ && node.d.strings.every((part) => part.nodeType === 49 /* String */)) {
      const text = node.d.strings.map((part) => part.d.value).join("");
      const parsed = parsePython(`_annotation: ${text}`);
      const statement = parsed.parseTree.d.statements[0]?.d.statements?.[0];
      return !parsed.errors.length && statement?.nodeType === 54 /* TypeAnnotation */ ? annotation(file, scope, statement.d.annotation, at, seen, substitutions) : void 0;
    }
    if (node.nodeType === 38 /* Name */ && substitutions.has(node.d.value)) return substitutions.get(node.d.value);
    if (node.nodeType === 27 /* Index */) {
      const type = standard(file, scope, node.d.leftExpr, true), short = type?.split(".").at(-1);
      const args = () => node.d.items.map((item) => annotation(file, scope, item.d.valueExpr, at, seen, substitutions));
      if (["typing.Literal", "typing_extensions.Literal"].includes(type) && node.d.items.length === 1)
        return scalarLiteral(node.d.items[0].d.valueExpr);
      if (type === "contextvars.ContextVar" && node.d.items.length === 1) return { kind: "contextVar", item: args()[0] };
      if (type === "typing.Type" || type === "builtins.type") {
        if (node.d.items.length !== 1) return;
        const value2 = args()[0];
        return value2?.kind === "class" ? { ...value2, instance: false } : void 0;
      }
      const namespace = type?.slice(0, type.lastIndexOf("."));
      const protocol = namespace === "typing" || namespace === "builtins" && ["list", "dict", "tuple", "set", "frozenset"].includes(short) || namespace === "collections.abc" && ["Sequence", "MutableSequence", "Iterable", "Iterator", "Generator", "AsyncIterable", "AsyncIterator", "AsyncGenerator", "Mapping", "MutableMapping", "Awaitable", "Coroutine"].includes(short) || namespace === "contextlib" && ["AbstractContextManager", "AbstractAsyncContextManager"].includes(short);
      if (protocol) {
        if (short === "Optional") return union([args()[0], { kind: "none" }]);
        if (short === "Union") return union(args());
        if (short === "Annotated") return args()[0];
        if (["list", "List", "Sequence", "MutableSequence", "Iterable", "Iterator", "Generator", "AsyncIterable", "AsyncIterator", "AsyncGenerator", "set", "Set", "frozenset", "FrozenSet"].includes(short)) {
          const values = args();
          return { kind: "sequence", item: values[0], send: short.endsWith("Generator") ? values[1] : void 0, generator: short.endsWith("Generator"), async: short.startsWith("Async"), mutable: ["list", "List", "MutableSequence"].includes(short) };
        }
        if (["dict", "Dict", "Mapping", "MutableMapping"].includes(short)) {
          const values = args();
          return { kind: "mapping", key: values[0], value: values[1] };
        }
        if (["tuple", "Tuple"].includes(short)) return { kind: "tuple", items: args() };
        if (["Awaitable", "Coroutine"].includes(short)) return { kind: "awaitable", item: args().at(-1) };
        if (["ContextManager", "AsyncContextManager", "AbstractContextManager", "AbstractAsyncContextManager"].includes(short)) return { kind: "context", item: args()[0], async: short.includes("Async") };
      }
      const base = expression(file, scope, node.d.leftExpr, at, seen, substitutions, true);
      if (base?.kind !== "class") return;
      const mapped = new Map(base.args);
      const params = typeParameters(base.node);
      for (let i = 0; i < params.length; i++) {
        const value2 = node.d.items[i] && annotation(file, scope, node.d.items[i].d.valueExpr, at, seen, substitutions);
        if (value2) mapped.set(params[i].d.name.d.value, value2);
      }
      return { ...base, instance: true, args: mapped };
    }
    if (node.nodeType === 7 /* BinaryOperation */ && node.d.operator === 6 /* BitwiseOr */)
      return union([annotation(file, scope, node.d.leftExpr, at, seen, substitutions), annotation(file, scope, node.d.rightExpr, at, seen, substitutions)]);
    if (node.nodeType === 14 /* Constant */ && node.d.constType === 27 /* None */) return { kind: "none" };
    if (node.nodeType === 38 /* Name */ && !substitutions.has(node.d.value)) {
      const variable = typeVariable(file, scope, node.d.value);
      if (variable) return variable.bound && !seen.has(variable.node) ? annotation(file, variable.scope, variable.bound, at, /* @__PURE__ */ new Set([...seen, variable.node]), substitutions) : void 0;
    }
    const qualified = standard(file, scope, node, true);
    if (qualified === "builtins.str" || qualified === "builtins.bool") return { kind: "scalar", type: qualified === "builtins.str" ? "str" : "bool" };
    if (["typing.Self", "typing_extensions.Self"].includes(qualified)) {
      let owner = scope.node;
      while (owner && owner.nodeType !== 10 /* Class */) owner = owner.parent;
      return owner && classOf(file, owner, true);
    }
    const value = expression(file, scope, node, at, seen, substitutions, true);
    return value?.kind === "class" ? { ...value, instance: true } : value;
  }
  function bases(owner, seen) {
    const out = [];
    const scope = scopeOf(owner.file, owner.node);
    const arguments_ = owner.node.d.arguments || [];
    for (const [index, arg] of arguments_.entries()) {
      if (arg.d.name) return;
      let expr = arg.d.valueExpr;
      if (expr.nodeType === 27 /* Index */) expr = expr.d.leftExpr;
      const standardBase = standard(owner.file, scope, expr, true);
      if (standardBase === "builtins.object") {
        if (index !== arguments_.length - 1 || expr !== arg.d.valueExpr) return;
        continue;
      }
      if (["typing.Generic", "abc.ABC"].includes(standardBase)) continue;
      const base = expression(owner.file, scope, expr, owner.node.start, seen, owner.args);
      if (base?.kind === "class") out.push(base);
      else return;
    }
    return out;
  }
  function mro(owner, active = /* @__PURE__ */ new Set()) {
    if (active.has(owner.node) || active.size > 32) return;
    const direct = bases(owner, /* @__PURE__ */ new Set([...active, owner.node]));
    if (!direct) return;
    const lists = [];
    for (const base of direct) {
      const order = mro(base, /* @__PURE__ */ new Set([...active, owner.node]));
      if (!order) return;
      lists.push(order);
    }
    lists.push([...direct]);
    const result = [owner];
    while (lists.some((list) => list.length)) {
      const head = lists.map((list) => list[0]).find((candidate) => candidate && !lists.some((list) => list.slice(1).some((other) => same(candidate, other))));
      if (!head) return;
      result.push(head);
      for (const list of lists) if (same(list[0], head)) list.shift();
    }
    return result;
  }
  function member(owner, name, at, seen, lookup, skipOwn = false, lineage = /* @__PURE__ */ new Set()) {
    if (name.startsWith("__") && !name.endsWith("__") || lineage.has(owner.node) || lineage.size > 32) return;
    if (!skipOwn) {
      const own = fileMember(owner, name, at, seen, lookup);
      if (own.present) return own.value;
    }
    const arguments_ = owner.node.d.arguments || [];
    if (arguments_.length && arguments_.every((arg) => !arg.d.name)) {
      let expr = arguments_[0].d.valueExpr;
      if (expr.nodeType === 27 /* Index */) expr = expr.d.leftExpr;
      const base = expression(owner.file, scopeOf(owner.file, owner.node), expr, owner.node.start, seen, owner.args);
      if (base?.kind === "class") {
        if (arguments_.length === 1)
          return member({ ...base, instance: owner.instance }, name, at, seen, lookup, false, /* @__PURE__ */ new Set([...lineage, owner.node]));
        const value = fileMember({ ...base, instance: owner.instance }, name, at, seen, lookup);
        if (value.present) return value.value;
      }
    }
    const hierarchy = mro(owner);
    if (!hierarchy) return;
    for (const base of hierarchy.slice(1)) {
      const value = fileMember({ ...base, instance: owner.instance }, name, at, seen, lookup);
      if (value.present) return value.value;
    }
    return;
  }
  function fileMember(owner, name, at, seen, lookup) {
    const active = activeFields.find((field) => field.name === name && same(field.owner, owner));
    if (active) return { present: true, value: active.value };
    if (activeFields.length > 32) return { present: true };
    const file = owner.file, scope = file.bindings.scopes.get(owner.node);
    const writes = [];
    for (const candidate of captured.has(file.record.path) ? file.bindings.scopes.values() : []) {
      let parent = candidate.node.parent;
      while (parent && ![31 /* Function */, 10 /* Class */].includes(parent.nodeType)) parent = parent.parent;
      if (parent !== owner.node) continue;
      const first = candidate.node.d.params?.[0]?.d.name?.d.value;
      for (const event of candidate.events.get(first) || []) if (event.attributeWrite === name) writes.push(event);
    }
    const entries = scope.events.get(name)?.filter((value2) => !value2.attributeWrite) || [];
    if (writes.length) {
      if (entries.some((entry) => entry.kind === "function")) return { present: true };
      const declared = [...entries, ...writes].filter((value2) => value2.annotation);
      const values = declared.length ? declared : writes;
      const pending = { owner, name, value: void 0 };
      activeFields.push(pending);
      try {
        const infer = () => values.map((value2) => bindingShape(file, scopeOf(file, value2.node), value2, value2.at, /* @__PURE__ */ new Set(), owner.args));
        const first = infer();
        pending.value = union(first.filter((value2) => value2 && value2.kind !== "unknown" && value2.kind !== "union"));
        return { present: true, value: union(pending.value ? infer() : first) };
      } finally {
        activeFields.pop();
      }
    }
    if (!entries.length) return { present: false };
    const value = propertyGroup(file, scope, name) || scope.unique(name);
    if (!value) return { present: true };
    if (value.kind === "function") {
      const decorators2 = value.node.d.decorators;
      if (decorators2.length && !knownDecorators(file, value.node, ["property", "cached_property", "classmethod", "staticmethod", "contextmanager", "asynccontextmanager"]) && !abstractMethod(file, value.node) && !signatureDecorators(file, value.node, seen)) return { present: true };
      const fn = { kind: "function", file, node: value.node, args: owner.args, receiver: owner };
      if (knownDecorators(file, value.node, ["property", "cached_property"])) {
        return { present: true, value: owner.instance ? lookup === "callee" ? fn : returns(fn, at, seen) : void 0 };
      }
      return { present: true, value: fn };
    }
    return { present: true, value: value.annotation ? annotation(file, scope, value.annotation, at, seen, owner.args) : value.expr ? expression(file, scope, value.expr, at, seen, owner.args) : void 0 };
  }
  const callParameters = (fn) => {
    const boundReceiver = fn.receiver && !knownDecorators(fn.file, fn.node, ["staticmethod"]) && (fn.receiver.instance || knownDecorators(fn.file, fn.node, ["classmethod"]));
    return fn.node.d.params.slice(boundReceiver ? 1 : 0);
  };
  function bindArguments(params, args) {
    if (params.some((param) => !param.d.name || param.d.category !== 0 /* Simple */)) return;
    const supplied = /* @__PURE__ */ new Map();
    let position = 0;
    for (const arg of args) {
      if (arg.d.argCategory !== 0 /* Simple */) return;
      const index = arg.d.name ? params.findIndex((param) => param.d.name?.d.value === arg.d.name.d.value) : position++;
      if (index < 0 || index >= params.length || supplied.has(index)) return;
      supplied.set(index, arg.d.valueExpr);
    }
    if (params.some((param, index) => !supplied.has(index) && !param.d.defaultValue)) return;
    return supplied;
  }
  function callbackParameter(file, scope, parameter, at, seen, substitutions) {
    const lambda = scope.node;
    if (lambda.nodeType !== 33 /* Lambda */ || lambda.d.params.some((param) => !param.d.name || param.d.category !== 0 /* Simple */)) return;
    const argument = lambda.parent, call = argument?.parent;
    if (argument?.nodeType !== 1 /* Argument */ || argument.d.valueExpr !== lambda || call?.nodeType !== 9 /* Call */) return;
    const fn = expression(file, scopeOf(file, call), call.d.leftExpr, call.start, seen, substitutions);
    if (fn?.kind !== "function" || fn.overloads) return;
    const params = callParameters(fn);
    const index = [...bindArguments(params, call.d.args) || []].find(([, supplied]) => supplied === lambda)?.[0];
    if (index === void 0) return;
    let expected = params[index].d.annotation;
    let declaredIn = scopeOf(fn.file, fn.node);
    if (expected?.nodeType === 38 /* Name */ && !fn.file.bindings.mutable.has(expected.d.value)) {
      const name = expected.d.value;
      for (let current = declaredIn; current; current = current.parent) {
        if (current.events.has("*") || current.declarations.has(name)) return;
        if (!current.events.has(name)) continue;
        expected = current.unique(name)?.expr;
        declaredIn = current;
        break;
      }
    }
    if (expected?.nodeType !== 27 /* Index */ || expected.d.items.length !== 2 || !["typing.Callable", "collections.abc.Callable"].includes(standard(fn.file, declaredIn, expected.d.leftExpr, true))) return;
    const types = expected.d.items[0].d.valueExpr;
    if (types.nodeType !== 34 /* List */ || types.d.items.length !== lambda.d.params.length) return;
    const position = lambda.d.params.findIndex((param) => param === parameter);
    return annotation(fn.file, declaredIn, types.d.items[position], at, seen, fn.args);
  }
  function inferTypeArguments(fn, scope, args, shapeOf) {
    const params = callParameters(fn), supplied = bindArguments(params, args);
    if (!supplied) return;
    const substitutions = /* @__PURE__ */ new Map();
    for (const [index, argument] of supplied) {
      const type = params[index].d.annotation;
      const classType = type?.nodeType === 27 /* Index */ && type.d.items.length === 1 && ["typing.Type", "builtins.type"].includes(standard(fn.file, scope, type.d.leftExpr, true));
      const name = nameOf(classType && type?.nodeType === 27 /* Index */ ? type.d.items[0].d.valueExpr : type);
      if (!name) continue;
      const variable = typeVariable(fn.file, scope, name, fn.node);
      if (!variable || !classType && variable.node.nodeType !== 75 /* TypeParameter */) continue;
      const shape = shapeOf(argument);
      const actual = classType ? shape?.kind === "class" && !shape.instance ? { ...shape, instance: true } : void 0 : shape;
      const values = substitutions.get(name) || [];
      values.push(actual);
      substitutions.set(name, values);
    }
    return substitutions;
  }
  function overloadReturn(fn, scope, args, shapeOf, at, seen) {
    for (const declaration of fn.overloads) {
      const params = declaration.d.params, supplied = bindArguments(params, args);
      if (!supplied) continue;
      const matches = params.map((param, index) => {
        const expected = annotation(fn.file, scope, param.d.annotation, at, seen, fn.args);
        const actual = supplied.has(index) ? shapeOf(supplied.get(index)) : scalarLiteral(param.d.defaultValue);
        if (expected?.kind !== "scalar" || actual?.kind !== "scalar") return;
        return expected.type === actual.type && (expected.literal === void 0 || expected.literal === actual.literal);
      });
      if (matches.includes(false)) continue;
      if (matches.includes(void 0)) return;
      return annotation(fn.file, scope, declaration.d.returnAnnotation, at, seen, fn.args);
    }
  }
  function returns(fn, at, seen, args = [], shapeOf) {
    const d = fn.node.d;
    const scope = scopeOf(fn.file, fn.node), substitutions = new Map(fn.args);
    if (fn.overloads) return shapeOf && overloadReturn(fn, scope, args, shapeOf, at, seen);
    if (!d.returnAnnotation) return;
    if (shapeOf && args.length) {
      for (const [name, values] of inferTypeArguments(fn, scope, args, shapeOf) || []) substitutions.set(name, union(values));
    }
    const value = annotation(fn.file, scope, d.returnAnnotation, at, seen, substitutions);
    if (knownDecorators(fn.file, fn.node, ["contextmanager", "asynccontextmanager"])) return value?.kind === "sequence" ? { kind: "context", item: value.item, async: knownDecorators(fn.file, fn.node, ["asynccontextmanager"]) } : void 0;
    if (!d.isAsync) return value;
    const ownScope = fn.file.bindings.scopes.get(fn.node);
    const generator = [...walk(fn.node)].some((node) => [60 /* Yield */, 61 /* YieldFrom */].includes(node.nodeType) && scopeOf(fn.file, node) === ownScope);
    return generator ? value : { kind: "awaitable", item: value };
  }
  function element(value, async = false) {
    if (value?.kind === "sequence" && Boolean(value.async) === async) return value.item;
    if (!async && value?.kind === "tuple") return union(value.items);
    if (!async && value?.kind === "mapping") return value.key;
    return;
  }
  const reference = (node) => node.nodeType === 38 /* Name */ ? node.d.value : node.nodeType === 35 /* MemberAccess */ ? reference(node.d.leftExpr) && `${reference(node.d.leftExpr)}.${node.d.member.d.value}` : void 0;
  function narrowed(file, scope, node, at, value, seen, substitutions) {
    const path = reference(node);
    if (!path || scope.kind !== "function") return value;
    const name = path.split(".")[0];
    const guards = [];
    for (let child = node, parent = node.parent; parent && scopeOf(file, parent) === scope; child = parent, parent = parent.parent) {
      if (parent.nodeType !== 51 /* Ternary */ || child === parent.d.testExpr) continue;
      const test = parent.d.testExpr;
      if (test.nodeType === 7 /* BinaryOperation */ && [39 /* Is */, 40 /* IsNot */].includes(test.d.operator) && test.d.rightExpr.nodeType === 14 /* Constant */ && test.d.rightExpr.d.constType === 27 /* None */)
        guards.push({ test, positive: child === parent.d.ifExpr });
    }
    guards.push(...[...reachingBindings(scope, name, at).guards].reverse());
    while (guards.length) {
      const guard = guards.pop();
      let test = guard.test, positive = guard.positive;
      while (test.nodeType === 55 /* UnaryOperation */ && test.d.operator === 38 /* Not */) {
        positive = !positive;
        test = test.d.expr;
      }
      if (path.includes(".") && (scope.events.get(name) || []).some((event) => event.attributeWrite === path.split(".")[1] && event.at > endOf(guard.test) && event.at <= at)) continue;
      if (test.nodeType === 7 /* BinaryOperation */ && test.d.operator === (positive ? 36 /* And */ : 37 /* Or */)) {
        guards.push({ test: test.d.rightExpr, positive }, { test: test.d.leftExpr, positive });
        continue;
      }
      if (test.nodeType === 9 /* Call */ && nameOf(test.d.leftExpr) === "isinstance" && unshadowed(scope, "isinstance") && test.d.args.length === 2 && test.d.args.every((arg) => !arg.d.name && arg.d.argCategory === 0) && reference(test.d.args[0].d.valueExpr) === path) {
        if (!positive && value?.kind === "union" && standard(file, scope, test.d.args[1].d.valueExpr) === "builtins.str") {
          value = union(value.items.filter((item) => item.kind !== "scalar" || item.type !== "str"));
          continue;
        }
        const type = expression(file, scope, test.d.args[1].d.valueExpr, test.start, seen, substitutions);
        if (type?.kind === "class" && !type.instance) {
          const instance = { ...type, instance: true };
          if (positive) {
            const items = (value?.kind === "union" ? value.items : [value]).filter((item) => item?.kind !== "none");
            value = items.length ? union(items.map((item) => item?.kind === "class" && item.instance && (item.node === type.node || mro(item)?.some((base) => base.node === type.node)) ? item : instance)) : instance;
          } else if (value?.kind === "union") value = union(value.items.filter((item) => !same(item, instance)));
        }
      }
      if (test.nodeType === 7 /* BinaryOperation */ && [39 /* Is */, 40 /* IsNot */].includes(test.d.operator) && reference(test.d.leftExpr) === path && test.d.rightExpr.nodeType === 14 /* Constant */ && test.d.rightExpr.d.constType === 27 /* None */) {
        const isNone = positive === (test.d.operator === 39 /* Is */);
        if (value?.kind === "union") value = union(value.items.filter((item) => item.kind === "none" === isNone));
      }
      if (positive && reference(test) === path && value?.kind === "union") value = union(value.items.filter((item) => item.kind !== "none"));
    }
    return value;
  }
  function expression(file, scope, node, at, seen, substitutions, types = false, lookup) {
    if (seen.has(node) || seen.size > 64) return;
    seen = /* @__PURE__ */ new Set([...seen, node]);
    const d = node.d;
    if (node.nodeType === 38 /* Name */) {
      const value = symbol(file, scope, d.value, at, seen, substitutions, types);
      return types ? value : narrowed(file, scope, node, at, value, seen, substitutions);
    }
    if (node.nodeType === 14 /* Constant */ && d.constType === 27 /* None */) return { kind: "none" };
    if (node.nodeType === 48 /* StringList */ || node.nodeType === 14 /* Constant */) return scalarLiteral(node);
    if (node.nodeType === 3 /* Assignment */) return expression(file, scope, node.d.rightExpr, at, seen, substitutions);
    if (node.nodeType === 52 /* Tuple */) return { kind: "tuple", items: d.items.map((item) => expression(file, scope, item, at, seen, substitutions)) };
    if (node.nodeType === 34 /* List */) {
      if (node.d.items.length === 1 && node.d.items[0].nodeType === 11 /* Comprehension */)
        return expression(file, scope, node.d.items[0], at, seen, substitutions);
      return { kind: "sequence", mutable: true, item: union(d.items.map((item) => expression(file, scope, item, at, seen, substitutions))) };
    }
    if (node.nodeType === 11 /* Comprehension */ && (node.d.isGenerator || node.parent?.nodeType === 34 /* List */)) {
      const item = node.d.expr;
      return { kind: "sequence", mutable: !node.d.isGenerator, item: expression(file, scopeOf(file, item), item, item.start, seen, substitutions) };
    }
    if (node.nodeType === 51 /* Ternary */) {
      const yes = expression(file, scope, node.d.ifExpr, at, seen, substitutions);
      const no = expression(file, scope, node.d.elseExpr, at, seen, substitutions);
      if (emptyList(node.d.ifExpr) && no?.kind === "sequence" && no.mutable) return no;
      if (emptyList(node.d.elseExpr) && yes?.kind === "sequence" && yes.mutable) return yes;
      return union([yes, no]);
    }
    if (node.nodeType === 7 /* BinaryOperation */ && node.d.operator === 37 /* Or */ && emptyList(node.d.rightExpr)) {
      const left = expression(file, scope, node.d.leftExpr, at, seen, substitutions);
      if (left?.kind === "sequence" && left.mutable) return left;
    }
    if (node.nodeType === 6 /* Await */) {
      const value = expression(file, scope, d.expr, at, seen, substitutions);
      return value?.kind === "awaitable" ? value.item : void 0;
    }
    if (node.nodeType === 60 /* Yield */) {
      if (scope.node.nodeType !== 31 /* Function */) return;
      const result = annotation(file, scopeOf(file, scope.node), scope.node.d.returnAnnotation, at, seen, substitutions);
      return result?.kind === "sequence" ? result.send : void 0;
    }
    if (node.nodeType === 27 /* Index */) {
      const { leftExpr, items, trailingComma } = node.d;
      const value = expression(file, scope, leftExpr, at, seen, substitutions);
      if (value?.kind === "mapping") return items.some((item) => item.d.valueExpr.nodeType === 46 /* Slice */) ? void 0 : value.value;
      if (items.length !== 1 || trailingComma) return;
      const index = items[0].d.valueExpr;
      if (index.nodeType === 46 /* Slice */) return value?.kind === "sequence" ? value : void 0;
      if (value?.kind === "sequence" && !value.async) return value.item;
      if (value?.kind === "tuple" && index.nodeType === 40 /* Number */) return value.items[Number(index.d.value)];
      return;
    }
    if (node.nodeType === 35 /* MemberAccess */) {
      if (d.leftExpr.nodeType === 9 /* Call */ && nameOf(d.leftExpr.d.leftExpr) === "super" && !d.leftExpr.d.args.length && unshadowed(scope, "super") && scope.node.nodeType === 31 /* Function */) {
        const owner = scopeOf(file, scope.node);
        const first = scope.node.d.params[0];
        if (owner.kind !== "class" || !first?.d.name) return;
        const receiver = symbol(file, scope, first.d.name.d.value, at, seen, substitutions);
        return receiver?.kind === "class" && receiver.node === owner.node ? member(receiver, d.member.d.value, at, seen, lookup, true) : void 0;
      }
      const left = expression(file, scope, d.leftExpr, at, seen, substitutions, types);
      if (left?.kind === "module") {
        const value2 = symbol(left.file, left.file.bindings.module, d.member.d.value, Infinity, seen, /* @__PURE__ */ new Map(), types);
        if (value2 || left.file.bindings.module.events.has(d.member.d.value) || !/__init__\.pyi?$/.test(left.file.record.path)) return value2;
        const target = locate(left.file.record.path, "", 1, d.member.d.value), other = target && files.get(target.file);
        return target?.module && other ? { kind: "module", file: other } : void 0;
      }
      const declaration = (owner) => owner?.kind === "class" ? d.member.d.value === "__class__" && owner.instance ? { ...owner, instance: false } : member(owner, d.member.d.value, at, seen, lookup) : void 0;
      let value = declaration(left);
      if (left?.kind === "union") {
        const candidates = left.items.map(declaration);
        if (candidates.every((candidate) => same(candidate, candidates[0]))) value = candidates[0];
        else if (!lookup && candidates.every((candidate) => candidate?.kind === "function")) value = union(candidates);
      }
      return types ? value : narrowed(file, scope, node, at, value, seen, substitutions);
    }
    if (node.nodeType === 9 /* Call */) {
      const builtin = standard(file, scope, d.leftExpr);
      const first = d.args[0]?.d.valueExpr;
      const positional = d.args.every((arg) => arg.d.argCategory === 0 /* Simple */ && !arg.d.name);
      if (first && builtin === "typing.cast" && positional && d.args.length === 2)
        return annotation(file, scope, first, at, seen, substitutions);
      if (first && positional && builtin === "weakref.ref" && d.args.length === 1)
        return { kind: "weakRef", item: expression(file, scope, first, at, seen, substitutions) };
      if (first && positional && builtin === "builtins.enumerate" && d.args.length <= 2) {
        const item = element(expression(file, scope, first, at, seen, substitutions));
        return { kind: "sequence", item: { kind: "tuple", items: [void 0, item] } };
      }
      if (first && positional && builtin === "builtins.map" && d.args.length === 2) {
        const factory = expression(file, scope, first, at, seen, substitutions);
        if (factory?.kind === "class" && !factory.instance)
          return { kind: "sequence", item: { ...factory, instance: true } };
      }
      if (first && positional && (d.args.length === 1 || builtin === "builtins.next" && d.args.length === 2) && ["builtins.next", "builtins.iter", "builtins.aiter", "builtins.reversed", "builtins.list", "builtins.tuple", "builtins.sorted", "builtins.dict", "builtins.frozenset"].includes(builtin)) {
        const input = expression(file, scope, first, at, seen, substitutions);
        if (builtin === "builtins.next") return d.args.length === 1 ? element(input) : union([element(input), expression(file, scope, d.args[1].d.valueExpr, at, seen, substitutions)]);
        if (builtin === "builtins.dict") {
          const item = element(input);
          return item?.kind === "tuple" ? { kind: "mapping", key: item.items[0], value: item.items[1] } : input?.kind === "mapping" ? input : void 0;
        }
        return { kind: "sequence", item: element(input, builtin === "builtins.aiter"), async: builtin === "builtins.aiter", mutable: builtin === "builtins.list" || builtin === "builtins.sorted" };
      }
      if (d.leftExpr.nodeType === 35 /* MemberAccess */) {
        const left = expression(file, scope, d.leftExpr.d.leftExpr, at, seen, substitutions), name = d.leftExpr.d.member.d.value;
        if (left?.kind === "scalar" && left.type === "str" && name === "partition" && positional && d.args.length === 1) {
          const separator = expression(file, scope, first, at, seen, substitutions);
          if (separator?.kind !== "scalar" || separator.type !== "str") return;
          const part = { kind: "scalar", type: "str" };
          return { kind: "tuple", items: [part, part, part] };
        }
        if (left?.kind === "contextVar" && name === "get" && positional && d.args.length <= 1)
          return first ? union([left.item, expression(file, scope, first, at, seen, substitutions)]) : left.item;
        if (left?.kind === "mapping" && name === "get" && positional && first && d.args.length <= 2)
          return union([left.value, d.args[1] ? expression(file, scope, d.args[1].d.valueExpr, at, seen, substitutions) : { kind: "none" }]);
        if (left?.kind === "sequence" && left.mutable && name === "pop" && positional && d.args.length <= 1) return left.item;
        if (left?.kind === "sequence" && left.generator && name === "send" && !left.async) return left.item;
        if (left?.kind === "sequence" && left.generator && name === "asend" && left.async) return { kind: "awaitable", item: left.item };
        if (left?.kind === "mapping" && !d.args.length && ["items", "keys", "values"].includes(name)) return { kind: "sequence", item: name === "items" ? { kind: "tuple", items: [left.key, left.value] } : name === "keys" ? left.key : left.value };
      }
      const callee = expression(file, scope, d.leftExpr, at, seen, substitutions);
      if (callee?.kind === "weakRef" && !d.args.length) {
        return node.parent?.nodeType === 35 /* MemberAccess */ && node.parent.d.leftExpr === node ? callee.item : union([callee.item, { kind: "none" }]);
      }
      if (callee?.kind === "class" && !callee.instance) return { ...callee, instance: true };
      const result = (fn) => returns(fn, at, seen, d.args, (argument) => expression(file, scope, argument, at, seen, substitutions));
      if (callee?.kind === "function") return result(callee);
      if (callee?.kind === "union" && callee.items.every((item) => item.kind === "function")) return union(callee.items.map(result));
    }
    return;
  }
  for (const analysis of analyses) {
    if (!analysis.tree) continue;
    const file = analysis;
    const calls = [...walk(file.tree)].filter((node) => node.nodeType === 9 /* Call */).sort((a, b) => a.start - b.start || endOf(a) - endOf(b));
    for (let i = 0; i < calls.length; i++) {
      const node = calls[i], fact = file.record.calls[i];
      if (fact.target || file.bindings.suppressed.has(node)) continue;
      const callee = node.d.leftExpr;
      if (callee.nodeType !== 35 /* MemberAccess */ && callee.nodeType !== 38 /* Name */) continue;
      const scope = scopeOf(file, node);
      let requireDecorator = false;
      let ordinaryBinding = false;
      let known;
      if (callee.nodeType === 38 /* Name */) {
        const name = callee.d.value;
        if (file.bindings.privateCalls.has(node) && name.startsWith("__") && !name.endsWith("__")) continue;
        known = nullableFunction(file, scope, name, node.start);
        requireDecorator = !known && !localCallable(scope, name, node.start);
        if (requireDecorator) {
          const value = file.bindings.lookup(scope, name, node.start);
          ordinaryBinding = Boolean(value && ["function", "import"].includes(value.kind));
          if (!ordinaryBinding && !scope.events.has(name) && !file.bindings.module.events.has(name)) continue;
        }
      }
      const target = known ?? expression(file, scope, callee, node.start, /* @__PURE__ */ new Set(), /* @__PURE__ */ new Map(), false, "callee");
      if (target?.kind !== "function" || target.overloads || !captured.has(target.file.record.path)) continue;
      if (requireDecorator && !target.platformAlternative && (!ordinaryBinding || !knownDecorators(target.file, target.node, callableDecorators) && !signatureDecorators(target.file, target.node, /* @__PURE__ */ new Set()))) continue;
      const fn = target.file.measured?.byNode.get(target.node);
      if (!fn) continue;
      fact.resolution = "python-source-declaration";
      delete fact.reason;
      delete fact._import;
      fact.target = { file: target.file.record.path, name: fn.name, line: fn.line, column: fn.sourceRange.column };
    }
  }
}
export {
  analyzeFile,
  parsePython,
  resolveSourceCalls
};
