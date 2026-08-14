import { expect } from "chai";
import { ethers } from "hardhat";

describe("NameRegistry", function () {
  const NATIVE = ethers.ZeroAddress;

  async function deploy() {
    const [gov, alice, bob] = await ethers.getSigners();
    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);
    const Factory = await ethers.getContractFactory("NameRegistry");
    const names = await Factory.deploy(gov.address, await treasury.getAddress(), 0n);
    return { names, treasury, gov, alice, bob };
  }

  it("registers and resolves a label", async function () {
    const { names, alice } = await deploy();
    await names.connect(alice).register("ecolab", NATIVE, 0n);
    expect(await names.resolve("ecolab")).to.equal(alice.address);
    expect(await names.primaryLabelOf(alice.address)).to.equal(ethers.id("ecolab"));
  });

  it("rejects taken names and invalid charset", async function () {
    const { names, alice, bob } = await deploy();
    await names.connect(alice).register("ecolab", NATIVE, 0n);
    await expect(names.connect(bob).register("ecolab", NATIVE, 0n)).to.be.revertedWith(
      "NameRegistry: taken"
    );
    await expect(names.connect(bob).register("EcoLab", NATIVE, 0n)).to.be.revertedWith(
      "NameRegistry: charset"
    );
    await expect(names.connect(bob).register("ab", NATIVE, 0n)).to.be.revertedWith(
      "NameRegistry: length"
    );
    await expect(names.connect(bob).register("-eco", NATIVE, 0n)).to.be.revertedWith(
      "NameRegistry: hyphen"
    );
  });

  it("transfers and releases names", async function () {
    const { names, alice, bob } = await deploy();
    await names.connect(alice).register("andino", NATIVE, 0n);
    await names.connect(alice).transfer("andino", bob.address);
    expect(await names.resolve("andino")).to.equal(bob.address);
    await names.connect(bob).release("andino");
    expect(await names.resolve("andino")).to.equal(ethers.ZeroAddress);
  });

  it("charges registration fee to treasury", async function () {
    const [gov, alice] = await ethers.getSigners();
    const fee = ethers.parseEther("0.05");
    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);
    const Factory = await ethers.getContractFactory("NameRegistry");
    const names = await Factory.deploy(gov.address, await treasury.getAddress(), fee);
    const before = await ethers.provider.getBalance(await treasury.getAddress());
    await names.connect(alice).register("peranto", NATIVE, fee, { value: fee });
    const after = await ethers.provider.getBalance(await treasury.getAddress());
    expect(after - before).to.equal(fee);
  });

  it("registers with ERC-20 fee", async function () {
    const [gov, alice] = await ethers.getSigners();
    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdc = await Mock.deploy("USDC", "USDC", 6);
    await treasury.connect(gov).setTokenAllowed(await usdc.getAddress(), true);
    const fee = 5n * 10n ** 6n;
    const Factory = await ethers.getContractFactory("NameRegistry");
    const names = await Factory.deploy(gov.address, await treasury.getAddress(), 0n);
    await names.connect(gov)["setRegistrationFee(address,uint256)"](await usdc.getAddress(), fee);
    await usdc.mint(alice.address, fee);
    await usdc.connect(alice).approve(await names.getAddress(), fee);
    await names.connect(alice).register("stable", await usdc.getAddress(), fee);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(fee);
    expect(await names.resolve("stable")).to.equal(alice.address);
  });
});
