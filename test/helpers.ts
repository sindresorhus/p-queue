import process from 'node:process';
import {type TestContext} from 'node:test';
import {type Queue, type QueueAddOptions, type RunFunction} from '../source/index.js';

// Waits for the pending promise callbacks. It uses `setImmediate()`, which the tests do not mock, so it also works with mocked timers.
export const flush = async () => new Promise(resolve => {
	setImmediate(resolve);
});

// Ticks the mocked timers and waits for the pending promise callbacks. Tick to each timer separately, because the mocked `Date.now()` in a timer callback returns the end time of the whole tick, so a task that starts there would schedule its timer too late. A task that ends inside a tick also sees that end time when it starts the next task.
export const tick = async (t: TestContext, milliseconds: number) => {
	t.mock.timers.tick(milliseconds);
	await flush();
};

export const countTimers = () => process.getActiveResourcesInfo().filter(resource => resource === 'Timeout').length;

// A custom queue class that ignores priorities.
export class FifoQueue implements Queue<RunFunction, QueueAddOptions> {
	readonly #items: Array<{run: RunFunction; id: string | undefined}> = [];

	get size() {
		return this.#items.length;
	}

	enqueue(run: RunFunction, options?: Partial<QueueAddOptions>) {
		this.#items.push({run, id: options?.id});
	}

	dequeue() {
		return this.#items.shift()?.run;
	}

	filter() {
		return this.#items.map(({run}) => run);
	}

	setPriority() {} // eslint-disable-line @typescript-eslint/no-empty-function

	remove(id: string) {
		const index = this.#items.findIndex(item => item.id === id);
		if (index !== -1) {
			this.#items.splice(index, 1);
		}
	}
}
