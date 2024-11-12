// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MerklePool is ReentrancyGuard {
    // Fixed deposit amount to prevent amount correlation
    uint256 public constant DEPOSIT_AMOUNT = 1 ether;
    
    // Merkle root of all valid withdrawal credentials
    bytes32 public immutable merkleRoot;
    
    // Keep track of spent nullifiers to prevent double-spending
    mapping(bytes32 => bool) public nullifierHashes;
    
    event Deposit(address indexed sender, uint256 amount);
    event Withdrawal(bytes32 nullifierHash, address indexed recipient, uint256 amount);
    
    constructor(bytes32 _merkleRoot) {
        require(_merkleRoot != bytes32(0), "Invalid merkle root");
        merkleRoot = _merkleRoot;
    }
    
    function deposit() external payable nonReentrant {
        require(msg.value == DEPOSIT_AMOUNT, "Must deposit exact amount");
        emit Deposit(msg.sender, msg.value);
    }
    
    function withdraw(
        bytes32 _nullifierHash,
        bytes32[] calldata _merkleProof,
        address _recipient
    ) external nonReentrant {
        require(_nullifierHash != bytes32(0), "Invalid nullifier hash");
        require(_recipient != address(0), "Invalid recipient");
        require(!nullifierHashes[_nullifierHash], "Withdrawal already processed");
        
        // Compute the leaf for verification
        bytes32 leaf = keccak256(abi.encodePacked(_nullifierHash, _recipient));
        
        // Verify the Merkle proof
        require(_merkleProof.length > 0, "Proof cannot be empty");
        require(
            MerkleProof.verify(_merkleProof, merkleRoot, leaf),
            "Invalid proof"
        );
        
        // Mark nullifier as spent
        nullifierHashes[_nullifierHash] = true;
        
        // Transfer funds
        (bool success, ) = _recipient.call{value: DEPOSIT_AMOUNT}("");
        require(success, "Transfer failed");
        
        emit Withdrawal(_nullifierHash, _recipient, DEPOSIT_AMOUNT);
    }
}
