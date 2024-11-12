// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract EnhancedMerklePool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DEPOSIT_AMOUNT = 1 ether;
    uint256 public constant WITHDRAWAL_DELAY = 24 hours;
    uint256 public constant BATCH_SIZE = 5;
    uint256 public constant RELAYER_FEE = 0.001 ether;
    
    bytes32 public immutable merkleRoot;
    IERC20 public immutable token;
    mapping(bytes32 => bool) public nullifierHashes;
    mapping(address => uint256) public depositTimestamps;
    
    // Estado do batch 
    address[] public currentBatch;
    mapping(bytes32 => bool) public processedBatches;
    
    // Mensagens criptografas 
    mapping(bytes32 => bytes) public encryptedMemos;
    
    mapping(address => bool) public approvedRelayers;
    
    event Deposit(address indexed sender, uint256 amount, uint256 timestamp);
    event BatchProcessed(bytes32 batchHash, uint256 size);
    event Withdrawal(bytes32 nullifierHash, address indexed recipient, uint256 amount);
    event DummyTransaction(uint256 timestamp);
    event MemoStored(bytes32 indexed nullifierHash, bytes encryptedMemo);
    event RelayerRegistered(address indexed relayer);
    
    constructor(bytes32 _merkleRoot, address _token) {
        require(_merkleRoot != bytes32(0), "Invalid merkle root");
        require(_token != address(0), "Invalid token address");
        merkleRoot = _merkleRoot;
        token = IERC20(_token);
    }
    
    function deposit() external payable nonReentrant {
        require(msg.value == DEPOSIT_AMOUNT, "Must deposit exact amount");
        depositTimestamps[msg.sender] = block.timestamp;
        currentBatch.push(msg.sender);
        
        if (currentBatch.length >= BATCH_SIZE) {
            processBatch();
        }
        
        emit Deposit(msg.sender, msg.value, block.timestamp);
    }
    
    // Process deposit batch
    function processBatch() internal {
        require(currentBatch.length > 0, "Empty batch");
        bytes32 batchHash = keccak256(abi.encodePacked(currentBatch));
        require(!processedBatches[batchHash], "Batch already processed");
        
        processedBatches[batchHash] = true;
        emit BatchProcessed(batchHash, currentBatch.length);
        
        // Clear batch
        delete currentBatch;
        
        // Transações fakes para aumentar a privacidade
        if (block.timestamp % 3 == 0) { // Random-like condition
            generateDummyTransaction();
        }
    }
    
    function depositWithMemo(bytes calldata encryptedMemo) external payable nonReentrant {
        require(msg.value == DEPOSIT_AMOUNT, "Must deposit exact amount");
        bytes32 memoHash = keccak256(abi.encodePacked(msg.sender, block.timestamp));

        // Criptografado off-chain
        encryptedMemos[memoHash] = encryptedMemo;
        
        depositTimestamps[msg.sender] = block.timestamp;
        emit MemoStored(memoHash, encryptedMemo);

        emit Deposit(msg.sender, DEPOSIT_AMOUNT, block.timestamp);
        
        currentBatch.push(msg.sender);
        if (currentBatch.length >= BATCH_SIZE) {
            processBatch();
        }
    }
    
    function registerAsRelayer() external {
        require(!approvedRelayers[msg.sender], "Already registered");
        approvedRelayers[msg.sender] = true;
        emit RelayerRegistered(msg.sender);
    }
    
    function withdrawViaRelayer(
        bytes32 _nullifierHash,
        bytes32[] calldata _merkleProof,
        address _recipient,
        address _relayer
    ) external nonReentrant {
        require(approvedRelayers[_relayer], "Invalid relayer");
        require(depositTimestamps[msg.sender] + WITHDRAWAL_DELAY <= block.timestamp, "Withdrawal too early");
        
        // Standard withdrawal checks
        require(_nullifierHash != bytes32(0), "Invalid nullifier hash");
        require(_recipient != address(0), "Invalid recipient");
        require(!nullifierHashes[_nullifierHash], "Withdrawal already processed");
        
        bytes32 leaf = keccak256(abi.encodePacked(_nullifierHash, _recipient));
        require(_merkleProof.length > 0, "Proof cannot be empty");
        require(MerkleProof.verify(_merkleProof, merkleRoot, leaf), "Invalid proof");
        
        nullifierHashes[_nullifierHash] = true;
        
        // Transfer funds minus relayer fee
        uint256 recipientAmount = DEPOSIT_AMOUNT - RELAYER_FEE;
        (bool successRecipient, ) = _recipient.call{value: recipientAmount}("");
        require(successRecipient, "Transfer to recipient failed");
        
        // Pay relayer fee
        (bool successRelayer, ) = _relayer.call{value: RELAYER_FEE}("");
        require(successRelayer, "Transfer to relayer failed");
        
        emit Withdrawal(_nullifierHash, _recipient, recipientAmount);
    }
   
    // Suporte à ERC-20
    function depositToken() external nonReentrant {
        token.safeTransferFrom(msg.sender, address(this), DEPOSIT_AMOUNT);
        depositTimestamps[msg.sender] = block.timestamp;
        currentBatch.push(msg.sender);

        emit Deposit(msg.sender, DEPOSIT_AMOUNT, block.timestamp);

        
        if (currentBatch.length >= BATCH_SIZE) {
            processBatch();
        }

    }
    
    function withdrawToken(
        bytes32 _nullifierHash,
        bytes32[] calldata _merkleProof,
        address _recipient
    ) external nonReentrant {
        require(depositTimestamps[msg.sender] + WITHDRAWAL_DELAY <= block.timestamp, "Withdrawal too early");
        require(_nullifierHash != bytes32(0), "Invalid nullifier hash");
        require(_recipient != address(0), "Invalid recipient");
        require(!nullifierHashes[_nullifierHash], "Withdrawal already processed");
        
        bytes32 leaf = keccak256(abi.encodePacked(_nullifierHash, _recipient));
        require(_merkleProof.length > 0, "Proof cannot be empty");
        require(MerkleProof.verify(_merkleProof, merkleRoot, leaf), "Invalid proof");
        
        nullifierHashes[_nullifierHash] = true;
        token.safeTransfer(_recipient, DEPOSIT_AMOUNT);
        
        emit Withdrawal(_nullifierHash, _recipient, DEPOSIT_AMOUNT);
    }
    
    // Gera um evento que não faz nada, só para enganar
    function generateDummyTransaction() internal {
        // Simulate activity to mask real transactions
        emit DummyTransaction(block.timestamp);
    }
    
    function getCurrentBatchSize() external view returns (uint256) {
        return currentBatch.length;
    }
    
    function getDepositTimestamp(address depositor) external view returns (uint256) {
        return depositTimestamps[depositor];
    }
    
    function getMemo(bytes32 memoHash) external view returns (bytes memory) {
        return encryptedMemos[memoHash];
    }
    
    function isRelayer(address relayer) external view returns (bool) {
        return approvedRelayers[relayer];
    }
    
    receive() external payable {
        revert("Use deposit functions");
    }
}
