export type RunFunction = () => Promise<unknown>;

export interface Queue<Element, Options> {
	size: number;
	filter: (options: Partial<Options>) => Element[];
	dequeue: () => Element | undefined;
	enqueue: (run: Element, options?: Partial<Options>) => void;
	/**
	Removes an entry by task.

	This is a hack because ideally it should be

	remove: (fn: Task<unknown>) => void
	*/
	remove: (fn: any) => void;
}
