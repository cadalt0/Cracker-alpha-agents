import { WEB3AUTH_NETWORK } from "@web3auth/modal";
import { type Web3AuthContextConfig } from "@web3auth/modal/react";

const clientId = "BHgArYmWwSeq21czpcarYh0EVq2WWOzflX-NTK-tY1-1pauPzHKRRLgpABkmYiIV_og9jAvoIxQ8L3Smrwe04Lw"; // get from https://dashboard.web3auth.io

const web3AuthContextConfig: Web3AuthContextConfig = {
  // Cast to any to support chainConfig in current modal version
  web3AuthOptions: {
    clientId,
    web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
    chainConfig: {
      chainNamespace: 'eip155',
      chainId: '0x14a34', // Base Sepolia chain ID: 84532
      rpcTarget: 'https://sepolia.base.org',
      displayName: 'Base Sepolia Testnet',
      blockExplorerUrl: 'https://sepolia.basescan.org',
      ticker: 'ETH',
      tickerName: 'Ethereum',
    },
  } as any,
};

export default web3AuthContextConfig;

