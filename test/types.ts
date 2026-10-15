import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

const rootDirectory = path.join(import.meta.dirname, '..');

const runTsc = (...arguments_: string[]) => spawnSync(process.execPath, [tsc, ...arguments_], {encoding: 'utf8'});

// Checks `test/fixtures/types.ts` against the generated declarations, which is what users get. Strict, and also with `exactOptionalPropertyTypes`, which many users enable.
test('types', t => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p-queue-types-'));
	t.after(() => {
		fs.rmSync(directory, {recursive: true, force: true});
	});

	const build = runTsc('--project', path.join(rootDirectory, 'tsconfig.json'), '--outDir', directory, '--emitDeclarationOnly');
	t.assert.strictEqual(build.status, 0, build.stdout + build.stderr);

	// Like the package, so that the declarations are ESM.
	fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({type: 'module'}));

	const configPath = path.join(directory, 'tsconfig.json');
	fs.writeFileSync(configPath, JSON.stringify({
		extends: require.resolve('@sindresorhus/tsconfig'),
		compilerOptions: {
			noEmit: true,
			// The fixture and the declarations are in different directories.
			rootDir: path.parse(directory).root,
			exactOptionalPropertyTypes: true,
			typeRoots: [path.join(rootDirectory, 'node_modules/@types')],
			types: ['node'],
			paths: {
				'p-queue': [path.join(directory, 'index.d.ts')],
			},
		},
		files: [path.join(import.meta.dirname, 'fixtures/types.ts')],
	}));

	const check = runTsc('--project', configPath);
	t.assert.strictEqual(check.status, 0, check.stdout + check.stderr);
});
