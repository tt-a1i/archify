/*
 * tokenizerTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Based on code from vscode-python repository:
 *  https://github.com/Microsoft/vscode-python
 *
 * Interface, enumeration and class definitions used within
 * the Python tokenizer.
 */

import { TextRange } from '../common/textRange.js';

export const enum TokenType {
    Invalid,
    EndOfStream,
    NewLine,
    Indent,
    Dedent,
    String,
    Number,
    Identifier,
    Keyword,
    Operator,
    Colon,
    Semicolon,
    Comma,
    OpenParenthesis,
    CloseParenthesis,
    OpenBracket,
    CloseBracket,
    OpenCurlyBrace,
    CloseCurlyBrace,
    Ellipsis,
    Dot,
    Arrow,
    Backtick,
    ExclamationMark,
    FStringStart,
    FStringMiddle,
    FStringEnd,
}

export const enum NewLineType {
    CarriageReturn,
    LineFeed,
    CarriageReturnLineFeed,
    Implied,
}

export const enum OperatorType {
    // These operators are used with tokens
    // of type TokenType.Operator.
    Add,
    AddEqual,
    Assign,
    BitwiseAnd,
    BitwiseAndEqual,
    BitwiseInvert,
    BitwiseOr,
    BitwiseOrEqual,
    BitwiseXor,
    BitwiseXorEqual,
    Divide,
    DivideEqual,
    Equals,
    FloorDivide,
    FloorDivideEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LeftShift,
    LeftShiftEqual,
    LessOrGreaterThan,
    LessThan,
    LessThanOrEqual,
    MatrixMultiply,
    MatrixMultiplyEqual,
    Mod,
    ModEqual,
    Multiply,
    MultiplyEqual,
    NotEquals,
    Power,
    PowerEqual,
    RightShift,
    RightShiftEqual,
    Subtract,
    SubtractEqual,
    Walrus,

    // These operators are used with tokens
    // of type TokenType.Keyword.
    And,
    Or,
    Not,
    Is,
    IsNot,
    In,
    NotIn,
}

export const enum OperatorFlags {
    Unary = 1 << 0,
    Binary = 1 << 1,
    Assignment = 1 << 2,
    Comparison = 1 << 3,
    Deprecated = 1 << 4,
}

export const enum KeywordType {
    And,
    As,
    Assert,
    Async,
    Await,
    Break,
    Case,
    Class,
    Continue,
    Debug,
    Def,
    Del,
    Elif,
    Else,
    Except,
    False,
    Finally,
    For,
    From,
    Global,
    If,
    Import,
    In,
    Is,
    Lambda,
    Lazy,
    Match,
    None,
    Nonlocal,
    Not,
    Or,
    Pass,
    Raise,
    Return,
    True,
    Try,
    Type,
    While,
    With,
    Yield,
}

export const softKeywords = [
    KeywordType.Debug,
    KeywordType.Match,
    KeywordType.Case,
    KeywordType.Type,
    KeywordType.Lazy,
];

export const enum StringTokenFlags {
    None = 0,

    // Quote types
    SingleQuote = 1 << 0,
    DoubleQuote = 1 << 1,
    Triplicate = 1 << 2,

    // String content format
    Raw = 1 << 3,
    Unicode = 1 << 4,
    Bytes = 1 << 5,
    Format = 1 << 6,
    Template = 1 << 7,

    // Other conditions
    ReplacementFieldStart = 1 << 8,
    ReplacementFieldEnd = 1 << 9,
    NamedUnicodeEscape = 1 << 10,

    // Error conditions
    Unterminated = 1 << 16,
}

export const enum CommentType {
    Regular,
    IPythonMagic,
    IPythonShellEscape,
    IPythonCellMagic,
    IPythonCellShellEscape,
}

export interface Comment extends TextRange {
    readonly type: CommentType;
    readonly value: string;
    readonly start: number;
    readonly length: number;
}

export namespace Comment {
    export function create(start: number, length: number, value: string, type = CommentType.Regular): Comment {
        return { type, start, length, value };
    }
}

export interface TokenBase extends TextRange {
    readonly type: TokenType;

    // Comments prior to the token.
    // Intentionally optional: most tokens have no comments, so omitting this
    // property keeps V8 object size smaller for the common case. Each `create`
    // factory returns a two-shape object (with vs. without `comments`) so that
    // comment-free tokens skip the extra property slot entirely.
    readonly comments?: Comment[] | undefined;
}

export interface Token extends TokenBase {}

export namespace Token {
    export function create(type: TokenType, start: number, length: number, comments: Comment[] | undefined): Token {
        return {
            start,
            length,
            type,
            comments,
        };
    }
}

export interface IndentToken extends Token {
    readonly type: TokenType.Indent;
    readonly indentAmount: number;
    readonly isIndentAmbiguous: boolean;
}

export namespace IndentToken {
    export function create(
        start: number,
        length: number,
        indentAmount: number,
        isIndentAmbiguous: boolean,
        comments: Comment[] | undefined
    ): IndentToken {
        // Two-shape pattern: omit `comments` slot when unused to reduce
        // per-token allocation size. ~95% of tokens carry no comments.
        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.Indent,
                isIndentAmbiguous,
                comments,
                indentAmount,
            };
        }

        return {
            start,
            length,
            type: TokenType.Indent,
            isIndentAmbiguous,
            indentAmount,
        };
    }
}

export interface DedentToken extends Token {
    readonly type: TokenType.Dedent;
    readonly indentAmount: number;
    readonly matchesIndent: boolean;
    readonly isDedentAmbiguous: boolean;
}

export namespace DedentToken {
    export function create(
        start: number,
        length: number,
        indentAmount: number,
        matchesIndent: boolean,
        isDedentAmbiguous: boolean,
        comments: Comment[] | undefined
    ): DedentToken {
        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.Dedent,
                comments,
                indentAmount,
                matchesIndent,
                isDedentAmbiguous,
            };
        }

        return {
            start,
            length,
            type: TokenType.Dedent,
            indentAmount,
            matchesIndent,
            isDedentAmbiguous,
        };
    }
}

export interface NewLineToken extends Token {
    readonly type: TokenType.NewLine;
    readonly newLineType: NewLineType;
}

export namespace NewLineToken {
    export function create(
        start: number,
        length: number,
        newLineType: NewLineType,
        comments: Comment[] | undefined
    ): NewLineToken {
        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.NewLine,
                comments,
                newLineType,
            };
        }

        return {
            start,
            length,
            type: TokenType.NewLine,
            newLineType,
        };
    }
}

export interface KeywordToken extends Token {
    readonly type: TokenType.Keyword;
    readonly keywordType: KeywordType;
}

export namespace KeywordToken {
    export function create(
        start: number,
        length: number,
        keywordType: KeywordType,
        comments: Comment[] | undefined
    ): KeywordToken {
        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.Keyword,
                comments,
                keywordType,
            };
        }

        return {
            start,
            length,
            type: TokenType.Keyword,
            keywordType,
        };
    }

    export function isSoftKeyword(token: KeywordToken) {
        return softKeywords.some((t) => token.keywordType === t);
    }
}

export interface StringToken extends Token {
    readonly type: TokenType.String;
    readonly flags: StringTokenFlags;

    // Use StringTokenUtils to convert escaped value to unescaped value.
    readonly escapedValue: string;

    // Number of characters in token that appear before
    // the quote marks (e.g. "r" or "UR").
    readonly prefixLength: number;

    // Number of characters in token that make up the quote
    // (either 1 or 3).
    readonly quoteMarkLength: number;
}

export namespace StringToken {
    export function create(
        start: number,
        length: number,
        flags: StringTokenFlags,
        escapedValue: string,
        prefixLength: number,
        comments: Comment[] | undefined
    ): StringToken {
        const quoteMarkLength = flags & StringTokenFlags.Triplicate ? 3 : 1;
        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.String,
                flags,
                escapedValue,
                prefixLength,
                quoteMarkLength,
                comments,
            };
        }

        return {
            start,
            length,
            type: TokenType.String,
            flags,
            escapedValue,
            prefixLength,
            quoteMarkLength,
        };
    }
}

export interface FStringStartToken extends Token {
    readonly type: TokenType.FStringStart;
    readonly flags: StringTokenFlags;

    // Number of characters in token that appear before
    // the quote marks (e.g. "r" or "UR").
    readonly prefixLength: number;

    // Number of characters in token that make up the quote
    // (either 1 or 3).
    readonly quoteMarkLength: number;
}

export namespace FStringStartToken {
    export function create(
        start: number,
        length: number,
        flags: StringTokenFlags,
        prefixLength: number,
        comments: Comment[] | undefined
    ): FStringStartToken {
        const quoteMarkLength = flags & StringTokenFlags.Triplicate ? 3 : 1;
        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.FStringStart,
                flags,
                prefixLength,
                quoteMarkLength,
                comments,
            };
        }

        return {
            start,
            length,
            type: TokenType.FStringStart,
            flags,
            prefixLength,
            quoteMarkLength,
        };
    }
}

export interface FStringMiddleToken extends Token {
    readonly type: TokenType.FStringMiddle;
    readonly flags: StringTokenFlags;

    // Use StringTokenUtils to convert escaped value to unescaped value.
    readonly escapedValue: string;
}

export namespace FStringMiddleToken {
    export function create(start: number, length: number, flags: StringTokenFlags, escapedValue: string) {
        const token: FStringMiddleToken = {
            start,
            length,
            type: TokenType.FStringMiddle,
            flags,
            escapedValue,
        };

        return token;
    }
}

export interface FStringEndToken extends Token {
    readonly type: TokenType.FStringEnd;
    readonly flags: StringTokenFlags;
}

export namespace FStringEndToken {
    export function create(start: number, length: number, flags: StringTokenFlags) {
        const token: FStringEndToken = {
            start,
            length,
            type: TokenType.FStringEnd,
            flags,
        };

        return token;
    }
}

export interface NumberToken extends Token {
    readonly type: TokenType.Number;
    readonly value: number | bigint;
    readonly isInteger: boolean;
    readonly isImaginary: boolean;
}

export namespace NumberToken {
    export function create(
        start: number,
        length: number,
        value: number | bigint,
        isInteger: boolean,
        isImaginary: boolean,
        comments: Comment[] | undefined
    ): NumberToken {
        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.Number,
                isInteger,
                isImaginary,
                value,
                comments,
            };
        }

        return {
            start,
            length,
            type: TokenType.Number,
            isInteger,
            isImaginary,
            value,
        };
    }
}

export interface OperatorToken extends Token {
    readonly type: TokenType.Operator;
    readonly operatorType: OperatorType;
}

export namespace OperatorToken {
    export function create(
        start: number,
        length: number,
        operatorType: OperatorType,
        comments: Comment[] | undefined
    ): OperatorToken {
        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.Operator,
                operatorType,
                comments,
            };
        }

        return {
            start,
            length,
            type: TokenType.Operator,
            operatorType,
        };
    }
}

export interface IdentifierToken extends Token {
    readonly type: TokenType.Identifier;
    readonly value: string;
}

export namespace IdentifierToken {
    export function create(
        start: number,
        length: number,
        value: string,
        comments: Comment[] | undefined
    ): IdentifierToken {
        // Perform "NFKC normalization", as per the Python lexical spec.
        let normalizedValue = value;
        for (let i = 0; i < value.length; i++) {
            if (value.charCodeAt(i) > 0x7f) {
                normalizedValue = value.normalize('NFKC');
                break;
            }
        }

        if (comments !== undefined) {
            return {
                start,
                length,
                type: TokenType.Identifier,
                value: normalizedValue,
                comments,
            };
        }

        return {
            start,
            length,
            type: TokenType.Identifier,
            value: normalizedValue,
        };
    }
}
