import {test} from 'node:test';
import assert from 'node:assert/strict';
import delay from 'delay';
import pDefer from 'p-defer';
import PQueue from '../source/index.js';

test('rate-limit rapid pause/start cycles', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
		autoStart: false,
	});

	const results: number[] = [];
	const promises: Array<Promise<number>> = [];

	// Add tasks
	for (let i = 0; i < 4; i++) {
		promises.push(queue.add(async () => {
			results.push(i);
			return i;
		}));
	}

	// Rapid start/pause cycles
	const startPauseCycles = async () => {
		for (let cycle = 0; cycle < 3; cycle++) {
			queue.start();
			// eslint-disable-next-line no-await-in-loop
			await delay(25); // Let one task run
			queue.pause();
			// eslint-disable-next-line no-await-in-loop
			await delay(50); // Pause during interval
		}
	};

	await startPauseCycles();

	// Finally let everything run
	queue.start();
	await Promise.all(promises);

	// All tasks should complete despite rapid state changes
	assert.strictEqual(results.length, 4);
});

test('rate-limit preserves the interval count for re-entrant task additions', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
	});

	const starts: number[] = [];
	const addTask = (index: number): void => {
		queue.add(() => {
			starts.push(index);

			if (index < 4) {
				addTask(index + 1);
			}
		});
	};

	addTask(0);
	assert.deepStrictEqual(starts, [0, 1]);

	await queue.onIdle();
	assert.deepStrictEqual(starts, [0, 1, 2, 3, 4]);
});

test('rate-limit preserves the interval count for re-entrant active listeners', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
	});

	const starts: number[] = [];
	let nextTask = 0;
	queue.addEventListener('active', () => {
		if (nextTask >= 5) {
			return;
		}

		const taskIndex = nextTask++;
		queue.add(() => {
			starts.push(taskIndex);
		});
	});

	queue.add(() => {
		starts.push(-1);
	});
	assert.strictEqual(starts.length, 2);

	await queue.onIdle();
	assert.strictEqual(starts.length, 6);
});

test('rate-limit edge case with zero-interval', async () => {
	// Zero interval should effectively disable rate limiting
	const queue = new PQueue({
		interval: 0,
		intervalCap: 1,
	});

	const startTime = Date.now();
	await Promise.all([
		queue.add(async () => delay(10)),
		queue.add(async () => delay(10)),
		queue.add(async () => delay(10)),
	]);
	const elapsed = Date.now() - startTime;

	// Should run concurrently, not rate-limited
	assert.ok(elapsed < 50, 'Tasks should run without rate limiting');
});

test('rate-limit state consistency with sync microtask scheduling', async () => {
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

	// Schedule multiple tasks synchronously
	const promises = [];
	for (let i = 0; i < 3; i++) {
		promises.push(queue.add(async () => {
			// Immediate microtask
			await Promise.resolve();
			return i;
		}));
	}

	// Events should be consistent
	await delay(10);
	assert.strictEqual(queue.isRateLimited, true);
	assert.strictEqual(events[0], 'rateLimit');

	await Promise.all(promises);
	assert.strictEqual(queue.isRateLimited, false);
	assert.ok(events.includes('rateLimitCleared'));
});

test('rate-limit with queue manipulation during rate-limit event', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	let hasManipulated = false;

	queue.addEventListener('rateLimit', () => {
		if (hasManipulated) {
			return;
		}

		hasManipulated = true;
		// Try to manipulate queue during event
		queue.add(async () => 'extra');
		queue.pause();
		queue.start();
	});

	// Add tasks to trigger rate limit
	const results = await Promise.all([
		queue.add(async () => {
			await delay(10);
			return 1;
		}),
		queue.add(async () => {
			await delay(10);
			return 2;
		}),
		queue.add(async () => {
			await delay(10);
			return 3;
		}),
	]);

	// Queue should remain stable despite manipulation
	assert.ok(results.includes(1));
	assert.ok(results.includes(2));
	assert.ok(results.includes(3));
});

test('onRateLimit() with microtask race condition', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	const promises = [];
	let hasRateLimitBeenCalled = false;

	// Race: onRateLimit vs task completion
	promises.push(queue.add(async () => {
		await delay(10);
		return 'first';
	}));

	for (const promise of [queue.add(async () => 'second')]) {
		promises.push(promise);
	}

	// Try to attach listener after tasks are queued
	await Promise.resolve(); // Microtask delay
	const rateLimitPromise = (async () => {
		await queue.onRateLimit();
		hasRateLimitBeenCalled = true;
	})();

	await Promise.all([...promises, rateLimitPromise]);
	assert.ok(hasRateLimitBeenCalled, 'onRateLimit should handle late attachment');
});

test('onRateLimitCleared() with microtask race condition', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	// Trigger rate limit
	queue.add(async () => delay(10));
	queue.add(async () => delay(10));

	await delay(20); // Let rate limit trigger

	// Wait for clear using the promise API
	const clearedPromise = queue.onRateLimitCleared();

	// Wait for clear
	await queue.onIdle();
	await delay(110); // Past interval

	// The promise should resolve when rate limit is cleared
	await clearedPromise;
	assert.strictEqual(queue.isRateLimited, false, 'onRateLimitCleared should handle attachment during rate limit');
});

test('onRateLimit() called during state transition', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	const sequence: string[] = [];

	queue.add(async () => {
		sequence.push('task1-start');
		await delay(10);
		sequence.push('task1-end');
	});

	const secondTask = queue.add(async () => {
		sequence.push('task2');
	});

	// Wait for rate limit to be triggered
	await queue.onRateLimit();
	sequence.push('rate-limit');

	// Wait for second task to complete
	await secondTask;

	await queue.onIdle();

	// Verify sequence order
	assert.strictEqual(sequence[0], 'task1-start');
	assert.ok(sequence.includes('rate-limit'));
});

test('onRateLimit/onRateLimitCleared rapid transitions', async () => {
	const queue = new PQueue({
		interval: 50,
		intervalCap: 1,
	});

	const events: string[] = [];

	queue.addEventListener('rateLimit', () => {
		events.push('limited');
	});
	queue.addEventListener('rateLimitCleared', () => {
		events.push('cleared');
	});

	// Create rapid transitions
	const createTransitions = async () => {
		for (let i = 0; i < 3; i++) {
			queue.add(async () => delay(10));
			queue.add(async () => delay(10));
			// eslint-disable-next-line no-await-in-loop
			await delay(60); // Wait for interval reset
			// eslint-disable-next-line no-await-in-loop
			await queue.onIdle();
		}
	};

	await createTransitions();

	// Should have alternating events
	assert.ok(events.length >= 3, 'Should have multiple rate limit events');
	assert.ok(events.includes('limited'));
	assert.ok(events.includes('cleared'));
});

test('onRateLimit() resolves when rate limit is triggered', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	// Add tasks to eventually trigger rate limit
	queue.add(async () => delay(10));

	let hasRateLimitResolved = false;
	const rateLimitPromise = (async () => {
		await queue.onRateLimit();
		hasRateLimitResolved = true;
	})();

	// Add another task which will trigger rate limit
	queue.add(async () => delay(10));

	// Give time for rate limit to be triggered
	await delay(20);

	// OnRateLimit should have resolved since we hit rate limit
	assert.ok(hasRateLimitResolved, 'onRateLimit should resolve when rate limit is triggered');

	// Clean up
	await queue.onIdle();
});

test('rate-limit does not reset the count when it resumes at the window boundary', async t => {
	const startTime = 1_000_000;
	t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: startTime});

	const queue = new PQueue({
		concurrency: 1,
		interval: 100,
		intervalCap: 2,
	});

	const startTimes: number[] = [];
	const task = async () => {
		startTimes.push(Date.now() - startTime);
	};

	queue.add(task);
	queue.add(task);
	await queue.onIdle();

	// The window is full, so this task waits for the window boundary.
	t.mock.timers.tick(7);
	const task3 = queue.add(task);
	t.mock.timers.tick(93);
	await task3;

	// Only one of these tasks fits in the rest of the window.
	t.mock.timers.tick(50);
	queue.add(task);
	queue.add(task);
	await new Promise(resolve => {
		setImmediate(resolve);
	});

	t.assert.deepStrictEqual(startTimes, [0, 0, 100, 150]);

	t.mock.timers.tick(50);
	await queue.onIdle();
	t.assert.deepStrictEqual(startTimes, [0, 0, 100, 150, 200]);
});

test('rate-limit does not reset the count when a completion starts the next window before the resume timeout fires', async t => {
	const startTime = 1_000_000;
	t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: startTime});

	const queue = new PQueue({
		concurrency: 1,
		interval: 100,
		intervalCap: 1,
	});

	const startTimes: number[] = [];
	const flush = async () => new Promise(resolve => {
		setImmediate(resolve);
	});

	const task1 = pDefer();
	const task2 = pDefer();
	const task = (promise?: Promise<void>) => async () => {
		startTimes.push(Date.now() - startTime);
		await promise;
	};

	queue.add(task(task1.promise));
	queue.add(task(task2.promise));

	// Tick to the window boundary first, because the mocked `Date.now()` in a timer callback returns the end time of the whole tick.
	t.mock.timers.tick(100);
	t.mock.timers.tick(50);
	task1.resolve();
	await flush();

	// The window is full, so these tasks wait for the resume timeout at the window boundary.
	t.mock.timers.tick(10);
	queue.add(task());
	queue.add(task());

	// The second task finishes after the boundary but before the resume timeout fires, so it starts the next window.
	t.mock.timers.setTime(startTime + 201);
	task2.resolve();
	await flush();
	t.mock.timers.tick(0);
	await flush();

	t.assert.deepStrictEqual(startTimes, [0, 150, 201]);

	t.mock.timers.tick(100);
	await queue.onIdle();
	t.assert.deepStrictEqual(startTimes, [0, 150, 201, 301]);
});
