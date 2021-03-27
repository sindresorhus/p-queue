// Adding ESM-wrapper to avoid dual package hazard:
// https://nodejs.org/api/packages.html#packages_dual_package_hazard

import { writeFileSync } from "fs";

const wrapper = `
import PQueue from "./index.js"
export default PQueue.default
`;

const wrapperPath = "./dist/wrapper.mjs";

writeFileSync(wrapperPath, wrapper);

console.log(`Added ESM-wrapper: ${wrapperPath}`);
