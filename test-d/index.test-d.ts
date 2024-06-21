import {expectType} from 'tsd';
import PQueue from '../source/index.js';

const queue = new PQueue();

expectType<Promise<string>>(queue.add(async () => '🦄'));
expectType<Promise<string>>(queue.add(async () => '🦄', {}));
expectType<Promise<string>>(queue.add(async () => '🦄', {throwOnTimeout: undefined}));
expectType<Promise<string>>(queue.add(async () => '🦄', {throwOnTimeout: false}));
expectType<Promise<string>>(queue.add(async () => '🦄', {throwOnTimeout: true}));
expectType<Promise<string>>(queue.add(async () => '🦄', {timeout: undefined}));
expectType<Promise<string>>(queue.add(async () => '🦄', {timeout: 1, throwOnTimeout: true}));
expectType<Promise<string | void>>(queue.add(async () => '🦄', {timeout: 1}));
expectType<Promise<string | void>>(queue.add(async () => '🦄', {timeout: 1, throwOnTimeout: undefined}));
expectType<Promise<string | void>>(queue.add(async () => '🦄', {timeout: 1, throwOnTimeout: false}));
expectType<Promise<string>>(queue.add(async () => '🦄', {priority: 1}));
