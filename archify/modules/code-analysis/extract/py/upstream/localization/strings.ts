// Parser diagnostic data from microsoft/pyright 1.1.414, MIT.
// Copyright (c) Microsoft Corporation. English parser-only subset.
export default {
    "Diagnostic": {
        "annotationFormatString": {
            "message": "Type expressions cannot use format string literals (f-strings)",
            "comment": "'f-string' is the common English slang for a Python format string"
        },
        "annotationSpansStrings": "Type expressions cannot span multiple string literals",
        "annotationStringEscape": "Type expressions cannot contain escape characters",
        "assignmentExprInSubscript": "Assignment expressions within a subscript are supported only in Python 3.10 and newer",
        "awaitIllegal": {
            "message": "Use of \"await\" requires Python 3.5 or newer",
            "comment": "{Locked='await'}"
        },
        "backticksIllegal": {
            "message": "Expressions surrounded by backticks are not supported in Python 3.x; use repr instead",
            "comment": "{Locked='repr'}"
        },
        "breakInExceptionGroup": {
            "message": "\"break\" is not allowed in an \"except*\" block",
            "comment": "{Locked='break','except*'}"
        },
        "breakOutsideLoop": {
            "message": "\"break\" can be used only within a loop",
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
            "message": "\"continue\" is not allowed in an \"except*\" block",
            "comment": "{Locked='continue','except*'}"
        },
        "continueOutsideLoop": {
            "message": "\"continue\" can be used only within a loop",
            "comment": "{Locked='continue'}"
        },
        "defaultValueNotAllowed": "Parameter with \"*\" or \"**\" cannot have default value",
        "dictExpandIllegalInComprehension": {
            "message": "Dictionary expansion not allowed in comprehension",
            "comment": "A comprehension is a 'set of looping and filtering instructions' applied to a collection to generate a new collection; the word may not be translatable"
        },
        "dictKeyValuePairs": "Dictionary entries must contain key/value pairs",
        "duplicateArgsParam": "Only one \"*\" parameter allowed",
        "duplicateCatchAll": {
            "message": "Only one catch-all except clause allowed",
            "comment": "{Locked='except'}"
        },
        "duplicateKwargsParam": "Only one \"**\" parameter allowed",
        "duplicateKeywordOnly": "Only one \"*\" separator allowed",
        "duplicateParam": "Duplicate parameter \"{name}\"",
        "duplicateCapturePatternTarget": "Capture target \"{name}\" cannot appear more than once within the same pattern",
        "duplicateStarPattern": "Only one \"*\" pattern allowed in a pattern sequence",
        "duplicateStarStarPattern": "Only one \"**\" entry allowed",
        "duplicatePositionOnly": "Only one \"/\" parameter allowed",
        "duplicateUnpack": {
            "message": "Only one unpack operation allowed in list",
            "comment": "{Locked='list'}"
        },
        "exceptionGroupIncompatible": {
            "message": "Exception group syntax (\"except*\") requires Python 3.11 or newer",
            "comment": "{Locked='except*'}"
        },
        "exceptGroupMismatch": {
            "message": "Try statement cannot include both \"except\" and \"except*\"",
            "comment": "{Locked='except','except*'}"
        },
        "exceptGroupRequiresType": {
            "message": "Exception group syntax (\"except*\") requires an exception type",
            "comment": "{Locked='except*'}"
        },
        "exceptRequiresParens": "Multiple exception types must be parenthesized prior to Python 3.14",
        "exceptWithAsRequiresParens": "Multiple exception types must be parenthesized when using \"as\"",
        "expectedAfterDecorator": "Expected function or class declaration after decorator",
        "expectedArrow": "Expected \"->\" followed by return type annotation",
        "expectedAssignRightHandExpr": "Expected expression to the right of \"=\"",
        "expectedBinaryRightHandExpr": "Expected expression to the right of operator",
        "expectedCase": {
            "message": "Expected \"case\" statement",
            "comment": "{Locked='case'}"
        },
        "expectedClassName": "Expected class name",
        "expectedCloseBrace": "\"{\" was not closed",
        "expectedCloseBracket": "\"[\" was not closed",
        "expectedCloseParen": "\"(\" was not closed",
        "expectedColon": "Expected \":\"",
        "expectedComplexNumberLiteral": {
            "message": "Expected complex number literal for pattern matching",
            "comment": "Complex numbers are a mathematical concept consisting of a real number and an imaginary number"
        },
        "expectedDecoratorExpr": "Expression form not supported for decorator prior to Python 3.9",
        "expectedDecoratorNewline": "Expected new line at end of decorator",
        "expectedDelExpr": {
            "message": "Expected expression after \"del\"",
            "comment": "{Locked='del'}"
        },
        "expectedElse": {
            "message": "Expected \"else\"",
            "comment": "{Locked='else'}"
        },
        "expectedEquals": "Expected \"=\"",
        "expectedExpr": "Expected expression",
        "expectedIdentifier": "Expected identifier",
        "expectedImport": {
            "message": "Expected \"import\"",
            "comment": "{Locked='import'}"
        },
        "expectedImportAlias": {
            "message": "Expected symbol after \"as\"",
            "comment": "{Locked='as'}"
        },
        "expectedImportSymbols": {
            "message": "Expected one or more symbol names after \"import\"",
            "comment": "{Locked='import'}"
        },
        "expectedIndentedBlock": "Expected indented block",
        "expectedIn": {
            "message": "Expected \"in\"",
            "comment": "{Locked='in'}"
        },
        "expectedInExpr": {
            "message": "Expected expression after \"in\"",
            "comment": "{Locked='in'}"
        },
        "expectedFunctionAfterAsync": {
            "message": "Expected function definition after \"async\"",
            "comment": "{Locked='async'}"
        },
        "expectedFunctionName": {
            "message": "Expected function name after \"def\"",
            "comment": "{Locked='def'}"
        },
        "expectedMemberName": "Expected attribute name after \".\"",
        "expectedModuleName": "Expected module name",
        "expectedNameAfterAs": {
            "message": "Expected symbol name after \"as\"",
            "comment": "{Locked='as'}"
        },
        "expectedNamedParameter": "Keyword parameter must follow \"*\"",
        "expectedNewline": "Expected newline",
        "expectedNewlineOrSemicolon": "Statements must be separated by newlines or semicolons",
        "expectedOpenParen": "Expected \"(\"",
        "expectedParamName": "Expected parameter name",
        "expectedPatternExpr": "Expected pattern expression",
        "expectedPatternValue": {
            "message": "Expected pattern value expression of the form \"a.b\"",
            "comment": "{Locked='a.b'}"
        },
        "expectedReturnExpr": {
            "message": "Expected expression after \"return\"",
            "comment": "{Locked='return'}"
        },
        "expectedSliceIndex": "Expected index or slice expression",
        "expectedTypeParameterName": "Expected type parameter name",
        "expectedYieldExpr": {
            "message": "Expected expression in yield statement",
            "comment": "{Locked='yield'}"
        },
        "finallyBreak": {
            "message": "A \"break\" cannot be used to exit a \"finally\" block",
            "comment": "{Locked='break', 'finally'}"
        },
        "finallyContinue": {
            "message": "A \"continue\" cannot be used to exit a \"finally\" block",
            "comment": "{Locked='continue', 'finally'}"
        },
        "finallyReturn": {
            "message": "A \"return\" cannot be used to exit a \"finally\" block",
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
            "message": "F-string debugging specifier \"=\" requires Python 3.8 or newer",
            "comment": "'f-string' is the common English slang for a Python format string"
        },
        "formatStringExpectedConversion": {
            "message": "Expected a conversion specifier after \"!\" in f-string",
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
            "message": "Unterminated expression in f-string; expecting \"}\"",
            "comment": "'f-string' is the common English slang for a Python format string"
        },
        "functionTypeParametersIllegal": "Function type parameter syntax requires Python 3.12 or newer",
        "generatorNotParenthesized": "Generator expressions must be parenthesized if not sole argument",
        "inconsistentIndent": "Unindent amount does not match previous indent",
        "inconsistentTabs": "Inconsistent use of tabs and spaces in indentation",
        "invalidIdentifierChar": "Invalid character in identifier",
        "invalidTokenChars": "Invalid character \"{text}\" in token",
        "keyValueInSet": {
            "message": "Key/value pairs are not allowed within a set",
            "comment": "{Locked='set'}"
        },
        "keywordOnlyAfterArgs": "Keyword-only argument separator not allowed after \"*\" parameter",
        "keywordParameterMissing": "One or more keyword parameters must follow \"*\" parameter",
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
        "operatorLessOrGreaterDeprecated": "Operator \"<>\" is not supported in Python 3; use \"!=\" instead",
        "orPatternIrrefutable": {
            "message": "Irrefutable pattern allowed only as the last subpattern in an \"or\" pattern",
            "comment": "{Locked='or'}"
        },
        "orPatternMissingName": {
            "message": "All subpatterns within an \"or\" pattern must target the same names",
            "comment": "{Locked='or'}"
        },
        "paramAfterKwargsParam": "Parameter cannot follow \"**\" parameter",
        "parenthesizedContextManagerIllegal": {
            "message": "Parentheses within \"with\" statement requires Python 3.9 or newer",
            "comment": "{Locked='with'}"
        },
        "positionArgAfterNamedArg": "Positional argument cannot appear after keyword arguments",
        "positionArgAfterUnpackedDictArg": "Positional argument cannot appear after keyword argument unpacking",
        "positionOnlyAfterArgs": "Position-only parameter separator not allowed after \"*\" parameter",
        "positionOnlyAfterKeywordOnly": "\"/\" parameter must appear before \"*\" parameter",
        "positionOnlyIncompatible": "Position-only parameter separator requires Python 3.8 or newer",
        "positionOnlyFirstParam": "Position-only parameter separator not allowed as first parameter",
        "relativeImportNotAllowed": {
            "message": "Relative imports cannot be used with \"import .a\" form; use \"from . import a\" instead",
            "comment": "{Locked='import .a','from . import a'}"
        },
        "returnInExceptionGroup": {
            "message": "\"return\" is not allowed in an \"except*\" block",
            "comment": "{Locked='return','except*'}"
        },
        "returnOutsideFunction": {
            "message": "\"return\" can be used only within a function",
            "comment": "{Locked='return'}"
        },
        "starPatternInAsPattern": {
            "message": "Star pattern cannot be used with \"as\" target",
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
        "starStarWildcardNotAllowed": "** cannot be used with wildcard \"_\"",
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
            "message": "Expected \"def\", \"with\" or \"for\" to follow \"async\"",
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
        "walrusIllegal": "Operator \":=\" requires Python 3.8 or newer",
        "walrusNotAllowed": "Operator \":=\" is not allowed in this context without surrounding parentheses",
        "walrusNotAllowedInComprehension": "Operator \":=\" is not allowed within a comprehension iterable expression",
        "yieldFromIllegal": {
            "message": "Use of \"yield from\" requires Python 3.3 or newer",
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
} as const;
