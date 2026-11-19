// Bounded reaching definitions for one local name. Branches join declarations,
// never choose a convenient assignment. Unknown and zero-iteration paths remain
// explicit; loops include carried stores and exceptions may interrupt any store.
import { ParseNode as Node, ParseNodeType as K } from './upstream/parser/parseNodes.js';
import { OperatorType as Op } from './upstream/parser/tokenizerTypes.js';
import { Binding, Scope } from './bindings.js';
import { body, endOf } from './facts.js';

export interface Guard { test: Node; positive: boolean }
interface State { values: (Binding | undefined)[]; guards: Guard[] }
export function reachingBindings(scope: Scope, name: string, at: number): State {
    const events = (scope.events.get(name) || []).filter(event => !event.attributeWrite);
    const parameters = events.filter(event => event.kind === 'parameter');
    const initial: State = { values: parameters.length ? parameters : [undefined], guards: [] };
    let fuel = 4096;
    const merge = (states: (State | undefined)[]): State | undefined => {
        const live = states.filter((state): state is State => Boolean(state));
        if (!live.length) return;
        return { values: [...new Set(live.flatMap(state => state.values))], guards: live[0].guards.filter(guard => live.every(state => state.guards.some(other => other.test === guard.test && other.positive === guard.positive))) };
    };
    const guarded = (state: State, test: Node, positive: boolean): State => ({ ...state, guards: [...state.guards, { test, positive }] });
    const assigned = (state: State, node: Node): State => {
        const values = events.filter(event => event.node === node && event.kind !== 'parameter');
        return values.length ? { values, guards: state.guards.filter(guard => guard.test.start > node.start) } : state;
    };
    const possibleStores = (state: State, node: Node): State => ({ ...state, values: [...new Set([...state.values, ...events.filter(event => event.node.start >= node.start && event.at <= endOf(node))])] });
    const opaqueStores = (state: State, node: Node, limit: number, includeRoot = false): State => events.some(event => (includeRoot || event.node !== node) && event.node.start >= node.start && event.at <= Math.min(limit, endOf(node)))
        ? { values: [undefined], guards: [] } : state;
    const confirmed = (state: State, test: Node, positive: boolean) => {
        const after = opaqueStores(state, test, endOf(test), true);
        return after === state ? guarded(state, test, positive) : after;
    };
    const beforeTest = (state: State, test: Node, limit: number) => {
        while (test.nodeType === K.BinaryOperation && [Op.And, Op.Or].includes(test.d.operator)) {
            const { leftExpr, rightExpr, operator } = test.d;
            if (limit < rightExpr.start) test = leftExpr;
            else { state = confirmed(state, leftExpr, operator === Op.And); test = rightExpr; }
        }
        return state;
    };
    if (scope.node.nodeType === K.Comprehension) {
        const { expr, forIfNodes } = scope.node.d;
        const resultExpression = at >= expr.start && at < endOf(expr);
        let state = initial;
        for (const clause of forIfNodes) {
            if (!resultExpression && at < endOf(clause))
                return clause.nodeType === K.ComprehensionIf ? beforeTest(state, clause.d.testExpr, at) : state;
            state = clause.nodeType === K.ComprehensionIf ? confirmed(state, clause.d.testExpr, true) : assigned(state, clause);
        }
        return state;
    }
    const scan = (nodes: Node[], input: State, limit: number): State | undefined => {
        let state: State | undefined = input;
        for (const node of nodes) {
            if (!state || node.start >= limit) break;
            if (--fuel < 0) return { values: [undefined], guards: [] };
            const d = node.d as any, inside = limit <= endOf(node);
            if (node.nodeType === K.StatementList || node.nodeType === K.Suite) {
                state = scan(body(node), state, limit);
            } else if (node.nodeType === K.Assert) {
                if (inside) return beforeTest(state, d.testExpr, limit);
                state = confirmed(state, d.testExpr, true);
            } else if (node.nodeType === K.If) {
                if (inside && limit <= endOf(d.testExpr)) return beforeTest(state, d.testExpr, limit);
                const yes = confirmed(state, d.testExpr, true), no = confirmed(state, d.testExpr, false);
                if (inside) return limit >= d.ifSuite.start && limit <= endOf(d.ifSuite) ? scan(body(d.ifSuite), yes, limit)
                    : d.elseSuite ? scan([d.elseSuite], no, limit) : no;
                state = merge([scan(body(d.ifSuite), yes, Infinity), d.elseSuite ? scan([d.elseSuite], no, Infinity) : no]);
            } else if (node.nodeType === K.For || node.nodeType === K.While) {
                const suite = d.forSuite || d.whileSuite;
                if (inside && limit < suite.start) return node.nodeType === K.While ? possibleStores(state, suite) : state;
                state = opaqueStores(state, d.iterableExpr || d.testExpr, limit, true);
                const carried = possibleStores(state, suite);
                const entry = node.nodeType === K.For ? assigned(carried, node) : carried;
                if (inside && limit <= endOf(suite)) return scan(body(suite), entry, limit);
                state = merge([state, scan(body(suite), entry, Infinity)]);
                if (state && d.elseSuite) state = merge([state, scan(body(d.elseSuite), state, inside ? limit : Infinity)]);
            } else if (node.nodeType === K.With) {
                for (const item of d.withItems) if (item.start < limit) state = assigned(state!, item);
                if (inside && limit < d.suite.start) return state;
                const entered = state!;
                state = scan(body(d.suite), entered, limit);
                if (!inside) state = merge([entered, state]); // __exit__ may suppress an interrupted body
            } else if (node.nodeType === K.Try) {
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
                if (d.finallySuite) state = scan(body(d.finallySuite), merge([state, interrupted])!, inside ? limit : Infinity);
            } else if ([K.Function, K.Class, K.Lambda].includes(node.nodeType)) {
                if (!inside) state = assigned(state, node);
            } else if (node.nodeType === K.Assignment && !inside) {
                state = opaqueStores(state, node, limit);
                for (let target = node; ; target = target.d.rightExpr) {
                    state = assigned(state, target);
                    if (target.d.rightExpr.nodeType !== K.Assignment) break;
                }
            } else {
                state = opaqueStores(state, node, limit);
                if (!inside) state = assigned(state, node);
                if (!inside && [K.Return, K.Raise, K.Break, K.Continue].includes(node.nodeType)) return;
            }
            if (inside) return state;
        }
        return state;
    };
    return scan(body(scope.node), initial, at) || { values: [undefined], guards: [] };
}
