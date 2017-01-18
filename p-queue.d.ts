
interface AddOpts {
	priority?: number
}

interface QueueOpts {
	queueClass?: Function
	concurrency?: number
}

declare class PQueue {
	public size: number
	public pending: number

	constructor(opts?: QueueOpts)

	add(fn: Function, opts?: QueueOpts): Promise<any>
	onEmpty(): Promise<any>
}

export = PQueue;
