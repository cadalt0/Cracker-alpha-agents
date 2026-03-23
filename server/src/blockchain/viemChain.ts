import { defineChain, type Chain } from "viem";
import { baseSepolia, mainnet, sepolia } from "viem/chains";

const KNOWN_CHAINS: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  84532: baseSepolia,
};

/** Same mapping as `scripts/set-delegation-from-grant.mjs` — known chains get full viem metadata (fees, etc.). */
export function viemChainForId(chainId: number, rpcUrl: string): Chain {
  const known = KNOWN_CHAINS[chainId];
  if (known) return known;
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}
