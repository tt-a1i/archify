import {
  brandMarkFor,
  brandMetadataFor,
  renderBrandMark,
} from './brand-marks.mjs';
import {
  capabilityMarkFor,
  renderCapabilityMark,
} from './capability-marks.mjs';
import { textUnits } from './utils.mjs';

export function identityMarkFor(node) {
  return brandMarkFor(node) || capabilityMarkFor(node);
}

export function identityMetadataFor(node) {
  const brand = brandMarkFor(node);
  if (brand) return brandMetadataFor(node);
  const capability = capabilityMarkFor(node);
  return capability ? {
    capability: capability.title,
    capabilityId: capability.id,
  } : {};
}

export function identityLabelFitWidth(node, width) {
  return identityMarkFor(node) ? Math.max(1, width - 48) : width;
}

export function identityTopRailProblem(node, width, minimumFontSize, subject = 'Node') {
  if (!identityMarkFor(node)) return null;
  const available = width - 48;
  const required = textUnits(node.label) * minimumFontSize * 0.6;
  if (available >= required) return null;
  const kind = capabilityMarkFor(node) ? 'capability' : 'brand';
  return `${subject} "${node.id}" ${kind} top rail leaves ${Math.max(0, available)}px for its label, but `
    + `"${node.label}" needs ~${Math.ceil(required)}px at the ${minimumFontSize}px legible minimum — widen the node or shorten the label.`;
}

export function renderIdentityMark(node, position) {
  return brandMarkFor(node)
    ? renderBrandMark(node, position)
    : renderCapabilityMark(node, position);
}
