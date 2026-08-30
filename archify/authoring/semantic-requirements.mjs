import { createHash } from 'node:crypto';
import { QUALITY_CONTRACT } from './quality-contract.mjs';

const COLLECTIONS = Object.freeze({
  architecture: { entities: 'components', relationships: 'connections' },
  workflow: { entities: 'nodes', relationships: 'edges' },
  sequence: { entities: 'participants', relationships: 'messages' },
  dataflow: { entities: 'nodes', relationships: 'flows' },
  lifecycle: { entities: 'states', relationships: 'transitions' },
});
const SAFE_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_-]*$/u;

function normalizeTechnicalLabel(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function technicalLabelMatches(actual, expected) {
  const normalizedActual = normalizeTechnicalLabel(actual);
  const normalizedExpected = normalizeTechnicalLabel(expected);
  if (!normalizedActual || !normalizedExpected) return false;
  return ` ${normalizedActual} `.includes(` ${normalizedExpected} `);
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0
    || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new TypeError(`${label} must be a non-empty array of non-empty strings.`);
  }
  const normalized = value.map((entry) => entry.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${label} must not contain duplicates.`);
  }
  return normalized;
}

function semanticScopePolicy(scopeProfile, diagramType) {
  const profiles = QUALITY_CONTRACT.semanticScope.profiles;
  if (scopeProfile === 'focused') return profiles.focused;
  if (scopeProfile === 'project-overview') return profiles['project-overview'][diagramType];
  return undefined;
}

function normalizeEntity(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`semantic requirements entities[${index}] must be an object.`);
  }
  if (typeof raw.key !== 'string' || !SAFE_IDENTIFIER.test(raw.key.trim())) {
    throw new TypeError(`semantic requirements entities[${index}].key must be a safe identifier matching ${SAFE_IDENTIFIER.source}.`);
  }
  const entity = {
    key: raw.key.trim(),
    labels: uniqueStrings(raw.labels, `semantic requirements entities[${index}].labels`),
    claimIds: uniqueStrings(raw.claimIds, `semantic requirements entities[${index}].claimIds`),
  };
  if (raw.roles !== undefined) {
    entity.roles = uniqueStrings(raw.roles, `semantic requirements entities[${index}].roles`);
  } else if (raw.role !== undefined) {
    if (typeof raw.role !== 'string' || !raw.role.trim()) {
      throw new TypeError(`semantic requirements entities[${index}].role must be a non-empty string.`);
    }
    entity.roles = [raw.role.trim()];
  }
  if (raw.types !== undefined) {
    entity.types = uniqueStrings(raw.types, `semantic requirements entities[${index}].types`);
  } else if (raw.type !== undefined) {
    if (typeof raw.type !== 'string' || !raw.type.trim()) {
      throw new TypeError(`semantic requirements entities[${index}].type must be a non-empty string.`);
    }
    entity.types = [raw.type.trim()];
  }
  for (const [plural, singular] of [['sublabels', 'sublabel'], ['tags', 'tag']]) {
    if (raw[plural] !== undefined) {
      entity[plural] = uniqueStrings(raw[plural], `semantic requirements entities[${index}].${plural}`);
    } else if (raw[singular] !== undefined) {
      if (typeof raw[singular] !== 'string' || !raw[singular].trim()) {
        throw new TypeError(`semantic requirements entities[${index}].${singular} must be a non-empty string.`);
      }
      entity[plural] = [raw[singular].trim()];
    }
  }
  return entity;
}

function normalizeRelationship(raw, index, entityKeys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`semantic requirements relationships[${index}] must be an object.`);
  }
  for (const endpoint of ['from', 'to']) {
    if (typeof raw[endpoint] !== 'string' || !entityKeys.has(raw[endpoint])) {
      throw new TypeError(`semantic requirements relationships[${index}].${endpoint} must reference a declared entity key.`);
    }
  }
  const relationship = {
    from: raw.from,
    to: raw.to,
    claimIds: uniqueStrings(raw.claimIds, `semantic requirements relationships[${index}].claimIds`),
  };
  if (raw.labels !== undefined) {
    relationship.labels = uniqueStrings(raw.labels, `semantic requirements relationships[${index}].labels`);
  } else {
    if (typeof raw.label !== 'string' || !raw.label.trim()) {
      throw new TypeError(`semantic requirements relationships[${index}] must declare labels or label.`);
    }
    relationship.labels = [raw.label.trim()];
  }
  if (raw.variant !== undefined) relationship.variant = raw.variant;
  return relationship;
}

export function normalizeSemanticRequirements(document, diagramType) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('semantic requirements must contain a JSON object.');
  }
  if (![1, QUALITY_CONTRACT.semanticScope.currentRequirementsSchemaVersion]
    .includes(document.schemaVersion)) {
    throw new TypeError(`semantic requirements schemaVersion must be 1 or ${QUALITY_CONTRACT.semanticScope.currentRequirementsSchemaVersion}.`);
  }
  if (!COLLECTIONS[diagramType] || document.diagramType !== diagramType) {
    throw new TypeError('semantic requirements diagramType must match the authoring run.');
  }
  const scopeProfile = document.schemaVersion === 1
    ? QUALITY_CONTRACT.semanticScope.legacyRequirementsProfile
    : document.scopeProfile;
  if (!semanticScopePolicy(scopeProfile, diagramType)) {
    throw new TypeError('semantic requirements scopeProfile must be focused or project-overview.');
  }
  const scopePolicy = semanticScopePolicy(scopeProfile, diagramType);
  if (!Array.isArray(document.entities)
    || document.entities.length < scopePolicy.minimumRequiredEntities) {
    throw new TypeError(`semantic requirements ${scopeProfile} scope must declare at least ${scopePolicy.minimumRequiredEntities} entities.`);
  }
  if (!Array.isArray(document.relationships)
    || document.relationships.length < scopePolicy.minimumRequiredRelationships) {
    throw new TypeError(`semantic requirements ${scopeProfile} scope must declare at least ${scopePolicy.minimumRequiredRelationships} relationships.`);
  }
  const entities = document.entities.map(normalizeEntity);
  const entityKeys = new Set(entities.map((entity) => entity.key));
  if (entityKeys.size !== entities.length) {
    throw new TypeError('semantic requirement entity keys must be unique.');
  }
  const relationships = document.relationships.map(
    (relationship, index) => normalizeRelationship(relationship, index, entityKeys),
  );
  if (scopeProfile === 'project-overview') {
    for (const [index, entity] of entities.entries()) {
      if (!entity.roles?.length) {
        throw new TypeError(`semantic requirements project-overview entities[${index}] must declare at least one role.`);
      }
      const unsupportedRoles = entity.roles.filter((role) => !scopePolicy.requiredRoles.includes(role));
      if (unsupportedRoles.length > 0) {
        throw new TypeError(`semantic requirements project-overview entities[${index}] declares unsupported semantic roles: ${unsupportedRoles.join(', ')}.`);
      }
    }
  }
  const coveredRoles = [...new Set(entities.flatMap((entity) => entity.roles || []))];
  const missingRoles = scopePolicy.requiredRoles.filter((role) => !coveredRoles.includes(role));
  if (missingRoles.length > 0) {
    throw new TypeError(`semantic requirements ${scopeProfile} scope is missing required semantic roles: ${missingRoles.join(', ')}.`);
  }
  const uniqueClaimIds = new Set([
    ...entities.flatMap((entity) => entity.claimIds),
    ...relationships.flatMap((relationship) => relationship.claimIds),
  ]);
  if (uniqueClaimIds.size < scopePolicy.minimumUniqueRequiredClaimIds) {
    throw new TypeError(`semantic requirements ${scopeProfile} scope must reference at least ${scopePolicy.minimumUniqueRequiredClaimIds} unique claim IDs.`);
  }
  return {
    schemaVersion: document.schemaVersion,
    diagramType,
    scopeProfile,
    entities,
    relationships,
  };
}

function bindEntity(required, candidates) {
  let matches = candidates.filter((candidate) => (
    required.labels.some((label) => technicalLabelMatches(candidate?.label, label))
  ));
  if (required.types) matches = matches.filter((candidate) => required.types.includes(candidate?.type));
  for (const [acceptedField, actualField] of [['sublabels', 'sublabel'], ['tags', 'tag']]) {
    if (!required[acceptedField] || matches.length <= 1) continue;
    const narrowed = matches.filter((candidate) => (
      required[acceptedField].some((value) => technicalLabelMatches(candidate?.[actualField], value))
    ));
    if (narrowed.length > 0) matches = narrowed;
  }
  return matches;
}

export function verifySemanticRequirements({ requirements, candidate, evidenceFacts }) {
  const normalized = normalizeSemanticRequirements(requirements, candidate?.diagram_type);
  const scopePolicy = semanticScopePolicy(normalized.scopeProfile, normalized.diagramType);
  const collections = COLLECTIONS[normalized.diagramType];
  const entities = Array.isArray(candidate?.[collections.entities])
    ? candidate[collections.entities]
    : [];
  const relationships = Array.isArray(candidate?.[collections.relationships])
    ? candidate[collections.relationships]
    : [];
  if (entities.length < normalized.entities.length) {
    throw new Error(`[semantic/insufficient-candidate-entities] candidate provides ${entities.length} entities but ${normalized.entities.length} distinct required entities must be covered; [semantic/missing-entity] at least one required entity cannot be uniquely covered.`);
  }
  if (relationships.length < normalized.relationships.length) {
    const firstUncovered = normalized.relationships[relationships.length];
    throw new Error(`[semantic/insufficient-candidate-relationships] candidate provides ${relationships.length} relationships but ${normalized.relationships.length} distinct required relationships must be covered; [semantic/missing-relationship] required relationship ${firstUncovered.from} -> ${firstUncovered.to} cannot be uniquely covered.`);
  }
  const ledgerClaimIds = new Set((evidenceFacts || []).map((fact) => fact?.claimId));
  const requiredClaimIds = [...new Set([
    ...normalized.entities.flatMap((entity) => entity.claimIds),
    ...normalized.relationships.flatMap((relationship) => relationship.claimIds),
  ])];
  const missingClaimIds = requiredClaimIds.filter((claimId) => !ledgerClaimIds.has(claimId));
  if (missingClaimIds.length > 0) {
    throw new Error(`[semantic/unverified-claim] requirements reference claim IDs absent from the verified EvidenceLedger: ${missingClaimIds.join(', ')}`);
  }
  const requiredClaimIdSet = new Set(requiredClaimIds);
  const distinctSourceFiles = new Set((evidenceFacts || [])
    .filter((fact) => requiredClaimIdSet.has(fact?.claimId))
    .map((fact) => fact?.path)
    .filter((entry) => typeof entry === 'string' && entry.trim()));
  if (distinctSourceFiles.size < scopePolicy.minimumDistinctSourceFiles) {
    throw new Error(`[semantic/insufficient-evidence-breadth] ${normalized.scopeProfile} scope requires at least ${scopePolicy.minimumDistinctSourceFiles} distinct source files; found ${distinctSourceFiles.size}.`);
  }

  const bindings = new Map();
  const usedCandidateEntityIds = new Map();
  for (const required of normalized.entities) {
    const matches = bindEntity(required, entities);
    if (matches.length === 0) {
      throw new Error(`[semantic/missing-entity] required entity ${required.key} (${required.labels.join(' | ')}) is absent from the candidate.`);
    }
    if (matches.length > 1) {
      throw new Error(`[semantic/ambiguous-entity] required entity ${required.key} matches multiple candidate IDs: ${matches.map((entry) => entry.id).join(', ')}`);
    }
    if (typeof matches[0].id !== 'string' || !matches[0].id.trim()) {
      throw new Error(`[semantic/invalid-candidate-entity] required entity ${required.key} matched an entity without an ID.`);
    }
    const candidateId = matches[0].id.trim();
    const previousRequirement = usedCandidateEntityIds.get(candidateId);
    if (previousRequirement) {
      throw new Error(`[semantic/reused-entity] required entities ${previousRequirement} and ${required.key} both match candidate ID ${candidateId}.`);
    }
    usedCandidateEntityIds.set(candidateId, required.key);
    bindings.set(required.key, candidateId);
  }
  if (bindings.size !== normalized.entities.length) {
    throw new Error(`[semantic/incomplete-entity-bindings] bound ${bindings.size} of ${normalized.entities.length} required entities.`);
  }

  const usedCandidateRelationshipIndexes = new Map();
  const relationshipBindings = normalized.relationships.map((required) => {
    const from = bindings.get(required.from);
    const to = bindings.get(required.to);
    const matches = relationships
      .map((relationship, index) => ({ relationship, index }))
      .filter(({ relationship }) => (
        relationship?.from === from
        && relationship?.to === to
        && required.labels.some((label) => technicalLabelMatches(relationship?.label, label))
        && (required.variant === undefined || relationship?.variant === required.variant)
      ));
    if (matches.length === 0) {
      throw new Error(`[semantic/missing-relationship] required relationship ${required.from} -> ${required.to}${required.labels ? ` (${required.labels.join(' | ')})` : ''} is absent from the candidate.`);
    }
    if (matches.length > 1) {
      throw new Error(`[semantic/ambiguous-relationship] required relationship ${required.from} -> ${required.to} matches multiple candidate relationships.`);
    }
    const previousRequirement = usedCandidateRelationshipIndexes.get(matches[0].index);
    if (previousRequirement) {
      throw new Error(`[semantic/reused-relationship] required relationships ${previousRequirement} and ${required.from} -> ${required.to} both match the same candidate relationship.`);
    }
    usedCandidateRelationshipIndexes.set(
      matches[0].index,
      `${required.from} -> ${required.to}`,
    );
    return {
      from: required.from,
      to: required.to,
      candidateId: matches[0].relationship.id || null,
      candidateFrom: from,
      candidateTo: to,
      claimIds: required.claimIds,
    };
  });
  if (relationshipBindings.length !== normalized.relationships.length
    || usedCandidateRelationshipIndexes.size !== normalized.relationships.length) {
    throw new Error(`[semantic/incomplete-relationship-bindings] bound ${usedCandidateRelationshipIndexes.size} of ${normalized.relationships.length} required relationships.`);
  }

  const receiptBody = {
    schemaVersion: 1,
    status: 'covered',
    verificationScope: 'mechanical-label-relationship-claim-role-density-and-source-breadth',
    semanticCorrectness: 'bounded-by-authored-requirements',
    scopeProfile: normalized.scopeProfile,
    density: {
      entities: normalized.entities.length,
      relationships: normalized.relationships.length,
      required: {
        entities: normalized.entities.length,
        relationships: normalized.relationships.length,
      },
      actual: {
        entities: entities.length,
        relationships: relationships.length,
      },
      targetPrimaryRange: scopePolicy.targetPrimaryRange || null,
    },
    roleCoverage: {
      required: scopePolicy.requiredRoles,
      covered: [...new Set(normalized.entities.flatMap((entity) => entity.roles || []))],
      missing: [],
    },
    evidenceBreadth: {
      distinctSourceFiles: distinctSourceFiles.size,
      minimumDistinctSourceFiles: scopePolicy.minimumDistinctSourceFiles,
    },
    bindings: Object.fromEntries(bindings),
    relationshipBindings,
    requirementsCovered: normalized.entities.length + normalized.relationships.length,
    requirementsTotal: normalized.entities.length + normalized.relationships.length,
    verifiedClaimIds: requiredClaimIds,
  };
  return {
    ...receiptBody,
    digest: createHash('sha256').update(JSON.stringify(receiptBody)).digest('hex'),
  };
}

export const semanticRequirementCollections = COLLECTIONS;
