import {type Queue, type RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

const compactionThreshold = 100;

export type PriorityQueueOptions = {
	priority?: number;
} & QueueAddOptions;

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	readonly #queue: Array<PriorityQueueOptions & {run: RunFunction}> = [];

	// The queue is stored as a sorted array, but dequeued items are left before `#head` until compaction. Only items from `#head` onward are live, which keeps repeated dequeues amortized O(1).
	#head = 0;

	enqueue(run: RunFunction, options?: Partial<PriorityQueueOptions>): void {
		const {
			priority = 0,
			id,
		} = options ?? {};

		const {size} = this;
		const element = {
			priority,
			id,
			run,
		};

		if (size === 0) {
			// When the queue is logically empty, discard any consumed prefix before accepting new work.
			this.#queue.length = 0;
			this.#head = 0;
			this.#queue.push(element);
			return;
		}

		if (this.#queue.at(-1)!.priority! >= priority) {
			// Same-priority and lower-priority items belong after the current tail. Appending preserves FIFO order for equal priorities.
			this.#queue.push(element);
			return;
		}

		// Binary insertion must run on the live sorted range only.
		this.#compact();
		const index = lowerBound(this.#queue, element, (a: Readonly<PriorityQueueOptions>, b: Readonly<PriorityQueueOptions>) => b.priority! - a.priority!);
		this.#queue.splice(index, 0, element);
	}

	setPriority(id: string, priority: number) {
		// A dequeued item with the same id is no longer part of the queue.
		const index = this.#queue.findIndex((element: Readonly<PriorityQueueOptions>, index) => index >= this.#head && element.id === id);
		if (index === -1) {
			throw new ReferenceError(`No promise function with the id "${id}" exists in the queue.`);
		}

		const [item] = this.#queue.splice(index, 1);
		this.enqueue(item!.run, {priority, id});
	}

	remove(id: string): void;
	remove(run: RunFunction): void;
	remove(idOrRun: string | RunFunction): void {
		const index = this.#queue.findIndex((element: Readonly<PriorityQueueOptions & {run: RunFunction}>, index) => {
			// The consumed prefix may still contain references that should not be removable.
			if (index < this.#head) {
				return false;
			}

			if (typeof idOrRun === 'string') {
				return element.id === idOrRun;
			}

			return element.run === idOrRun;
		});

		if (index !== -1) {
			this.#queue.splice(index, 1);
		}
	}

	dequeue(): RunFunction | undefined {
		if (this.#head === this.#queue.length) {
			return undefined;
		}

		const item = this.#queue[this.#head];
		this.#head++;

		if (this.#head === this.#queue.length) {
			// Fully drained queues are reset immediately so the next enqueue starts from a clean array.
			this.#queue.length = 0;
			this.#head = 0;
		} else if (this.#head > compactionThreshold && this.#head > this.#queue.length / 2) {
			// Keep repeated dequeues cheap, but stop the consumed prefix from growing without bound.
			this.#compact();
		}

		return item?.run;
	}

	filter(options: Readonly<Partial<PriorityQueueOptions>>): RunFunction[] {
		const result: RunFunction[] = [];

		for (let index = this.#head; index < this.#queue.length; index++) {
			const element = this.#queue[index]!;
			if (element.priority === options.priority) {
				result.push(element.run);
			}
		}

		return result;
	}

	get size(): number {
		return this.#queue.length - this.#head;
	}

	#compact(): void {
		// Compaction restores the invariant that the whole array is the live sorted range.
		if (this.#head === 0) {
			return;
		}

		this.#queue.splice(0, this.#head);
		this.#head = 0;
	}
}
