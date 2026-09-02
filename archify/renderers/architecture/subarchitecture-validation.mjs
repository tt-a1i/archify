import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function fail(code, message, subject) {
  throwDiagnosticProblems(
    'Architecture subarchitecture validation failed',
    [message],
    {
      code,
      subject: { diagramType: 'architecture', ...subject },
    },
  );
}

function duplicateComponent(scope, duplicate) {
  fail(
    'architecture/subarchitecture/duplicate-component-id',
    `${duplicate.path} duplicates local component id ${JSON.stringify(duplicate.id)} first declared at ${duplicate.firstPath}.`,
    {
      path: duplicate.path,
      parentId: scope.parentId,
      childId: duplicate.id,
    },
  );
}

function duplicateConnection(scope, duplicate) {
  fail(
    'architecture/subarchitecture/duplicate-connection-id',
    `${duplicate.path} duplicates local connection id ${JSON.stringify(duplicate.id)} first declared at ${duplicate.firstPath}.`,
    {
      path: duplicate.path,
      parentId: scope.parentId,
      connectionId: duplicate.id,
    },
  );
}

function invalidLocalReference({ scope, childOwners, parentIds, value, path, unknownCode }) {
  const outsideLocalScope = parentIds.has(value) || childOwners.has(value);
  if (outsideLocalScope) {
    fail(
      'architecture/subarchitecture/scope-crossing',
      `${path} references ${JSON.stringify(value)} outside the local scope of parent ${JSON.stringify(scope.parentId)}.`,
      {
        path,
        parentId: scope.parentId,
        childId: value,
      },
    );
  }
  fail(
    unknownCode,
    `${path} references unknown local component ${JSON.stringify(value)}.`,
    {
      path,
      parentId: scope.parentId,
      childId: value,
    },
  );
}

export function validateArchitectureSubarchitectures(diagram) {
  const parents = asArray(diagram?.components);
  const parentIds = new Set(parents.map((component) => component.id));
  const childOwners = new Map();
  const scopes = [];

  // Build the complete one-level identity index before resolving references so
  // an endpoint can truthfully distinguish a later sibling scope from an
  // entirely unknown id. Duplicate ids remain legal across different parents.
  parents.forEach((parent, parentIndex) => {
    const subarchitecture = parent?.subarchitecture;
    if (!subarchitecture) return;

    const componentPaths = new Map();
    const duplicateComponents = [];
    const localIds = new Set();
    asArray(subarchitecture.components).forEach((component, componentIndex) => {
      const componentPath = `/components/${parentIndex}/subarchitecture/components/${componentIndex}/id`;
      if (componentPaths.has(component.id)) {
        duplicateComponents.push({
          id: component.id,
          path: componentPath,
          firstPath: componentPaths.get(component.id),
        });
      } else {
        componentPaths.set(component.id, componentPath);
      }
      localIds.add(component.id);
      const owners = childOwners.get(component.id) || [];
      owners.push({ parentId: parent.id, parentIndex, path: componentPath });
      childOwners.set(component.id, owners);
    });

    const connectionPaths = new Map();
    const duplicateConnections = new Map();
    asArray(subarchitecture.connections).forEach((connection, connectionIndex) => {
      if (typeof connection.id !== 'string' || connection.id.length === 0) return;
      const connectionPath = `/components/${parentIndex}/subarchitecture/connections/${connectionIndex}/id`;
      if (connectionPaths.has(connection.id)) {
        duplicateConnections.set(connectionIndex, {
          id: connection.id,
          path: connectionPath,
          firstPath: connectionPaths.get(connection.id),
        });
      } else {
        connectionPaths.set(connection.id, connectionPath);
      }
    });

    scopes.push({
      parentId: parent.id,
      parentIndex,
      subarchitecture,
      localIds,
      duplicateComponents,
      duplicateConnections,
    });
  });

  for (const scope of scopes) {
    if (scope.duplicateComponents.length) {
      duplicateComponent(scope, scope.duplicateComponents[0]);
    }

    for (const [connectionIndex, connection] of asArray(scope.subarchitecture.connections).entries()) {
      const duplicate = scope.duplicateConnections.get(connectionIndex);
      if (duplicate) duplicateConnection(scope, duplicate);

      for (const endpoint of ['from', 'to']) {
        const value = connection[endpoint];
        if (scope.localIds.has(value)) continue;
        invalidLocalReference({
          scope,
          childOwners,
          parentIds,
          value,
          path: `/components/${scope.parentIndex}/subarchitecture/connections/${connectionIndex}/${endpoint}`,
          unknownCode: 'architecture/subarchitecture/unknown-endpoint',
        });
      }
    }

    for (const [boundaryIndex, boundary] of asArray(scope.subarchitecture.boundaries).entries()) {
      for (const [memberIndex, value] of asArray(boundary.wraps).entries()) {
        if (scope.localIds.has(value)) continue;
        invalidLocalReference({
          scope,
          childOwners,
          parentIds,
          value,
          path: `/components/${scope.parentIndex}/subarchitecture/boundaries/${boundaryIndex}/wraps/${memberIndex}`,
          unknownCode: 'architecture/subarchitecture/unknown-boundary-member',
        });
      }
    }
  }

  // Parent-scope connections keep their existing unknown-endpoint behavior.
  // Only ids known to belong exclusively to a child scope are intercepted.
  for (const [connectionIndex, connection] of asArray(diagram?.connections).entries()) {
    for (const endpoint of ['from', 'to']) {
      const value = connection[endpoint];
      if (parentIds.has(value) || !childOwners.has(value)) continue;
      const referencePath = `/connections/${connectionIndex}/${endpoint}`;
      fail(
        'architecture/subarchitecture/scope-crossing',
        `${referencePath} references child component ${JSON.stringify(value)} from the parent scope.`,
        {
          path: referencePath,
          childId: value,
        },
      );
    }
  }
}
