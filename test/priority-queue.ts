import {test} from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import {runInNewContext} from 'node:vm';
import pDefer from 'p-defer';
import PQueue from '../source/index.js';
import PriorityQueue from '../source/priority-queue.js';
import {flush} from './helpers.js';

// The `gc` function, without starting Node.js with `--expose-gc`. The flag applies to new contexts.
v8.setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

const createRun = (value: string) => async () => value;

test('PriorityQueue ignores dequeued items in queue operations', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');
	const third = createRun('third');

	queue.enqueue(first, {id: 'same', priority: 0});
	queue.enqueue(second, {id: 'same', priority: 0});
	queue.enqueue(third, {id: 'third', priority: 0});

	assert.equal(queue.dequeue(), first);
	assert.deepEqual(queue.filter({priority: 0}), [second, third]);

	queue.setPriority('same', 2);
	queue.remove(third);

	assert.equal(queue.size, 1);
	assert.equal(queue.dequeue(), second);
	assert.equal(queue.dequeue(), undefined);
});

test('PriorityQueue inserts high-priority items correctly after partial dequeue', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');
	const third = createRun('third');
	const urgent = createRun('urgent');

	queue.enqueue(first, {priority: 0});
	queue.enqueue(second, {priority: 0});
	queue.enqueue(third, {priority: -1});

	assert.equal(queue.dequeue(), first);

	queue.enqueue(urgent, {priority: 1});

	assert.equal(queue.size, 3);
	assert.equal(queue.dequeue(), urgent);
	assert.equal(queue.dequeue(), second);
	assert.equal(queue.dequeue(), third);
	assert.equal(queue.dequeue(), undefined);
});

test('PriorityQueue appends same-priority and lower-priority items correctly after partial dequeue', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');
	const samePriority = createRun('samePriority');
	const lowerPriority = createRun('lowerPriority');

	queue.enqueue(first, {priority: 0});
	queue.enqueue(second, {priority: 0});

	assert.equal(queue.dequeue(), first);

	queue.enqueue(samePriority, {priority: 0});
	queue.enqueue(lowerPriority, {priority: -1});

	assert.equal(queue.size, 3);
	assert.equal(queue.dequeue(), second);
	assert.equal(queue.dequeue(), samePriority);
	assert.equal(queue.dequeue(), lowerPriority);
	assert.equal(queue.dequeue(), undefined);
});

test('PriorityQueue removes the live duplicate id after partial dequeue', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');
	const third = createRun('third');

	queue.enqueue(first, {id: 'same'});
	queue.enqueue(second, {id: 'same'});
	queue.enqueue(third, {id: 'third'});

	assert.equal(queue.dequeue(), first);

	queue.remove('same');

	assert.equal(queue.size, 1);
	assert.equal(queue.dequeue(), third);
	assert.equal(queue.dequeue(), undefined);
});

test('PriorityQueue removes by run after partial dequeue', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');
	const third = createRun('third');

	queue.enqueue(first);
	queue.enqueue(second);
	queue.enqueue(third);

	assert.equal(queue.dequeue(), first);

	queue.remove(second);

	assert.equal(queue.size, 1);
	assert.equal(queue.dequeue(), third);
	assert.equal(queue.dequeue(), undefined);
});

test('PriorityQueue ignores consumed items with no live match', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');

	queue.enqueue(first, {id: 'first'});
	queue.enqueue(second, {id: 'second'});

	assert.equal(queue.dequeue(), first);

	assert.throws(
		() => {
			queue.setPriority('first', 1);
		},
		{
			name: 'ReferenceError',
			message: 'No promise function with the id "first" exists in the queue.',
		},
	);

	queue.remove(first);

	assert.equal(queue.size, 1);
	assert.equal(queue.dequeue(), second);
	assert.equal(queue.dequeue(), undefined);
});

test('PriorityQueue stays ordered after cursor compaction', () => {
	const queue = new PriorityQueue();
	const urgent = createRun('urgent');
	const tasks = Array.from({length: 150}, (_element, index) => createRun(`task-${index}`));

	for (const task of tasks) {
		queue.enqueue(task);
	}

	// Cross the compaction threshold while leaving queued items behind.
	const consumedPrefix = Array.from({length: 120}, () => queue.dequeue());
	assert.deepEqual(consumedPrefix, tasks.slice(0, 120));

	queue.enqueue(urgent, {priority: 1});

	assert.equal(queue.size, 31);
	assert.equal(queue.dequeue(), urgent);

	const liveRange = tasks.slice(120).map(task => queue.dequeue());
	assert.deepEqual(liveRange, tasks.slice(120));

	assert.equal(queue.dequeue(), undefined);
	assert.equal(queue.size, 0);
});

test('PriorityQueue setPriority works when only one live item remains', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');

	queue.enqueue(first, {id: 'first'});
	queue.enqueue(second, {id: 'second'});

	assert.equal(queue.dequeue(), first);

	queue.setPriority('second', 1);

	assert.equal(queue.size, 1);
	assert.equal(queue.dequeue(), second);
	assert.equal(queue.dequeue(), undefined);
});

test('PriorityQueue keeps FIFO order among `Infinity` priorities', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const low = createRun('low');
	const second = createRun('second');
	const third = createRun('third');

	queue.enqueue(first, {priority: Infinity});
	queue.enqueue(low, {priority: 0});
	queue.enqueue(second, {priority: Infinity});
	queue.enqueue(third, {priority: Infinity});

	assert.deepEqual([queue.dequeue(), queue.dequeue(), queue.dequeue(), queue.dequeue()], [first, second, third, low]);
});

test('PriorityQueue orders `-Infinity` priorities last and keeps their FIFO order', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');
	const normal = createRun('normal');

	queue.enqueue(first, {priority: -Infinity});
	queue.enqueue(second, {priority: -Infinity});
	queue.enqueue(normal, {priority: 0});

	assert.deepEqual([queue.dequeue(), queue.dequeue(), queue.dequeue()], [normal, first, second]);
});

test('PriorityQueue setPriority with the current priority keeps the position, also after partial dequeue and for `Infinity` or `-Infinity`', () => {
	const queue = new PriorityQueue();
	const firstHigh = createRun('firstHigh');
	const secondHigh = createRun('secondHigh');
	const first = createRun('first');
	const second = createRun('second');
	const third = createRun('third');
	const fourth = createRun('fourth');
	const firstLow = createRun('firstLow');
	const secondLow = createRun('secondLow');

	queue.enqueue(firstHigh, {id: 'firstHigh', priority: Infinity});
	queue.enqueue(secondHigh, {id: 'secondHigh', priority: Infinity});
	queue.enqueue(first, {id: 'first', priority: 1});
	queue.enqueue(second, {id: 'second', priority: 1});
	queue.enqueue(third, {id: 'third', priority: 1});
	queue.enqueue(fourth, {id: 'fourth', priority: 1});
	queue.enqueue(firstLow, {id: 'firstLow', priority: -Infinity});
	queue.enqueue(secondLow, {id: 'secondLow', priority: -Infinity});

	queue.setPriority('firstHigh', Infinity);
	queue.setPriority('first', 1);
	queue.setPriority('firstLow', -Infinity);

	assert.deepEqual([queue.dequeue(), queue.dequeue(), queue.dequeue()], [firstHigh, secondHigh, first]);

	queue.setPriority('second', 1);
	queue.setPriority('third', 1);

	assert.deepEqual(
		[queue.dequeue(), queue.dequeue(), queue.dequeue(), queue.dequeue(), queue.dequeue()],
		[second, third, fourth, firstLow, secondLow],
	);
});

test('PriorityQueue setPriority with the current priority still throws for an unknown id', () => {
	const queue = new PriorityQueue();
	queue.enqueue(createRun('first'), {id: 'first', priority: 1});

	assert.throws(() => {
		queue.setPriority('missing', 1);
	}, ReferenceError);
});

test('PriorityQueue setPriority moves an `Infinity` priority item behind the items with its new priority', () => {
	const queue = new PriorityQueue();
	const firstHigh = createRun('firstHigh');
	const secondHigh = createRun('secondHigh');
	const normal = createRun('normal');
	const low = createRun('low');

	queue.enqueue(firstHigh, {id: 'firstHigh', priority: Infinity});
	queue.enqueue(secondHigh, {id: 'secondHigh', priority: Infinity});
	queue.enqueue(normal, {id: 'normal', priority: 0});
	queue.enqueue(low, {id: 'low', priority: -Infinity});

	queue.setPriority('firstHigh', 0);
	queue.setPriority('low', 1);

	assert.deepEqual(
		[queue.dequeue(), queue.dequeue(), queue.dequeue(), queue.dequeue()],
		[secondHigh, low, normal, firstHigh],
	);
});

test('PriorityQueue keeps FIFO order among `Infinity` priorities inserted after partial dequeue', () => {
	const queue = new PriorityQueue();
	const first = createRun('first');
	const second = createRun('second');
	const firstHigh = createRun('firstHigh');
	const secondHigh = createRun('secondHigh');
	const thirdHigh = createRun('thirdHigh');

	queue.enqueue(first, {priority: 0});
	queue.enqueue(second, {priority: 0});
	queue.enqueue(firstHigh, {priority: Infinity});

	assert.equal(queue.dequeue(), firstHigh);
	assert.equal(queue.dequeue(), first);

	queue.enqueue(secondHigh, {priority: Infinity});
	queue.enqueue(thirdHigh, {priority: Infinity});

	assert.deepEqual([queue.dequeue(), queue.dequeue(), queue.dequeue()], [secondHigh, thirdHigh, second]);
});

test('PriorityQueue does not keep dequeued items, so their functions can be garbage collected', async () => {
	const queue = new PriorityQueue();
	const references: Array<WeakRef<Record<string, unknown>>> = [];

	const enqueue = () => {
		const payload = {};
		references.push(new WeakRef(payload));
		queue.enqueue(async () => payload);
	};

	for (let index = 0; index < 10; index++) {
		enqueue();
	}

	for (let index = 0; index < 9; index++) {
		queue.dequeue();
	}

	// A `WeakRef` target is kept until the current job ends.
	await flush();
	collectGarbage();

	assert.equal(queue.size, 1);
	assert.deepEqual(references.map(reference => reference.deref() === undefined), [...Array.from({length: 9}, () => true), false]);
});

test('tasks that ran can be garbage collected while other tasks still wait', async () => {
	const queue = new PQueue({concurrency: 1});
	const references: Array<WeakRef<Record<string, unknown>>> = [];
	const {promise, resolve} = pDefer();

	for (let index = 0; index < 10; index++) {
		const payload = {};
		references.push(new WeakRef(payload));
		queue.add(() => payload);
	}

	queue.add(async () => promise);
	const waiting = queue.add(() => undefined);
	await flush();
	assert.equal(queue.size, 1);

	collectGarbage();
	assert.ok(references.every(reference => reference.deref() === undefined));

	resolve();
	await waiting;
});
