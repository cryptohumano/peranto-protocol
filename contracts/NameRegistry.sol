// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NameRegistry — human-readable aliases for did:peranto addresses
/// @notice Maps normalized labels (e.g. "ecolab") to an owner address.
///         The DID remains `did:peranto:<network>:<address>`; names are optional aliases.
contract NameRegistry {
    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 32;

    address public governance;
    address public treasury;
    uint256 public registrationFee;

    mapping(bytes32 => address) public ownerOf; // labelHash => owner
    mapping(address => bytes32) public primaryLabelOf; // reverse pointer (optional primary)

    event GovernanceUpdated(address indexed previous, address indexed next);
    event TreasuryUpdated(address indexed previous, address indexed next);
    event RegistrationFeeUpdated(uint256 previous, uint256 next);
    event NameRegistered(bytes32 indexed labelHash, string label, address indexed owner);
    event NameTransferred(bytes32 indexed labelHash, address indexed from, address indexed to);
    event NameReleased(bytes32 indexed labelHash, address indexed previousOwner);
    event PrimarySet(address indexed owner, bytes32 indexed labelHash);

    modifier onlyGovernance() {
        require(msg.sender == governance, "NameRegistry: not governance");
        _;
    }

    constructor(address governance_, address treasury_, uint256 registrationFee_) {
        require(governance_ != address(0), "NameRegistry: zero governance");
        require(treasury_ != address(0), "NameRegistry: zero treasury");
        governance = governance_;
        treasury = treasury_;
        registrationFee = registrationFee_;
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "NameRegistry: zero governance");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setTreasury(address next) external onlyGovernance {
        require(next != address(0), "NameRegistry: zero treasury");
        emit TreasuryUpdated(treasury, next);
        treasury = next;
    }

    function setRegistrationFee(uint256 next) external onlyGovernance {
        emit RegistrationFeeUpdated(registrationFee, next);
        registrationFee = next;
    }

    /// @notice Register a label for msg.sender. Label must be lowercase [a-z0-9-] length 3..32.
    function register(string calldata label) external payable {
        require(msg.value >= registrationFee, "NameRegistry: fee");
        bytes32 labelHash = _validateAndHash(label);
        require(ownerOf[labelHash] == address(0), "NameRegistry: taken");

        if (msg.value > 0) {
            (bool ok,) = treasury.call{value: msg.value}("");
            require(ok, "NameRegistry: fee transfer failed");
        }

        ownerOf[labelHash] = msg.sender;
        if (primaryLabelOf[msg.sender] == bytes32(0)) {
            primaryLabelOf[msg.sender] = labelHash;
            emit PrimarySet(msg.sender, labelHash);
        }
        emit NameRegistered(labelHash, label, msg.sender);
    }

    function transfer(string calldata label, address to) external {
        require(to != address(0), "NameRegistry: zero to");
        bytes32 labelHash = _validateAndHash(label);
        require(ownerOf[labelHash] == msg.sender, "NameRegistry: not owner");
        ownerOf[labelHash] = to;
        if (primaryLabelOf[msg.sender] == labelHash) {
            primaryLabelOf[msg.sender] = bytes32(0);
        }
        if (primaryLabelOf[to] == bytes32(0)) {
            primaryLabelOf[to] = labelHash;
            emit PrimarySet(to, labelHash);
        }
        emit NameTransferred(labelHash, msg.sender, to);
    }

    function release(string calldata label) external {
        bytes32 labelHash = _validateAndHash(label);
        require(ownerOf[labelHash] == msg.sender, "NameRegistry: not owner");
        ownerOf[labelHash] = address(0);
        if (primaryLabelOf[msg.sender] == labelHash) {
            primaryLabelOf[msg.sender] = bytes32(0);
        }
        emit NameReleased(labelHash, msg.sender);
    }

    function setPrimary(string calldata label) external {
        bytes32 labelHash = _validateAndHash(label);
        require(ownerOf[labelHash] == msg.sender, "NameRegistry: not owner");
        primaryLabelOf[msg.sender] = labelHash;
        emit PrimarySet(msg.sender, labelHash);
    }

    function resolve(string calldata label) external view returns (address) {
        return ownerOf[_validateAndHash(label)];
    }

    function labelHashOf(string calldata label) external pure returns (bytes32) {
        return _validateAndHash(label);
    }

    function _validateAndHash(string calldata label) internal pure returns (bytes32) {
        bytes memory b = bytes(label);
        uint256 len = b.length;
        require(len >= MIN_LENGTH && len <= MAX_LENGTH, "NameRegistry: length");
        for (uint256 i = 0; i < len; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x30 && c <= 0x39) // 0-9
                || (c >= 0x61 && c <= 0x7a) // a-z
                || c == 0x2d; // -
            require(ok, "NameRegistry: charset");
        }
        // leading/trailing hyphen not allowed
        require(b[0] != 0x2d && b[len - 1] != 0x2d, "NameRegistry: hyphen");
        return keccak256(b);
    }
}
