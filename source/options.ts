import {type Queue, type RunFunction} from './queue.js';
import type PriorityQueue from './priority-queue.js';

type TimeoutOptions = {
	/**
	The time in milliseconds a task can run. When the time is up, the `signal` of the task aborts and `.add()` rejects with a `TimeoutError`, which is a `DOMException`. Like with the `signal` option of `.add()`, the concurrency slot is freed, but the task keeps running unless it handles its `signal`.

	The time starts when the task starts running, not when it is added. Override it for one task with the `timeout` option of `.add()`.

	Maximum: `2147483647` (about 24.8 days).

	@default undefined

	@example
	```
	import PQueue, {TimeoutError} from 'p-queue';

	const queue = new PQueue({timeout: 5000});

	try {
		// The signal aborts on timeout, which stops the request
		await queue.add(({signal}) => fetch('https://sindresorhus.com', {signal}));
	} catch (error) {
		if (error instanceof TimeoutError) {
			console.log('The task timed out after 5 seconds');
		}
	}

	// A longer timeout for this task
	await queue.add(() => slowTask(), {timeout: 10000});

	// No timeout for this task
	await queue.add(() => verySlowTask(), {timeout: undefined});
	```
	*/
	timeout?: number | undefined;
};

// The defaults match `PQueue`, so that `Options` without type arguments is for the default queue.
export type Options<QueueType extends Queue<RunFunction, QueueOptions> = PriorityQueue, QueueOptions extends QueueAddOptions = QueueAddOptions> = {
	/**
	The maximum number of tasks that run at the same time. Must be an integer or `Infinity`.

	Minimum: `1`.

	@default Infinity
	*/
	readonly concurrency?: number | undefined;

	/**
	Whether tasks start as soon as they are added. If `false`, call `.start()` to start them.

	@default true
	*/
	readonly autoStart?: boolean | undefined;

	/**
	A class with `enqueue()`, `dequeue()`, `filter()`, `setPriority()`, and `remove()` methods and a `size` getter. See [Custom QueueClass](https://github.com/sindresorhus/p-queue#custom-queueclass).
	*/
	readonly queueClass?: (new () => QueueType) | undefined;

	/**
	The maximum number of tasks that start in each `interval`. Must be an integer or `Infinity`.

	Minimum: `1`.

	@default Infinity
	*/
	readonly intervalCap?: number | undefined;

	/**
	The length of the rate-limit interval in milliseconds. `0` disables rate limiting.

	Minimum: `0`.
	Maximum: `2147483647` (about 24.8 days) with a finite `intervalCap`.

	@default 0
	*/
	readonly interval?: number | undefined;

	/**
	Whether tasks that are still running when an interval ends count against `intervalCap` in the next interval.

	@default false
	*/
	readonly carryoverIntervalCount?: boolean | undefined;

	/**
	Whether to rate limit with a sliding window instead of fixed windows. Requires a non-zero `interval` and a finite `intervalCap`.

	With a sliding window, no more than `intervalCap` tasks start in any period of length `interval`. With fixed windows, the count resets at each window boundary, so tasks can burst there.

	For example, with `intervalCap: 2` and `interval: 1000`:
	- __Fixed windows (default):__ 2 tasks can start at 999 ms and 2 more at 1000 ms, so 4 tasks start within 1 ms.
	- __Sliding window (strict):__ No more than 2 tasks start in any 1000 ms period.

	Strict mode uses more resources, because it keeps the start time of each task. Use it when an API enforces strict rate limits.

	`carryoverIntervalCount` has no effect in strict mode, because strict mode counts start times, not running tasks.

	@default false
	*/
	readonly strict?: boolean | undefined;
} & TimeoutOptions;

export type QueueAddOptions = {
	/**
	Tasks with a higher priority start first. `Infinity` and `-Infinity` work. `.add()` rejects with a `TypeError` when it is `NaN` or not a number.

	@default 0
	*/
	readonly priority?: number | undefined;

	/**
	A unique identifier for the task, used to change its priority with `.setPriority()`. Defaults to an incrementing number as a string (`'1'`, `'2'`, and so on), so do not use such strings as your own ids.
	*/
	id?: string | undefined;

	/**
	Override the timeout of the queue for this task. `undefined` means no timeout.

	@default The `timeout` of the queue
	*/
	timeout?: number | undefined;
} & TaskOptions;

export type TaskOptions = {
	/**
	An [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) to cancel the task. If it aborts while the task waits, the task is removed and `.add()` rejects with the [abort reason](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/reason). If it aborts while the task runs, `.add()` rejects and the concurrency slot is freed, but the task keeps running unless it handles the signal itself.

	@example
	```
	import PQueue from 'p-queue';
	import got, {CancelError} from 'got';

	const queue = new PQueue();

	const controller = new AbortController();

	setTimeout(() => {
		controller.abort();
	}, 100);

	try {
		await queue.add(async ({signal}) => {
			const request = got('https://sindresorhus.com');

			signal?.addEventListener('abort', () => {
				request.cancel();
			});

			try {
				return await request;
			} catch (error) {
				if (!(error instanceof CancelError)) {
					throw error;
				}
			}
		}, {signal: controller.signal});
	} catch (error) {
		if (!(error instanceof DOMException)) {
			throw error;
		}
	}
	```
	*/
	readonly signal?: AbortSignal | undefined;
};
