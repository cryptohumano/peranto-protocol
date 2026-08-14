import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

describe("DisCO economy", function () {
  const PERIOD = 10n;
  const NATIVE = ethers.ZeroAddress;

  async function deployStack() {
    const [gov, alice, bob, carol] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);

    const Factory = await ethers.getContractFactory("DisCOFactory");
    const factory = await Factory.deploy(await treasury.getAddress(), gov.address, PERIOD, 0n);
    await treasury.connect(gov).setFactory(await factory.getAddress());

    await factory.connect(alice).createNode("EcosystemLab");
    await factory.connect(bob).createNode("Traductores");

    const nodeA = await ethers.getContractAt("DisCONode", await factory.allNodes(0));
    const nodeB = await ethers.getContractAt("DisCONode", await factory.allNodes(1));

    await nodeA.connect(alice).addMember(carol.address);

    return { gov, alice, bob, carol, treasury, factory, nodeA, nodeB, PERIOD };
  }

  async function deployWithToken() {
    const stack = await deployStack();
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdc = await Mock.deploy("USD Coin", "USDC", 6);
    await stack.treasury.connect(stack.gov).setTokenAllowed(await usdc.getAddress(), true);
    await usdc.mint(stack.alice.address, 1_000_000n * 10n ** 6n);
    await usdc.mint(stack.bob.address, 1_000_000n * 10n ** 6n);
    return { ...stack, usdc };
  }

  it("registers nodes via factory", async function () {
    const { treasury, nodeA, nodeB } = await deployStack();
    expect(await treasury.isNode(await nodeA.getAddress())).to.equal(true);
    expect(await treasury.isNode(await nodeB.getAddress())).to.equal(true);
    expect(await treasury.nodeCount()).to.equal(2n);
  });

  it("seeds node treasury on createNode (100% to node)", async function () {
    const [gov, alice] = await ethers.getSigners();
    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);
    const Factory = await ethers.getContractFactory("DisCOFactory");
    const factory = await Factory.deploy(await treasury.getAddress(), gov.address, PERIOD, 0n);
    await treasury.connect(gov).setFactory(await factory.getAddress());

    const seed = ethers.parseEther("5");
    await factory.connect(alice).createNode("SeededLab", { value: seed });
    const nodeAddr = await factory.allNodes(0);
    expect(await ethers.provider.getBalance(nodeAddr)).to.equal(seed);
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.equal(0n);
  });

  it("createNodeWithConfig sets reserveFloor + seed", async function () {
    const [gov, alice] = await ethers.getSigners();
    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);
    const Factory = await ethers.getContractFactory("DisCOFactory");
    const factory = await Factory.deploy(await treasury.getAddress(), gov.address, PERIOD, 0n);
    await treasury.connect(gov).setFactory(await factory.getAddress());

    const seed = ethers.parseEther("2");
    const floor = ethers.parseEther("1");
    await factory.connect(alice).createNodeWithConfig("CfgLab", floor, { value: seed });
    const node = await ethers.getContractAt("DisCONode", await factory.allNodes(0));
    expect(await node.reserveFloor(NATIVE)).to.equal(floor);
    expect(await ethers.provider.getBalance(await node.getAddress())).to.equal(seed);
  });

  it("tips: Care to sender, Love to receiver, value to receiver", async function () {
    const { alice, carol, nodeA } = await deployStack();
    const before = await ethers.provider.getBalance(carol.address);
    const tip = ethers.parseEther("1");
    await nodeA.connect(alice).tip(carol.address, NATIVE, tip, { value: tip });
    const after = await ethers.provider.getBalance(carol.address);
    expect(after - before).to.equal(tip);
    expect(await nodeA.carePoints(alice.address)).to.equal(1n);
    expect(await nodeA.lovePoints(carol.address)).to.equal(1n);
  });

  it("tips ERC-20 USDC to peer", async function () {
    const { alice, carol, nodeA, usdc } = await deployWithToken();
    const tip = 25n * 10n ** 6n;
    const token = await usdc.getAddress();
    await usdc.connect(alice).approve(await nodeA.getAddress(), tip);
    const before = await usdc.balanceOf(carol.address);
    await nodeA.connect(alice).tip(carol.address, token, tip);
    expect(await usdc.balanceOf(carol.address)).to.equal(before + tip);
    expect(await nodeA.carePoints(alice.address)).to.equal(1n);
    expect(await nodeA.lovePoints(carol.address)).to.equal(1n);
  });

  it("rejects tip with non-allowlisted token", async function () {
    const { alice, carol, nodeA } = await deployStack();
    const Mock = await ethers.getContractFactory("MockERC20");
    const bad = await Mock.deploy("Bad", "BAD", 18);
    await bad.mint(alice.address, ethers.parseEther("10"));
    await bad.connect(alice).approve(await nodeA.getAddress(), ethers.parseEther("1"));
    await expect(
      nodeA.connect(alice).tip(carol.address, await bad.getAddress(), ethers.parseEther("1"))
    ).to.be.revertedWith("DisCONode: token");
  });

  it("contribute splits 80/20 to node and protocol", async function () {
    const { alice, nodeA, treasury } = await deployStack();
    const amount = ethers.parseEther("10");
    await nodeA.connect(alice).contribute(NATIVE, amount, { value: amount });
    expect(await ethers.provider.getBalance(await nodeA.getAddress())).to.equal(
      (amount * 8000n) / 10000n
    );
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.equal(
      (amount * 2000n) / 10000n
    );
  });

  it("contribute ERC-20 splits 80/20", async function () {
    const { alice, nodeA, treasury, usdc } = await deployWithToken();
    const amount = 100n * 10n ** 6n;
    const token = await usdc.getAddress();
    await usdc.connect(alice).approve(await nodeA.getAddress(), amount);
    await nodeA.connect(alice).contribute(token, amount);
    expect(await usdc.balanceOf(await nodeA.getAddress())).to.equal((amount * 8000n) / 10000n);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal((amount * 2000n) / 10000n);
  });

  it("harvests with higher sustainBps when isolated and distributes hybrid", async function () {
    const { alice, bob, carol, nodeA, nodeB, treasury, PERIOD } = await deployStack();

    await nodeA.connect(alice).contribute(NATIVE, ethers.parseEther("100"), {
      value: ethers.parseEther("100"),
    });
    await nodeB.connect(bob).contribute(NATIVE, ethers.parseEther("100"), {
      value: ethers.parseEther("100"),
    });

    await nodeA.connect(alice).tip(carol.address, NATIVE, ethers.parseEther("0.01"), {
      value: ethers.parseEther("0.01"),
    });
    await nodeA.connect(alice).addFederationLink(await nodeB.getAddress());

    await mine(Number(PERIOD) + 1);

    const harvestPeriod = await nodeA.createdPeriod();

    await nodeA.harvest(harvestPeriod, NATIVE);
    await nodeB.harvest(harvestPeriod, NATIVE);

    const balBeforeA = await ethers.provider.getBalance(await nodeA.getAddress());
    const balBeforeB = await ethers.provider.getBalance(await nodeB.getAddress());
    const protoBefore = await ethers.provider.getBalance(await treasury.getAddress());

    await treasury.distribute(harvestPeriod, NATIVE);

    const balAfterA = await ethers.provider.getBalance(await nodeA.getAddress());
    const balAfterB = await ethers.provider.getBalance(await nodeB.getAddress());
    expect(balAfterA).to.be.gt(balBeforeA);
    expect(balAfterB).to.be.gt(balBeforeB);
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.be.lt(protoBefore);
  });

  it("harvests and distributes ERC-20 separately from native", async function () {
    const { alice, bob, carol, nodeA, nodeB, treasury, usdc, PERIOD } = await deployWithToken();
    const token = await usdc.getAddress();
    const amount = 100n * 10n ** 6n;

    await usdc.connect(alice).approve(await nodeA.getAddress(), amount);
    await usdc.connect(bob).approve(await nodeB.getAddress(), amount);
    await nodeA.connect(alice).contribute(token, amount);
    await nodeB.connect(bob).contribute(token, amount);
    await usdc.connect(alice).approve(await nodeA.getAddress(), 1n * 10n ** 6n);
    await nodeA.connect(alice).tip(carol.address, token, 1n * 10n ** 6n);

    await mine(Number(PERIOD) + 1);
    const p = await nodeA.createdPeriod();
    await nodeA.harvest(p, token);
    await nodeB.harvest(p, token);

    const beforeA = await usdc.balanceOf(await nodeA.getAddress());
    await treasury.distribute(p, token);
    expect(await usdc.balanceOf(await nodeA.getAddress())).to.be.gt(beforeA);
    await expect(treasury.distribute(p, token)).to.be.revertedWith("ProtocolTreasury: done");
  });

  it("rejects distribute twice", async function () {
    const { alice, bob, nodeA, nodeB, treasury, PERIOD } = await deployStack();
    await nodeA.connect(alice).contribute(NATIVE, ethers.parseEther("5"), {
      value: ethers.parseEther("5"),
    });
    await nodeB.connect(bob).contribute(NATIVE, ethers.parseEther("5"), {
      value: ethers.parseEther("5"),
    });
    await nodeA.connect(alice).tip(await nodeA.getAddress(), NATIVE, 1n, { value: 1 });
    await mine(Number(PERIOD) + 1);
    const p = await nodeA.createdPeriod();
    await nodeA.harvest(p, NATIVE);
    await nodeB.harvest(p, NATIVE);
    await treasury.distribute(p, NATIVE);
    await expect(treasury.distribute(p, NATIVE)).to.be.revertedWith("ProtocolTreasury: done");
  });

  it("rejects self tip", async function () {
    const { alice, nodeA } = await deployStack();
    await expect(
      nodeA.connect(alice).tip(alice.address, NATIVE, 1n, { value: 1 })
    ).to.be.revertedWith("DisCONode: self tip");
  });

  it("dissolve empties members, pays residual, unregisters node", async function () {
    const { alice, carol, nodeA, treasury } = await deployStack();
    const seed = ethers.parseEther("3");
    await alice.sendTransaction({ to: await nodeA.getAddress(), value: seed });

    const before = await ethers.provider.getBalance(alice.address);
    const tx = await nodeA.connect(alice).dissolve(alice.address);
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);

    expect(await nodeA.dissolved()).to.equal(true);
    expect(await nodeA.memberCount()).to.equal(0n);
    expect(await nodeA.isMember(alice.address)).to.equal(false);
    expect(await nodeA.isMember(carol.address)).to.equal(false);
    expect(await treasury.isNode(await nodeA.getAddress())).to.equal(false);
    expect(await ethers.provider.getBalance(await nodeA.getAddress())).to.equal(0n);
    expect(after + gas - before).to.equal(seed);

    await expect(
      nodeA.connect(alice).tip(carol.address, NATIVE, 1n, { value: 1 })
    ).to.be.revertedWith("DisCONode: dissolved");
  });

  it("dissolve returns ERC-20 residual", async function () {
    const { alice, nodeA, usdc } = await deployWithToken();
    const token = await usdc.getAddress();
    const amt = 50n * 10n ** 6n;
    await usdc.connect(alice).approve(await nodeA.getAddress(), amt);
    await nodeA.connect(alice).seedToken(token, amt);
    const before = await usdc.balanceOf(alice.address);
    await nodeA.connect(alice).dissolve(alice.address);
    expect(await usdc.balanceOf(alice.address)).to.equal(before + amt);
    expect(await usdc.balanceOf(await nodeA.getAddress())).to.equal(0n);
  });
});
