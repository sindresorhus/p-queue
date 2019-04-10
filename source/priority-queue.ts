import {Queue, RunFunction} from './queue';
import lowerBound from './lower-bound';
import {QueueAddOptions} from './options';

export interface PriorityQueueOptions extends QueueAddOptions {
	priority: number;
}

export default class PriorityQueue implements Queue<PriorityQueueOptions> {
	private readonly queue: (PriorityQueueOptions & { run: RunFunction })[];

	constructor() {
		this.queue = [];
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

		if (this.size && this.queue[this.size - 1].priority >= options.priority) {
			this.queue.push(element);
			return;
		}

		const index = lowerBound(this.queue, element, (a, b) => b.priority - a.priority);
		this.queue.splice(index, 0, element);
	}

	dequeue(): RunFunction | undefined {
		const item = this.queue.shift();
		return item && item.run;
	}

	get size(): number {
		return this.queue.length;
	}
}
