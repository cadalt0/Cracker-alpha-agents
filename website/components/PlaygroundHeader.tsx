'use client';

import WalletConnection from './WalletConnection';

interface PlaygroundHeaderProps {
  onDisconnect?: () => void;
  title?: string;
  subtitle?: string;
  showWallet?: boolean;
}

export default function PlaygroundHeader({
  onDisconnect,
  title = 'Cracker Delegation',
  subtitle = 'Give a fixed ERC-7715 USDC streaming delegation via MetaMask Flask',
  showWallet = true,
}: PlaygroundHeaderProps) {
  return (
    <header className="playground-header">
      <div className="playground-header-left">
        <h1 className="playground-title">{title}</h1>
        <p className="playground-subtitle">{subtitle}</p>
      </div>
      {showWallet && (
        <div className="playground-header-right">
          <WalletConnection onDisconnect={onDisconnect} />
        </div>
      )}
    </header>
  );
}

