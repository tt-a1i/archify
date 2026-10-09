import release from '../../../archify/skill-release.json';

// The release identity belongs to this checkout; no stable capability is inferred
// from a development recipe or from the host where the site is deployed.
export const productVersion = release.version;
export const productChannel = release.channel === 'development' ? 'development' : 'stable';
export const sourceRef = productChannel === 'development' ? 'dev' : 'main';
export const recipeSourceUrl = `https://github.com/tt-a1i/archify/blob/${sourceRef}/archify/recipes/scenarios.mjs`;
