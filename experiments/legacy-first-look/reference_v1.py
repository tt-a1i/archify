"""Pure function extraction from shell-sources/3c4879a4-a02b-4382-8667-0f1f670c421c-21.txt.
Original SHA-256: 34d19d781c329282471f40ff69c93ce8b0efb7b1e6178fc14826d64dca205092
Only path normalization and three file-selection metrics are included.
"""
def norm_path(p):
    return (p or "").strip().lstrip("./")

def as_list(x):
    if x is None: return []
    if isinstance(x, str): return [x]
    return list(x)

def p_at_3(pred, gold):
    g = {norm_path(p) for p in gold}
    pred = [norm_path(p) for p in pred][:3]
    hit = sum(1 for p in pred if p in g)
    return hit / 3.0, hit, len(g)

def recall_at_3(pred, gold):
    g = {norm_path(p) for p in gold}
    pred = {norm_path(p) for p in pred[:3]}
    if not g: return 1.0
    return len(pred & g) / len(g)

def hit1(pred, gold):
    if not pred: return False
    return norm_path(pred[0]) in {norm_path(p) for p in gold}
