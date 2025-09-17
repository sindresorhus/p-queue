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
	const queue = new PQueue({timeout: 200, throwOnTimeout: true});

	await assert.rejects(queue.add(async () => {
		await delay(400);
	}));

	await queue.add(async () => {
		await delay(400);
	}, {throwOnTimeout: false});

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

test('interval with carryoverConcurrencyCount after queue empty', async () => {
	const queue = new PQueue({
		intervalCap: 1,
		interval: 100,
		carryoverConcurrencyCount: true,
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
		carryoverConcurrencyCount: true,
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
