/**
 * Constants for MetaMask Permissions
 */

import { isAddress, type Hex } from 'viem';

/**
 * ERC-7715 `to` field: delegate execution to this address.
 * Uses NEXT_PUBLIC_SMART_ACCOUNT_ADDRESS when set and valid; otherwise the session account.
 */
export function delegationRecipientAddress(sessionAccountAddress: string): Hex {
  const raw =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_SMART_ACCOUNT_ADDRESS?.trim()
      : undefined;
  if (raw && isAddress(raw)) {
    return raw as Hex;
  }
  return sessionAccountAddress as Hex;
}

// USDC on Base Sepolia (Circle testnet token)
export const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// Minimal ERC-20 ABI for transfer, used when redeeming permissions
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

