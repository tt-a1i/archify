export async function notifyReady(job, files, topic) {
	return {topic, tenantId: job.tenantId, files, event: 'audit-export-ready'};
}

export function requestReview(job, reason, queue) {
	return {queue, tenantId: job.tenantId, reason, state: 'manual-review'};
}
