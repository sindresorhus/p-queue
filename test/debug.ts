import {test} from 'node:test';
import assert from 'node:assert';
import delay from 'delay';
import PQueue from '../source/index.js';

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
	const priorities = running.map(t => t.priority);
	assert.equal(priorities.length, 2);
	for (const priority of priorities) {
		assert.ok([0, 1, 2].includes(priority));
	}

	// Check that startTime is set
	for (const task of running) {
		assert.ok(task.startTime > 0);
		assert.ok(task.startTime <= Date.now());
	}

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

test('runningTasks includes timeout information', async () => {
	const queue = new PQueue({concurrency: 2, timeout: 1000});

	queue.add(async () => delay(50), {id: 'with-queue-timeout'});
	queue.add(async () => delay(50), {id: 'with-custom-timeout', timeout: 500});

	await delay(10);

	const running = queue.runningTasks;
	const withQueueTimeout = running.find(t => t.id === 'with-queue-timeout');
	const withCustomTimeout = running.find(t => t.id === 'with-custom-timeout');

	assert.equal(withQueueTimeout?.timeout, 1000);
	assert.equal(withCustomTimeout?.timeout, 500);

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

test('runningTasks handles tasks without IDs', async () => {
	const queue = new PQueue({concurrency: 2});

	queue.add(async () => delay(50));
	queue.add(async () => delay(50), {priority: 5});

	await delay(10);

	const running = queue.runningTasks;
	assert.equal(running.length, 2);

	// Tasks without explicit IDs should not have id property
	for (const task of running) {
		assert.ok(task.id === undefined || typeof task.id === 'string');
		assert.ok(typeof task.priority === 'number');
		assert.ok(typeof task.startTime === 'number');
	}

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
	assert.ok(runningCount2 >= 0 && runningCount2 <= 2, `Should have 0-2 running tasks, got ${runningCount2}`);

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

test('improved timeout error includes queue state', async () => {
	const queue = new PQueue({concurrency: 2, timeout: 50});

	// Add some tasks that will timeout but we'll catch them
	const promises = [
		(async () => {
			try {
				await queue.add(async () => delay(100), {id: 'slow-task-1'});
			} catch {
				// Ignore timeout errors for these tasks
			}
		})(),
		(async () => {
			try {
				await queue.add(async () => delay(100), {id: 'slow-task-2'});
			} catch {
				// Ignore timeout errors for these tasks
			}
		})(),
		queue.add(async () => delay(10), {id: 'fast-task'}),
	];

	try {
		await queue.add(async () => delay(100), {id: 'timeout-task'});
		assert.fail('Should have thrown timeout error');
	} catch (error: any) {
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		assert.ok(error.message.includes('timeout-task') || error.message.includes('timed out'));
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		assert.ok(error.message.includes('Queue state') || error.message.includes('queue has'));
	}

	// Wait for all tasks to complete or timeout
	await Promise.allSettled(promises);
});
