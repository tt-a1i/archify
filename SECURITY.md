# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in Archify, please email the maintainers privately instead of using the public issue tracker. This allows time for a fix to be developed and released before public disclosure.

**Contact**: Please open a private security advisory on GitHub or contact the repository maintainers directly.

## Security Best Practices

### Input Validation
- All user-provided JSON inputs are validated against JSON schemas before processing
- File paths are validated to prevent directory traversal attacks
- Diagram types and parameters are restricted to allowed values

### Output Encoding
- All user-controlled content inserted into HTML/SVG is properly escaped
- Use the provided sanitization utilities from `renderers/shared/html-sanitizer.mjs`
- Labels, titles, and other user-provided strings are escaped before rendering

### Dependency Management
- Dependencies are regularly audited with `npm audit`
- Critical vulnerabilities are addressed immediately
- Versions are pinned for stability and security

### Code Review
- Security-sensitive changes require review before merge
- Input validation and output encoding are verified in all data flow paths

## Known Security Measures

### CVE-2025-69873 (ReDoS in ajv)
- **Fixed in**: ajv 8.18.0+
- **Status**: Upgraded and tested
- **Details**: Regular Expression Denial of Service vulnerability when using `$data` option

### XSS Prevention
- HTML special characters are escaped using `escapeHtml()` utility
- SVG attributes are escaped using `escapeSvgAttribute()` utility
- Labels and user content are sanitized before rendering

### Path Traversal Prevention
- All file paths are validated with `validateFilePath()`
- Paths are normalized to prevent `..` and symbolic link attacks
- Directory traversal attempts are rejected

## Dependency Security

### Current Dependencies
- `ajv@^8.18.0` - JSON Schema Validator (ReDoS fix included)
- `parse5@7.3.0` - HTML Parser
- `saxes@6.0.0` - XML Parser
- `simple-icons@16.28.0` - SVG Brand Icons

### Audit Requirements
Run security audits regularly:
```bash
npm audit --audit-level=moderate
npm audit fix
```

## Testing Security

### Running Tests
```bash
npm test
```

### Running Linters
```bash
npm run check:brand-marks
npm run check:validators
```

## Security Updates Timeline

| CVE/Issue | Discovered | Fixed | Version |
|-----------|-----------|-------|---------|
| CVE-2025-69873 (ajv ReDoS) | 2025-01 | 2025-08 | 8.18.0+ |

## Guidelines for Contributors

When contributing to Archify, please follow these security guidelines:

1. **Validate all inputs** - Use the validation utilities provided in `bin/input-validator.mjs`
2. **Escape all outputs** - Use sanitization utilities from `renderers/shared/html-sanitizer.mjs`
3. **Avoid dynamic code execution** - Never use `eval()`, `Function()`, or similar
4. **Check dependencies** - Run `npm audit` before submitting PRs
5. **Test edge cases** - Include tests for malformed and adversarial inputs

## Security-Sensitive Files

These files contain security-critical logic and should be reviewed carefully:
- `archify/bin/input-validator.mjs` - Input validation
- `archify/renderers/shared/html-sanitizer.mjs` - Output encoding
- `archify/renderers/shared/validator.mjs` - Schema validation
- `archify/bin/archify.mjs` - CLI entry point and argument handling

## Future Improvements

- [ ] Implement Content Security Policy (CSP) headers
- [ ] Add rate limiting to brand URL fetching
- [ ] Implement request timeout limits
- [ ] Add audit logging for security events
- [ ] Implement signature verification for diagrams
