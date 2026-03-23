import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { viemChainForId } from "./viemChain.js";

const SET_OUTCOME_GAS = 500_000n;

const betAbi = parseAbi([
  "function setOutcome(bool yesWon, uint256 winningEscrowTotal_) external",
  "function creator() view returns (address)",
  "function totalEscrow() view returns (uint256)",
  "function outcome() view returns (uint8)",
]);

/**
 * `Bet.setOutcome` as the bet creator (must match server `PRIVATE_KEY`).
 * `winningEscrowTotal_` is the sum of escrow stakes on the winning side (see `distributeWinners`); must be in (0, totalEscrow].
 */
export async function setBetOutcomeTx(params: {
  bet: `0x${string}`;
  yesWon: boolean;
  winningEscrowTotal: bigint;
}): Promise<`0x${string}`> {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY is not set");
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

  const onchainCreator = await publicClient.readContract({
    address: params.bet,
    abi: betAbi,
    functionName: "creator",
  });
  if (onchainCreator.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY signer ${account.address} is not Bet.creator() (${onchainCreator})`,
    );
  }

  const currentOutcome = await publicClient.readContract({
    address: params.bet,
    abi: betAbi,
    functionName: "outcome",
  });
  if (currentOutcome !== 0) {
    throw new Error(`Outcome already set (on-chain outcome enum = ${currentOutcome})`);
  }

  const totalEscrow = await publicClient.readContract({
    address: params.bet,
    abi: betAbi,
    functionName: "totalEscrow",
  });
  if (params.winningEscrowTotal <= 0n) {
    throw new Error("winningEscrowTotal must be > 0");
  }
  if (params.winningEscrowTotal > totalEscrow) {
    throw new Error(
      `winningEscrowTotal ${params.winningEscrowTotal.toString()} exceeds totalEscrow ${totalEscrow.toString()}`,
    );
  }

  const contract = getContract({
    address: params.bet,
    abi: betAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  const txHash = await contract.write.setOutcome([params.yesWon, params.winningEscrowTotal], {
    gas: SET_OUTCOME_GAS,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`setOutcome reverted: ${txHash}`);
  return txHash;
}

export async function readBetTotalEscrow(bet: `0x${string}`): Promise<bigint> {
  const chain = viemChainForId(config.chainId, config.rpcUrl);
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });
  return publicClient.readContract({
    address: bet,
    abi: betAbi,
    functionName: "totalEscrow",
  });
}
