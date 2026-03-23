export interface AgentLookupResponse {
  id: string;
  walletAddress: string;
  agentName: string;
  smartAccountAddress: string | null;
  delegationJson: unknown | null;
  createdAt: string;
  updatedAt: string;
}

const API_BASE = 'https://powerful-bastion-03905-64290c3ec45c.herokuapp.com';

export async function fetchAgentByWalletAddress(
  walletAddress: string
): Promise<AgentLookupResponse> {
  const response = await fetch(
    `${API_BASE}/api/agents/${encodeURIComponent(walletAddress)}`,
    {
      method: 'GET',
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw new Error(`Agent lookup failed with status ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const smartAccountAddress =
    typeof data.smartAccountAddress === 'string'
      ? data.smartAccountAddress
      : typeof data.smartaccountaddress === 'string'
        ? data.smartaccountaddress
        : null;

  return {
    id: String(data.id ?? ''),
    walletAddress: String(data.walletAddress ?? walletAddress),
    agentName: String(data.agentName ?? 'cracker'),
    smartAccountAddress,
    delegationJson: data.delegationJson ?? null,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
  };
}

export interface PublishDelegationBodyConfig {
  tokenAddress: string;
  tokenDecimals: number;
  maxAmount: string;
  expiry: number;
}

export interface PublishDelegationBody {
  permissionsContext: string;
  delegationManager: string;
  tokenName: string;
  config: PublishDelegationBodyConfig;
}

export interface PublishDelegationStartResponse {
  jobId: number;
  status: 'pending' | 'success' | 'failed';
  walletAddress: string;
  smartAccountAddress: string;
  txHash?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PublishDelegationJobResponse {
  id: number;
  walletAddress: string;
  smartAccountAddress: string;
  status: 'pending' | 'success' | 'failed';
  txHash: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function startPublishDelegation(
  walletAddress: string,
  body: PublishDelegationBody
): Promise<PublishDelegationStartResponse> {
  const response = await fetch(
    `${API_BASE}/api/agents/${encodeURIComponent(walletAddress)}/delegation/publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Delegation publish failed with status ${response.status}${text ? `: ${text}` : ''}`
    );
  }

  return (await response.json()) as PublishDelegationStartResponse;
}

export async function getPublishDelegationJob(
  walletAddress: string,
  jobId: number
): Promise<PublishDelegationJobResponse> {
  const response = await fetch(
    `${API_BASE}/api/agents/${encodeURIComponent(
      walletAddress
    )}/delegation/jobs/${jobId}`,
    {
      method: 'GET',
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Delegation job fetch failed with status ${response.status}${text ? `: ${text}` : ''}`
    );
  }

  return (await response.json()) as PublishDelegationJobResponse;
}
