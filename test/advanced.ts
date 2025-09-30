import {test} from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'eventemitter3';
import delay from 'delay';
import pDefer from 'p-defer';
import PQueue from '../source/index.js';

test('clear interval on pause', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	queue.add(() => {
		queue.pause();
	});

	queue.add(() => 'task #1');

	await delay(300);

	assert.equal(queue.size, 1);
});

test('should be an event emitter', () => {
	const queue = new PQueue();
	assert.ok(queue instanceof EventEmitter);
});

test('should emit active event per item', async () => {
	const items = [0, 1, 2, 3, 4];
	const queue = new PQueue();

	let eventCount = 0;
	queue.on('active', () => {
		eventCount++;
	});

	for (const item of items) {
		queue.add(() => item);
	}

	await queue.onIdle();

	assert.equal(eventCount, items.length);
});

test('should emit idle event when idle', async () => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('idle', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));
	const job2 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 1);
	assert.equal(timesCalled, 0);

	await job1;

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 0);

	await job2;

	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 1);

	const job3 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 1);

	await job3;
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 2);
});

test('should emit empty event when empty', async () => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('empty', () => {
		timesCalled++;
	});

	const {resolve: resolveJob1, promise: job1Promise} = pDefer();
	const {resolve: resolveJob2, promise: job2Promise} = pDefer();

	const job1 = queue.add(async () => job1Promise);
	const job2 = queue.add(async () => job2Promise);
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 1);
	assert.equal(timesCalled, 0);

	resolveJob1();
	await job1;

	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 1);
	assert.equal(timesCalled, 0);

	resolveJob2();
	await job2;

	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);
	assert.equal(timesCalled, 1);
});

test('should emit add event when adding task', async () => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('add', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 1);

	const job2 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 1);
	assert.equal(timesCalled, 2);

	await job1;

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 2);

	await job2;

	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 2);

	const job3 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 3);

	await job3;
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 3);
});

test('should emit next event when completing task', async () => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('next', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 0);

	const job2 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 1);
	assert.equal(timesCalled, 0);

	await job1;

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 1);

	await job2;

	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 2);

	const job3 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 2);

	await job3;
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
	assert.equal(timesCalled, 3);
});

test('should emit completed / error events', async () => {
	const queue = new PQueue({concurrency: 1});

	let errorEvents = 0;
	let completedEvents = 0;
	queue.on('error', () => {
		errorEvents++;
	});
	queue.on('completed', () => {
		completedEvents++;
	});

	const job1 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(errorEvents, 0);
	assert.equal(completedEvents, 0);

	const job2 = queue.add(async () => {
		await delay(1);
		throw new Error('failure');
	});

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 1);
	assert.equal(errorEvents, 0);
	assert.equal(completedEvents, 0);

	await job1;

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(errorEvents, 0);
	assert.equal(completedEvents, 1);

	await assert.rejects(job2);

	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
	assert.equal(errorEvents, 1);
	assert.equal(completedEvents, 1);

	const job3 = queue.add(async () => delay(100));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(errorEvents, 1);
	assert.equal(completedEvents, 1);

	await job3;
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
	assert.equal(errorEvents, 1);
	assert.equal(completedEvents, 2);
});

test('should verify timeout overrides passed to add', async () => {
	const queue = new PQueue({timeout: 200});

	await assert.rejects(queue.add(async () => {
		await delay(400);
	}));

	await queue.add(async () => {
		await delay(400);
	}, {timeout: 600});

	await queue.add(async () => {
		await delay(100);
	});

	await assert.rejects(queue.add(async () => {
		await delay(100);
	}, {timeout: 50}));

	await queue.onIdle();
});

test('should skip an aborted job', async () => {
	const queue = new PQueue();
	const controller = new AbortController();

	controller.abort();
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	await assert.rejects(queue.add(() => {}, {signal: controller.signal}));
});

test('should pass AbortSignal instance to job', async () => {
	const queue = new PQueue();
	const controller = new AbortController();

	await queue.add(async ({signal}) => {
		assert.equal(controller.signal, signal!);
	}, {signal: controller.signal});
});

test('aborted jobs do not use interval cap', async () => {
	const queue = new PQueue({
		concurrency: 1,
		interval: 100,
		intervalCap: 1,
	});

	const controller = new AbortController();

	for (let index = 0; index < 5; index++) {
		// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-empty-function
		queue.add(() => {}, {signal: controller.signal}).catch(() => {});
	}

	queue.add(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function

	controller.abort();
	await delay(150);
	assert.equal(queue.size, 0);
});

test('aborting multiple jobs at the same time', async () => {
	const queue = new PQueue({concurrency: 1});

	const controller1 = new AbortController();
	const controller2 = new AbortController();

	const task1 = queue.add(async () => new Promise(() => {}), {signal: controller1.signal}); // eslint-disable-line @typescript-eslint/no-empty-function
	const task2 = queue.add(async () => new Promise(() => {}), {signal: controller2.signal}); // eslint-disable-line @typescript-eslint/no-empty-function

	setTimeout(() => {
		controller1.abort();
		controller2.abort();
	}, 0);

	await assert.rejects(task1);
	await assert.rejects(task2);
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);
});

test('pending promises counted fast enough', async () => {
	const queue = new PQueue({autoStart: false, concurrency: 2});

	let hasThirdRun = false;

	queue.add(async () => delay(1000));
	queue.add(async () => delay(1000));
	queue.add(async () => {
		hasThirdRun = true;
	});

	queue.start();

	await delay(100);

	assert.ok(!hasThirdRun);
});

test('pending promises with abortions counted fast enough', async () => {
	const queue = new PQueue({autoStart: false, concurrency: 2});

	const controller = new AbortController();

	let hasThirdRun = false;

	queue.add(async () => delay(1000));
	queue.add(async () => delay(1000));
	const abortedPromise = queue.add(async () => delay(1000), {signal: controller.signal});
	queue.add(async () => {
		hasThirdRun = true;
	});

	controller.abort();
	queue.start();

	await delay(100);

	assert.ok(!hasThirdRun);
	await assert.rejects(abortedPromise);

	await delay(100);

	assert.ok(hasThirdRun);
});

test('intervalCap', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	let hasThirdRun = false;

	queue.add(async () => '🧜‍♂️');
	queue.add(async () => '🧜‍♂️');
	queue.add(async () => {
		hasThirdRun = true;
	});

	await delay(100);

	assert.ok(!hasThirdRun);

	await delay(1500);

	assert.ok(hasThirdRun);
});

test('consumed interval is remembered between idle states', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	await queue.add(async () => '🧜‍♂️');

	await delay(300);

	let hasThirdRun = false;

	queue.add(async () => {
		await delay(200);
		return '🧜‍♂️';
	});
	queue.add(async () => {
		hasThirdRun = true;
	});

	await delay(50);

	assert.ok(!hasThirdRun);

	await delay(1500);

	assert.ok(hasThirdRun);
});

test('consumed interval is updated on time, even between idle states', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	await queue.addAll([
		async () => {
			await delay(500);
			return '🧜‍♂️';
		},
		async () => {
			await delay(500);
			return '🧜‍♂️';
		},
	]);

	await delay(600);

	let hasThirdRun = false;

	queue.add(async () => {
		hasThirdRun = true;
	});

	await delay(50);

	assert.ok(hasThirdRun);
});

test('.setPriority() - execute a promise before planned', async () => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.setPriority('🐢', 1);
	await queue.onIdle();
	assert.deepEqual(result, ['🐌', '🐢', '🦆']);
});

test('interval should be maintained when using await between adds (issue #182)', async () => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
	});

	const timestamps: number[] = [];

	// Add first 3 tasks without await
	queue.add(() => {
		timestamps.push(Date.now());
		return 'task1';
	});
	queue.add(() => {
		timestamps.push(Date.now());
		return 'task2';
	});
	queue.add(() => {
		timestamps.push(Date.now());
		return 'task3';
	});

	// Add task 4 with await
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task4';
	});

	// Add task 5 with await - this should still respect interval
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task5';
	});

	// Add task 6 with await
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task6';
	});

	// Check intervals between tasks
	for (let index = 1; index < timestamps.length; index++) {
		const interval = timestamps[index] - timestamps[index - 1];
		// Allow 10ms tolerance for timing
		assert.ok(interval >= 90, `Interval between task ${index} and ${index + 1} was ${interval}ms, expected >= 90ms`);
	}
});

test('interval maintained when queue becomes empty multiple times', async () => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
	});

	const timestamps: number[] = [];

	// First batch
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task1';
	});
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task2';
	});

	// Queue is empty, wait a bit
	await delay(50);

	// Second batch - should still respect interval from task 2
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task3';
	});
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task4';
	});

	// Check all intervals
	for (let index = 1; index < timestamps.length; index++) {
		const interval = timestamps[index] - timestamps[index - 1];
		assert.ok(interval >= 90, `Interval between task ${index} and ${index + 1} was ${interval}ms, expected >= 90ms`);
	}
});

test('interval reset after long idle period', async () => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
	});

	const timestamps: number[] = [];

	// Run first task
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task1';
	});

	// Wait much longer than interval
	await delay(250);

	// This task should run immediately since enough time has passed
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task2';
	});

	// But this one should wait for interval
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task3';
	});

	const interval1to2 = timestamps[1] - timestamps[0];
	const interval2to3 = timestamps[2] - timestamps[1];

	assert.ok(interval1to2 >= 240, `Task 2 ran after ${interval1to2}ms, expected >= 240ms`);
	assert.ok(interval2to3 >= 90, `Task 3 should respect interval: ${interval2to3}ms`);
});

test('interval with carryoverIntervalCount after queue empty', async () => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
		carryoverIntervalCount: true,
	});

	const timestamps: number[] = [];

	// Run first task
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task1';
	});

	// Queue becomes empty
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);

	// Add new task - should respect interval
	await queue.add(() => {
		timestamps.push(Date.now());
		return 'task2';
	});

	const interval = timestamps[1] - timestamps[0];
	assert.ok(interval >= 90, `Interval was ${interval}ms, expected >= 90ms`);
});

test('.setPriority() - execute a promise after planned', async () => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.setPriority('🐢', -1);
	await queue.onIdle();
	assert.deepEqual(result, ['🐌', '🦆', '🦆', '🦆', '🦆', '🐢']);
});

test('.setPriority() - execute a promise before planned - concurrency 2', async () => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.add(async () => {
		await delay(400);
		result.push('⚡️');
	}, {id: '⚡️'});
	queue.setPriority('⚡️', 1);
	await queue.onIdle();
	assert.deepEqual(result, ['🐌', '🦆', '⚡️', '🐢']);
});

test('.setPriority() - execute a promise before planned - concurrency 3', async () => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 3});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.add(async () => {
		await delay(400);
		result.push('⚡️');
	}, {id: '⚡️'});
	queue.add(async () => {
		await delay(400);
		result.push('🦀');
	}, {id: '🦀'});
	queue.setPriority('🦀', 1);
	await queue.onIdle();
	assert.deepEqual(result, ['🐌', '🦆', '🐢', '🦀', '⚡️']);
});

test('.setPriority() - execute a multiple promise before planned, with variable priority', async () => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}, {id: '🐌'});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	}, {id: '🦆'});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	}, {id: '🐢'});
	queue.add(async () => {
		await delay(400);
		result.push('⚡️');
	}, {id: '⚡️'});
	queue.add(async () => {
		await delay(400);
		result.push('🦀');
	}, {id: '🦀'});
	queue.setPriority('⚡️', 1);
	queue.setPriority('🦀', 2);
	await queue.onIdle();
	assert.deepEqual(result, ['🐌', '🦆', '🦀', '⚡️', '🐢']);
});

test('.setPriority() - execute a promise before planned - concurrency 3 and unspecified `id`', async () => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 3});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	});
	queue.add(async () => {
		await delay(400);
		result.push('🦆');
	});
	queue.add(async () => {
		await delay(400);
		result.push('🐢');
	});
	queue.add(async () => {
		await delay(400);
		result.push('⚡️');
	});
	queue.add(async () => {
		await delay(400);
		result.push('🦀');
	});
	queue.setPriority('5', 1);
	await queue.onIdle();
	assert.deepEqual(result, ['🐌', '🦆', '🐢', '🦀', '⚡️']);
});

test('process exits cleanly after interval tasks complete', async () => {
	const queue = new PQueue({
		concurrency: 100,
		intervalCap: 500,
		interval: 60 * 1000,
	});

	// Execute tasks that complete quickly with long interval
	const tasks = [];
	for (let index = 0; index < 4; index++) {
		tasks.push(queue.add(() => `result-${index}`));
	}

	await Promise.all(tasks);
	await queue.onIdle();

	// Test that no timers are hanging by checking process can exit naturally
	// This ensures both intervalId and timeoutId are cleared when idle
	assert.ok(true);
});

test('intervalCap should be respected with high concurrency (issue #126)', async () => {
	const queue = new PQueue({
		concurrency: 5000,
		intervalCap: 1000,
		interval: 1000,
		carryoverIntervalCount: true,
	});

	const results: number[] = [];
	const startTime = Date.now();

	// Add 5000 tasks that complete immediately
	const promises = [];
	for (let index = 0; index < 5000; index++) {
		promises.push(queue.add(async () => {
			results.push(Date.now() - startTime);
		}));
	}

	await Promise.all(promises);

	// Check that no more than intervalCap tasks started in the first interval
	const firstInterval = results.filter(timestamp => timestamp < 1000);
	assert.ok(firstInterval.length <= 1000, `Expected ≤1000 tasks in first interval, got ${firstInterval.length}`);

	// Check that tasks actually completed (basic sanity check)
	assert.equal(results.length, 5000, 'All tasks should complete');
});

test('isRateLimited property', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	// Initially not rate limited
	assert.equal(queue.isRateLimited, false);

	// Add 2 tasks to hit the cap
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	// Should be rate limited after 2 tasks start
	await delay(10);
	assert.equal(queue.isRateLimited, false); // No tasks in queue yet

	// Add a third task that will be queued
	queue.add(async () => delay(50));
	await delay(10);
	assert.equal(queue.isRateLimited, true); // Now rate limited with queued task

	// Wait for interval to reset
	await delay(1100);
	assert.equal(queue.isRateLimited, false);
});

test('rate-limit event emission', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	// Add tasks to trigger rate limiting
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50)); // This one should cause rate limiting

	await delay(100);
	assert.deepEqual(events, ['rateLimit']);

	// Wait for interval to reset
	await delay(1100);
	assert.deepEqual(events, ['rateLimit', 'rateLimitCleared']);
});

test('onRateLimit() promise helper', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 1,
	});

	// Should resolve immediately when already rate limited
	queue.add(async () => delay(50));
	queue.add(async () => delay(50)); // Queued, causing rate limit
	await delay(10);

	const startTime = Date.now();
	await queue.onRateLimit();
	const elapsed = Date.now() - startTime;
	assert.ok(elapsed < 50, 'Should resolve immediately when already rate limited');

	// Should wait when not rate limited
	const newQueue = new PQueue({
		interval: 1000,
		intervalCap: 1,
	});

	const rateLimitPromise = newQueue.onRateLimit();
	newQueue.add(async () => delay(50));
	newQueue.add(async () => delay(50)); // This should trigger rate limit

	await rateLimitPromise; // Should resolve when rate limit is hit
});

test('onRateLimitCleared() promise helper', async () => {
	const queue = new PQueue({
		interval: 500,
		intervalCap: 1,
	});

	// Should resolve immediately when not rate limited
	const startTime = Date.now();
	await queue.onRateLimitCleared();
	const elapsed = Date.now() - startTime;
	assert.ok(elapsed < 50, 'Should resolve immediately when not rate limited');

	// Should wait when rate limited
	queue.add(async () => delay(50));
	queue.add(async () => delay(50)); // Queued, causing rate limit
	await delay(10);

	const clearPromise = queue.onRateLimitCleared();
	await clearPromise; // Should resolve when rate limit clears after interval
});

test('rate-limit works with pause/start', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 1,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	queue.add(async () => delay(50));
	queue.add(async () => delay(50)); // Queued
	await delay(10);

	// Should be rate limited
	assert.equal(queue.isRateLimited, true);
	assert.deepEqual(events, ['rateLimit']);

	// Pause queue - should still be rate limited
	queue.pause();
	assert.equal(queue.isRateLimited, true);
	assert.equal(queue.isPaused, true);

	// Wait for interval to reset
	await delay(1100);
	assert.equal(queue.isRateLimited, false); // Rate limit cleared even when paused
	assert.equal(queue.isPaused, true);
	assert.deepEqual(events, ['rateLimit', 'rateLimitCleared']);

	queue.start();
	await queue.onIdle();
});

test('rate-limit with high concurrency', async () => {
	const queue = new PQueue({
		concurrency: 10,
		interval: 500,
		intervalCap: 3,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	// Add many tasks quickly
	for (let index = 0; index < 10; index++) {
		queue.add(async () => delay(50));
	}

	await delay(100);
	assert.ok(events.length > 0);
	assert.equal(events[0], 'rateLimit');

	// Wait for all tasks to complete and rate limit to clear
	await queue.onIdle();
	// Should have multiple rate-limit events (one per interval) and one rate-limit-cleared at the end
	assert.ok(events.length >= 2);
	assert.equal(events.at(-1), 'rateLimitCleared');
});

test('rate-limit with queue.clear() while rate-limited', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 1,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	await delay(10);
	assert.equal(queue.isRateLimited, true);
	assert.equal(events.length, 1);
	assert.equal(events[0], 'rateLimit');

	// Clear the queue while rate-limited
	queue.clear();

	// Should no longer be rate-limited since queue is empty
	assert.equal(queue.isRateLimited, false);
	assert.equal(queue.size, 0);

	// Should emit rate-limit-cleared since we transitioned
	assert.equal(events.length, 2);
	assert.equal(events[1], 'rateLimitCleared');

	await queue.onIdle();
});

test('rate-limit events fire only once per transition', async () => {
	const queue = new PQueue({
		interval: 500,
		intervalCap: 2,
	});

	const events: string[] = [];
	let rateLimitCount = 0;
	let clearCount = 0;

	queue.on('rateLimit', () => {
		rateLimitCount++;
		events.push(`rate-limit-${rateLimitCount}`);
	});

	queue.on('rateLimitCleared', () => {
		clearCount++;
		events.push(`cleared-${clearCount}`);
	});

	// Add tasks to trigger rate limit
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	await delay(100);
	// Should have exactly one rate-limit event
	assert.equal(rateLimitCount, 1);

	await queue.onIdle();
	// Should have exactly one clear event
	assert.equal(clearCount, 1);
});

test('rate-limit with interval boundary conditions', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));

	// Add exactly intervalCap tasks
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	await delay(10);
	// Should not be rate-limited with exactly intervalCap tasks
	assert.equal(queue.isRateLimited, false);
	assert.equal(events.length, 0);

	// Add one more to exceed cap
	queue.add(async () => delay(50));

	await delay(10);
	// Now should be rate-limited
	assert.equal(queue.isRateLimited, true);
	assert.equal(events.length, 1);

	await queue.onIdle();
});

test('should not cause stack overflow with many aborted tasks', async () => {
	const queue = new PQueue({concurrency: 1});
	const controller = new AbortController();

	// Add many tasks exactly like in issue #217
	const taskCount = 10_000;
	const promises: Array<Promise<any>> = [];

	for (let index = 0; index < taskCount; index++) {
		// eslint-disable-next-line promise/prefer-await-to-then
		const promise = queue.add(() => 1 + 1, {signal: controller.signal}).catch(() => {
			// Expected abort error
		});

		promises.push(promise);
	}

	// Abort all tasks immediately
	controller.abort();

	// This should not cause a stack overflow
	await Promise.all(promises);

	// Verify queue state
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);
});

test('rate-limit with carryoverIntervalCount behavior', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
		carryoverIntervalCount: true,
		concurrency: 2, // Allow 2 concurrent tasks
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	// Add enough tasks to exceed intervalCap and have items in queue
	queue.add(async () => delay(100)); // Long task to ensure queue builds up
	queue.add(async () => delay(100)); // Long task to ensure queue builds up
	queue.add(async () => delay(50)); // This should be queued
	queue.add(async () => delay(50)); // This should be queued

	await delay(10);
	// Should be rate-limited because intervalCount >= intervalCap (2) and queue.size > 0
	assert.equal(queue.isRateLimited, true);
	assert.equal(events.length, 1);
	assert.equal(events[0], 'rateLimit');

	// Wait for all tasks to complete
	await queue.onIdle();

	// Should have rate-limit-cleared event
	assert.equal(queue.isRateLimited, false);
	assert.equal(events.length, 2);
	assert.equal(events[1], 'rateLimitCleared');
});

test('rate-limit with aborted tasks', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	const controller = new AbortController();

	// Add tasks - some will be aborted
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-empty-function
	queue.add(async () => delay(50), {signal: controller.signal}).catch(() => {}); // Will be aborted
	// eslint-disable-next-line promise/prefer-await-to-then, @typescript-eslint/no-empty-function
	queue.add(async () => delay(50), {signal: controller.signal}).catch(() => {}); // Will be aborted
	queue.add(async () => delay(50)); // Normal task

	await delay(10);
	// Should be rate-limited due to queue size > 0 and intervalCount >= intervalCap
	assert.equal(queue.isRateLimited, true);
	assert.equal(events.length, 1);
	assert.equal(events[0], 'rateLimit');

	// Abort some tasks
	controller.abort();

	// Rate-limit state should still be accurate despite aborted tasks
	await delay(10);
	assert.equal(queue.isRateLimited, true); // Still rate-limited due to remaining task

	// Wait for all tasks to complete
	await queue.onIdle();

	// Should properly transition to not rate-limited
	assert.equal(queue.isRateLimited, false);
	assert.equal(events.length, 2);
	assert.equal(events[1], 'rateLimitCleared');
});

test('rate-limit with error-throwing tasks', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	const events: string[] = [];
	const errors: any[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));
	queue.on('error', error => errors.push(error));

	// Add tasks - some will throw errors
	queue.add(async () => delay(50));

	// Add error task and handle it
	const errorTask = (async () => {
		try {
			await queue.add(async () => {
				await delay(50);
				throw new Error('Task failed');
			});
		} catch {
			// Expected error - ignore
		}
	})();

	queue.add(async () => delay(50)); // This should still execute despite previous error

	await delay(10);
	// Should be rate-limited
	assert.equal(queue.isRateLimited, true);
	assert.equal(events.length, 1);
	assert.equal(events[0], 'rateLimit');

	// Wait for all tasks to complete (including error ones)
	await Promise.all([queue.onIdle(), errorTask]);

	// Should have received error event
	assert.equal(errors.length, 1);
	assert.equal(errors[0].message, 'Task failed');

	// Rate-limit state should still be accurate despite task errors
	assert.equal(queue.isRateLimited, false);
	assert.equal(events.length, 2);
	assert.equal(events[1], 'rateLimitCleared');
});

test('rate-limit state remains stable within intervals', async () => {
	const queue = new PQueue({
		interval: 200, // Shorter interval for faster test
		intervalCap: 2,
		concurrency: 2,
	});

	const stateChanges: boolean[] = [];
	let previousState = queue.isRateLimited;

	// Monitor state changes
	const monitorState = () => {
		const currentState = queue.isRateLimited;
		if (currentState !== previousState) {
			stateChanges.push(currentState);
			previousState = currentState;
		}
	};

	// Add tasks rapidly to trigger rate limiting
	for (let index = 0; index < 8; index++) {
		queue.add(async () => {
			await delay(5);
			monitorState(); // Check state during task execution
		});
		monitorState(); // Check state after adding task
	}

	// Monitor state frequently during execution
	const interval = setInterval(monitorState, 2);

	await queue.onIdle();
	clearInterval(interval);

	// Before our fix, this would have been 8+ rapid changes (true/false/true/false...)
	// With our fix, should be at most 3 logical transitions (false -> true -> false)
	assert.ok(stateChanges.length <= 3, `Too many state changes (flickering): ${stateChanges.length}, changes: ${JSON.stringify(stateChanges)}`);

	// Should have been rate-limited at some point
	assert.ok(stateChanges.includes(true), 'Should have been rate-limited');

	// Should end in non-rate-limited state
	assert.equal(queue.isRateLimited, false);
});

test('rate-limit microtask batching - multiple events in same tick', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('cleared'));

	// Add multiple tasks in rapid succession
	queue.add(async () => delay(10));
	queue.add(async () => delay(10));
	queue.add(async () => delay(10));
	queue.add(async () => delay(10));

	// Let microtask queue flush
	await delay(0);

	// Should trigger rate limit once despite multiple adds
	assert.equal(queue.isRateLimited, true);
	assert.equal(events.filter(event => event === 'rateLimit').length, 1, 'Should only emit rate-limit once');

	await queue.onIdle();
});

test('rate-limit clear() racing with scheduled update', async () => {
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

	// Clear immediately (before microtask fires)
	queue.clear();

	// State should be cleared immediately
	assert.equal(queue.isRateLimited, false, 'Should not be rate-limited immediately after clear');
	assert.equal(queue.size, 0, 'Queue should be empty after clear');

	// Add new task immediately after clear
	queue.add(async () => delay(10));

	await queue.onIdle();

	// Should have handled the race condition gracefully
	assert.ok(events.filter(event => event === 'rateLimit').length <= 1, 'Should not have duplicate rate-limit events');
});

test('rate-limit with dynamic concurrency changes', async () => {
	const queue = new PQueue({
		concurrency: 1,
		interval: 500,
		intervalCap: 2,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	// Add tasks
	for (let i = 0; i < 5; i++) {
		queue.add(async () => delay(50));
	}

	await delay(150); // Let first two tasks start
	assert.equal(queue.isRateLimited, true, 'Should be rate-limited with intervalCap=2');

	// Increase concurrency while rate-limited
	queue.concurrency = 5;

	// Should still respect interval cap despite higher concurrency
	assert.equal(queue.isRateLimited, true, 'Should still be rate-limited after concurrency increase');

	// Wait for all tasks to complete
	await queue.onIdle();
	assert.equal(queue.isRateLimited, false);
	assert.ok(events.includes('rateLimit'), 'Should have emitted rate-limit event');
});

test('rate-limit with setPriority() while rate-limited', async () => {
	const queue = new PQueue({
		concurrency: 1,
		interval: 500,
		intervalCap: 1,
	});

	const results: string[] = [];
	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	// Add tasks with different priorities and IDs
	queue.add(async () => {
		results.push('first');
		return delay(10);
	});

	queue.add(async () => {
		results.push('low');
		return delay(10);
	}, {priority: 0, id: 'low'});

	queue.add(async () => {
		results.push('high');
		return delay(10);
	}, {priority: 1, id: 'high'});

	queue.add(async () => {
		results.push('medium');
		return delay(10);
	}, {priority: 0.5, id: 'medium'});

	await delay(50); // Let first task start
	assert.equal(queue.isRateLimited, true);

	// Change priority of queued task while rate-limited
	queue.setPriority('low', 2);

	// Rate limit state should remain stable
	assert.equal(queue.isRateLimited, true, 'Should remain rate-limited after priority change');

	await queue.onIdle();

	// First task executes first, then tasks by priority order
	assert.equal(results[0], 'first');
	assert.equal(results[1], 'low', 'Low task with elevated priority should run second');
	assert.equal(results[2], 'high');
	assert.equal(results[3], 'medium');
});

test('rate-limit multiple concurrent onRateLimit() calls', async () => {
	const queue = new PQueue({
		interval: 500,
		intervalCap: 1,
	});

	// Create multiple concurrent waiters before rate limit
	const promises = [
		queue.onRateLimit(),
		queue.onRateLimit(),
		queue.onRateLimit(),
	];

	// Trigger rate limit
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	// All promises should resolve when rate limited
	const results = await Promise.allSettled(promises);
	assert.ok(results.every(r => r.status === 'fulfilled'), 'All promises should resolve');
	assert.equal(queue.isRateLimited, true);

	await queue.onIdle();
});

test('rate-limit when all queued tasks are aborted', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 1,
	});

	const events: string[] = [];
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	const controller = new AbortController();

	// Add one running task
	queue.add(async () => delay(50));

	// Add abortable queued tasks
	const abortable1 = queue.add(async () => delay(50), {signal: controller.signal});
	const abortable2 = queue.add(async () => delay(50), {signal: controller.signal});

	await delay(10);
	assert.equal(queue.isRateLimited, true);
	assert.equal(events[0], 'rateLimit');

	// Abort all queued tasks
	controller.abort();

	await Promise.allSettled([abortable1, abortable2]);
	await delay(10);

	// Should clear rate limit when queue becomes empty due to aborts
	assert.equal(queue.isRateLimited, false);
	assert.equal(events[1], 'rateLimitCleared');

	await queue.onIdle();
});

