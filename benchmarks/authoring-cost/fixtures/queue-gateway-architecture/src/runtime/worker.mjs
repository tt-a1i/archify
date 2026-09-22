export async function runWorker(job, settings) {
	for (let attempt = 1; attempt <= settings.maxAttempts; attempt += 1) {
		try {
			const token = await authorizeTenant(job.tenant, settings.authProvider);
			const result = await callProvider(job.payload, token, settings.provider);
			return await saveResult(job.id, result, settings.resultStore);
		} catch (error) {
			if (attempt === settings.maxAttempts) {
				return moveToDeadLetter(job, error, settings.deadLetterAfter);
			}
		}
	}
}

async function authorizeTenant(tenant, provider) { return `${provider}:${tenant}`; }
async function callProvider(payload, token, provider) { return {provider, token, payload}; }
async function saveResult(id, result, store) { return {id, store, result}; }
function moveToDeadLetter(job, error, after) { return {queue: 'dead-letter', after, job, error}; }
