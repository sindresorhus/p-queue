'use strict';

// Port of lower_bound from http://en.cppreference.com/w/cpp/algorithm/lower_bound
// Used to compute insertion index to keep queue sorted after insertion
function lowerBound(array, value, comp) {
	let first = 0;
	let count = array.length;

	while (count > 0) {
		const step = (count / 2) | 0;
		let it = first + step;

		if (comp(array[it], value) <= 0) {
			first = ++it;
			count -= step + 1;
		} else {
			count = step;
		}
	}

	return first;
}

class PriorityQueue {
	constructor() {
		this._queue = [];
	}

	enqueue(run, opts) {
		opts = Object.assign({
			priority: 0
		}, opts);

		const element = {priority: opts.priority, run};

		if (this.size && this._queue[this.size - 1].priority >= opts.priority) {
			this._queue.push(element);
			return;
		}

		const index = lowerBound(this._queue, element, (a, b) => b.priority - a.priority);
		this._queue.splice(index, 0, element);
	}

	dequeue() {
		return this._queue.shift().run;
	}

	get size() {
		return this._queue.length;
	}
}

class PQueue {
	constructor(opts) {
		opts = Object.assign({
			carryoverConcurrencyCount: false,
			concurrency: Infinity,
			intervalLimit: Infinity,
			interval: 0,
			autoStart: true,
			queueClass: PriorityQueue
		}, opts);

		if (!(typeof opts.concurrency === 'number' && opts.concurrency >= 1)) {
			throw new TypeError(`Expected \`concurrency\` to be a number from 1 and up, got \`${opts.concurrency}\` (${typeof opts.concurrency})`);
		}
		if (!(typeof opts.intervalLimit === 'number' && opts.intervalLimit >= 1)) {
			throw new TypeError(`Expected \`intervalCap\` to be a number from 1 and up, got \`${opts.intervalLimit}\` (${typeof opts.intervalLimit})`);
		}
		if (!(typeof opts.interval === 'number' && Number.isFinite(opts.interval) && opts.interval >= 0)) {
			throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${opts.interval}\` (${typeof opts.interval})`);
		}

		this._carryoverConcurrencyCount = opts.carryoverConcurrencyCount;
		this._isPaused = opts.autoStart === false;

		this.queue = new opts.queueClass(); // eslint-disable-line new-cap
		this._queueClass = opts.queueClass;

		this._pendingCount = 0;
		this._concurrency = opts.concurrency;

		this._isIntervalIgnored = opts.intervalLimit === Infinity || opts.interval === 0;
		this._intervalCount = 0;
		this._intervalLimit = opts.intervalLimit;
		this._interval = opts.interval;
		this._intervalTimeoutId = null;
		this._intervalEnd = 0;

		this._resolveEmpty = () => {};
		this._resolveIdle = () => {};
	}

	get _doesIntervalAllowAnother() {
		return this._isIntervalIgnored || this._intervalCount < this._intervalLimit;
	}

	get _doesConcurrentAllowAnother() {
		return this._pendingCount < this._concurrency;
	}

	_next() {
		this._pendingCount--;
		this._tryToStartAnother();
		this._clearIntervalIfNeeded();
	}

	_resolvePromises() {
		this._resolveEmpty();
		this._resolveEmpty = () => {};

		if (this._pendingCount === 0) {
			this._resolveIdle();
			this._resolveIdle = () => {};
		}
	}

	_tryToStartAnother() {
		if (this.queue.size === 0) {
			this._resolvePromises();
			return false;
		}
		if (this.isPaused) {
			return false;
		}
		this._initializeIntervalIfNeeded();

		if (this._doesIntervalAllowAnother && this._doesConcurrentAllowAnother) {
			this.queue.dequeue()();
			return true;
		}
		return false;
	}

	_initializeIntervalIfNeeded() {
		if (this._isIntervalIgnored || this._intervalTimeoutId !== null) {
			return;
		}
		const now = Date.now();
		const timeoutLength = (now < this._intervalEnd) ? this._intervalEnd - now : this._interval;

		this._intervalTimeoutId = setTimeout(() => this._onInterval(), timeoutLength);
		this._intervalEnd = new Date(now + timeoutLength).getTime();
	}

	_clearIntervalIfNeeded() {
		if (this._isIntervalIgnored || this._intervalTimeoutId === null) {
			return;
		}
		if (this.queue.size === 0) {
			clearTimeout(this._intervalTimeoutId);
			this._intervalTimeoutId = null;
		}
	}

	_onInterval() {
		this._intervalTimeoutId = null;
		this._intervalCount = (this._carryoverConcurrencyCount) ? this._pendingCount : 0;
		while (this._tryToStartAnother()) {} // eslint-disable-line no-empty
	}

	add(fn, opts) {
		return new Promise((resolve, reject) => {
			const run = () => {
				this._pendingCount++;
				this._intervalCount++;
				this._initializeIntervalIfNeeded();

				try {
					Promise.resolve(fn()).then(
						val => {
							resolve(val);
							this._next();
						},
						err => {
							reject(err);
							this._next();
						}
					);
				} catch (err) {
					reject(err);
					this._next();
				}
			};
			this.queue.enqueue(run, opts);
			this._tryToStartAnother();
		});
	}

	addAll(fns, opts) {
		return Promise.all(fns.map(fn => this.add(fn, opts)));
	}

	start() {
		if (!this._isPaused) {
			return;
		}
		this._isPaused = false;
		while (this._tryToStartAnother()) {} // eslint-disable-line no-empty
	}

	pause() {
		this._isPaused = true;
	}

	clear() {
		this.queue = new this._queueClass(); // eslint-disable-line new-cap
	}

	onEmpty() {
		// Instantly resolve if the queue is empty
		if (this.queue.size === 0) {
			return Promise.resolve();
		}

		return new Promise(resolve => {
			const existingResolve = this._resolveEmpty;
			this._resolveEmpty = () => {
				existingResolve();
				resolve();
			};
		});
	}

	onIdle() {
		// Instantly resolve if none pending & if nothing else is queued
		if (this._pendingCount === 0 && this.queue.size === 0) {
			return Promise.resolve();
		}

		return new Promise(resolve => {
			const existingResolve = this._resolveIdle;
			this._resolveIdle = () => {
				existingResolve();
				resolve();
			};
		});
	}

	get size() {
		return this.queue.size;
	}

	get pending() {
		return this._pendingCount;
	}

	get isPaused() {
		return this._isPaused;
	}
}

module.exports = PQueue;
