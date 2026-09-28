import {expectTypeOf} from 'nz';
import PQueue, {TimeoutError} from '../source/index.js';

const queue = new PQueue();

expectTypeOf(queue.add(async () => '🦄')).toBe<Promise<string>>();

expectTypeOf(new TimeoutError('Task timed out')).toBeAssignableTo<DOMException>();

expectTypeOf(queue).toBeAssignableTo<EventTarget>();

queue.add(({signal}) => {
	expectTypeOf(signal).toBe<AbortSignal | undefined>();
});

queue.addEventListener('completed', event => {
	expectTypeOf(event).toBe<CustomEvent<unknown>>();
});

queue.addEventListener('error', event => {
	expectTypeOf(event).toBe<CustomEvent<unknown>>();
});

queue.addEventListener('idle', event => {
	expectTypeOf(event).toBe<Event>();
});

const onCompleted = (event: CustomEvent<unknown>) => {
	console.log(event.detail);
};

queue.addEventListener('completed', onCompleted, {once: true, signal: AbortSignal.timeout(1000)});
queue.removeEventListener('completed', onCompleted);

// @ts-expect-error: Not an event of the queue.
queue.addEventListener('unknown', () => undefined);

// @ts-expect-error: Not an event of the queue.
queue.removeEventListener('unknown', onCompleted);

// @ts-expect-error: `idle` is a plain `Event`, so a `CustomEvent` listener does not fit.
queue.addEventListener('idle', onCompleted);
