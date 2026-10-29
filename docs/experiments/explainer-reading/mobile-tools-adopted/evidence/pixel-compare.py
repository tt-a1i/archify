import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops

r = Path(__file__).parent
rows = []
for name in ['taskgroup', 'curl']:
    for width in [320, 1440]:
        paths = [r / f'{name}-{arm}-{width}.png' for arm in ['base', 'candidate']]
        a, b = [Image.open(p).convert('RGBA') for p in paths]
        box = (0, 0, min(a.width, b.width), min(a.height, b.height))
        difference = ImageChops.difference(a.crop(box), b.crop(box)).convert('RGB')
        rows.append({'name': name, 'viewportWidth': width, 'baseDimensions': list(a.size), 'candidateDimensions': list(b.size), 'fileBytesIdentical': paths[0].read_bytes() == paths[1].read_bytes(), 'sharedAreaPixelsIdentical': difference.getbbox() is None, 'sharedAreaDifferenceBounds': difference.getbbox(), 'sha256': {arm: hashlib.sha256(p.read_bytes()).hexdigest() for arm, p in zip(['base', 'candidate'], paths)}})
(r / 'export-pixel-comparison.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps(rows, indent=2))
