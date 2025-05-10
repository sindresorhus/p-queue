# p-queue

> Promise queue with concurrency control

Useful for rate-limiting async (or sync) operations. For example, when interacting with a REST API or when doing CPU/memory intensive tasks.

For servers, you probably want a Redis-backed [job queue](https://github.com/sindresorhus/awesome-nodejs#job-queues) instead.

Note that the project is feature complete. We are happy to review pull requests, but we don't plan any further development. We are also not answering email support questions.

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

## Install

```sh
npm install p-queue
```

**Warning:** This package is native [ESM](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) and no longer provides a CommonJS export. If your project uses CommonJS, you'll have to [convert to ESM](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c). Please don't open issues for questions regarding CommonJS / ESM.

## Usage

Here we run only one promise at the time. For example, set `concurrency` to 4 to run four promises at the same time.

```js
import PQueue from 'p-queue';
import got from 'got';

const queue = new PQueue({concurrency: 1});

(async () => {
	await queue.add(() => got('https://sindresorhus.com'));
	console.log('Done: sindresorhus.com');
})();

(async () => {
	await queue.add(() => got('https://avajs.dev'));
	console.log('Done: avajs.dev');
})();
```

## API

### PQueue(options?)

Returns a new `queue` instance, which is an [`EventEmitter3`](https://github.com/primus/eventemitter3) subclass.

#### options

Type: `object`

##### concurrency

Type: `number`\
Default: `Infinity`\
Minimum: `1`

Concurrency limit.

##### timeout

Type: `number`

Per-operation timeout in milliseconds. Operations fulfill once `timeout` elapses if they haven't already.

##### throwOnTimeout

Type: `boolean`\
Default: `false`

Whether or not a timeout is considered an exception.

##### autoStart

Type: `boolean`\
Default: `true`

Whether queue tasks within concurrency limit, are auto-executed as soon as they're added.

##### queueClass

Type: `Function`

Class with a `enqueue` and `dequeue` method, and a `size` getter. See the [Custom QueueClass](#custom-queueclass) section.

##### intervalCap

Type: `number`\
Default: `Infinity`\
Minimum: `1`

The max number of runs in the given interval of time.

##### interval

Type: `number`\
Default: `0`\
Minimum: `0`

The length of time in milliseconds before the interval count resets. Must be finite.

##### carryoverConcurrencyCount

Type: `boolean`\
Default: `false`

If `true`, specifies that any [pending](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) Promises, should be carried over into the next interval and counted against the `intervalCap`. If `false`, any of those pending Promises will not count towards the next `intervalCap`.

### queue

`PQueue` instance.

#### .add(fn, options?)

Adds a sync or async task to the queue.

Returns a promise with the return value of `fn`.

Note: If your items can potentially throw an exception, you must handle those errors from the returned Promise or they may be reported as an unhandled Promise rejection and potentially cause your process to exit immediately.

##### fn

Type: `Function`

Promise-returning/async function. When executed, it will receive `{signal}` as the first argument.

#### options

Type: `object`

##### priority

Type: `number`\
Default: `0`

Priority of operation. Operations with greater priority will be scheduled first.

##### id

Type `string`

Unique identifier for the promise function, used to update its priority before execution. If not specified, it is auto-assigned an incrementing BigInt starting from `1n`.

##### signal

[`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) for cancellation of the operation. When aborted, it will be removed from the queue and the `queue.add()` call will reject with an [error](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/reason). If the operation is already running, the signal will need to be handled by the operation itself.

```js
import PQueue from 'p-queue';
import got, {CancelError} from 'got';

const queue = new PQueue();

const controller = new AbortController();

try {
	await queue.add(({signal}) => {
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

Same as `.add()`, but accepts an array of sync or async functions and returns a promise that resolves when all functions are resolved.

#### .pause()

Put queue execution on hold.

#### .start()

Start (or resume) executing enqueued tasks within concurrency limit. No need to call this if queue is not paused (via `options.autoStart = false` or by `.pause()` method.)

Returns `this` (the instance).

#### .onEmpty()

Returns a promise that settles when the queue becomes empty.

Can be called multiple times. Useful if you for example add additional items at a later time.

#### .onIdle()

Returns a promise that settles when the queue becomes empty, and all promises have completed; `queue.size === 0 && queue.pending === 0`.

The difference with `.onEmpty` is that `.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet.

#### .onSizeLessThan(limit)

Returns a promise that settles when the queue size is less than the given limit: `queue.size < limit`.

If you want to avoid having the queue grow beyond a certain size you can `await queue.onSizeLessThan()` before adding a new item.

Note that this only limits the number of items waiting to start. There could still be up to `concurrency` jobs already running that this call does not include in its calculation.

#### .clear()

Clear the queue.

#### .size

Size of the queue, the number of queued items waiting to run.

#### .sizeBy(options)

Size of the queue, filtered by the given options.

For example, this can be used to find the number of items remaining in the queue with a specific priority level.

```js
import PQueue from 'p-queue';

const queue = new PQueue();

queue.add(async () => '🦄', {priority: 1});
queue.add(async () => '🦄', {priority: 0});
queue.add(async () => '🦄', {priority: 1});

console.log(queue.sizeBy({priority: 1}));
//=> 2

console.log(queue.sizeBy({priority: 0}));
//=> 1
```

#### .setPriority(id, priority)

Updates the priority of a promise function by its id, affecting its execution order. Requires a defined concurrency limit to take effect.

For example, this can be used to prioritize a promise function to run earlier.

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 1});

queue.add(async () => '🦄', {priority: 1});
queue.add(async () => '🦀', {priority: 0, id: '🦀'});
queue.add(async () => '🦄', {priority: 1});
queue.add(async () => '🦄', {priority: 1});

queue.setPriority('🦀', 2);
```

In this case, the promise function with `id: '🦀'` runs second.

You can also deprioritize a promise function to delay its execution:

```js
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 1});

queue.add(async () => '🦄', {priority: 1});
queue.add(async () => '🦀', {priority: 1, id: '🦀'});
queue.add(async () => '🦄');
queue.add(async () => '🦄', {priority: 0});

queue.setPriority('🦀', -1);
```

Here, the promise function with `id: '🦀'` executes last.

#### .pending

Number of running items (no longer in the queue).

#### [.timeout](#timeout)

#### [.concurrency](#concurrency)

#### .isPaused

Whether the queue is currently paused.

## Events

#### active

Emitted as each item is processed in the queue for the purpose of tracking progress.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2});

let count = 0;
queue.on('active', () => {
	console.log(`Working on item #${++count}.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

queue.add(() => Promise.resolve());
queue.add(() => delay(2000));
queue.add(() => Promise.resolve());
queue.add(() => Promise.resolve());
queue.add(() => delay(500));
```

#### completed

Emitted when an item completes without error.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2});

queue.on('completed', result => {
	console.log(result);
});

queue.add(() => Promise.resolve('hello, world!'));
```

#### error

Emitted if an item throws an error.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue({concurrency: 2});

queue.on('error', error => {
	console.error(error);
});

queue.add(() => Promise.reject(new Error('error')));
```

#### empty

Emitted every time the queue becomes empty.

Useful if you for example add additional items at a later time.

#### idle

Emitted every time the queue becomes empty and all promises have completed; `queue.size === 0 && queue.pending === 0`.

The difference with `empty` is that `idle` guarantees that all work from the queue has finished. `empty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue();

queue.on('idle', () => {
	console.log(`Queue is idle.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

const job1 = queue.add(() => delay(2000));
const job2 = queue.add(() => delay(500));

await job1;
await job2;
// => 'Queue is idle.  Size: 0  Pending: 0'

await queue.add(() => delay(600));
// => 'Queue is idle.  Size: 0  Pending: 0'
```

The `idle` event is emitted every time the queue reaches an idle state. On the other hand, the promise the `onIdle()` function returns resolves once the queue becomes idle instead of every time the queue is idle.

#### add

Emitted every time the add method is called and the number of pending or queued tasks is increased.

#### next

Emitted every time a task is completed and the number of pending or queued tasks is decreased. This is emitted regardless of whether the task completed normally or with an error.

```js
import delay from 'delay';
import PQueue from 'p-queue';

const queue = new PQueue();

queue.on('add', () => {
	console.log(`Task is added.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

queue.on('next', () => {
	console.log(`Task is completed.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

const job1 = queue.add(() => delay(2000));
const job2 = queue.add(() => delay(500));

await job1;
await job2;
//=> 'Task is added.  Size: 0  Pending: 1'
//=> 'Task is added.  Size: 0  Pending: 2'

await queue.add(() => delay(600));
//=> 'Task is completed.  Size: 0  Pending: 1'
//=> 'Task is completed.  Size: 0  Pending: 0'
```

## Advanced example

A more advanced example to help you understand the flow.

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
		console.log('11. Resolved')
	})();

	console.log('9. Added 🐙');

	console.log(`10. Pending promises: ${queue.pending}`);
	//=> '10. Pending promises: 1'

	await queue.onIdle();
	console.log('12. All work is done');
})();

(async () => {
	await queue.add(async () => '🦄');
	console.log('5. Resolved')
})();
console.log('1. Added 🦄');

(async () => {
	await queue.add(async () => '🐴');
	console.log('6. Resolved')
})();
console.log('2. Added 🐴');

(async () => {
	await queue.onEmpty();
	console.log('7. Queue is empty');
})();

console.log(`3. Queue size: ${queue.size}`);
//=> '3. Queue size: 1`

console.log(`4. Pending promises: ${queue.pending}`);
//=> '4. Pending promises: 1'
```

```
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

## Custom QueueClass

For implementing more complex scheduling policies, you can provide a QueueClass in the options:

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
}

const queue = new PQueue({queueClass: QueueClass});
```

`p-queue` will call corresponding methods to put and get operations from this queue.

## FAQ

#### How do the `concurrency` and `intervalCap` options affect each other?

They are just different constraints. The `concurrency` option limits how many things run at the same time. The `intervalCap` option limits how many things run in total during the interval (over time).

## Maintainers

- [Sindre Sorhus](https://github.com/sindresorhus)
- [Richie Bendall](https://github.com/Richienb)

## Related

- [p-limit](https://github.com/sindresorhus/p-limit) - Run multiple promise-returning & async functions with limited concurrency
- [p-throttle](https://github.com/sindresorhus/p-throttle) - Throttle promise-returning & async functions
- [p-debounce](https://github.com/sindresorhus/p-debounce) - Debounce promise-returning & async functions
- [p-all](https://github.com/sindresorhus/p-all) - Run promise-returning & async functions concurrently with optional limited concurrency
- [More…](https://github.com/sindresorhus/promise-fun)
