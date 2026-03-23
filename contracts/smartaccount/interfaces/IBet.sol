// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/// @notice Minimal `Bet` API for smart account wrappers.
interface IBet {
    function join() external;

    function fund(uint256 amount) external;

    function vote(bytes calldata proof, bytes calldata publicInputs) external;
}
