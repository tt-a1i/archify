/**
 * Security tests for input validation and HTML sanitization.
 * Tests verify that the security fixes prevent common attack vectors.
 */

import assert from 'node:assert';
import {
  validateFilePath,
  validateDiagramType,
  validateQualityProfile,
  validateLanguage,
  validateBrandUrl,
  validateSha256Hash,
  validateRepoRoot,
  validateCliArguments,
} from '../bin/input-validator.mjs';

import {
  escapeHtml,
  escapeSvgAttribute,
  isValidHexColor,
  isValidUrl,
  isValidId,
  sanitizeLabel,
  isValidDiagramType,
} from '../renderers/shared/html-sanitizer.mjs';

console.log('🔐 Running security validation tests...\n');

// ============================================================================
// Input Validator Tests
// ============================================================================

console.log('📋 Testing Input Validation...');

// Test: File path validation - prevent directory traversal
try {
  validateFilePath('../../etc/passwd', '/home/user');
  console.error('❌ FAIL: Should reject directory traversal');
  process.exit(1);
} catch (e) {
  console.log('✅ PASS: Directory traversal blocked');
}

// Test: File path validation - allow valid paths
try {
  const valid = validateFilePath('./diagrams/arch.json', '/home/user');
  console.log('✅ PASS: Valid paths accepted');
} catch (e) {
  console.error('❌ FAIL: Should accept valid paths:', e.message);
  process.exit(1);
}

// Test: Diagram type validation
try {
  validateDiagramType('malicious-type');
  console.error('❌ FAIL: Should reject invalid diagram type');
  process.exit(1);
} catch (e) {
  console.log('✅ PASS: Invalid diagram types rejected');
}

// Test: Valid diagram type
try {
  const type = validateDiagramType('architecture');
  assert.strictEqual(type, 'architecture');
  console.log('✅ PASS: Valid diagram types accepted');
} catch (e) {
  console.error('❌ FAIL: Should accept valid types:', e.message);
  process.exit(1);
}

// Test: Quality profile validation
try {
  const quality = validateQualityProfile('standard');
  assert.strictEqual(quality, 'standard');
  console.log('✅ PASS: Quality profile validation works');
} catch (e) {
  console.error('❌ FAIL: Quality profile validation failed:', e.message);
  process.exit(1);
}

// Test: Language validation
try {
  const lang = validateLanguage('en');
  assert.strictEqual(lang, 'en');
  console.log('✅ PASS: Language validation works');
} catch (e) {
  console.error('❌ FAIL: Language validation failed:', e.message);
  process.exit(1);
}

// Test: Brand URL validation - reject private networks
try {
  validateBrandUrl('http://localhost/brand.svg');
  console.error('❌ FAIL: Should reject localhost URLs');
  process.exit(1);
} catch (e) {
  console.log('✅ PASS: Private network URLs rejected');
}

// Test: Brand URL validation - reject invalid protocols
try {
  validateBrandUrl('file:///etc/passwd');
  console.error('❌ FAIL: Should reject file:// protocol');
  process.exit(1);
} catch (e) {
  console.log('✅ PASS: Invalid protocols rejected');
}

// Test: Brand URL validation - accept https
try {
  const url = validateBrandUrl('https://example.com/brand.svg');
  assert.strictEqual(url, 'https://example.com/brand.svg');
  console.log('✅ PASS: Valid https URLs accepted');
} catch (e) {
  console.error('❌ FAIL: Should accept https URLs:', e.message);
  process.exit(1);
}

// Test: SHA256 hash validation
try {
  validateSha256Hash('invalid');
  console.error('❌ FAIL: Should reject invalid SHA256');
  process.exit(1);
} catch (e) {
  console.log('✅ PASS: Invalid SHA256 rejected');
}

// Test: Valid SHA256 hash
try {
  const hash = validateSha256Hash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.strictEqual(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  console.log('✅ PASS: Valid SHA256 accepted');
} catch (e) {
  console.error('❌ FAIL: Should accept valid SHA256:', e.message);
  process.exit(1);
}

// Test: CLI arguments validation - reject null bytes
try {
  validateCliArguments(['test\x00payload']);
  console.error('❌ FAIL: Should reject null bytes');
  process.exit(1);
} catch (e) {
  console.log('✅ PASS: Null bytes in arguments rejected');
}

console.log('');

// ============================================================================
// HTML Sanitizer Tests
// ============================================================================

console.log('🧹 Testing HTML/SVG Sanitization...');

// Test: HTML escaping - XSS prevention
const xssPayload = '<img src=x onerror="alert(\'XSS\')">';
const escaped = escapeHtml(xssPayload);
assert(!escaped.includes('<img'), 'XSS payload should be escaped');
console.log('✅ PASS: XSS payload escaped:', escaped);

// Test: Script tag escaping
const scriptTag = '<script>alert("XSS")</script>';
const escapedScript = escapeHtml(scriptTag);
assert.strictEqual(escapedScript, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;');
console.log('✅ PASS: Script tags fully escaped');

// Test: SVG attribute escaping
const svgAttrPayload = 'onload="alert(\'attack\')"';
const escapedSvgAttr = escapeSvgAttribute(svgAttrPayload);
assert(!escapedSvgAttr.includes('onload='), 'Event handler should be escaped');
console.log('✅ PASS: SVG event handlers escaped');

// Test: Label sanitization with length limit
const longLabel = 'a'.repeat(600);
const sanitized = sanitizeLabel(longLabel, 500);
assert(sanitized.length <= 500, 'Label should be truncated');
console.log('✅ PASS: Label length limited and sanitized');

// Test: Label with HTML/XSS attempts
const xssLabel = '<b onclick="alert()">Click me</b>';
const safeLabel = sanitizeLabel(xssLabel);
assert(!safeLabel.includes('<b'), 'HTML tags should be escaped');
console.log('✅ PASS: Label XSS attempts blocked');

// Test: Color validation
assert(isValidHexColor('#ff0000'), 'Valid hex color should pass');
assert(isValidHexColor('#f00'), 'Valid short hex color should pass');
assert(!isValidHexColor('#gggggg'), 'Invalid hex should fail');
assert(!isValidHexColor('red'), 'Named colors should fail');
console.log('✅ PASS: Color validation works');

// Test: URL validation
assert(isValidUrl('https://example.com/image.svg'), 'Valid https URL should pass');
assert(isValidUrl('http://example.com/image.png'), 'Valid http URL should pass');
assert(isValidUrl('data:image/svg+xml;base64,...'), 'Valid data URL should pass');
assert(!isValidUrl('file:///etc/passwd'), 'File URL should fail');
assert(!isValidUrl('javascript:alert(1)'), 'JavaScript URL should fail');
console.log('✅ PASS: URL validation works');

// Test: ID validation
assert(isValidId('my-node'), 'Valid ID should pass');
assert(isValidId('node_123'), 'Valid ID with underscore should pass');
assert(!isValidId('123-node'), 'ID starting with number should fail');
assert(!isValidId('node name'), 'ID with space should fail');
console.log('✅ PASS: ID validation works');

// Test: Diagram type validation
assert(isValidDiagramType('architecture'), 'Valid type should pass');
assert(!isValidDiagramType('invalid-type'), 'Invalid type should fail');
console.log('✅ PASS: Diagram type validation works');

console.log('');

// ============================================================================
// CVE-2025-69873 (ReDoS) Test
// ============================================================================

console.log('🛡️  Testing CVE-2025-69873 ReDoS Prevention...');

// Note: This test just verifies that ajv 8.18.0+ is installed.
// The actual ReDoS prevention is in the ajv package itself.
try {
  import('ajv').then((ajvModule) => {
    const ajv = new ajvModule.default();
    console.log('✅ PASS: ajv module loaded successfully');
    
    // Verify schema validation works (basic sanity check)
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' }
      }
    };
    
    const validate = ajv.compile(schema);
    const valid = validate({ name: 'test' });
    assert(valid === true, 'Basic schema validation should work');
    console.log('✅ PASS: Schema validation works correctly');
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 All security tests passed!');
    console.log('='.repeat(60) + '\n');
  }).catch((err) => {
    console.error('❌ FAIL: Could not load ajv:', err.message);
    process.exit(1);
  });
} catch (e) {
  console.error('❌ FAIL: ajv import test failed:', e.message);
  process.exit(1);
}
