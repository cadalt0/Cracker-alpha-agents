// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/// @notice On-chain ZK proof verification. Replace stubs with real verifiers once circuits are fixed.
interface IZKVerifier {
    function verify(bytes calldata proof, bytes calldata publicInputs) external view returns (bool);
}
