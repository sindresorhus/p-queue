import {Queue, RunFunction} from './queue';
import lowerBound from './lower-bound';
import {QueueAddOptions} from './options';

export interface PriorityQueueOptions extends QueueAddOptions {
	priority: number;
}

export default class PriorityQueue implements Queue<PriorityQueueOptions> {
	private readonly _queue: (PriorityQueueOptions & { run: RunFunction })[];

	constructor() {
		this._queue = [];
	}

	enqueue(run: RunFunction, opt?: PriorityQueueOptions): void {
		const options = {
			priority: 0,
			...opt
		};

		const element = {
			priority: options.priority,
			run
		};

		if (this.size && this._queue[this.size - 1].priority >= options.priority) {
			this._queue.push(element);
			return;
		}

		const index = lowerBound(this._queue, element, (a, b) => b.priority - a.priority);
		this._queue.splice(index, 0, element);
	}

	dequeue(): RunFunction | undefined {
		const item = this._queue.shift();
		return item && item.run;
	}

	get size(): number {
		return this._queue.length;
	}
}
