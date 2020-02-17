import {Queue, RunFunction} from './queue';
import lowerBound from './lower-bound';
import {QueueAddOptions} from './options';

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

		if (this.size && this._queue[this.size - 1].priority! >= options.priority!) {
			this._queue.push(element);
			return;
		}

		const index = lowerBound(this._queue, element, (a, b) => b.priority! - a.priority!);
		this._queue.splice(index, 0, element);
	}

	dequeue(): RunFunction | undefined {
		const item = this._queue.shift();
		return item && item.run;
	}

	filter(options: Partial<PriorityQueueOptions>): RunFunction[] {
		return this._queue.filter(element => element.priority === options.priority).map(element => element.run);
	}

	get size(): number {
		return this._queue.length;
	}
}
