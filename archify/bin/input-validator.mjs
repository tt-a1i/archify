/**
 * Input validation and sanitization for archify CLI.
 * Prevents path traversal, command injection, and malformed input attacks.
 */

import path from 'node:path';
import { isAbsolute, normalize } from 'node:path';

/**
 * Validates and normalizes a file path to prevent directory traversal attacks.
 * @param {string} filePath - The file path to validate
 * @param {string} basePath - Optional base directory to constrain path
 * @returns {string} Normalized path
 * @throws {Error} If path is invalid or attempts traversal
 */
export function validateFilePath(filePath, basePath = null) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path must be a non-empty string');
  }

  // Normalize the path to resolve .. and .
  const normalized = normalize(filePath);

  // Reject if contains null bytes (potential for exploits)
  if (normalized.includes('\x00')) {
    throw new Error('File path contains null bytes');
  }

  // If basePath provided, ensure normalized path is within it
  if (basePath) {
    const base = normalize(path.resolve(basePath));
    const resolved = path.resolve(normalized);
    
    // Check if resolved path is within base (or is base)
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new Error(`File path must be within base directory: ${basePath}`);
    }
  }

  return normalized;
}

/**
 * Validates a diagram type against allowed types.
 * @param {string} type - The diagram type
 * @returns {string} Validated type
 * @throws {Error} If type is invalid
 */
export function validateDiagramType(type) {
  const ALLOWED_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
  
  if (!type || typeof type !== 'string') {
    throw new Error('Diagram type must be a non-empty string');
  }

  const normalized = type.toLowerCase().trim();
  
  if (!ALLOWED_TYPES.has(normalized)) {
    throw new Error(
      `Invalid diagram type "${type}". Expected one of: ${[...ALLOWED_TYPES].join(', ')}`
    );
  }

  return normalized;
}

/**
 * Validates a quality profile setting.
 * @param {string} quality - The quality profile
 * @returns {string|null} Validated quality or null if not specified
 * @throws {Error} If quality is invalid
 */
export function validateQualityProfile(quality) {
  const ALLOWED_QUALITIES = new Set(['standard', 'showcase']);
  
  if (quality == null) {
    return null;
  }

  if (typeof quality !== 'string') {
    throw new Error('Quality profile must be a string');
  }

  const normalized = quality.toLowerCase().trim();
  
  if (!ALLOWED_QUALITIES.has(normalized)) {
    throw new Error(
      `Invalid quality profile "${quality}". Expected one of: ${[...ALLOWED_QUALITIES].join(', ')}`
    );
  }

  return normalized;
}

/**
 * Validates a language setting.
 * @param {string} lang - The language code
 * @returns {string|null} Validated language or null if not specified
 * @throws {Error} If language is invalid
 */
export function validateLanguage(lang) {
  const ALLOWED_LANGS = new Set(['en', 'zh']);
  
  if (lang == null) {
    return null;
  }

  if (typeof lang !== 'string') {
    throw new Error('Language must be a string');
  }

  const normalized = lang.toLowerCase().trim();
  
  if (!ALLOWED_LANGS.has(normalized)) {
    throw new Error(
      `Invalid language "${lang}". Expected one of: ${[...ALLOWED_LANGS].join(', ')}`
    );
  }

  return normalized;
}

/**
 * Validates a brand URL for safety.
 * @param {string} url - The URL to validate
 * @returns {string} Validated URL
 * @throws {Error} If URL is invalid or unsafe
 */
export function validateBrandUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Brand URL must be a non-empty string');
  }

  try {
    const parsed = new URL(url);
    
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Brand URL must use http or https protocol');
    }

    // Check for localhost/private networks in production
    const hostname = parsed.hostname;
    const isPrivate = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(hostname);
    
    if (isPrivate) {
      throw new Error('Brand URL cannot reference private/local networks');
    }

    return url;
  } catch (error) {
    if (error.message.includes('Invalid URL')) {
      throw new Error('Brand URL is not a valid URL');
    }
    throw error;
  }
}

/**
 * Validates SHA256 hash format.
 * @param {string} hash - The hash to validate
 * @returns {string} Validated hash
 * @throws {Error} If hash is invalid
 */
export function validateSha256Hash(hash) {
  if (!hash || typeof hash !== 'string') {
    throw new Error('SHA256 hash must be a non-empty string');
  }

  if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error('Invalid SHA256 hash format (must be 64 hex characters)');
  }

  return hash;
}

/**
 * Validates a repository root path.
 * @param {string} repoRoot - The repository root path
 * @returns {string} Validated repository root
 * @throws {Error} If path is invalid
 */
export function validateRepoRoot(repoRoot) {
  if (!repoRoot || typeof repoRoot !== 'string') {
    throw new Error('Repository root must be a non-empty string');
  }

  const normalized = validateFilePath(repoRoot);
  
  return normalized;
}

/**
 * Validates command-line arguments to prevent injection.
 * @param {string[]} args - Array of arguments
 * @returns {string[]} Validated arguments
 * @throws {Error} If arguments contain suspicious patterns
 */
export function validateCliArguments(args) {
  if (!Array.isArray(args)) {
    throw new Error('Arguments must be an array');
  }

  const validated = [];
  
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new Error('All arguments must be strings');
    }

    // Check for null bytes
    if (arg.includes('\x00')) {
      throw new Error('Arguments cannot contain null bytes');
    }

    // Check for suspicious patterns (shell metacharacters in suspicious context)
    // Note: We're not overly restrictive as file paths may contain spaces, etc.
    if (/[;|&`$(){}[\]<>\\]/.test(arg) && !arg.match(/^[./~-]/)) {
      // Allow if it looks like a path, but otherwise be cautious
      const pathLike = /^[a-zA-Z0-9._\-/~:]+$/.test(arg);
      if (!pathLike) {
        throw new Error(`Suspicious characters in argument: ${arg}`);
      }
    }

    validated.push(arg);
  }

  return validated;
}

export default {
  validateFilePath,
  validateDiagramType,
  validateQualityProfile,
  validateLanguage,
  validateBrandUrl,
  validateSha256Hash,
  validateRepoRoot,
  validateCliArguments,
};
