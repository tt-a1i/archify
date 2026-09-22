import {settings} from './config.mjs';
import {createQueue} from './runtime/queue.mjs';

const queue = createQueue(settings);

export function submitJob(request) {
	if (!request.tenant || !request.payload) {
		return {status: 400, body: 'tenant and payload are required'};
	}

	const job = queue.enqueue({tenant: request.tenant, payload: request.payload});
	return {status: 202, jobId: job.id, state: 'queued'};
}
