import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";

const config: HardhatUserConfig = {
  solidity: "0.8.27",
    networks: {
    hardhat: {
      mining: {
        auto: true,
        interval: 0
      }
    }
  }
};

export default config;
