import {type Queue, type RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

export type PriorityQueueOptions = {
	priority?: number;
	uid?: string;
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
			run,
		};

		if (this.size && this.#queue[this.size - 1]!.priority! >= options.priority!) {
			this.#queue.push(element);
			return;
		}

		const index = lowerBound(
			this.#queue, element,
			(a: Readonly<PriorityQueueOptions>, b: Readonly<PriorityQueueOptions>) => b.priority! - a.priority!,
		);
		this.#queue.splice(index, 0, element);
	}

	prioritize(uid: string, priority?: number) {
		const queueIndex: number = this.#queue.findIndex((element: Readonly<PriorityQueueOptions>) => element.uid === uid);
		const [item] = this.#queue.splice(queueIndex, 1);
		if (item === undefined) {
			return;
		}

		item.priority = priority ?? ((item.priority ?? 0) + 1);
		if (this.size && this.#queue[this.size - 1]!.priority! >= priority!) {
			this.#queue.push(item);
			return;
		}

		const index = lowerBound(
			this.#queue, item,
			(a: Readonly<PriorityQueueOptions>, b: Readonly<PriorityQueueOptions>) => b.priority! - a.priority!,
		);

		this.#queue.splice(index, 0, item);
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
