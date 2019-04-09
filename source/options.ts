import {Queue} from './queue';

export interface QueueAddOptions {
	[key: string]: unknown;
}

export interface Options<Q extends Queue<O>, O extends QueueAddOptions> {
	/**
	Concurrency limit. Minimum: `1`.

	@default Infinity
	*/
	concurrency?: number;

	/**
	Whether queue tasks within concurrency limit, are auto-executed as soon as they're added.

	@default true
	*/
	autoStart?: boolean;

	/**
	Class with a `enqueue` and `dequeue` method, and a `size` getter. See the [Custom QueueClass](https://github.com/sindresorhus/p-queue#custom-queueclass) section.
	*/
	queueClass?: new () => Q;

	/**
	The max number of runs in the given interval of time. Minimum: `1`.

	@default Infinity
	*/
	intervalCap?: number;

	/**
	The length of time in milliseconds before the interval count resets. Must be finite. Minimum: `0`.

	@default 0
	*/
	interval?: number;

	/**
	Whether the task must finish in the given interval or will be carried over into the next interval count.

	@default false
	*/
	carryoverConcurrencyCount?: boolean;
}

export interface DefaultAddOptions {
	/**
	Priority of operation. Operations with greater priority will be scheduled first.

	@default 0
	*/
	priority?: number;
}
