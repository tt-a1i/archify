### Cross-module 10

| Metric | A | B | Δ | B better / A better / tie |
| --- | ---: | ---: | ---: | --- |
| P@3 | 0.767 | 0.700 | −0.067 | 1 / 3 / 6 |
| Recall@3 | 0.767 | 0.700 | −0.067 | 1 / 3 / 6 |
| Hit@1 | 0.90 | 0.90 | 0 | 0 / 0 / 10 |
| Seam yes | 0.80 | 0.90 | +0.10 | 1 / 0 / 9 |
| Seam yes∨partial | 1.00 | 1.00 | 0 | 0 / 0 / 10 |
| Noise-avoidance | 0.608 | 0.521 | −0.087 | 4 / 4 / 2 |
| Wrong start | 0.00 | 0.00 | 0 | 0 / 0 / 10 |

### Controls 5

| Metric | A | B | Δ | B better / A better / tie |
| --- | ---: | ---: | ---: | ---: |
| P@3 | 0.600 | 0.533 | −0.067 | 0 / 1 / 4 |
| Recall@3 | 1.00 | 0.90 | −0.10 | 0 / 1 / 4 |
| Hit@1 | 1.00 | 1.00 | 0 | 0 / 0 / 5 |
| Seam yes | 0.60 | 0.80 | +0.20 | 1 / 0 / 4 |
| Noise-avoidance | 1.00 | 1.00 | 0 | 0 / 0 / 5 |
| Wrong start | 0.00 | 0.00 | 0 | 0 / 0 / 5 |

Control P@3 looks low because #216 and #109 have one GT file (max P@3 = 0.33) and #138 has two (max 0.67). Recall@3 is the honest control number: A 1.00, B 0.90.

### All 15

P@3 A 0.711 vs B 0.644. Hit@1 0.933 both. Wrong start 0 both.
