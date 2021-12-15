export function shallowPartialEqual(object1: Record<string, unknown>, object2: Record<string, unknown>) {
	for (const [key, value] of Object.entries(object1)) {
		if (value !== object2[key]) {
			return false;
		}
	}

	return true;
}
