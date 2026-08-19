import { throwDiagnosticError } from './diagnostics.mjs';

const DEPLOYMENT_PROFILE = 'deployment-ownership';
const DEPLOYMENT_BOUNDARY_KINDS = new Set(['region', 'security-group']);
const PRIVATE_STATE_TYPES = new Set(['database']);

function subject(collection, index, item = {}) {
  return {
    diagramType: 'architecture',
    profile: DEPLOYMENT_PROFILE,
    collection,
    index,
    ...(item.id ? { id: item.id } : {}),
  };
}

function membership(boundaries, componentId, kind) {
  return boundaries
    .map((boundary, index) => ({ boundary, index }))
    .filter(({ boundary }) => boundary.kind === kind && boundary.wraps.includes(componentId));
}

export function deploymentOwnershipDiagnostics(diagram) {
  const components = Array.isArray(diagram.components) ? diagram.components : [];
  const boundaries = (Array.isArray(diagram.boundaries) ? diagram.boundaries : [])
    .map((boundary) => ({ ...boundary, wraps: Array.isArray(boundary.wraps) ? boundary.wraps : [] }));
  const connections = Array.isArray(diagram.connections) ? diagram.connections : [];
  const diagnostics = [];

  for (const kind of DEPLOYMENT_BOUNDARY_KINDS) {
    const count = boundaries.filter((boundary) => boundary.kind === kind).length;
    if (count > 0) continue;
    diagnostics.push({
      code: 'engineering/deployment-boundary-kind',
      severity: 'error',
      message: `Deployment ownership requires at least one ${kind} boundary.`,
      subject: subject('boundaries', -1),
      evidence: { requiredKind: kind, found: count },
      supportedFixes: [`add one ${kind} boundary with an explicit wraps list`],
    });
  }

  components.forEach((component, index) => {
    if (component.type === 'external') return;
    if (typeof component.tag !== 'string' || component.tag.trim() === '') {
      diagnostics.push({
        code: 'engineering/deployment-owner-missing',
        severity: 'error',
        message: `Deployment component ${JSON.stringify(component.id)} does not name its owner in tag.`,
        subject: subject('components', index, component),
        evidence: { componentType: component.type, ownerField: 'tag' },
        supportedFixes: [`set /components/${index}/tag to the responsible team or owner`],
      });
    }

    const regions = membership(boundaries, component.id, 'region');
    if (regions.length === 0) {
      diagnostics.push({
        code: 'engineering/deployment-region-scope',
        severity: 'error',
        message: `Deployment component ${JSON.stringify(component.id)} is not assigned to a region boundary.`,
        subject: subject('components', index, component),
        evidence: { componentType: component.type, regionMemberships: 0 },
        supportedFixes: ['add the component id to the real region boundary wraps list'],
      });
    } else if (regions.length > 1) {
      diagnostics.push({
        code: 'engineering/deployment-region-ambiguous',
        severity: 'error',
        message: `Deployment component ${JSON.stringify(component.id)} belongs to more than one region boundary.`,
        subject: subject('components', index, component),
        evidence: {
          componentType: component.type,
          regions: regions.map(({ boundary, index: boundaryIndex }) => ({ boundaryIndex, label: boundary.label })),
        },
        supportedFixes: ['keep the component id in exactly one real region boundary wraps list'],
      });
    }

    if (PRIVATE_STATE_TYPES.has(component.type)) {
      const privateScopes = membership(boundaries, component.id, 'security-group');
      if (privateScopes.length === 0) {
        diagnostics.push({
          code: 'engineering/deployment-private-state',
          severity: 'error',
          message: `Stateful component ${JSON.stringify(component.id)} is not assigned to a private security-group boundary.`,
          subject: subject('components', index, component),
          evidence: { componentType: component.type, privateMemberships: 0 },
          supportedFixes: ['add the component id to the real private security-group boundary wraps list'],
        });
      }
    }
  });

  boundaries.forEach((boundary, index) => {
    if (boundary.kind !== 'security-group') return;
    const members = boundary.wraps.map((id) => ({
      id,
      regions: membership(boundaries, id, 'region').map(({ boundary: region, index: boundaryIndex }) => ({
        boundaryIndex,
        label: region.label,
      })),
    }));
    const regionIndexes = new Set(members.flatMap((member) => member.regions.map((region) => region.boundaryIndex)));
    const consistent = members.length > 0
      && members.every((member) => member.regions.length === 1)
      && regionIndexes.size === 1;
    if (consistent) return;
    diagnostics.push({
      code: 'engineering/deployment-private-region-consistency',
      severity: 'error',
      message: `Private boundary ${JSON.stringify(boundary.label)} must contain components from exactly one shared region.`,
      subject: subject('boundaries', index, boundary),
      evidence: { boundaryKind: boundary.kind, members },
      supportedFixes: ['assign every private-boundary component to exactly one shared region boundary'],
    });
  });

  connections.forEach((connection, index) => {
    const crossedBoundaries = boundaries
      .map((boundary, boundaryIndex) => ({
        boundaryIndex,
        kind: boundary.kind,
        label: boundary.label,
        fromInside: boundary.wraps.includes(connection.from),
        toInside: boundary.wraps.includes(connection.to),
      }))
      .filter((boundary) => DEPLOYMENT_BOUNDARY_KINDS.has(boundary.kind) && boundary.fromInside !== boundary.toInside);
    if (crossedBoundaries.length === 0 || (typeof connection.label === 'string' && connection.label.trim() !== '')) return;
    diagnostics.push({
      code: 'engineering/deployment-crossing-mechanism',
      severity: 'error',
      message: `Cross-boundary connection ${JSON.stringify(connection.id || `${connection.from}->${connection.to}`)} does not name its mechanism.`,
      subject: subject('connections', index, connection),
      evidence: {
        from: connection.from,
        to: connection.to,
        crossedBoundaries: crossedBoundaries.map(({ boundaryIndex, kind, label }) => ({ boundaryIndex, kind, label })),
      },
      supportedFixes: [`set /connections/${index}/label to the real cross-boundary mechanism`],
    });
  });

  return diagnostics;
}

export function validateEngineeringProfile(diagramType, diagram) {
  const profile = diagram.meta?.engineering_profile;
  if (!profile) return;
  if (diagramType !== 'architecture' || profile !== DEPLOYMENT_PROFILE) return;
  const diagnostics = deploymentOwnershipDiagnostics(diagram);
  if (!diagnostics.length) return;
  throwDiagnosticError(
    `Engineering profile ${JSON.stringify(profile)} failed:\n${diagnostics.map((entry) => `- ${entry.message}`).join('\n')}`,
    diagnostics,
  );
}
