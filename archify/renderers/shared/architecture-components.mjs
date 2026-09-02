// Traverse authored Architecture components in stable pre-order while keeping
// local identities scoped to their immediate parent. The schema forbids deeper
// nesting; this iterator intentionally never recurses.
export function* iterateArchitectureComponents(diagram) {
  const components = Array.isArray(diagram?.components) ? diagram.components : [];
  for (const [componentIndex, component] of components.entries()) {
    yield {
      component,
      parentId: null,
      path: `/components/${componentIndex}`,
      scope: 'main',
    };

    const children = Array.isArray(component?.subarchitecture?.components)
      ? component.subarchitecture.components
      : [];
    for (const [childIndex, child] of children.entries()) {
      yield {
        component: child,
        parentId: component.id,
        path: `/components/${componentIndex}/subarchitecture/components/${childIndex}`,
        scope: 'subarchitecture',
      };
    }
  }
}
