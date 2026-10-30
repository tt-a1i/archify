import yaml

for text in ['flag: on', 'flag: "on"', 'flag: !!str on']:
    value = yaml.safe_load(text)['flag']
    print(text, '=>', repr(value), type(value).__name__)