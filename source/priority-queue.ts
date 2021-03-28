import {Queue, RunFunction} from './queue.js';
import lowerBound from './lower-bound.js';
import {QueueAddOptions} from './options.js';

export interface PriorityQueueOptions extends QueueAddOptions {
	priority?: number;
}

export default class PriorityQueue implements Queue<RunFunction, PriorityQueueOptions> {
	private readonly _queue: Array<PriorityQueueOptions & {run: RunFunction}> = [];

	enqueue(run: RunFunction, options?: Partial<PriorityQueueOptions>): void {
		options = {
			priority: 0,
			...options
		};

		const element = {
			priority: options.priority,
			run
		};

		if (this.size && this._queue[this.size - 1]?.priority! >= options.priority!) {
			this._queue.push(element);
			return;
		}

		const index = lowerBound(
			this._queue, element,
			(a: Readonly<PriorityQueueOptions>, b: Readonly<PriorityQueueOptions>) => b.priority! - a.priority!
		);
		this._queue.splice(index, 0, element);
	}

	dequeue(): RunFunction | undefined {
		const item = this._queue.shift();
		return item?.run;
	}

	filter(options: Readonly<Partial<PriorityQueueOptions>>): RunFunction[] {
		return this._queue.filter(
			(element: Readonly<PriorityQueueOptions>) => element.priority === options.priority
		).map((element: Readonly<{run: RunFunction}>) => element.run);
	}

	get size(): number {
		return this._queue.length;
	}
}
