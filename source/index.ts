import EventEmitter from 'eventemitter3';
import pTimeout, {TimeoutError} from 'p-timeout';
import {Queue, RunFunction} from './queue.js';
import PriorityQueue from './priority-queue.js';
import {QueueAddOptions, Options, TaskOptions} from './options.js';

type ResolveFunction<T = void> = (value?: T | PromiseLike<T>) => void;

type Task<TaskResultType> =
	| ((options: TaskOptions) => PromiseLike<TaskResultType>)
	| ((options: TaskOptions) => TaskResultType);

// eslint-disable-next-line @typescript-eslint/no-empty-function
const empty = (): void => {};

const timeoutError = new TimeoutError();

/**
Promise queue with concurrency control.
*/
export default class PQueue<QueueType extends Queue<RunFunction, EnqueueOptionsType> = PriorityQueue, EnqueueOptionsType extends QueueAddOptions = QueueAddOptions> extends EventEmitter<'active' | 'idle' | 'add' | 'next' | 'completed' | 'error'> {
	readonly #carryoverConcurrencyCount: boolean;

	readonly #isIntervalIgnored: boolean;

	#intervalCount = 0;

	readonly #intervalCap: number;

	readonly #interval: number;

	#intervalEnd = 0;

	#intervalId?: NodeJS.Timeout;

	#timeoutId?: NodeJS.Timeout;

	#queue: QueueType;

	readonly #queueClass: new () => QueueType;

	#pendingCount = 0;

	// The `!` is needed because of https://github.com/microsoft/TypeScript/issues/32194
	#concurrency!: number;

	#isPaused: boolean;

	#resolveEmpty: ResolveFunction = empty;

	#resolveIdle: ResolveFunction = empty;

	#timeout?: number;

	readonly #throwOnTimeout: boolean;

	constructor(options?: Options<QueueType, EnqueueOptionsType>) {
		super();

		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
		options = {
			carryoverConcurrencyCount: false,
			intervalCap: Number.POSITIVE_INFINITY,
			interval: 0,
			concurrency: Number.POSITIVE_INFINITY,
			autoStart: true,
			queueClass: PriorityQueue,
			...options,
		} as Options<QueueType, EnqueueOptionsType>;

		if (!(typeof options.intervalCap === 'number' && options.intervalCap >= 1)) {
			throw new TypeError(`Expected \`intervalCap\` to be a number from 1 and up, got \`${options.intervalCap?.toString() ?? ''}\` (${typeof options.intervalCap})`);
		}

		if (options.interval === undefined || !(Number.isFinite(options.interval) && options.interval >= 0)) {
			throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${options.interval?.toString() ?? ''}\` (${typeof options.interval})`);
		}

		this.#carryoverConcurrencyCount = options.carryoverConcurrencyCount!;
		this.#isIntervalIgnored = options.intervalCap === Number.POSITIVE_INFINITY || options.interval === 0;
		this.#intervalCap = options.intervalCap;
		this.#interval = options.interval;
		this.#queue = new options.queueClass!();
		this.#queueClass = options.queueClass!;
		this.concurrency = options.concurrency!;
		this.#timeout = options.timeout;
		this.#throwOnTimeout = options.throwOnTimeout === true;
		this.#isPaused = options.autoStart === false;
	}

	get #doesIntervalAllowAnother(): boolean {
		return this.#isIntervalIgnored || this.#intervalCount < this.#intervalCap;
	}

	get #doesConcurrentAllowAnother(): boolean {
		return this.#pendingCount < this.#concurrency;
	}

	#next(): void {
		this.#pendingCount--;
		this.#tryToStartAnother();
		this.emit('next');
	}

	#resolvePromises(): void {
		this.#resolveEmpty();
		this.#resolveEmpty = empty;

		if (this.#pendingCount === 0) {
			this.#resolveIdle();
			this.#resolveIdle = empty;
			this.emit('idle');
		}
	}

	#onResumeInterval(): void {
		this.#onInterval();
		this.#initializeIntervalIfNeeded();
		this.#timeoutId = undefined;
	}

	#isIntervalPaused(): boolean {
		const now = Date.now();

		if (this.#intervalId === undefined) {
			const delay = this.#intervalEnd - now;
			if (delay < 0) {
				// Act as the interval was done
				// We don't need to resume it here because it will be resumed on line 160
				this.#intervalCount = (this.#carryoverConcurrencyCount) ? this.#pendingCount : 0;
			} else {
				// Act as the interval is pending
				if (this.#timeoutId === undefined) {
					this.#timeoutId = setTimeout(
						() => {
							this.#onResumeInterval();
						},
						delay,
					);
				}

				return true;
			}
		}

		return false;
	}

	#tryToStartAnother(): boolean {
		if (this.#queue.size === 0) {
			// We can clear the interval ("pause")
			// Because we can redo it later ("resume")
			if (this.#intervalId) {
				clearInterval(this.#intervalId);
			}

			this.#intervalId = undefined;

			this.#resolvePromises();

			return false;
		}

		if (!this.#isPaused) {
			const canInitializeInterval = !this.#isIntervalPaused();
			if (this.#doesIntervalAllowAnother && this.#doesConcurrentAllowAnother) {
				const job = this.#queue.dequeue();
				if (!job) {
					return false;
				}

				this.emit('active');
				job();

				if (canInitializeInterval) {
					this.#initializeIntervalIfNeeded();
				}

				return true;
			}
		}

		return false;
	}

	#initializeIntervalIfNeeded(): void {
		if (this.#isIntervalIgnored || this.#intervalId !== undefined) {
			return;
		}

		this.#intervalId = setInterval(
			() => {
				this.#onInterval();
			},
			this.#interval,
		);

		this.#intervalEnd = Date.now() + this.#interval;
	}

	#onInterval(): void {
		if (this.#intervalCount === 0 && this.#pendingCount === 0 && this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = undefined;
		}

		this.#intervalCount = this.#carryoverConcurrencyCount ? this.#pendingCount : 0;
		this.#processQueue();
	}

	/**
	Executes all queued functions until it reaches the limit.
	*/
	#processQueue(): void {
		// eslint-disable-next-line no-empty
		while (this.#tryToStartAnother()) {}
	}

	get concurrency(): number {
		return this.#concurrency;
	}

	set concurrency(newConcurrency: number) {
		if (!(typeof newConcurrency === 'number' && newConcurrency >= 1)) {
			throw new TypeError(`Expected \`concurrency\` to be a number from 1 and up, got \`${newConcurrency}\` (${typeof newConcurrency})`);
		}

		this.#concurrency = newConcurrency;

		this.#processQueue();
	}

	/**
	Adds a sync or async task to the queue. Always returns a promise.
	*/
	async add<TaskResultType>(fn: Task<TaskResultType>, options: Partial<EnqueueOptionsType> = {}): Promise<TaskResultType> {
		return new Promise<TaskResultType>((resolve, reject) => {
			const run = async (): Promise<void> => {
				this.#pendingCount++;
				this.#intervalCount++;

				try {
					if (!options.signal?.aborted) {
						const operation = (this.#timeout === undefined && options.timeout === undefined) ? fn({signal: options.signal}) : pTimeout(
							Promise.resolve(fn({signal: options.signal})),
							(options.timeout === undefined ? this.#timeout : options.timeout)!,
							() => {
								if (options.throwOnTimeout === undefined ? this.#throwOnTimeout : options.throwOnTimeout) {
									reject(timeoutError);
								}

								return undefined;
							},
						);

						const result = await operation;
						resolve(result!);
						this.emit('completed', result);
					}
				} catch (error: unknown) {
					reject(error);
					this.emit('error', error);
				}

				this.#next();
			};

			this.#queue.enqueue(run, options);
			this.#tryToStartAnother();
			this.emit('add');
		});
	}

	/**
	Same as `.add()`, but accepts an array of sync or async functions.

	@returns A promise that resolves when all functions are resolved.
	*/
	async addAll<TaskResultsType>(
		functions: ReadonlyArray<Task<TaskResultsType>>,
		options?: EnqueueOptionsType,
	): Promise<TaskResultsType[]> {
		return Promise.all(functions.map(async function_ => this.add(function_, options)));
	}

	/**
	Start (or resume) executing enqueued tasks within concurrency limit. No need to call this if queue is not paused (via `options.autoStart = false` or by `.pause()` method.)
	*/
	start(): this {
		if (!this.#isPaused) {
			return this;
		}

		this.#isPaused = false;

		this.#processQueue();
		return this;
	}

	/**
	Put queue execution on hold.
	*/
	pause(): void {
		this.#isPaused = true;
	}

	/**
	Clear the queue.
	*/
	clear(): void {
		this.#queue = new this.#queueClass();
	}

	/**
	Can be called multiple times. Useful if you for example add additional items at a later time.

	@returns A promise that settles when the queue becomes empty.
	*/
	async onEmpty(): Promise<void> {
		// Instantly resolve if the queue is empty
		if (this.#queue.size === 0) {
			return;
		}

		return new Promise<void>(resolve => {
			const existingResolve = this.#resolveEmpty;
			this.#resolveEmpty = () => {
				existingResolve();
				resolve();
			};
		});
	}

	/**
	@returns A promise that settles when the queue size is less than the given limit: `queue.size < limit`.

	If you want to avoid having the queue grow beyond a certain size you can `await queue.onSizeLessThan()` before adding a new item.

	Note that this only limits the number of items waiting to start. There could still be up to `concurrency` jobs already running that this call does not include in its calculation.
	*/
	async onSizeLessThan(limit: number): Promise<void> {
		// Instantly resolve if the queue is empty.
		if (this.#queue.size < limit) {
			return;
		}

		return new Promise<void>(resolve => {
			const listener = () => {
				if (this.#queue.size < limit) {
					this.removeListener('next', listener);
					resolve();
				}
			};

			this.on('next', listener);
		});
	}

	/**
	The difference with `.onEmpty` is that `.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet.

	@returns A promise that settles when the queue becomes empty, and all promises have completed; `queue.size === 0 && queue.pending === 0`.
	*/
	async onIdle(): Promise<void> {
		// Instantly resolve if none pending and if nothing else is queued
		if (this.#pendingCount === 0 && this.#queue.size === 0) {
			return;
		}

		return new Promise<void>(resolve => {
			const existingResolve = this.#resolveIdle;
			this.#resolveIdle = () => {
				existingResolve();
				resolve();
			};
		});
	}

	/**
	Size of the queue, the number of queued items waiting to run.
	*/
	get size(): number {
		return this.#queue.size;
	}

	/**
	Size of the queue, filtered by the given options.

	For example, this can be used to find the number of items remaining in the queue with a specific priority level.
	*/
	sizeBy(options: Readonly<Partial<EnqueueOptionsType>>): number {
		// eslint-disable-next-line unicorn/no-array-callback-reference
		return this.#queue.filter(options).length;
	}

	/**
	Number of running items (no longer in the queue).
	*/
	get pending(): number {
		return this.#pendingCount;
	}

	/**
	Whether the queue is currently paused.
	*/
	get isPaused(): boolean {
		return this.#isPaused;
	}

	get timeout(): number | undefined {
		return this.#timeout;
	}

	/**
	Set the timeout for future operations.
	*/
	set timeout(milliseconds: number | undefined) {
		this.#timeout = milliseconds;
	}
}

// TODO: Rename `DefaultAddOptions` to `QueueAddOptions` in next major version
export {Queue, QueueAddOptions, QueueAddOptions as DefaultAddOptions, Options};
