import process from 'node:process';
import Benchmark, {type Deferred, type Event} from 'benchmark';
import PQueue from './source/index.js';
import PriorityQueue from './source/priority-queue.js';

const suite = new Benchmark.Suite() as Benchmark.Suite;
const smallTaskCount = 100;
const largeBacklogTaskCount = 10_000;
const selectedBenchmarks = process.argv.slice(2);

// Benchmark typings aren't up to date, let's help out manually
type Resolvable = Deferred & {resolve: () => void};

const noop = () => undefined;

const shouldRunBenchmark = (name: string) => selectedBenchmarks.length === 0
	|| selectedBenchmarks.some(selectedBenchmark => name.includes(selectedBenchmark));

const addBenchmark = (name: string, fn: () => Promise<void>) => {
	if (!shouldRunBenchmark(name)) {
		return;
	}

	(suite as any).add(name, {
		defer: true,

		async fn(deferred: Resolvable) {
			await fn();
			deferred.resolve();
		},
	});
};

addBenchmark('baseline', async () => {
	const queue = new PQueue();

	for (let i = 0; i < smallTaskCount; i++) {
		queue.add(noop);
	}

	await queue.onEmpty();
});

addBenchmark('operation with random priority', async () => {
	const queue = new PQueue();

	for (let i = 0; i < smallTaskCount; i++) {
		queue.add(noop, {
			priority: Math.trunc(Math.random() * smallTaskCount),
		});
	}

	await queue.onEmpty();
});

addBenchmark('operation with increasing priority', async () => {
	const queue = new PQueue();

	for (let i = 0; i < smallTaskCount; i++) {
		queue.add(noop, {
			priority: i,
		});
	}

	await queue.onEmpty();
});

addBenchmark('large-fifo-backlog', async () => {
	const queue = new PQueue({autoStart: false});

	for (let i = 0; i < largeBacklogTaskCount; i++) {
		queue.add(noop);
	}

	queue.start();
	await queue.onIdle();
});

addBenchmark('add-no-options-paused', async () => {
	const queue = new PQueue({autoStart: false});

	for (let i = 0; i < largeBacklogTaskCount; i++) {
		queue.add(noop);
	}

	if (queue.size !== largeBacklogTaskCount) {
		throw new Error('Queued task count mismatch');
	}
});

addBenchmark('priority-queue-dequeue', async () => {
	const queue = new PriorityQueue();

	for (let i = 0; i < largeBacklogTaskCount; i++) {
		queue.enqueue(noop);
	}

	let dequeued = 0;
	while (queue.dequeue() !== undefined) {
		dequeued++;
	}

	if (dequeued !== largeBacklogTaskCount) {
		throw new Error('Dequeued task count mismatch');
	}
});

suite
	.on('cycle', (event: Event) => {
		console.log(String(event.target as any));
	})
	.on('complete', function (this: any) {
		// @ts-expect-error benchmark typings incorrect
		console.log(`Fastest is ${this.filter('fastest').map('name') as string}`);
	})
	.run({
		async: true,
	});
