/* eslint-disable no-new */
import EventEmitter from 'eventemitter3';
import test from 'ava';
import delay from 'delay';
import inRange from 'in-range';
import timeSpan from 'time-span';
import randomInt from 'random-int';
import PQueue from '../source/index.js';

const fixture = Symbol('fixture');

test('.add()', async t => {
	const queue = new PQueue();
	const promise = queue.add(async () => fixture);
	t.is(queue.size, 0);
	t.is(queue.pending, 1);
	t.is(await promise, fixture);
});

test('.add() - limited concurrency', async t => {
	const queue = new PQueue({concurrency: 2});
	const promise = queue.add(async () => fixture);
	const promise2 = queue.add(async () => {
		await delay(100);
		return fixture;
	});
	const promise3 = queue.add(async () => fixture);
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	t.is(await promise, fixture);
	t.is(await promise2, fixture);
	t.is(await promise3, fixture);
});

test('.add() - concurrency: 1', async t => {
	const input = [
		[10, 300],
		[20, 200],
		[30, 100]
	];

	const end = timeSpan();
	const queue = new PQueue({concurrency: 1});

	const mapper = async ([value, ms]: readonly number[]) => queue.add(async () => {
		await delay(ms!);
		return value!;
	});

	// eslint-disable-next-line unicorn/no-array-callback-reference
	t.deepEqual(await Promise.all(input.map(mapper)), [10, 20, 30]);
	t.true(inRange(end(), {start: 590, end: 650}));
});

test('.add() - concurrency: 5', async t => {
	const concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async () => queue.add(async () => {
		running++;
		t.true(running <= concurrency);
		t.true(queue.pending <= concurrency);
		await delay(randomInt(30, 200));
		running--;
	}));

	await Promise.all(input);
});

test('.add() - update concurrency', async t => {
	let concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array.from({length: 100}).fill(0).map(async (_value, index) => queue.add(async () => {
		running++;

		t.true(running <= concurrency);
		t.true(queue.pending <= concurrency);

		await delay(randomInt(30, 200));
		running--;

		if (index % 30 === 0) {
			queue.concurrency = --concurrency;
			t.is(queue.concurrency, concurrency);
		}
	}));

	await Promise.all(input);
});

test('.add() - priority', async t => {
	const result: number[] = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(0), {priority: 0});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(2), {priority: 1});
	queue.add(async () => result.push(3), {priority: 2});
	queue.add(async () => result.push(0), {priority: -1});
	await queue.onEmpty();
	t.deepEqual(result, [1, 3, 1, 2, 0, 0]);
});

test('.sizeBy() - priority', async t => {
	const queue = new PQueue();
	queue.pause();
	queue.add(async () => 0, {priority: 1});
	queue.add(async () => 0, {priority: 0});
	queue.add(async () => 0, {priority: 1});
	t.is(queue.sizeBy({priority: 1}), 2);
	t.is(queue.sizeBy({priority: 0}), 1);
	queue.clear();
	await queue.onEmpty();
	t.is(queue.sizeBy({priority: 1}), 0);
	t.is(queue.sizeBy({priority: 0}), 0);
});

test('.add() - timeout without throwing', async t => {
	const result: string[] = [];
	const queue = new PQueue({timeout: 300, throwOnTimeout: false});
	queue.add(async () => {
		await delay(400);
		result.push('🐌');
	});
	queue.add(async () => {
		await delay(250);
		result.push('🦆');
	});
	queue.add(async () => {
		await delay(310);
		result.push('🐢');
	});
	queue.add(async () => {
		await delay(100);
		result.push('🐅');
	});
	queue.add(async () => {
		result.push('⚡️');
	});
	await queue.onIdle();
	t.deepEqual(result, ['⚡️', '🐅', '🦆']);
});

test.failing('.add() - timeout with throwing', async t => {
	const result: string[] = [];
	const queue = new PQueue({timeout: 300, throwOnTimeout: true});
	await t.throwsAsync(queue.add(async () => {
		await delay(400);
		result.push('🐌');
	}));
	queue.add(async () => {
		await delay(200);
		result.push('🦆');
	});
	await queue.onIdle();
	t.deepEqual(result, ['🦆']);
});

test('.add() - change timeout in between', async t => {
	const result: string[] = [];
	const initialTimeout = 50;
	const newTimeout = 200;
	const queue = new PQueue({timeout: initialTimeout, throwOnTimeout: false, concurrency: 2});
	queue.add(async () => {
		const {timeout} = queue;
		t.deepEqual(timeout, initialTimeout);
		await delay(300);
		result.push('🐌');
	});
	queue.timeout = newTimeout;
	queue.add(async () => {
		const {timeout} = queue;
		t.deepEqual(timeout, newTimeout);
		await delay(100);
		result.push('🐅');
	});
	await queue.onIdle();
	t.deepEqual(result, ['🐅']);
});

test('.onEmpty()', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => 0);
	queue.add(async () => 0);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);
	await queue.onEmpty();
	t.is(queue.size, 0);

	queue.add(async () => 0);
	queue.add(async () => 0);
	t.is(queue.size, 1);
	t.is(queue.pending, 1);
	await queue.onEmpty();
	t.is(queue.size, 0);

	// Test an empty queue
	await queue.onEmpty();
	t.is(queue.size, 0);
});

test('.onIdle()', async t => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test('.onIdle() - no pending', async t => {
	const queue = new PQueue();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);

	// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
	t.is(await queue.onIdle(), undefined);
});

test('.clear()', t => {
	const queue = new PQueue({concurrency: 2});
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	queue.clear();
	t.is(queue.size, 0);
});

test('.addAll()', async t => {
	const queue = new PQueue();
	const fn = async (): Promise<symbol> => fixture;
	const functions = [fn, fn];
	const promise = queue.addAll(functions);
	t.is(queue.size, 0);
	t.is(queue.pending, 2);
	t.deepEqual(await promise, [fixture, fixture]);
});

test('enforce number in options.concurrency', t => {
	t.throws(
		() => {
			new PQueue({concurrency: 0});
		},
		{instanceOf: TypeError}
	);

	t.throws(
		() => {
			new PQueue({concurrency: undefined});
		},
		{instanceOf: TypeError}
	);

	t.notThrows(() => {
		new PQueue({concurrency: 1});
	});

	t.notThrows(() => {
		new PQueue({concurrency: 10});
	});

	t.notThrows(() => {
		new PQueue({concurrency: Number.POSITIVE_INFINITY});
	});
});

test('enforce number in queue.concurrency', t => {
	t.throws(
		() => {
			(new PQueue()).concurrency = 0;
		},
		{instanceOf: TypeError}
	);

	t.throws(
		() => {
			// @ts-expect-error
			(new PQueue()).concurrency = undefined;
		},
		{instanceOf: TypeError}
	);

	t.notThrows(() => {
		(new PQueue()).concurrency = 1;
	});

	t.notThrows(() => {
		(new PQueue()).concurrency = 10;
	});

	t.notThrows(() => {
		(new PQueue()).concurrency = Number.POSITIVE_INFINITY;
	});
});

test('enforce number in options.intervalCap', t => {
	t.throws(
		() => {
			new PQueue({intervalCap: 0});
		},
		{instanceOf: TypeError}
	);

	t.throws(
		() => {
			new PQueue({intervalCap: undefined});
		},
		{instanceOf: TypeError}
	);

	t.notThrows(() => {
		new PQueue({intervalCap: 1});
	});

	t.notThrows(() => {
		new PQueue({intervalCap: 10});
	});

	t.notThrows(() => {
		new PQueue({intervalCap: Number.POSITIVE_INFINITY});
	});
});

test('enforce finite in options.interval', t => {
	t.throws(
		() => {
			new PQueue({interval: -1});
		},
		{instanceOf: TypeError}
	);

	t.throws(
		() => {
			new PQueue({interval: undefined});
		},
		{instanceOf: TypeError}
	);

	t.throws(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	});

	t.notThrows(() => {
		new PQueue({interval: 0});
	});

	t.notThrows(() => {
		new PQueue({interval: 10});
	});

	t.throws(() => {
		new PQueue({interval: Number.POSITIVE_INFINITY});
	});
});

test('autoStart: false', t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	t.is(queue.size, 4);
	t.is(queue.pending, 0);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 2);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.clear();
	t.is(queue.size, 0);
});

test('.start() - return this', async t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));
	t.is(queue.size, 3);
	t.is(queue.pending, 0);
	await queue.start().onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test('.start() - not paused', t => {
	const queue = new PQueue();

	t.falsy(queue.isPaused);

	queue.start();

	t.falsy(queue.isPaused);
});

test('.pause()', t => {
	const queue = new PQueue({concurrency: 2});

	queue.pause();
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	queue.add(async () => delay(20000));
	t.is(queue.size, 5);
	t.is(queue.pending, 0);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 3);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.add(async () => delay(20000));
	queue.pause();
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.clear();
	t.is(queue.size, 0);
});

test('.add() sync/async mixed tasks', async t => {
	const queue = new PQueue({concurrency: 1});
	queue.add(() => 'sync 1');
	queue.add(async () => delay(1000));
	queue.add(() => 'sync 2');
	queue.add(() => fixture);
	t.is(queue.size, 3);
	t.is(queue.pending, 1);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test.failing('.add() - handle task throwing error', async t => {
	const queue = new PQueue({concurrency: 1});

	queue.add(() => 'sync 1');
	await t.throwsAsync(
		queue.add(
			() => {
				throw new Error('broken');
			}
		),
		{message: 'broken'}
	);
	queue.add(() => 'sync 2');

	t.is(queue.size, 2);

	await queue.onIdle();
});

test('.add() - handle task promise failure', async t => {
	const queue = new PQueue({concurrency: 1});

	await t.throwsAsync(
		queue.add(
			async () => {
				throw new Error('broken');
			}
		),
		{message: 'broken'}
	);

	queue.add(() => 'task #1');

	t.is(queue.pending, 1);

	await queue.onIdle();

	t.is(queue.pending, 0);
});

test('.addAll() sync/async mixed tasks', async t => {
	const queue = new PQueue();

	const functions: Array<() => (string | Promise<void> | Promise<unknown>)> = [
		() => 'sync 1',
		async () => delay(2000),
		() => 'sync 2',
		async () => fixture
	];

	const promise = queue.addAll(functions);

	t.is(queue.size, 0);
	t.is(queue.pending, 4);
	t.deepEqual(await promise, ['sync 1', undefined, 'sync 2', fixture]);
});

test('should resolve empty when size is zero', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	// It should take 1 seconds to resolve all tasks
	for (let index = 0; index < 100; index++) {
		queue.add(async () => delay(10));
	}

	(async () => {
		await queue.onEmpty();
		t.is(queue.size, 0);
	})();

	queue.start();

	// Pause at 0.5 second
	setTimeout(
		async () => {
			queue.pause();
			await delay(10);
			queue.start();
		},
		500
	);

	await queue.onIdle();
});

test('.add() - throttled', async t => {
	const result: number[] = [];
	const queue = new PQueue({
		intervalCap: 1,
		interval: 500,
		autoStart: false
	});
	queue.add(async () => result.push(1));
	queue.start();
	await delay(250);
	queue.add(async () => result.push(2));
	t.deepEqual(result, [1]);
	await delay(300);
	t.deepEqual(result, [1, 2]);
});

test('.add() - throttled, carryoverConcurrencyCount false', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		intervalCap: 1,
		carryoverConcurrencyCount: false,
		interval: 500,
		autoStart: false
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
		t.is(queue.pending, 2);
		t.deepEqual(result, []);
	})();

	(async () => {
		await delay(650);
		t.is(queue.pending, 1);
		t.deepEqual(result, [0]);
	})();

	await delay(1250);
	t.deepEqual(result, values);
});

test('.add() - throttled, carryoverConcurrencyCount true', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		carryoverConcurrencyCount: true,
		intervalCap: 1,
		interval: 500,
		autoStart: false
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
		t.deepEqual(result, []);
		t.is(queue.pending, 1);
	})();

	(async () => {
		await delay(550);
		t.deepEqual(result, []);
		t.is(queue.pending, 1);
	})();

	(async () => {
		await delay(650);
		t.deepEqual(result, [0]);
		t.is(queue.pending, 0);
	})();

	(async () => {
		await delay(1550);
		t.deepEqual(result, [0]);
	})();

	await delay(1650);
	t.deepEqual(result, values);
});

test('.add() - throttled 10, concurrency 5', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 5,
		intervalCap: 10,
		interval: 1000,
		autoStart: false
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

	t.deepEqual(result, []);

	(async () => {
		await delay(400);
		t.deepEqual(result, firstValue);
		t.is(queue.pending, 5);
	})();

	(async () => {
		await delay(700);
		t.deepEqual(result, secondValue);
	})();

	(async () => {
		await delay(1200);
		t.is(queue.pending, 3);
		t.deepEqual(result, secondValue);
	})();

	await delay(1400);
	t.deepEqual(result, thirdValue);
});

test('.add() - throttled finish and resume', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 1,
		intervalCap: 2,
		interval: 2000,
		autoStart: false
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
		t.deepEqual(result, firstValue);

		queue.add(async () => {
			await delay(100);
			result.push(2);
		});
	})();

	(async () => {
		await delay(1500);
		t.deepEqual(result, firstValue);
	})();

	await delay(2200);
	t.deepEqual(result, secondValue);
});

test('pause should work when throttled', async t => {
	const result: number[] = [];

	const queue = new PQueue({
		concurrency: 2,
		intervalCap: 2,
		interval: 1000,
		autoStart: false
	});

	const values = 	[0, 1, 2, 3];
	const firstValue = 	[0, 1];
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
		t.deepEqual(result, firstValue);
	})();

	(async () => {
		await delay(600);
		queue.pause();
	})();

	(async () => {
		await delay(1400);
		t.deepEqual(result, firstValue);
	})();

	(async () => {
		await delay(1500);
		queue.start();
	})();

	(async () => {
		await delay(2200);
		t.deepEqual(result, secondValue);
	})();

	await delay(2500);
});

test('clear interval on pause', async t => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1
	});

	queue.add(() => {
		queue.pause();
	});

	queue.add(() => 'task #1');

	await delay(300);

	t.is(queue.size, 1);
});

test('should be an event emitter', t => {
	const queue = new PQueue();
	t.true(queue instanceof EventEmitter);
});

test('should emit active event per item', async t => {
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

	t.is(eventCount, items.length);
});

test('should emit idle event when idle', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('idle', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));
	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 0);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);
});

test('should emit add event when adding task', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('add', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 2);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);
});

test('should emit next event when completing task', async t => {
	const queue = new PQueue({concurrency: 1});

	let timesCalled = 0;
	queue.on('next', () => {
		timesCalled++;
	});

	const job1 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 0);

	const job2 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(timesCalled, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 1);

	await job2;

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(timesCalled, 2);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(timesCalled, 3);
});

test('should emit completed / error events', async t => {
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

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 0);
	t.is(completedEvents, 0);

	const job2 = queue.add(async () => {
		await delay(1);
		throw new Error('failure');
	});

	t.is(queue.pending, 1);
	t.is(queue.size, 1);
	t.is(errorEvents, 0);
	t.is(completedEvents, 0);

	await job1;

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 0);
	t.is(completedEvents, 1);

	await t.throwsAsync(job2);

	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 1);

	const job3 = queue.add(async () => delay(100));

	t.is(queue.pending, 1);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 1);

	await job3;
	t.is(queue.pending, 0);
	t.is(queue.size, 0);
	t.is(errorEvents, 1);
	t.is(completedEvents, 2);
});

test('should verify timeout overrides passed to add', async t => {
	const queue = new PQueue({timeout: 200, throwOnTimeout: true});

	await t.throwsAsync(queue.add(async () => {
		await delay(400);
	}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(400);
	}, {throwOnTimeout: false}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(400);
	}, {timeout: 600}));

	await t.notThrowsAsync(queue.add(async () => {
		await delay(100);
	}));

	await t.throwsAsync(queue.add(async () => {
		await delay(100);
	}, {timeout: 50}));

	await queue.onIdle();
});
