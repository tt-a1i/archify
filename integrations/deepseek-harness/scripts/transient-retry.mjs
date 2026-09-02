const TRANSIENT_NETWORK_CODES = ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'];

export function isTransientNetworkFailure(result = {}) {
  const details = [
    result.error?.code,
    result.error?.message,
    result.stderr,
    result.stdout,
  ].filter(Boolean).join('\n').toUpperCase();
  return TRANSIENT_NETWORK_CODES.some((code) => details.includes(code));
}

export function runWithTransientNetworkRetry(runAttempt, { maxAttempts = 2 } = {}) {
  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = runAttempt(attempt);
    if (!result.error && result.status === 0) return { result, attempts: attempt };
    if (attempt === maxAttempts || !isTransientNetworkFailure(result)) {
      return { result, attempts: attempt };
    }
  }
  return { result, attempts: maxAttempts };
}
