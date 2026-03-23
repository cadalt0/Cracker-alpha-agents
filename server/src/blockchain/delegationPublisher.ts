import { createPublicClient, createWalletClient, getContract, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { viemChainForId } from "./viemChain.js";

const smartAccountAbi = parseAbi([
  "function setDelegation(string tokenName_, address token_, bytes permissionsContext_, address delegationManager_, uint256 maxAmountPerTx_, uint64 expiry_, bool enabled_) external",
]);

/**
 * ERC-7715 `permissionsContext` makes calldata very large. Some RPCs (e.g. Infura) return
 * "Invalid params" on eth_estimateGas for that payload even though the tx is valid.
 * Explicit gas skips estimation — same effective outcome as a successful estimate, with headroom.
 */
const SET_DELEGATION_GAS = 12_000_000n;

export type DelegationPublishInput = {
  smartAccountAddress: `0x${string}`;
  permissionsContext: `0x${string}`;
  delegationManager: `0x${string}`;
  tokenAddress: `0x${string}`;
  tokenDecimals: number;
  maxAmount: string;
  expiry: number;
  tokenName?: string;
};

export async function publishDelegationOnchain(input: DelegationPublishInput): Promise<`0x${string}`> {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY is required");
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

  const scw = getContract({
    address: input.smartAccountAddress,
    abi: smartAccountAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  const maxAmountPerTx = parseUnits(String(input.maxAmount), input.tokenDecimals);
  const expiry = BigInt(input.expiry);

  // Match scripts/set-delegation-from-grant.mjs: single write, no fee overrides; add gas only to avoid RPC estimate issues.
  const txHash = await scw.write.setDelegation(
    [
      input.tokenName ?? "USDC",
      input.tokenAddress,
      input.permissionsContext,
      input.delegationManager,
      maxAmountPerTx,
      expiry,
      true,
    ],
    { gas: SET_DELEGATION_GAS },
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`setDelegation reverted: ${txHash}`);
  }
  return txHash;
}
