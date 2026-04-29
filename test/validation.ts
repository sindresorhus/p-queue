import {test} from 'node:test';
import assert from 'node:assert';
import delay from 'delay';
import PQueue from '../source/index.js';

test('backlog drains before interval reset - triggers rate-limit-cleared', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 1,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	// Add tasks to trigger rate limit
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	await delay(10);
	assert.equal(queue.isRateLimited, true);
	assert.equal(events[0], 'rateLimit');

	// Wait for all tasks to complete (backlog drains)
	await queue.onIdle();

	// Should have cleared due to empty queue, not interval reset
	assert.equal(queue.isRateLimited, false);
	assert.equal(events[1], 'rateLimitCleared');
	assert.equal(queue.size, 0, 'Queue should be empty');
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
		{message: /No promise function with the id "non-existent" exists in the queue/},
	);

	// Valid update
	queue.setPriority('task2', 10);

	await queue.onIdle();
});

test('timeout validation in constructor', () => {
	// Invalid timeout values
	assert.throws(
		() => new PQueue({timeout: -1}),
		{message: /positive finite number/},
	);

	assert.throws(
		() => new PQueue({timeout: Number.POSITIVE_INFINITY}),
		{message: /positive finite number/},
	);

	assert.throws(
		() => new PQueue({timeout: Number.NaN}),
		{message: /positive finite number/},
	);

	// Valid timeout
	const queue = new PQueue({timeout: 1000});
	assert.equal(queue.timeout, 1000);
});

test('abort before start frees concurrency immediately', async () => {
	const queue = new PQueue({concurrency: 1});

	const controller = new AbortController();
	controller.abort();

	// First task is aborted before start
	await assert.rejects(queue.add(async () => 'ignored', {signal: controller.signal}));

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

	let rateLimitEventFired = false;
	queue.on('rateLimit', () => {
		rateLimitEventFired = true;
	});

	// Add exactly intervalCap tasks
	await Promise.all([
		queue.add(async () => delay(10)),
		queue.add(async () => delay(10)),
	]);

	// Queue is empty, should not be rate limited
	assert.equal(queue.isRateLimited, false);
	assert.equal(rateLimitEventFired, false);
});

test('clear() triggers immediate state drop while rate-limited', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	// Add tasks to trigger rate limit
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	await delay(10);
	assert.equal(queue.isRateLimited, true);

	// Clear the queue
	queue.clear();

	// Should immediately clear rate limit
	await delay(10);
	assert.equal(queue.isRateLimited, false);
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
