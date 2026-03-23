import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  parseAbi,
  parseEventLogs,
  stringToHex,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { viemChainForId } from "./viemChain.js";

const betFactoryAbi = parseAbi([
  "event BetCreated(uint256 indexed betId, address indexed bet, address indexed creator, bytes32 betHash)",
  "function createBet((bytes32 betHash, bytes betZkProof, bytes betHints, bytes otherData, address creator, address token, uint64 joinDeadline, uint64 voteDeadline, address betVerifier, bool verifyBetAtDeploy)) external returns (address betAddr, uint256 betId)",
]);

export async function createBetWithRelayer(input: {
  betHash: `0x${string}`;
  questionRaw: string;
  startTimestampUnix: number;
  settleTimestampUnix: number;
}): Promise<{
  txHash: `0x${string}`;
  betId: bigint;
  betAddress: `0x${string}`;
}> {
  if (!config.privateKey) {
    throw new Error("PRIVATE_KEY is required for bet creation");
  }
  if (!config.betFactoryAddress) {
    throw new Error("BET_FACTORY_ADDRESS is required for bet creation");
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
    address: config.betFactoryAddress,
    abi: betFactoryAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  const joinDeadline = BigInt(input.settleTimestampUnix);
  const voteDeadline = BigInt(input.settleTimestampUnix + 300);

  const txHash = await factory.write.createBet([
    {
      betHash: input.betHash,
      betZkProof: "0x",
      betHints: stringToHex(input.questionRaw),
      otherData: zeroHash,
      creator: account.address,
      token: config.betTokenAddress,
      joinDeadline,
      voteDeadline,
      betVerifier: config.betVerifierAddress,
      verifyBetAtDeploy: false,
    },
  ]);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`createBet reverted: ${txHash}`);
  }
  const events = parseEventLogs({
    abi: betFactoryAbi,
    logs: receipt.logs,
    eventName: "BetCreated",
  });
  const evt = events[0];
  if (!evt?.args.bet || evt.args.betId === undefined) {
    throw new Error("BetCreated event not found");
  }
  return {
    txHash,
    betId: evt.args.betId,
    betAddress: evt.args.bet,
  };
}
