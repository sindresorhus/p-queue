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
			moveToNextIntervalOnDelay: false,
			intervalCap: Infinity,
			intervalLength: 0,
			concurrency: Infinity,
			autoStart: true,
			queueClass: PriorityQueue
		}, opts);

		if (!(typeof opts.concurrency === 'number' && opts.concurrency >= 1)) {
			throw new TypeError(`Expected \`concurrency\` to be a number from 1 and up, got \`${opts.concurrency}\` (${typeof opts.concurrency})`);
		}

		if (!(typeof opts.intervalCap === 'number' && opts.intervalCap >= 1)) {
			throw new TypeError(`Expected \`intervalCap\` to be a number from 1 and up, got \`${opts.intervalCap}\` (${typeof opts.intervalCap})`);
		}

		if (!(typeof opts.intervalLength === 'number' && Number.isFinite(opts.intervalLength) && opts.intervalLength >= 0)) {
			throw new TypeError(`Expected \`intervalLength\` to be a finite number >= 0, got \`${opts.intervalLength}\` (${typeof opts.intervalLength})`);
		}

		this._concurrentCountIsNewIntervalCount = opts.moveToNextIntervalOnDelay;
		this._isIntervalIgnored = opts.intervalCap === Infinity || opts.intervalLength === 0;
		this._intervalCount = 0;
		this._intervalCap = opts.intervalCap;
		this._intervalLength = opts.intervalLength;
		this._intervalId = null;
		this._intervalEnd = 0;
		this._timeoutId = null;

		this.queue = new opts.queueClass(); // eslint-disable-line new-cap
		this._queueClass = opts.queueClass;
		this._pendingCount = 0;
		this._concurrency = opts.concurrency;
		this._isPaused = opts.autoStart === false;
		this._resolveEmpty = () => {};
		this._resolveIdle = () => {};
	}

	get _doesIntervalAllowAnother() {
		return this._isIntervalIgnored || this._intervalCount < this._intervalCap;
	}

	get _doesConcurrentAllowAnother() {
		return this._pendingCount < this._concurrency;
	}

	_next() {
		this._pendingCount--;
		this._tryToStartAnother();
	}

	_resolvePromises() {
		this._resolveEmpty();
		this._resolveEmpty = () => {};

		if (this._pendingCount === 0) {
			this._resolveIdle();
			this._resolveIdle = () => {};
		}
	}

	_onResumeInterval() {
		this._onInterval();
		this._initializeIntervalIfNeeded();
		clearTimeout(this._timeoutId);
		this._timeoutId = null;
	}

	_intervalPaused() {
		const now = Date.now();
		if (this._intervalId === null) {
			let delay = this._intervalEnd - now;
			if (delay < 0) {
				// Act as the interval was done.
				// We don't need to resume it here,
				// because it'll be resumed on line 160.
				this._intervalCount = (this._concurrentCountIsNewIntervalCount) ? this._pendingCount : 0;
			} else {
				// Act as the interval is pending.
				if (this._timeoutId === null) {
					this._timeoutId = setTimeout(() => this._onResumeInterval(), delay);
				}

				return true;
			}
		}

		return false;
	}

	_tryToStartAnother() {
		if (this.queue.size === 0) {
			// We can clear the interval ("pause")
			// because we can redo it later ("resume")
			clearInterval(this._intervalId);
			this._intervalId = null;

			this._resolvePromises();
			return false;
		}
		if (!this._isPaused) {
			const canInitalizeInterval = !this._intervalPaused();
			if (this._doesIntervalAllowAnother && this._doesConcurrentAllowAnother) {
				this.queue.dequeue()();
				if (canInitalizeInterval) {
					this._initializeIntervalIfNeeded();
				}

				return true;
			}
		}

		return false;
	}

	_initializeIntervalIfNeeded() {
		if (this._isIntervalIgnored || this._intervalId !== null) {
			return;
		}

		this._intervalId = setInterval(() => this._onInterval(), this._intervalLength);
		this._intervalEnd = Date.now() + this._intervalLength;
	}

	_onInterval() {
		if (this._intervalCount === 0 && this._pendingCount === 0) {
			clearInterval(this._intervalId);
			this._intervalId = null;
		}

		this._intervalCount = (this._concurrentCountIsNewIntervalCount) ? this._pendingCount : 0;
		while (this._tryToStartAnother()) {} // eslint-disable-line no-empty
	}

	add(fn, opts) {
		return new Promise((resolve, reject) => {
			const run = () => {
				this._pendingCount++;
				this._intervalCount++;

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
