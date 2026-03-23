import {
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  parseAbi,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { viemChainForId } from "./viemChain.js";

const BET_JOIN_GAS = 1_500_000n;
const BET_FUND_DELEGATION_GAS = 12_000_000n;
const BET_VOTE_GAS = 4_000_000n;

const betReadAbi = parseAbi([
  "function voteDeadline() view returns (uint64)",
  "function joined(address a) view returns (bool)",
  "function funded(address a) view returns (bool)",
  "function hasVoted(address a) view returns (bool)",
]);

const scwAbi = parseAbi([
  "function betJoin(address bet) external",
  "function betFundWithDelegation(address bet, uint256 amount) external",
  "function betVote(address bet, bytes proof, bytes publicInputs) external",
  "function owner() view returns (address)",
  "function allowedBet() view returns (address)",
  "function delegation() view returns (string tokenName, address token, bytes permissionsContext, address delegationManager, uint256 maxAmountPerTx, uint64 expiry, bool enabled)",
]);

function unpackDelegation(d: readonly unknown[]) {
  return {
    maxAmountPerTx: d[4] as bigint,
    expiry: d[5] as bigint,
    enabled: d[6] as boolean,
  };
}

async function getScwWriter(scw: `0x${string}`, bet: `0x${string}`) {
  if (!config.privateKey) throw new Error("PRIVATE_KEY is not set");
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
    address: scw,
    abi: scwAbi,
    client: { public: publicClient, wallet: walletClient },
  });

  const owner = await contract.read.owner();
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY signer ${account.address} is not BetSmartAccount.owner() (${owner})`,
    );
  }
  const allowed = await contract.read.allowedBet();
  if (
    allowed !== "0x0000000000000000000000000000000000000000" &&
    allowed.toLowerCase() !== bet.toLowerCase()
  ) {
    throw new Error(
      `SCW allowedBet ${allowed} does not match bet ${bet}; call setAllowedBet on the SCW`,
    );
  }

  return { publicClient, contract };
}

export function participationErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export async function assertBetVoteReady(
  publicClient: PublicClient,
  bet: `0x${string}`,
  scw: `0x${string}`,
): Promise<void> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const now = Number(block.timestamp);
  const voteDl = Number(
    await publicClient.readContract({
      address: bet,
      abi: betReadAbi,
      functionName: "voteDeadline",
    }),
  );
  if (now > voteDl) {
    throw new Error(`Past voteDeadline (${voteDl}); now ${now}`);
  }
  const joined = await publicClient.readContract({
    address: bet,
    abi: betReadAbi,
    functionName: "joined",
    args: [scw],
  });
  if (!joined) throw new Error("SCW has not joined this bet");
  const funded = await publicClient.readContract({
    address: bet,
    abi: betReadAbi,
    functionName: "funded",
    args: [scw],
  });
  if (!funded) throw new Error("SCW has not funded this bet");
  const hasVoted = await publicClient.readContract({
    address: bet,
    abi: betReadAbi,
    functionName: "hasVoted",
    args: [scw],
  });
  if (hasVoted) throw new Error("SCW has already voted");
}

export async function scwBetJoinTx(params: {
  scw: `0x${string}`;
  bet: `0x${string}`;
}): Promise<`0x${string}`> {
  const { publicClient, contract } = await getScwWriter(params.scw, params.bet);
  const txHash = await contract.write.betJoin([params.bet], { gas: BET_JOIN_GAS });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`betJoin reverted: ${txHash}`);
  return txHash;
}

export async function scwBetFundWithDelegationTx(params: {
  scw: `0x${string}`;
  bet: `0x${string}`;
  amount: bigint;
}): Promise<`0x${string}`> {
  const { publicClient, contract } = await getScwWriter(params.scw, params.bet);
  const rawD = await contract.read.delegation();
  const d = unpackDelegation(rawD as readonly unknown[]);
  if (!d.enabled) throw new Error("delegation.enabled is false on SCW; publish delegation first");
  if (d.maxAmountPerTx !== 0n && params.amount > d.maxAmountPerTx) {
    throw new Error(
      `fund amount ${params.amount} exceeds delegation.maxAmountPerTx ${d.maxAmountPerTx.toString()}`,
    );
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (d.expiry !== 0n && now > d.expiry) {
    throw new Error("delegation.expiry passed on SCW");
  }
  const txHash = await contract.write.betFundWithDelegation([params.bet, params.amount], {
    gas: BET_FUND_DELEGATION_GAS,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`betFundWithDelegation reverted: ${txHash}`);
  }
  return txHash;
}

export async function scwBetVoteTx(params: {
  scw: `0x${string}`;
  bet: `0x${string}`;
  proof: `0x${string}`;
  publicInputs: `0x${string}`;
}): Promise<`0x${string}`> {
  const { publicClient, contract } = await getScwWriter(params.scw, params.bet);
  await assertBetVoteReady(publicClient, params.bet, params.scw);
  const txHash = await contract.write.betVote([params.bet, params.proof, params.publicInputs], {
    gas: BET_VOTE_GAS,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`betVote reverted: ${txHash}`);
  return txHash;
}
