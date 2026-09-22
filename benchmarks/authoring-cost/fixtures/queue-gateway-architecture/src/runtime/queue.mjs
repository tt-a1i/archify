import {runWorker} from './worker.mjs';

export function createQueue(settings) {
	const waiting = [];
	let active = 0;

	function pump() {
		while (active < settings.concurrency && waiting.length > 0) {
			active += 1;
			const job = waiting.shift();
			runWorker(job, settings).finally(() => {
				active -= 1;
				pump();
			});
		}
	}

	return {
		enqueue(job) {
		const accepted = {...job, id: `job-${waiting.length + active + 1}`};
		waiting.push(accepted);
		pump();
		return accepted;
		},
	};
}
