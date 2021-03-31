import EventEmitter from 'eventemitter3';
import pTimeout, {TimeoutError} from 'p-timeout';
import {Queue, RunFunction} from './queue.js';
import PriorityQueue from './priority-queue.js';
import {QueueAddOptions, DefaultAddOptions, Options} from './options.js';

type ResolveFunction<T = void> = (value?: T | PromiseLike<T>) => void;

type Task<TaskResultType> =
	| (() => PromiseLike<TaskResultType>)
	| (() => TaskResultType);

// eslint-disable-next-line @typescript-eslint/no-empty-function
const empty = (): void => {};

const timeoutError = new TimeoutError();

/**
Promise queue with concurrency control.
*/
export default class PQueue<QueueType extends Queue<RunFunction, EnqueueOptionsType> = PriorityQueue, EnqueueOptionsType extends QueueAddOptions = DefaultAddOptions> extends EventEmitter<'active' | 'idle' | 'add' | 'next' | 'completed' | 'error'> {
	private readonly _carryoverConcurrencyCount: boolean;

	private readonly _isIntervalIgnored: boolean;

	private _intervalCount = 0;

	private readonly _intervalCap: number;

	private readonly _interval: number;

	private _intervalEnd = 0;

	private _intervalId?: NodeJS.Timeout;

	private _timeoutId?: NodeJS.Timeout;

	private _queue: QueueType;

	private readonly _queueClass: new () => QueueType;

	private _pendingCount = 0;

	// The `!` is needed because of https://github.com/microsoft/TypeScript/issues/32194
	private _concurrency!: number;

	private _isPaused: boolean;

	private _resolveEmpty: ResolveFunction = empty;

	private _resolveIdle: ResolveFunction = empty;

	private _timeout?: number;

	private readonly _throwOnTimeout: boolean;

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
			...options
		} as Options<QueueType, EnqueueOptionsType>;

		if (!(typeof options.intervalCap === 'number' && options.intervalCap >= 1)) {
			throw new TypeError(`Expected \`intervalCap\` to be a number from 1 and up, got \`${options.intervalCap?.toString() ?? ''}\` (${typeof options.intervalCap})`);
		}

		if (options.interval === undefined || !(Number.isFinite(options.interval) && options.interval >= 0)) {
			throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${options.interval?.toString() ?? ''}\` (${typeof options.interval})`);
		}

		this._carryoverConcurrencyCount = options.carryoverConcurrencyCount!;
		this._isIntervalIgnored = options.intervalCap === Number.POSITIVE_INFINITY || options.interval === 0;
		this._intervalCap = options.intervalCap;
		this._interval = options.interval;
		this._queue = new options.queueClass!();
		this._queueClass = options.queueClass!;
		this.concurrency = options.concurrency!;
		this._timeout = options.timeout;
		this._throwOnTimeout = options.throwOnTimeout === true;
		this._isPaused = options.autoStart === false;
	}

	private get _doesIntervalAllowAnother(): boolean {
		return this._isIntervalIgnored || this._intervalCount < this._intervalCap;
	}

	private get _doesConcurrentAllowAnother(): boolean {
		return this._pendingCount < this._concurrency;
	}

	private _next(): void {
		this._pendingCount--;
		this._tryToStartAnother();
		this.emit('next');
	}

	private _resolvePromises(): void {
		this._resolveEmpty();
		this._resolveEmpty = empty;

		if (this._pendingCount === 0) {
			this._resolveIdle();
			this._resolveIdle = empty;
			this.emit('idle');
		}
	}

	private _onResumeInterval(): void {
		this._onInterval();
		this._initializeIntervalIfNeeded();
		this._timeoutId = undefined;
	}

	private _isIntervalPaused(): boolean {
		const now = Date.now();

		if (this._intervalId === undefined) {
			const delay = this._intervalEnd - now;
			if (delay < 0) {
				// Act as the interval was done
				// We don't need to resume it here because it will be resumed on line 160
				this._intervalCount = (this._carryoverConcurrencyCount) ? this._pendingCount : 0;
			} else {
				// Act as the interval is pending
				if (this._timeoutId === undefined) {
					this._timeoutId = setTimeout(
						() => {
							this._onResumeInterval();
						},
						delay
					);
				}

				return true;
			}
		}

		return false;
	}

	private _tryToStartAnother(): boolean {
		if (this._queue.size === 0) {
			// We can clear the interval ("pause")
			// Because we can redo it later ("resume")
			if (this._intervalId) {
				clearInterval(this._intervalId);
			}

			this._intervalId = undefined;

			this._resolvePromises();

			return false;
		}

		if (!this._isPaused) {
			const canInitializeInterval = !this._isIntervalPaused();
			if (this._doesIntervalAllowAnother && this._doesConcurrentAllowAnother) {
				const job = this._queue.dequeue();
				if (!job) {
					return false;
				}

				this.emit('active');
				job();

				if (canInitializeInterval) {
					this._initializeIntervalIfNeeded();
				}

				return true;
			}
		}

		return false;
	}

	private _initializeIntervalIfNeeded(): void {
		if (this._isIntervalIgnored || this._intervalId !== undefined) {
			return;
		}

		this._intervalId = setInterval(
			() => {
				this._onInterval();
			},
			this._interval
		);

		this._intervalEnd = Date.now() + this._interval;
	}

	private _onInterval(): void {
		if (this._intervalCount === 0 && this._pendingCount === 0 && this._intervalId) {
			clearInterval(this._intervalId);
			this._intervalId = undefined;
		}

		this._intervalCount = this._carryoverConcurrencyCount ? this._pendingCount : 0;
		this._processQueue();
	}

	/**
	Executes all queued functions until it reaches the limit.
	*/
	private _processQueue(): void {
		// eslint-disable-next-line no-empty
		while (this._tryToStartAnother()) {}
	}

	get concurrency(): number {
		return this._concurrency;
	}

	set concurrency(newConcurrency: number) {
		if (!(typeof newConcurrency === 'number' && newConcurrency >= 1)) {
			throw new TypeError(`Expected \`concurrency\` to be a number from 1 and up, got \`${newConcurrency}\` (${typeof newConcurrency})`);
		}

		this._concurrency = newConcurrency;

		this._processQueue();
	}

	/**
	Adds a sync or async task to the queue. Always returns a promise.
	*/
	async add<TaskResultType>(fn: Task<TaskResultType>, options: Partial<EnqueueOptionsType> = {}): Promise<TaskResultType> {
		return new Promise<TaskResultType>((resolve, reject) => {
			const run = async (): Promise<void> => {
				this._pendingCount++;
				this._intervalCount++;

				try {
					const operation = (this._timeout === undefined && options.timeout === undefined) ? fn() : pTimeout(
						Promise.resolve(fn()),
						(options.timeout === undefined ? this._timeout : options.timeout) as number,
						() => {
							if (options.throwOnTimeout === undefined ? this._throwOnTimeout : options.throwOnTimeout) {
								reject(timeoutError);
							}

							return undefined;
						}
					);

					const result = await operation;
					resolve(result!);
					this.emit('completed', result);
				} catch (error: unknown) {
					reject(error);
					this.emit('error', error);
				}

				this._next();
			};

			this._queue.enqueue(run, options);
			this._tryToStartAnother();
			this.emit('add');
		});
	}

	/**
	Same as `.add()`, but accepts an array of sync or async functions.

	@returns A promise that resolves when all functions are resolved.
	*/
	async addAll<TaskResultsType>(
		functions: ReadonlyArray<Task<TaskResultsType>>,
		options?: EnqueueOptionsType
	): Promise<TaskResultsType[]> {
		return Promise.all(functions.map(async function_ => this.add(function_, options)));
	}

	/**
	Start (or resume) executing enqueued tasks within concurrency limit. No need to call this if queue is not paused (via `options.autoStart = false` or by `.pause()` method.)
	*/
	start(): this {
		if (!this._isPaused) {
			return this;
		}

		this._isPaused = false;

		this._processQueue();
		return this;
	}

	/**
	Put queue execution on hold.
	*/
	pause(): void {
		this._isPaused = true;
	}

	/**
	Clear the queue.
	*/
	clear(): void {
		this._queue = new this._queueClass();
	}

	/**
	Can be called multiple times. Useful if you for example add additional items at a later time.

	@returns A promise that settles when the queue becomes empty.
	*/
	async onEmpty(): Promise<void> {
		// Instantly resolve if the queue is empty
		if (this._queue.size === 0) {
			return;
		}

		return new Promise<void>(resolve => {
			const existingResolve = this._resolveEmpty;
			this._resolveEmpty = () => {
				existingResolve();
				resolve();
			};
		});
	}

	/**
	The difference with `.onEmpty` is that `.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet.

	@returns A promise that settles when the queue becomes empty, and all promises have completed; `queue.size === 0 && queue.pending === 0`.
	*/
	async onIdle(): Promise<void> {
		// Instantly resolve if none pending and if nothing else is queued
		if (this._pendingCount === 0 && this._queue.size === 0) {
			return;
		}

		return new Promise<void>(resolve => {
			const existingResolve = this._resolveIdle;
			this._resolveIdle = () => {
				existingResolve();
				resolve();
			};
		});
	}

	/**
	Size of the queue, the number of queued items waiting to run.
	*/
	get size(): number {
		return this._queue.size;
	}

	/**
	Size of the queue, filtered by the given options.

	For example, this can be used to find the number of items remaining in the queue with a specific priority level.
	*/
	sizeBy(options: Readonly<Partial<EnqueueOptionsType>>): number {
		// eslint-disable-next-line unicorn/no-array-callback-reference
		return this._queue.filter(options).length;
	}

	/**
	Number of running items (no longer in the queue).
	*/
	get pending(): number {
		return this._pendingCount;
	}

	/**
	Whether the queue is currently paused.
	*/
	get isPaused(): boolean {
		return this._isPaused;
	}

	get timeout(): number | undefined {
		return this._timeout;
	}

	/**
	Set the timeout for future operations.
	*/
	set timeout(milliseconds: number | undefined) {
		this._timeout = milliseconds;
	}
}

export {Queue, QueueAddOptions, DefaultAddOptions, Options};
