import { useEffect } from 'react';
import { useChainId, useSwitchChain } from 'wagmi';
import { baseSepolia } from 'viem/chains';

export function useChainSwitch(isConnected: boolean) {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    if (isConnected && chainId !== baseSepolia.id) {
      try {
        switchChain({ chainId: baseSepolia.id });
      } catch (error) {
        console.error('Failed to switch to Base Sepolia:', error);
      }
    }
  }, [isConnected, chainId, switchChain]);
}

