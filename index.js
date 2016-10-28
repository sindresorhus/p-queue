'use strict';

class PQueue {
	constructor(opts) {
		opts = Object.assign({
			concurrency: Infinity
		}, opts);

		if (opts.concurrency < 1) {
			throw new TypeError('Expected `concurrency` to be a number from 1 and up');
		}

		this.queue = [];
		this._pendingCount = 0;
		this._concurrency = opts.concurrency;
		this._resolveEmpty = () => {};
	}
	_next() {
		this._pendingCount--;

		if (this.queue.length > 0) {
			this.queue.shift()();
		} else {
			this._resolveEmpty();
		}
	}
	add(fn) {
		return new Promise((resolve, reject) => {
			const run = () => {
				this._pendingCount++;

				fn().then(
					val => {
						resolve(val);
						this._next();
					},
					err => {
						reject(err);
						this._next();
					}
				);
			};

			if (this._pendingCount < this._concurrency) {
				run();
			} else {
				this.queue.push(run);
			}
		});
	}
	onEmpty() {
		return new Promise(resolve => {
			const existingResolve = this._resolveEmpty;
			this._resolveEmpty = () => {
				existingResolve();
				resolve();
			};
		});
	}
	get size() {
		return this.queue.length;
	}
	get pending() {
		return this._pendingCount;
	}
}

module.exports = PQueue;
