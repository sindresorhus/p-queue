
// Port of lower_bound from http://en.cppreference.com/w/cpp/algorithm/lower_bound
// Used to compute insertion index to keep queue sorted after insertion
export default function lowerBound<T>(array: T[], value: T, comp: (a: T, b: T) => number) {
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
