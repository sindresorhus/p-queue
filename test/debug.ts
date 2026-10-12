import {test} from 'node:test';
import assert from 'node:assert/strict';
import delay from 'delay';
import pDefer from 'p-defer';
import PQueue from '../source/index.js';
import {flush, FifoQueue} from './helpers.js';

test('runningTasks returns current running tasks', async () => {
	const queue = new PQueue({concurrency: 2});

	const task1 = queue.add(async ({id}) => {
		await delay(100);
		return id;
	}, {id: 'task1', priority: 1});

	const task2 = queue.add(async ({id}) => {
		await delay(100);
		return id;
	}, {id: 'task2', priority: 2});

	const task3 = queue.add(async ({id}) => {
		await delay(100);
		return id;
	}, {id: 'task3', priority: 0});

	// Wait a bit for tasks to start
	await delay(20);

	// Check running tasks
	const running = queue.runningTasks;
	assert.equal(running.length, 2);

	// Check that we have running tasks with IDs
	const runningIds = running.map(t => t.id).filter(id => id !== undefined);
	assert.equal(runningIds.length, 2);
	assert.ok(runningIds.includes('task1') || runningIds.includes('task2') || runningIds.includes('task3'));

	// Check that priorities are included (should have 2 tasks running)
	const priorities = running.map(task => task.priority);
	assert.equal(priorities.length, 2);
	assert.ok(priorities.every(priority => [0, 1, 2].includes(priority)));

	// Check that startTime is set
	assert.ok(running.every(task => task.startTime > 0));
	assert.ok(running.every(task => task.startTime <= Date.now()));

	await queue.onIdle();
});

test('runningTasks returns empty array when no tasks running', async () => {
	const queue = new PQueue({concurrency: 2});

	// No tasks running initially
	assert.equal(queue.runningTasks.length, 0);

	const task = queue.add(async () => delay(50));
	await queue.onIdle();

	// No tasks running after completion
	assert.equal(queue.runningTasks.length, 0);
});

test('runningTasks updates as tasks complete', async () => {
	const queue = new PQueue({concurrency: 1});

	const task1 = queue.add(async () => delay(50), {id: 'task1'});
	const task2 = queue.add(async () => delay(50), {id: 'task2'});

	await delay(10);
	assert.equal(queue.runningTasks.length, 1);
	assert.equal(queue.runningTasks[0].id, 'task1');

	await task1;
	await delay(10);
	assert.equal(queue.runningTasks.length, 1);
	assert.equal(queue.runningTasks[0].id, 'task2');

	await task2;
	assert.equal(queue.runningTasks.length, 0);
});

test('runningTasks includes timeout and timeoutRemaining', async () => {
	const queue = new PQueue({concurrency: 2, timeout: 1000});

	queue.add(async () => delay(50), {id: 'with-queue-timeout'});
	queue.add(async () => delay(50), {id: 'with-custom-timeout', timeout: 500});

	await delay(10);

	const running = queue.runningTasks;
	const withQueueTimeout = running.find(t => t.id === 'with-queue-timeout');
	const withCustomTimeout = running.find(t => t.id === 'with-custom-timeout');

	assert.ok(withQueueTimeout);
	assert.equal(withQueueTimeout.timeout, 1000);
	assert.equal(typeof withQueueTimeout.timeoutRemaining, 'number');
	assert.ok(withQueueTimeout.timeoutRemaining > 0);
	assert.ok(withQueueTimeout.timeoutRemaining <= 1000);

	assert.ok(withCustomTimeout);
	assert.equal(withCustomTimeout.timeout, 500);
	assert.equal(typeof withCustomTimeout.timeoutRemaining, 'number');
	assert.ok(withCustomTimeout.timeoutRemaining > 0);
	assert.ok(withCustomTimeout.timeoutRemaining <= 500);

	await queue.onIdle();
});

test('runningTasks returns fresh arrays', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(100), {id: 'task1'});
	await delay(10);

	const running1 = queue.runningTasks;
	const running2 = queue.runningTasks;

	// Should be different array instances
	assert.notEqual(running1, running2);

	// But contain the same data
	assert.deepEqual(running1, running2);

	// Modifying one shouldn't affect the other
	running1.push({id: 'fake', priority: 0, startTime: Date.now()});
	assert.notDeepEqual(running1, running2);
	assert.equal(queue.runningTasks.length, 1);

	await queue.onIdle();
});

test('runningTasks timeoutRemaining is undefined when no timeout is set', async () => {
	const queue = new PQueue({concurrency: 1});

	queue.add(async () => delay(100), {id: 'no-timeout'});

	await delay(10);

	const running = queue.runningTasks;
	assert.equal(running.length, 1);
	assert.equal(running[0].timeoutRemaining, undefined);

	await queue.onIdle();
});

test('runningTasks timeoutRemaining decreases over time', async () => {
	const queue = new PQueue({concurrency: 1, timeout: 5000});

	queue.add(async () => delay(300), {id: 'task'});

	await delay(10);

	const remaining1 = queue.runningTasks[0].timeoutRemaining!;

	await delay(100);

	const remaining2 = queue.runningTasks[0].timeoutRemaining!;

	assert.ok(remaining2 < remaining1, `Expected ${remaining2} < ${remaining1}`);

	await queue.onIdle();
});

test('runningTasks handles tasks without IDs', async () => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(50));
	queue.add(async () => delay(50), {priority: 5});

	await delay(10);

	const running = queue.runningTasks;
	assert.equal(running.length, 2);

	// Tasks without explicit IDs should not have id property
	assert.ok(running.every(task => task.id === undefined || typeof task.id === 'string'));
	assert.ok(running.every(task => typeof task.priority === 'number'));
	assert.ok(running.every(task => typeof task.startTime === 'number'));

	await queue.onIdle();
});

test('runningTasks works with interval rate limiting', async () => {
	const queue = new PQueue({
		concurrency: 10,
		interval: 100,
		intervalCap: 2,
	});

	// Add 4 tasks
	for (let i = 0; i < 4; i++) {
		queue.add(async () => delay(50), {id: `task${i}`});
	}

	await delay(10);

	// Only 2 should be running due to intervalCap
	const runningCount1 = queue.runningTasks.length;
	assert.ok(runningCount1 <= 2, `Should have at most 2 running tasks due to intervalCap, got ${runningCount1}`);

	// Wait for first batch to complete and interval to reset
	await delay(100);

	// Check if more tasks are running
	const runningCount2 = queue.runningTasks.length;
	assert.ok(runningCount2 <= 2, `Should have at most 2 running tasks, got ${runningCount2}`);

	await queue.onIdle();
});

test('isSaturated property detects when queue is at capacity', async () => {
	const queue = new PQueue({concurrency: 2});

	// Initially not saturated
	assert.equal(queue.isSaturated, false);

	// Add tasks to fill capacity
	queue.add(async () => delay(100));
	queue.add(async () => delay(100));

	await delay(10);
	// Now at capacity but no tasks waiting
	assert.equal(queue.isSaturated, false);

	// Add more task to exceed capacity
	queue.add(async () => delay(100));

	// Now saturated - at capacity with tasks waiting
	assert.equal(queue.isSaturated, true);

	await queue.onIdle();
	assert.equal(queue.isSaturated, false);
});

test('isSaturated with paused queue', async () => {
	const queue = new PQueue({concurrency: 1, autoStart: false});

	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	// Paused queue is not saturated even with waiting tasks
	assert.equal(queue.isSaturated, false);

	queue.start();
	await delay(10);

	// After starting, should be saturated
	assert.equal(queue.isSaturated, true);

	await queue.onIdle();
});

test('isSaturated with rate-limited queue', async () => {
	const queue = new PQueue({
		interval: 100,
		intervalCap: 1,
	});

	queue.add(async () => delay(50));
	queue.add(async () => delay(50));

	await delay(10);

	// Should be saturated when rate limited with tasks waiting
	assert.equal(queue.isSaturated, true);

	await queue.onIdle();
});

test('isSaturated when concurrency is lowered below the running tasks', async () => {
	const queue = new PQueue({concurrency: 2});
	const {promise, resolve} = pDefer();

	queue.add(async () => promise);
	queue.add(async () => promise);
	queue.add(async () => promise);
	assert.equal(queue.isSaturated, true);

	queue.concurrency = 1;
	assert.equal(queue.pending, 2);
	assert.equal(queue.size, 1);
	assert.equal(queue.isSaturated, true);

	resolve();
	await queue.onIdle();
	assert.equal(queue.isSaturated, false);
});

test('timeout error has the queue state at the time of the timeout', async () => {
	const queue = new PQueue({concurrency: 1, timeout: 20});

	const slowTask = queue.add(async () => delay(100));
	const waitingTasks = [
		queue.add(async () => delay(1)),
		queue.add(async () => delay(1)),
	];

	await assert.rejects(slowTask, {message: 'Task timed out after 20ms (queue has 1 running, 2 waiting)'});
	await Promise.all(waitingTasks);
});

test('isSaturated when concurrency is raised back after lowering it', async () => {
	const queue = new PQueue({concurrency: 2});
	const deferreds = [pDefer(), pDefer(), pDefer()];
	const tasks = deferreds.map(async ({promise}) => queue.add(async () => promise));

	queue.concurrency = 1;
	assert.equal(queue.isSaturated, true);

	queue.concurrency = 2;
	assert.equal(queue.pending, 2);
	assert.equal(queue.isSaturated, true);

	queue.concurrency = 3;
	assert.equal(queue.pending, 3);
	assert.equal(queue.size, 0);
	assert.equal(queue.isSaturated, false);

	for (const {resolve} of deferreds) {
		resolve();
	}

	await Promise.all(tasks);
});

test('lowering concurrency below the running tasks starts no waiting task until enough tasks finish', async () => {
	const queue = new PQueue({concurrency: 2});
	const deferreds = [pDefer(), pDefer(), pDefer()];
	const tasks = deferreds.map(async ({promise}) => queue.add(async () => promise));

	queue.concurrency = 1;

	deferreds[0]!.resolve();
	await tasks[0];
	await flush();
	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 1);
	assert.equal(queue.isSaturated, true);

	deferreds[1]!.resolve();
	await tasks[1];
	await flush();
	assert.equal(queue.pending, 1);
	assert.equal(queue.size, 0);
	assert.equal(queue.isSaturated, false);

	deferreds[2]!.resolve();
	await queue.onIdle();
});

test('runningTasks has the last priority after several setPriority calls', async () => {
	const queue = new PQueue({concurrency: 1});
	const {promise, resolve} = pDefer();

	queue.add(async () => promise, {id: 'blocker'});
	let priorityWhileRunning: number | undefined;
	const task = queue.add(() => {
		priorityWhileRunning = queue.runningTasks.find(({id}) => id === 'task')?.priority;
	}, {id: 'task', priority: 1});

	queue.setPriority('task', 5);
	queue.setPriority('task', -2);
	queue.setPriority('task', -2);
	resolve();
	await task;

	assert.equal(priorityWhileRunning, -2);
});

test('runningTasks keeps the priority when setPriority throws for a running task', async () => {
	const queue = new PQueue({concurrency: 1});
	const {promise, resolve} = pDefer();

	const task = queue.add(async () => promise, {id: 'running', priority: 3});

	assert.throws(() => {
		queue.setPriority('running', 7);
	}, ReferenceError);
	assert.equal(queue.runningTasks[0]?.priority, 3);

	resolve();
	await task;
});

test('runningTasks has the priority set by setPriority with a custom queue class', async () => {
	const queue = new PQueue({concurrency: 1, queueClass: FifoQueue});
	const {promise, resolve} = pDefer();
	const started: Array<{id: string | undefined; priority: number | undefined}> = [];
	const task = () => {
		const [{id, priority}] = queue.runningTasks;
		started.push({id, priority});
	};

	queue.add(async () => promise);
	queue.add(task, {id: 'first', priority: 1});
	queue.add(task, {id: 'second'});

	queue.setPriority('second', 9);
	queue.setPriority('first', 4);
	resolve();
	await queue.onIdle();

	// The custom queue ignores priorities, so the tasks run in the order they were added.
	assert.deepEqual(started, [{id: 'first', priority: 4}, {id: 'second', priority: 9}]);
});
