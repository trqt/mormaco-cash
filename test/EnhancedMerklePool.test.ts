import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { 
  EnhancedMerklePool,
  MockERC20
} from "../typechain-types";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { 
  parseEther, 
  solidityPackedKeccak256, 
  ZeroAddress,
  Signer,
  ContractTransactionResponse,
  toUtf8Bytes,
  hexlify,
  encodeBytes32String
} from "ethers";


describe("EnhancedMerklePool", function () {
  const DEPOSIT_AMOUNT = parseEther("1");
  const RELAYER_FEE = parseEther("0.001");

  async function deployFixture() {
    const [owner, relayer, ...users] = await hre.ethers.getSigners();

    const mockToken = await hre.ethers.deployContract("MockERC20", ["JoCoin Token", "JO"]);
    await mockToken.waitForDeployment();

    const leaves = users.map((user, i) => 
      solidityPackedKeccak256(
        ["bytes32", "address"],
        [encodeBytes32String(`nullifier${i}`), user.address]
      )
    );
    const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const merkleRoot = merkleTree.getHexRoot();

    const merklePool = await hre.ethers.deployContract(
      "EnhancedMerklePool",
      [merkleRoot, await mockToken.getAddress()]
    );
    await merklePool.waitForDeployment();

    // Dar tokens para as carteiras 
    for (const user of users) {
      await mockToken.mint(user.address, DEPOSIT_AMOUNT * 10n);
      await mockToken.connect(user).approve(await merklePool.getAddress(), DEPOSIT_AMOUNT * 10n);
    }

    return { 
      merklePool, 
      mockToken, 
      owner, 
      relayer, 
      users, 
      merkleTree,
      merklePoolAddress: await merklePool.getAddress(),
      mockTokenAddress: await mockToken.getAddress()
    };
  }

  describe("Basic Functionality", function () {
    it("Should initialize correctly", async function () {
      const { merklePool, mockTokenAddress } = await loadFixture(deployFixture);
      
      expect(await merklePool.token()).to.equal(mockTokenAddress);
      expect(await merklePool.DEPOSIT_AMOUNT()).to.equal(DEPOSIT_AMOUNT);
      expect(await merklePool.RELAYER_FEE()).to.equal(RELAYER_FEE);
    });

    it("Should accept ETH deposits", async function () {
      const { merklePool, users } = await loadFixture(deployFixture);
      
      const tx = await merklePool.connect(users[0]).deposit({ value: DEPOSIT_AMOUNT });
      await tx.wait();

      const filter = merklePool.filters.Deposit;
      const events = await merklePool.queryFilter(filter);
      expect(events[0].args?.[0]).to.equal(users[0].address);
      expect(events[0].args?.[1]).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should accept ERC20 deposits", async function () {
      const { merklePool, users } = await loadFixture(deployFixture);
      
      const tx = await merklePool.connect(users[0]).depositToken();
      await tx.wait();

      const filter = merklePool.filters.Deposit;
      const events = await merklePool.queryFilter(filter);
      expect(events[0].args?.[0]).to.equal(users[0].address);
      expect(events[0].args?.[1]).to.equal(DEPOSIT_AMOUNT);
    });
  });

  describe("Batch Processing", function () {
    it("Should process batch when full", async function () {
      const { merklePool, users } = await loadFixture(deployFixture);

      // 5 depósitos
      for (let i = 0; i < 5; i++) {
        const tx = await merklePool.connect(users[i]).deposit({ value: DEPOSIT_AMOUNT });
        await tx.wait();
      }

      expect(await merklePool.getCurrentBatchSize()).to.equal(0);

      const filter = merklePool.filters.BatchProcessed;
      const events = await merklePool.queryFilter(filter);
      expect(events.length).to.be.greaterThan(0);
    });
  });

  describe("Time Delay", function () {
    it("Should enforce withdrawal delay", async function () {
      const { merklePool, users, relayer, merkleTree } = await loadFixture(deployFixture);
      
      const tx = await merklePool.connect(users[0]).deposit({ value: DEPOSIT_AMOUNT });
      await tx.wait();
      
      const nullifierHash = encodeBytes32String("nullifier0");
      const leaf = solidityPackedKeccak256(
        ["bytes32", "address"],
        [nullifierHash, users[0].address]
      );
      const proof = merkleTree.getHexProof(leaf);

      await merklePool.connect(relayer).registerAsRelayer();

      await expect(
        merklePool.connect(users[0]).withdrawViaRelayer(
          nullifierHash,
          proof,
          users[0].address,
          relayer.address
        )
      ).to.be.revertedWith("Withdrawal too early");
    });

    it("Should allow withdrawal after delay", async function () {
      const { merklePool, users, relayer, merkleTree } = await loadFixture(deployFixture);
      
      const tx = await merklePool.connect(users[0]).deposit({ value: DEPOSIT_AMOUNT });
      await tx.wait();
      
      await merklePool.connect(relayer).registerAsRelayer();
      await time.increase(24 * 60 * 60 + 1);

      const nullifierHash = encodeBytes32String("nullifier0");
      const leaf = solidityPackedKeccak256(
        ["bytes32", "address"],
        [nullifierHash, users[0].address]
      );
      const proof = merkleTree.getHexProof(leaf);

      const withdrawalTx = await merklePool.connect(users[0]).withdrawViaRelayer(
        nullifierHash,
        proof,
        users[0].address,
        relayer.address
      );
      await expect(withdrawalTx).to.not.be.reverted;
    });
  });

  describe("Relayer Functionality", function () {
    it("Should register relayer and process withdrawal correctly", async function () {
      const { merklePool, users, relayer, merkleTree } = await loadFixture(deployFixture);
      
      await merklePool.connect(relayer).registerAsRelayer();
      expect(await merklePool.isRelayer(relayer.address)).to.be.true;

      const depositTx = await merklePool.connect(users[0]).deposit({ value: DEPOSIT_AMOUNT });
      await depositTx.wait();
      
      await time.increase(24 * 60 * 60 + 1);

      const nullifierHash = encodeBytes32String("nullifier0");
      const leaf = solidityPackedKeccak256(
        ["bytes32", "address"],
        [nullifierHash, users[0].address]
      );
      const proof = merkleTree.getHexProof(leaf);

      const userBalanceBefore = await hre.ethers.provider.getBalance(users[0].address);
      const relayerBalanceBefore = await hre.ethers.provider.getBalance(relayer.address);

      const withdrawalTx = await merklePool.connect(users[0]).withdrawViaRelayer(
        nullifierHash,
        proof,
        users[0].address,
        relayer.address
      );
      await withdrawalTx.wait();

      const userBalanceAfter = await hre.ethers.provider.getBalance(users[0].address);
      const relayerBalanceAfter = await hre.ethers.provider.getBalance(relayer.address);

      expect(userBalanceAfter - userBalanceBefore).to.be.closeTo(
        DEPOSIT_AMOUNT - RELAYER_FEE,
        parseEther("0.01") // Allow for gas costs
      );
      expect(relayerBalanceAfter - relayerBalanceBefore).to.equal(RELAYER_FEE);
    });
  });

  describe("Encrypted Memos", function () {
    it("Should store and retrieve encrypted memo", async function () {
      const { merklePool, users } = await loadFixture(deployFixture);
      
      const memo = hexlify(toUtf8Bytes("Encrypted message"));
      const tx = await merklePool.connect(users[0]).depositWithMemo(memo, { value: DEPOSIT_AMOUNT });
      await tx.wait();
      
      const latestBlock = await hre.ethers.provider.getBlock('latest');
      if (!latestBlock) throw new Error("Block not found");
      
      const memoHash = solidityPackedKeccak256(
        ["address", "uint256"],
        [users[0].address, latestBlock.timestamp]
      );

      expect(await merklePool.getMemo(memoHash)).to.equal(memo);
    });
  });

  describe("Dummy Transactions", function () {
    it("Should emit dummy transactions occasionally", async function () {
      const { merklePool, users } = await loadFixture(deployFixture);
      
      for (let i = 0; i < 10; i++) {
        const tx = await merklePool.connect(users[i % users.length]).deposit({ value: DEPOSIT_AMOUNT });
        await tx.wait();
      }

      const filter = merklePool.filters.DummyTransaction;
      const events = await merklePool.queryFilter(filter);
      expect(events.length).to.be.greaterThan(0);
    });
  });

  describe("Edge Cases and Security", function () {
    it("Should reject direct ETH transfers", async function () {
      const { merklePool, users, merklePoolAddress } = await loadFixture(deployFixture);
      
      await expect(
        users[0].sendTransaction({
          to: merklePoolAddress,
          value: parseEther("1")
        })
      ).to.be.revertedWith("Use deposit functions");
    });

    it("Should reject invalid deposit amounts", async function () {
      const { merklePool, users } = await loadFixture(deployFixture);
      
      await expect(
        merklePool.connect(users[0]).deposit({ 
          value: parseEther("0.5") 
        })
      ).to.be.revertedWith("Must deposit exact amount");
    });

    it("Should prevent double-spending nullifiers", async function () {
      const { merklePool, users, relayer, merkleTree } = await loadFixture(deployFixture);
      
      const depositTx = await merklePool.connect(users[0]).deposit({ value: DEPOSIT_AMOUNT });
      await depositTx.wait();
      
      await merklePool.connect(relayer).registerAsRelayer();
      await time.increase(24 * 60 * 60 + 1);

      const nullifierHash = encodeBytes32String("nullifier0");
      const leaf = solidityPackedKeccak256(
        ["bytes32", "address"],
        [nullifierHash, users[0].address]
      );
      const proof = merkleTree.getHexProof(leaf);

      // Primeiro
      const withdrawalTx = await merklePool.connect(users[0]).withdrawViaRelayer(
        nullifierHash,
        proof,
        users[0].address,
        relayer.address
      );
      await withdrawalTx.wait();

      // Segundo 
      await expect(
        merklePool.connect(users[0]).withdrawViaRelayer(
          nullifierHash,
          proof,
          users[0].address,
          relayer.address
        )
      ).to.be.revertedWith("Withdrawal already processed");
    });
  });
});
