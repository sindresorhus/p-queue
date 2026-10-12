import {expectTypeOf} from 'nz';
import PQueue from '../source/index.js';

const queue = new PQueue();

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
