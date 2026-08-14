// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Native (address(0)) + ERC-20 payment helpers.
library PaymentLib {
    using SafeERC20 for IERC20;

    address constant NATIVE = address(0);

    function isNative(address token) internal pure returns (bool) {
        return token == NATIVE;
    }

    function balanceOf(address token, address account) internal view returns (uint256) {
        if (isNative(token)) return account.balance;
        return IERC20(token).balanceOf(account);
    }

    /// @dev Pull `amount` from `from`. For native, require msg.value == amount (caller enforces).
    function pull(address token, address from, uint256 amount) internal {
        if (amount == 0) return;
        if (isNative(token)) {
            require(msg.value == amount, "PaymentLib: bad msg.value");
            return;
        }
        require(msg.value == 0, "PaymentLib: unexpected ETH");
        IERC20(token).safeTransferFrom(from, address(this), amount);
    }

    function push(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        require(to != address(0), "PaymentLib: zero to");
        if (isNative(token)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "PaymentLib: native send");
            return;
        }
        IERC20(token).safeTransfer(to, amount);
    }
}
