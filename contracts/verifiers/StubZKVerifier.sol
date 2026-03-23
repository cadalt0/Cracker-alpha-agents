// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IZKVerifier} from "../interfaces/IZKVerifier.sol";

/// @dev Testing / wiring stub. Deploy with `passResult` true only on testnets if you need claim paths to execute.
contract StubZKVerifier is IZKVerifier {
    bool public immutable passResult;

    constructor(bool passResult_) {
        passResult = passResult_;
    }

    function verify(bytes calldata, bytes calldata) external view returns (bool) {
        return passResult;
    }
}
