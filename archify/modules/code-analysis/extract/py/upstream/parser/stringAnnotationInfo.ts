import type { ExpressionNode, StringListNode } from './parseNodes.js';

export interface StringAnnotationInfo {
    readonly size: number;
    get(node: StringListNode): ExpressionNode | undefined;
    forEach(callback: (annotation: ExpressionNode, node: StringListNode) => void): void;
}

interface StringAnnotationInfoWriter {
    set(node: StringListNode, annotation: ExpressionNode): void;
    addAll(info: StringAnnotationInfo): void;
}

export function createStringAnnotationInfo(): {
    readonly info: StringAnnotationInfo;
    readonly writer: StringAnnotationInfoWriter;
} {
    const annotations = new Map<StringListNode, ExpressionNode>();

    return {
        info: {
            get size() {
                return annotations.size;
            },
            get: (node) => annotations.get(node),
            forEach: (callback) => annotations.forEach(callback),
        },
        writer: {
            set: (node, annotation) => annotations.set(node, annotation),
            addAll: (info) => info.forEach((annotation, node) => annotations.set(node, annotation)),
        },
    };
}

export const emptyStringAnnotationInfo: StringAnnotationInfo = Object.freeze({
    size: 0,
    get: () => undefined,
    forEach: () => {},
});
