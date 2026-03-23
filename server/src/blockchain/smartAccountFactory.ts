import { createPublicClient, createWalletClient, getContract, http, parseAbi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { viemChainForId } from "./viemChain.js";

const factoryAbi = parseAbi([
  "event SmartAccountCreated(address indexed account, address indexed owner)",
  "function createSmartAccount(address owner_) external returns (address account)",
]);

export async function createSmartAccountForOwner(ownerAddress: `0x${string}`): Promise<{
  smartAccountAddress: `0x${string}`;
  txHash: `0x${string}`;
}> {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY is required for smart-account creation");
  }
  if (!config.smartAccountFactoryAddress) {
    throw new Error("SMART_ACCOUNT_FACTORY_ADDRESS is required for smart-account creation");
  }

  const chain = viemChainForId(config.chainId, config.rpcUrl);
  const account = privateKeyToAccount(config.privateKey);
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  const factory = getContract({
    address: config.smartAccountFactoryAddress as `0x${string}`,
    abi: factoryAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  const txHash = await factory.write.createSmartAccount([ownerAddress]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`createSmartAccount transaction reverted: ${txHash}`);
  }

  const logs = parseEventLogs({
    abi: factoryAbi,
    logs: receipt.logs,
    eventName: "SmartAccountCreated",
  });
  const smartAccountAddress = logs[0]?.args.account;
  if (!smartAccountAddress) {
    throw new Error("SmartAccountCreated event not found in receipt logs");
  }

  return { smartAccountAddress, txHash };
}
