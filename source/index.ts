import pTimeout from 'p-timeout';
import {Queue} from './queue';
import PriorityQueue from './priority-queue';
import {QueueAddOptions, DefaultAddOptions, Options} from './options';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import EventEmitter = require('eventemitter3');

type ResolveFunction<T = void> = (value?: T | PromiseLike<T>) => void;

type Task<TaskResultType> =
		| (() => PromiseLike<TaskResultType>)
		| (() => TaskResultType);

const empty = (): void => {};

const timeoutError = new pTimeout.TimeoutError();

/**
Promise queue with concurrency control.
*/
export default class PQueue<QueueType extends Queue<EnqueueOptionsType> = PriorityQueue, EnqueueOptionsType extends QueueAddOptions = DefaultAddOptions> extends EventEmitter<'active'> {
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

	private readonly _concurrency: number;

	private _paused: boolean;

	private _resolveEmpty: ResolveFunction = empty;

	private _resolveIdle: ResolveFunction = empty;

	private _timeout?: number;

	private readonly _throwOnTimeout: boolean;

	constructor(options?: Options<QueueType, EnqueueOptionsType>) {
		super();

		// eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
		options = {
			carryoverConcurrencyCount: false,
			intervalCap: Infinity,
			interval: 0,
			concurrency: Infinity,
			autoStart: true,
			queueClass: PriorityQueue,
			...options
		} as Options<QueueType, EnqueueOptionsType>;

		if (!(typeof options.concurrency === 'number' && options.concurrency >= 1)) {
			throw new TypeError(`Expected \`concurrency\` to be a number from 1 and up, got \`${options.concurrency}\` (${typeof options.concurrency})`);
		}

		if (!(typeof options.intervalCap === 'number' && options.intervalCap >= 1)) {
			throw new TypeError(`Expected \`intervalCap\` to be a number from 1 and up, got \`${options.intervalCap}\` (${typeof options.intervalCap})`);
		}

		if (options.interval === undefined || !(Number.isFinite(options.interval) && options.interval >= 0)) {
			throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${options.interval}\` (${typeof options.interval})`);
		}

		this._carryoverConcurrencyCount = options.carryoverConcurrencyCount!;
		this._isIntervalIgnored = options.intervalCap === Infinity || options.interval === 0;
		this._intervalCap = options.intervalCap;
		this._interval = options.interval;

		this._queue = new options.queueClass!();
		this._queueClass = options.queueClass!;
		this._concurrency = options.concurrency;
		this._timeout = options.timeout;
		this._throwOnTimeout = options.throwOnTimeout === true;
		this._paused = options.autoStart === false;
	}

	get doesIntervalAllowAnother(): boolean {
		return this._isIntervalIgnored || this._intervalCount < this._intervalCap;
	}

	get doesConcurrentAllowAnother(): boolean {
		return this._pendingCount < this._concurrency;
	}

	next(): void {
		this._pendingCount--;
		this.tryToStartAnother();
	}

	resolvePromises(): void {
		this._resolveEmpty();
		this._resolveEmpty = empty;

		if (this._pendingCount === 0) {
			this._resolveIdle();
			this._resolveIdle = empty;
		}
	}

	onResumeInterval(): void {
		this.onInterval();
		this.initializeIntervalIfNeeded();
		this._timeoutId = undefined;
	}

	intervalPaused(): boolean {
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
							this.onResumeInterval();
						},
						delay
					);
				}

				return true;
			}
		}

		return false;
	}

	tryToStartAnother(): boolean {
		if (this._queue.size === 0) {
			// We can clear the interval ("pause")
			// Because we can redo it later ("resume")
			if (this._intervalId) {
				clearInterval(this._intervalId);
			}

			this._intervalId = undefined;

			this.resolvePromises();

			return false;
		}

		if (!this._paused) {
			const canInitializeInterval = !this.intervalPaused();
			if (this.doesIntervalAllowAnother && this.doesConcurrentAllowAnother) {
				this.emit('active');

				this._queue.dequeue()!();
				if (canInitializeInterval) {
					this.initializeIntervalIfNeeded();
				}

				return true;
			}
		}

		return false;
	}

	initializeIntervalIfNeeded(): void {
		if (this._isIntervalIgnored || this._intervalId !== undefined) {
			return;
		}

		this._intervalId = setInterval(
			() => {
				this.onInterval();
			},
			this._interval
		);

		this._intervalEnd = Date.now() + this._interval;
	}

	onInterval(): void {
		if (this._intervalCount === 0 && this._pendingCount === 0 && this._intervalId) {
			clearInterval(this._intervalId);
			this._intervalId = undefined;
		}

		this._intervalCount = this._carryoverConcurrencyCount ? this._pendingCount : 0;
		// eslint-disable-next-line no-empty
		while (this.tryToStartAnother()) {}
	}

	/**
	Adds a sync or async task to the queue. Always returns a promise.
	*/
	async add<TaskResultType>(fn: Task<TaskResultType>, options?: EnqueueOptionsType): Promise<TaskResultType> {
		return new Promise<TaskResultType>((resolve, reject) => {
			const run = async (): Promise<void> => {
				this._pendingCount++;
				this._intervalCount++;

				try {
					const operation = this._timeout === undefined ? fn() : pTimeout(
						Promise.resolve(fn()),
						this._timeout,
						() => {
							if (this._throwOnTimeout) {
								reject(timeoutError);
							}

							return undefined;
						}
					);
					resolve(await operation);
				} catch (error) {
					reject(error);
				}

				this.next();
			};

			this._queue.enqueue(run, options);
			this.tryToStartAnother();
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
		return Promise.all(functions.map(function_ => this.add(function_, options)));
	}

	/**
	Start (or resume) executing enqueued tasks within concurrency limit. No need to call this if queue is not paused (via `options.autoStart = false` or by `.pause()` method.)
	*/
	start(): void {
		if (!this._paused) {
			return;
		}

		this._paused = false;
		// eslint-disable-next-line no-empty
		while (this.tryToStartAnother()) {}
	}

	/**
	Put queue execution on hold.
	*/
	pause(): void {
		this._paused = true;
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
	Size of the queue.
	*/
	get size(): number {
		return this._queue.size;
	}

	/**
	Number of pending promises.
	*/
	get pending(): number {
		return this._pendingCount;
	}

	/**
	Whether the queue is currently paused.
	*/
	get isPaused(): boolean {
		return this._paused;
	}

	/**
	Set the timeout for future operations.
	*/
	set timeout(milliseconds: number | undefined) {
		this._timeout = milliseconds;
	}

	get timeout(): number | undefined {
		return this._timeout;
	}
}
