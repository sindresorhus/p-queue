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

        for (var p = 0; p < this.queue.length; p++) {
            if (this.queue[p].length > 0) {
                this.queue[p].shift()();
                return;
            } 
        }
        this._resolveEmpty();
	}
	add(fn, priority = 0) {
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
                if (typeof this.queue[priority] === "undefined") queue[priority] = [];
				this.queue[priority].push(run);
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
		return this.queue.reduce((len, arr) => len + arr.length, 0);
	}
	get pending() {
		return this._pendingCount;
	}
}

module.exports = PQueue;
