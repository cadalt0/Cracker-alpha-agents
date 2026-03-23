// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IZKVerifier} from "../interfaces/IZKVerifier.sol";

/// @notice Matches `snarkjs` Groth16 Solidity export (`verifyProof` layout).
interface IGroth16VoteVerifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[1] calldata _pubSignals
    ) external view returns (bool);
}

/// @dev Encodes proofs the same way as `zkproof/scripts/prove.mjs` (snarkjs exportSolidityCalldata order).
library Groth16VoteProofCodec {
    uint256 internal constant EXPECTED_LEN = 256;

    function decodeProof(bytes calldata proof)
        internal
        pure
        returns (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c)
    {
        require(proof.length == EXPECTED_LEN, "Groth16: proof len");
        a[0] = uint256(bytes32(proof[0:32]));
        a[1] = uint256(bytes32(proof[32:64]));
        b[0][0] = uint256(bytes32(proof[64:96]));
        b[0][1] = uint256(bytes32(proof[96:128]));
        b[1][0] = uint256(bytes32(proof[128:160]));
        b[1][1] = uint256(bytes32(proof[160:192]));
        c[0] = uint256(bytes32(proof[192:224]));
        c[1] = uint256(bytes32(proof[224:256]));
    }
}

/// @title Groth16VoteVerifierAdapter
/// @notice Implements `IZKVerifier` for `Bet`: deploy one instance per vote type pointing at the matching generated verifier.
contract Groth16VoteVerifierAdapter is IZKVerifier {
    IGroth16VoteVerifier public immutable groth16;

    constructor(address groth16Verifier) {
        groth16 = IGroth16VoteVerifier(groth16Verifier);
    }

    /// @param publicInputs `abi.encode(uint256 betIdAsField)` — 32 bytes; use same field reduction as `zkproof/scripts/field.js`.
    function verify(bytes calldata proof, bytes calldata publicInputs) external view returns (bool) {
        require(publicInputs.length == 32, "Groth16: publicInputs");
        uint256 betIdField = abi.decode(publicInputs, (uint256));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            Groth16VoteProofCodec.decodeProof(proof);
        uint256[1] memory pub = [betIdField];
        return groth16.verifyProof(a, b, c, pub);
    }
}
