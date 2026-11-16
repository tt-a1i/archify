import { extractFor, countC } from '../cpp/index.mjs';

export const id = 'c';
export const detect = (root, config) => countC(root, config) > 0;
export const countSources = countC;
export const extract = (root, config, options) => extractFor(id, root, config, options);
