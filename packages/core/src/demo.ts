import { RpcClient } from "./rpc.js";

async function main() {
  const rpc = new RpcClient({ cluster: "mainnet-beta" });
//   const { blockhash } = await rpc.getLatestBlockhash();
  const slot = await rpc.getSlot();
//   const blockTime = await rpc.getBlockTime(slot);

//   console.log({ blockhash, slot, blockTime });
  const logs = await rpc.getBlockWithInstructions(370406939, { programIds: [ "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"] });

  console.log("==============DEBUG logslogs NOBODY===============");
  console.log(logs);
  console.log(logs?.transactions[0]);
  console.log("==============DEBUG NOBODY===============");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

