export function shallowPartialEqual(object1: any, object2: any) {
	const keys1 = Object.keys(object1);
	for (const key of keys1) {
		if (object1[key] !== object2[key]) {
			return false;
		}
	}

	return true;
}
