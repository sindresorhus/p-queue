export type RunFunction = () => Promise<unknown>;

export interface Queue<Options> {
	size: number;
	sizeBy(options: Partial<Options>): number;
	dequeue(): RunFunction | undefined;
	enqueue(run: RunFunction, options?: Partial<Options>): void;
}
