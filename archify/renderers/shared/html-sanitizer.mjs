/**
 * HTML and SVG sanitization utilities to prevent XSS attacks.
 * This module provides safe escaping and sanitization for user-controlled content
 * that will be inserted into HTML/SVG templates.
 */

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * @param {string} text - The text to escape
 * @returns {string} Escaped text safe for HTML content
 */
export function escapeHtml(text) {
  if (text == null) return '';
  
  const htmlEscapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };
  
  return String(text).replace(/[&<>"'\/]/g, (char) => htmlEscapeMap[char]);
}

/**
 * Escapes text for safe use in SVG attributes.
 * @param {string} text - The text to escape
 * @returns {string} Escaped text safe for SVG attributes
 */
export function escapeSvgAttribute(text) {
  if (text == null) return '';
  
  // More permissive for SVG but still safe
  const svgAttrMap = {
    '"': '&quot;',
    "'": '&#39;',
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
  };
  
  return String(text).replace(/["'<>&]/g, (char) => svgAttrMap[char]);
}

/**
 * Validates that a string is a safe hex color code.
 * @param {string} color - The color to validate
 * @returns {boolean} True if valid hex color
 */
export function isValidHexColor(color) {
  if (typeof color !== 'string') return false;
  // Match #RGB, #RRGGBB, or #RRGGBBAA
  return /^#([a-fA-F0-9]{3}){1,2}[a-fA-F0-9]{0,2}$/.test(color);
}

/**
 * Validates that a string is a safe URL (http/https/data only).
 * @param {string} url - The URL to validate
 * @returns {boolean} True if valid and safe URL
 */
export function isValidUrl(url) {
  if (typeof url !== 'string') return false;
  
  try {
    const parsed = new URL(url);
    // Only allow http, https, and data URLs
    return ['http:', 'https:', 'data:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validates that a string is a safe ID (alphanumeric, underscore, hyphen).
 * @param {string} id - The ID to validate
 * @returns {boolean} True if valid ID format
 */
export function isValidId(id) {
  if (typeof id !== 'string') return false;
  // Pattern from schema: ^[a-zA-Z][a-zA-Z0-9_-]*$
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id);
}

/**
 * Removes potentially dangerous attributes from object.
 * @param {object} obj - Object to clean
 * @param {string[]} allowedKeys - Keys to allow
 * @returns {object} Cleaned object
 */
export function filterObjectKeys(obj, allowedKeys) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const allowedSet = new Set(allowedKeys);
  const result = {};
  
  for (const key of Object.keys(obj)) {
    if (allowedSet.has(key)) {
      result[key] = obj[key];
    }
  }
  
  return result;
}

/**
 * Validates and sanitizes a label string for safe rendering.
 * @param {string} label - The label to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 500)
 * @returns {string} Sanitized label
 */
export function sanitizeLabel(label, maxLength = 500) {
  if (label == null) return '';
  
  const text = String(label);
  
  // Truncate if too long
  const truncated = text.length > maxLength ? text.substring(0, maxLength) : text;
  
  // Escape HTML
  return escapeHtml(truncated);
}

/**
 * Validates diagram type to prevent injection.
 * @param {string} type - The diagram type
 * @param {string[]} allowedTypes - Allowed types
 * @returns {boolean} True if type is valid
 */
export function isValidDiagramType(type, allowedTypes = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']) {
  return typeof type === 'string' && allowedTypes.includes(type);
}

/**
 * Safely checks if a value is a valid object (not null, not array).
 * @param {*} value - Value to check
 * @returns {boolean} True if valid object
 */
export function isValidObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export default {
  escapeHtml,
  escapeSvgAttribute,
  isValidHexColor,
  isValidUrl,
  isValidId,
  filterObjectKeys,
  sanitizeLabel,
  isValidDiagramType,
  isValidObject,
};
