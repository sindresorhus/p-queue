/* eslint-disable no-new */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'eventemitter3';
import delay from 'delay';
import timeSpan from 'time-span';
import randomInt from 'random-int';
import pDefer from 'p-defer';
import {TimeoutError} from 'p-timeout';
import PQueue from '../source/index.js';

const fixture = Symbol('fixture');

test('.add()', async () => {
	const queue = new PQueue();
	const promise = queue.add(async () => fixture);
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 1);
	assert.equal(await promise, fixture);
});

test('.add() - limited concurrency', async () => {
	const queue = new PQueue({concurrency: 2});
	const promise = queue.add(async () => fixture);
	const promise2 = queue.add(async () => {
		await delay(100);
		return fixture;
	});
	const promise3 = queue.add(async () => fixture);
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 2);
	assert.equal(await promise, fixture);
	assert.equal(await promise2, fixture);
	assert.equal(await promise3, fixture);
});

test('.add() - concurrency: 1', async () => {
	const input = [
		[10, 300],
		[20, 200],
		[30, 100],
	];

	const end = timeSpan();
	const queue = new PQueue({concurrency: 1});

	const mapper = async ([value, ms]: readonly number[]) => queue.add(async () => {
		await delay(ms!);
		return value!;
	});

	// eslint-disable-next-line unicorn/no-array-callback-reference
	assert.deepEqual(await Promise.all(input.map(mapper)), [10, 20, 30]);
	const duration = end() as number;
	assert.ok(duration >= 590 && duration <= 650, `Expected duration to be between 590-650ms, got ${duration}ms`);
});

test('.add() - concurrency: 5', async () => {
	const concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async () => queue.add(async () => {
		running++;
		assert.ok(running <= concurrency);
		assert.ok(queue.pending <= concurrency);
		await delay(randomInt(30, 200));
		running--;
	}));

	await Promise.all(input);
});

test('.add() - update concurrency', async () => {
	let concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async (_value, index) => queue.add(async () => {
		running++;

		assert.ok(running <= concurrency);
		assert.ok(queue.pending <= concurrency);

		await delay(randomInt(30, 200));
		running--;

		if (index % 30 === 0) {
			queue.concurrency = --concurrency;
			assert.equal(queue.concurrency, concurrency);
		}
	}));

	await Promise.all(input);
});

test('.add() - priority', async () => {
	const result: number[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(0), {priority: 0});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(2), {priority: 1});
	queue.add(async () => result.push(3), {priority: 2});
	queue.add(async () => result.push(0), {priority: -1});
	await queue.onEmpty();
	assert.deepEqual(result, [1, 3, 1, 2, 0, 0]);
});

test('.sizeBy() - priority', async () => {
	const queue = new PQueue();
	queue.pause();
	queue.add(async () => 0, {priority: 1});
	queue.add(async () => 0, {priority: 0});
	queue.add(async () => 0, {priority: 1});
	assert.equal(queue.sizeBy({priority: 1}), 2);
	assert.equal(queue.sizeBy({priority: 0}), 1);
	queue.clear();
	await queue.onEmpty();
	assert.equal(queue.sizeBy({priority: 1}), 0);
	assert.equal(queue.sizeBy({priority: 0}), 0);
});

test('.add() - priority defaults to 0 when undefined', async () => {
	const result: string[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => result.push('first'), {priority: undefined});
	queue.add(async () => result.push('second'), {priority: undefined});
	queue.add(async () => result.push('priority'), {priority: 1});
	queue.add(async () => result.push('third'), {priority: undefined});
	await queue.onEmpty();
	assert.deepEqual(result, ['first', 'priority', 'second', 'third']);
});

test('.add() - timeout always throws', async () => {
	const queue = new PQueue({timeout: 300});
	const errors: unknown[] = [];

	// Task that will timeout
	await assert.rejects(
		queue.add(async () => {
			await delay(400);
			return '🐌';
		}),
		TimeoutError,
		'Task exceeding timeout should throw TimeoutError',
	);

	// Task that completes within timeout
	const result = await queue.add(async () => {
		await delay(200);
		return '🦆';
	});

	assert.equal(result, '🦆', 'Task within timeout should complete normally');

	// Test with very short timeout
	await assert.rejects(
		queue.add(async () => delay(100), {timeout: 10}),
		TimeoutError,
		'Short timeout should throw',
	);

	await queue.onIdle();
});

test('.add() - timeout behavior', async () => {
	const queue = new PQueue({timeout: 300});

	// Test multiple timeouts
	await assert.rejects(
		queue.add(async () => {
			await delay(400);
			return '🐌';
		}),
		TimeoutError,
	);

	// Task that completes
	const result = await queue.add(async () => {
		await delay(200);
		return '🦆';
	});
	assert.equal(result, '🦆');

	// Test timeout override
	const longResult = await queue.add(async () => {
		await delay(400);
		return '🐢';
	}, {timeout: 500});
	assert.equal(longResult, '🐢', 'Task should complete with extended timeout');

	await queue.onIdle();
});

test('.add() - change timeout in between', async () => {
	const result: string[] = [];
	const initialTimeout = 50;
	const newTimeout = 200;
	const queue = new PQueue({timeout: initialTimeout, concurrency: 2});

	// This task will timeout with initial timeout of 50ms
	await assert.rejects(queue.add(async () => {
		const {timeout} = queue;
		assert.equal(timeout, initialTimeout);
		await delay(300);
		result.push('🐌');
	}), TimeoutError);

	queue.timeout = newTimeout;

	// This task will complete within the new timeout of 200ms
	await queue.add(async () => {
		const {timeout} = queue;
		assert.equal(timeout, newTimeout);
		await delay(100);
		result.push('🐅');
	});

	await queue.onIdle();
	assert.deepEqual(result, ['🐅']);
});

test('.onEmpty()', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => 0);
	queue.add(async () => 0);
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 1);
	await queue.onEmpty();
	assert.equal(queue.size, 0);

	queue.add(async () => 0);
	queue.add(async () => 0);
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 1);
	await queue.onEmpty();
	assert.equal(queue.size, 0);

	// Test an empty queue
	await queue.onEmpty();
	assert.equal(queue.size, 0);
});

test('.onIdle()', async () => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 2);
	await queue.onIdle();
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 2);
	await queue.onIdle();
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);
});

test('.onSizeLessThan()', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));

	await queue.onSizeLessThan(4);
	assert.equal(queue.size, 3);
	assert.equal(queue.pending, 1);

	await queue.onSizeLessThan(2);
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 1);

	await queue.onSizeLessThan(10);
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 1);

	await queue.onSizeLessThan(1);
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 1);
});

test('.onIdle() - no pending', async () => {
	const queue = new PQueue();
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);

	// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
	assert.equal(await queue.onIdle(), undefined);
});

test('.onPendingZero() - resolves immediately when pending === 0', async () => {
	const queue = new PQueue();
	assert.equal(queue.pending, 0);
	// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
	assert.equal(await queue.onPendingZero(), undefined);
});

test('.onPendingZero() - waits for running tasks to finish', async () => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));

	assert.equal(queue.size, 2);
	assert.equal(queue.pending, 2);

	await queue.onPendingZero();
	assert.equal(queue.pending, 0);
	// Queue may still have items
	assert.equal(queue.size, 0);
});

test('.onPendingZero() - works while paused with queued items', async () => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	assert.equal(queue.size, 2);
	assert.equal(queue.pending, 2);

	queue.pause();

	// `.onPendingZero()` should still resolve when running tasks finish
	await queue.onPendingZero();
	assert.equal(queue.pending, 0);
	// Queued items remain since queue is paused
	assert.equal(queue.size, 2);
});

test('.onPendingZero() - multiple concurrent waiters all resolve', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(50));

	const promise1 = queue.onPendingZero();
	const promise2 = queue.onPendingZero();
	const promise3 = queue.onPendingZero();

	await Promise.all([promise1, promise2, promise3]);
	assert.equal(queue.pending, 0);
});

test('.onPendingZero() - resolves even if tasks throw errors', async () => {
	const queue = new PQueue({concurrency: 2});

	// Add task that will throw error and handle it
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

	queue.add(async () => delay(50));

	assert.equal(queue.pending, 2);

	await queue.onPendingZero();
	assert.equal(queue.pending, 0);

	// Ensure error task completes
	await errorTask;
});

test('.onPendingZero() - works after clear()', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 2);

	// Clear removes queued items but not running ones
	queue.clear();
	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);

	await queue.onPendingZero();
	assert.equal(queue.pending, 0);
});

test('.onPendingZero() - integration with pause/start', async () => {
	const queue = new PQueue({concurrency: 2});
	const results: number[] = [];

	queue.add(async () => {
		await delay(100);
		results.push(1);
	});
	queue.add(async () => {
		await delay(100);
		results.push(2);
	});
	queue.add(async () => {
		await delay(50);
		results.push(3);
	});

	assert.equal(queue.pending, 2);
	assert.equal(queue.size, 1);

	queue.pause();
	await queue.onPendingZero();

	// First 2 tasks should be done
	assert.deepEqual(results, [1, 2]);
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 1);

	queue.start();
	await queue.onIdle();

	assert.deepEqual(results, [1, 2, 3]);
});

test('.onPendingZero() - adding tasks while waiting', async () => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));

	const pendingZeroPromise = queue.onPendingZero();

	// Add more tasks while waiting - they should not block onPendingZero
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	assert.equal(queue.size, 2);

	await pendingZeroPromise;
	assert.equal(queue.pending, 0);
	// New tasks should have started
	assert.equal(queue.size, 0);
});

test('.onPendingZero() - rapid sequential calls', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(50));

	const promise1 = queue.onPendingZero();
	await promise1;

	// Immediate second call should resolve immediately
	const startTime = Date.now();
	await queue.onPendingZero();
	const elapsed = Date.now() - startTime;

	assert.ok(elapsed < 10, 'Should resolve immediately when pending is 0');
});

test('.onPendingZero() - high concurrency', async () => {
	const queue = new PQueue({concurrency: 100});
	const taskCount = 200;

	for (let index = 0; index < taskCount; index++) {
		queue.add(async () => delay(10));
	}

	assert.equal(queue.pending, 100);
	assert.equal(queue.size, 100);

	queue.pause();

	await queue.onPendingZero();
	assert.equal(queue.pending, 0);
	assert.equal(queue.size, 100);
});

test('.onPendingZero() - starts with empty queue', async () => {
	const queue = new PQueue({concurrency: 2});

	// Should resolve immediately when queue starts empty
	await queue.onPendingZero();
	assert.equal(queue.pending, 0);

	// Add tasks and immediately call `.onPendingZero()`
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	const pendingZeroPromise = queue.onPendingZero();
	assert.equal(queue.pending, 2);

	await pendingZeroPromise;
	assert.equal(queue.pending, 0);
});

test('.onPendingZero() - works with onEmpty and onIdle', async () => {
	const queue = new PQueue({concurrency: 2});
	const events: string[] = [];

	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	queue.pause();

	const onEmptyPromise = (async () => {
		await queue.onEmpty();
		events.push('empty');
	})();

	const onPendingZeroPromise = (async () => {
		await queue.onPendingZero();
		events.push('pendingZero');
	})();

	const onIdlePromise = (async () => {
		await queue.onIdle();
		events.push('idle');
	})();

	// Wait for running tasks to finish
	await onPendingZeroPromise;

	// `pendingZero`` should fire first since queue is paused
	assert.deepEqual(events, ['pendingZero']);

	queue.start();
	await Promise.all([onEmptyPromise, onIdlePromise]);

	// Empty fires when queue is empty, idle when all done
	assert.deepEqual(events, ['pendingZero', 'empty', 'idle']);
});

test('.clear()', () => {
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	assert.equal(queue.size, 4);
	assert.equal(queue.pending, 2);
	queue.clear();
	assert.equal(queue.size, 0);
});

test('.addAll()', async () => {
	const queue = new PQueue();
	const fn = async (): Promise<symbol> => fixture;
	const functions = [fn, fn];
	const promise = queue.addAll(functions);
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 2);
	assert.deepEqual(await promise, [fixture, fixture]);
});

test('enforce number in options.concurrency', () => {
	assert.throws(
		() => {
			new PQueue({concurrency: 0});
		},
		{constructor: TypeError},
	);

	assert.throws(
		() => {
			new PQueue({concurrency: undefined});
		},
		{constructor: TypeError},
	);

	assert.doesNotThrow(() => {
		new PQueue({concurrency: 1});
	});

	assert.doesNotThrow(() => {
		new PQueue({concurrency: 10});
	});

	assert.doesNotThrow(() => {
		new PQueue({concurrency: Number.POSITIVE_INFINITY});
	});
});

test('enforce number in queue.concurrency', () => {
	assert.throws(
		() => {
			(new PQueue()).concurrency = 0;
		},
		{constructor: TypeError},
	);

	assert.throws(
		() => {
			// @ts-expect-error Testing
			(new PQueue()).concurrency = undefined;
		},
		{constructor: TypeError},
	);

	assert.doesNotThrow(() => {
		(new PQueue()).concurrency = 1;
	});

	assert.doesNotThrow(() => {
		(new PQueue()).concurrency = 10;
	});

	assert.doesNotThrow(() => {
		(new PQueue()).concurrency = Number.POSITIVE_INFINITY;
	});
});

test('enforce number in options.intervalCap', () => {
	assert.throws(
		() => {
			new PQueue({intervalCap: 0});
		},
		{constructor: TypeError},
	);

	assert.throws(
		() => {
			new PQueue({intervalCap: undefined});
		},
		{constructor: TypeError},
	);

	assert.doesNotThrow(() => {
		new PQueue({intervalCap: 1});
	});

	assert.doesNotThrow(() => {
		new PQueue({intervalCap: 10});
	});

	assert.doesNotThrow(() => {
		new PQueue({intervalCap: Number.POSITIVE_INFINITY});
	});
});

test('enforce finite in options.interval', () => {
	assert.throws(
		() => {
			new PQueue({interval: -1});
		},
		{constructor: TypeError},
	);

	assert.throws(
		() => {
			new PQueue({interval: undefined});
		},
		{constructor: TypeError},
	);

	assert.throws(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	});

	assert.doesNotThrow(() => {
		new PQueue({interval: 0});
	});

	assert.doesNotThrow(() => {
		new PQueue({interval: 10});
	});

	assert.throws(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	});
});

test('autoStart: false', () => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	assert.equal(queue.size, 4);
	assert.equal(queue.pending, 0);
	assert.equal(queue.isPaused, true);

	queue.start();
	assert.equal(queue.size, 2);
	assert.equal(queue.pending, 2);
	assert.equal(queue.isPaused, false);

	queue.clear();
	assert.equal(queue.size, 0);
});

test('.start() - return this', async () => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	assert.equal(queue.size, 3);
	assert.equal(queue.pending, 0);
	await queue.start().onIdle();
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);
});

test('.start() - not paused', () => {
	const queue = new PQueue();

	assert.ok(!queue.isPaused);

	queue.start();

	assert.ok(!queue.isPaused);
});

test('.pause()', () => {
	const queue = new PQueue({concurrency: 2});

	queue.pause();
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	queue.add(async () => delay(20_000));
	assert.equal(queue.size, 5);
	assert.equal(queue.pending, 0);
	assert.equal(queue.isPaused, true);

	queue.start();
	assert.equal(queue.size, 3);
	assert.equal(queue.pending, 2);
	assert.equal(queue.isPaused, false);

	queue.add(async () => delay(20_000));
	queue.pause();
	assert.equal(queue.size, 4);
	assert.equal(queue.pending, 2);
	assert.equal(queue.isPaused, true);

	queue.start();
	assert.equal(queue.size, 4);
	assert.equal(queue.pending, 2);
	assert.equal(queue.isPaused, false);

	queue.clear();
	assert.equal(queue.size, 0);
});

test('.add() sync/async mixed tasks', async () => {
	const queue = new PQueue({concurrency: 1});
	queue.add(() => 'sync 1');
	queue.add(async () => delay(1000));
	queue.add(() => 'sync 2');
	queue.add(() => fixture);
	assert.equal(queue.size, 3);
	assert.equal(queue.pending, 1);
	await queue.onIdle();
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);
});

test.skip('.add() - handle task throwing error', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(() => 'sync 1');
	await assert.rejects(
		queue.add(() => {
			throw new Error('broken');
		}),
		{message: 'broken'},
	);
	queue.add(() => 'sync 2');

	assert.equal(queue.size, 2);

	await queue.onIdle();
});

test('.add() - handle task promise failure', async () => {
	const queue = new PQueue({concurrency: 1});

	await assert.rejects(
		queue.add(async () => {
			throw new Error('broken');
		}),
		{message: 'broken'},
	);

	queue.add(() => 'task #1');

	assert.equal(queue.pending, 1);

	await queue.onIdle();

	assert.equal(queue.pending, 0);
});

test('.addAll() sync/async mixed tasks', async () => {
	const queue = new PQueue();

	const functions: Array<() => (string | Promise<void> | Promise<unknown>)> = [
		() => 'sync 1',
		async () => delay(2000),
		() => 'sync 2',
		async () => fixture,
	];

	const promise = queue.addAll(functions);

	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 4);
	assert.deepEqual(await promise, ['sync 1', undefined, 'sync 2', fixture]);
});

test('should resolve empty when size is zero', async () => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	// It should take 1 seconds to resolve all tasks
	for (let index = 0; index < 100; index++) {
		queue.add(async () => delay(10));
	}

	(async () => {
		await queue.onEmpty();
		assert.equal(queue.size, 0);
	})();

	queue.start();

	// Pause at 0.5 second
	setTimeout(
		async () => {
			queue.pause();
			await delay(10);
			queue.start();
		},
		500,
	);

	await queue.onIdle();
});

test('.add() - throttled', async () => {
	const result: number[] = [];
	const queue = new PQueue({
		intervalCap: 1,
		interval: 500,
		autoStart: false,
	});
	queue.add(async () => result.push(1));
	queue.start();
	await delay(250);
	queue.add(async () => result.push(2));
	assert.deepEqual(result, [1]);
	await delay(300);
	assert.deepEqual(result, [1, 2]);
});

test('.add() - throttled, carryoverConcurrencyCount false', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 1,
		carryoverConcurrencyCount: false,
		interval: 500,
		autoStart: false,
	});

	const values = [0, 1];
	for (const value of values) {
		queue.add(async () => {
			await delay(600);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(550);
		assert.equal(queue.pending, 2);
		assert.deepEqual(result, []);
	})();

	(async () => {
		await delay(650);
		assert.equal(queue.pending, 1);
		assert.deepEqual(result, [0]);
	})();

	await delay(1250);
	assert.deepEqual(result, values);
});

test('.add() - throttled, carryoverConcurrencyCount true', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		carryoverConcurrencyCount: true,
		intervalCap: 1,
		interval: 500,
		autoStart: false,
	});

	const values = [0, 1];
	for (const value of values) {
		queue.add(async () => {
			await delay(600);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(100);
		assert.deepEqual(result, []);
		assert.equal(queue.pending, 1);
	})();

	(async () => {
		await delay(550);
		assert.deepEqual(result, []);
		assert.equal(queue.pending, 1);
	})();

	(async () => {
		await delay(650);
		assert.deepEqual(result, [0]);
		assert.equal(queue.pending, 0);
	})();

	(async () => {
		await delay(1550);
		assert.deepEqual(result, [0]);
	})();

	await delay(1650);
	assert.deepEqual(result, values);
});

test('.add() - throttled 10, concurrency 5', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 5,
		intervalCap: 10,
		interval: 1000,
		autoStart: false,
	});

	const firstValue = [...Array.from({length: 5}).keys()];
	const secondValue = [...Array.from({length: 10}).keys()];
	const thirdValue = [...Array.from({length: 13}).keys()];

	for (const value of thirdValue) {
		queue.add(async () => {
			await delay(300);
			result.push(value);
		});
	}

	queue.start();

	assert.deepEqual(result, []);

	(async () => {
		await delay(400);
		assert.deepEqual(result, firstValue);
		assert.equal(queue.pending, 5);
	})();

	(async () => {
		await delay(700);
		assert.deepEqual(result, secondValue);
	})();

	(async () => {
		await delay(1200);
		assert.equal(queue.pending, 3);
		assert.deepEqual(result, secondValue);
	})();

	await delay(1400);
	assert.deepEqual(result, thirdValue);
});

test('.add() - throttled finish and resume', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 1,
		intervalCap: 2,
		interval: 2000,
		autoStart: false,
	});

	const values = [0, 1];
	const firstValue = [0, 1];
	const secondValue = [0, 1, 2];

	for (const value of values) {
		queue.add(async () => {
			await delay(100);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(1000);
		assert.deepEqual(result, firstValue);

		queue.add(async () => {
			await delay(100);
			result.push(2);
		});
	})();

	(async () => {
		await delay(1500);
		assert.deepEqual(result, firstValue);
	})();

	await delay(2200);
	assert.deepEqual(result, secondValue);
});

test('pause should work when throttled', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 2,
		intervalCap: 2,
		interval: 1000,
		autoStart: false,
	});

	const values = [0, 1, 2, 3];
	const firstValue = [0, 1];
	const secondValue = [0, 1, 2, 3];

	for (const value of values) {
		queue.add(async () => {
			await delay(100);
			result.push(value);
		});
	}

	queue.start();

	(async () => {
		await delay(300);
		assert.deepEqual(result, firstValue);
	})();

	(async () => {
		await delay(600);
		queue.pause();
	})();

	(async () => {
		await delay(1400);
		assert.deepEqual(result, firstValue);
	})();

	(async () => {
		await delay(1500);
		queue.start();
	})();

	(async () => {
		await delay(2200);
		assert.deepEqual(result, secondValue);
	})();

	await delay(2500);
});

test('.intervalCap - changed when at rest', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 1,
		interval: 500,
	});

	queue.add(async () => {
		result.push(1);
	});
	queue.add(async () => {
		result.push(2);
	});

	await delay(300);

	assert.deepEqual(result, [1]);

	await delay(300);

	assert.deepEqual(result, [1, 2]);

	await delay(600);

	queue.intervalCap = 2;

	queue.add(async () => {
		result.push(3);
	});
	queue.add(async () => {
		result.push(4);
	});

	await delay(300);

	assert.deepEqual(result, [1, 2, 3, 4]);
});

test('.intervalCap - changed while running, larger than full cap', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 1,
		interval: 500,
	});

	queue.add(async () => {
		result.push(1);
	});
	queue.add(async () => {
		result.push(2);
	});

	queue.intervalCap = 2;

	await delay(300);

	assert.deepEqual(result, [1, 2]);
});

test('.intervalCap - changed while running, larger than not full cap', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 3,
		interval: 500,
	});

	queue.add(async () => {
		result.push(1);
	});
	queue.add(async () => {
		result.push(2);
	});

	await delay(200);

	assert.deepEqual(result, [1, 2]);

	queue.intervalCap = 4;

	queue.add(async () => {
		result.push(3);
	});

	await delay(200);

	assert.deepEqual(result, [1, 2, 3]);
});

test('.intervalCap - changed while running, smaller than full cap', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 3,
		interval: 500,
	});

	queue.add(async () => {
		result.push(1);
	});
	queue.add(async () => {
		await delay(300);
		result.push(2);
	});
	queue.add(async () => {
		result.push(3);
	});

	await delay(100);

	assert.deepEqual(result, [1, 3]);

	queue.intervalCap = 2;

	queue.add(async () => {
		result.push(4);
	});

	await delay(200);

	assert.deepEqual(result, [1, 3, 2]);

	await delay(300);

	assert.deepEqual(result, [1, 3, 2, 4]);
});

test('.intervalCap - changed while running, smaller than not full cap and can run more', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 4,
		interval: 500,
	});

	queue.add(async () => {
		result.push(1);
	});
	queue.add(async () => {
		await delay(300);
		result.push(2);
	});

	await delay(100);

	assert.deepEqual(result, [1]);

	queue.intervalCap = 3;

	queue.add(async () => {
		result.push(3);
	});

	await delay(200);
	assert.deepEqual(result, [1, 3, 2]);
});

test('.intervalCap - changed while running, smaller than not full cap and cannot run more', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 4,
		interval: 500,
	});

	queue.add(async () => {
		result.push(1);
	});
	queue.add(async () => {
		await delay(200);
		result.push(2);
	});

	await delay(100);

	assert.deepEqual(result, [1]);

	queue.intervalCap = 2;

	queue.add(async () => {
		result.push(3);
	});

	await delay(200);
	assert.deepEqual(result, [1, 2]);

	await delay(300);

	assert.deepEqual(result, [1, 2, 3]);
});

test('.intervalCap - changed while running, larger than full cap and should run multiple more', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 2,
		interval: 500,
	});

	queue.add(async () => {
		result.push(1);
	});
	queue.add(async () => {
		result.push(2);
	});
	queue.add(async () => {
		await delay(200);
		result.push(3);
	});
	queue.add(async () => {
		await delay(200);
		result.push(4);
	});

	await delay(100);

	assert.deepEqual(result, [1, 2]);

	queue.intervalCap = 4;

	await delay(300);

	assert.deepEqual(result, [1, 2, 3, 4]);
});
