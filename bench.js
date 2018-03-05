'use strict';
const Benchmark = require('benchmark');
const PQueue = require('.');

const suite = new Benchmark.Suite();

suite
	.add('baseline', deferred => {
		const queue = new PQueue();

		for (let i = 0; i < 100; i++) {
			queue.add(() => Promise.resolve());
		}

		queue.onEmpty().then(() => deferred.resolve());
	})
	.add('operation with random priority', deferred => {
		const queue = new PQueue();

		for (let i = 0; i < 100; i++) {
			queue.add(() => Promise.resolve(), {
				priority: Math.random() * 100 | 0
			});
		}

		queue.onEmpty().then(() => deferred.resolve());
	})
	.add('operation with increasing priority', deferred => {
		const queue = new PQueue();

		for (let i = 0; i < 100; i++) {
			queue.add(() => Promise.resolve(), {
				priority: i
			});
		}

		queue.onEmpty().then(() => deferred.resolve());
	})
	.on('cycle', event => {
		console.log(String(event.target));
	})
	.on('complete', function () {
		console.log('Fastest is ' + this.filter('fastest').map('name'));
	})
	.run({
		defer: true,
		async: true
	});
