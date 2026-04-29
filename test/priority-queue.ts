import {test} from 'node:test';
import assert from 'node:assert/strict';
import PriorityQueue from '../source/priority-queue.js';

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
	for (let index = 0; index < 120; index++) {
		assert.equal(queue.dequeue(), tasks[index]);
	}

	queue.enqueue(urgent, {priority: 1});

	assert.equal(queue.size, 31);
	assert.equal(queue.dequeue(), urgent);

	for (let index = 120; index < tasks.length; index++) {
		assert.equal(queue.dequeue(), tasks[index]);
	}

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
