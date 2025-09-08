import {expectType} from 'tsd';
import PQueue from '../source/index.js';

const queue = new PQueue();

expectType<Promise<string | void>>(queue.add(async () => '🦄'));
expectType<Promise<string>>(queue.add(async () => '🦄', {throwOnTimeout: true}));

expectType<Promise<Array<string | void>>>(queue.addAll([async () => '🦄', async () => '🦄']));
expectType<Promise<string[]>>(queue.addAll([async () => '🦄', async () => '🦄'], {throwOnTimeout: true}));

const queue2 = new PQueue({throwOnTimeout: true});

expectType<Promise<string>>(queue2.add(async () => '🦄'));
expectType<Promise<string[]>>(queue2.addAll([async () => '🦄', async () => '🦄']));
