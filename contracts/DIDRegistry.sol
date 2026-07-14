// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DIDRegistry — ERC-1056-inspired lightweight identity for did:peranto
/// @notice Any address is a valid DID without registration. On-chain writes enrich the DID Document.
contract DIDRegistry {
    mapping(address => address) public owners;
    mapping(address => mapping(bytes32 => mapping(address => uint256))) public delegates;
    mapping(address => uint256) public changed;
    mapping(address => bool) public deactivated;

    event DIDOwnerChanged(address indexed identity, address owner, uint256 previousChange);
    event DIDDelegateChanged(
        address indexed identity,
        bytes32 delegateType,
        address delegate,
        uint256 validTo,
        uint256 previousChange
    );
    event DIDAttributeChanged(
        address indexed identity,
        bytes32 name,
        bytes value,
        uint256 validTo,
        uint256 previousChange
    );
    event DIDDeactivated(address indexed identity, uint256 previousChange);

    modifier onlyOwner(address identity) {
        require(msg.sender == identityOwner(identity), "DIDRegistry: bad actor");
        require(!deactivated[identity], "DIDRegistry: deactivated");
        _;
    }

    function identityOwner(address identity) public view returns (address) {
        address owner = owners[identity];
        if (owner != address(0)) {
            return owner;
        }
        return identity;
    }

    function changeOwner(address identity, address newOwner) external onlyOwner(identity) {
        require(newOwner != address(0), "DIDRegistry: zero owner");
        uint256 prev = changed[identity];
        owners[identity] = newOwner;
        changed[identity] = block.number;
        emit DIDOwnerChanged(identity, newOwner, prev);
    }

    function addDelegate(
        address identity,
        bytes32 delegateType,
        address delegate,
        uint256 validity
    ) external onlyOwner(identity) {
        uint256 validTo = block.timestamp + validity;
        delegates[identity][delegateType][delegate] = validTo;
        uint256 prev = changed[identity];
        changed[identity] = block.number;
        emit DIDDelegateChanged(identity, delegateType, delegate, validTo, prev);
    }

    function revokeDelegate(address identity, bytes32 delegateType, address delegate)
        external
        onlyOwner(identity)
    {
        delegates[identity][delegateType][delegate] = 0;
        uint256 prev = changed[identity];
        changed[identity] = block.number;
        emit DIDDelegateChanged(identity, delegateType, delegate, 0, prev);
    }

    function validDelegate(address identity, bytes32 delegateType, address delegate)
        external
        view
        returns (bool)
    {
        return delegates[identity][delegateType][delegate] > block.timestamp;
    }

    function setAttribute(address identity, bytes32 name, bytes calldata value, uint256 validity)
        external
        onlyOwner(identity)
    {
        uint256 validTo = block.timestamp + validity;
        uint256 prev = changed[identity];
        changed[identity] = block.number;
        emit DIDAttributeChanged(identity, name, value, validTo, prev);
    }

    function deactivate(address identity) external onlyOwner(identity) {
        deactivated[identity] = true;
        uint256 prev = changed[identity];
        changed[identity] = block.number;
        emit DIDDeactivated(identity, prev);
    }
}
