"""Original deliberate stdlib fixture; no upstream code, input parser or locals capture."""
import json
import platform
import sys
import traceback
from pathlib import Path


def construct():
    """Return the three live objects after one ordinary raise and one group raise."""
    try:
        raise ValueError("leaf-marker")
    except ValueError as caught:
        leaf = caught
    inner = ExceptionGroup("inner-marker", [leaf])
    outer = ExceptionGroup("outer-marker", [inner])
    try:
        raise inner from outer
    except ExceptionGroup as caught:
        assert caught is inner
    return {"leaf": leaf, "inner": inner, "outer": outer}


def observe(objects):
    # Symbols are local to this fixture; never export addresses or claim cross-run IDs.
    def symbol(value):
        return next(name for name, obj in objects.items() if value is obj)
    edges = []
    for name, obj in objects.items():
        if isinstance(obj, BaseExceptionGroup):
            edges.extend({"from": name, "to": symbol(child), "kind": "contains"}
                         for child in obj.exceptions)
        if obj.__cause__ is not None:
            edges.append({"from": name, "to": symbol(obj.__cause__), "kind": "caused-by"})
    trace = "".join(traceback.format_exception(objects["inner"], chain=True))
    return {
        "scope": "Synthetic deliberate fixture, not a production failure",
        "python": platform.python_version(),
        "nodes": [{"id": name, "type": type(obj).__name__, "message": str(obj)}
                  for name, obj in objects.items()],
        "edges": edges,
        "identity_checks": {
            "outer_child_is_inner": objects["outer"].exceptions[0] is objects["inner"],
            "inner_child_is_leaf": objects["inner"].exceptions[0] is objects["leaf"],
            "inner_cause_is_outer": objects["inner"].__cause__ is objects["outer"],
            "three_distinct_objects": len({id(obj) for obj in objects.values()}) == 3,
        },
        "traceback": trace,
        "printed_exception_lines": {name: trace.count(type(obj).__name__ + ": " + str(obj))
                                    for name, obj in objects.items()},
    }


def candidate(observation):
    nodes = {node["id"]: node for node in observation["nodes"]}
    positions = {"outer": [40, 40], "inner": [460, 40], "leaf": [460, 280]}
    return {
        "schema_version": 1, "diagram_type": "architecture",
        "meta": {"title": "Synthetic exception fixture: three objects, repeated text", "locale": "en",
                 "output": "experiments/exception-identity/exception-identity.html", "quality_profile": "showcase",
                 "legend": {"entries": {"backend": {"label": "Exception object"}}}},
        "components": [{"id": name, "type": "backend", "label": name + " · " + node["type"],
                        "sublabel": node["message"].split(" (")[0] + " · 1 object · prints " + str(observation["printed_exception_lines"][name]) + "x",
                        "pos": positions[name], "size": [225, 76],
                        "explanation": "One live object in a deliberate Python fixture. The symbol is not a memory address or a cross-run ID."}
                       for name, node in nodes.items()],
        "connections": [{"id": edge["from"] + "-" + edge["kind"] + "-" + edge["to"],
                         "from": edge["from"], "to": edge["to"], "label": edge["kind"]}
                        for edge in observation["edges"]],
        "cards": [
            {"dot": "cyan", "title": "Read the arrows", "items": ["contains: parent.exceptions holds the child", "caused-by: source.__cause__ points to target"]},
            {"dot": "emerald", "title": "Same identity, two printed places", "items": ["inner and leaf each print twice in this run", "outer contains the same inner that is raised", "Repeated text does not count objects or runs"]},
            {"dot": "rose", "title": "Deliberate synthetic fixture", "items": ["Python " + observation["python"] + " stdlib; 3 live objects", "Not a production failure or a call-time graph", "No locals, log import, or traceback parser"]},
        ],
    }


if __name__ == "__main__":
    if sys.version_info < (3, 11):
        raise SystemExit("Python >=3.11 required")
    observation = observe(construct())
    Path("raw").mkdir(exist_ok=True)
    Path("raw/traceback.txt").write_text(observation["traceback"])
    # Only replace this known fixture filename; preserve line numbers and actual formatter text.
    observation["traceback"] = observation["traceback"].replace(str(Path(__file__).resolve()), "fixture.py")
    observation["traceback_path_policy"] = "Exact fixture absolute filename replaced with fixture.py; raw remains local"
    Path("evidence/observation.json").write_text(json.dumps(observation, indent=2) + "\n")
    Path("evidence/traceback.txt").write_text(observation["traceback"])
    Path("candidate.json").write_text(json.dumps(candidate(observation), indent=2) + "\n")
