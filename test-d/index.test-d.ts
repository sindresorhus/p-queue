import {expectType} from 'tsd';
import PQueue from '../source/index.js';

const queue = new PQueue();

expectType<Promise<string>>(queue.add(async () => '🦄'));
