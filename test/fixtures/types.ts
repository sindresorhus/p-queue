// Type-checked by `test/types.ts` against the generated declarations. A line here fails the test when it does not compile.
import PQueue, {
	type Options,
	type Queue,
	type QueueAddOptions,
	type RunFunction,
	type TaskOptions,
} from 'p-queue';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const expectType = <T extends true>(): T | undefined => undefined;

const queue = new PQueue();

// `.add()` and `.addAll()` resolve with the awaited result of the task.
const cached = async (): Promise<number> => 1;
const maybeCached = (): number | Promise<number> => cached();
const maybeCachedResult = queue.add(maybeCached);
expectType<Equal<typeof maybeCachedResult, Promise<number>>>();
const maybeCachedResults = queue.addAll([maybeCached, maybeCached]);
expectType<Equal<typeof maybeCachedResults, Promise<[number, number]>>>();
const syncResult = queue.add(() => 'sync');
expectType<Equal<typeof syncResult, Promise<string>>>();
const asyncResult = queue.add(async () => 'async');
expectType<Equal<typeof asyncResult, Promise<string>>>();
const promiseLike: PromiseLike<number> = cached();
const promiseLikeResult = queue.add(() => promiseLike);
expectType<Equal<typeof promiseLikeResult, Promise<number>>>();
const voidResult = queue.add(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function
expectType<Equal<typeof voidResult, Promise<void>>>();

// `undefined` is documented to mean no timeout, which is not the same as no `timeout` key. Other options also accept `undefined`.
queue.add(() => 1, {
	timeout: undefined,
	priority: undefined,
	id: undefined,
	signal: undefined,
});
new PQueue({timeout: undefined}); // eslint-disable-line no-new
queue.timeout = undefined;

// `.addAll()` keeps the result type of each task.
const mixedResults = queue.addAll([async () => 1, () => 'sync', async ({signal}) => signal]);
expectType<Equal<typeof mixedResults, Promise<[number, string, AbortSignal | undefined]>>>();
const tasks: Array<() => Promise<number>> = [cached, cached];
const arrayResults = queue.addAll(tasks);
expectType<Equal<typeof arrayResults, Promise<number[]>>>();
const readonlyTasks: ReadonlyArray<() => Promise<number>> = tasks;
const readonlyArrayResults = queue.addAll(readonlyTasks, {priority: 1});
expectType<Equal<typeof readonlyArrayResults, Promise<number[]>>>();

// A typed custom queue class, like the one in the readme, needs `RunFunction`.
class FifoQueue implements Queue<RunFunction, QueueAddOptions> {
	readonly #items: Array<{run: RunFunction; id: string | undefined}> = [];

	get size() {
		return this.#items.length;
	}

	enqueue(run: RunFunction, options?: Partial<QueueAddOptions>) {
		this.#items.push({run, id: options?.id});
	}

	dequeue() {
		return this.#items.shift()?.run;
	}

	filter() {
		return this.#items.map(({run}) => run);
	}

	setPriority() {}

	remove(id: string) {
		const index = this.#items.findIndex(item => item.id === id);
		if (index !== -1) {
			this.#items.splice(index, 1);
		}
	}
}

const fifoQueue = new PQueue({queueClass: FifoQueue});
const task = async ({signal}: TaskOptions) => signal?.aborted;
const fifoResult = fifoQueue.add(task);
expectType<Equal<typeof fifoResult, Promise<boolean | undefined>>>();

// The `signal` example in the readme.
const controller = new AbortController();
await queue.add(async ({signal}) => {
	signal?.addEventListener('abort', () => {});
}, {signal: controller.signal});

// `Options` works without type arguments, for the default queue.
const options: Options = {concurrency: 2, timeout: 1000};
const queueFromOptions = new PQueue(options);
expectType<Equal<typeof queueFromOptions, PQueue>>();

// `.addAll()` with a tuple is not widened to an array.
const emptyResults = queue.addAll([]);
expectType<Equal<typeof emptyResults, Promise<[]>>>();
const constTasks = [async () => 1, () => 'sync'] as const;
const constResults = queue.addAll(constTasks);
expectType<Equal<typeof constResults, Promise<[number, string]>>>();
const maybeCachedMixedResults = queue.addAll([maybeCached, () => promiseLike, () => {}]); // eslint-disable-line @typescript-eslint/no-empty-function
expectType<Equal<typeof maybeCachedMixedResults, Promise<[number, number, void]>>>();

// The exported types for a custom queue class.
const fifoOptions: Options<FifoQueue, QueueAddOptions> = {queueClass: FifoQueue, concurrency: 1, timeout: undefined};
const fifoQueueFromOptions = new PQueue(fifoOptions);
expectType<Equal<typeof fifoQueueFromOptions, PQueue<FifoQueue, QueueAddOptions>>>();
const fifoAllResults = fifoQueue.addAll([task, async () => 1], {timeout: undefined, priority: undefined});
expectType<Equal<typeof fifoAllResults, Promise<[boolean | undefined, number]>>>();

// `priority` must be a number, which `.add()` also checks at runtime.
// @ts-expect-error Testing
queue.add(() => 1, {priority: '1'});
// `setPriority()` takes a number.
// @ts-expect-error Testing
queue.setPriority('id', '1');

// An explicit type argument is the result type, like in the published types.
const explicitResult = queue.add<string>(async () => 'explicit');
expectType<Equal<typeof explicitResult, Promise<string>>>();
const explicitSyncResult = queue.add<number>(() => 1);
expectType<Equal<typeof explicitSyncResult, Promise<number>>>();
const explicitMaybeCachedResult = queue.add<number>(maybeCached);
expectType<Equal<typeof explicitMaybeCachedResult, Promise<number>>>();
const explicitResults = queue.addAll<string>([async () => 'a', () => 'b']);
expectType<Equal<typeof explicitResults, Promise<string[]>>>();

// A running task always has an `id`, and the `timeout` keys are there even without a timeout.
const [runningTask] = queue.runningTasks;
expectType<Equal<typeof runningTask, {
	readonly id: string;
	readonly priority: number;
	readonly startTime: number;
	readonly timeout: number | undefined;
	readonly timeoutRemaining: number | undefined;
} | undefined>>();
