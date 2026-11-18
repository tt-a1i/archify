// Captured file identities use repository-relative paths with slash separators.
// This checks the recorded name independent of the host filesystem.
export function isRepositoryRelativePath(value) {
  return typeof value === 'string' && value.length > 0 &&
    !/[\\:\u0000-\u001f\u007f]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}
