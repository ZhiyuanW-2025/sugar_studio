// Node 22 executes this file with --experimental-strip-types. The explicit
// extension is needed by the Node ESM loader; the application uses bundler
// resolution for the same module.
// @ts-expect-error -- intentional executable TypeScript entrypoint
import { NewtonClient } from "../lib/newton/client.ts";

const requirement = process.argv.slice(2).join(" ").trim()
  || "找500个50ml透明喷雾瓶，单价1元以内，优先源头工厂，支持定制logo。";

const result = await new NewtonClient().searchProducts(requirement);
console.log(JSON.stringify({
  taskId: result.taskId,
  count: result.products.length,
  products: result.products.slice(0, 8),
}, null, 2));
