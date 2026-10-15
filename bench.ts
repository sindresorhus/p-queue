// Run some of the benchmarks: node --import=tsx/esm --experimental-bench --bench-name-pattern=priority --bench bench.ts
import {bench} from 'node:bench';
import PQueue from './source/index.js';
import PriorityQueue from './source/priority-queue.js';

const smallTaskCount = 100;
const largeBacklogTaskCount = 10_000;
const options = {warmup: 10, samples: 100};

const noop = () => undefined;

// `@types/node` does not have types for `node:bench` yet.
type BenchContext = {
	start: () => void;
	end: (operations: number) => void;
};

bench('baseline', options, async (context: BenchContext) => {
	const queue = new PQueue();

	context.start();
	for (let i = 0; i < smallTaskCount; i++) {
		queue.add(noop);
	}

	await queue.onEmpty();
	context.end(smallTaskCount);
});

bench('operation with random priority', options, async (context: BenchContext) => {
	const queue = new PQueue();

	context.start();
	for (let i = 0; i < smallTaskCount; i++) {
		queue.add(noop, {
			priority: Math.trunc(Math.random() * smallTaskCount),
		});
	}

	await queue.onEmpty();
	context.end(smallTaskCount);
});

bench('operation with increasing priority', options, async (context: BenchContext) => {
	const queue = new PQueue();

	context.start();
	for (let i = 0; i < smallTaskCount; i++) {
		queue.add(noop, {
			priority: i,
		});
	}

	await queue.onEmpty();
	context.end(smallTaskCount);
});

bench('large-fifo-backlog', options, async (context: BenchContext) => {
	const queue = new PQueue({autoStart: false});

	context.start();
	for (let i = 0; i < largeBacklogTaskCount; i++) {
		queue.add(noop);
	}

	queue.start();
	await queue.onIdle();
	context.end(largeBacklogTaskCount);
});

bench('priority-queue-dequeue', options, (context: BenchContext) => {
	const queue = new PriorityQueue();

	context.start();
	for (let i = 0; i < largeBacklogTaskCount; i++) {
		queue.enqueue(noop);
	}

	let dequeued = 0;
	while (queue.dequeue() !== undefined) {
		dequeued++;
	}

	context.end(largeBacklogTaskCount);

	if (dequeued !== largeBacklogTaskCount) {
		throw new Error('Dequeued task count mismatch');
	}
});
