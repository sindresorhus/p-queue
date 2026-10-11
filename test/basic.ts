/* eslint-disable no-new -- constructing without assigning is the behaviour under test */
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {getEventListeners} from 'node:events';
import assert from 'node:assert/strict';
import delay from 'delay';
import timeSpan from 'time-span';
import randomInt from 'random-int';
import pDefer from 'p-defer';
import PQueue, {TimeoutError} from '../source/index.js';

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
	const duration = end();
	assert.ok(duration >= 590, `Expected duration to be at least 590ms, got ${duration}ms`);
	assert.ok(duration <= 650, `Expected duration to be at most 650ms, got ${duration}ms`);
});

test('.add() - concurrency: 5', async () => {
	const concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}, async () => queue.add(async () => {
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

	const input = Array.from({length: 100}, async (_value, index) => queue.add(async () => {
		running++;

		assert.ok(running <= concurrency);
		assert.ok(queue.pending <= concurrency);

		await delay(randomInt(30, 200));
		running--;

		if (index % 30 !== 0) {
			return;
		}

		queue.concurrency = --concurrency;
		assert.equal(queue.concurrency, concurrency);
	}));

	await Promise.all(input);
});

test('.add() - priority', async () => {
	const result: number[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => {
		result.push(1);
	}, {priority: 1});
	queue.add(async () => {
		result.push(0);
	}, {priority: 0});
	queue.add(async () => {
		result.push(1);
	}, {priority: 1});
	queue.add(async () => {
		result.push(2);
	}, {priority: 1});
	queue.add(async () => {
		result.push(3);
	}, {priority: 2});
	queue.add(async () => {
		result.push(0);
	}, {priority: -1});
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
	queue.add(async () => {
		result.push('first');
	}, {priority: undefined});
	queue.add(async () => {
		result.push('second');
	}, {priority: undefined});
	queue.add(async () => {
		result.push('priority');
	}, {priority: 1});
	queue.add(async () => {
		result.push('third');
	}, {priority: undefined});
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
		'Task exceeding timeout should reject with a TimeoutError',
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

test('.add() - the task signal aborts on timeout', async () => {
	const queue = new PQueue({timeout: 20});
	let taskSignal: AbortSignal | undefined;

	await assert.rejects(queue.add(async ({signal}) => {
		taskSignal = signal;
		await delay(100);
	}), error => {
		assert.ok(error instanceof TimeoutError);
		assert.ok(error instanceof DOMException);
		assert.ok(error instanceof Error);
		assert.equal(error.name, 'TimeoutError');
		assert.equal(taskSignal?.reason, error);
		return true;
	});
});

test('.add() - the timeout aborts the task signal when a user signal is also set', async () => {
	const queue = new PQueue({timeout: 20});
	const controller = new AbortController();
	let taskSignal: AbortSignal | undefined;

	const promise = queue.add(async ({signal}) => {
		taskSignal = signal;
		await delay(100);
	}, {signal: controller.signal});

	await assert.rejects(promise, TimeoutError);
	assert.ok(taskSignal?.reason instanceof TimeoutError);
	assert.equal(controller.signal.aborted, false);
});

test('.add() - timeout: undefined disables the queue timeout for one task', async () => {
	const queue = new PQueue({timeout: 20});
	let taskSignal: AbortSignal | undefined;

	const result = await queue.add(async ({signal}) => {
		taskSignal = signal;
		await delay(50);
		return '🐢';
	}, {timeout: undefined});

	assert.equal(result, '🐢');
	assert.equal(taskSignal, undefined);
});

test('.add() - the timeout wins over an abort listener of the task', async () => {
	const queue = new PQueue({timeout: 20});

	// The task rejects in its own abort listener, without delay. `.add()` must still reject with the `TimeoutError`.
	// eslint-disable-next-line @typescript-eslint/promise-function-async
	await assert.rejects(queue.add(({signal}) => new Promise((_resolve, reject) => {
		signal!.addEventListener('abort', () => {
			reject(new Error('Rejected by the task'));
		});
	})), TimeoutError);
});

for (const timeout of [undefined, 5000]) {
	test(`.add() - a signal that aborts while the task starts rejects and frees the slot (timeout: ${timeout})`, {timeout: 2000}, async () => {
		const queue = new PQueue({concurrency: 1, timeout});
		const controller = new AbortController();
		const reason = new Error('Aborted while starting');

		const promise = queue.add(async () => {
			controller.abort(reason);
			return new Promise(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function
		}, {signal: controller.signal});

		await assert.rejects(promise, reason);
		assert.equal(await queue.add(async () => '🦄'), '🦄');
	});
}

test('.add() - the abort listeners are removed when a task with a timeout completes', async () => {
	const queue = new PQueue({timeout: 5000});
	const controller = new AbortController();
	let taskSignal: AbortSignal | undefined;

	await queue.add(async ({signal}) => {
		taskSignal = signal;
	}, {signal: controller.signal});

	assert.ok(taskSignal);
	assert.equal(getEventListeners(taskSignal, 'abort').length, 0);
	assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('.add() - the task signal aborts on the user signal when a timeout is set', async () => {
	const queue = new PQueue({timeout: 5000});
	const controller = new AbortController();
	const reason = new Error('Aborted by the user');
	let taskSignal: AbortSignal | undefined;

	const promise = queue.add(async ({signal}) => {
		taskSignal = signal;
		await delay(100);
	}, {signal: controller.signal});

	controller.abort(reason);

	await assert.rejects(promise, reason);
	assert.equal(taskSignal?.reason, reason);
});

test('.add() - timeout timer is cleared when the task completes', async () => {
	// A timer that is not cleared keeps the process alive until the timeout.
	const countTimers = () => process.getActiveResourcesInfo().filter(resource => resource === 'Timeout').length;
	const timerCount = countTimers();
	let timerCountWhileRunning = 0;

	await new PQueue({timeout: 60_000}).add(async () => {
		timerCountWhileRunning = countTimers();
	});

	assert.equal(timerCountWhileRunning, timerCount + 1);
	assert.equal(countTimers(), timerCount);
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

test('.onEmpty() resolves when the last waiting task starts', async () => {
	const queue = new PQueue({concurrency: 1});
	const job1 = pDefer();
	const job2 = pDefer();

	queue.add(async () => job1.promise);
	const job2Result = queue.add(async () => job2.promise);

	let isEmpty = false;
	(async () => {
		await queue.onEmpty();
		isEmpty = true;
	})();

	job1.resolve();
	await delay(10);

	assert.ok(isEmpty);
	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 1);

	job2.resolve();
	await job2Result;
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

test('.onSizeLessThan() resolves after clear()', async () => {
	const queue = new PQueue({autoStart: false});

	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	assert.equal(queue.size, 2);
	assert.equal(queue.pending, 0);

	const sizePromise = queue.onSizeLessThan(1);

	queue.clear();

	await Promise.race([
		sizePromise,
		(async () => {
			await delay(200);
			throw new Error('clear() should resolve onSizeLessThan() waiters');
		})(),
	]);

	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);
});

test('.onSizeLessThan() resolves when start() drains the queue', async () => {
	const queue = new PQueue({concurrency: 3, autoStart: false});

	for (let index = 0; index < 5; index++) {
		queue.add(async () => delay(1000));
	}

	assert.equal(queue.size, 5);

	const sizePromise = queue.onSizeLessThan(3);

	queue.start();

	await Promise.race([
		sizePromise,
		(async () => {
			await delay(100);
			throw new Error('start() draining the queue should resolve onSizeLessThan() waiters');
		})(),
	]);

	// Resolved on the synchronous drain, not on a task completion.
	assert.equal(queue.size, 2);
	assert.equal(queue.pending, 3);
});

test('.onSizeLessThan() resolves when concurrency is raised at runtime', async () => {
	const queue = new PQueue({concurrency: 1});

	for (let index = 0; index < 5; index++) {
		queue.add(async () => delay(1000));
	}

	assert.equal(queue.size, 4);
	assert.equal(queue.pending, 1);

	const sizePromise = queue.onSizeLessThan(2);

	queue.concurrency = 4;

	await Promise.race([
		sizePromise,
		(async () => {
			await delay(100);
			throw new Error('raising concurrency should resolve onSizeLessThan() waiters');
		})(),
	]);

	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 4);
});

test('.onSizeLessThan() resolves when a rate-limit interval tick drains the queue', async () => {
	// Under rate limiting, tasks are dequeued on interval ticks rather than on completions.
	const queue = new PQueue({intervalCap: 2, interval: 100});

	for (let index = 0; index < 5; index++) {
		queue.add(async () => delay(1000));
	}

	// The first interval immediately dequeues up to `intervalCap`.
	assert.equal(queue.size, 3);
	assert.equal(queue.pending, 2);

	const time = timeSpan();

	// Needs a second interval tick (not a completion) to drop below the limit.
	await queue.onSizeLessThan(3);

	// Resolved via the interval tick (~100ms), long before the 1000ms tasks could complete,
	// so all four dequeued tasks are still running (none completed to drive the resolution).
	assert.ok(time() < 500, `Expected to resolve on the interval tick, took ${time()}ms`);
	assert.equal(queue.size, 1);
	assert.equal(queue.pending, 4);
});

test('.onSizeLessThan() resolves multiple waiters with different limits on a single drain', async () => {
	const queue = new PQueue({concurrency: 4, autoStart: false});

	for (let index = 0; index < 6; index++) {
		queue.add(async () => delay(1000));
	}

	assert.equal(queue.size, 6);

	const waiters = Promise.all([
		queue.onSizeLessThan(5),
		queue.onSizeLessThan(4),
		queue.onSizeLessThan(3),
	]);

	queue.start();

	await Promise.race([
		waiters,
		(async () => {
			await delay(100);
			throw new Error('all waiters should resolve on the synchronous drain');
		})(),
	]);

	// Draining to size 2 satisfies every limit above, without any completion.
	assert.equal(queue.size, 2);
	assert.equal(queue.pending, 4);
});

test('.onSizeLessThan() removes its listeners once resolved', async () => {
	const queue = new PQueue({concurrency: 3, autoStart: false});

	for (let index = 0; index < 5; index++) {
		queue.add(async () => delay(1000));
	}

	const sizePromise = queue.onSizeLessThan(3);

	queue.start();
	await sizePromise;

	// Both the `'next'` and `'active'` listeners must be cleaned up to avoid leaking on repeated calls.
	assert.equal(getEventListeners(queue, 'next').length, 0);
	assert.equal(getEventListeners(queue, 'active').length, 0);
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

test('.clear() rejects the removed tasks and lets the running tasks finish', async () => {
	const queue = new PQueue({concurrency: 1});
	const runningTaskDeferred = pDefer<string>();
	const results: unknown[] = [];
	const errors: unknown[] = [];
	let didRemovedTaskRun = false;

	queue.addEventListener('completed', event => {
		results.push(event.detail);
	});

	queue.addEventListener('error', event => {
		errors.push(event.detail);
	});

	const runningTask = queue.add(async () => runningTaskDeferred.promise);
	const removedTask = queue.add(() => {
		didRemovedTaskRun = true;
	});
	const removedTasks = queue.addAll([
		() => {
			didRemovedTaskRun = true;
		},
	]);

	queue.clear();

	await assert.rejects(removedTask, error => error instanceof DOMException && error.name === 'AbortError' && error.message === 'The queue was cleared');
	await assert.rejects(removedTasks, {name: 'AbortError'});

	runningTaskDeferred.resolve('🦄');
	assert.equal(await runningTask, '🦄');
	await queue.onIdle();

	assert.equal(didRemovedTaskRun, false);
	assert.deepEqual(results, ['🦄']);
	assert.deepEqual(errors, []);
});

test('.clear() does not cause an unhandled rejection for an ignored promise', async () => {
	const reasons: unknown[] = [];
	const onUnhandledRejection = (reason: unknown) => {
		reasons.push(reason);
	};

	process.on('unhandledRejection', onUnhandledRejection);

	const promises: Array<Promise<void>> = [];

	try {
		const queue = new PQueue({autoStart: false});
		promises.push(queue.add(() => {})); // eslint-disable-line @typescript-eslint/no-empty-function

		// The promise of the second task does not exist yet when this listener clears the queue.
		queue.addEventListener('add', () => {
			queue.clear();
		}, {once: true});

		promises.push(queue.add(() => {}), queue.add(() => {})); // eslint-disable-line @typescript-eslint/no-empty-function
		queue.clear();

		await delay(10);
	} finally {
		process.off('unhandledRejection', onUnhandledRejection);
	}

	assert.deepEqual(reasons, []);

	await Promise.all(promises.map(async promise => assert.rejects(promise, {name: 'AbortError'})));
});

test('an ignored promise of a failed task is still an unhandled rejection', () => {
	// In a child process, because the test runner fails any test that has an unhandled rejection.
	const code = `
		import PQueue from ${JSON.stringify(new URL('../source/index.ts', import.meta.url).href)};
		new PQueue().add(() => {
			throw new Error('Task failed');
		});
	`;

	const {status, stderr} = spawnSync(process.execPath, ['--import=tsx/esm', '--input-type=module', '--eval', code], {encoding: 'utf8'});

	assert.equal(status, 1);
	assert.match(stderr, /Task failed/v);
});

// Guards the timing of the promise that `.add()` returns. If it settles earlier, for example because it is no longer returned through an `async` function, the caller continues before the queue starts the next task.
test('.add() - the next waiting task has started when the promise resolves', async () => {
	const queue = new PQueue({concurrency: 1});
	let didSecondTaskStart = false;

	const firstTask = queue.add(async () => {}); // eslint-disable-line @typescript-eslint/no-empty-function
	const secondTask = queue.add(async () => {
		didSecondTaskStart = true;
	});

	await firstTask;
	assert.ok(didSecondTaskStart);
	assert.equal(queue.size, 0);

	await secondTask;
	assert.equal(queue.pending, 0);
});

test('.clear() resolves onEmpty() and onIdle() waiters', async () => {
	const queue = new PQueue({autoStart: false});

	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	const onEmptyPromise = queue.onEmpty();
	const onIdlePromise = queue.onIdle();

	queue.clear();

	await Promise.race([
		Promise.all([onEmptyPromise, onIdlePromise]),
		(async () => {
			await delay(200);
			throw new Error('clear() should resolve onEmpty() and onIdle() waiters');
		})(),
	]);

	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 0);
});

test('.clear() with running tasks emits empty but not idle', async () => {
	const queue = new PQueue({concurrency: 1});
	const events: string[] = [];

	queue.addEventListener('empty', () => {
		events.push('empty');
	});
	queue.addEventListener('idle', () => {
		events.push('idle');
	});

	// Start a long-running task
	const taskPromise = queue.add(async () => {
		await delay(100);
		return 'done';
	});

	// Add more tasks to the queue
	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	await delay(10); // Let first task start

	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 2);

	// Clear while task is running
	queue.clear();

	assert.equal(queue.size, 0);
	assert.equal(queue.pending, 1); // Still running

	// Should have emitted 'empty' but not 'idle' yet
	assert.ok(events.includes('empty'), 'Should emit empty');
	assert.ok(!events.includes('idle'), 'Should not emit idle while tasks are running');

	// Wait for running task to complete
	await taskPromise;

	// Now idle should be emitted
	assert.ok(events.includes('idle'), 'Should emit idle after running task completes');
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

test('.addAll() assigns unique IDs to each task', async () => {
	const queue = new PQueue({concurrency: 1});
	const ids: Array<string | undefined> = [];

	// Capture IDs by using setPriority which throws if ID doesn't exist
	const fn1 = async () => {
		ids.push('task1');
	};

	const fn2 = async () => {
		ids.push('task2');
	};

	const fn3 = async () => {
		ids.push('task3');
	};

	// Pass shared options - each task should still get a unique ID
	await queue.addAll([fn1, fn2, fn3], {priority: 1});

	assert.equal(ids.length, 3);
});

test('.addAll() with options does not mutate the options object', async () => {
	const queue = new PQueue({concurrency: 1});
	const options = {priority: 5};

	await queue.addAll([async () => 'a', async () => 'b'], options);

	// The original options object should not have an 'id' property added
	assert.equal('id' in options, false);
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

	new PQueue({concurrency: 1});
	new PQueue({concurrency: 10});
	new PQueue({concurrency: Infinity});
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

	(new PQueue()).concurrency = 1;
	(new PQueue()).concurrency = 10;
	(new PQueue()).concurrency = Infinity;
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

	new PQueue({intervalCap: 1});
	new PQueue({intervalCap: 10});
	new PQueue({intervalCap: Infinity});
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

	assert.throws(
		() => {
			new PQueue({interval: Infinity});
		},
		{constructor: TypeError},
	);

	new PQueue({interval: 0});
	new PQueue({interval: 10});

	assert.throws(
		() => {
			new PQueue({interval: Infinity});
		},
		{constructor: TypeError},
	);
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

test('.add() - handle task throwing error', async () => {
	const queue = new PQueue({concurrency: 1});

	// Add multiple tasks before any complete
	const task1 = queue.add(() => 'sync 1');
	const task2 = queue.add(() => {
		throw new Error('broken');
	});
	const task3 = queue.add(() => 'sync 2');

	// Wait for first task to complete
	await task1;

	// Second task should reject
	await assert.rejects(task2, {message: 'broken'});

	// Third task should still complete
	await task3;

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
		() => {
			queue.pause();
			delay(10).then(() => {
				queue.start();
			});
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
	queue.add(async () => {
		result.push(1);
	});
	queue.start();
	await delay(250);
	queue.add(async () => {
		result.push(2);
	});
	assert.deepEqual(result, [1]);
	await delay(300);
	assert.deepEqual(result, [1, 2]);
});

test('.add() - throttled, carryoverIntervalCount false', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 1,
		carryoverIntervalCount: false,
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

test('.add() - throttled, carryoverIntervalCount true', async () => {
	const result: number[] = [];

	const queue = new PQueue({
		carryoverIntervalCount: true,
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

	const firstValue = Array.from({length: 5}, (_value, index) => index);
	const secondValue = Array.from({length: 10}, (_value, index) => index);
	const thirdValue = Array.from({length: 13}, (_value, index) => index);

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

test('.onError() - rejects when task errors', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(50));

	// Set up onError listener first
	const errorPromise = queue.onError();

	// Add task that will fail
	const task = queue.add(async () => {
		throw new Error('Task failed');
	});

	await assert.rejects(
		errorPromise,
		{message: 'Task failed'},
	);

	// Clean up unhandled rejection
	await Promise.allSettled([task]);
});

test('.onError() - captures first error in queue', async () => {
	const queue = new PQueue({concurrency: 2});

	// Set up onError listener first
	const errorPromise = queue.onError();

	// Add tasks
	const task1 = queue.add(async () => {
		await delay(100);
		throw new Error('First error');
	});

	const task2 = queue.add(async () => {
		await delay(200);
		throw new Error('Second error');
	});

	// Set up cleanup
	const cleanup = Promise.allSettled([task1, task2]);

	// Wait for onError to reject with first error
	await assert.rejects(
		errorPromise,
		{message: 'First error'},
		'Should reject with first error',
	);

	// Ensure all tasks completed
	await cleanup;
});

test('.onError() - works with Promise.race pattern', async () => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(50));
	queue.add(async () => delay(100));

	const racePromise = Promise.race([
		queue.onError(),
		queue.onIdle(),
	]);

	const task = queue.add(async () => {
		throw new Error('Failed task');
	});
	queue.add(async () => delay(150));

	// Stop processing on first error
	await assert.rejects(racePromise, {message: 'Failed task'});
	queue.pause(); // Stop processing remaining tasks

	// Clean up unhandled rejection
	await Promise.allSettled([task]);

	assert.equal(queue.isPaused, true);
});

test('.onError() - multiple listeners', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(50));

	const error1 = queue.onError();
	const error2 = queue.onError();

	const task = queue.add(async () => {
		throw new Error('Task error');
	});

	await assert.rejects(error1, {message: 'Task error'});
	await assert.rejects(error2, {message: 'Task error'});

	// Clean up unhandled rejection
	await Promise.allSettled([task]);
});

test('.onError() - works when called before adding tasks', async () => {
	const queue = new PQueue({concurrency: 1});

	// Call onError() before adding any tasks
	const errorPromise = queue.onError();

	// Add a task that errors
	const task = queue.add(async () => {
		throw new Error('Early error');
	});

	await Promise.allSettled([task]);

	await assert.rejects(
		errorPromise,
		{message: 'Early error'},
	);
});

test('an active listener cannot exceed the concurrency limit', async t => {
	// `active` was emitted before `pending` was incremented, so a listener that enqueued work re-entered the
	// start check while the limit still looked free, and a second task ran alongside the first.
	const queue = new PQueue({concurrency: 1});
	let live = 0;
	let maxLive = 0;
	let hasAdded = false;

	const task = async () => {
		live++;
		maxLive = Math.max(maxLive, live);
		await delay(10);
		live--;
	};

	queue.addEventListener('active', () => {
		if (hasAdded) {
			return;
		}

		hasAdded = true;
		queue.add(task);
	});

	await queue.add(task);
	await queue.onIdle();

	// `t.assert` is undefined on early Node.js 22 releases, so the imported assert is the portable choice.
	// eslint-disable-next-line node-test/prefer-test-context-assert
	assert.strictEqual(maxLive, 1);
	// eslint-disable-next-line node-test/prefer-test-context-assert
	assert.strictEqual(queue.size, 0);
});

test('.add() runs tasks with `Infinity` priority first, in the order they were added', async () => {
	const queue = new PQueue({concurrency: 1, autoStart: false});
	const order: string[] = [];
	const task = (name: string) => () => {
		order.push(name);
	};

	queue.add(task('first'), {priority: Infinity});
	queue.add(task('normal'));
	queue.add(task('second'), {priority: Infinity});
	queue.add(task('last'), {priority: -Infinity});
	queue.add(task('third'), {priority: Infinity});

	queue.start();
	await queue.onIdle();

	assert.deepEqual(order, ['first', 'second', 'third', 'normal', 'last']);
});

test('.onError() - pausing in an `error` listener stops the remaining tasks, as documented', async () => {
	const queue = new PQueue({concurrency: 2});
	queue.addEventListener('error', () => {
		queue.pause();
	}, {once: true});

	const started: number[] = [];
	const fetchData = async (number: number) => {
		started.push(number);
		await delay(10 * number);
		if (number === 1) {
			throw new Error('🦄');
		}
	};

	queue.add(async () => fetchData(1)).catch(() => undefined);
	queue.add(async () => fetchData(2)).catch(() => undefined);
	queue.add(async () => fetchData(3)).catch(() => undefined);

	await assert.rejects(Promise.race([queue.onError(), queue.onIdle()]), {message: '🦄'});
	await queue.onPendingZero();

	assert.deepEqual(started, [1, 2]);
	assert.equal(queue.size, 1);
	queue.clear();
});
