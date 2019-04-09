import EventEmitter from 'eventemitter3';
import {Queue} from './queue';
import PriorityQueue from './priority-queue';
import {QueueAddOptions, DefaultAddOptions, Options} from './options';

type ResolveFunction<T = void> = (value?: T | PromiseLike<T>) => void;

type Task<TaskResultType> =
		| (() => PromiseLike<TaskResultType>)
		| (() => TaskResultType);

/**
Promise queue with concurrency control.
*/
export default class PQueue<Q extends Queue<EnqueueOptionsType>, EnqueueOptionsType extends QueueAddOptions = DefaultAddOptions> extends EventEmitter {
	private readonly _carryoverConcurrencyCount: boolean;
	private readonly _isIntervalIgnored: boolean;
	private _intervalCount: number;
	private readonly _intervalCap: number;
	private readonly _interval: number;
	private _intervalEnd: number;
	private _intervalId: NodeJS.Timeout | null;
	private _timeoutId: NodeJS.Timeout | null;

	private queue: Q;
	private readonly _queueClass: new () => Q;

	private _pendingCount: number;
	private readonly _concurrency: number;
	private _isPaused: boolean;

	private _resolveEmpty: ResolveFunction;
	private _resolveIdle: ResolveFunction;

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

		if (!options.interval || !(Number.isFinite(options.interval) && options.interval >= 0)) {
			throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${options.interval}\` (${typeof options.interval})`);
		}

		this._carryoverConcurrencyCount = options.carryoverConcurrencyCount!;
		this._isIntervalIgnored = options.intervalCap === Infinity || options.interval === 0;
		this._intervalCount = 0;
		this._intervalCap = options.intervalCap;
		this._interval = options.interval;
		this._intervalId = null;
		this._intervalEnd = 0;
		this._timeoutId = null;

		this.queue = new options.queueClass!(); // tslint-disable-line new-cap
		this._queueClass = options.queueClass!;
		this._pendingCount = 0;
		this._concurrency = options.concurrency;
		this._isPaused = options.autoStart === false;
		this._resolveEmpty = () => {};
		this._resolveIdle = () => {};
	}

	get _doesIntervalAllowAnother() {
		return this._isIntervalIgnored || this._intervalCount < this._intervalCap;
	}

	get _doesConcurrentAllowAnother() {
		return this._pendingCount < this._concurrency;
	}

	_next() {
		this._pendingCount--;
		this._tryToStartAnother();
	}

	_resolvePromises() {
		this._resolveEmpty();
		this._resolveEmpty = () => {};

		if (this._pendingCount === 0) {
			this._resolveIdle();
			this._resolveIdle = () => {};
		}
	}

	_onResumeInterval() {
		this._onInterval();
		this._initializeIntervalIfNeeded();
		this._timeoutId = null;
	}

	_intervalPaused() {
		const now = Date.now();

		if (this._intervalId === null) {
			const delay = this._intervalEnd - now;
			if (delay < 0) {
				// Act as the interval was done
				// We don't need to resume it here,
				// because it'll be resumed on line 160
				this._intervalCount = (this._carryoverConcurrencyCount) ? this._pendingCount : 0;
			} else {
				// Act as the interval is pending
				if (this._timeoutId === null) {
					this._timeoutId = setTimeout(() => {
						this._onResumeInterval();
					},                           delay);
				}

				return true;
			}
		}

		return false;
	}

	_tryToStartAnother() {
		if (this.queue.size === 0) {
			// We can clear the interval ("pause")
			// because we can redo it later ("resume")
			clearInterval(this._intervalId!);
			this._intervalId = null;

			this._resolvePromises();

			return false;
		}

		if (!this._isPaused) {
			const canInitializeInterval = !this._intervalPaused();
			if (this._doesIntervalAllowAnother && this._doesConcurrentAllowAnother) {
				this.emit('active');
				this.queue.dequeue()!();
				if (canInitializeInterval) {
					this._initializeIntervalIfNeeded();
				}

				return true;
			}
		}

		return false;
	}

	_initializeIntervalIfNeeded() {
		if (this._isIntervalIgnored || this._intervalId !== null) {
			return;
		}

		this._intervalId = setInterval(() => this._onInterval(), this._interval);
		this._intervalEnd = Date.now() + this._interval;
	}

	_onInterval() {
		if (this._intervalCount === 0 && this._pendingCount === 0) {
			clearInterval(this._intervalId!);
			this._intervalId = null;
		}

		this._intervalCount = (this._carryoverConcurrencyCount) ? this._pendingCount : 0;
		while (this._tryToStartAnother()) {} // tslint-disable-line no-empty
	}

	/**
	Adds a sync or async task to the queue. Always returns a promise.
	*/
	async add<TaskResultType>(fn: Task<TaskResultType>, options?: EnqueueOptionsType) {
		return new Promise<TaskResultType>((resolve, reject) => {
			const run = async () => {
				this._pendingCount++;
				this._intervalCount++;

				try {
					resolve(await fn());
				} catch (error) {
					reject(error);
				}

				this._next();
			};

			this.queue.enqueue(run, options);
			this._tryToStartAnother();
		});
	}

	/**
	Same as `.add()`, but accepts an array of sync or async functions.
	@returns A promise that resolves when all functions are resolved.
	*/
	async addAll<TaskResultsType>(fns: Task<TaskResultsType>[], options?: EnqueueOptionsType): Promise<TaskResultsType[]> {
		return Promise.all(fns.map(fn => this.add(fn, options)));
	}

	/**
	Start (or resume) executing enqueued tasks within concurrency limit. No need to call this if queue is not paused (via `options.autoStart = false` or by `.pause()` method.)
	*/
	start() {
		if (!this._isPaused) {
			return;
		}

		this._isPaused = false;
		while (this._tryToStartAnother()) {} // tslint-disable-line no-empty
	}

	/**
	Put queue execution on hold.
	*/
	pause() {
		this._isPaused = true;
	}

	/**
	Clear the queue.
	*/
	clear() {
		this.queue = new this._queueClass();
	}

	/**
	Can be called multiple times. Useful if you for example add additional items at a later time.

	@returns A promise that settles when the queue becomes empty.
	*/
	async onEmpty() {
		// Instantly resolve if the queue is empty
		if (this.queue.size === 0) {
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
	async onIdle() {
		// Instantly resolve if none pending and if nothing else is queued
		if (this._pendingCount === 0 && this.queue.size === 0) {
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
	get size() {
		return this.queue.size;
	}

	/**
	Number of pending promises.
	*/
	get pending() {
		return this._pendingCount;
	}

	/**
	Whether the queue is currently paused.
	*/
	get isPaused() {
		return this._isPaused;
	}
}
