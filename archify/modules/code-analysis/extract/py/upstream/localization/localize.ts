/*
 * localize.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Code that localizes user-visible strings.
 */

// Archify retains only parser diagnostics, in English.
import enUsStrings from './strings.js';

export class ParameterizedString<T extends {}> {
    constructor(private _formatString: string) {}

    format(params: T): string {
        let str = this._formatString;
        Object.keys(params).forEach((key) => {
            str = str.replace(new RegExp(`{${key}}`, 'g'), (params as any)[key].toString());
        });
        return str;
    }

    getFormatString() {
        return this._formatString;
    }
}

function getRawString(key: string): string {
    const [group, name] = key.split('.');
    const value = (enUsStrings as any)[group]?.[name];
    if (!value) throw new Error(`Missing parser diagnostic: ${key}`);
    return typeof value === 'string' ? value : value.message;
}

export namespace Localizer {
    export namespace Diagnostic {
        export const annotationFormatString = () => getRawString('Diagnostic.annotationFormatString');
        export const annotationSpansStrings = () => getRawString('Diagnostic.annotationSpansStrings');
        export const annotationStringEscape = () => getRawString('Diagnostic.annotationStringEscape');
        export const assignmentExprInSubscript = () => getRawString('Diagnostic.assignmentExprInSubscript');
        export const awaitIllegal = () => getRawString('Diagnostic.awaitIllegal');
        export const backticksIllegal = () => getRawString('Diagnostic.backticksIllegal');
        export const breakInExceptionGroup = () => getRawString('Diagnostic.breakInExceptionGroup');
        export const breakOutsideLoop = () => getRawString('Diagnostic.breakOutsideLoop');
        export const casePatternIsIrrefutable = () => getRawString('Diagnostic.casePatternIsIrrefutable');
        export const classTypeParametersIllegal = () => getRawString('Diagnostic.classTypeParametersIllegal');
        export const comprehensionInDict = () => getRawString('Diagnostic.comprehensionInDict');
        export const comprehensionInSet = () => getRawString('Diagnostic.comprehensionInSet');
        export const continueInExceptionGroup = () => getRawString('Diagnostic.continueInExceptionGroup');
        export const continueOutsideLoop = () => getRawString('Diagnostic.continueOutsideLoop');
        export const defaultValueNotAllowed = () => getRawString('Diagnostic.defaultValueNotAllowed');
        export const dictExpandIllegalInComprehension = () =>
            getRawString('Diagnostic.dictExpandIllegalInComprehension');
        export const dictKeyValuePairs = () => getRawString('Diagnostic.dictKeyValuePairs');
        export const duplicateArgsParam = () => getRawString('Diagnostic.duplicateArgsParam');
        export const duplicateCatchAll = () => getRawString('Diagnostic.duplicateCatchAll');
        export const duplicateKwargsParam = () => getRawString('Diagnostic.duplicateKwargsParam');
        export const duplicateKeywordOnly = () => getRawString('Diagnostic.duplicateKeywordOnly');
        export const duplicateParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.duplicateParam'));
        export const duplicateCapturePatternTarget = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.duplicateCapturePatternTarget'));
        export const duplicateStarPattern = () => getRawString('Diagnostic.duplicateStarPattern');
        export const duplicateStarStarPattern = () => getRawString('Diagnostic.duplicateStarStarPattern');
        export const duplicatePositionOnly = () => getRawString('Diagnostic.duplicatePositionOnly');
        export const duplicateUnpack = () => getRawString('Diagnostic.duplicateUnpack');
        export const exceptionGroupIncompatible = () => getRawString('Diagnostic.exceptionGroupIncompatible');
        export const exceptGroupMismatch = () => getRawString('Diagnostic.exceptGroupMismatch');
        export const exceptGroupRequiresType = () => getRawString('Diagnostic.exceptGroupRequiresType');
        export const exceptRequiresParens = () => getRawString('Diagnostic.exceptRequiresParens');
        export const exceptWithAsRequiresParens = () => getRawString('Diagnostic.exceptWithAsRequiresParens');
        export const expectedAfterDecorator = () => getRawString('Diagnostic.expectedAfterDecorator');
        export const expectedArrow = () => getRawString('Diagnostic.expectedArrow');
        export const expectedAssignRightHandExpr = () => getRawString('Diagnostic.expectedAssignRightHandExpr');
        export const expectedBinaryRightHandExpr = () => getRawString('Diagnostic.expectedBinaryRightHandExpr');
        export const expectedCase = () => getRawString('Diagnostic.expectedCase');
        export const expectedClassName = () => getRawString('Diagnostic.expectedClassName');
        export const expectedCloseBrace = () => getRawString('Diagnostic.expectedCloseBrace');
        export const expectedCloseBracket = () => getRawString('Diagnostic.expectedCloseBracket');
        export const expectedCloseParen = () => getRawString('Diagnostic.expectedCloseParen');
        export const expectedColon = () => getRawString('Diagnostic.expectedColon');
        export const expectedComplexNumberLiteral = () => getRawString('Diagnostic.expectedComplexNumberLiteral');
        export const expectedDecoratorExpr = () => getRawString('Diagnostic.expectedDecoratorExpr');
        export const expectedDecoratorNewline = () => getRawString('Diagnostic.expectedDecoratorNewline');
        export const expectedDelExpr = () => getRawString('Diagnostic.expectedDelExpr');
        export const expectedElse = () => getRawString('Diagnostic.expectedElse');
        export const expectedEquals = () => getRawString('Diagnostic.expectedEquals');
        export const expectedExpr = () => getRawString('Diagnostic.expectedExpr');
        export const expectedIdentifier = () => getRawString('Diagnostic.expectedIdentifier');
        export const expectedImport = () => getRawString('Diagnostic.expectedImport');
        export const expectedImportAlias = () => getRawString('Diagnostic.expectedImportAlias');
        export const expectedImportSymbols = () => getRawString('Diagnostic.expectedImportSymbols');
        export const expectedIndentedBlock = () => getRawString('Diagnostic.expectedIndentedBlock');
        export const expectedIn = () => getRawString('Diagnostic.expectedIn');
        export const expectedInExpr = () => getRawString('Diagnostic.expectedInExpr');
        export const expectedFunctionAfterAsync = () => getRawString('Diagnostic.expectedFunctionAfterAsync');
        export const expectedFunctionName = () => getRawString('Diagnostic.expectedFunctionName');
        export const expectedMemberName = () => getRawString('Diagnostic.expectedMemberName');
        export const expectedModuleName = () => getRawString('Diagnostic.expectedModuleName');
        export const expectedNameAfterAs = () => getRawString('Diagnostic.expectedNameAfterAs');
        export const expectedNamedParameter = () => getRawString('Diagnostic.expectedNamedParameter');
        export const expectedNewline = () => getRawString('Diagnostic.expectedNewline');
        export const expectedNewlineOrSemicolon = () => getRawString('Diagnostic.expectedNewlineOrSemicolon');
        export const expectedOpenParen = () => getRawString('Diagnostic.expectedOpenParen');
        export const expectedParamName = () => getRawString('Diagnostic.expectedParamName');
        export const expectedPatternExpr = () => getRawString('Diagnostic.expectedPatternExpr');
        export const expectedPatternValue = () => getRawString('Diagnostic.expectedPatternValue');
        export const expectedReturnExpr = () => getRawString('Diagnostic.expectedReturnExpr');
        export const expectedSliceIndex = () => getRawString('Diagnostic.expectedSliceIndex');
        export const expectedTypeParameterName = () => getRawString('Diagnostic.expectedTypeParameterName');
        export const expectedYieldExpr = () => getRawString('Diagnostic.expectedYieldExpr');
        export const finallyBreak = () => getRawString('Diagnostic.finallyBreak');
        export const finallyContinue = () => getRawString('Diagnostic.finallyContinue');
        export const finallyReturn = () => getRawString('Diagnostic.finallyReturn');
        export const formatStringBrace = () => getRawString('Diagnostic.formatStringBrace');
        export const formatStringBytes = () => getRawString('Diagnostic.formatStringBytes');
        export const formatStringDebuggingIllegal = () => getRawString('Diagnostic.formatStringDebuggingIllegal');
        export const formatStringExpectedConversion = () => getRawString('Diagnostic.formatStringExpectedConversion');
        export const formatStringInPattern = () => getRawString('Diagnostic.formatStringInPattern');
        export const formatStringIllegal = () => getRawString('Diagnostic.formatStringIllegal');
        export const formatStringNestedFormatSpecifier = () =>
            getRawString('Diagnostic.formatStringNestedFormatSpecifier');
        export const formatStringTemplate = () => getRawString('Diagnostic.formatStringTemplate');
        export const formatStringUnicode = () => getRawString('Diagnostic.formatStringUnicode');
        export const formatStringUnterminated = () => getRawString('Diagnostic.formatStringUnterminated');
        export const functionTypeParametersIllegal = () => getRawString('Diagnostic.functionTypeParametersIllegal');
        export const generatorNotParenthesized = () => getRawString('Diagnostic.generatorNotParenthesized');
        export const inconsistentIndent = () => getRawString('Diagnostic.inconsistentIndent');
        export const inconsistentTabs = () => getRawString('Diagnostic.inconsistentTabs');
        export const invalidIdentifierChar = () => getRawString('Diagnostic.invalidIdentifierChar');
        export const invalidTokenChars = () =>
            new ParameterizedString<{ text: string }>(getRawString('Diagnostic.invalidTokenChars'));
        export const keyValueInSet = () => getRawString('Diagnostic.keyValueInSet');
        export const keywordOnlyAfterArgs = () => getRawString('Diagnostic.keywordOnlyAfterArgs');
        export const keywordParameterMissing = () => getRawString('Diagnostic.keywordParameterMissing');
        export const keywordSubscriptIllegal = () => getRawString('Diagnostic.keywordSubscriptIllegal');
        export const lazyImportIllegal = () => getRawString('Diagnostic.lazyImportIllegal');
        export const lazyImportWildcardIllegal = () => getRawString('Diagnostic.lazyImportWildcardIllegal');
        export const matchIncompatible = () => getRawString('Diagnostic.matchIncompatible');
        export const maxParseDepthExceeded = () => getRawString('Diagnostic.maxParseDepthExceeded');
        export const namedExceptAfterCatchAll = () => getRawString('Diagnostic.namedExceptAfterCatchAll');
        export const nonDefaultAfterDefault = () => getRawString('Diagnostic.nonDefaultAfterDefault');
        export const operatorLessOrGreaterDeprecated = () => getRawString('Diagnostic.operatorLessOrGreaterDeprecated');
        export const orPatternIrrefutable = () => getRawString('Diagnostic.orPatternIrrefutable');
        export const orPatternMissingName = () => getRawString('Diagnostic.orPatternMissingName');
        export const paramAfterKwargsParam = () => getRawString('Diagnostic.paramAfterKwargsParam');
        export const parenthesizedContextManagerIllegal = () =>
            getRawString('Diagnostic.parenthesizedContextManagerIllegal');
        export const positionArgAfterNamedArg = () => getRawString('Diagnostic.positionArgAfterNamedArg');
        export const positionArgAfterUnpackedDictArg = () => getRawString('Diagnostic.positionArgAfterUnpackedDictArg');
        export const positionOnlyAfterArgs = () => getRawString('Diagnostic.positionOnlyAfterArgs');
        export const positionOnlyAfterKeywordOnly = () => getRawString('Diagnostic.positionOnlyAfterKeywordOnly');
        export const positionOnlyIncompatible = () => getRawString('Diagnostic.positionOnlyIncompatible');
        export const positionOnlyFirstParam = () => getRawString('Diagnostic.positionOnlyFirstParam');
        export const relativeImportNotAllowed = () => getRawString('Diagnostic.relativeImportNotAllowed');
        export const returnInExceptionGroup = () => getRawString('Diagnostic.returnInExceptionGroup');
        export const returnOutsideFunction = () => getRawString('Diagnostic.returnOutsideFunction');
        export const starPatternInAsPattern = () => getRawString('Diagnostic.starPatternInAsPattern');
        export const starPatternInOrPattern = () => getRawString('Diagnostic.starPatternInOrPattern');
        export const starStarWildcardNotAllowed = () => getRawString('Diagnostic.starStarWildcardNotAllowed');
        export const stringNonAsciiBytes = () => getRawString('Diagnostic.stringNonAsciiBytes');
        export const stringUnterminated = () => getRawString('Diagnostic.stringUnterminated');
        export const sublistParamsIncompatible = () => getRawString('Diagnostic.sublistParamsIncompatible');
        export const templateStringBytes = () => getRawString('Diagnostic.templateStringBytes');
        export const templateStringIllegal = () => getRawString('Diagnostic.templateStringIllegal');
        export const templateStringUnicode = () => getRawString('Diagnostic.templateStringUnicode');
        export const trailingCommaInFromImport = () => getRawString('Diagnostic.trailingCommaInFromImport');
        export const tryWithoutExcept = () => getRawString('Diagnostic.tryWithoutExcept');
        export const typeAliasStatementIllegal = () => getRawString('Diagnostic.typeAliasStatementIllegal');
        export const typeParameterBoundNotAllowed = () => getRawString('Diagnostic.typeParameterBoundNotAllowed');
        export const typeParametersMissing = () => getRawString('Diagnostic.typeParametersMissing');
        export const typeVarDefaultIllegal = () => getRawString('Diagnostic.typeVarDefaultIllegal');
        export const unexpectedAsyncToken = () => getRawString('Diagnostic.unexpectedAsyncToken');
        export const unexpectedEof = () => getRawString('Diagnostic.unexpectedEof');
        export const unexpectedExprToken = () => getRawString('Diagnostic.unexpectedExprToken');
        export const unexpectedIndent = () => getRawString('Diagnostic.unexpectedIndent');
        export const unexpectedUnindent = () => getRawString('Diagnostic.unexpectedUnindent');
        export const unpackedDictSubscriptIllegal = () => getRawString('Diagnostic.unpackedDictSubscriptIllegal');
        export const unpackedSubscriptIllegal = () => getRawString('Diagnostic.unpackedSubscriptIllegal');
        export const unpackIllegalInComprehension = () => getRawString('Diagnostic.unpackIllegalInComprehension');
        export const unpackInDict = () => getRawString('Diagnostic.unpackInDict');
        export const unpackInSet = () => getRawString('Diagnostic.unpackInSet');
        export const unpackOperatorNotAllowed = () => getRawString('Diagnostic.unpackOperatorNotAllowed');
        export const unpackTuplesIllegal = () => getRawString('Diagnostic.unpackTuplesIllegal');
        export const varAnnotationIllegal = () => getRawString('Diagnostic.varAnnotationIllegal');
        export const walrusIllegal = () => getRawString('Diagnostic.walrusIllegal');
        export const walrusNotAllowed = () => getRawString('Diagnostic.walrusNotAllowed');
        export const walrusNotAllowedInComprehension = () => getRawString('Diagnostic.walrusNotAllowedInComprehension');
        export const yieldFromIllegal = () => getRawString('Diagnostic.yieldFromIllegal');
        export const zeroCaseStatementsFound = () => getRawString('Diagnostic.zeroCaseStatementsFound');
    }
    export namespace DiagnosticAddendum {
        export const orPatternMissingName = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.orPatternMissingName'));
    }
}
export const LocMessage = Localizer.Diagnostic;
export const LocAddendum = Localizer.DiagnosticAddendum;
