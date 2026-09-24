import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanAmbiguousCorridorProblems, cleanEndpointSideProblems } from '../renderers/shared/geometry.mjs';

test('a shared-exit corridor names the node, the crowded side and a free side', () => {
  // Both relations leave "hub" to the right and run together along y=100.
  const paths = {
    'hub>a': [[100, 100], [300, 100], [300, 40]],
    'hub>b': [[100, 100], [300, 100], [300, 220]],
  };
  const relations = [{ id: 'to-a', from: 'hub', to: 'a' }, { id: 'to-b', from: 'hub', to: 'b' }];
  const [message] = cleanAmbiguousCorridorProblems({
    relations,
    endpointIds: new Set(['hub', 'a', 'b']),
    pathFor: (relation) => ({ points: paths[`${relation.from}>${relation.to}`] }),
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: 'showcase',
    profileIsAuthoritative: true,
    includeSharedEndpoints: () => true,
  });
  assert.match(message, /leave "hub" through its right side/);
  assert.match(message, /give "to-b" its own side, for example fromSide "bottom"/);
});

test('an endpoint-side failure names the coordinate the next point must keep', () => {
  const [message] = cleanEndpointSideProblems({
    relations: [{ id: 'play', from: 'loop', to: 'user', fromSide: 'bottom', via: [[775, 370]] }],
    endpointIds: new Set(['loop', 'user']),
    pathFor: () => ({ points: [[815, 294], [775, 370], [135, 370]] }),
    diagramType: 'architecture',
    relationCollection: 'connections',
  });
  assert.match(message, /the next point must keep x=815 and sit below the port at y=294/);
});
