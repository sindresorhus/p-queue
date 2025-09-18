import Benchmark, {type Deferred, type Event} from 'benchmark';
import PQueue from './source/index.js';

const suite = new Benchmark.Suite() as Benchmark.Suite;

// Benchmark typings aren't up to date, let's help out manually
type Resolvable = Deferred & {resolve: () => void};

(suite as any)
	.add('baseline', {
		defer: true,

		async fn(deferred: Resolvable) {
			const queue = new PQueue();

			for (let i = 0; i < 100; i++) {
				// eslint-disable-next-line @typescript-eslint/no-empty-function
				queue.add(async () => {});
			}

			await queue.onEmpty();
			deferred.resolve();
		},
	})
	.add('operation with random priority', {
		defer: true,

		async fn(deferred: Resolvable) {
			const queue = new PQueue();

			for (let i = 0; i < 100; i++) {
				// eslint-disable-next-line @typescript-eslint/no-empty-function
				queue.add(async () => {}, {
					priority: Math.trunc(Math.random() * 100),
				});
			}

			await queue.onEmpty();
			deferred.resolve();
		},
	})
	.add('operation with increasing priority', {
		defer: true,

		async fn(deferred: Resolvable) {
			const queue = new PQueue();

			for (let i = 0; i < 100; i++) {
				// eslint-disable-next-line @typescript-eslint/no-empty-function
				queue.add(async () => {}, {
					priority: i,
				});
			}

			await queue.onEmpty();
			deferred.resolve();
		},
	})
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
