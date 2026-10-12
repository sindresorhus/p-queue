import {type Queue, type RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {type QueueAddOptions} from './options.js';

const compactionThreshold = 100;

export type PriorityQueueOptions = {
	priority?: number | undefined;
} & QueueAddOptions;

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	// The slots before `#head` are `undefined`.
	readonly #queue: Array<PriorityQueueOptions & {run: RunFunction} | undefined> = [];

	// The queue is stored as a sorted array, but dequeued slots are left before `#head` until compaction. Only items from `#head` onward are live, which keeps repeated dequeues amortized O(1).
	#head = 0;

	#compact(): void {
		// Compaction restores the invariant that the whole array is the live sorted range.
		if (this.#head === 0) {
			return;
		}

		this.#queue.splice(0, this.#head);
		this.#head = 0;
	}

	// Only the live items, because a dequeued item with the same id or function is no longer part of the queue.
	#findIndex(isMatch: (element: PriorityQueueOptions & {run: RunFunction}) => boolean): number {
		for (let index = this.#head; index < this.#queue.length; index++) {
			if (isMatch(this.#queue[index]!)) {
				return index;
			}
		}

		return -1;
	}

	// Not `dequeue()`, which a subclass can override, because `remove()` also uses it.
	#removeFirst(): RunFunction {
		const item = this.#queue[this.#head]!;
		// Drop the reference, so that the function of the task and what it holds can be garbage collected before compaction.
		this.#queue[this.#head] = undefined;
		this.#head++;

		if (this.#head === this.#queue.length) {
			// Fully drained queues are reset immediately so the next enqueue starts from a clean array.
			this.#queue.length = 0;
			this.#head = 0;
		} else if (this.#head > compactionThreshold && this.#head > this.#queue.length / 2) {
			// Keep repeated dequeues cheap, but stop the consumed prefix from growing without bound.
			this.#compact();
		}

		return item.run;
	}

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
		// Equal priorities compare as `0` first, because `Infinity - Infinity` is `NaN`.
		const index = lowerBound(this.#queue, element, (a, b) => a!.priority === b!.priority ? 0 : b!.priority! - a!.priority!);
		this.#queue.splice(index, 0, element);
	}

	setPriority(id: string, priority: number) {
		const index = this.#findIndex(element => element.id === id);
		if (index === -1) {
			throw new ReferenceError(`No promise function with the id "${id}" exists in the queue.`);
		}

		// Moving it would put it behind the tasks with the same priority.
		if (this.#queue[index]!.priority === priority) {
			return;
		}

		const [item] = this.#queue.splice(index, 1);
		this.enqueue(item!.run, {priority, id});
	}

	remove(id: string): void;
	remove(run: RunFunction): void;
	remove(idOrRun: string | RunFunction): void {
		const index = this.#findIndex(element => (typeof idOrRun === 'string' ? element.id : element.run) === idOrRun);

		// Removing the first item is O(1). Aborting many tasks with one signal removes them in the order they were added, which is the queue order when they have the same priority, and a splice for each would be O(n²).
		if (index === this.#head) {
			this.#removeFirst();
		} else if (index !== -1) {
			this.#queue.splice(index, 1);
		}
	}

	dequeue(): RunFunction | undefined {
		return this.#head === this.#queue.length ? undefined : this.#removeFirst();
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
}
