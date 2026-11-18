/*
 * parseNodes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Definition of parse nodes that make up the Python abstract
 * syntax tree (AST).
 */

import { TextRange } from '../common/textRange.js';
import {
    FStringEndToken,
    FStringMiddleToken,
    FStringStartToken,
    IdentifierToken,
    KeywordToken,
    KeywordType,
    NumberToken,
    OperatorType,
    StringToken,
    Token,
    TokenType,
} from './tokenizerTypes.js';

export const enum ParseNodeType {
    Error, // 0

    Argument,
    Assert,
    Assignment,
    AssignmentExpression,
    AugmentedAssignment,
    Await,
    BinaryOperation,
    Break,
    Call,

    Class, // 10
    Comprehension,
    ComprehensionFor,
    ComprehensionIf,
    Constant,
    Continue,
    Decorator,
    Del,
    Dictionary,
    DictionaryExpandEntry,

    DictionaryKeyEntry, // 20
    Ellipsis,
    If,
    Import,
    ImportAs,
    ImportFrom,
    ImportFromAs,
    Index,
    Except,
    For,

    FormatString, // 30
    Function,
    Global,
    Lambda,
    List,
    MemberAccess,
    Module,
    ModuleName,
    Name,
    Nonlocal,

    Number, // 40
    Parameter,
    Pass,
    Raise,
    Return,
    Set,
    Slice,
    StatementList,
    StringList,
    String,

    Suite, // 50
    Ternary,
    Tuple,
    Try,
    TypeAnnotation,
    UnaryOperation,
    Unpack,
    While,
    With,
    WithItem,

    Yield, // 60
    YieldFrom,
    FunctionAnnotation,
    Match,
    Case,
    PatternSequence,
    PatternAs,
    PatternLiteral,
    PatternClass,
    PatternCapture,

    PatternMapping, // 70
    PatternMappingKeyEntry,
    PatternMappingExpandEntry,
    PatternValue,
    PatternClassArgument,
    TypeParameter,
    TypeParameterList,
    TypeAlias,
}

export const enum ErrorExpressionCategory {
    MissingIn,
    MissingElse,
    MissingExpression,
    MissingIndexOrSlice,
    MissingDecoratorCallName,
    MissingCallCloseParen,
    MissingIndexCloseBracket,
    MissingMemberAccessName,
    MissingTupleCloseParen,
    MissingListCloseBracket,
    MissingFunctionParameterList,
    MissingPattern,
    MissingPatternSubject,
    MissingDictValue,
    MissingKeywordArgValue,
    MaxDepthExceeded,
}

export interface ParseNodeBase<T extends ParseNodeType> {
    readonly nodeType: T;
    readonly start: number;
    readonly length: number;

    // A unique ID given to each parse node.
    id: number;

    parent: ParseNode | undefined;

    // Additional details that are specific to the parse node type.
    d: object;
}

let _nextNodeId = 1;
export function getNextNodeId() {
    return _nextNodeId++;
}

export function extendRange(node: ParseNodeBase<any>, newRange: TextRange) {
    const extendedRange = TextRange.extend(node, newRange);

    // Temporarily allow writes to the range fields.
    (node as any).start = extendedRange.start;
    (node as any).length = extendedRange.length;
}

export type ParseNodeArray = (ParseNode | undefined)[];

export interface ModuleNode extends ParseNodeBase<ParseNodeType.Module> {
    d: {
        statements: StatementNode[];
    };
}

export namespace ModuleNode {
    export function create(range: TextRange) {
        const node: ModuleNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Module,
            id: _nextNodeId++,
            parent: undefined,
            d: { statements: [] },
        };
        return node;
    }
}

export interface SuiteNode extends ParseNodeBase<ParseNodeType.Suite> {
    d: {
        statements: StatementNode[];
        typeComment: StringToken | undefined;
    };
}

export namespace SuiteNode {
    export function create(range: TextRange) {
        const node: SuiteNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Suite,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                statements: [],
                typeComment: undefined,
            },
        };

        return node;
    }
}

export interface IfNode extends ParseNodeBase<ParseNodeType.If> {
    d: {
        firstToken: Token;
        testExpr: ExpressionNode;
        ifSuite: SuiteNode;
        elseSuite: SuiteNode | IfNode | undefined;
    };
}

export namespace IfNode {
    export function create(
        ifOrElifToken: Token,
        testExpr: ExpressionNode,
        ifSuite: SuiteNode,
        elseSuite?: SuiteNode
    ) {
        const node: IfNode = {
            start: ifOrElifToken.start,
            length: ifOrElifToken.length,
            nodeType: ParseNodeType.If,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: ifOrElifToken,
                testExpr,
                ifSuite: ifSuite,
                elseSuite: elseSuite,
            },
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
}

export interface WhileNode extends ParseNodeBase<ParseNodeType.While> {
    d: {
        firstToken: Token;
        testExpr: ExpressionNode;
        whileSuite: SuiteNode;
        elseSuite?: SuiteNode | undefined;
    };
}

export namespace WhileNode {
    export function create(whileToken: Token, testExpr: ExpressionNode, whileSuite: SuiteNode) {
        const node: WhileNode = {
            start: whileToken.start,
            length: whileToken.length,
            nodeType: ParseNodeType.While,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: whileToken,
                testExpr,
                whileSuite,
            },
        };

        testExpr.parent = node;
        whileSuite.parent = node;

        extendRange(node, whileSuite);

        return node;
    }
}

export interface ForNode extends ParseNodeBase<ParseNodeType.For> {
    d: {
        firstToken: Token;
        isAsync?: boolean;
        asyncToken?: Token;
        targetExpr: ExpressionNode;
        iterableExpr: ExpressionNode;
        forSuite: SuiteNode;
        elseSuite?: SuiteNode | undefined;
        typeComment?: StringToken;
    };
}

export namespace ForNode {
    export function create(
        forToken: Token,
        targetExpr: ExpressionNode,
        iterableExpr: ExpressionNode,
        forSuite: SuiteNode
    ) {
        const node: ForNode = {
            start: forToken.start,
            length: forToken.length,
            nodeType: ParseNodeType.For,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: forToken,
                targetExpr,
                iterableExpr,
                forSuite,
            },
        };

        targetExpr.parent = node;
        iterableExpr.parent = node;
        forSuite.parent = node;

        extendRange(node, forSuite);

        return node;
    }
}

export type ComprehensionForIfNode = ComprehensionForNode | ComprehensionIfNode;

export interface ComprehensionForNode extends ParseNodeBase<ParseNodeType.ComprehensionFor> {
    d: {
        isAsync?: boolean;
        asyncToken?: Token;
        targetExpr: ExpressionNode;
        iterableExpr: ExpressionNode;
    };
}

export namespace ComprehensionForNode {
    export function create(
        startToken: Token,
        targetExpr: ExpressionNode,
        iterableExpr: ExpressionNode
    ) {
        const node: ComprehensionForNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.ComprehensionFor,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                targetExpr,
                iterableExpr,
            },
        };

        targetExpr.parent = node;
        iterableExpr.parent = node;

        extendRange(node, targetExpr);
        extendRange(node, iterableExpr);

        return node;
    }
}

export interface ComprehensionIfNode extends ParseNodeBase<ParseNodeType.ComprehensionIf> {
    d: {
        testExpr: ExpressionNode;
    };
}

export namespace ComprehensionIfNode {
    export function create(ifToken: Token, testExpr: ExpressionNode) {
        const node: ComprehensionIfNode = {
            start: ifToken.start,
            length: ifToken.length,
            nodeType: ParseNodeType.ComprehensionIf,
            id: _nextNodeId++,
            parent: undefined,
            d: { testExpr },
        };

        testExpr.parent = node;

        extendRange(node, testExpr);

        return node;
    }
}

export interface TryNode extends ParseNodeBase<ParseNodeType.Try> {
    d: {
        firstToken: Token;
        trySuite: SuiteNode;
        exceptClauses: ExceptNode[];
        elseSuite?: SuiteNode | undefined;
        finallySuite?: SuiteNode | undefined;
    };
}

export namespace TryNode {
    export function create(tryToken: Token, trySuite: SuiteNode) {
        const node: TryNode = {
            start: tryToken.start,
            length: tryToken.length,
            nodeType: ParseNodeType.Try,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: tryToken,
                trySuite: trySuite,
                exceptClauses: [],
            },
        };

        trySuite.parent = node;

        extendRange(node, trySuite);

        return node;
    }
}

export interface ExceptNode extends ParseNodeBase<ParseNodeType.Except> {
    d: {
        typeExpr?: ExpressionNode | undefined;
        name?: NameNode | undefined;
        exceptSuite: SuiteNode;
        isExceptGroup: boolean;
        exceptToken: Token;
    };
}

export namespace ExceptNode {
    export function create(exceptToken: Token, exceptSuite: SuiteNode, isExceptGroup: boolean) {
        const node: ExceptNode = {
            start: exceptToken.start,
            length: exceptToken.length,
            nodeType: ParseNodeType.Except,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                exceptSuite: exceptSuite,
                isExceptGroup: isExceptGroup,
                exceptToken,
            },
        };

        exceptSuite.parent = node;

        extendRange(node, exceptSuite);

        return node;
    }
}

export interface FunctionNode extends ParseNodeBase<ParseNodeType.Function> {
    d: {
        firstToken: Token;
        decorators: DecoratorNode[];
        isAsync: boolean;
        name: NameNode;
        typeParams: TypeParameterListNode | undefined;
        params: ParameterNode[];
        returnAnnotation: ExpressionNode | undefined;
        funcAnnotationComment: FunctionAnnotationNode | undefined;
        suite: SuiteNode;
    };
}

export namespace FunctionNode {
    export function create(
        defToken: Token,
        name: NameNode,
        suite: SuiteNode,
        typeParams?: TypeParameterListNode
    ) {
        const node: FunctionNode = {
            start: defToken.start,
            length: defToken.length,
            nodeType: ParseNodeType.Function,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: defToken,
                decorators: [],
                isAsync: false,
                name: name,
                typeParams,
                params: [],
                returnAnnotation: undefined,
                funcAnnotationComment: undefined,
                suite: suite,
            },
        };

        name.parent = node;
        suite.parent = node;

        if (typeParams) {
            typeParams.parent = node;
        }

        extendRange(node, suite);

        return node;
    }
}

export const enum ParamCategory {
    Simple,
    ArgsList,
    KwargsDict,
}

export interface ParameterNode extends ParseNodeBase<ParseNodeType.Parameter> {
    d: {
        category: ParamCategory;
        name: NameNode | undefined;
        annotation: ExpressionNode | undefined;
        annotationComment: ExpressionNode | undefined;
        defaultValue: ExpressionNode | undefined;
    };
}

export namespace ParameterNode {
    export function create(startToken: Token, paramCategory: ParamCategory) {
        const node: ParameterNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.Parameter,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                category: paramCategory,
                name: undefined,
                annotation: undefined,
                annotationComment: undefined,
                defaultValue: undefined,
            },
        };

        return node;
    }
}

export interface ClassNode extends ParseNodeBase<ParseNodeType.Class> {
    d: {
        firstToken: Token;
        decorators: DecoratorNode[];
        name: NameNode;
        typeParams: TypeParameterListNode | undefined;
        arguments: ArgumentNode[];
        suite: SuiteNode;
    };
}

export namespace ClassNode {
    export function create(
        classToken: Token,
        name: NameNode,
        suite: SuiteNode,
        typeParams?: TypeParameterListNode
    ) {
        const node: ClassNode = {
            start: classToken.start,
            length: classToken.length,
            nodeType: ParseNodeType.Class,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: classToken,
                decorators: [],
                name: name,
                typeParams,
                arguments: [],
                suite: suite,
            },
        };

        name.parent = node;
        suite.parent = node;

        if (typeParams) {
            typeParams.parent = node;
        }

        extendRange(node, suite);

        return node;
    }

    // This variant is used to create a dummy class
    // when the parser encounters decorators with no
    // function or class declaration.
    export function createDummyForDecorators(decorators: DecoratorNode[]) {
        const node: ClassNode = {
            start: decorators[0].start,
            length: 0,
            nodeType: ParseNodeType.Class,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: {
                    type: TokenType.Keyword,
                    start: 0,
                    length: 0,
                },
                decorators,
                name: {
                    start: decorators[0].start,
                    length: 0,
                    nodeType: ParseNodeType.Name,
                    id: 0,
                    parent: undefined,
                    d: {
                        token: {
                            type: TokenType.Identifier,
                            start: 0,
                            length: 0,
                            value: '',
                        },
                        value: '',
                    },
                },
                typeParams: undefined,
                arguments: [],
                suite: {
                    start: decorators[0].start,
                    length: 0,
                    nodeType: ParseNodeType.Suite,
                    id: 0,
                    parent: undefined,
                            d: { statements: [], typeComment: undefined },
                },
            },
        };

        decorators.forEach((decorator) => {
            decorator.parent = node;
            extendRange(node, decorator);
        });

        node.d.name.parent = node;
        node.d.suite.parent = node;

        return node;
    }
}

export interface WithNode extends ParseNodeBase<ParseNodeType.With> {
    d: {
        firstToken: Token;
        isAsync?: boolean;
        asyncToken?: Token;
        withItems: WithItemNode[];
        suite: SuiteNode;
        typeComment?: StringToken;
    };
}

export namespace WithNode {
    export function create(withToken: Token, suite: SuiteNode) {
        const node: WithNode = {
            start: withToken.start,
            length: withToken.length,
            nodeType: ParseNodeType.With,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: withToken,
                withItems: [],
                suite: suite,
            },
        };

        suite.parent = node;

        extendRange(node, suite);

        return node;
    }
}

export interface WithItemNode extends ParseNodeBase<ParseNodeType.WithItem> {
    d: {
        expr: ExpressionNode;
        target?: ExpressionNode | undefined;
    };
}

export namespace WithItemNode {
    export function create(expr: ExpressionNode) {
        const node: WithItemNode = {
            start: expr.start,
            length: expr.length,
            nodeType: ParseNodeType.WithItem,
            id: _nextNodeId++,
            parent: undefined,
            d: { expr },
        };

        expr.parent = node;

        return node;
    }
}

export interface DecoratorNode extends ParseNodeBase<ParseNodeType.Decorator> {
    d: {
        expr: ExpressionNode;
    };
}

export namespace DecoratorNode {
    export function create(atToken: Token, expr: ExpressionNode) {
        const node: DecoratorNode = {
            start: atToken.start,
            length: atToken.length,
            nodeType: ParseNodeType.Decorator,
            id: _nextNodeId++,
            parent: undefined,
            d: { expr },
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface StatementListNode extends ParseNodeBase<ParseNodeType.StatementList> {
    d: {
        firstToken: Token;
        statements: ParseNode[];
    };
}

export namespace StatementListNode {
    export function create(atToken: Token) {
        const node: StatementListNode = {
            start: atToken.start,
            length: atToken.length,
            nodeType: ParseNodeType.StatementList,
            id: _nextNodeId++,
            parent: undefined,
            d: { firstToken: atToken, statements: [] },
        };

        return node;
    }
}

export type StatementNode =
    | IfNode
    | WhileNode
    | ForNode
    | TryNode
    | FunctionNode
    | ClassNode
    | WithNode
    | StatementListNode
    | MatchNode
    | TypeAliasNode
    | ErrorNode;

export type SmallStatementNode =
    | ExpressionNode
    | DelNode
    | PassNode
    | ImportNode
    | GlobalNode
    | NonlocalNode
    | AssertNode;

export type ExpressionNode =
    | ErrorNode
    | UnaryOperationNode
    | BinaryOperationNode
    | AssignmentNode
    | TypeAnnotationNode
    | AssignmentExpressionNode
    | AugmentedAssignmentNode
    | AwaitNode
    | TernaryNode
    | UnpackNode
    | TupleNode
    | CallNode
    | ComprehensionNode
    | IndexNode
    | SliceNode
    | YieldNode
    | YieldFromNode
    | MemberAccessNode
    | LambdaNode
    | NameNode
    | ConstantNode
    | EllipsisNode
    | NumberNode
    | StringNode
    | FormatStringNode
    | StringListNode
    | DictionaryNode
    | ListNode
    | SetNode;

export function isExpressionNode(node: ParseNode): node is ExpressionNode {
    switch (node.nodeType) {
        case ParseNodeType.Error:
        case ParseNodeType.UnaryOperation:
        case ParseNodeType.BinaryOperation:
        case ParseNodeType.AssignmentExpression:
        case ParseNodeType.TypeAnnotation:
        case ParseNodeType.Await:
        case ParseNodeType.Ternary:
        case ParseNodeType.Unpack:
        case ParseNodeType.Tuple:
        case ParseNodeType.Call:
        case ParseNodeType.Comprehension:
        case ParseNodeType.Index:
        case ParseNodeType.Slice:
        case ParseNodeType.Yield:
        case ParseNodeType.YieldFrom:
        case ParseNodeType.MemberAccess:
        case ParseNodeType.Lambda:
        case ParseNodeType.Name:
        case ParseNodeType.Constant:
        case ParseNodeType.Ellipsis:
        case ParseNodeType.Number:
        case ParseNodeType.String:
        case ParseNodeType.FormatString:
        case ParseNodeType.StringList:
        case ParseNodeType.Dictionary:
        case ParseNodeType.List:
        case ParseNodeType.Set:
            return true;

        default:
            return false;
    }
}

export interface ErrorNode extends ParseNodeBase<ParseNodeType.Error> {
    d: {
        readonly category: ErrorExpressionCategory;
        readonly child: ExpressionNode | undefined;
        readonly decorators?: DecoratorNode[] | undefined;
    };
}

export namespace ErrorNode {
    export function create(
        initialRange: TextRange,
        category: ErrorExpressionCategory,
        child?: ExpressionNode,
        decorators?: DecoratorNode[]
    ) {
        const node: ErrorNode = {
            start: initialRange.start,
            length: initialRange.length,
            nodeType: ParseNodeType.Error,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                category,
                child,
                decorators,
            },
        };

        if (child) {
            child.parent = node;
            extendRange(node, child);
        }

        if (decorators) {
            decorators.forEach((decorator) => {
                decorator.parent = node;
            });

            if (decorators.length > 0) {
                extendRange(node, decorators[0]);
            }
        }

        return node;
    }
}

export interface UnaryOperationNode extends ParseNodeBase<ParseNodeType.UnaryOperation> {
    d: {
        expr: ExpressionNode;
        operatorToken: Token;
        operator: OperatorType;
        hasParens: boolean;
    };
}

export namespace UnaryOperationNode {
    export function create(operatorToken: Token, expr: ExpressionNode, operator: OperatorType) {
        const node: UnaryOperationNode = {
            start: operatorToken.start,
            length: operatorToken.length,
            nodeType: ParseNodeType.UnaryOperation,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                operator,
                operatorToken,
                expr,
                hasParens: false,
            },
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface BinaryOperationNode extends ParseNodeBase<ParseNodeType.BinaryOperation> {
    d: {
        leftExpr: ExpressionNode;
        operatorToken: Token;
        operator: OperatorType;
        rightExpr: ExpressionNode;
        hasParens: boolean;
    };
}

export namespace BinaryOperationNode {
    export function create(
        leftExpr: ExpressionNode,
        rightExpr: ExpressionNode,
        operatorToken: Token,
        operator: OperatorType
    ) {
        const node: BinaryOperationNode = {
            start: leftExpr.start,
            length: leftExpr.length,
            nodeType: ParseNodeType.BinaryOperation,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                leftExpr,
                operatorToken,
                operator,
                rightExpr,
                hasParens: false,
            },
        };

        leftExpr.parent = node;
        rightExpr.parent = node;

        extendRange(node, rightExpr);

        return node;
    }
}

export interface AssignmentExpressionNode extends ParseNodeBase<ParseNodeType.AssignmentExpression> {
    d: {
        name: NameNode;
        walrusToken: Token;
        rightExpr: ExpressionNode;
        hasParens: boolean;
    };
}

export namespace AssignmentExpressionNode {
    export function create(name: NameNode, walrusToken: Token, rightExpr: ExpressionNode) {
        const node: AssignmentExpressionNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.AssignmentExpression,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                name,
                walrusToken,
                rightExpr,
                hasParens: false,
            },
        };

        name.parent = node;
        rightExpr.parent = node;

        extendRange(node, rightExpr);

        return node;
    }
}

export interface AssignmentNode extends ParseNodeBase<ParseNodeType.Assignment> {
    d: {
        leftExpr: ExpressionNode;
        rightExpr: ExpressionNode;
        annotationComment?: ExpressionNode | undefined;
        chainedAnnotationComment?: ExpressionNode | undefined;
    };
}

export namespace AssignmentNode {
    export function create(leftExpr: ExpressionNode, rightExpr: ExpressionNode) {
        const node: AssignmentNode = {
            start: leftExpr.start,
            length: leftExpr.length,
            nodeType: ParseNodeType.Assignment,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                leftExpr,
                rightExpr,
            },
        };

        leftExpr.parent = node;
        rightExpr.parent = node;

        extendRange(node, rightExpr);

        return node;
    }
}

export enum TypeParamKind {
    TypeVar,
    TypeVarTuple,
    ParamSpec,
}

export interface TypeParameterNode extends ParseNodeBase<ParseNodeType.TypeParameter> {
    d: {
        name: NameNode;
        typeParamKind: TypeParamKind;
        boundExpr?: ExpressionNode;
        defaultExpr?: ExpressionNode;
    };
}

export namespace TypeParameterNode {
    export function create(
        name: NameNode,
        typeParamKind: TypeParamKind,
        boundExpr?: ExpressionNode,
        defaultExpr?: ExpressionNode
    ) {
        const node: TypeParameterNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.TypeParameter,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                name,
                typeParamKind,
                boundExpr,
                defaultExpr,
            },
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
}

export interface TypeParameterListNode extends ParseNodeBase<ParseNodeType.TypeParameterList> {
    d: {
        params: TypeParameterNode[];
    };
}

export namespace TypeParameterListNode {
    export function create(startToken: Token, endToken: Token, params: TypeParameterNode[]) {
        const node: TypeParameterListNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.TypeParameterList,
            id: _nextNodeId++,
            parent: undefined,
            d: { params },
        };

        extendRange(node, endToken);

        params.forEach((param) => {
            extendRange(node, param);
            param.parent = node;
        });

        return node;
    }
}

export interface TypeAliasNode extends ParseNodeBase<ParseNodeType.TypeAlias> {
    d: {
        firstToken: Token;
        name: NameNode;
        typeParams?: TypeParameterListNode;
        expr: ExpressionNode;
    };
}

export namespace TypeAliasNode {
    export function create(
        typeToken: KeywordToken,
        name: NameNode,
        expr: ExpressionNode,
        typeParams?: TypeParameterListNode
    ) {
        const node: TypeAliasNode = {
            start: typeToken.start,
            length: typeToken.length,
            nodeType: ParseNodeType.TypeAlias,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: typeToken,
                name,
                typeParams,
                expr,
            },
        };

        name.parent = node;
        expr.parent = node;

        if (typeParams) {
            typeParams.parent = node;
        }

        extendRange(node, expr);

        return node;
    }
}

export interface TypeAnnotationNode extends ParseNodeBase<ParseNodeType.TypeAnnotation> {
    d: {
        valueExpr: ExpressionNode;
        annotation: ExpressionNode;
    };
}

export namespace TypeAnnotationNode {
    export function create(valueExpr: ExpressionNode, annotation: ExpressionNode) {
        const node: TypeAnnotationNode = {
            start: valueExpr.start,
            length: valueExpr.length,
            nodeType: ParseNodeType.TypeAnnotation,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                valueExpr,
                annotation,
            },
        };

        valueExpr.parent = node;
        annotation.parent = node;

        extendRange(node, annotation);

        return node;
    }
}

export interface FunctionAnnotationNode extends ParseNodeBase<ParseNodeType.FunctionAnnotation> {
    d: {
        isEllipsis: boolean;
        paramAnnotations: ExpressionNode[];
        returnAnnotation: ExpressionNode;
    };
}

export namespace FunctionAnnotationNode {
    export function create(
        openParenToken: Token,
        isEllipsis: boolean,
        paramAnnotations: ExpressionNode[],
        returnAnnotation: ExpressionNode
    ) {
        const node: FunctionAnnotationNode = {
            start: openParenToken.start,
            length: openParenToken.length,
            nodeType: ParseNodeType.FunctionAnnotation,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                isEllipsis,
                paramAnnotations,
                returnAnnotation,
            },
        };

        paramAnnotations.forEach((p) => {
            p.parent = node;
        });
        returnAnnotation.parent = node;

        extendRange(node, returnAnnotation);

        return node;
    }
}

export interface AugmentedAssignmentNode extends ParseNodeBase<ParseNodeType.AugmentedAssignment> {
    d: {
        leftExpr: ExpressionNode;
        operator: OperatorType;
        rightExpr: ExpressionNode;

        // The destExpression is a copy of the leftExpression
        // node. We use it as a place to hang the result type,
        // as opposed to the source type.
        destExpr: ExpressionNode;
    };
}

export namespace AugmentedAssignmentNode {
    export function create(
        leftExpr: ExpressionNode,
        rightExpr: ExpressionNode,
        operator: OperatorType,
        destExpr: ExpressionNode
    ) {
        const node: AugmentedAssignmentNode = {
            start: leftExpr.start,
            length: leftExpr.length,
            nodeType: ParseNodeType.AugmentedAssignment,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                leftExpr,
                operator,
                rightExpr,
                destExpr,
            },
        };

        leftExpr.parent = node;
        rightExpr.parent = node;
        destExpr.parent = node;

        extendRange(node, rightExpr);

        return node;
    }
}

export interface AwaitNode extends ParseNodeBase<ParseNodeType.Await> {
    d: {
        expr: ExpressionNode;
        awaitToken: Token;
        hasParens: boolean;
    };
}

export namespace AwaitNode {
    export function create(awaitToken: Token, expr: ExpressionNode) {
        const node: AwaitNode = {
            start: awaitToken.start,
            length: awaitToken.length,
            nodeType: ParseNodeType.Await,
            id: _nextNodeId++,
            parent: undefined,
            d: { expr, awaitToken, hasParens: false },
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface TernaryNode extends ParseNodeBase<ParseNodeType.Ternary> {
    d: {
        ifExpr: ExpressionNode;
        testExpr: ExpressionNode;
        elseExpr: ExpressionNode;
    };
}

export namespace TernaryNode {
    export function create(
        ifExpr: ExpressionNode,
        testExpr: ExpressionNode,
        elseExpr: ExpressionNode
    ) {
        const node: TernaryNode = {
            start: ifExpr.start,
            length: ifExpr.length,
            nodeType: ParseNodeType.Ternary,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                ifExpr,
                testExpr,
                elseExpr,
            },
        };

        ifExpr.parent = node;
        testExpr.parent = node;
        elseExpr.parent = node;

        extendRange(node, elseExpr);

        return node;
    }
}

export interface UnpackNode extends ParseNodeBase<ParseNodeType.Unpack> {
    d: {
        expr: ExpressionNode;
        starToken: Token;
    };
}

export namespace UnpackNode {
    export function create(starToken: Token, expr: ExpressionNode) {
        const node: UnpackNode = {
            start: starToken.start,
            length: starToken.length,
            nodeType: ParseNodeType.Unpack,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                expr,
                starToken,
            },
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface TupleNode extends ParseNodeBase<ParseNodeType.Tuple> {
    d: {
        items: ExpressionNode[];
        hasParens: boolean;
    };
}

export namespace TupleNode {
    export function create(range: TextRange, hasParens: boolean) {
        const node: TupleNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Tuple,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                items: [],
                hasParens,
            },
        };

        return node;
    }
}

export interface CallNode extends ParseNodeBase<ParseNodeType.Call> {
    d: {
        leftExpr: ExpressionNode;
        args: ArgumentNode[];
        trailingComma: boolean;
    };
}

export namespace CallNode {
    export function create(leftExpr: ExpressionNode, args: ArgumentNode[], trailingComma: boolean) {
        const node: CallNode = {
            start: leftExpr.start,
            length: leftExpr.length,
            nodeType: ParseNodeType.Call,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                leftExpr,
                args,
                trailingComma,
            },
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
}

export interface ComprehensionNode extends ParseNodeBase<ParseNodeType.Comprehension> {
    d: {
        expr: ParseNode;
        forIfNodes: ComprehensionForIfNode[];
        isGenerator: boolean;
        hasParens: boolean;
    };
}

export namespace ComprehensionNode {
    export function create(expr: ParseNode, isGenerator: boolean) {
        const node: ComprehensionNode = {
            start: expr.start,
            length: expr.length,
            nodeType: ParseNodeType.Comprehension,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                expr,
                forIfNodes: [],
                isGenerator,
                hasParens: false,
            },
        };

        expr.parent = node;

        return node;
    }
}

export interface IndexNode extends ParseNodeBase<ParseNodeType.Index> {
    d: {
        leftExpr: ExpressionNode;
        items: ArgumentNode[];
        trailingComma: boolean;
    };
}

export namespace IndexNode {
    export function create(
        leftExpr: ExpressionNode,
        items: ArgumentNode[],
        trailingComma: boolean,
        closeBracketToken: Token
    ) {
        const node: IndexNode = {
            start: leftExpr.start,
            length: leftExpr.length,
            nodeType: ParseNodeType.Index,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                leftExpr,
                items,
                trailingComma,
            },
        };

        leftExpr.parent = node;
        items.forEach((item) => {
            item.parent = node;
        });

        extendRange(node, closeBracketToken);

        return node;
    }
}

export interface SliceNode extends ParseNodeBase<ParseNodeType.Slice> {
    d: {
        startValue?: ExpressionNode | undefined;
        endValue?: ExpressionNode | undefined;
        stepValue?: ExpressionNode | undefined;
    };
}

export namespace SliceNode {
    export function create(range: TextRange) {
        const node: SliceNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Slice,
            id: _nextNodeId++,
            parent: undefined,
            d: {},
        };

        return node;
    }
}

export interface YieldNode extends ParseNodeBase<ParseNodeType.Yield> {
    d: {
        expr?: ExpressionNode | undefined;
    };
}

export namespace YieldNode {
    export function create(yieldToken: Token, expr?: ExpressionNode) {
        const node: YieldNode = {
            start: yieldToken.start,
            length: yieldToken.length,
            nodeType: ParseNodeType.Yield,
            id: _nextNodeId++,
            parent: undefined,
            d: { expr },
        };

        if (expr) {
            expr.parent = node;
            extendRange(node, expr);
        }

        return node;
    }
}

export interface YieldFromNode extends ParseNodeBase<ParseNodeType.YieldFrom> {
    d: {
        expr: ExpressionNode;
    };
}

export namespace YieldFromNode {
    export function create(yieldToken: Token, expr: ExpressionNode) {
        const node: YieldFromNode = {
            start: yieldToken.start,
            length: yieldToken.length,
            nodeType: ParseNodeType.YieldFrom,
            id: _nextNodeId++,
            parent: undefined,
            d: { expr },
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface MemberAccessNode extends ParseNodeBase<ParseNodeType.MemberAccess> {
    d: {
        leftExpr: ExpressionNode;
        member: NameNode;
    };
}

export namespace MemberAccessNode {
    export function create(leftExpr: ExpressionNode, member: NameNode) {
        const node: MemberAccessNode = {
            start: leftExpr.start,
            length: leftExpr.length,
            nodeType: ParseNodeType.MemberAccess,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                leftExpr: leftExpr,
                member: member,
            },
        };

        leftExpr.parent = node;
        member.parent = node;

        extendRange(node, member);

        return node;
    }
}

export interface LambdaNode extends ParseNodeBase<ParseNodeType.Lambda> {
    d: {
        params: ParameterNode[];
        expr: ExpressionNode;
    };
}

export namespace LambdaNode {
    export function create(lambdaToken: Token, expr: ExpressionNode) {
        const node: LambdaNode = {
            start: lambdaToken.start,
            length: lambdaToken.length,
            nodeType: ParseNodeType.Lambda,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                params: [],
                expr,
            },
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface NameNode extends ParseNodeBase<ParseNodeType.Name> {
    d: {
        token: IdentifierToken;
        value: string;
    };
}

export namespace NameNode {
    export function create(nameToken: IdentifierToken) {
        const node: NameNode = {
            start: nameToken.start,
            length: nameToken.length,
            nodeType: ParseNodeType.Name,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                token: nameToken,
                value: nameToken.value,
            },
        };

        return node;
    }
}

export interface ConstantNode extends ParseNodeBase<ParseNodeType.Constant> {
    d: {
        constType: KeywordType;
    };
}

export namespace ConstantNode {
    export function create(token: KeywordToken) {
        const node: ConstantNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.Constant,
            id: _nextNodeId++,
            parent: undefined,
            d: { constType: token.keywordType },
        };

        return node;
    }
}

export interface EllipsisNode extends ParseNodeBase<ParseNodeType.Ellipsis> {}

export namespace EllipsisNode {
    export function create(range: TextRange) {
        const node: EllipsisNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Ellipsis,
            id: _nextNodeId++,
            parent: undefined,
            d: {},
        };

        return node;
    }
}

export interface NumberNode extends ParseNodeBase<ParseNodeType.Number> {
    d: {
        value: number | bigint;
        isInteger: boolean;
        isImaginary: boolean;
    };
}

export namespace NumberNode {
    export function create(token: NumberToken) {
        const node: NumberNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.Number,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                value: token.value,
                isInteger: token.isInteger,
                isImaginary: token.isImaginary,
            },
        };

        return node;
    }
}

export interface StringNode extends ParseNodeBase<ParseNodeType.String> {
    d: {
        token: StringToken;
        value: string;
    };
}

export namespace StringNode {
    export function create(token: StringToken, value: string) {
        const node: StringNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.String,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                token,
                value,
            },
        };

        return node;
    }
}

// Used for both f-strings and t-strings
export interface FormatStringNode extends ParseNodeBase<ParseNodeType.FormatString> {
    d: {
        token: FStringStartToken;
        middleTokens: FStringMiddleToken[];
        fieldExprs: ExpressionNode[];
        formatExprs: ExpressionNode[];

        // Include a dummy "value" to simplify other code.
        value: '';
    };
}

export namespace FormatStringNode {
    export function create(
        startToken: FStringStartToken,
        endToken: FStringEndToken | undefined,
        middleTokens: FStringMiddleToken[],
        fieldExprs: ExpressionNode[],
        formatExprs: ExpressionNode[]
    ) {
        const node: FormatStringNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.FormatString,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                token: startToken,
                middleTokens,
                fieldExprs,
                formatExprs,
                value: '',
            },
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
}

export interface StringListNode extends ParseNodeBase<ParseNodeType.StringList> {
    d: {
        strings: (StringNode | FormatStringNode)[];

        // Indicates that the string list is enclosed in parens.
        hasParens: boolean;
    };
}

export namespace StringListNode {
    export function create(strings: (StringNode | FormatStringNode)[]) {
        const node: StringListNode = {
            start: strings[0].start,
            length: strings[0].length,
            nodeType: ParseNodeType.StringList,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                strings,
                hasParens: false,
            },
        };

        if (strings.length > 0) {
            strings.forEach((str) => {
                str.parent = node;
            });
            extendRange(node, strings[strings.length - 1]);
        }

        return node;
    }
}

export interface DictionaryNode extends ParseNodeBase<ParseNodeType.Dictionary> {
    d: {
        items: DictionaryEntryNode[];
        trailingCommaToken: Token | undefined;
    };
}

export namespace DictionaryNode {
    export function create(range: TextRange) {
        const node: DictionaryNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Dictionary,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                items: [],
                trailingCommaToken: undefined,
            },
        };

        return node;
    }
}

export interface DictionaryKeyEntryNode extends ParseNodeBase<ParseNodeType.DictionaryKeyEntry> {
    d: {
        keyExpr: ExpressionNode;
        valueExpr: ExpressionNode;
    };
}

export namespace DictionaryKeyEntryNode {
    export function create(keyExpr: ExpressionNode, valueExpr: ExpressionNode) {
        const node: DictionaryKeyEntryNode = {
            start: keyExpr.start,
            length: keyExpr.length,
            nodeType: ParseNodeType.DictionaryKeyEntry,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                keyExpr,
                valueExpr,
            },
        };

        keyExpr.parent = node;
        valueExpr.parent = node;

        extendRange(node, valueExpr);

        return node;
    }
}

export interface DictionaryExpandEntryNode extends ParseNodeBase<ParseNodeType.DictionaryExpandEntry> {
    d: {
        expr: ExpressionNode;
    };
}

export namespace DictionaryExpandEntryNode {
    export function create(expr: ExpressionNode) {
        const node: DictionaryExpandEntryNode = {
            start: expr.start,
            length: expr.length,
            nodeType: ParseNodeType.DictionaryExpandEntry,
            id: _nextNodeId++,
            parent: undefined,
            d: { expr },
        };

        expr.parent = node;

        return node;
    }
}

export type DictionaryEntryNode = DictionaryKeyEntryNode | DictionaryExpandEntryNode | ComprehensionNode;

export interface SetNode extends ParseNodeBase<ParseNodeType.Set> {
    d: { items: ExpressionNode[] };
}

export namespace SetNode {
    export function create(range: TextRange) {
        const node: SetNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Set,
            id: _nextNodeId++,
            parent: undefined,
            d: { items: [] },
        };

        return node;
    }
}

export interface ListNode extends ParseNodeBase<ParseNodeType.List> {
    d: {
        items: ExpressionNode[];
    };
}

export namespace ListNode {
    export function create(range: TextRange) {
        const node: ListNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.List,
            id: _nextNodeId++,
            parent: undefined,
            d: { items: [] },
        };

        return node;
    }
}

export const enum ArgCategory {
    Simple,
    UnpackedList,
    UnpackedDictionary,
}

export interface ArgumentNode extends ParseNodeBase<ParseNodeType.Argument> {
    d: {
        argCategory: ArgCategory;
        name: NameNode | undefined;
        valueExpr: ExpressionNode;
    };
}

export namespace ArgumentNode {
    export function create(
        startToken: Token | undefined,
        valueExpr: ExpressionNode,
        argCategory: ArgCategory
    ) {
        const node: ArgumentNode = {
            start: startToken ? startToken.start : valueExpr.start,
            length: startToken ? startToken.length : valueExpr.length,
            nodeType: ParseNodeType.Argument,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                argCategory,
                name: undefined,
                valueExpr,
            },
        };

        valueExpr.parent = node;

        extendRange(node, valueExpr);

        return node;
    }
}

export interface DelNode extends ParseNodeBase<ParseNodeType.Del> {
    d: {
        targets: ExpressionNode[];
    };
}

export namespace DelNode {
    export function create(delToken: Token) {
        const node: DelNode = {
            start: delToken.start,
            length: delToken.length,
            nodeType: ParseNodeType.Del,
            id: _nextNodeId++,
            parent: undefined,
            d: { targets: [] },
        };

        return node;
    }
}

export interface PassNode extends ParseNodeBase<ParseNodeType.Pass> {}

export namespace PassNode {
    export function create(passToken: TextRange) {
        const node: PassNode = {
            start: passToken.start,
            length: passToken.length,
            nodeType: ParseNodeType.Pass,
            id: _nextNodeId++,
            parent: undefined,
            d: {},
        };

        return node;
    }
}

export interface ImportNode extends ParseNodeBase<ParseNodeType.Import> {
    d: {
        list: ImportAsNode[];
        isLazy?: boolean;
        lazyToken?: KeywordToken;
    };
}

export namespace ImportNode {
    export function create(importToken: TextRange) {
        const node: ImportNode = {
            start: importToken.start,
            length: importToken.length,
            nodeType: ParseNodeType.Import,
            id: _nextNodeId++,
            parent: undefined,
            d: { list: [] },
        };

        return node;
    }
}

export interface ModuleNameNode extends ParseNodeBase<ParseNodeType.ModuleName> {
    d: {
        leadingDots: number;
        nameParts: NameNode[];

        // This is an error condition used only for type completion.
        hasTrailingDot?: boolean;
    };
}

export namespace ModuleNameNode {
    export function create(range: TextRange) {
        const node: ModuleNameNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.ModuleName,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                leadingDots: 0,
                nameParts: [],
            },
        };

        return node;
    }
}

export interface ImportAsNode extends ParseNodeBase<ParseNodeType.ImportAs> {
    d: {
        module: ModuleNameNode;
        alias?: NameNode | undefined;
    };
}

export namespace ImportAsNode {
    export function create(module: ModuleNameNode) {
        const node: ImportAsNode = {
            start: module.start,
            length: module.length,
            nodeType: ParseNodeType.ImportAs,
            id: _nextNodeId++,
            parent: undefined,
            d: { module: module },
        };

        module.parent = node;

        return node;
    }
}

export interface ImportFromNode extends ParseNodeBase<ParseNodeType.ImportFrom> {
    d: {
        module: ModuleNameNode;
        imports: ImportFromAsNode[];
        isWildcardImport: boolean;
        usesParens: boolean;
        wildcardToken?: Token;
        missingImport?: boolean;
        isLazy?: boolean;
        lazyToken?: KeywordToken;
    };
}

export namespace ImportFromNode {
    export function create(fromToken: Token, module: ModuleNameNode) {
        const node: ImportFromNode = {
            start: fromToken.start,
            length: fromToken.length,
            nodeType: ParseNodeType.ImportFrom,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                module,
                imports: [],
                isWildcardImport: false,
                usesParens: false,
            },
        };

        module.parent = node;

        extendRange(node, module);

        return node;
    }
}

export interface ImportFromAsNode extends ParseNodeBase<ParseNodeType.ImportFromAs> {
    d: {
        name: NameNode;
        alias?: NameNode | undefined;
    };
}

export namespace ImportFromAsNode {
    export function create(name: NameNode) {
        const node: ImportFromAsNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.ImportFromAs,
            id: _nextNodeId++,
            parent: undefined,
            d: { name: name },
        };

        name.parent = node;

        return node;
    }
}

export interface GlobalNode extends ParseNodeBase<ParseNodeType.Global> {
    d: {
        targets: NameNode[];
    };
}

export namespace GlobalNode {
    export function create(range: TextRange) {
        const node: GlobalNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Global,
            id: _nextNodeId++,
            parent: undefined,
            d: { targets: [] },
        };

        return node;
    }
}

export interface NonlocalNode extends ParseNodeBase<ParseNodeType.Nonlocal> {
    d: {
        targets: NameNode[];
    };
}

export namespace NonlocalNode {
    export function create(range: TextRange) {
        const node: NonlocalNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Nonlocal,
            id: _nextNodeId++,
            parent: undefined,
            d: { targets: [] },
        };

        return node;
    }
}

export interface AssertNode extends ParseNodeBase<ParseNodeType.Assert> {
    d: {
        testExpr: ExpressionNode;
        exceptionExpr?: ExpressionNode | undefined;
    };
}

export namespace AssertNode {
    export function create(assertToken: Token, testExpr: ExpressionNode) {
        const node: AssertNode = {
            start: assertToken.start,
            length: assertToken.length,
            nodeType: ParseNodeType.Assert,
            id: _nextNodeId++,
            parent: undefined,
            d: { testExpr },
        };

        testExpr.parent = node;

        extendRange(node, testExpr);

        return node;
    }
}

export interface BreakNode extends ParseNodeBase<ParseNodeType.Break> {}

export namespace BreakNode {
    export function create(range: TextRange) {
        const node: BreakNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Break,
            id: _nextNodeId++,
            parent: undefined,
            d: {},
        };

        return node;
    }
}

export interface ContinueNode extends ParseNodeBase<ParseNodeType.Continue> {}

export namespace ContinueNode {
    export function create(range: TextRange) {
        const node: ContinueNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Continue,
            id: _nextNodeId++,
            parent: undefined,
            d: {},
        };

        return node;
    }
}

export interface ReturnNode extends ParseNodeBase<ParseNodeType.Return> {
    d: {
        expr?: ExpressionNode | undefined;
    };
}

export namespace ReturnNode {
    export function create(range: TextRange) {
        const node: ReturnNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Return,
            id: _nextNodeId++,
            parent: undefined,
            d: {},
        };

        return node;
    }
}

export interface RaiseNode extends ParseNodeBase<ParseNodeType.Raise> {
    d: {
        expr?: ExpressionNode | undefined;
        fromExpr?: ExpressionNode | undefined;
    };
}

export namespace RaiseNode {
    export function create(range: TextRange) {
        const node: RaiseNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Raise,
            id: _nextNodeId++,
            parent: undefined,
            d: {},
        };

        return node;
    }
}

export interface MatchNode extends ParseNodeBase<ParseNodeType.Match> {
    d: {
        firstToken: Token;
        expr: ExpressionNode;
        cases: CaseNode[];
    };
}

export namespace MatchNode {
    export function create(matchToken: Token, expr: ExpressionNode) {
        const node: MatchNode = {
            start: matchToken.start,
            length: matchToken.length,
            nodeType: ParseNodeType.Match,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                firstToken: matchToken,
                expr,
                cases: [],
            },
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface CaseNode extends ParseNodeBase<ParseNodeType.Case> {
    d: {
        pattern: PatternAtomNode;
        isIrrefutable: boolean;
        guardExpr?: ExpressionNode | undefined;
        suite: SuiteNode;
    };
}

export namespace CaseNode {
    export function create(
        caseToken: TextRange,
        pattern: PatternAtomNode,
        isIrrefutable: boolean,
        guardExpr: ExpressionNode | undefined,
        suite: SuiteNode
    ) {
        const node: CaseNode = {
            start: caseToken.start,
            length: caseToken.length,
            nodeType: ParseNodeType.Case,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                pattern,
                isIrrefutable,
                guardExpr,
                suite,
            },
        };

        extendRange(node, suite);

        pattern.parent = node;
        suite.parent = node;

        if (guardExpr) {
            guardExpr.parent = node;
        }

        return node;
    }
}

export interface PatternSequenceNode extends ParseNodeBase<ParseNodeType.PatternSequence> {
    d: {
        entries: PatternAsNode[];
        starEntryIndex: number | undefined;
    };
}

export namespace PatternSequenceNode {
    export function create(firstToken: TextRange, entries: PatternAsNode[]) {
        const starEntryIndex = entries.findIndex(
            (entry) =>
                entry.d.orPatterns.length === 1 &&
                entry.d.orPatterns[0].nodeType === ParseNodeType.PatternCapture &&
                entry.d.orPatterns[0].d.isStar
        );

        const node: PatternSequenceNode = {
            start: firstToken.start,
            length: firstToken.length,
            nodeType: ParseNodeType.PatternSequence,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                entries,
                starEntryIndex: starEntryIndex >= 0 ? starEntryIndex : undefined,
            },
        };

        if (entries.length > 0) {
            extendRange(node, entries[entries.length - 1]);
        }

        entries.forEach((entry) => {
            entry.parent = node;
        });

        return node;
    }
}

export interface PatternAsNode extends ParseNodeBase<ParseNodeType.PatternAs> {
    d: {
        orPatterns: PatternAtomNode[];
        target?: NameNode | undefined;
    };
}

export namespace PatternAsNode {
    export function create(orPatterns: PatternAtomNode[], target?: NameNode) {
        const node: PatternAsNode = {
            start: orPatterns[0].start,
            length: orPatterns[0].length,
            nodeType: ParseNodeType.PatternAs,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                orPatterns,
                target,
            },
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
}

export interface PatternLiteralNode extends ParseNodeBase<ParseNodeType.PatternLiteral> {
    d: {
        expr: ExpressionNode;
    };
}

export namespace PatternLiteralNode {
    export function create(expr: ExpressionNode) {
        const node: PatternLiteralNode = {
            start: expr.start,
            length: expr.length,
            nodeType: ParseNodeType.PatternLiteral,
            id: _nextNodeId++,
            parent: undefined,
            d: { expr },
        };

        expr.parent = node;

        return node;
    }
}

export interface PatternClassNode extends ParseNodeBase<ParseNodeType.PatternClass> {
    d: {
        className: NameNode | MemberAccessNode;
        args: PatternClassArgumentNode[];
    };
}

export namespace PatternClassNode {
    export function create(
        className: NameNode | MemberAccessNode,
        args: PatternClassArgumentNode[]
    ) {
        const node: PatternClassNode = {
            start: className.start,
            length: className.length,
            nodeType: ParseNodeType.PatternClass,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                className,
                args,
            },
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
}

export interface PatternClassArgumentNode extends ParseNodeBase<ParseNodeType.PatternClassArgument> {
    d: {
        name?: NameNode | undefined;
        pattern: PatternAsNode;
    };
}

export namespace PatternClassArgumentNode {
    export function create(pattern: PatternAsNode, name?: NameNode) {
        const node: PatternClassArgumentNode = {
            start: pattern.start,
            length: pattern.length,
            nodeType: ParseNodeType.PatternClassArgument,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                pattern,
                name,
            },
        };

        pattern.parent = node;

        if (name) {
            extendRange(node, name);
            name.parent = node;
        }

        return node;
    }
}

export interface PatternCaptureNode extends ParseNodeBase<ParseNodeType.PatternCapture> {
    d: {
        target: NameNode;
        isStar: boolean;
        isWildcard: boolean;
    };
}

export namespace PatternCaptureNode {
    export function create(target: NameNode, starToken?: TextRange) {
        const node: PatternCaptureNode = {
            start: target.start,
            length: target.length,
            nodeType: ParseNodeType.PatternCapture,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                target,
                isStar: starToken !== undefined,
                isWildcard: target.d.value === '_',
            },
        };

        target.parent = node;

        if (starToken) {
            extendRange(node, starToken);
        }

        return node;
    }
}

export interface PatternMappingNode extends ParseNodeBase<ParseNodeType.PatternMapping> {
    d: {
        entries: PatternMappingEntryNode[];
    };
}

export namespace PatternMappingNode {
    export function create(startToken: TextRange, entries: PatternMappingEntryNode[]) {
        const node: PatternMappingNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.PatternMapping,
            id: _nextNodeId++,
            parent: undefined,
            d: { entries },
        };

        if (entries.length > 0) {
            extendRange(node, entries[entries.length - 1]);
        }

        entries.forEach((entry) => {
            entry.parent = node;
        });

        return node;
    }
}

export type PatternMappingEntryNode = PatternMappingKeyEntryNode | PatternMappingExpandEntryNode;

export interface PatternMappingKeyEntryNode extends ParseNodeBase<ParseNodeType.PatternMappingKeyEntry> {
    d: {
        keyPattern: PatternLiteralNode | PatternValueNode | ErrorNode;
        valuePattern: PatternAsNode | ErrorNode;
    };
}

export namespace PatternMappingKeyEntryNode {
    export function create(
        keyPattern: PatternLiteralNode | PatternValueNode | ErrorNode,
        valuePattern: PatternAsNode | ErrorNode
    ) {
        const node: PatternMappingKeyEntryNode = {
            start: keyPattern.start,
            length: keyPattern.length,
            nodeType: ParseNodeType.PatternMappingKeyEntry,
            id: _nextNodeId++,
            parent: undefined,
            d: {
                keyPattern,
                valuePattern,
            },
        };

        keyPattern.parent = node;
        valuePattern.parent = node;

        extendRange(node, valuePattern);

        return node;
    }
}

export interface PatternMappingExpandEntryNode extends ParseNodeBase<ParseNodeType.PatternMappingExpandEntry> {
    d: {
        target: NameNode;
    };
}

export namespace PatternMappingExpandEntryNode {
    export function create(starStarToken: TextRange, target: NameNode) {
        const node: PatternMappingExpandEntryNode = {
            start: starStarToken.start,
            length: starStarToken.length,
            nodeType: ParseNodeType.PatternMappingExpandEntry,
            id: _nextNodeId++,
            parent: undefined,
            d: { target },
        };

        target.parent = node;

        extendRange(node, target);

        return node;
    }
}

export interface PatternValueNode extends ParseNodeBase<ParseNodeType.PatternValue> {
    d: {
        expr: MemberAccessNode;
    };
}

export namespace PatternValueNode {
    export function create(expr: MemberAccessNode) {
        const node: PatternValueNode = {
            start: expr.start,
            length: expr.length,
            nodeType: ParseNodeType.PatternValue,
            id: _nextNodeId++,
            parent: undefined,
            d: { expr },
        };

        expr.parent = node;

        return node;
    }
}

export type PatternAtomNode =
    | PatternSequenceNode
    | PatternLiteralNode
    | PatternClassNode
    | PatternAsNode
    | PatternCaptureNode
    | PatternMappingNode
    | PatternValueNode
    | ErrorNode;

export type ParseNode =
    | ErrorNode
    | ArgumentNode
    | AssertNode
    | AssignmentExpressionNode
    | AssignmentNode
    | AugmentedAssignmentNode
    | AwaitNode
    | BinaryOperationNode
    | BreakNode
    | CallNode
    | CaseNode
    | ClassNode
    | ComprehensionNode
    | ComprehensionForNode
    | ComprehensionIfNode
    | ConstantNode
    | ContinueNode
    | DecoratorNode
    | DelNode
    | DictionaryNode
    | DictionaryExpandEntryNode
    | DictionaryKeyEntryNode
    | EllipsisNode
    | IfNode
    | ImportNode
    | ImportAsNode
    | ImportFromNode
    | ImportFromAsNode
    | IndexNode
    | ExceptNode
    | ForNode
    | FormatStringNode
    | FunctionNode
    | FunctionAnnotationNode
    | GlobalNode
    | LambdaNode
    | ListNode
    | MatchNode
    | MemberAccessNode
    | ModuleNameNode
    | ModuleNode
    | NameNode
    | NonlocalNode
    | NumberNode
    | ParameterNode
    | PassNode
    | PatternAsNode
    | PatternClassNode
    | PatternClassArgumentNode
    | PatternCaptureNode
    | PatternLiteralNode
    | PatternMappingExpandEntryNode
    | PatternMappingKeyEntryNode
    | PatternMappingNode
    | PatternSequenceNode
    | PatternValueNode
    | RaiseNode
    | ReturnNode
    | SetNode
    | SliceNode
    | StatementListNode
    | StringListNode
    | StringNode
    | SuiteNode
    | TernaryNode
    | TupleNode
    | TryNode
    | TypeAliasNode
    | TypeAnnotationNode
    | TypeParameterNode
    | TypeParameterListNode
    | UnaryOperationNode
    | UnpackNode
    | WhileNode
    | WithNode
    | WithItemNode
    | YieldNode
    | YieldFromNode;

export type EvaluationScopeNode =
    | LambdaNode
    | FunctionNode
    | ModuleNode
    | ClassNode
    | ComprehensionNode
    | TypeParameterListNode;
export type ExecutionScopeNode = LambdaNode | FunctionNode | ModuleNode | TypeParameterListNode;
export type TypeParameterScopeNode = FunctionNode | ClassNode | TypeAliasNode;
