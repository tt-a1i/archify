# Verified PyYAML value/type case

PyYAML 6.0.3 tag 6.0.3 is pinned to 49790e73684bebad1df05ef8d828fa12f685bffb. Python 3.12.13 in an isolated venv. Default yaml.safe_load calls the Python SafeLoader; this case does not switch to CSafeLoader, mutate resolvers or register custom constructors. Installed resolver.py, constructor.py, loader.py and __init__.py bytes match the pinned files; see identity.json. Four files are not full wheel build reproduction.

Primary sources:
- safe_load entrypoint and its basic-tag scope: https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/__init__.py#L117-L125
- SafeLoader composition includes SafeConstructor and Resolver: https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/loader.py#L31-L40
- Implicit scalar resolution and default string tag fallback: https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/resolver.py#L143-L166
- Boolean spelling pattern (includes on/off, yes/no and specific capitalization variants): https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/resolver.py#L170-L176
- Boolean construction: https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/constructor.py#L224-L235
- Mapping keys are constructed and assigned to a Python dict: https://github.com/yaml/pyyaml/blob/49790e73684bebad1df05ef8d828fa12f685bffb/lib/yaml/constructor.py#L132-L145
- Documentation (older examples, not the executable version identity): https://pyyaml.org/wiki/PyYAMLDocumentation

Own probe.py ran twice in separate processes; the JSON results are byte-identical. The eight scalar cases use the mapping key flag:
1. flag: on -> Python True, bool, resolved bool tag.
2. flag: "on" -> Python 'on', str, resolved str tag.
3. flag: 'on' -> Python 'on', str.
4. flag: !!str on -> Python 'on', str.
5. flag: off -> Python False, bool.
6. flag: 42 -> Python 42, int.
7. flag: "42" -> Python '42', str.
8. flag: oN -> Python 'oN', str. The exact resolver pattern matters: do not say every case-insensitive spelling is accepted.

Two mapping controls:
- on: first followed by yes: second -> {True: 'second'}, one key. Both plain keys resolve to the same bool key and the second assignment replaces the first value.
- "on": first followed by "yes": second -> {'on': 'first', 'yes': 'second'}, two string keys.
JSON results store key repr/type separately, avoiding JSON object-key stringification hiding the bool distinction.

Main reading question: why plain on is not the string 'on', and how quoting or !!str changes the result. The safe in safe_load concerns supported object construction, not keeping every scalar as text. No security audit or absolute-safety claim; do not recommend unsafe loading. A small complete Python program printing repr(value) and type(value).__name__ can reproduce the central comparison with the installed dependency. Quotes shown inside YAML are part of the YAML text; distinguish them from Python string delimiters.

Keep the key-collision qualification short if included. The page need not list all ten probe cases. Do not generalize to all YAML parsers/specifications, all PyYAML versions, custom loaders or untested C backends. No performance measurement. Use the actual values/types rather than a diagram implying a parser-independent rule.
