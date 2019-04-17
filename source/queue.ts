export type RunFunction = () => Promise<unknown>;

export interface Queue<Options> {
	size: number;
	dequeue(): RunFunction | undefined;
	enqueue(run: RunFunction, options?: Options): void;
}
