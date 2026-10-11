# p-queue

> Promise queue with concurrency control

Useful for rate-limiting async (or sync) operations, for example calls to a REST API, or CPU-intensive or memory-intensive tasks.

For servers, you probably want a Redis-backed [job queue](https://github.com/sindresorhus/awesome-nodejs#job-queues) instead.

The project is feature complete. We are happy to review pull requests, but we do not plan more development. We do not answer support questions by email.

---

<br>
<div align="center">
	<p>
		<p>
			<sup>
				<a href="https://github.com/sponsors/sindresorhus">Sindre's open source work is supported by the community</a><br>Special thanks to:
			</sup>
		</p>
		<br>
		<br>
		<a href="https://fetchfox.ai?ref=sindre">
			<div>
				<img src="https://sindresorhus.com/assets/thanks/fetchfox-logo.svg" height="200"/>
			</div>
			<b>Scrape anything with FetchFox</b>
			<div>
				<sup>FetchFox is an AI powered scraping tool that lets you scrape data from any website</sup>
			</div>
		</a>
	</p>
	<br>
	<br>
</div>

---

## Highlights

- Concurrency limit
- [Priorities](#priority)
- [Rate limiting](#interval)
- [Timeouts](#handling-timeouts)
- [Cancellation with `AbortSignal`](#signal)
- [Events](#events)
- Zero dependencies

## Install

```sh
npm install p-queue
```

**Warning:** This package is native [ESM](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) and has no CommonJS export. If your project uses CommonJS, [convert it to ESM](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c). Please do not open issues about CommonJS or ESM.

## Usage

This runs one task at a time. Set `concurrency` to 4 to run four at the same time.

```js
import PQueue from 'p-queue';
import got from 'got';

const queue = new PQueue({concurrency: 1});

queue.add(async () => {
	await got('https://sindresorhus.com');
	console.log('Done: sindresorhus.com');
});

queue.add(async () => {
	await got('https://avajs.dev');
	console.log('Done: avajs.dev');
});

await queue.onIdle();
```

## API

### PQueue(options?)

Returns a new `queue` instance, which is an [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget).

#### options

Type: `object`

##### concurrency

Type: `number`\
Default: `Infinity`\
Minimum: `1`

The maximum number of tasks that run at the same time.

##### timeout

Type: `number`\
Default: `undefined`

The time in milliseconds a task can run. When the time is up, the `signal` of the task aborts and `.add()` rejects with a `TimeoutError`, which is a `DOMException`. Like with the [`signal`](#signal) option of `.add()`, the concurrency slot is freed, but the task keeps running unless it handles its `signal`.

The time starts when the task starts running, not when it is added. Override it for one task with the `timeout` option of `.add()`. See [Handling timeouts](#handling-timeouts).

##### autoStart

Type: `boolean`\
Default: `true`

Whether tasks start as soon as they are added. If `false`, call `.start()` to start them.

##### queueClass

Type: `Function`

A class with `enqueue()`, `dequeue()`, `filter()`, `setPriority()`, and `remove()` methods and a `size` getter. See [Custom QueueClass](#custom-queueclass).

##### intervalCap

Type: `number`\
Default: `Infinity`\
Minimum: `1`

The maximum number of tasks that start in each `interval`.

##### interval

Type: `number`\
Default: `0`\
Minimum: `0`

The length of the rate-limit interval in milliseconds. Must be finite. `0` disables rate limiting.

##### carryoverIntervalCount

Type: `boolean`\
Default: `false`

Whether tasks that are still running when an interval ends count against `intervalCap` in the next interval.

##### strict

Type: `boolean`\
Default: `false`

Whether to rate limit with a sliding window instead of fixed windows. Requires a non-zero `interval` and a finite `intervalCap`.

With a sliding window, no more than `intervalCap` tasks start in any period of length `interval`. With fixed windows, the count resets at each window boundary, so tasks can burst there.

For example, with `intervalCap: 2` and `interval: 1000`:
- **Fixed windows (default):** 2 tasks can start at 999 ms and 2 more at 1000 ms, so 4 tasks start within 1 ms.
- **Sliding window (strict):** No more than 2 tasks start in any 1000 ms period.

> [!NOTE]
> Strict mode uses more resources, because it keeps the start time of each task. Use it when an API enforces strict rate limits.

> [!NOTE]
> `carryoverIntervalCount` has no effect in strict mode, because strict mode counts start times, not running tasks.

### queue

`PQueue` instance.

#### .add(fn, options?)

Adds a sync or async task to the queue.

Returns a promise that settles with the result of `fn` when the task completes, not when it is added.

> [!IMPORTANT]
> If you `await` each `.add()` call before the next, the tasks run one after the other, whatever the `concurrency`. See [Usage](#usage).

> [!NOTE]
> Handle rejections of the returned promise. Otherwise, they are unhandled rejections, which can make the process exit.

##### fn

Type: `Function`

A sync or async function. It gets `{signal}` as its first argument. The signal is set when the task has a `signal` or a `timeout`, and aborts when either one does. Pass it on, for example to `fetch()`, to stop the work.

#### options

Type: `object`

##### priority

Type: `number`\
Default: `0`

Tasks with a higher priority start first. `Infinity` and `-Infinity` work. `.add()` rejects with a `TypeError` when it is `NaN` or not a number.

##### id

Type: `string`

A unique identifier for the task, used to change its priority with `.setPriority()`. Defaults to an incrementing number as a string (`'1'`, `'2'`, and so on).

##### timeout

Type: `number | undefined`\
Default: The [`timeout`](#timeout) of the queue

Override the timeout of the queue for this task. `undefined` means no timeout. See [Handling timeouts](#handling-timeouts).

##### signal

An [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) to cancel the task. If it aborts while the task waits, the task is removed and `.add()` rejects with the [abort reason](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/reason). If it aborts while the task runs, `.add()` rejects and the concurrency slot is freed, but the task keeps running unless it handles the signal itself.

```js
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

		signal.addEventListener('abort', () => {
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

#### .addAll(fns, options?)

Like `.add()`, but takes an array of functions. Returns a promise that resolves with all the results when all tasks complete.

#### .pause()

Stops starting new tasks. Running tasks continue.

#### .start()

Starts (or resumes) running queued tasks. Only needed if the queue is paused, with `autoStart: false` or `.pause()`.

Returns `this` (the instance).

#### .onEmpty()

Returns a promise that resolves when the queue is empty. Tasks can still be running.

> [!NOTE]
> The promise resolves **once**. Call `.onEmpty()` again to wait for the next time, or use the [`empty` event](#empty) to get every time.

#### .onIdle()

Returns a promise that resolves when the queue is empty and all tasks have completed: `queue.size === 0 && queue.pending === 0`.

Unlike `.onEmpty()`, it waits for running tasks to finish.

> [!NOTE]
> The promise resolves **once**. Call `.onIdle()` again to wait for the next time, or use the [`idle` event](#idle) to get every time.

#### .onPendingZero()

Returns a promise that resolves when no tasks are running: `queue.pending === 0`.

Unlike `.onIdle()`, it ignores queued tasks. Use it to let running tasks finish before you change shared state.

```js
queue.pause();
await queue.onPendingZero();
// No tasks are running, but the queue can still have tasks
```

#### .onRateLimit()

Returns a promise that resolves when the queue becomes rate-limited by `intervalCap`. If the queue is already rate-limited, it resolves immediately.

Useful for backpressure, when tasks are added faster than they run.

```js
const queue = new PQueue({intervalCap: 5, interval: 1000});

for (let index = 0; index < 10; index++) {
	queue.add(() => someTask());
}

await queue.onRateLimit();
console.log('The queue is rate-limited');
```

#### .onRateLimitCleared()

Returns a promise that resolves when the queue is no longer rate-limited. If the queue is not rate-limited, it resolves immediately.

```js
const queue = new PQueue({intervalCap: 5, interval: 1000});

await queue.onRateLimitCleared();
console.log('The rate limit is cleared');
```

#### .onError()

Returns a promise that rejects when a task fails: it throws, times out, or its `signal` aborts while it runs.

Use `Promise.race([queue.onError(), queue.onIdle()])` to stop at the first error, and to resolve normally when the queue becomes idle.

> [!IMPORTANT]
> The promises returned by `.add()` still reject. Handle each of them (for example with `.catch(() => {})`) to prevent unhandled rejections.

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2});

queue.add(() => fetchData(1)).catch(() => {});
queue.add(() => fetchData(2)).catch(() => {});
queue.add(() => fetchData(3)).catch(() => {});

try {
	await Promise.race([
		queue.onError(),
		queue.onIdle()
	]);
} catch (error) {
	queue.pause(); // Do not start the remaining tasks
	console.error('Queue failed:', error);
}
```

#### .onSizeLessThan(limit)

Returns a promise that resolves when `queue.size < limit`.

Await it before you add a task, to keep the queue from growing beyond a size. It counts only waiting tasks, not running tasks.

#### .clear()

Removes all waiting tasks. Running tasks continue.

The promises returned by `.add()` for the removed tasks reject with an `AbortError`, which is a `DOMException`. The removed tasks do not run, and they do not emit the [`error` event](#error).

```js
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

> [!NOTE]
> If you ignore such a promise, its rejection is not reported as unhandled. This does not apply to a promise made from it, like the one from `queue.add(fn).then(…)` or from `.addAll()`, so handle the rejection of that promise.

#### .size

The number of tasks waiting to run.

#### .sizeBy(options)

The number of waiting tasks with the given `priority`.

```js
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

#### .setPriority(id, priority)

Changes the priority of a waiting task, found by its `id`. Throws a `ReferenceError` if no waiting task has that `id`, for example because it already started. Throws a `TypeError` if `priority` is not a finite number. Tasks only wait when the queue has a `concurrency` limit, is paused, or is rate-limited.

Raise the priority to run a task earlier:

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 1});

queue.add(async () => '🦄', {priority: 1});
queue.add(async () => '🦀', {priority: 0, id: '🦀'});
queue.add(async () => '🦄', {priority: 1});
queue.add(async () => '🦄', {priority: 1});

queue.setPriority('🦀', 2);
// '🦀' runs second
```

Lower the priority to run a task later:

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 1});

queue.add(async () => '🦄', {priority: 1});
queue.add(async () => '🦀', {priority: 1, id: '🦀'});
queue.add(async () => '🦄');
queue.add(async () => '🦄', {priority: 0});

queue.setPriority('🦀', -1);
// '🦀' runs last
```

#### .pending

The number of running tasks.

#### [.timeout](#timeout)

Type: `number | undefined`

Get or set the default timeout. A change applies to tasks added after it.

```js
const queue = new PQueue({timeout: 5000});

queue.timeout = 10000;
```

#### [.concurrency](#concurrency)

#### .isPaused

Whether the queue is paused.

#### .isRateLimited

Whether the queue is rate-limited: the number of tasks started in the current interval has reached `intervalCap`, and tasks are waiting.

#### .isSaturated

Whether tasks are waiting because all concurrency slots are in use, or because the queue is rate-limited.

Useful to detect backpressure and tasks that hang.

```js
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

#### .runningTasks

An array with the running tasks. Each task has its `id`, `priority`, `startTime`, `timeout`, and `timeoutRemaining` (the milliseconds until it times out). Without a timeout, `timeout` and `timeoutRemaining` are `undefined`.

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2, timeout: 10000});

queue.add(() => fetchUser(123), {id: 'user-123'});
queue.add(() => fetchPosts(456), {id: 'posts-456', priority: 1});

console.log(queue.runningTasks);
/*
[
	{
		id: 'user-123',
		priority: 0,
		startTime: 1759253001716,
		timeout: 10000,
		timeoutRemaining: 9700
	},
	{
		id: 'posts-456',
		priority: 1,
		startTime: 1759253001916,
		timeout: 10000,
		timeoutRemaining: 9900
	}
]
*/
```

## Events

The queue is an [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget). Listen with `queue.addEventListener(event, listener)`, and stop with `queue.removeEventListener(event, listener)`. The options `{once: true}` and `{signal}` work too. The `completed` and `error` events have the result or the error in `event.detail`. If the result or the error is `undefined`, `event.detail` is `null`, because `CustomEvent` works that way.

#### active

Emitted when a task starts. Useful to track progress.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2});

let count = 0;
queue.addEventListener('active', () => {
	console.log(`Working on task #${++count}.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

queue.add(() => Promise.resolve());
queue.add(() => delay(2000));
queue.add(() => Promise.resolve());
queue.add(() => Promise.resolve());
queue.add(() => delay(500));
```

#### completed

Emitted when a task completes without error. The result is in `event.detail`.

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2});

queue.addEventListener('completed', event => {
	console.log(event.detail);
});

queue.add(() => Promise.resolve('hello, world!'));
```

#### error

Emitted when a task fails: it throws, times out, or its `signal` aborts while it runs. The error is in `event.detail`. The promise returned by `.add()` still rejects, so handle both.

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2});

queue.addEventListener('error', event => {
	console.error(event.detail);
});

// Prevent an unhandled rejection. The listener above handles the error.
queue.add(() => Promise.reject(new Error('error'))).catch(() => {});
```

#### empty

Emitted every time the queue is checked and found empty, for example when the last waiting task starts, when a task finishes and no tasks are waiting, and on `.clear()`. It can fire more than once while the queue stays empty. Tasks can still be running.

#### idle

Emitted every time the queue is empty and no tasks are running: `queue.size === 0 && queue.pending === 0`. It can also fire on a queue that never had a task, for example after `.clear()` or a change of `concurrency`.

Unlike `empty`, it waits for running tasks to finish.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue();

queue.addEventListener('idle', () => {
	console.log(`Queue is idle.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

const job1 = queue.add(() => delay(2000));
const job2 = queue.add(() => delay(500));

await job1;
await job2;
//=> 'Queue is idle.  Size: 0  Pending: 0'

await queue.add(() => delay(600));
//=> 'Queue is idle.  Size: 0  Pending: 0'
```

#### pendingZero

Emitted every time the number of running tasks becomes zero: `queue.pending === 0`.

Unlike `idle`, it is also emitted when tasks are waiting.

#### add

Emitted every time a task is added.

#### next

Emitted every time a task finishes, with or without an error. Also emitted when a waiting task is aborted, and by `.clear()`.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue();

queue.addEventListener('add', () => {
	console.log(`Task is added.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

queue.addEventListener('next', () => {
	console.log(`Task is completed.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

const job1 = queue.add(() => delay(2000));
const job2 = queue.add(() => delay(500));

await job1;
await job2;

await queue.add(() => delay(600));
//=> 'Task is added.  Size: 1  Pending: 0'
//=> 'Task is added.  Size: 1  Pending: 1'
//=> 'Task is completed.  Size: 0  Pending: 1'
//=> 'Task is completed.  Size: 0  Pending: 0'
//=> 'Task is added.  Size: 1  Pending: 0'
//=> 'Task is completed.  Size: 0  Pending: 0'
```

#### rateLimit

Emitted when the queue becomes rate-limited: `intervalCap` tasks have started in the current interval, and tasks are waiting.

Useful for backpressure, when tasks are added faster than they run.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue({
	intervalCap: 2,
	interval: 1000
});

queue.addEventListener('rateLimit', () => {
	console.log('The queue is rate-limited');
});

// The third task makes the queue rate-limited
queue.add(() => delay(100));
queue.add(() => delay(100));
queue.add(() => delay(100));
```

#### rateLimitCleared

Emitted when the queue is no longer rate-limited, because tasks can start again or no tasks are waiting.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue({
	intervalCap: 1,
	interval: 1000
});

queue.addEventListener('rateLimit', () => {
	console.log('Rate-limited: waiting for the next interval');
});

queue.addEventListener('rateLimitCleared', () => {
	console.log('The rate limit is cleared');
});

queue.add(() => delay(100));
queue.add(() => delay(100)); // This makes the queue rate-limited
```

## Advanced example

This shows the order in which things happen.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 1});

(async () => {
	await delay(200);

	console.log(`8. Pending promises: ${queue.pending}`);
	//=> '8. Pending promises: 0'

	(async () => {
		await queue.add(async () => '🐙');
		console.log('11. Resolved 🐙');
	})();

	console.log('9. Added 🐙');

	console.log(`10. Pending promises: ${queue.pending}`);
	//=> '10. Pending promises: 1'

	await queue.onIdle();
	console.log('12. All work is done');
})();

(async () => {
	await queue.add(async () => '🦄');
	console.log('5. Resolved 🦄');
})();
console.log('1. Added 🦄');

(async () => {
	await queue.add(async () => '🐴');
	console.log('6. Resolved 🐴');
})();
console.log('2. Added 🐴');

(async () => {
	await queue.onEmpty();
	console.log('7. Queue is empty');
})();

console.log(`3. Queue size: ${queue.size}`);
//=> '3. Queue size: 1'

console.log(`4. Pending promises: ${queue.pending}`);
//=> '4. Pending promises: 1'
```

```text
$ node example.js
1. Added 🦄
2. Added 🐴
3. Queue size: 1
4. Pending promises: 1
5. Resolved 🦄
6. Resolved 🐴
7. Queue is empty
8. Pending promises: 0
9. Added 🐙
10. Pending promises: 1
11. Resolved 🐙
12. All work is done
```

## Handling timeouts

Set a timeout for all tasks, and override it for one task. When a task times out, its `signal` aborts and `.add()` rejects with a `TimeoutError`. The task keeps running unless it handles its `signal`. It is a `DOMException` named `TimeoutError`, so `error.name === 'TimeoutError'` also matches the error of `AbortSignal.timeout()`.

```js
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

## Custom QueueClass

For other scheduling policies, give a class as the `queueClass` option:

```js
import PQueue from 'p-queue';

class QueueClass {
	constructor() {
		this._queue = [];
	}

	enqueue(run, options) {
		this._queue.push(run);
	}

	dequeue() {
		return this._queue.shift();
	}

	get size() {
		return this._queue.length;
	}

	filter(options) {
		return this._queue;
	}

	setPriority(id, priority) {
		// Called by `queue.setPriority()`
	}

	remove(id) {
		// Called when the `signal` of a waiting task aborts
	}
}

const queue = new PQueue({queueClass: QueueClass});
```

`p-queue` calls these methods to add, take, count, reorder, and remove tasks.

## FAQ

#### How do the `concurrency` and `intervalCap` options affect each other?

They are separate limits. `concurrency` limits how many tasks run at the same time. `intervalCap` limits how many tasks start in each interval.

#### When should I use `strict` mode for rate limiting?

Use `strict: true` when:
- An API blocks or throttles you if you go over its rate limit, even for a short time.
- You have problems with the default fixed windows, like [#126](https://github.com/sindresorhus/p-queue/issues/126).
- You must stay within the rate limit in every period of length `interval`.

Use the default fixed windows when:
- You do not have strict rate limits.
- Performance is more important than an even rate.
- You rate limit for backpressure, not because of an external API.

#### How do I implement backpressure?

Use `.onSizeLessThan()`, so that the queue does not grow without limit when tasks are added faster than they run:

```js
const queue = new PQueue();

// Wait until the queue has space
await queue.onSizeLessThan(100);
queue.add(() => someTask());
```

`.size` counts waiting tasks, and `.pending` counts running tasks. The total is `queue.size + queue.pending`.

With rate limiting, you can also use [`.onRateLimit()`](#onratelimit).

#### How do I cancel or remove a queued task?

Use [`signal`](#signal). When it aborts, a waiting task is removed and its `.add()` promise rejects. To cancel many tasks, give them the same `AbortController` signal. To remove all waiting tasks, use [`.clear()`](#clear). Their `.add()` promises reject too, but `.clear()` does not signal the running tasks.

Aborting a running task rejects its `.add()` promise and frees its concurrency slot, but does not stop the work. The task must handle `signal` itself.

Cancel one task:

```js
import PQueue from 'p-queue';

const queue = new PQueue();
const controller = new AbortController();

queue.add(({signal}) => doWork(signal), {signal: controller.signal}).catch(() => {});

controller.abort();
```

Cancel many tasks:

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2});
const controller = new AbortController();

queue.add(({signal}) => doWork(signal), {signal: controller.signal}).catch(() => {});
queue.add(({signal}) => doWork(signal), {signal: controller.signal}).catch(() => {});
queue.add(({signal}) => doWork(signal), {signal: controller.signal}).catch(() => {});

// Removes the waiting tasks and signals the running tasks. All the promises reject.
controller.abort();
```

There is no method to remove one task directly, because it would expose internals.

#### How do I get results in the order they were added?

Tasks start in priority order, but can complete in any order. Use `Promise.all()`, which keeps the order of its input:

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 4});

const urls = ['url1', 'url2', 'url3'];

const results = await Promise.all(urls.map(url => queue.add(() => fetch(url))));
// The results are in the same order as `urls`
```

If you do not need the other features of `p-queue`, use [`p-map`](https://github.com/sindresorhus/p-map), which is made for this.

#### How do I stream results in order as they complete?

Use [`pMapIterable`](https://github.com/sindresorhus/p-map#pmapiterable) from `p-map`:

```js
import {pMapIterable} from 'p-map';

for await (const result of pMapIterable(items, fetchItem, {concurrency: 4})) {
	console.log(result); // In input order
}
```

Combine it with `p-queue` when you need priorities or a shared concurrency limit:

```js
import PQueue from 'p-queue';
import {pMapIterable} from 'p-map';

const queue = new PQueue({concurrency: 4});

for await (const result of pMapIterable(
	items,
	item => queue.add(() => fetchItem(item), {priority: item.priority})
)) {
	console.log(result); // Still in input order
}
```

#### How do I debug a queue that stops running tasks?

Usually some tasks never finish, so they use all the concurrency slots. Common causes are network requests or database queries without a timeout, and files on a network drive that does not respond. Use `.runningTasks` to find the tasks that hang:

```js
// Give tasks a timeout, so they cannot hang forever
const queue = new PQueue({
	concurrency: 2,
	timeout: 30000
});

// Give tasks an ID, so you can identify them
queue.add(() => processItem(item), {id: `item-${item.id}`});

// Look for tasks that run too long
setInterval(() => {
	const now = Date.now();
	const stuckTasks = queue.runningTasks.filter(task => now - task.startTime > 20000);

	if (stuckTasks.length > 0) {
		console.error('Stuck tasks:', stuckTasks);
	}

	if (queue.isSaturated) {
		console.warn(`Queue saturated: ${queue.pending} running, ${queue.size} waiting`);
	}
}, 60000);

queue.addEventListener('error', event => {
	console.error('Task failed:', event.detail);
});
```

#### How do I test code that uses `p-queue` with Jest fake timers?

Jest fake timers do not work well with `p-queue`, because it uses `queueMicrotask` internally. A workaround:

```js
const flushPromises = () => new Promise(resolve => setImmediate(resolve));

jest.useFakeTimers();

// ... your test code ...

await jest.runAllTimersAsync();
await flushPromises();
```

## Maintainers

- [Sindre Sorhus](https://github.com/sindresorhus)
- [Richie Bendall](https://github.com/Richienb)

## Related

- [p-limit](https://github.com/sindresorhus/p-limit) - Run multiple promise-returning & async functions with limited concurrency
- [p-throttle](https://github.com/sindresorhus/p-throttle) - Throttle promise-returning & async functions
- [p-debounce](https://github.com/sindresorhus/p-debounce) - Debounce promise-returning & async functions
- [p-all](https://github.com/sindresorhus/p-all) - Run promise-returning & async functions concurrently with optional limited concurrency
- [More…](https://github.com/sindresorhus/promise-fun)
