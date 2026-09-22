import {policy} from './config.mjs';
import {createExport} from './runtime/exporter.mjs';

const exporter = createExport(policy);

export function requestAuditExport(request) {
	if (!request.tenantId || !request.range) return {status: 400};
	return exporter.schedule({tenantId: request.tenantId, range: request.range});
}
