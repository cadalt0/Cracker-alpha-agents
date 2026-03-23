'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useWeb3Auth } from '@web3auth/modal/react';
import { isAddress } from 'viem';
import { useAccount } from 'wagmi';
import PlaygroundHeader from '@/components/PlaygroundHeader';
import PermissionDetailsBox from '@/components/PermissionDetailsBox';
import RequirementsWarning from '@/components/RequirementsWarning';
import StatusDisplay from '@/components/StatusDisplay';
import WalletClientStatus from '@/components/WalletClientStatus';
import { useChainSwitch } from '@/hooks/useChainSwitch';
import { useWalletClient } from '@/hooks/useWalletClient';
import {
  fetchAgentByWalletAddress,
  getPublishDelegationJob,
  startPublishDelegation,
  type AgentLookupResponse,
} from '@/lib/agents-api';
import { requestCustomPermission } from '@/lib/metamask-permissions/request-custom';
import { type PermissionConfig } from '@/lib/metamask-permissions/types';
import { ThemeProvider } from 'next-themes';
import { DottedSurface } from '@/components/ui/dotted-surface';

function getFixedStreamConfig(nowSeconds: number, agentName: string): PermissionConfig {
  const oneWeekSeconds = 7 * 24 * 60 * 60;
  const maxAmountUsdc = 10;
  const amountPerSecond = (maxAmountUsdc / oneWeekSeconds).toFixed(12);

  return {
    permissionType: 'erc20-token-stream',
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    amountPerSecond,
    initialAmount: '0',
    maxAmount: String(maxAmountUsdc),
    tokenDecimals: 6,
    startTime: nowSeconds,
    expiry: nowSeconds + oneWeekSeconds,
    justification: `Give delegation to ${agentName}: 10 USDC streaming permission valid for 1 week`,
    isAdjustmentAllowed: false,
    chainId: 84532,
  };
}

export default function AddressDelegationPage() {
  const params = useParams<{ walletAddress: string }>();
  const rawWalletAddress = decodeURIComponent(params.walletAddress ?? '');

  const { provider } = useWeb3Auth();
  const { address: connectedAddress } = useAccount();
  const { walletClient, isSettingUp } = useWalletClient(
    !!connectedAddress,
    connectedAddress,
    provider
  );
  useChainSwitch(!!connectedAddress);

  const [agent, setAgent] = useState<AgentLookupResponse | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [delegationJson, setDelegationJson] = useState<string>('');
  const [publishJob, setPublishJob] = useState<{
    jobId: number;
    status: 'pending' | 'success' | 'failed';
    txHash: string | null;
    errorMessage: string | null;
  } | null>(null);

  const [status, setStatus] = useState<{
    type: 'info' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [output, setOutput] = useState('');
  const [permissionsContext, setPermissionsContext] = useState<string | null>(null);
  const [delegationManager, setDelegationManager] = useState<string | null>(null);
  const [permissionConfig, setPermissionConfig] = useState<PermissionConfig | null>(null);
  const [userAccountAddress, setUserAccountAddress] = useState<string | null>(null);
  const [userAccountIsUpgraded, setUserAccountIsUpgraded] = useState<boolean | null>(null);

  const walletAddressIsValid = useMemo(
    () => isAddress(rawWalletAddress),
    [rawWalletAddress]
  );

  useEffect(() => {
    if (!walletAddressIsValid) {
      setLookupError('Invalid address in URL. Use /address/0x...');
      setLookupLoading(false);
      setAgent(null);
      return;
    }

    let isMounted = true;
    setLookupLoading(true);
    setLookupError(null);

    fetchAgentByWalletAddress(rawWalletAddress)
      .then((result) => {
        if (!isMounted) return;
        setAgent(result);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        const message =
          error instanceof Error ? error.message : 'Failed to load agent by address.';
        setLookupError(message);
      })
      .finally(() => {
        if (!isMounted) return;
        setLookupLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [rawWalletAddress, walletAddressIsValid]);

  const smartAccountAddress = agent?.smartAccountAddress ?? null;
  const delegationBlocked = !smartAccountAddress;

  const requestDelegation = async () => {
    if (!connectedAddress) {
      setStatus({ type: 'error', message: 'Connect wallet first.' });
      return;
    }
    if (!walletClient) {
      setStatus({ type: 'error', message: 'Wallet client is not ready yet.' });
      return;
    }
    if (!smartAccountAddress) {
      setStatus({
        type: 'error',
        message:
          'smartAccountAddress is missing for this user. Delegation is blocked.',
      });
      return;
    }

    const agentName = agent?.agentName ?? 'agent';
    const config = getFixedStreamConfig(Math.floor(Date.now() / 1000), agentName);
    setRequesting(true);
    setOutput('');
    setStatus({
      type: 'info',
      message: `Requesting delegation to ${agentName} in MetaMask...`,
    });

    try {
      const result = await requestCustomPermission(
        config,
        smartAccountAddress,
        walletClient,
        connectedAddress,
        smartAccountAddress
      );

      const permissionsContextValue = result.permission?.permissionsContext || null;
      const delegationManagerValue = result.permission?.delegationManager || null;
      const userAddress = result.userAccount?.address || null;
      const upgraded = result.userAccount?.isUpgraded || false;

      if (!permissionsContextValue || !delegationManagerValue) {
        throw new Error('Missing permissionsContext or delegationManager in permission response.');
      }

      setPermissionsContext(permissionsContextValue);
      setDelegationManager(delegationManagerValue);
      setPermissionConfig(config);
      setUserAccountAddress(userAddress);
      setUserAccountIsUpgraded(upgraded);

      const baseJsonPayload = {
        userAddressFromUrl: rawWalletAddress,
        agentId: agent?.id ?? null,
        agentName,
        smartAccountAddress,
        fixedPermission: config,
        permissionResponse: result.permission,
      };

      setDelegationJson(JSON.stringify(baseJsonPayload, null, 2));

      setStatus({
        type: 'info',
        message: 'Delegation created. Publishing on-chain (job queued)...',
      });

      const startResponse = await startPublishDelegation(rawWalletAddress, {
        permissionsContext: permissionsContextValue,
        delegationManager: delegationManagerValue,
        tokenName: 'USDC',
        config: {
          tokenAddress: config.tokenAddress!,
          tokenDecimals: config.tokenDecimals,
          maxAmount: config.maxAmount!,
          expiry: config.expiry,
        },
      });

      setPublishJob({
        jobId: startResponse.jobId,
        status: startResponse.status,
        txHash: startResponse.txHash ?? null,
        errorMessage: startResponse.errorMessage ?? null,
      });

      setStatus({
        type: 'info',
        message: `Publish job started. Polling (jobId: ${startResponse.jobId})...`,
      });

      // Poll job until it becomes success|failed.
      const startedAt = Date.now();
      const pollIntervalMs = 3000;
      const timeoutMs = 10 * 60 * 1000; // 10 minutes

      while (true) {
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error('Timed out while waiting for delegation publish job.');
        }

        const job = await getPublishDelegationJob(rawWalletAddress, startResponse.jobId);

        setPublishJob({
          jobId: startResponse.jobId,
          status: job.status,
          txHash: job.txHash,
          errorMessage: job.errorMessage,
        });

        if (job.status === 'success') {
          const jsonPayload = {
            ...baseJsonPayload,
            onchainPublishJob: job,
          };

          const jsonText = JSON.stringify(jsonPayload, null, 2);
          setDelegationJson(jsonText);
          setOutput(jsonText);

          setStatus({
            type: 'success',
            message: `Published on-chain. Hash: ${job.txHash ?? 'unknown'}`,
          });
          break;
        }

        if (job.status === 'failed') {
          const jsonPayload = {
            ...baseJsonPayload,
            onchainPublishJob: job,
          };

          const jsonText = JSON.stringify(jsonPayload, null, 2);
          setDelegationJson(jsonText);
          setOutput(jsonText);

          setStatus({
            type: 'error',
            message: job.errorMessage ?? 'Delegation publish job failed.',
          });
          break;
        }

        // pending: wait and poll again
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Delegation request failed.';
      setStatus({ type: 'error', message });
      setOutput(`Error: ${message}`);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <DottedSurface className="address-dotted" />
      <div className="dev-playground address-ui">
        <PlaygroundHeader />

        <div className="container-wrapper">
          <div className="container-main">
            <RequirementsWarning />

          <div className="address-hero" style={{ marginTop: '1rem' }}>
            <div className="address-hero-kicker">Cracker Delegation</div>
            <div className="address-hero-title">
              Give delegation to <span className="address-hero-agent">{agent?.agentName ?? 'agent'}</span>
            </div>
            <div className="address-hero-subtitle">
              Fixed ERC-7715 permission: USDC stream only (max 10 USDC) for 1 week. Delegation JSON will appear after creation.
            </div>
            <div className="address-hero-meta">
              URL user wallet: <code>{rawWalletAddress}</code>
            </div>
          </div>

          {lookupLoading && <div className="status info">Loading agent data...</div>}
          {lookupError && <div className="status error">{lookupError}</div>}

          <WalletClientStatus
            isConnected={!!connectedAddress}
            connectedAddress={connectedAddress}
            walletClient={walletClient}
            isSettingUp={isSettingUp}
          />

          <div className="address-grid">
            <div className="address-column address-column-left">
              {agent && (
                <div className="card">
                  <div className="card-title">Agent</div>
                  <p><strong>Name:</strong> {agent.agentName}</p>
                  <p><strong>User Wallet:</strong> {agent.walletAddress}</p>
                  <p>
                    <strong>Smart Account:</strong> {smartAccountAddress || 'Not available'}
                  </p>
                  {delegationBlocked && (
                    <p className="text-danger">
                      Delegation blocked: smartAccountAddress is null.
                    </p>
                  )}
                </div>
              )}

              <div className="card">
                <div className="card-title">Fixed Permission</div>
                <p><strong>Type:</strong> USDC streaming only</p>
                <p><strong>Amount:</strong> 10 USDC total max</p>
                <p><strong>Duration:</strong> 1 week</p>
                <button
                  type="button"
                  className="primary-action"
                  onClick={requestDelegation}
                  disabled={
                    requesting ||
                    !walletAddressIsValid ||
                    !!lookupError ||
                    !agent ||
                    delegationBlocked ||
                    !connectedAddress ||
                    !walletClient
                  }
                >
                  {requesting
                    ? 'Requesting...'
                    : `Give delegation to ${agent?.agentName ?? 'agent'}`}
                </button>
              </div>
            </div>

            <div className="address-column address-column-right">
              <StatusDisplay status={status} output={output} />

            {publishJob && (
              <div className="output address-output" style={{ marginTop: '1rem' }}>
                <div className="output-title">Publish Job</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(publishJob, null, 2)}
                </pre>
              </div>
            )}

              {delegationJson && (
                <div className="output address-output">
                  <div className="output-title">Delegation JSON</div>
                  <pre>{delegationJson}</pre>
                </div>
              )}

              <PermissionDetailsBox
                sessionAccountAddress={smartAccountAddress}
                userAccountAddress={userAccountAddress}
                userAccountIsUpgraded={userAccountIsUpgraded}
                permissionsContext={permissionsContext}
                delegationManager={delegationManager}
                config={permissionConfig}
              />
            </div>
          </div>
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
