// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SchemaRegistry — immutable credential type definitions for did:peranto
contract SchemaRegistry {
    address public governance;
    mapping(address => bool) public publishers;
    mapping(bytes32 => Schema) private schemas;

    struct Schema {
        bytes32 schemaHash;
        string uri;
        address publisher;
        uint64 registeredAt;
        bool exists;
    }

    event GovernanceUpdated(address indexed previous, address indexed next);
    event PublisherUpdated(address indexed publisher, bool allowed);
    event SchemaRegistered(
        bytes32 indexed schemaId,
        bytes32 schemaHash,
        string uri,
        address indexed publisher
    );

    modifier onlyGovernance() {
        require(msg.sender == governance, "SchemaRegistry: not governance");
        _;
    }

    constructor(address governance_) {
        require(governance_ != address(0), "SchemaRegistry: zero governance");
        governance = governance_;
        publishers[governance_] = true;
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "SchemaRegistry: zero governance");
        address prev = governance;
        governance = next;
        publishers[next] = true;
        emit GovernanceUpdated(prev, next);
    }

    function setPublisher(address publisher, bool allowed) external onlyGovernance {
        publishers[publisher] = allowed;
        emit PublisherUpdated(publisher, allowed);
    }

    function registerSchema(bytes32 schemaId, bytes32 schemaHash, string calldata uri)
        external
    {
        require(publishers[msg.sender], "SchemaRegistry: not publisher");
        require(schemaId != bytes32(0), "SchemaRegistry: empty id");
        require(schemaHash != bytes32(0), "SchemaRegistry: empty hash");
        require(!schemas[schemaId].exists, "SchemaRegistry: already exists");

        schemas[schemaId] = Schema({
            schemaHash: schemaHash,
            uri: uri,
            publisher: msg.sender,
            registeredAt: uint64(block.timestamp),
            exists: true
        });

        emit SchemaRegistered(schemaId, schemaHash, uri, msg.sender);
    }

    function getSchema(bytes32 schemaId)
        external
        view
        returns (bytes32 schemaHash, string memory uri, address publisher, uint64 registeredAt, bool exists)
    {
        Schema storage s = schemas[schemaId];
        return (s.schemaHash, s.uri, s.publisher, s.registeredAt, s.exists);
    }

    function schemaExists(bytes32 schemaId) external view returns (bool) {
        return schemas[schemaId].exists;
    }
}
