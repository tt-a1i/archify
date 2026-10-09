// Route segments that run alongside a box they do not end on, closer than
// `gap` units for more than `minimum` units: the line reads as that box's
// border instead of a relationship passing by.
export function routeHugs(routes, boxes, { gap = 8, minimum = 12 } = {}) {
  const hits = [];
  for (const route of routes) {
    for (let index = 0; index < route.points.length - 1; index += 1) {
      const [a, b] = [route.points[index], route.points[index + 1]];
      for (const [id, box] of boxes) {
        if ((id === route.from && index === 0) || (id === route.to && index === route.points.length - 2)) continue;
        const horizontal = Math.abs(a[1] - b[1]) < 0.01;
        if (!horizontal && Math.abs(a[0] - b[0]) >= 0.01) continue;
        const [along, across, start, size, crossStart, crossSize] = horizontal
          ? [0, 1, box.x, box.width, box.y, box.height]
          : [1, 0, box.y, box.height, box.x, box.width];
        const overlap = Math.min(Math.max(a[along], b[along]), start + size) - Math.max(Math.min(a[along], b[along]), start);
        if (overlap < minimum) continue;
        const position = a[across];
        const distance = position < crossStart ? crossStart - position
          : position > crossStart + crossSize ? position - crossStart - crossSize : -1;
        if (distance >= 0 && distance < gap) hits.push({ route: route.id, box: id, distance, overlap });
      }
    }
  }
  return hits;
}
