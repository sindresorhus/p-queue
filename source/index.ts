import {type Queue, type RunFunction} from './queue.js';
import PriorityQueue from './priority-queue.js';
import {type QueueAddOptions, type Options, type TaskOptions} from './options.js';

// `.add()` resolves with `Awaited<TaskResultType>`, because a task that returns `T | Promise<T>` can infer `TaskResultType` as that union.
type Task<TaskResultType> = (options: TaskOptions) => TaskResultType | PromiseLike<TaskResultType>;

// The result of each task, so that `.addAll()` with tasks of different result types resolves with a tuple.
type TaskResults<Tasks extends ReadonlyArray<Task<unknown>>> = {-readonly [Index in keyof Tasks]: Awaited<ReturnType<Tasks[Index]>>};

type EventMap = {
	active: Event;
	idle: Event;
	empty: Event;
	add: Event;
	next: Event;
	completed: CustomEvent<unknown>;
	error: CustomEvent<unknown>;
	pendingZero: Event;
	rateLimit: Event;
	rateLimitCleared: Event;
};

type EventName = keyof EventMap;

// Timers fire after 1 ms for a longer delay, so a longer timeout would fail the task at once, and a longer interval would not limit anything.
const maximumTimerDelay = 2_147_483_647;

const validateTimeout = (timeout: number | undefined): void => {
	if (timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0 && timeout <= maximumTimerDelay)) {
		throw new TypeError(`Expected \`timeout\` to be a positive finite number up to ${maximumTimerDelay}, got \`${timeout}\` (${typeof timeout})`);
	}
};

// A fraction would let one more task through, because the checks are `count < limit`.
// Not `Number.isSafeInteger()`, because a larger integer, like `Number.MAX_VALUE`, is a valid limit.
const validateLimit = (name: string, value: unknown): void => {
	if (!(typeof value === 'number' && value >= 1 && (value === Infinity || Number.isInteger(value)))) { // eslint-disable-line unicorn/prefer-number-is-safe-integer
		throw new TypeError(`Expected \`${name}\` to be an integer from 1 and up or \`Infinity\`, got \`${String(value)}\` (${typeof value})`);
	}
};

const validateRateLimit = (interval: number, intervalCap: number, isStrict: boolean): void => {
	validateLimit('intervalCap', intervalCap);

	if (!(Number.isFinite(interval) && interval >= 0)) {
		throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${String(interval)}\` (${typeof interval})`);
	}

	// Only rate limiting uses a timer for the interval.
	if (intervalCap !== Infinity && interval > maximumTimerDelay) {
		throw new TypeError(`Expected \`interval\` to be at most ${maximumTimerDelay} with an \`intervalCap\`, got \`${interval}\``);
	}

	if (isStrict && interval === 0) {
		throw new TypeError('The `strict` option requires a non-zero `interval`');
	}

	if (isStrict && intervalCap === Infinity) {
		throw new TypeError('The `strict` option requires a finite `intervalCap`');
	}
};

// A task that waits in the queue. `promise` is the promise that `.add()` returned, and `reject` rejects it. `.clear()` marks the promise as handled before it rejects it, so that a caller that ignores the promise does not get an unhandled rejection, which can make the process exit. A caller that handles the promise still gets the error.
type WaitingTask = {
	id?: string;
	// Kept here, because `.setPriority()` changes it while the task waits, and `runningTasks` reports it.
	priority?: number;
	promise?: Promise<unknown>;
	reject?: (reason: unknown) => void;
	isCleared?: boolean;
};

/**
Promise queue with concurrency control.

The queue is an `EventTarget`. Listen with `queue.addEventListener(event, listener)`, and stop with `queue.removeEventListener(event, listener)`. The options `{once: true}` and `{signal}` work too. The `completed` and `error` events have the result or the error in `event.detail`. If the result or the error is `undefined`, `event.detail` is `null`, because `CustomEvent` works that way.
*/
export default class PQueue<QueueType extends Queue<RunFunction, EnqueueOptionsType> = PriorityQueue, EnqueueOptionsType extends QueueAddOptions = QueueAddOptions> extends EventTarget { // eslint-disable-line @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-declaration-merging
	readonly #carryoverIntervalCount: boolean;

	readonly #isIntervalIgnored: boolean;

	#intervalCount = 0;

	readonly #intervalCap: number;

	#rateLimitedInInterval = false;
	#rateLimitFlushScheduled = false;

	readonly #interval: number;

	/*
	Timestamp when the current interval window ends. Kept accurate at every window transition: `#initializeIntervalIfNeeded` sets it when a window starts and `#onInterval` advances it as the recurring timer rolls into each new window. This is the source of truth for whether a task added after the queue goes idle belongs to a fresh window, so it must not go stale.
	*/
	#intervalEnd = 0;

	// Recurring timer that drives windows while the queue is actively processing. Absent (`undefined`) once the queue goes idle.
	#intervalId?: NodeJS.Timeout;

	// One-shot timer used while idle to resume at the next window boundary, since `#intervalId` is cleared when idle.
	#timeoutId?: NodeJS.Timeout;

	readonly #strict: boolean;

	// Circular buffer implementation for better performance
	#strictTicks: number[] = [];
	#strictTicksStartIndex = 0;

	#queue: QueueType;

	readonly #queueClass: new () => QueueType;

	#pending = 0;

	// The `!` is needed because of https://github.com/microsoft/TypeScript/issues/32194
	#concurrency!: number;

	#isPaused: boolean;

	// Use to assign a unique identifier to a promise function, if not explicitly specified
	#idAssigner = 1n;

	// Track currently running tasks for debugging
	readonly #runningTasks = new Map<symbol, {
		id: string;
		priority: number;
		startTime: number;
		timeout: number | undefined;
	}>();

	readonly #queueAbortListenerCleanupFunctions = new Set<() => void>();

	// The waiting tasks, so that `.clear()` can reject their promises.
	readonly #waitingTasks = new Set<WaitingTask>();

	#timeout: number | undefined;

	constructor(options?: Options<QueueType, EnqueueOptionsType>) {
		super();

		// Node.js warns when an event has more than 10 listeners, but many waiters, like `.onIdle()` calls, are normal. Not imported from `node:events`, so it still works in browsers.
		globalThis.process?.getBuiltinModule?.('node:events')?.setMaxListeners(Infinity, this); // eslint-disable-line n/prefer-global/process

		// Defaults in destructuring also apply to an option that is `undefined`, like `{concurrency: options.concurrency}` without a value.
		const {
			carryoverIntervalCount = false,
			intervalCap = Infinity,
			interval = 0,
			concurrency = Infinity,
			autoStart = true,
			queueClass = PriorityQueue as unknown as new () => QueueType,
			strict = false,
			timeout,
		} = options ?? {};

		validateRateLimit(interval, intervalCap, strict);

		this.#carryoverIntervalCount = carryoverIntervalCount;
		this.#isIntervalIgnored = intervalCap === Infinity || interval === 0;
		this.#intervalCap = intervalCap;
		this.#interval = interval;
		this.#strict = strict;
		this.#queueClass = queueClass;
		this.#queue = new this.#queueClass();
		this.concurrency = concurrency;
		this.timeout = timeout;
		this.#isPaused = !autoStart;

		this.#setupRateLimitTracking();
	}

	#emit(event: EventName, detail?: unknown): void {
		this.dispatchEvent(new CustomEvent(event, {detail}));
	}

	async #onEvent(events: EventName | EventName[], shouldHandle?: () => boolean): Promise<void> {
		const eventList = Array.isArray(events) ? events : [events];

		return new Promise(resolve => {
			const controller = new AbortController();

			const listener = () => {
				if (shouldHandle && !shouldHandle()) {
					return;
				}

				controller.abort();
				resolve();
			};

			for (const event of eventList) {
				this.addEventListener(event, listener, {signal: controller.signal});
			}
		});
	}

	// From the current state. `#rateLimitedInInterval` is what the events last reported, and it updates in a microtask.
	get #isRateLimitedNow(): boolean {
		if (this.#isIntervalIgnored || this.#queue.size === 0) {
			return false;
		}

		const now = Date.now();
		if (this.#strict) {
			this.#cleanupStrictTicks(now);
			return this.#getActiveTicksCount() >= this.#intervalCap;
		}

		// Without the recurring timer, the count of an ended window is reset later, by the resume timeout or when the next task starts.
		const isWindowOver = this.#intervalId === undefined && this.#intervalEnd <= now;
		const count = isWindowOver ? this.#intervalCountAtWindowStart : this.#intervalCount;
		return count >= this.#intervalCap;
	}

	// The tasks that still run count against the new window with `carryoverIntervalCount`.
	get #intervalCountAtWindowStart(): number {
		return this.#carryoverIntervalCount ? this.#pending : 0;
	}

	#updateRateLimitState(): void {
		const shouldBeRateLimited = this.#isRateLimitedNow;

		if (shouldBeRateLimited === this.#rateLimitedInInterval) {
			return;
		}

		this.#rateLimitedInInterval = shouldBeRateLimited;
		this.#emit(shouldBeRateLimited ? 'rateLimit' : 'rateLimitCleared');
	}

	#rollbackIntervalConsumption(): void {
		if (this.#isIntervalIgnored) {
			return;
		}

		this.#rollbackIntervalSlot();
		this.#scheduleRateLimitUpdate();
	}

	#scheduleRateLimitUpdate(): void {
		// Skip if rate limiting is not enabled or already scheduled
		if (this.#isIntervalIgnored || this.#rateLimitFlushScheduled) {
			return;
		}

		this.#rateLimitFlushScheduled = true;
		queueMicrotask(() => {
			this.#rateLimitFlushScheduled = false;
			this.#updateRateLimitState();
		});
	}

	#setupRateLimitTracking(): void {
		// Only schedule updates when rate limiting is enabled
		if (this.#isIntervalIgnored) {
			return;
		}

		// Wire up to lifecycle events that affect rate limit state
		// Other changes, like a task that starts or a new window, schedule the update directly
		this.addEventListener('add', () => {
			if (this.#queue.size > 0) {
				this.#scheduleRateLimitUpdate();
			}
		});

		this.addEventListener('next', () => {
			this.#scheduleRateLimitUpdate();
		});
	}

	#cleanupStrictTicks(now: number): void {
		// Remove ticks outside the current interval window using circular buffer approach
		while (this.#strictTicksStartIndex < this.#strictTicks.length) {
			const oldestTick = this.#strictTicks[this.#strictTicksStartIndex];
			if (oldestTick !== undefined && now - oldestTick >= this.#interval) {
				this.#strictTicksStartIndex++;
			} else {
				break;
			}
		}

		// Compact the array when it becomes inefficient or fully consumed
		// Compact when: (start index is large AND more than half wasted) OR all ticks expired
		const shouldCompact = (this.#strictTicksStartIndex > 100 && this.#strictTicksStartIndex > this.#strictTicks.length / 2)
			|| this.#strictTicksStartIndex === this.#strictTicks.length;

		if (!shouldCompact) {
			return;
		}

		this.#strictTicks = this.#strictTicks.slice(this.#strictTicksStartIndex);
		this.#strictTicksStartIndex = 0;
	}

	// Helper methods for interval consumption
	#consumeIntervalSlot(now: number): void {
		if (this.#strict) {
			this.#strictTicks.push(now);
		} else {
			this.#intervalCount++;
		}
	}

	#rollbackIntervalSlot(): void {
		if (this.#strict) {
			// Pop from the end of the actual data (not from start index)
			if (this.#strictTicks.length > this.#strictTicksStartIndex) {
				this.#strictTicks.pop();
			}

			return;
		}

		if (this.#intervalCount > 0) {
			this.#intervalCount--;
		}
	}

	#getActiveTicksCount(): number {
		return this.#strictTicks.length - this.#strictTicksStartIndex;
	}

	get #doesIntervalAllowAnother(): boolean {
		if (this.#isIntervalIgnored) {
			return true;
		}

		// Expired strict ticks still count until `#cleanupStrictTicks()`, which `#isIntervalPausedAt` and `#isRateLimitedNow` call.
		const count = this.#strict ? this.#getActiveTicksCount() : this.#intervalCount;
		return count < this.#intervalCap;
	}

	get #doesConcurrentAllowAnother(): boolean {
		return this.#pending < this.#concurrency;
	}

	#next(): void {
		this.#pending--;

		if (this.#pending === 0) {
			this.#emit('pendingZero');
		}

		this.#processQueue();
		this.#emit('next');
	}

	#onResumeInterval(): void {
		// The timeout fired, so clear its ID before `#onInterval()`, which can schedule a new one
		this.#timeoutId = undefined;
		this.#onInterval();

		// A paused queue needs no recurring timer, which would keep the process alive. `.start()` starts a new window.
		if (!this.#isPaused) {
			this.#initializeIntervalIfNeeded();
		}
	}

	#isIntervalPausedAt(now: number): boolean {
		// Strict mode: check if we need to wait for oldest tick to age out
		if (this.#strict) {
			this.#cleanupStrictTicks(now);

			// If at capacity, need to wait for oldest tick to age out
			const activeTicksCount = this.#getActiveTicksCount();
			if (activeTicksCount >= this.#intervalCap) {
				const oldestTick = this.#strictTicks[this.#strictTicksStartIndex]!;
				// After cleanup, remaining ticks are within interval, so delay is always > 0
				const delay = this.#interval - (now - oldestTick);
				this.#createIntervalTimeout(delay);
				return true;
			}

			return false;
		}

		// Fixed window mode. While the recurring timer runs it already governs the windows, so pausing is only decided here when the queue is idle (the timer is absent) and we rely on `#intervalEnd`.
		if (this.#intervalId === undefined) {
			const delay = this.#intervalEnd - now;
			if (delay <= 0) {
				// The interval expired while idle, so reset the count for the new window.
				this.#intervalCount = this.#intervalCountAtWindowStart;
			} else {
				// Still inside the previous window; wait out the remaining time before starting the next task.
				this.#createIntervalTimeout(delay);
				return true;
			}
		}

		return false;
	}

	#createIntervalTimeout(delay: number): void {
		if (this.#timeoutId !== undefined) {
			return;
		}

		this.#timeoutId = setTimeout(() => {
			this.#onResumeInterval();
		}, delay);
	}

	#clearIntervalTimer(): void {
		if (this.#intervalId === undefined) {
			return;
		}

		clearInterval(this.#intervalId);
		this.#intervalId = undefined;
	}

	#clearTimeoutTimer(): void {
		if (this.#timeoutId === undefined) {
			return;
		}

		clearTimeout(this.#timeoutId);
		this.#timeoutId = undefined;
	}

	// Emits `empty`, and `idle` when no tasks run. For when the queue has no waiting tasks.
	#emitEmptyAndIdle(): void {
		// We can clear the interval ("pause")
		// Because we can redo it later ("resume")
		this.#clearIntervalTimer();
		this.#emit('empty');

		// An `empty` listener can add a task that waits for the rate limit, so check the size again.
		if (this.#pending > 0 || this.#queue.size > 0) {
			return;
		}

		// Clear timeout as well when completely idle
		this.#clearTimeoutTimer();

		// Compact strict ticks when idle to free memory
		if (this.#strict) {
			this.#cleanupStrictTicks(Date.now());
		}

		this.#emit('idle');
	}

	#tryToStartAnother(): boolean {
		// A loop, not recursion, because many tasks can be skipped.
		let isStarted: boolean | undefined;
		do {
			isStarted = this.#startNextTask();
		} while (isStarted === undefined);

		return isStarted;
	}

	// Returns `undefined` when it skipped a task whose signal aborted while it waited.
	#startNextTask(): boolean | undefined {
		if (this.#queue.size === 0) {
			this.#emitEmptyAndIdle();
			return false;
		}

		if (this.#isPaused) {
			// Still schedule the end of the window when rate-limited. Otherwise a paused queue stays rate-limited until `.start()`.
			if (!this.#doesIntervalAllowAnother) {
				this.#isIntervalPausedAt(Date.now());
			}

			return false;
		}

		const now = Date.now();
		const canInitializeInterval = !this.#isIntervalPausedAt(now);

		if (this.#doesIntervalAllowAnother && this.#doesConcurrentAllowAnother) {
			const job = this.#queue.dequeue()!;

			if (!this.#isIntervalIgnored) {
				this.#consumeIntervalSlot(now);
				this.#scheduleRateLimitUpdate();
			}

			if (canInitializeInterval) {
				this.#initializeIntervalIfNeeded();
			}

			// The task is started before the event, so that a listener which enqueues more work sees the concurrency slot already taken. Emitting first let a listener start a second task past the limit.
			const pendingBefore = this.#pending;
			job();

			// `run` did not start a task whose signal aborted while it waited.
			if (this.#pending === pendingBefore) {
				this.#emit('next');
				return;
			}

			this.#emit('active');

			return true;
		}

		return false;
	}

	#initializeIntervalIfNeeded(): void {
		// Strict mode uses timeouts instead of interval timers.
		if (this.#isIntervalIgnored || this.#intervalId !== undefined || this.#strict) {
			return;
		}

		// A new window starts now, so a timeout that waits for the end of an earlier window is stale. If it fired, it would reset the count in the middle of this window.
		this.#clearTimeoutTimer();

		this.#intervalId = setInterval(
			() => {
				this.#onInterval();
			},
			this.#interval,
		);

		this.#intervalEnd = Date.now() + this.#interval;
	}

	#onInterval(): void {
		// Non-strict mode uses interval timers and intervalCount
		if (!this.#strict) {
			// Only touch the recurring interval timer here. When resumed via a timeout instead, `#intervalId` is undefined and `#initializeIntervalIfNeeded` sets `#intervalEnd` right after.
			if (this.#intervalId !== undefined) {
				if (this.#intervalCount === 0 && this.#pending === 0) {
					this.#clearIntervalTimer();
				} else {
					// The recurring timer fired, starting a new window. Keep the boundary accurate so tasks added after the queue later goes idle are scheduled against the correct window.
					this.#intervalEnd = Date.now() + this.#interval;
				}
			}

			this.#intervalCount = this.#intervalCountAtWindowStart;
		}

		this.#processQueue();
		this.#scheduleRateLimitUpdate();
	}

	/**
	Executes all queued functions until it reaches the limit.
	*/
	#processQueue(): void {
		// eslint-disable-next-line no-empty
		while (this.#tryToStartAnother()) {}
	}

	// On an empty queue, `#processQueue()` emits `empty` and `idle`. An `idle` listener that sets `concurrency` or calls `.start()` would then recurse without end.
	#processWaitingTasks(): void {
		if (this.#queue.size > 0) {
			this.#processQueue();
		}
	}

	async #add<TaskResultType>(function_: Task<TaskResultType>, options: Partial<EnqueueOptionsType>, waitingTask: WaitingTask): Promise<Awaited<TaskResultType>> {
		// Assign unique ID if not provided
		const id = options.id ?? (this.#idAssigner++).toString();

		// Create a copy to avoid mutating the original options object
		options = {
			timeout: this.#timeout,
			...options,
			id,
		};

		validateTimeout(options.timeout);

		// A `NaN` priority breaks the order of the queue, also for the other tasks. `Infinity` is fine.
		if (options.priority !== undefined && (typeof options.priority !== 'number' || Number.isNaN(options.priority))) {
			throw new TypeError(`Expected \`priority\` to be a number, got \`${String(options.priority)}\` (${typeof options.priority})`);
		}

		waitingTask.id = id;
		waitingTask.priority = options.priority ?? 0; // Match priority-queue default

		return new Promise<Awaited<TaskResultType>>((resolve, reject) => {
			// A task with an already aborted signal is never added, so it emits no events.
			if (options.signal?.aborted) {
				reject(options.signal.reason);
				return;
			}

			// Create a unique symbol for tracking this task
			const taskSymbol = Symbol(`task-${id}`);

			let cleanupQueueAbortHandler = () => undefined;
			const run = async () => {
				// Task is now running, so remove the queued-state abort listener
				cleanupQueueAbortHandler();
				this.#waitingTasks.delete(waitingTask);

				// The signal aborted while the task waited, but its abort listener did not run yet, for example because another listener of the signal started the queue. Like an abort while waiting, the task does not start.
				if (options.signal?.aborted) {
					this.#rollbackIntervalConsumption();
					reject(options.signal.reason);
					return;
				}

				this.#pending++;

				// Track this running task
				this.#runningTasks.set(taskSymbol, {
					id,
					priority: waitingTask.priority!,
					startTime: Date.now(),
					timeout: options.timeout,
				});

				let {signal} = options;
				let eventListener: (() => void) | undefined;
				let forwardAbort: (() => void) | undefined;
				let timeoutId: NodeJS.Timeout | undefined;

				try {
					// The task gets one signal that aborts on the user's signal or on the timeout. Not `AbortSignal.timeout()`, because its timer does not keep the process alive (by design: https://github.com/nodejs/node/issues/46417), so the process could exit before a hanging task times out. Not `AbortSignal.any()`, because Node.js then keeps some memory for each task for as long as the user's signal lives, which grows without limit with a long-lived signal.
					if (options.timeout !== undefined) {
						const {signal: userSignal, timeout} = options;
						const taskController = new AbortController();
						timeoutId = setTimeout(() => {
							taskController.abort(new TimeoutError(`Task timed out after ${timeout}ms (queue has ${this.#pending} running, ${this.#queue.size} waiting)`));
						}, timeout);

						if (userSignal) {
							forwardAbort = () => {
								taskController.abort(userSignal.reason);
							};

							userSignal.addEventListener('abort', forwardAbort, {once: true});
						}

						signal = taskController.signal;
					}

					let operation;

					if (signal) {
						const abortSignal = signal;

						// Listen before the task starts, so that an abort while the task starts is not missed, and so that the abort comes before the abort listeners of the task. The abort is first in the race, so it also wins when both are already settled.
						const abortPromise = new Promise<never>((_resolve, rejectWithReason) => {
							eventListener = () => {
								rejectWithReason(abortSignal.reason);
							};

							abortSignal.addEventListener('abort', eventListener, {once: true});
						});

						// The `async` function turns a synchronous throw of the task into a rejection, so that `abortPromise` always has a handler.
						operation = Promise.race([abortPromise, (async () => function_({signal}))()]);
					} else {
						// A synchronous throw becomes a rejection, so that `error` comes after `active` and after `.add()` returns, like for a task that rejects.
						try {
							operation = function_({signal});
						} catch (error) {
							operation = Promise.reject(error);
						}
					}

					const result = await operation;
					resolve(result);
					this.#emit('completed', result);
				} catch (error: unknown) {
					// Only the task can throw here, because `dispatchEvent()` reports listener errors instead of throwing them.
					// eslint-disable-next-line unicorn/no-multiple-promise-resolver-calls
					reject(error);
					this.#emit('error', error);
				} finally {
					clearTimeout(timeoutId);

					// Clean up abort event listeners
					if (eventListener) {
						signal?.removeEventListener('abort', eventListener);
					}

					if (forwardAbort) {
						options.signal?.removeEventListener('abort', forwardAbort);
					}

					// Remove from running tasks
					this.#runningTasks.delete(taskSymbol);

					// Use queueMicrotask to prevent deep recursion while maintaining timing
					queueMicrotask(() => {
						this.#next();
					});
				}
			};

			this.#queue.enqueue(run, options);
			waitingTask.reject = reject;
			this.#waitingTasks.add(waitingTask);

			const removeQueuedTask = () => {
				if (this.#queue instanceof PriorityQueue) {
					this.#queue.remove(run);
					return;
				}

				this.#queue.remove(id);
			};

			// Handle abort while task is waiting in the queue
			if (options.signal) {
				const {signal} = options;

				const queueAbortHandler = () => {
					cleanupQueueAbortHandler();
					this.#waitingTasks.delete(waitingTask);
					removeQueuedTask();
					reject(signal.reason);
					this.#tryToStartAnother();
					this.#emit('next');
				};

				cleanupQueueAbortHandler = () => {
					signal.removeEventListener('abort', queueAbortHandler);
					this.#queueAbortListenerCleanupFunctions.delete(cleanupQueueAbortHandler);
				};

				signal.addEventListener('abort', queueAbortHandler, {once: true});
				this.#queueAbortListenerCleanupFunctions.add(cleanupQueueAbortHandler);
			}

			this.#emit('add');

			this.#tryToStartAnother();
		});
	}

	/**
	Get or set the default timeout. A change applies to tasks added after it.

	@example
	```
	const queue = new PQueue({timeout: 5000});

	queue.timeout = 10000;
	```
	*/
	get timeout(): number | undefined {
		return this.#timeout;
	}

	// Validated here, not only in `.add()`, so that an invalid value throws where it is set, instead of making every later `.add()` reject.
	set timeout(timeout: number | undefined) {
		validateTimeout(timeout);
		this.#timeout = timeout;
	}

	get concurrency(): number {
		return this.#concurrency;
	}

	set concurrency(newConcurrency: number) {
		validateLimit('concurrency', newConcurrency);

		this.#concurrency = newConcurrency;

		this.#processWaitingTasks();
	}

	/**
	Changes the priority of a waiting task, found by its `id`. Throws a `ReferenceError` if no waiting task has that `id`, for example because it already started. Throws a `TypeError` if `priority` is not a finite number. Tasks only wait when the queue has a `concurrency` limit, is paused, or is rate-limited.

	@example
	```
	// Raise the priority to run a task earlier
	import PQueue from 'p-queue';

	const queue = new PQueue({concurrency: 1});

	queue.add(async () => '🦄', {priority: 1});
	queue.add(async () => '🦀', {priority: 0, id: '🦀'});
	queue.add(async () => '🦄', {priority: 1});
	queue.add(async () => '🦄', {priority: 1});

	queue.setPriority('🦀', 2);
	// '🦀' runs second
	```

	@example
	```
	// Lower the priority to run a task later
	import PQueue from 'p-queue';

	const queue = new PQueue({concurrency: 1});

	queue.add(async () => '🦄', {priority: 1});
	queue.add(async () => '🦀', {priority: 1, id: '🦀'});
	queue.add(async () => '🦄');
	queue.add(async () => '🦄', {priority: 0});

	queue.setPriority('🦀', -1);
	// '🦀' runs last
	```
	*/
	setPriority(id: string, priority: number) {
		if (typeof priority !== 'number' || !Number.isFinite(priority)) {
			throw new TypeError(`Expected \`priority\` to be a finite number, got \`${priority}\` (${typeof priority})`);
		}

		// Checked here, not only in `PriorityQueue`, so that it also throws with a custom queue class.
		for (const waitingTask of this.#waitingTasks) {
			if (waitingTask.id === id) {
				this.#queue.setPriority(id, priority);
				waitingTask.priority = priority;
				return;
			}
		}

		throw new ReferenceError(`No promise function with the id "${id}" exists in the queue.`);
	}

	/**
	Adds a sync or async task to the queue.

	Returns a promise that settles with the result of `fn` when the task completes, not when it is added. The function gets `{signal}` as its first argument. The signal is set when the task has a `signal` or a `timeout`, and aborts when either one does. Pass it on, for example to `fetch()`, to stop the work.

	If you `await` each `.add()` call before the next, the tasks run one after the other, whatever the `concurrency`.

	Handle rejections of the returned promise. Otherwise, they are unhandled rejections, which can make the process exit.
	*/
	add<TaskResultType>(function_: Task<TaskResultType>, options: Partial<EnqueueOptionsType> = {}): Promise<Awaited<TaskResultType>> { // eslint-disable-line @typescript-eslint/promise-function-async
		// Not `async`, so that `.clear()` gets the same promise as the caller and can mark it as handled. An `async` wrapper would return a different promise.
		const waitingTask: WaitingTask = {};
		const promise = this.#add(function_, options, waitingTask);
		waitingTask.promise = promise;

		// An `add` event listener can call `.clear()` before the promise exists.
		if (waitingTask.isCleared) {
			promise.catch(() => undefined);
		}

		return promise;
	}

	/**
	Like `.add()`, but takes an array of functions.

	@returns A promise that resolves with all the results, in the order of the functions, when all tasks complete.
	*/
	async addAll<const Tasks extends ReadonlyArray<Task<unknown>>>(
		functions: Tasks,
		options?: Partial<EnqueueOptionsType>,
	): Promise<TaskResults<Tasks>>;
	// For an explicit result type, like `.addAll<string>(…)`.
	async addAll<TaskResultsType>(
		functions: ReadonlyArray<Task<TaskResultsType>>,
		options?: Partial<EnqueueOptionsType>,
	): Promise<Array<Awaited<TaskResultsType>>>;
	async addAll(
		functions: ReadonlyArray<Task<unknown>>,
		options?: Partial<EnqueueOptionsType>,
	): Promise<unknown[]> {
		return Promise.all(functions.map(async function_ => this.add(function_, options)));
	}

	/**
	Starts (or resumes) running queued tasks. Only needed if the queue is paused, with `autoStart: false` or `.pause()`.

	@returns `this` (the instance).
	*/
	start(): this {
		if (!this.#isPaused) {
			return this;
		}

		this.#isPaused = false;

		this.#processWaitingTasks();
		return this;
	}

	/**
	Stops starting new tasks. Running tasks continue.
	*/
	pause(): void {
		this.#isPaused = true;
	}

	/**
	Removes all waiting tasks. Running tasks continue.

	The promises returned by `.add()` for the removed tasks reject with an `AbortError`, which is a `DOMException`. The removed tasks do not run, and they do not emit the `error` event.

	If you ignore such a promise, its rejection is not reported as unhandled. This does not apply to a promise made from it, like the one from `queue.add(fn).then(…)` or from `.addAll()`, so handle the rejection of that promise.

	@example
	```
	import PQueue from 'p-queue';

	const queue = new PQueue({concurrency: 1});

	queue.add(() => doWork());
	const promise = queue.add(() => doWork());

	queue.clear();

	try {
		await promise;
	} catch (error) {
		console.log(error.name);
		//=> 'AbortError'
	}
	```
	*/
	clear(): void {
		// Nothing to clear. Emitting `empty` and `idle` here would recurse without end when an `idle` listener calls `.clear()`.
		if (this.#queue.size === 0) {
			return;
		}

		for (const cleanupQueueAbortHandler of this.#queueAbortListenerCleanupFunctions) {
			cleanupQueueAbortHandler();
		}

		this.#queue = new this.#queueClass();

		const error = new DOMException('The queue was cleared', 'AbortError');
		for (const waitingTask of this.#waitingTasks) {
			waitingTask.isCleared = true;
			waitingTask.promise?.catch(() => undefined);
			waitingTask.reject!(error);
		}

		this.#waitingTasks.clear();

		// Note: We preserve strict mode rate-limiting state (ticks)
		// because clear() only clears queued tasks, not rate limit history.
		// This ensures that rate limits are still enforced after clearing the queue.

		// Note: We don't clear #runningTasks as those tasks are still running
		// They will be removed when they complete in the finally block

		// Emit events so waiters (onEmpty, onIdle, onSizeLessThan) can resolve. Before the rate-limit update, because `#emitEmptyAndIdle()` clears the interval timer: a `rateLimitCleared` listener that adds a task would otherwise see the timer of the current window, schedule no resume, and the task would never start.
		this.#emitEmptyAndIdle();

		// Force synchronous update since clear() should have immediate effect
		this.#updateRateLimitState();

		this.#emit('next');
	}

	/**
	Returns a promise that resolves when the queue is empty. Tasks can still be running.

	The promise resolves once. Call `.onEmpty()` again to wait for the next time, or use the `empty` event to get every time.
	*/
	async onEmpty(): Promise<void> {
		// Instantly resolve if the queue is empty
		if (this.#queue.size === 0) {
			return;
		}

		await this.#onEvent('empty');
	}

	/**
	Returns a promise that resolves when `queue.size < limit`.

	Await it before you add a task, to keep the queue from growing beyond a size. It counts only waiting tasks, not running tasks.
	*/
	async onSizeLessThan(limit: number): Promise<void> {
		// Instantly resolve if the size is already below the limit.
		if (this.#queue.size < limit) {
			return;
		}

		// Listen on both `'next'` (task completion, queued abort, `clear()`) and `'active'` (every dequeue), so waiters wake even when the queue drains without a completion (`start()`, a runtime `concurrency` increase, or an interval tick).
		await this.#onEvent(['next', 'active'], () => this.#queue.size < limit);
	}

	/**
	Returns a promise that resolves when the queue is empty and all tasks have completed: `queue.size === 0 && queue.pending === 0`.

	Unlike `.onEmpty()`, it waits for running tasks to finish.

	The promise resolves once. Call `.onIdle()` again to wait for the next time, or use the `idle` event to get every time.
	*/
	async onIdle(): Promise<void> {
		// Instantly resolve if none pending and if nothing else is queued
		if (this.#pending === 0 && this.#queue.size === 0) {
			return;
		}

		await this.#onEvent('idle');
	}

	/**
	Returns a promise that resolves when no tasks are running: `queue.pending === 0`.

	Unlike `.onIdle()`, it ignores queued tasks. Use it to let running tasks finish before you change shared state.

	@example
	```
	queue.pause();
	await queue.onPendingZero();
	// No tasks are running, but the queue can still have tasks
	```
	*/
	async onPendingZero(): Promise<void> {
		if (this.#pending === 0) {
			return;
		}

		await this.#onEvent('pendingZero');
	}

	/**
	Returns a promise that resolves when the queue becomes rate-limited by `intervalCap`. If the queue is already rate-limited, it resolves immediately.

	Useful for backpressure, when tasks are added faster than they run.

	@example
	```
	const queue = new PQueue({intervalCap: 5, interval: 1000});

	for (let index = 0; index < 10; index++) {
		queue.add(() => someTask());
	}

	await queue.onRateLimit();
	console.log('The queue is rate-limited');
	```
	*/
	async onRateLimit(): Promise<void> {
		// Emit a batched change now, so that the state here and the events agree. Otherwise the change could be undone before its event, and no event would come.
		this.#updateRateLimitState();

		if (this.isRateLimited) {
			return;
		}

		await this.#onEvent('rateLimit');
	}

	/**
	Returns a promise that resolves when the queue is no longer rate-limited. If the queue is not rate-limited, it resolves immediately.

	@example
	```
	const queue = new PQueue({intervalCap: 5, interval: 1000});

	for (let index = 0; index < 10; index++) {
		queue.add(() => someTask());
	}

	await queue.onRateLimitCleared();
	console.log('The rate limit is cleared');
	```
	*/
	async onRateLimitCleared(): Promise<void> {
		// Emit a batched change now, so that the state here and the events agree. Otherwise the change could be undone before its event, and no event would come.
		this.#updateRateLimitState();

		if (!this.isRateLimited) {
			return;
		}

		await this.#onEvent('rateLimitCleared');
	}

	/**
	Returns a promise that rejects when a task fails: it throws, times out, or its `signal` aborts while it runs. It rejects with the error of the task, or with `null` if the error is `undefined`, like the `error` event.

	Use `Promise.race([queue.onError(), queue.onIdle()])` to stop at the first error, and to resolve normally when the queue becomes idle.

	Important: The promises returned by `.add()` still reject. Handle each of them (for example with `.catch(() => {})`) to prevent unhandled rejections.

	@example
	```
	import PQueue from 'p-queue';

	const queue = new PQueue({concurrency: 2});

	// Do not start the remaining tasks. Pause in an `error` listener, because it runs before the next task starts, and the code after `await` runs later.
	queue.addEventListener('error', () => {
		queue.pause();
	}, {once: true});

	queue.add(() => fetchData(1)).catch(() => {});
	queue.add(() => fetchData(2)).catch(() => {});
	queue.add(() => fetchData(3)).catch(() => {});

	try {
		await Promise.race([
			queue.onError(),
			queue.onIdle()
		]);
	} catch (error) {
		console.error('Queue failed:', error);
	}
	```
	*/
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	onError(): Promise<never> {
		return new Promise<never>((_resolve, reject) => {
			this.addEventListener('error', event => {
				reject(event.detail);
			}, {once: true});
		});
	}

	/**
	The number of tasks waiting to run.
	*/
	get size(): number {
		return this.#queue.size;
	}

	/**
	The number of waiting tasks with the given `priority`.

	@example
	```
	import PQueue from 'p-queue';

	const queue = new PQueue();

	// Paused, so the tasks stay queued. Without it they all start synchronously and the queue is empty by the time `sizeBy` reads it.
	queue.pause();

	queue.add(async () => '🦄', {priority: 1});
	queue.add(async () => '🦄', {priority: 0});
	queue.add(async () => '🦄', {priority: 1});

	console.log(queue.sizeBy({priority: 1}));
	//=> 2

	console.log(queue.sizeBy({priority: 0}));
	//=> 1
	```
	*/
	sizeBy(options: Readonly<Partial<EnqueueOptionsType>>): number {
		return this.#queue.filter(options).length;
	}

	/**
	The number of running tasks.
	*/
	get pending(): number {
		return this.#pending;
	}

	/**
	Whether the queue is paused.
	*/
	get isPaused(): boolean {
		return this.#isPaused;
	}

	/**
	Whether the queue is rate-limited: the number of tasks started in the current interval has reached `intervalCap`, and tasks are waiting.
	*/
	get isRateLimited(): boolean {
		return this.#isRateLimitedNow;
	}

	/**
	Whether tasks are waiting because all concurrency slots are in use, or because the queue is rate-limited.

	Useful to detect backpressure and tasks that hang.

	@example
	```
	import PQueue from 'p-queue';

	const queue = new PQueue({concurrency: 2});

	// Backpressure
	if (queue.isSaturated) {
		await queue.onSizeLessThan(queue.concurrency);
	}

	// Monitoring
	setInterval(() => {
		if (queue.isSaturated) {
			console.warn(`Queue saturated: ${queue.pending} running, ${queue.size} waiting`);
		}
	}, 60000);
	```
	*/
	get isSaturated(): boolean {
		// `>=`, because lowering `concurrency` does not stop the tasks that already run.
		return this.#queue.size > 0 && (this.#pending >= this.#concurrency || this.isRateLimited);
	}

	/**
	An array with the running tasks. Each task has its `id`, `priority`, `startTime`, `timeout`, and `timeoutRemaining` (the milliseconds until it times out). Without a timeout, `timeout` and `timeoutRemaining` are `undefined`.

	@example
	```
	import PQueue from 'p-queue';

	const queue = new PQueue({concurrency: 2, timeout: 10000});

	queue.add(() => fetchUser(123), {id: 'user-123'});
	queue.add(() => fetchPosts(456), {id: 'posts-456', priority: 1});

	console.log(queue.runningTasks);
	// => [{
	//   id: 'user-123',
	//   priority: 0,
	//   startTime: 1759253001716,
	//   timeout: 10000,
	//   timeoutRemaining: 10000
	// }, {
	//   id: 'posts-456',
	//   priority: 1,
	//   startTime: 1759253001716,
	//   timeout: 10000,
	//   timeoutRemaining: 10000
	// }]
	```
	*/
	get runningTasks(): ReadonlyArray<{
		readonly id: string;
		readonly priority: number;
		readonly startTime: number;
		readonly timeout: number | undefined;
		readonly timeoutRemaining: number | undefined;
	}> {
		// Return fresh array with fresh objects to prevent mutations
		return Array.from(this.#runningTasks.values(), task => ({
			...task,
			timeoutRemaining: task.timeout === undefined ? undefined : Math.max(0, task.startTime + task.timeout - Date.now()),
		}));
	}
}

/**
The error a task rejects with when it times out. It is a `DOMException` named `TimeoutError`, like the error of `AbortSignal.timeout()`.

@example
```
import PQueue, {TimeoutError} from 'p-queue';

const queue = new PQueue({timeout: 1000});

try {
	await queue.add(() => someTask());
} catch (error) {
	if (error instanceof TimeoutError) {
		console.log('Task timed out');
	}
}
```
*/
export class TimeoutError extends DOMException {
	constructor(message?: string) {
		super(message, 'TimeoutError');
	}
}

export type {Queue, RunFunction} from './queue.js';
export {default as PriorityQueue} from './priority-queue.js';
export {type QueueAddOptions, type Options, type TaskOptions} from './options.js';

// Typed event listeners. Only types, the methods are the native ones from `EventTarget`. It must be an interface to merge with the class.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export default interface PQueue<QueueType extends Queue<RunFunction, EnqueueOptionsType> = PriorityQueue, EnqueueOptionsType extends QueueAddOptions = QueueAddOptions> { // eslint-disable-line @typescript-eslint/naming-convention
	addEventListener<Name extends EventName>(type: Name, listener: (event: EventMap[Name]) => void, options?: boolean | AddEventListenerOptions): void;
	removeEventListener<Name extends EventName>(type: Name, listener: (event: EventMap[Name]) => void, options?: boolean | EventListenerOptions): void;
}
