import {test} from 'node:test';
import assert from 'node:assert/strict';
import delay from 'delay';
import pDefer from 'p-defer';
import PQueue from '../source/index.js';

test('backlog drains before interval reset - triggers rate-limit-cleared', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 1,
	});

	const events: string[] = [];
	queue.addEventListener('rateLimit', () => {
		events.push('rateLimit');
	});
	queue.addEventListener('rateLimitCleared', () => {
		events.push('rateLimitCleared');
	});

	// Add tasks to trigger rate limit
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	await delay(10);
	assert.strictEqual(queue.isRateLimited, true);
	assert.strictEqual(events[0], 'rateLimit');

	// Wait for all tasks to complete (backlog drains)
	await queue.onIdle();

	// Should have cleared due to empty queue, not interval reset
	assert.strictEqual(queue.isRateLimited, false);
	assert.strictEqual(events[1], 'rateLimitCleared');
	assert.strictEqual(queue.size, 0, 'Queue should be empty');
});

test('timeout validation in constructor', () => {
	// Invalid timeout values
	assert.throws(
		() => new PQueue({timeout: -1}),
		{message: /positive finite number/v},
	);

	assert.throws(
		() => new PQueue({timeout: Infinity}),
		{message: /positive finite number/v},
	);

	assert.throws(
		() => new PQueue({timeout: NaN}),
		{message: /positive finite number/v},
	);

	// Valid timeout
	const queue = new PQueue({timeout: 1000});
	assert.strictEqual(queue.timeout, 1000);
});

test('timeout validation in add', async () => {
	const expectedError = {
		name: 'TypeError',
		message: /Expected `timeout` to be a positive finite number/v,
	};

	const zeroTimeoutQueue = new PQueue({timeout: 10});
	await assert.rejects(
		zeroTimeoutQueue.add(async () => delay(30), {timeout: 0}),
		expectedError,
	);

	const negativeTimeoutQueue = new PQueue();
	await assert.rejects(
		negativeTimeoutQueue.add(async () => 'ignored', {timeout: -1}),
		expectedError,
	);
});

test('carryover mode with no backlog does not report limited', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		carryoverIntervalCount: true,
	});

	let hasRateLimitEventFired = false;
	queue.addEventListener('rateLimit', () => {
		hasRateLimitEventFired = true;
	});

	// Add exactly intervalCap tasks
	await Promise.all([
		queue.add(async () => delay(10)),
		queue.add(async () => delay(10)),
	]);

	// Queue is empty, should not be rate limited
	assert.strictEqual(queue.isRateLimited, false);
	assert.strictEqual(hasRateLimitEventFired, false);
});

test('priority validation in add rejects non-number values without adding the task', async () => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	let addedCount = 0;
	queue.addEventListener('add', () => {
		addedCount++;
	});

	const expectedError = {
		name: 'TypeError',
		message: /Expected `priority` to be a number/v,
	};

	let hasRun = false;
	await assert.rejects(queue.add(() => {
		hasRun = true;
	}, {priority: NaN}), expectedError);
	// @ts-expect-error Testing
	await assert.rejects(queue.add(async () => 'ignored', {priority: '1'}), expectedError);

	const invalidPriorities: unknown[] = [null, {}, 1n, true, 'high'];
	await Promise.all(invalidPriorities.map(async priority => assert.rejects(queue.add(() => 'ignored', {priority: priority as number}), expectedError)));
	await assert.rejects(queue.addAll([() => 'ignored'], {priority: NaN}), expectedError);

	assert.equal(queue.size, 0);
	assert.equal(addedCount, 0);

	queue.start();
	await queue.onIdle();
	assert.equal(hasRun, false);

	assert.equal(await queue.add(async () => '🦄', {priority: Infinity}), '🦄');
	assert.equal(await queue.add(async () => '🦄', {priority: -Infinity}), '🦄');
	assert.equal(await queue.add(async () => '🦄', {priority: undefined}), '🦄');
});

test('timeout up to the maximum timer delay is accepted, and a larger one is rejected instead of timing out at once', async () => {
	const maximumDelay = 2_147_483_647;
	const expectedError = {
		name: 'TypeError',
		message: /Expected `timeout` to be a positive finite number up to 2147483647/v,
	};

	assert.throws(() => {
		new PQueue({timeout: maximumDelay + 1}); // eslint-disable-line no-new
	}, expectedError);

	const queue = new PQueue();
	let addedCount = 0;
	queue.addEventListener('add', () => {
		addedCount++;
	});

	await assert.rejects(queue.add(async () => 'ignored', {timeout: maximumDelay + 1}), expectedError);
	await assert.rejects(queue.add(async () => 'ignored', {timeout: Number.MAX_SAFE_INTEGER}), expectedError);

	assert.throws(() => {
		queue.timeout = maximumDelay + 1;
	}, expectedError);
	assert.equal(queue.timeout, undefined);
	assert.equal(addedCount, 0);
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);

	// A valid timeout or no timeout for the task still works.
	assert.equal(await queue.add(async () => '🦄', {timeout: 1000}), '🦄');
	assert.equal(await queue.add(async () => '🐴', {timeout: undefined}), '🐴');

	// The maximum still works for a task, with the `timeout` setter, and in the constructor, and the task does not time out.
	let runningTimeout: number | undefined;
	assert.equal(await queue.add(async () => {
		runningTimeout = queue.runningTasks[0]?.timeout;
		await delay(10);
		return '🦄';
	}, {timeout: maximumDelay}), '🦄');
	assert.equal(runningTimeout, maximumDelay);

	queue.timeout = maximumDelay;
	assert.equal(await queue.add(async () => {
		await delay(10);
		return '🐴';
	}), '🐴');

	const maximumQueue = new PQueue({timeout: maximumDelay});
	assert.equal(await maximumQueue.add(async () => {
		await delay(10);
		return '🦄';
	}), '🦄');
});

test('interval above the maximum timer delay is rejected instead of resetting every 1 ms', async t => {
	t.assert.throws(() => {
		new PQueue({interval: 2_147_483_648, intervalCap: 1}); // eslint-disable-line no-new
	}, {name: 'TypeError', message: /Expected `interval` to be at most 2147483647 with an `intervalCap`/v});

	t.assert.throws(() => {
		new PQueue({interval: 2_147_483_648, intervalCap: 1, strict: true}); // eslint-disable-line no-new
	}, {name: 'TypeError', message: /Expected `interval` to be at most 2147483647 with an `intervalCap`/v});

	// The maximum still rate-limits.
	const run = async (isStrict: boolean) => {
		const queue = new PQueue({interval: 2_147_483_647, intervalCap: 1, strict: isStrict});
		// Also when an assertion fails, because the timer for the window end would keep the process alive for 24.8 days.
		t.after(() => {
			queue.clear();
		});

		let startedCount = 0;
		const task = () => {
			startedCount++;
		};

		queue.add(task);
		queue.add(task);
		queue.add(task);

		await delay(20);
		return {startedCount, isRateLimited: queue.isRateLimited};
	};

	const expected = {startedCount: 1, isRateLimited: true};
	t.assert.deepStrictEqual(await run(false), expected);
	t.assert.deepStrictEqual(await run(true), expected);
});

test('a rejected `NaN` priority does not change the order of the other tasks', async () => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order: string[] = [];
	const task = (name: string) => () => {
		order.push(name);
	};

	// A `NaN` in the queue would make the later insertions put `2` before `3`.
	queue.add(task('3'), {priority: 3});
	queue.add(task('1'), {priority: 1});
	await assert.rejects(queue.add(task('invalid'), {priority: NaN}), TypeError);
	queue.add(task('5'), {priority: 5});
	queue.add(task('4'), {priority: 4});
	queue.add(task('2'), {priority: 2});

	queue.start();
	await queue.onIdle();

	assert.deepEqual(order, ['5', '4', '3', '2', '1']);
});

test('setPriority validates input, and a rejected priority keeps the order', async () => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order: string[] = [];
	const task = (name: string) => () => {
		order.push(name);
	};

	queue.add(task('first'), {id: 'first', priority: Infinity});
	queue.add(task('second'), {id: 'second'});
	queue.add(task('third'), {id: 'third'});

	// Invalid ID
	assert.throws(
		() => {
			queue.setPriority('non-existent', 5);
		},
		{message: /No promise function with the id "non-existent" exists in the queue/v},
	);

	const expectedError = {
		name: 'TypeError',
		message: /Expected `priority` to be a finite number/v,
	};

	const assertRejected = (id: string, priority: unknown) => {
		assert.throws(() => {
			queue.setPriority(id, priority as number);
		}, expectedError);
	};

	assertRejected('second', NaN);
	assertRejected('second', Infinity);
	assertRejected('second', -Infinity);
	assertRejected('second', '1');
	assertRejected('second', undefined);

	// Also for a task that already has the `Infinity` priority.
	assertRejected('first', Infinity);

	// Valid update
	queue.setPriority('third', 10);

	queue.start();
	await queue.onIdle();

	assert.deepEqual(order, ['first', 'third', 'second']);
});

test('setPriority with the current priority still throws for a running task', async () => {
	const queue = new PQueue({concurrency: 1});
	const {promise, resolve} = pDefer();

	const running = queue.add(async () => promise, {id: 'running', priority: 1});

	assert.throws(() => {
		queue.setPriority('running', 1);
	}, ReferenceError);

	resolve();
	await running;
});

test('a rejected concurrency value keeps the previous limit', async () => {
	const queue = new PQueue({concurrency: 1});
	const deferreds = [pDefer(), pDefer()];
	const tasks = deferreds.map(async ({promise}) => queue.add(async () => promise));

	const assertRejected = (concurrency: unknown) => {
		assert.throws(() => {
			queue.concurrency = concurrency as number;
		}, {name: 'TypeError', message: /Expected `concurrency` to be an integer from 1 and up or `Infinity`/v});
	};

	assertRejected(NaN);
	assertRejected(0);
	assertRejected(-1);
	assertRejected(-Infinity);
	assertRejected(2.5);
	assertRejected('2');
	assertRejected(undefined);

	assert.equal(queue.concurrency, 1);
	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 1);

	queue.concurrency = Number.MAX_SAFE_INTEGER;
	assert.equal(queue.pending, 2);
	assert.equal(queue.size, 0);

	queue.concurrency = Infinity;
	assert.equal(queue.concurrency, Infinity);

	for (const {resolve} of deferreds) {
		resolve();
	}

	await Promise.all(tasks);
});

test('intervalCap and concurrency accept large integers and `Infinity`, and reject other values', () => {
	// `Number.MAX_VALUE` is an integer, and the published versions accepted it as a large limit.
	const values = [1, 10, Number.MAX_SAFE_INTEGER, 2 ** 53, Number.MAX_VALUE, Infinity];
	assert.deepEqual(values.map(value => new PQueue({concurrency: value, intervalCap: value, interval: 1000}).concurrency), values);

	const assertRejected = (value: unknown) => {
		assert.throws(() => {
			new PQueue({concurrency: value as number}); // eslint-disable-line no-new
		}, {name: 'TypeError', message: /Expected `concurrency`/v});

		assert.throws(() => {
			new PQueue({intervalCap: value as number, interval: 1000}); // eslint-disable-line no-new
		}, {name: 'TypeError', message: /Expected `intervalCap`/v});
	};

	assertRejected(1.5);
	assertRejected(0);
	assertRejected(-Infinity);
	assertRejected(NaN);
	assertRejected('2');
	assertRejected(null);
});

test('interval above the maximum timer delay is accepted when rate limiting is off', async () => {
	const queue = new PQueue({interval: 2_147_483_648});
	assert.equal(await queue.add(async () => '🦄'), '🦄');
});

test('interval must be a finite number from 0 and up', () => {
	const assertRejected = (interval: unknown) => {
		assert.throws(() => {
			new PQueue({interval: interval as number}); // eslint-disable-line no-new
		}, {name: 'TypeError', message: /Expected `interval` to be a finite number >= 0/v});
	};

	assertRejected(-1);
	assertRejected(null);
	assertRejected(Infinity);
	assertRejected(NaN);

	new PQueue({interval: 0}); // eslint-disable-line no-new
	new PQueue({interval: 10}); // eslint-disable-line no-new
});

test('setting an invalid `timeout` on the queue throws and keeps the previous value', async () => {
	const queue = new PQueue({timeout: 1000});

	const assertRejected = (timeout: unknown) => {
		assert.throws(() => {
			queue.timeout = timeout as number;
		}, {name: 'TypeError', message: /Expected `timeout` to be a positive finite number/v});
	};

	assertRejected(0);
	assertRejected(-1);
	assertRejected(NaN);
	assertRejected(Infinity);
	assertRejected(2_147_483_648);
	assertRejected('1000');

	assert.equal(queue.timeout, 1000);
	assert.equal(await queue.add(() => '🦄'), '🦄');

	queue.timeout = 2000;
	assert.equal(queue.timeout, 2000);

	queue.timeout = undefined;
	assert.equal(queue.timeout, undefined);
	assert.equal(await queue.add(() => '🦄'), '🦄');
});

test('constructor options that are `undefined` use their defaults', async () => {
	const queue = new PQueue({
		concurrency: undefined,
		intervalCap: undefined,
		interval: undefined,
		autoStart: undefined,
		queueClass: undefined,
		strict: undefined,
		carryoverIntervalCount: undefined,
		timeout: undefined,
	});

	assert.equal(queue.concurrency, Infinity);
	assert.equal(queue.timeout, undefined);
	assert.equal(queue.isPaused, false);

	const results = await Promise.all([
		queue.add(() => 'low', {priority: -1}),
		queue.add(() => 'high', {priority: 1}),
	]);
	assert.deepEqual(results, ['low', 'high']);
	assert.equal(queue.isRateLimited, false);

	// Forwarding optional settings, which is the common case.
	const createQueue = (options: {concurrency?: number; interval?: number; intervalCap?: number} = {}) => new PQueue({
		concurrency: options.concurrency,
		interval: options.interval,
		intervalCap: options.intervalCap,
	});
	assert.equal(createQueue().concurrency, Infinity);
	assert.equal(createQueue({concurrency: 2}).concurrency, 2);
});
