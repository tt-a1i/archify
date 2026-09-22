import {notifyReady} from './notifier.mjs';

export function createExport(policy) {
	return {
		schedule(job) {
			const parts = splitRange(job.range, policy.maxRowsPerPart);
			return {status: 'queued', job, parts, run: () => exportParts(job, parts, policy)};
		},
	};
}

async function exportParts(job, parts, policy) {
	const files = [];
	for (const part of parts) {
		const rows = await queryAuditLog(job.tenantId, part);
		const redacted = rows.map(row => redact(row, policy.redactFields));
		files.push(await writeObject(policy.objectStore, job.tenantId, redacted));
	}
	await notifyReady(job, files, policy.notificationTopic);
	return {files, expiresAfterDays: policy.retentionDays};
}

function splitRange(range, max) { return [{range, max}]; }
async function queryAuditLog(tenantId, part) { return [{tenantId, part, token: 'removed'}]; }
function redact(row, fields) { return Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key))); }
async function writeObject(bucket, tenantId, rows) { return `${bucket}/${tenantId}/${rows.length}.json`; }
