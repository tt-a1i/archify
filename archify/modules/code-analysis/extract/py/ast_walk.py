"""AST traversal shared by the Python fact collectors."""
import ast


def analysis_children(node):
    """Visit binary operands left to right without recursing through their grouping."""
    if not isinstance(node, ast.BinOp):
        yield from ast.iter_child_nodes(node)
        return

    pending = [node]
    while pending:
        operand = pending.pop()
        if isinstance(operand, ast.BinOp):
            pending.append(operand.right)
            pending.append(operand.left)
        else:
            yield operand


class AnalysisVisitor(ast.NodeVisitor):
    def visit_BinOp(self, node):
        for operand in analysis_children(node):
            self.visit(operand)
