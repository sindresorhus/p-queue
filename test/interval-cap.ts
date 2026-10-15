import {test} from 'node:test';
import assert from 'node:assert/strict';
import pDefer from 'p-defer';
import PQueue from '../source/index.js';
import {flush, tick} from './helpers.js';

test('intervalCap can be increased and decreased in the current interval', async t => {
	// eslint-disable-next-line node-test/require-mock-timers-advance -- `tick()` advances the timers.
	t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000});
	const queue = new PQueue({interval: 1000, intervalCap: 1});
	let started = 0;
	const tasks = Array.from({length: 5}, async () => queue.add(() => ++started));
	await flush();
	t.assert.strictEqual(started, 1);

	queue.intervalCap = 3;
	t.assert.strictEqual(started, 3);
	queue.intervalCap = 1;
	t.assert.strictEqual(started, 3);
	t.assert.strictEqual(queue.isRateLimited, true);

	await tick(t, 1000);
	t.assert.strictEqual(started, 4);
	queue.intervalCap = 5;
	t.assert.strictEqual(started, 5);
	await Promise.all(tasks);
});

test('setting intervalCap to Infinity clears rate-limit state and timers', async t => {
	// eslint-disable-next-line node-test/require-mock-timers-advance -- `tick()` advances the timers.
	t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000});
	const queue = new PQueue({interval: 1000, intervalCap: 1});
	let started = 0;
	const tasks = Array.from({length: 4}, async () => queue.add(() => ++started));
	await flush();
	t.assert.strictEqual(started, 1);

	queue.intervalCap = Infinity;
	t.assert.strictEqual(started, 4);
	t.assert.strictEqual(queue.isRateLimited, false);
	await Promise.all(tasks);

	await tick(t, 1000);
	t.assert.strictEqual(started, 4);
});

test('restoring a finite intervalCap throttles queued tasks', async t => {
	// eslint-disable-next-line node-test/require-mock-timers-advance -- `tick()` advances the timers.
	t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000});
	const queue = new PQueue({interval: 1000});
	await queue.add(() => undefined);
	await tick(t, 200);
	queue.intervalCap = 2;

	let started = 0;
	const tasks = Array.from({length: 4}, async () => queue.add(() => ++started));
	t.assert.strictEqual(started, 2);
	await tick(t, 799);
	t.assert.strictEqual(started, 2);
	await tick(t, 201);
	t.assert.strictEqual(started, 4);
	await Promise.all(tasks);
});

test('intervalCap changes preserve carryoverIntervalCount', async t => {
	// eslint-disable-next-line node-test/require-mock-timers-advance -- `tick()` advances the timers.
	t.mock.timers.enable({apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000});
	const queue = new PQueue({interval: 1000, carryoverIntervalCount: true});
	const blocker = pDefer<void>();
	const first = queue.add(async () => blocker.promise);
	await flush();
	await tick(t, 1000);
	queue.intervalCap = 1;

	let hasStarted = false;
	const second = queue.add(() => {
		hasStarted = true;
	});
	t.assert.strictEqual(hasStarted, false);
	await tick(t, 1000);
	t.assert.strictEqual(hasStarted, false);

	blocker.resolve();
	await Promise.all([first, second]);
	t.assert.strictEqual(hasStarted, true);
});

test('intervalCap setter validates values and strict mode', () => {
	const queue = new PQueue({interval: 1000, intervalCap: 2});
	for (const value of [0, -1, 1.5, NaN, -Infinity, '3', undefined, null]) {
		// eslint-disable-next-line node-test/no-conditional-assertion -- Verify each invalid input.
		assert.throws(() => {
			queue.intervalCap = value as number;
		}, {name: 'TypeError'});
		// eslint-disable-next-line node-test/no-conditional-assertion -- Verify the setter preserved the value for every invalid input.
		assert.strictEqual(queue.intervalCap, 2);
	}

	const strictQueue = new PQueue({interval: 1000, intervalCap: 2, strict: true});
	assert.throws(() => {
		strictQueue.intervalCap = Infinity;
	}, {message: /requires a finite `intervalCap`/v});
	assert.strictEqual(strictQueue.intervalCap, 2);
});
