import {type Queue, type RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

export type PriorityQueueOptions = {
	priority?: number;
} & QueueAddOptions;

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	readonly #queue: Array<PriorityQueueOptions & {run: RunFunction}> = [];

	enqueue(run: RunFunction, options?: Partial<PriorityQueueOptions>): void {
		options = {
			priority: 0,
			...options,
		};

		const element = {
			priority: options.priority,
			id: options.id,
			run,
		};

		if (this.size === 0 || this.#queue[this.size - 1]!.priority! >= options.priority!) {
			this.#queue.push(element);
			return;
		}

		const index = lowerBound(
			this.#queue, element,
			(a: Readonly<PriorityQueueOptions>, b: Readonly<PriorityQueueOptions>) => b.priority! - a.priority!,
		);
		this.#queue.splice(index, 0, element);
	}

	setPriority(id: string, priority: number) {
		const existingIndex: number = this.#queue.findIndex((element: Readonly<PriorityQueueOptions>) => element.id === id);
		if (existingIndex === -1) {
			throw new Error('Invalid Index - No promise function of specified id available in the queue.');
		}

		const [item] = this.#queue.splice(existingIndex, 1);
		if (item === undefined) {
			throw new Error('Undefined Item - No promise function of specified id available in the queue.');
		}

		this.enqueue(item.run, {priority, id});
	}

	dequeue(): RunFunction | undefined {
		const item = this.#queue.shift();
		return item?.run;
	}

	filter(options: Readonly<Partial<PriorityQueueOptions>>): RunFunction[] {
		return this.#queue.filter(
			(element: Readonly<PriorityQueueOptions>) => element.priority === options.priority,
		).map((element: Readonly<{run: RunFunction}>) => element.run);
	}

	get size(): number {
		return this.#queue.length;
	}
}
