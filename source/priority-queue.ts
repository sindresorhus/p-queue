import {type Queue, type RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

export type PriorityQueueOptions = {
	priority?: number;
} & QueueAddOptions;

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	readonly #queue: Array<PriorityQueueOptions & {run: RunFunction}> = [];

	enqueue(run: RunFunction, options?: Partial<PriorityQueueOptions>): void {
		const {
			priority = 0,
			id,
		} = options ?? {};

		const element = {
			priority,
			id,
			run,
		};

		if (this.size === 0 || this.#queue[this.size - 1]!.priority! >= priority) {
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
		const index: number = this.#queue.findIndex((element: Readonly<PriorityQueueOptions>) => element.id === id);
		if (index === -1) {
			throw new ReferenceError(`No promise function with the id "${id}" exists in the queue.`);
		}

		const [item] = this.#queue.splice(index, 1);
		this.enqueue(item!.run, {priority, id});
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
