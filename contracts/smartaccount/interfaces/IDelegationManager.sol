// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/// @notice Minimal ERC-7715 DelegationManager surface (MetaMask / redeem flow).
interface IDelegationManager {
    function redeemDelegations(
        bytes[] calldata permissionContexts,
        bytes32[] calldata executionModes,
        bytes[] calldata executionCalldatas
    ) external;
}
