import { RpcClient } from "./rpc/rpc.js";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const rpc = new RpcClient({ endpoint: "http://solder-solanad-3d50.devnet.rpcpool.com" });
  //   const { blockhash } = await rpc.getLatestBlockhash();
  const slot = await rpc.getSlot();
  //   const blockTime = await rpc.getBlockTime(slot);

  //   console.log({ blockhash, slot, blockTime });
  // const t0 = process.hrtime.bigint();
  const logs = await rpc.getBlockWithEvents(370406939, { programIds: [ "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"] });
  // const t1 = process.hrtime.bigint();

  // const elapsedMs = Number(t1 - t0) / 1_000_000;
  // console.log(`getBlockWithInstructions elapsedMs=${elapsedMs.toFixed(2)}`);

  // const outPath = path.resolve(process.cwd(), "logs-output.json");
  // fs.writeFileSync(
  //   outPath,
  //   JSON.stringify({ elapsedMs, result: logs }, null, 2),
  //   { encoding: "utf-8" }
  // );
  // console.log(`Wrote logs to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

