import EventEmitter from 'eventemitter3';
import {Queue} from './queue';
import PriorityQueue from './priority-queue';
import {QueueAddOptions, DefaultAddOptions, Options} from './options';

type ResolveFunction<T = void> = (value?: T | PromiseLike<T>) => void;

type Task<TaskResultType> =
		| (() => PromiseLike<TaskResultType>)
		| (() => TaskResultType);

// tslint:disable-next-line:no-empty
const empty = () => {};

/**
 * Promise queue with concurrency control.
 */
export default class PQueue<Q extends Queue<EnqueueOptionsType>, EnqueueOptionsType extends QueueAddOptions = DefaultAddOptions> extends EventEmitter<'active'> {
	private readonly carryoverConcurrencyCount: boolean;
	private readonly isIntervalIgnored: boolean;
	private intervalCount: number;
	private readonly intervalCap: number;
	private readonly interval: number;
	private intervalEnd: number;
	private intervalId?: NodeJS.Timeout;
	private timeoutId?: NodeJS.Timeout;

	private queue: Q;
	private readonly queueClass: new () => Q;

	private pendingCount: number;
	private readonly concurrency: number;
	private paused: boolean;

	private resolveEmpty: ResolveFunction;
	private resolveIdle: ResolveFunction;

	constructor(opt?: Options<Q, EnqueueOptionsType>) {
		super();

		const options: Options<Q, EnqueueOptionsType> = {
			carryoverConcurrencyCount: false,
			intervalCap: Infinity,
			interval: 0,
			concurrency: Infinity,
			autoStart: true,
			// @ts-ignore This default is a little nasty!
			queueClass: PriorityQueue,
			...opt
		};

		if (!(typeof options.concurrency === 'number' && options.concurrency >= 1)) {
			throw new TypeError(`Expected \`concurrency\` to be a number from 1 and up, got \`${options.concurrency}\` (${typeof options.concurrency})`);
		}

		if (!(typeof options.intervalCap === 'number' && options.intervalCap >= 1)) {
			throw new TypeError(`Expected \`intervalCap\` to be a number from 1 and up, got \`${options.intervalCap}\` (${typeof options.intervalCap})`);
		}

		if (options.interval === undefined || !(Number.isFinite(options.interval) && options.interval >= 0)) {
			throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${options.interval}\` (${typeof options.interval})`);
		}

		// tslint:disable-next-line:no-non-null-assertion
		this.carryoverConcurrencyCount = options.carryoverConcurrencyCount!;
		this.isIntervalIgnored = options.intervalCap === Infinity || options.interval === 0;
		this.intervalCount = 0;
		this.intervalCap = options.intervalCap;
		this.interval = options.interval;
		this.intervalId = undefined;
		this.intervalEnd = 0;
		this.timeoutId = undefined;

		// tslint:disable-next-line:no-non-null-assertion
		this.queue = new options.queueClass!();
		// tslint:disable-next-line:no-non-null-assertion
		this.queueClass = options.queueClass!;
		this.pendingCount = 0;
		this.concurrency = options.concurrency;
		this.paused = options.autoStart === false;

		this.resolveEmpty = empty;
		this.resolveIdle = empty;
	}

	get doesIntervalAllowAnother(): boolean {
		return this.isIntervalIgnored || this.intervalCount < this.intervalCap;
	}

	get doesConcurrentAllowAnother(): boolean {
		return this.pendingCount < this.concurrency;
	}

	next(): void {
		this.pendingCount--;
		this.tryToStartAnother();
	}

	resolvePromises(): void {
		this.resolveEmpty();
		this.resolveEmpty = empty;

		if (this.pendingCount === 0) {
			this.resolveIdle();
			this.resolveIdle = empty;
		}
	}

	onResumeInterval(): void {
		this.onInterval();
		this.initializeIntervalIfNeeded();
		this.timeoutId = undefined;
	}

	intervalPaused(): boolean {
		const now = Date.now();

		if (this.intervalId === undefined) {
			const delay = this.intervalEnd - now;
			if (delay < 0) {
				// Act as the interval was done
				// We don't need to resume it here,
				// Because it'll be resumed on line 160
				this.intervalCount = (this.carryoverConcurrencyCount) ? this.pendingCount : 0;
			} else {
				// Act as the interval is pending
				if (this.timeoutId === undefined) {
					this.timeoutId = setTimeout(
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
		if (this.queue.size === 0) {
			// We can clear the interval ("pause")
			// Because we can redo it later ("resume")
			if (this.intervalId) {
				clearInterval(this.intervalId);
			}
			this.intervalId = undefined;

			this.resolvePromises();

			return false;
		}

		if (!this.paused) {
			const canInitializeInterval = !this.intervalPaused();
			if (this.doesIntervalAllowAnother && this.doesConcurrentAllowAnother) {
				this.emit('active');

				// tslint:disable-next-line:no-non-null-assertion no-floating-promises
				this.queue.dequeue()!();
				if (canInitializeInterval) {
					this.initializeIntervalIfNeeded();
				}

				return true;
			}
		}

		return false;
	}

	initializeIntervalIfNeeded(): void {
		if (this.isIntervalIgnored || this.intervalId !== undefined) {
			return;
		}

		this.intervalId = setInterval(
			() => {
				this.onInterval();
			},
			this.interval
		);
		this.intervalEnd = Date.now() + this.interval;
	}

	onInterval(): void {
		if (this.intervalCount === 0 && this.pendingCount === 0 && this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
		}

		this.intervalCount = (this.carryoverConcurrencyCount) ? this.pendingCount : 0;
		// tslint:disable-next-line:no-empty
		while (this.tryToStartAnother()) {}
	}

	/**
	 * Adds a sync or async task to the queue. Always returns a promise.
	 */
	async add<TaskResultType>(fn: Task<TaskResultType>, options?: EnqueueOptionsType): Promise<TaskResultType> {
		return new Promise<TaskResultType>((resolve, reject) => {
			const run = async () => {
				this.pendingCount++;
				this.intervalCount++;

				try {
					// tslint:disable-next-line:await-promise
					resolve(await fn());
				} catch (error) {
					reject(error);
				}

				this.next();
			};

			this.queue.enqueue(run, options);
			this.tryToStartAnother();
		});
	}

	/**
	 * Same as `.add()`, but accepts an array of sync or async functions.
	 * @returns A promise that resolves when all functions are resolved.
	 */
	async addAll<TaskResultsType>(fns: Task<TaskResultsType>[], options?: EnqueueOptionsType): Promise<TaskResultsType[]> {
		return Promise.all(fns.map(fn => this.add(fn, options)));
	}

	/**
	 * Start (or resume) executing enqueued tasks within concurrency limit. No need to call this if queue is not paused (via `options.autoStart = false` or by `.pause()` method.)
	 */
	start(): void {
		if (!this.paused) {
			return;
		}

		this.paused = false;
		// tslint:disable-next-line:no-empty
		while (this.tryToStartAnother()) {}
	}

	/**
	 * Put queue execution on hold.
	 */
	pause(): void {
		this.paused = true;
	}

	/**
	 * Clear the queue.
	 */
	clear(): void {
		this.queue = new this.queueClass();
	}

	/**
	 * Can be called multiple times. Useful if you for example add additional items at a later time.
	 * @returns A promise that settles when the queue becomes empty.
	 */
	async onEmpty(): Promise<void> {
		// Instantly resolve if the queue is empty
		if (this.queue.size === 0) {
			return;
		}

		return new Promise<void>(resolve => {
			const existingResolve = this.resolveEmpty;
			this.resolveEmpty = () => {
				existingResolve();
				resolve();
			};
		});
	}

	/**
	 * The difference with `.onEmpty` is that `.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet.
	 * @returns A promise that settles when the queue becomes empty, and all promises have completed; `queue.size === 0 && queue.pending === 0`.
	 */
	async onIdle(): Promise<void> {
		// Instantly resolve if none pending and if nothing else is queued
		if (this.pendingCount === 0 && this.queue.size === 0) {
			return;
		}

		return new Promise<void>(resolve => {
			const existingResolve = this.resolveIdle;
			this.resolveIdle = () => {
				existingResolve();
				resolve();
			};
		});
	}

	/**
	 * Size of the queue.
	 */
	get size(): number {
		return this.queue.size;
	}

	/**
	 * Number of pending promises.
	 */
	get pending(): number {
		return this.pendingCount;
	}

	/**
	 * Whether the queue is currently paused.
	 */
	get isPaused(): boolean {
		return this.paused;
	}
}
