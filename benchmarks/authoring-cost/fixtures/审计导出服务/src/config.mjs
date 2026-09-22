export const policy = {
	retentionDays: 180,
	redactFields: ['token', 'ipAddress'],
	maxRowsPerPart: 10000,
	objectStore: 'audit-export-bucket',
	reviewQueue: 'privacy-review',
	notificationTopic: 'audit-export-ready',
};
