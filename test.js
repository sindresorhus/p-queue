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

	const input = new Array(100).fill(0).map(() => queue.add(async () => {
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
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 2);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

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
	t.is(queue.isPaused, true);

	queue.start();
	t.is(queue.size, 3);
	t.is(queue.pending, 2);
	t.is(queue.isPaused, false);

	queue.add(() => delay(20000));
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
	queue.add(() => delay(1000));
	queue.add(() => 'sync 2');
	queue.add(() => fixture);
	t.is(queue.size, 3);
	t.is(queue.pending, 1);
	await queue.onIdle();
	t.is(queue.size, 0);
	t.is(queue.pending, 0);
});

test('.addAll() sync/async mixed tasks', async t => {
	const queue = new PQueue();
	const fns = [
		() => 'sync 1',
		() => delay(2000),
		() => 'sync 2',
		async () => fixture
	];
	const p = queue.addAll(fns);
	t.is(queue.size, 0);
	t.is(queue.pending, 4);
	t.deepEqual(await p, ['sync 1', undefined, 'sync 2', fixture]);
});

test('should resolve empty when size is zero', async t => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	// It should take 1 seconds to resolve all tasks
	for (let index = 0; index < 100; index++) {
		queue.add(() => delay(10));
	}

	queue.onEmpty().then(() => {
		t.is(queue.size, 0);
	});

	queue.start();

	// Pause at 0.5 second
	setTimeout(async () => {
		queue.pause();
		await delay(10);
		queue.start();
	}, 500);

	await queue.onIdle();
});

test('.add() - throttled', async t => {
	const result = [];
	const queue = new PQueue({
		intervalCap: 1,
		interval: 500,
		autoStart: false
	});
	queue.add(() => result.push(1));
	queue.start();
	await delay(250);
	queue.add(() => result.push(2));
	t.deepEqual(result, [1]);
	await delay(300);
	t.deepEqual(result, [1, 2]);
});

test('.add() - throttled, carryoverConcurrencyCount false', async t => {
	const result = [];
	const queue = new PQueue({
		intervalCap: 1,
		carryoverConcurrencyCount: false,
		interval: 500,
		autoStart: false
	});
	const values = [0, 1];
	values.forEach(value => queue.add(() => delay(600).then(() => result.push(value))));
	queue.start();
	delay(550).then(() => {
		t.is(queue.pending, 2);
		t.deepEqual(result, []);
	});
	delay(650).then(() => {
		t.is(queue.pending, 1);
		t.deepEqual(result, [0]);
	});
	await delay(1250);
	t.deepEqual(result, values);
});

test('.add() - throttled, carryoverConcurrencyCount true', async t => {
	const result = [];
	const queue = new PQueue({
		carryoverConcurrencyCount: true,
		intervalCap: 1,
		interval: 500,
		autoStart: false
	});
	const values = [0, 1];
	values.forEach(value => queue.add(() => delay(600).then(() => result.push(value))));
	queue.start();
	delay(100).then(() => {
		t.deepEqual(result, []);
		t.is(queue.pending, 1);
	});
	delay(550).then(() => {
		t.deepEqual(result, []);
		t.is(queue.pending, 1);
	});
	delay(650).then(() => {
		t.deepEqual(result, [0]);
		t.is(queue.pending, 0);
	});
	delay(1550).then(() => {
		t.deepEqual(result, [0]);
	});
	await delay(1650);
	t.deepEqual(result, [0, 1]);
});

test('.add() - throttled 10, concurrency 5', async t => {
	const result = [];
	const queue = new PQueue({
		concurrency: 5,
		intervalCap: 10,
		interval: 1000,
		autoStart: false
	});
	const firstV = [...new Array(5).keys()];
	const secondV = [...new Array(10).keys()];
	const thirdV = [...new Array(13).keys()];
	thirdV.forEach(value => queue.add(() => delay(300).then(() => result.push(value))));
	queue.start();
	t.deepEqual(result, []);
	delay(400).then(() => {
		t.deepEqual(result, firstV);
		t.is(queue.pending, 5);
	});
	delay(700).then(() => {
		t.deepEqual(result, secondV);
	});
	delay(1200).then(() => {
		t.is(queue.pending, 3);
		t.deepEqual(result, secondV);
	});
	await delay(1400);
	t.deepEqual(result, thirdV);
});

test('.add() - throttled finish and resume', async t => {
	const result = [];
	const queue = new PQueue({
		concurrency: 1,
		intervalCap: 2,
		interval: 2000,
		autoStart: false
	});

	const values = [0, 1];
	const firstV = [0, 1];
	const secondV = [0, 1, 2];
	values.forEach(value => queue.add(() => delay(100).then(() => result.push(value))));
	queue.start();
	delay(1000).then(() => {
		t.deepEqual(result, firstV);
		queue.add(() => delay(100).then(() => result.push(2)));
	});
	delay(1500).then(() => t.deepEqual(result, firstV));
	await delay(2200);
	t.deepEqual(result, secondV);
});

test('pause should work when throttled', async t => {
	const result = [];
	const queue = new PQueue({
		concurrency: 2,
		intervalCap: 2,
		interval: 1000,
		autoStart: false
	});
	const values = 	[0, 1, 2, 3];
	const firstV = 	[0, 1];
	const secondV = [0, 1, 2, 3];
	values.forEach(value => queue.add(() => delay(100).then(() => result.push(value))));
	queue.start();
	delay(300).then(() => t.deepEqual(result, firstV));
	delay(600).then(() => queue.pause());
	delay(1400).then(() => t.deepEqual(result, firstV));
	delay(1500).then(() => queue.start());
	delay(2200).then(() => t.deepEqual(result, secondV));
	await delay(2500);
});
