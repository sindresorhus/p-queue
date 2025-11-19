import {test} from 'node:test';
import assert from 'node:assert/strict';
import delay from 'delay';
import PQueue from '../source/index.js';

const assertSlidingWindow = (executionTimes: number[], interval: number, intervalCap: number, jitterMilliseconds = Math.min(25, Math.trunc(interval * 0.2))) => {
	const minimumInterval = Math.max(0, interval - jitterMilliseconds);

	for (let index = intervalCap; index < executionTimes.length; index++) {
		const delta = executionTimes[index] - executionTimes[index - intervalCap];
		assert.ok(delta >= minimumInterval, `Task ${index} violated sliding window: ${delta}ms < ${minimumInterval}ms`);
	}
};

test('strict mode enforces sliding window rate limiting', async () => {
	const queue = new PQueue({
		interval: 1000,
		intervalCap: 2,
		strict: true,
	});

	const executionTimes: number[] = [];

	// Add 6 tasks
	const promises = [];
	for (let i = 0; i < 6; i++) {
		promises.push(queue.add(async () => {
			executionTimes.push(Date.now());
		}));
	}

	await Promise.all(promises);

	// Verify sliding window constraint: no more than 2 tasks in any 1000ms window
	assertSlidingWindow(executionTimes, 1000, 2);
});

test('strict mode vs fixed window timing', async () => {
	// Test that strict mode and fixed window behave differently
	const interval = 500;
	const intervalCap = 2;

	// Fixed window
	const fixedQueue = new PQueue({
		interval,
		intervalCap,
		strict: false,
	});

	const fixedTimes: number[] = [];
	for (let i = 0; i < 4; i++) {
		fixedQueue.add(async () => {
			fixedTimes.push(Date.now());
		});
	}

	await fixedQueue.onIdle();

	// Strict mode
	const strictQueue = new PQueue({
		interval,
		intervalCap,
		strict: true,
	});

	const strictTimes: number[] = [];
	for (let i = 0; i < 4; i++) {
		strictQueue.add(async () => {
			strictTimes.push(Date.now());
		});
	}

	await strictQueue.onIdle();

	// Both should execute all tasks
	assert.equal(fixedTimes.length, 4);
	assert.equal(strictTimes.length, 4);

	// Verify strict mode respects sliding window
	const strictStart = strictTimes[0];
	const strictRelative = strictTimes.map(t => t - strictStart);

	// In strict mode with intervalCap=2, interval=500:
	// - Tasks 0,1 execute immediately
	// - Task 2 must wait for oldest to age out (500ms)
	// - Task 3 must wait another interval
	assert.ok(strictRelative[0] < 50, 'Task 0 should execute immediately');
	assert.ok(strictRelative[1] < 50, 'Task 1 should execute immediately');
	assert.ok(strictRelative[2] >= 450 && strictRelative[2] < 650, 'Task 2 should wait ~500ms');
	assert.ok(strictRelative[3] >= 450 && strictRelative[3] < 650, 'Task 3 should wait ~500ms');
});

test('strict mode with large intervalCap', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 10,
		strict: true,
	});

	const executionTimes: number[] = [];

	// Add 30 tasks
	const promises = [];
	for (let i = 0; i < 30; i++) {
		promises.push(queue.add(async () => {
			executionTimes.push(Date.now());
		}));
	}

	await Promise.all(promises);

	// Verify no more than 10 tasks in any 100ms window
	assertSlidingWindow(executionTimes, 100, 10);
});

test('strict mode clear() preserves ticks', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	// Add and execute 2 tasks
	await queue.add(async () => undefined);
	await queue.add(async () => undefined);

	// Clear should preserve strict ticks
	queue.clear();

	// Should still be rate limited by the previous ticks
	const executionTimes: number[] = [];
	const startTime = Date.now();

	await queue.add(async () => {
		executionTimes.push(Date.now() - startTime);
	});
	await queue.add(async () => {
		executionTimes.push(Date.now() - startTime);
	});

	// Both should wait for the sliding window to free up
	assert.ok(executionTimes[0] >= 80 && executionTimes[0] < 200, 'First task after clear should be rate limited');
	assert.ok(executionTimes[1] >= 80 && executionTimes[1] < 200, 'Second task after clear should be rate limited');
});

test('strict mode with concurrency limit', async () => {
	const queue = new PQueue({
		concurrency: 1,
		interval: 100,
		intervalCap: 3,
		strict: true,
	});

	const executionTimes: number[] = [];

	// Add 6 tasks
	const promises = [];
	for (let i = 0; i < 6; i++) {
		promises.push(queue.add(async () => {
			executionTimes.push(Date.now());
			await delay(10);
		}));
	}

	await Promise.all(promises);

	// Should respect both concurrency and strict interval limits
	assert.equal(executionTimes.length, 6);

	// Verify sliding window
	assertSlidingWindow(executionTimes, 100, 3);
});

test('strict mode rate limit events', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	const events: string[] = [];

	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

	// Add 4 tasks
	const promises = [];
	for (let i = 0; i < 4; i++) {
		promises.push(queue.add(async () => delay(10)));
	}

	await Promise.all(promises);

	// Should have been rate limited and then cleared
	assert.ok(events.includes('rateLimit'), 'Should emit rateLimit event');
	assert.ok(events.includes('rateLimitCleared'), 'Should emit rateLimitCleared event');
});

test('strict mode isRateLimited property', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	assert.equal(queue.isRateLimited, false, 'Should not be rate limited initially');

	// Add 3 tasks to trigger rate limiting
	queue.add(async () => undefined);
	queue.add(async () => undefined);
	queue.add(async () => undefined);

	await delay(10);

	assert.equal(queue.isRateLimited, true, 'Should be rate limited after exceeding cap');

	await queue.onIdle();

	assert.equal(queue.isRateLimited, false, 'Should not be rate limited after queue is idle');
});

test('strict mode with pause/start', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
		autoStart: false,
	});

	const executionTimes: number[] = [];

	// Add tasks while paused
	for (let i = 0; i < 4; i++) {
		queue.add(async () => {
			executionTimes.push(Date.now());
		});
	}

	await delay(50);

	// Should not have executed yet
	assert.equal(executionTimes.length, 0);

	// Start the queue
	const startTime = Date.now();
	queue.start();

	await queue.onIdle();

	// All tasks should have executed
	assert.equal(executionTimes.length, 4);

	// Verify sliding window
	const relativeTimes = executionTimes.map(t => t - startTime);
	assert.ok(relativeTimes[0] < 50, 'First two tasks should execute immediately');
	assert.ok(relativeTimes[1] < 50);
	assert.ok(relativeTimes[2] >= 80, 'Third task should wait for window');
	assert.ok(relativeTimes[3] >= 80, 'Fourth task should wait for window');
});

test('strict mode throws error with interval=0', () => {
	assert.throws(
		() => new PQueue({
			interval: 0,
			intervalCap: 5,
			strict: true,
		}),
		{
			name: 'TypeError',
			message: 'The `strict` option requires a non-zero `interval`',
		},
	);
});

test('strict mode with priority', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	const results: number[] = [];

	// Add tasks with different priorities
	const promises = [
		queue.add(async () => results.push(1), {priority: 0}),
		queue.add(async () => results.push(2), {priority: 0}),
		queue.add(async () => results.push(3), {priority: 1}), // Higher priority
		queue.add(async () => results.push(4), {priority: 0}),
	];

	await Promise.all(promises);

	// Higher priority task should execute before lower priority ones
	// First 2 execute immediately, then task 3 (high priority) should execute before task 4
	assert.equal(results.length, 4);
	assert.ok(results.indexOf(3) < results.indexOf(4), 'Higher priority task should execute first');
});

test('strict mode with onRateLimit()', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	// Add tasks to trigger rate limit
	queue.add(async () => undefined);
	queue.add(async () => undefined);

	let rateLimitCalled = false;
	const rateLimitPromise = (async () => {
		await queue.onRateLimit();
		rateLimitCalled = true;
	})();

	// Add one more task to trigger rate limit
	queue.add(async () => undefined);

	await delay(20);

	assert.ok(rateLimitCalled, 'onRateLimit() should resolve when rate limited');

	await queue.onIdle();
});

test('strict mode with carryoverIntervalCount', async () => {
	// Note: In strict mode, carryoverIntervalCount doesn't apply
	// because we track individual execution times, not pending counts
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
		carryoverIntervalCount: true,
	});

	const executionTimes: number[] = [];

	// Add 4 tasks
	for (let i = 0; i < 4; i++) {
		queue.add(async () => {
			executionTimes.push(Date.now());
		});
	}

	await queue.onIdle();

	// Verify sliding window is enforced regardless of carryoverIntervalCount
	assertSlidingWindow(executionTimes, 100, 2);
});

test('strict mode throws error with intervalCap: Infinity', () => {
	assert.throws(
		() => new PQueue({
			interval: 1000,
			intervalCap: Number.POSITIVE_INFINITY,
			strict: true,
		}),
		{
			name: 'TypeError',
			message: 'The `strict` option requires a finite `intervalCap`',
		},
	);
});

test('strict mode with AbortSignal', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	const controller = new AbortController();
	const executionTimes: number[] = [];

	// Add tasks, abort the third one
	queue.add(async () => {
		executionTimes.push(Date.now());
	});
	queue.add(async () => {
		executionTimes.push(Date.now());
	});

	const abortedPromise = queue.add(async () => {
		executionTimes.push(Date.now());
	}, {signal: controller.signal});

	queue.add(async () => {
		executionTimes.push(Date.now());
	});

	// Abort the third task before it can run
	controller.abort();

	await assert.rejects(abortedPromise);
	await queue.onIdle();

	// Should have executed 3 tasks (one was aborted)
	assert.equal(executionTimes.length, 3);
});

test('strict mode frees capacity when task aborts before start', async () => {
	const queue = new PQueue({
		interval: 200,
		intervalCap: 1,
		strict: true,
	});

	const controller = new AbortController();
	controller.abort();

	const startTime = Date.now();

	await assert.rejects(queue.add(async () => undefined, {signal: controller.signal}));

	let startedAt = 0;
	await queue.add(async () => {
		startedAt = Date.now() - startTime;
	});

	assert.ok(startedAt < 120, `Task should start immediately when previous was aborted, started at ${startedAt}ms`);
});

test('strict mode ignores aborted tasks for sliding window', async () => {
	const queue = new PQueue({
		interval: 120,
		intervalCap: 2,
		strict: true,
	});

	const abortControllers = [new AbortController(), new AbortController()];
	const abortPromises: Array<Promise<unknown>> = [];
	for (const controller of abortControllers) {
		controller.abort();
		abortPromises.push(assert.rejects(queue.add(async () => undefined, {signal: controller.signal})));
	}

	await Promise.all(abortPromises);

	const startTime = Date.now();
	const executionTimes: number[] = [];

	await queue.add(async () => {
		executionTimes.push(Date.now() - startTime);
	});

	await queue.add(async () => {
		executionTimes.push(Date.now() - startTime);
	});

	assert.equal(executionTimes.length, 2);
	assert.ok(executionTimes[0] < 60, `First task should start immediately, started at ${executionTimes[0]}ms`);
	assert.ok(executionTimes[1] < 60, `Second task should start immediately, started at ${executionTimes[1]}ms`);
});

test('strict mode aborted tasks do not trigger rateLimit event', async () => {
	const queue = new PQueue({
		interval: 200,
		intervalCap: 1,
		strict: true,
	});

	let rateLimited = false;
	queue.on('rateLimit', () => {
		rateLimited = true;
	});

	const controller = new AbortController();
	controller.abort();

	await assert.rejects(queue.add(async () => undefined, {signal: controller.signal}));

	assert.equal(rateLimited, false, 'Aborted task should not trigger rateLimit');
	assert.equal(queue.isRateLimited, false, 'Queue should not be rate limited after aborted task');
});

test('strict mode after queue becomes idle', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	const executionTimes: number[] = [];

	// First batch
	await queue.add(async () => {
		executionTimes.push(Date.now());
	});
	await queue.add(async () => {
		executionTimes.push(Date.now());
	});

	// Wait for queue to become idle and ticks to expire
	await delay(150);

	// Second batch - should be able to execute immediately
	const startTime = Date.now();
	await queue.add(async () => {
		executionTimes.push(Date.now());
	});
	await queue.add(async () => {
		executionTimes.push(Date.now());
	});

	const elapsed = executionTimes[3] - startTime;
	assert.ok(elapsed < 50, `Second batch should execute immediately after idle, took ${elapsed}ms`);
});

test('strict mode prevents boundary bursts', async () => {
	// This test verifies that strict mode prevents the boundary burst problem
	// that occurs with fixed window mode
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	const executionTimes: number[] = [];

	// Add 4 tasks
	for (let i = 0; i < 4; i++) {
		queue.add(async () => {
			executionTimes.push(Date.now());
		});
	}

	await queue.onIdle();

	// Verify that there's never more than 2 tasks in any 100ms window
	// by checking every possible window start point
	assertSlidingWindow(executionTimes, 100, 2);
});

test('strict mode with long-running tasks', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
		concurrency: 2,
	});

	const startTimes: number[] = [];
	const endTimes: number[] = [];

	// Add tasks that take longer than the interval
	for (let i = 0; i < 4; i++) {
		queue.add(async () => {
			startTimes.push(Date.now());
			await delay(150); // Task takes longer than interval
			endTimes.push(Date.now());
		});
	}

	await queue.onIdle();

	// All tasks should have started
	assert.equal(startTimes.length, 4);

	// Verify sliding window constraint on start times
	assertSlidingWindow(startTimes, 100, 2);
});

test('strict mode isSaturated property', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	assert.equal(queue.isSaturated, false, 'Should not be saturated initially');

	// Add 3 tasks to saturate the queue
	queue.add(async () => delay(10));
	queue.add(async () => delay(10));
	queue.add(async () => delay(10));

	await delay(5);

	assert.equal(queue.isSaturated, true, 'Should be saturated when rate limited with pending tasks');

	await queue.onIdle();

	assert.equal(queue.isSaturated, false, 'Should not be saturated after idle');
});

test('strict mode multiple complete intervals', async () => {
	const queue = new PQueue({
		interval: 50,
		intervalCap: 3,
		strict: true,
	});

	const executionTimes: number[] = [];

	// Add 12 tasks - should span 4 intervals
	for (let i = 0; i < 12; i++) {
		queue.add(async () => {
			executionTimes.push(Date.now());
		});
	}

	await queue.onIdle();

	assert.equal(executionTimes.length, 12);

	// Verify each interval respects the cap
	const startTime = executionTimes[0];
	const relativeExecutionTimes = executionTimes.map(t => t - startTime);

	// Group by approximate interval
	const intervals = [0, 50, 100, 150];
	for (const intervalStart of intervals) {
		const tasksInInterval = relativeExecutionTimes.filter(t => t >= intervalStart && t < intervalStart + 50).length;

		assert.ok(tasksInInterval <= 3, `Interval starting at ${intervalStart}ms has ${tasksInInterval} tasks`);
	}
});

test('strict mode precision timing', async () => {
	const queue = new PQueue({
		interval: 200,
		intervalCap: 2,
		strict: true,
	});

	const startTime = Date.now();
	const executionTimes: number[] = [];

	// Add 6 tasks
	for (let i = 0; i < 6; i++) {
		queue.add(async () => {
			executionTimes.push(Date.now() - startTime);
		});
	}

	await queue.onIdle();

	// Tasks 0-1: execute at ~0ms
	// Tasks 2-3: execute at ~200ms (after first two age out)
	// Tasks 4-5: execute at ~400ms (after next two age out)
	assert.ok(executionTimes[0] < 50);
	assert.ok(executionTimes[1] < 50);
	assert.ok(executionTimes[2] >= 180 && executionTimes[2] < 300);
	assert.ok(executionTimes[3] >= 180 && executionTimes[3] < 300);
	assert.ok(executionTimes[4] >= 380 && executionTimes[4] < 500);
	assert.ok(executionTimes[5] >= 380 && executionTimes[5] < 500);
});

test('strict mode with concurrency: Infinity', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 3,
		strict: true,
		concurrency: Number.POSITIVE_INFINITY,
	});

	const executionTimes: number[] = [];

	// Add 9 tasks - all should respect rate limit despite infinite concurrency
	for (let i = 0; i < 9; i++) {
		queue.add(async () => {
			executionTimes.push(Date.now());
			await delay(50); // Tasks overlap but rate limit should still apply
		});
	}

	await queue.onIdle();

	assert.equal(executionTimes.length, 9);

	// Verify sliding window constraint
	assertSlidingWindow(executionTimes, 100, 3);
});

test('strict mode with timeout option', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
		timeout: 50,
	});

	const results: Array<'success' | 'timeout'> = [];

	// Add a task that will timeout
	const timeoutTask = async () => {
		try {
			await queue.add(async () => {
				await delay(200);
				return 'done';
			});
			results.push('success');
		} catch {
			results.push('timeout');
		}
	};

	// Add a task that will succeed
	const successTask = async () => {
		try {
			await queue.add(async () => {
				await delay(10);
				return 'done';
			});
			results.push('success');
		} catch {
			results.push('timeout');
		}
	};

	await Promise.all([timeoutTask(), successTask()]);

	assert.ok(results.includes('timeout'), 'Should have a timed out task');
	assert.ok(results.includes('success'), 'Should have a successful task');
});

test('strict mode rapid sequential adds', async () => {
	const queue = new PQueue({
		interval: 50,
		intervalCap: 5,
		strict: true,
	});

	const executionTimes: number[] = [];

	// Rapidly add many tasks
	const promises = [];
	for (let i = 0; i < 50; i++) {
		promises.push(queue.add(async () => {
			executionTimes.push(Date.now());
		}));
	}

	await Promise.all(promises);

	assert.equal(executionTimes.length, 50);

	// Verify sliding window constraint for all tasks
	assertSlidingWindow(executionTimes, 50, 5);
});

test('strict mode clear with pending timeout', async () => {
	const queue = new PQueue({
		interval: 200,
		intervalCap: 1,
		strict: true,
	});

	// Execute one task to consume the slot
	await queue.add(async () => undefined);

	// Add another task that will be rate limited
	const taskPromise = queue.add(async () => 'completed');

	// Clear immediately - this should cancel the pending timeout
	queue.clear();

	// The second task should have been cleared
	assert.equal(queue.size, 0);

	// Add a new task - should still respect the previous tick
	const startTime = Date.now();
	await queue.add(async () => undefined);
	const elapsed = Date.now() - startTime;

	assert.ok(elapsed >= 150, `Task should be rate limited after clear, took ${elapsed}ms`);

	// Original task promise won't resolve since it was cleared
	// Just verify the queue works correctly after clear
});

test('strict mode handles edge case of exactly intervalCap tasks', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 3,
		strict: true,
	});

	const executionTimes: number[] = [];
	const startTime = Date.now();

	// Add exactly intervalCap tasks
	for (let i = 0; i < 3; i++) {
		queue.add(async () => {
			executionTimes.push(Date.now() - startTime);
		});
	}

	await queue.onIdle();

	// All should execute immediately
	assert.equal(executionTimes.length, 3);
	assert.ok(executionTimes.every(t => t < 50), 'All tasks should execute immediately when at exactly intervalCap');
});

test('strict mode interleaved add and await', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 2,
		strict: true,
	});

	const results: number[] = [];
	const startTime = Date.now();

	// Add and await interleaved
	await queue.add(async () => {
		results.push(Date.now() - startTime);
	});

	await queue.add(async () => {
		results.push(Date.now() - startTime);
	});

	// These should wait for the window
	await queue.add(async () => {
		results.push(Date.now() - startTime);
	});

	await queue.add(async () => {
		results.push(Date.now() - startTime);
	});

	assert.equal(results.length, 4);
	// First two should be immediate
	assert.ok(results[0] < 50);
	assert.ok(results[1] < 50);
	// Third and fourth should wait for window
	assert.ok(results[2] >= 80);
	assert.ok(results[3] >= 80);
});

test('strict mode circular buffer compaction', async () => {
	const queue = new PQueue({
		interval: 10,
		intervalCap: 5,
		strict: true,
	});

	// Add many tasks to trigger circular buffer compaction
	// Compaction happens when startIndex > 100 and > length/2
	const promises = [];
	for (let i = 0; i < 300; i++) {
		promises.push(queue.add(async () => undefined));
	}

	await Promise.all(promises);

	// Verify all tasks completed successfully
	assert.equal(promises.length, 300);

	// Queue should be idle and functional
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 0);

	// Should still work correctly after compaction
	const startTime = Date.now();
	await queue.add(async () => undefined);
	const elapsed = Date.now() - startTime;

	// Should execute quickly (within tolerance for 10ms interval)
	assert.ok(elapsed < 50, `Task after compaction should execute promptly, took ${elapsed}ms`);
});
