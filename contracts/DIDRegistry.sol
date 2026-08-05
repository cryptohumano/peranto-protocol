// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DIDRegistry — ERC-1056-inspired identity for did:peranto (method v0.2)
/// @notice Any address is a valid DID without registration. Attributes are stored
///         on-chain (enumerable) and emitted as events. Delegates with type `svc`
///         may set `did/svc/*` attributes; `sigAuth` / `veriKey` enrich the Document.
contract DIDRegistry {
    /// @dev ASCII left-padded: "svc", "sigAuth", "veriKey"
    bytes32 public constant DELEGATE_SVC = bytes32("svc");
    bytes32 public constant DELEGATE_SIG_AUTH = bytes32("sigAuth");
    bytes32 public constant DELEGATE_VERI_KEY = bytes32("veriKey");

    /// @dev First 8 bytes of attribute names for DID services: "did/svc/"
    bytes8 private constant SVC_NAME_PREFIX = "did/svc/";

    mapping(address => address) public owners;
    mapping(address => mapping(bytes32 => mapping(address => uint256))) public delegates;
    mapping(address => uint256) public changed;
    mapping(address => bool) public deactivated;

    /// @notice Active attribute payloads (last write wins; cleared when expired/cleared).
    mapping(address => mapping(bytes32 => bytes)) public attributeValue;
    mapping(address => mapping(bytes32 => uint256)) public attributeValidTo;

    /// @dev Enumerable active attribute names (1-based index in `_attributeIndex`).
    mapping(address => bytes32[]) private _attributeNames;
    mapping(address => mapping(bytes32 => uint256)) private _attributeIndex;

    struct DelegateEntry {
        bytes32 delegateType;
        address delegate;
    }

    mapping(address => DelegateEntry[]) private _delegateList;
    /// @dev 1-based index into `_delegateList[identity]`.
    mapping(address => mapping(bytes32 => mapping(address => uint256))) private _delegateIndex;

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

    modifier whenActive(address identity) {
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

    function isServiceAttributeName(bytes32 name) public pure returns (bool) {
        return bytes8(name) == SVC_NAME_PREFIX;
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
        require(delegate != address(0), "DIDRegistry: zero delegate");
        require(validity > 0, "DIDRegistry: zero validity");
        uint256 validTo = block.timestamp + validity;
        delegates[identity][delegateType][delegate] = validTo;

        uint256 idx = _delegateIndex[identity][delegateType][delegate];
        if (idx == 0) {
            _delegateList[identity].push(DelegateEntry(delegateType, delegate));
            _delegateIndex[identity][delegateType][delegate] = _delegateList[identity].length;
        }

        uint256 prev = changed[identity];
        changed[identity] = block.number;
        emit DIDDelegateChanged(identity, delegateType, delegate, validTo, prev);
    }

    function revokeDelegate(address identity, bytes32 delegateType, address delegate)
        external
        onlyOwner(identity)
    {
        delegates[identity][delegateType][delegate] = 0;
        _removeDelegateEntry(identity, delegateType, delegate);
        uint256 prev = changed[identity];
        changed[identity] = block.number;
        emit DIDDelegateChanged(identity, delegateType, delegate, 0, prev);
    }

    function validDelegate(address identity, bytes32 delegateType, address delegate)
        public
        view
        returns (bool)
    {
        return delegates[identity][delegateType][delegate] > block.timestamp;
    }

    function delegateCount(address identity) external view returns (uint256) {
        return _delegateList[identity].length;
    }

    function delegateAt(address identity, uint256 index)
        external
        view
        returns (bytes32 delegateType, address delegate, uint256 validTo)
    {
        DelegateEntry storage e = _delegateList[identity][index];
        return (e.delegateType, e.delegate, delegates[identity][e.delegateType][e.delegate]);
    }

    /// @notice Owner may set any attribute. A valid `svc` delegate may set `did/svc/*` only.
    function setAttribute(address identity, bytes32 name, bytes calldata value, uint256 validity)
        external
        whenActive(identity)
    {
        address owner = identityOwner(identity);
        bool isOwner = msg.sender == owner;
        if (!isOwner) {
            require(isServiceAttributeName(name), "DIDRegistry: not service attr");
            require(validDelegate(identity, DELEGATE_SVC, msg.sender), "DIDRegistry: bad actor");
        }

        uint256 prev = changed[identity];
        changed[identity] = block.number;

        if (validity == 0) {
            _clearAttribute(identity, name);
            emit DIDAttributeChanged(identity, name, value, block.timestamp, prev);
            return;
        }

        uint256 validTo = block.timestamp + validity;
        attributeValue[identity][name] = value;
        attributeValidTo[identity][name] = validTo;

        if (_attributeIndex[identity][name] == 0) {
            _attributeNames[identity].push(name);
            _attributeIndex[identity][name] = _attributeNames[identity].length;
        }

        emit DIDAttributeChanged(identity, name, value, validTo, prev);
    }

    function getAttribute(address identity, bytes32 name)
        external
        view
        returns (bytes memory value, uint256 validTo, bool active)
    {
        validTo = attributeValidTo[identity][name];
        value = attributeValue[identity][name];
        active = validTo > block.timestamp && value.length > 0;
    }

    function attributeCount(address identity) external view returns (uint256) {
        return _attributeNames[identity].length;
    }

    function attributeNameAt(address identity, uint256 index) external view returns (bytes32) {
        return _attributeNames[identity][index];
    }

    /// @notice Active (non-expired) attributes for resolvers — skips stale slots.
    function activeAttributeCount(address identity) external view returns (uint256 count) {
        bytes32[] storage names = _attributeNames[identity];
        uint256 n = names.length;
        uint256 nowTs = block.timestamp;
        for (uint256 i = 0; i < n; i++) {
            bytes32 name = names[i];
            if (attributeValidTo[identity][name] > nowTs && attributeValue[identity][name].length > 0) {
                count++;
            }
        }
    }

    function deactivate(address identity) external onlyOwner(identity) {
        deactivated[identity] = true;
        uint256 prev = changed[identity];
        changed[identity] = block.number;
        emit DIDDeactivated(identity, prev);
    }

    function _clearAttribute(address identity, bytes32 name) internal {
        delete attributeValue[identity][name];
        delete attributeValidTo[identity][name];
        uint256 idx = _attributeIndex[identity][name];
        if (idx == 0) return;
        uint256 last = _attributeNames[identity].length;
        bytes32 lastName = _attributeNames[identity][last - 1];
        if (idx != last) {
            _attributeNames[identity][idx - 1] = lastName;
            _attributeIndex[identity][lastName] = idx;
        }
        _attributeNames[identity].pop();
        delete _attributeIndex[identity][name];
    }

    function _removeDelegateEntry(address identity, bytes32 delegateType, address delegate)
        internal
    {
        uint256 idx = _delegateIndex[identity][delegateType][delegate];
        if (idx == 0) return;
        uint256 last = _delegateList[identity].length;
        DelegateEntry storage lastEntry = _delegateList[identity][last - 1];
        if (idx != last) {
            _delegateList[identity][idx - 1] = lastEntry;
            _delegateIndex[identity][lastEntry.delegateType][lastEntry.delegate] = idx;
        }
        _delegateList[identity].pop();
        delete _delegateIndex[identity][delegateType][delegate];
    }
}
