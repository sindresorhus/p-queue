export type RunFunction = () => Promise<unknown>;

export interface Queue<Options> {
	size: number;
	filter(options: Partial<Options>): Array<{}>;
	dequeue(): RunFunction | undefined;
	enqueue(run: RunFunction, options?: Partial<Options>): void;
}
