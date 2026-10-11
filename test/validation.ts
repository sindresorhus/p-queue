import {test} from 'node:test';
import assert from 'node:assert/strict';
import delay from 'delay';
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

test('setPriority validates input', async () => {
	const queue = new PQueue({concurrency: 1});

	// Add tasks
	queue.add(async () => delay(100), {id: 'task1'});
	queue.add(async () => delay(100), {id: 'task2'});

	// Invalid ID
	assert.throws(
		() => {
			queue.setPriority('non-existent', 5);
		},
		{message: /No promise function with the id "non-existent" exists in the queue/v},
	);

	// Valid update
	queue.setPriority('task2', 10);

	await queue.onIdle();
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

test('abort before start frees concurrency immediately', async () => {
	const queue = new PQueue({concurrency: 1});

	const controller = new AbortController();
	controller.abort();

	// First task is aborted before start
	await assert.rejects(
		queue.add(async () => 'ignored', {signal: controller.signal}),
		{name: 'AbortError'},
	);

	const started: number[] = [];
	await queue.add(async () => {
		started.push(1);
	});

	assert.deepStrictEqual(started, [1]);
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

test('clear() triggers immediate state drop while rate-limited', async () => {
	const queue = new PQueue({
		interval: 100,
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

	// Clear the queue
	queue.clear();

	// Should immediately clear rate limit
	await delay(10);
	assert.strictEqual(queue.isRateLimited, false);
	assert.ok(events.includes('rateLimitCleared'));
});

test('abort before start rolls back interval count', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 1,
	});

	const controller = new AbortController();

	// Add a task but abort before it starts
	controller.abort();

	await assert.rejects(
		queue.add(async () => 'test', {signal: controller.signal}),
		{name: 'AbortError'},
	);

	// Interval count should be 0 since task never started
	// Add a normal task to verify interval counting works
	await queue.add(async () => delay(10));

	// Should be able to add another task immediately in next interval
	await delay(1050);
	const start = Date.now();
	await queue.add(async () => delay(10));
	const elapsed = Date.now() - start;

	// Should not have waited for another interval
	assert.ok(elapsed < 100, 'Task should start immediately in new interval');
});

test('priority validation in add', async () => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
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
	assert.equal(queue.size, 0);

	queue.start();
	await queue.onIdle();
	assert.equal(hasRun, false);

	assert.equal(await queue.add(async () => '🦄', {priority: Infinity}), '🦄');
	assert.equal(await queue.add(async () => '🦄', {priority: -Infinity}), '🦄');
	assert.equal(await queue.add(async () => '🦄', {priority: undefined}), '🦄');
});

test('fractional concurrency and intervalCap are rejected', () => {
	assert.throws(() => {
		new PQueue({concurrency: 1.5}); // eslint-disable-line no-new
	}, {name: 'TypeError', message: /Expected `concurrency` to be an integer from 1 and up or `Infinity`/v});

	assert.throws(() => {
		(new PQueue()).concurrency = 2.5;
	}, {name: 'TypeError', message: /Expected `concurrency` to be an integer from 1 and up or `Infinity`/v});

	assert.throws(() => {
		new PQueue({intervalCap: 1.5, interval: 1000}); // eslint-disable-line no-new
	}, {name: 'TypeError', message: /Expected `intervalCap` to be an integer from 1 and up or `Infinity`/v});
});

test('a rejected fractional concurrency keeps the previous limit', async () => {
	const queue = new PQueue({concurrency: 1});
	assert.throws(() => {
		queue.concurrency = 1.5;
	}, TypeError);

	let maximumRunning = 0;
	await Promise.all(Array.from({length: 3}, async () => queue.add(async () => {
		maximumRunning = Math.max(maximumRunning, queue.pending);
		await delay(5);
	})));

	assert.equal(maximumRunning, 1);
});

test('timeout above the maximum timer delay is rejected instead of timing out at once', async () => {
	const maximumDelay = 2_147_483_647;
	const expectedError = {
		name: 'TypeError',
		message: /Expected `timeout` to be a positive finite number up to 2147483647/v,
	};

	assert.throws(() => {
		new PQueue({timeout: maximumDelay + 1}); // eslint-disable-line no-new
	}, expectedError);

	const queue = new PQueue();
	await assert.rejects(queue.add(async () => '🦄', {timeout: Number.MAX_SAFE_INTEGER}), expectedError);

	// The maximum still works, and the task does not time out.
	const maximumQueue = new PQueue({timeout: maximumDelay});
	assert.equal(await maximumQueue.add(async () => {
		await delay(20);
		return '🦄';
	}), '🦄');
});

test('interval above the maximum timer delay is rejected instead of resetting every 1 ms', async () => {
	assert.throws(() => {
		new PQueue({interval: 2_147_483_648, intervalCap: 1}); // eslint-disable-line no-new
	}, {name: 'TypeError', message: /Expected `interval` to be at most 2147483647 with an `intervalCap`/v});

	// The maximum still rate-limits.
	const queue = new PQueue({interval: 2_147_483_647, intervalCap: 1});
	let startedCount = 0;
	const task = () => {
		startedCount++;
	};

	queue.add(task);
	queue.add(task);
	queue.add(task);

	await delay(20);
	assert.equal(startedCount, 1);
	queue.clear();
});
