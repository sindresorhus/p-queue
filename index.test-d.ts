import {expectType} from 'tsd-check';
import PQueue, {QueueClass} from '.';

const queue = new PQueue({concurrency: 1});
new PQueue({autoStart: false});
new PQueue({intervalCap: 1});
new PQueue({interval: 0});
new PQueue({carryoverConcurrencyCount: true});

expectType<Promise<string>>(
	queue.add(() => Promise.resolve('sindresorhus.com'))
);
expectType<Promise<string>>(queue.add(() => 'sindresorhus.com'));
expectType<Promise<string>>(queue.add(() => 'sindresorhus.com', {priority: 1}));

expectType<Promise<string[]>>(
	queue.addAll([() => Promise.resolve('oh'), () => 'hi'])
);
expectType<Promise<(string | number)[]>>(
	queue.addAll<string | number>([() => Promise.resolve('oh'), () => 1])
);
expectType<Promise<string[]>>(
	queue.addAll([() => Promise.resolve('oh'), () => 'hi'], {priority: 1})
);

expectType<Promise<void>>(queue.onEmpty());
expectType<Promise<void>>(queue.onIdle());
queue.start();
queue.pause();
queue.clear();

expectType<number>(queue.size);
expectType<number>(queue.pending);
expectType<boolean>(queue.isPaused);

class MyQueueClass implements QueueClass<{any: string}> {
	private readonly queue: Array<() => void>;

	size = 0;

	constructor() {
		this.queue = [];
	}

	enqueue(run: () => void, options: {any: string}) {
		this.queue.push(run);
	}

	dequeue() {
		return this.queue.shift();
	}
}

const queue2 = new PQueue({queueClass: MyQueueClass});
queue2.add(() => Promise.resolve(), {any: 'hi'});
