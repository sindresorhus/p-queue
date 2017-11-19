import test from 'ava';
import delay from 'delay';
import inRange from 'in-range';
import timeSpan from 'time-span';
import randomInt from 'random-int';
import PQueue from '.';

const fixture = Symbol('fixture');

test('.add()', async t => {
	const queue = new PQueue();
	const p = queue.add(async () => fixture);
	t.is(queue.size, 0);
	t.is(queue.pending, 1);
	t.is(await p, fixture);
});

test('.add() - limited concurrency', async t => {
	const queue = new PQueue({concurrency: 2});
	const p = queue.add(async () => fixture);
	const p2 = queue.add(async () => delay(100).then(() => fixture));
	const p3 = queue.add(async () => fixture);
	t.is(queue.size, 1);
	t.is(queue.pending, 2);
	t.is(await p, fixture);
	t.is(await p2, fixture);
	t.is(await p3, fixture);
});

test('.add() - concurrency: 1', async t => {
	const input = [
		[10, 300],
		[20, 200],
		[30, 100]
	];

	const end = timeSpan();
	const queue = new PQueue({concurrency: 1});
	const mapper = ([val, ms]) => queue.add(() => delay(ms).then(() => val));

	t.deepEqual(await Promise.all(input.map(mapper)), [10, 20, 30]);
	t.true(inRange(end(), 590, 650));
});

test('.add() - concurrency: 5', async t => {
	const concurrency = 5;
	const queue = new PQueue({concurrency});
	let running = 0;

	const input = Array(100).fill(0).map(() => queue.add(async () => {
		running++;
		t.true(running <= concurrency);
		t.true(queue.pending <= concurrency);
		await delay(randomInt(30, 200));
		running--;
	}));

	await Promise.all(input);
});

test('.add() - priority', async t => {
	const result = [];
	const queue = new PQueue({concurrency: 1});
	queue.add(async () => result.push(0), {priority: 0});
	queue.add(async () => result.push(1), {priority: 1});
	queue.add(async () => result.push(2), {priority: 1});
	queue.add(async () => result.push(3), {priority: 2});
	await queue.onEmpty();
	t.deepEqual(result, [0, 3, 1, 2]);
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

test('.clear()', t => {
	const queue = new PQueue({concurrency: 2});
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	t.is(queue.size, 4);
	t.is(queue.pending, 2);
	queue.clear();
	t.is(queue.size, 0);
});

test('.addAll()', async t => {
	const queue = new PQueue();
	const fn = async () => fixture;
	const fns = [fn, fn];
	const p = queue.addAll(fns);
	t.is(queue.size, 0);
	t.is(queue.pending, 2);
	t.deepEqual(await p, [fixture, fixture]);
});

test('enforce number in options.concurrency', t => {
	/* eslint-disable no-new */
	t.throws(() => {
		new PQueue({concurrency: 0});
	}, TypeError);
	t.throws(() => {
		new PQueue({concurrency: undefined});
	}, TypeError);
	t.notThrows(() => {
		new PQueue({concurrency: 1});
	});
	t.notThrows(() => {
		new PQueue({concurrency: 10});
	});
	t.notThrows(() => {
		new PQueue({concurrency: Infinity});
	});
	/* eslint-enable no-new */
});

test('autoStart: false', t => {
	const queue = new PQueue({concurrency: 2, autoStart: false});

	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	t.is(queue.size, 4);
	t.is(queue.pending, 0);

	queue.start();
	t.is(queue.size, 2);
	t.is(queue.pending, 2);

	queue.clear();
	t.is(queue.size, 0);
});

test('.pause()', t => {
	const queue = new PQueue({concurrency: 2});

	queue.pause();
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	queue.add(() => delay(20000));
	t.is(queue.size, 5);
	t.is(queue.pending, 0);

	queue.start();
	t.is(queue.size, 3);
	t.is(queue.pending, 2);

	queue.add(() => delay(20000));
	queue.pause();
	t.is(queue.size, 4);
	t.is(queue.pending, 2);

	queue.start();
	t.is(queue.size, 4);
	t.is(queue.pending, 2);

	queue.clear();
	t.is(queue.size, 0);
});
