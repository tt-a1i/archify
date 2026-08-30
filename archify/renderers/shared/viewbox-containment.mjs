function finiteRect(rect) {
  return rect
    && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width >= 0
    && rect.height >= 0;
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function roundedRect(rect) {
  return {
    x: rounded(rect.x),
    y: rounded(rect.y),
    width: rounded(rect.width),
    height: rounded(rect.height),
  };
}

export function normalizedViewBox(viewBox) {
  if (!Array.isArray(viewBox)) return null;
  const values = viewBox.map(Number);
  const [x, y, width, height] = values.length === 2
    ? [0, 0, values[0], values[1]]
    : values;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

/** Return every rectangle that is not fully contained by the authored viewBox. */
export function collectViewBoxRectOverflows(items, viewBox) {
  const bounds = normalizedViewBox(viewBox);
  if (!bounds) return [];
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const hits = [];
  for (const [index, item] of (items || []).entries()) {
    const rect = finiteRect(item?.rect) ? item.rect : item;
    if (!finiteRect(rect)) continue;
    const overflow = {
      left: rounded(Math.max(0, bounds.x - rect.x)),
      top: rounded(Math.max(0, bounds.y - rect.y)),
      right: rounded(Math.max(0, rect.x + rect.width - right)),
      bottom: rounded(Math.max(0, rect.y + rect.height - bottom)),
    };
    if (!Object.values(overflow).some((value) => value > 0)) continue;
    const canTranslateX = rect.width <= bounds.width;
    const canTranslateY = rect.height <= bounds.height;
    hits.push({
      item,
      index,
      rect: roundedRect(rect),
      viewBox: roundedRect(bounds),
      overflow,
      allowedTranslation: {
        ...(canTranslateX ? {
          minDx: rounded(bounds.x - rect.x),
          maxDx: rounded(right - (rect.x + rect.width)),
        } : {}),
        ...(canTranslateY ? {
          minDy: rounded(bounds.y - rect.y),
          maxDy: rounded(bottom - (rect.y + rect.height)),
        } : {}),
      },
      translationFeasible: { x: canTranslateX, y: canTranslateY },
      minimumViewBox: {
        width: rounded(rect.width),
        height: rounded(rect.height),
      },
    });
  }
  return hits;
}

function relationIdentity(relation, collectionIndex) {
  return Object.fromEntries(Object.entries({
    id: relation?.id,
    from: relation?.from,
    to: relation?.to,
    label: relation?.label,
    collectionIndex,
  }).filter(([, value]) => value !== undefined));
}

function collectionIndexForLabel(label, fallbackIndex) {
  const stableRelationIndex = Number(label?.relation?.key);
  return Number.isInteger(stableRelationIndex) && stableRelationIndex >= 0
    ? stableRelationIndex
    : Number.isInteger(label?.relationIndex)
      ? label.relationIndex
      : fallbackIndex;
}

/**
 * Convert relationship label-mask overflow into one exact authored-control
 * issue per label. The returned values intentionally match LayoutIssue so a
 * renderer can mix them with legacy string problems.
 */
export function relationshipLabelContainmentIssues({
  labels,
  viewBox,
  diagramType,
  relationCollection,
  controlField = 'labelAt',
} = {}) {
  return collectViewBoxRectOverflows(labels, viewBox).map((hit) => {
    const label = hit.item;
    const relation = label.relation || {};
    const collectionIndex = collectionIndexForLabel(label, hit.index);
    const path = relationCollection
      ? `/${relationCollection}/${collectionIndex}/${controlField}`
      : null;
    const textPath = relationCollection
      ? `/${relationCollection}/${collectionIndex}/label`
      : null;
    const oversizedWidth = hit.translationFeasible.x === false;
    const oversizedHeight = hit.translationFeasible.y === false;
    const translationFeasible = !oversizedWidth && !oversizedHeight;
    const anchorX = Number(label.lx);
    const anchorY = Number(label.ly);
    const allowedLabelAt = translationFeasible
      && Number.isFinite(anchorX)
      && Number.isFinite(anchorY)
      ? {
        minX: rounded(anchorX + hit.allowedTranslation.minDx),
        maxX: rounded(anchorX + hit.allowedTranslation.maxDx),
        minY: rounded(anchorY + hit.allowedTranslation.minDy),
        maxY: rounded(anchorY + hit.allowedTranslation.maxDy),
      }
      : null;
    const exactFix = allowedLabelAt
      ? path
        ? `set ${path} inside x ${allowedLabelAt.minX}..${allowedLabelAt.maxX} and y ${allowedLabelAt.minY}..${allowedLabelAt.maxY}`
        : `move the source relationship label so its anchor is inside x ${allowedLabelAt.minX}..${allowedLabelAt.maxX} and y ${allowedLabelAt.minY}..${allowedLabelAt.maxY}`
      : path
        ? `move ${path} by dx ${hit.allowedTranslation.minDx}..${hit.allowedTranslation.maxDx} and dy ${hit.allowedTranslation.minDy}..${hit.allowedTranslation.maxDy}`
        : `move the source relationship label by dx ${hit.allowedTranslation.minDx}..${hit.allowedTranslation.maxDx} and dy ${hit.allowedTranslation.minDy}..${hit.allowedTranslation.maxDy}`;
    const oversizedFixes = [];
    if (oversizedWidth) {
      oversizedFixes.push(textPath
        ? `shorten ${textPath} while preserving its meaning until the rendered mask width is at most ${hit.viewBox.width}px`
        : `shorten the source relationship label while preserving its meaning until the rendered mask width is at most ${hit.viewBox.width}px`);
      oversizedFixes.push(`increase /meta/viewBox/0 to at least ${hit.minimumViewBox.width}px so the complete label mask can fit`);
    }
    if (oversizedHeight) {
      oversizedFixes.push(`increase /meta/viewBox/1 to at least ${hit.minimumViewBox.height}px so the complete label mask can fit`);
    }
    const supportedFixes = oversizedFixes.length ? oversizedFixes : [exactFix];
    const remedy = supportedFixes.join('; or ');
    return {
      code: 'composition/relationship-label-containment',
      severity: 'error',
      message: `Relationship label "${label.label || relation.label || `${relation.from || '?'} -> ${relation.to || '?'}`}" extends outside the ${hit.viewBox.width}x${hit.viewBox.height} viewBox — ${remedy}.`,
      subject: Object.fromEntries(Object.entries({
        diagramType,
        ...(oversizedFixes.length && textPath
          ? { path: textPath }
          : path && !oversizedFixes.length
            ? { path }
            : { collectionIndex }),
        id: relation.id,
      }).filter(([, value]) => value !== undefined)),
      evidence: {
        relationship: relationIdentity(relation, collectionIndex),
        labelRect: hit.rect,
        viewBox: hit.viewBox,
        overflow: hit.overflow,
        allowedTranslation: hit.allowedTranslation,
        translationFeasible: hit.translationFeasible,
        ...(oversizedFixes.length ? { minimumViewBox: hit.minimumViewBox } : {}),
        ...(allowedLabelAt ? { allowedLabelAt } : {}),
      },
      supportedFixes,
    };
  });
}

/**
 * Sequence messages intentionally have no free-position label control. Give
 * their real authored seams instead of inventing a labelAt field: widen and
 * spread the participant layout, preserve the semantic wording while
 * shortening only when necessary, or move the message vertically.
 */
export function relationshipTextContainmentIssues({
  labels,
  viewBox,
  diagramType,
  relationCollection,
  textField = 'label',
  verticalField = 'y',
} = {}) {
  return collectViewBoxRectOverflows(labels, viewBox).map((hit) => {
    const label = hit.item;
    const relation = label.relation || {};
    const collectionIndex = collectionIndexForLabel(label, hit.index);
    const textPath = `/${relationCollection}/${collectionIndex}/${textField}`;
    const verticalPath = `/${relationCollection}/${collectionIndex}/${verticalField}`;
    const bounds = hit.viewBox;
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const anchorX = Number.isFinite(label.lx) ? label.lx : hit.rect.x + hit.rect.width / 2;
    const anchorY = Number.isFinite(label.ly) ? label.ly : hit.rect.y + hit.rect.height;
    const horizontal = hit.overflow.left > 0 || hit.overflow.right > 0;
    const vertical = hit.overflow.top > 0 || hit.overflow.bottom > 0;
    const maximumMaskWidth = rounded(Math.max(
      0,
      2 * Math.min(anchorX - bounds.x, right - anchorX),
    ));
    const allowedY = hit.translationFeasible.y
      ? {
        min: rounded(anchorY + hit.allowedTranslation.minDy),
        max: rounded(anchorY + hit.allowedTranslation.maxDy),
      }
      : null;
    const supportedFixes = [];
    if (horizontal) {
      supportedFixes.push(`set /meta/column_fit to "spread" and increase /meta/viewBox/0 until the full ${hit.rect.width}px message-label mask fits`);
      supportedFixes.push(`shorten ${textPath} while preserving its meaning until the rendered mask width is at most ${maximumMaskWidth}px`);
    }
    if (vertical && allowedY) {
      supportedFixes.push(`set ${verticalPath} between ${allowedY.min} and ${allowedY.max}`);
    } else if (vertical) {
      supportedFixes.push(`increase /meta/viewBox/1 to at least ${hit.minimumViewBox.height}px so the complete message-label mask can fit`);
    }
    const remedy = supportedFixes.join('; or ');
    return {
      code: 'composition/relationship-label-containment',
      severity: 'error',
      message: `Relationship label "${label.label || relation.label || `${relation.from || '?'} -> ${relation.to || '?'}`}" extends outside the ${bounds.width}x${bounds.height} viewBox — ${remedy}.`,
      subject: {
        diagramType,
        path: horizontal ? textPath : verticalPath,
        ...(relation.id !== undefined ? { id: relation.id } : {}),
      },
      evidence: {
        relationship: relationIdentity(relation, collectionIndex),
        labelRect: hit.rect,
        viewBox: bounds,
        overflow: hit.overflow,
        allowedTranslation: hit.allowedTranslation,
        translationFeasible: hit.translationFeasible,
        ...(horizontal ? {
          currentMaskWidth: hit.rect.width,
          maximumMaskWidthAtCurrentAnchor: maximumMaskWidth,
          layoutControls: ['/meta/column_fit', '/meta/viewBox/0'],
        } : {}),
        ...(vertical && allowedY ? { allowedY } : {}),
      },
      supportedFixes,
    };
  });
}
