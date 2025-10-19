import {test} from 'node:test';
import assert from 'node:assert';
import delay from 'delay';
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
	assert.equal(results.length, 4);
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
	queue.on('rateLimit', () => events.push('rateLimit'));
	queue.on('rateLimitCleared', () => events.push('rateLimitCleared'));

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
	assert.equal(queue.isRateLimited, true);
	assert.equal(events[0], 'rateLimit');

	await Promise.all(promises);
	assert.equal(queue.isRateLimited, false);
	assert.ok(events.includes('rateLimitCleared'));
});

test('rate-limit with queue manipulation during rate-limit event', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	let manipulated = false;

	queue.on('rateLimit', () => {
		if (!manipulated) {
			manipulated = true;
			// Try to manipulate queue during event
			queue.add(async () => 'extra');
			queue.pause();
			queue.start();
		}
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
	let rateLimitCalled = false;

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
		rateLimitCalled = true;
	})();

	await Promise.all([...promises, rateLimitPromise]);
	assert.ok(rateLimitCalled, 'onRateLimit should handle late attachment');
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
	assert.ok(true, 'onRateLimitCleared should handle attachment during rate limit');
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
	assert.equal(sequence[0], 'task1-start');
	assert.ok(sequence.includes('rate-limit'));
});

test('onRateLimit/onRateLimitCleared rapid transitions', async () => {
	const queue = new PQueue({
		interval: 50,
		intervalCap: 1,
	});

	const events: string[] = [];

	queue.on('rateLimit', () => events.push('limited'));
	queue.on('rateLimitCleared', () => events.push('cleared'));

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

	let rateLimitResolved = false;
	const rateLimitPromise = (async () => {
		await queue.onRateLimit();
		rateLimitResolved = true;
	})();

	// Add another task which will trigger rate limit
	queue.add(async () => delay(10));

	// Give time for rate limit to be triggered
	await delay(20);

	// OnRateLimit should have resolved since we hit rate limit
	assert.ok(rateLimitResolved, 'onRateLimit should resolve when rate limit is triggered');

	// Clean up
	await queue.onIdle();
});
