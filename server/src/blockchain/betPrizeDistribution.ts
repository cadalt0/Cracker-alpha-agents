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

const BET_DISTRIBUTE_GAS = 8_000_000n;

const betAbi = parseAbi([
  "function distributeWinners(address[] winners) external",
  "function creator() view returns (address)",
  "function outcome() view returns (uint8)",
  "function hasVoted(address a) view returns (bool)",
]);

export async function distributeWinnersTx(params: {
  bet: `0x${string}`;
  winners: `0x${string}`[];
}): Promise<`0x${string}`> {
  if (!config.privateKey) throw new Error("PRIVATE_KEY is not set");
  if (params.winners.length === 0) throw new Error("No winners to distribute");

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

  const contract = getContract({
    address: params.bet,
    abi: betAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  const onchainCreator = await contract.read.creator();
  if (onchainCreator.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY signer ${account.address} is not Bet.creator() (${onchainCreator})`,
    );
  }

  const outcome = await contract.read.outcome();
  if (outcome === 0) throw new Error("Bet outcome is Unset; call setOutcome first");

  // Avoid contract revert with NotVoter(address).
  for (const w of params.winners) {
    const hasVoted = await contract.read.hasVoted([w]);
    if (!hasVoted) {
      throw new Error(`Candidate winner ${w} hasVoted=false on-chain`);
    }
  }

  const txHash = await contract.write.distributeWinners([params.winners], {
    gas: BET_DISTRIBUTE_GAS,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`distributeWinners reverted: ${txHash}`);
  return txHash;
}

