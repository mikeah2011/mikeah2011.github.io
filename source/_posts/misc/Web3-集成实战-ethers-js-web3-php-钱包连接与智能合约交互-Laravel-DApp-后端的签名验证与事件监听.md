---
title: 'Web3 集成实战：ethers.js/web3.php 钱包连接与智能合约交互——Laravel DApp 后端的签名验证与事件监听'
date: 2026-06-03 10:00:00
tags: [Web3, ethers.js, web3.php, Laravel, DApp, 智能合约, Solidity]
categories: [misc]
cover: /images/covers/web3-integration-dapp-cover.jpg
description: 本文是一篇面向 Laravel/PHP 开发者的 Web3 集成完整实战指南。从 ethers.js 前端钱包连接与 EIP-712 结构化签名，到 web3.php 后端智能合约调用与签名验证，再到 WebSocket 实时事件监听与 Laravel Queue 异步处理，全面覆盖 DApp 后端开发的核心技术栈。深入讲解 ERC-20/721 合约交互、nonce 防重放机制、Gas 优化策略、多链适配架构，并附带生产级代码示例与安全最佳实践，帮助开发者快速构建安全可靠的去中心化应用后端。
---

## 一、引言：为什么 Laravel 开发者需要掌握 Web3 集成？

在区块链技术飞速发展的今天，Web3 不再仅仅是加密货币爱好者的专属领域。越来越多的传统 Web 应用开始探索与区块链的深度集成——从数字资产确权、去中心化身份认证，到 NFT 市场、DeFi 协议对接，Web3 正在重塑互联网应用的底层信任架构。

对于广大的 PHP/Laravel 开发者而言，理解并掌握 Web3 集成技术，意味着能够构建真正具有去中心化特性的 DApp（Decentralized Application）后端。本文将以实战为导向，深入讲解如何使用 ethers.js（前端）与 web3.php（后端）实现钱包连接、智能合约交互、签名验证与事件监听的完整技术栈，帮助 Laravel 开发者全面拥抱 Web3 生态。

**传统 Web2 应用面临的核心痛点包括以下几个方面。** 首先是身份中心化风险。在传统的用户认证体系中，用户的用户名、密码、邮箱等敏感信息全部存储在中心化数据库中。一旦数据库遭到入侵或泄露，后果将不堪设想。而去中心化身份认证让用户通过自己的加密钱包来证明身份，私钥永远不会离开用户设备，从根本上消除了中心化存储带来的安全隐患。

其次是数字资产确权困难。在传统互联网中，用户在平台上购买的数字商品实际上并不真正属于用户。平台可以随时修改规则、删除内容甚至关闭服务。而在区块链上，一旦资产被铸造并记录在链上，其所有权就由智能合约自动维护，任何人都无法篡改，真正实现了"代码即法律"的数字所有权。

第三是信任依赖第三方的问题。无论是在线支付、跨境转账还是数字版权交易，传统模式都需要依赖银行、支付平台、版权机构等中心化中介。这不仅增加了交易成本和时间，还引入了单点故障风险。智能合约的出现使得交易双方可以直接在链上完成价值交换，无需任何中介参与，极大地降低了信任成本。

**Web3 集成能够为传统应用带来以下核心价值：** 用户可以通过加密钱包自主控制自己的身份和数据，实现真正的自主身份（Self-Sovereign Identity）。链上资产具有可验证、可追溯、不可篡改的特性，使得数字资产的所有权得到真正的保障。智能合约能够自动执行预设的业务逻辑，减少人为干预和操作风险。事件日志天然具备审计属性，每一笔链上操作都有据可查。

接下来，我们将从整体架构设计开始，逐步深入到生产级别的实战代码，帮助读者全面掌握 Laravel 应用与以太坊区块链的集成技术。

---

## 二、整体架构设计：Laravel DApp 的全栈蓝图

在开始编码之前，我们需要先理解整个 DApp 系统的架构。一个完整的 Laravel DApp 系统由前端交互层、后端服务层和区块链层三个核心部分组成。

### 2.1 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器 (Frontend)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │   Vue/React   │  │  ethers.js   │  │  MetaMask / WalletConnect │
│  │   UI 组件     │  │  Web3 Provider│  │  钱包扩展              │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                 │                       │              │
│         │    签名请求      │   连接/签名            │              │
│         ▼                 ▼                       ▼              │
├─────────────────────────────────────────────────────────────────┤
│                     HTTP API / WebSocket                         │
├─────────────────────────────────────────────────────────────────┤
│                     Laravel 后端 (Backend)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  签名验证      │  │  web3.php    │  │  事件监听服务          │  │
│  │  Middleware    │  │  合约交互     │  │  WebSocket/Queue      │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                 │                       │              │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌───────────┴───────────┐  │
│  │  MySQL/Redis  │  │  链上数据缓存  │  │  事件日志存储          │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                     区块链层 (Blockchain)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  以太坊节点    │  │  智能合约     │  │  事件日志 (Logs)       │  │
│  │  (Infura/Alchemy)│  │  (Solidity)  │  │  (EVM 生成)          │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流详解

整个系统的数据流可以概括为以下关键路径：

**路径一：钱包连接与身份认证。** 用户通过 MetaMask 连接钱包，前端使用 ethers.js 获取用户地址，然后向 Laravel 后端请求一个随机 nonce。前端使用钱包对 nonce 进行签名，将签名发送给后端验证。后端使用 web3.php 验证签名的正确性，确认签名地址与用户地址匹配后，生成 JWT Token 返回给前端。后续请求携带 Token 访问受保护的 API。

**路径二：智能合约读取操作。** 前端可以直接通过 ethers.js 调用合约的只读方法（view/pure 函数），无需消耗 Gas。也可以通过 Laravel 后端的 web3.php 调用，适用于需要后端聚合链上数据的场景。

**路径三：智能合约写入操作。** 前端使用 ethers.js 连接用户钱包，构造交易并由用户确认签名。交易被发送到以太坊网络后，Laravel 后端通过事件监听服务捕获合约发出的事件，更新本地数据库状态。

**路径四：后端发起链上操作。** 对于需要后端私钥签名的场景（如批量铸造 NFT、发放奖励等），Laravel 后端使用 web3.php 直接构造并签名交易，然后广播到以太坊网络。

### 2.3 技术选型说明

```
┌────────────────┬──────────────────────┬────────────────────────┐
│     层级        │     技术选型          │      选择理由           │
├────────────────┼──────────────────────┼────────────────────────┤
│  前端 Web3     │  ethers.js v6        │  API 简洁、TypeScript   │
│               │                      │  友好、社区活跃          │
├────────────────┼──────────────────────┼────────────────────────┤
│  后端 Web3     │  web3.php (scured)   │  PHP 原生、Laravel      │
│               │                      │  兼容性好               │
├────────────────┼──────────────────────┼────────────────────────┤
│  后端框架      │  Laravel 11          │  生态成熟、队列/事件     │
│               │                      │  系统完善               │
├────────────────┼──────────────────────┼────────────────────────┤
│  钱包连接      │  MetaMask +          │  覆盖面广、多协议支持    │
│               │  WalletConnect       │                        │
├────────────────┼──────────────────────┼────────────────────────┤
│  节点服务      │  Infura / Alchemy    │  稳定可靠、免费额度充足  │
├────────────────┼──────────────────────┼────────────────────────┤
│  签名标准      │  EIP-712             │  结构化签名、防钓鱼      │
├────────────────┼──────────────────────┼────────────────────────┤
│  事件监听      │  WebSocket + Queue   │  实时性 + 可靠性        │
└────────────────┴──────────────────────┴────────────────────────┘
```

### 2.4 前端 Web3 库选型对比：ethers.js vs web3.js

在前端 Web3 开发中，ethers.js 和 web3.js 是两个最主流的 JavaScript 库。以下从多个维度进行对比，帮助开发者做出合理选型：

```
┌──────────────────┬────────────────────────────┬────────────────────────────┐
│     对比维度       │       ethers.js v6         │        web3.js v4          │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  包体积           │  ~100KB（Tree-shaking 友好）│  ~400KB（较重）             │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  TypeScript 支持  │  原生 TS 编写，类型完备      │  后加类型，体验略逊          │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  API 设计         │  函数式 + 面向对象混合       │  回调风格 → Promise         │
│                  │  简洁直观                    │  API 历史包袱较重            │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  EIP-712 签名     │  一等公民支持                │  支持但 API 不够直观         │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  ABI 编码         │  支持人类可读 ABI            │  仅支持 JSON ABI            │
│                  │  'function mint(address)'   │  需要完整 JSON ABI          │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  Provider 模型    │  BrowserProvider / JsonRpc  │  HttpProvider / WsProvider  │
│                  │  统一抽象                    │  更接近底层 RPC             │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  社区活跃度       │  GitHub Stars ~13k+         │  GitHub Stars ~19k+         │
│                  │  更新迭代快                   │  维护节奏较慢               │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  生态配套         │  hardhat / viem 生态兼容     │  Truffle 生态               │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  适用场景         │  新项目首选、DApp 前端        │  遗留项目维护、Node.js 脚本  │
├──────────────────┼────────────────────────────┼────────────────────────────┤
│  学习曲线         │  中等（文档完善）             │  中等（资料丰富但版本混乱）   │
└──────────────────┴────────────────────────────┴────────────────────────────┘
```

**选型建议：** 对于新项目，强烈推荐使用 ethers.js v6。其更小的包体积、更优秀的 TypeScript 支持、以及更简洁的 API 设计，使其成为当前 DApp 前端开发的首选。如果项目已经使用 web3.js 且运行稳定，可以继续使用，但新模块建议逐步迁移到 ethers.js。本文所有前端代码均基于 ethers.js v6。

---

## 三、前端实战：ethers.js 钱包连接与合约交互

### 3.1 项目初始化与 ethers.js 安装

首先创建前端项目并安装依赖：

```bash
# 创建 Vue 3 项目
npm create vue@latest dapp-frontend
cd dapp-frontend

# 安装 ethers.js v6
npm install ethers@^6.0.0

# 安装 WalletConnect（可选，支持移动端钱包）
npm install @walletconnect/web3-provider
```

### 3.2 MetaMask 钱包连接

钱包连接是 DApp 的第一步。以下是一个完整的钱包连接管理器实现：

```javascript
// src/utils/wallet.js
import { ethers } from 'ethers';

class WalletManager {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
  }

  /**
   * 检测 MetaMask 是否已安装
   */
  isMetaMaskInstalled() {
    return typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask;
  }

  /**
   * 连接钱包
   * 请求用户授权并获取账户信息
   */
  async connect() {
    if (!this.isMetaMaskInstalled()) {
      throw new Error('请先安装 MetaMask 钱包扩展');
    }

    try {
      // 请求用户授权连接
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      // 创建 ethers provider 和 signer
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = await this.provider.getSigner();
      this.address = accounts[0];
      this.chainId = (await this.provider.getNetwork()).chainId;

      // 监听账户变更
      this._setupEventListeners();

      return {
        address: this.address,
        chainId: this.chainId,
      };
    } catch (error) {
      if (error.code === 4001) {
        throw new Error('用户拒绝了钱包连接请求');
      }
      throw error;
    }
  }

  /**
   * 设置事件监听器
   * 响应用户在 MetaMask 中切换账户或网络
   */
  _setupEventListeners() {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) {
        this.disconnect();
      } else {
        this.address = accounts[0];
        // 触发 Vue 响应式更新
        window.dispatchEvent(new CustomEvent('wallet:accountChanged', {
          detail: { address: accounts[0] }
        }));
      }
    });

    window.ethereum.on('chainChanged', (chainId) => {
      this.chainId = BigInt(chainId);
      window.dispatchEvent(new CustomEvent('wallet:chainChanged', {
        detail: { chainId: this.chainId }
      }));
    });
  }

  /**
   * 断开钱包连接
   */
  disconnect() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.chainId = null;
    window.dispatchEvent(new CustomEvent('wallet:disconnected'));
  }

  /**
   * 获取签名者实例（用于签署交易和消息）
   */
  getSigner() {
    if (!this.signer) {
      throw new Error('钱包未连接，请先调用 connect()');
    }
    return this.signer;
  }

  /**
   * 签名一条消息（用于身份验证）
   */
  async signMessage(message) {
    const signer = this.getSigner();
    return await signer.signMessage(message);
  }

  /**
   * 获取当前网络的 Gas 价格
   */
  async getGasPrice() {
    if (!this.provider) throw new Error('Provider 未初始化');
    const feeData = await this.provider.getFeeData();
    return feeData;
  }

  /**
   * 切换到指定网络
   */
  async switchNetwork(chainId) {
    const hexChainId = '0x' + chainId.toString(16);
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (error) {
      // 如果网络未添加，尝试添加
      if (error.code === 4902) {
        await this._addNetwork(chainId);
      } else {
        throw error;
      }
    }
  }

  /**
   * 添加新网络到 MetaMask
   */
  async _addNetwork(chainId) {
    const networks = {
      137: {
        chainId: '0x89',
        chainName: 'Polygon Mainnet',
        nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
        rpcUrls: ['https://polygon-rpc.com/'],
        blockExplorerUrls: ['https://polygonscan.com/'],
      },
      11155111: {
        chainId: '0xaa36a7',
        chainName: 'Sepolia Testnet',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.sepolia.org/'],
        blockExplorerUrls: ['https://sepolia.etherscan.io/'],
      },
    };

    const config = networks[chainId];
    if (!config) throw new Error(`不支持的网络: ${chainId}`);

    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [config],
    });
  }
}

// 导出单例
export const walletManager = new WalletManager();
```

### 3.3 EIP-712 结构化签名实现

EIP-712 是以太坊的结构化数据签名标准，它使签名数据对用户更加友好和可读。与简单的 `personal_sign` 不同，EIP-712 签名在 MetaMask 中会以结构化的方式展示给用户，让用户清楚地看到自己在签名什么内容。

```javascript
// src/utils/eip712.js
import { ethers } from 'ethers';

/**
 * EIP-712 签名工具
 * 用于生成防重放的身份验证签名
 */
export class EIP712Signer {
  constructor(walletManager) {
    this.walletManager = walletManager;
  }

  /**
   * 生成登录签名
   * @param {string} nonce - 服务端返回的随机 nonce
   * @param {number} chainId - 当前链 ID
   * @returns {object} 签名结果
   */
  async signLogin(nonce, chainId) {
    const signer = this.walletManager.getSigner();
    const address = await signer.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1小时有效期

    // EIP-712 类型定义
    const domain = {
      name: 'MyDApp',
      version: '1',
      chainId: chainId,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    };

    const types = {
      Login: [
        { name: 'wallet', type: 'address' },
        { name: 'nonce', type: 'string' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    const value = {
      wallet: address,
      nonce: nonce,
      deadline: deadline,
    };

    // 使用 EIP-712 签名
    const signature = await signer.signTypedData(domain, types, value);

    return {
      address,
      signature,
      nonce,
      deadline,
      domain,
      types,
      value,
    };
  }

  /**
   * 生成交易授权签名（用于 Gasless 交易 / 元交易）
   * @param {object} params 交易参数
   */
  async signMetaTransaction(params) {
    const signer = this.walletManager.getSigner();
    const address = await signer.getAddress();
    const chainId = this.walletManager.chainId;

    const domain = {
      name: params.contractName,
      version: '1',
      chainId: chainId,
      verifyingContract: params.contractAddress,
    };

    const types = {
      MetaTransaction: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    const value = {
      from: address,
      to: params.to,
      value: params.value || 0,
      data: params.data || '0x',
      nonce: params.nonce,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const signature = await signer.signTypedData(domain, types, value);

    return {
      ...value,
      signature,
    };
  }
}
```

### 3.4 智能合约交互：读取与写入操作

ethers.js 提供了非常简洁的合约交互 API。以下展示如何与 ERC-721 NFT 合约进行交互：

```javascript
// src/contracts/nftContract.js
import { ethers } from 'ethers';

// ERC-721 合约 ABI（精简版，只包含需要的方法）
const NFT_ABI = [
  // 只读方法
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',

  // 写入方法
  'function mint(address to) payable returns (uint256)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 tokenId)',

  // 事件
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
  'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
];

/**
 * NFT 合约交互服务
 */
export class NFTContractService {
  constructor(contractAddress, provider, signer = null) {
    this.contractAddress = contractAddress;
    // 只读合约实例（使用 provider）
    this.readContract = new ethers.Contract(contractAddress, NFT_ABI, provider);
    // 可写合约实例（使用 signer，仅在连接钱包后可用）
    if (signer) {
      this.writeContract = new ethers.Contract(contractAddress, NFT_ABI, signer);
    }
  }

  /**
   * 查询用户持有的 NFT 数量
   */
  async getBalance(address) {
    const balance = await this.readContract.balanceOf(address);
    return Number(balance);
  }

  /**
   * 查询 NFT 的元数据 URI
   */
  async getTokenURI(tokenId) {
    const uri = await this.readContract.tokenURI(tokenId);
    // 如果是 IPFS URI，转换为 HTTP 网关地址
    if (uri.startsWith('ipfs://')) {
      return uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }
    return uri;
  }

  /**
   * 获取 NFT 元数据（从 tokenURI 获取 JSON）
   */
  async getTokenMetadata(tokenId) {
    const uri = await this.getTokenURI(tokenId);
    const response = await fetch(uri);
    return await response.json();
  }

  /**
   * 获取合约信息
   */
  async getContractInfo() {
    const [name, symbol, totalSupply] = await Promise.all([
      this.readContract.name(),
      this.readContract.symbol(),
      this.readContract.totalSupply(),
    ]);
    return { name, symbol, totalSupply: Number(totalSupply) };
  }

  /**
   * 铸造 NFT（写入操作，需要用户签名确认）
   * @param {string} to - 接收地址
   * @param {string} price - 铸造价格（ETH 单位）
   */
  async mint(to, price) {
    if (!this.writeContract) {
      throw new Error('合约写入实例未初始化，请先连接钱包');
    }

    // 发送交易
    const tx = await this.writeContract.mint(to, {
      value: ethers.parseEther(price),
    });

    console.log('交易已提交，哈希:', tx.hash);

    // 等待交易确认
    const receipt = await tx.wait();
    console.log('交易已确认，区块号:', receipt.blockNumber);

    // 从事件日志中提取铸造的 tokenId
    const transferEvent = receipt.logs.find(
      (log) => log.topics[0] === ethers.id('Transfer(address,address,uint256)')
    );

    let tokenId = null;
    if (transferEvent) {
      tokenId = Number(BigInt(transferEvent.topics[3]));
    }

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      tokenId,
      gasUsed: receipt.gasUsed.toString(),
    };
  }

  /**
   * 查询 Gas 估算（写入操作前预估费用）
   */
  async estimateMintGas(to) {
    if (!this.writeContract) {
      throw new Error('需要连接钱包');
    }
    const gasEstimate = await this.writeContract.mint.estimateGas(to);
    const feeData = await this.writeContract.runner.provider.getFeeData();

    const gasCost = gasEstimate * feeData.gasPrice;
    return {
      gasEstimate: gasEstimate.toString(),
      gasPrice: ethers.formatUnits(feeData.gasPrice, 'gwei'),
      estimatedCost: ethers.formatEther(gasCost),
    };
  }

  /**
   * 监听合约事件
   */
  onTransfer(callback) {
    this.readContract.on('Transfer', (from, to, tokenId, event) => {
      callback({
        from,
        to,
        tokenId: Number(tokenId),
        txHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });
  }

  /**
   * 查询历史事件
   */
  async getTransferEvents(fromBlock = 0, toBlock = 'latest') {
    const filter = this.readContract.filters.Transfer();
    const events = await this.readContract.queryFilter(
      filter,
      fromBlock,
      toBlock
    );

    return events.map((event) => ({
      from: event.args[0],
      to: event.args[1],
      tokenId: Number(event.args[2]),
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
    }));
  }

  /**
   * 取消所有事件监听
   */
  removeAllListeners() {
    this.readContract.removeAllListeners();
  }
}
```

### 3.5 ERC-20 代币合约交互

除了 NFT，ERC-20 代币交互也是 DApp 中最常见的操作之一：

```javascript
// src/contracts/tokenContract.js
import { ethers } from 'ethers';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

export class ERC20ContractService {
  constructor(contractAddress, provider, signer = null) {
    this.address = contractAddress;
    this.readContract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
    if (signer) {
      this.writeContract = new ethers.Contract(contractAddress, ERC20_ABI, signer);
    }
  }

  /**
   * 获取代币余额（带精度处理）
   */
  async getBalance(address) {
    const [balance, decimals] = await Promise.all([
      this.readContract.balanceOf(address),
      this.readContract.decimals(),
    ]);
    return {
      raw: balance.toString(),
      formatted: ethers.formatUnits(balance, decimals),
      decimals,
    };
  }

  /**
   * 转账代币
   */
  async transfer(to, amount) {
    const decimals = await this.readContract.decimals();
    const parsedAmount = ethers.parseUnits(amount.toString(), decimals);
    const tx = await this.writeContract.transfer(to, parsedAmount);
    return await tx.wait();
  }

  /**
   * 授权合约使用代币（DeFi 场景常用）
   */
  async approve(spender, amount) {
    const decimals = await this.readContract.decimals();
    const parsedAmount = ethers.parseUnits(amount.toString(), decimals);
    const tx = await this.writeContract.approve(spender, parsedAmount);
    return await tx.wait();
  }

  /**
   * 查询授权额度
   */
  async getAllowance(owner, spender) {
    const [allowance, decimals] = await Promise.all([
      this.readContract.allowance(owner, spender),
      this.readContract.decimals(),
    ]);
    return {
      raw: allowance.toString(),
      formatted: ethers.formatUnits(allowance, decimals),
    };
  }
}
```

---

## 四、后端实战：Laravel 集成 web3.php

### 4.1 环境搭建与包安装

```bash
# 创建 Laravel 项目（如果还没有的话）
composer create-project laravel/laravel dapp-backend
cd dapp-backend

# 安装 web3.php
composer require web3/web3

# 安装 Laravel Sanctum（用于 API 认证）
composer require laravel/sanctum

# 安装 Predis（Redis 客户端，用于 nonce 管理）
composer require predis/predis
```

配置环境变量，在 `.env` 文件中添加：

```env
# 以太坊节点 RPC URL（推荐使用 Infura 或 Alchemy）
ETHEREUM_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_WS_URL=wss://sepolia.infura.io/ws/v3/YOUR_PROJECT_ID

# 链 ID
ETHEREUM_CHAIN_ID=11155111

# 后端操作钱包私钥（仅用于后端签名交易，如铸造等）
ETHEREUM_PRIVATE_KEY=your_private_key_here

# NFT 合约地址
NFT_CONTRACT_ADDRESS=0x1234567890abcdef1234567890abcdef12345678

# Signature 有效期（秒）
SIGNATURE_TTL=3600
```

### 4.2 web3.php 服务提供者

创建一个 Laravel 服务提供者来封装 web3.php 的初始化：

```php
<?php
// app/Providers/Web3ServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Web3\Web3;
use Web3\Contract;
use Web3\Providers\HttpProvider;
use Web3\Providers\WsProvider;
use Web3\RequestManagers\HttpRequestManager;
use Web3\RequestManagers\WsRequestManager;

class Web3ServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // 注册 HTTP Provider
        $this->app->singleton(Web3::class, function ($app) {
            $rpcUrl = config('web3.rpc_url');
            $provider = new HttpProvider(
                new HttpRequestManager($rpcUrl, 10) // 10秒超时
            );
            return new Web3($provider);
        });

        // 注册 WebSocket Provider（用于事件监听）
        $this->app->singleton('web3.ws', function ($app) {
            $wsUrl = config('web3.ws_url');
            $provider = new WsProvider(
                new WsRequestManager($wsUrl)
            );
            return new Web3($provider);
        });

        // 注册 NFT 合约实例
        $this->app->singleton('contract.nft', function ($app) {
            $web3 = $app->make(Web3::class);
            $abi = file_get_contents(storage_path('app/contracts/nft.abi.json'));
            return new Contract(config('web3.rpc_url'), $abi);
        });
    }

    public function boot(): void
    {
        //
    }
}
```

创建配置文件：

```php
<?php
// config/web3.php

return [
    'rpc_url' => env('ETHEREUM_RPC_URL', 'https://sepolia.infura.io/v3/YOUR_PROJECT_ID'),
    'ws_url' => env('ETHEREUM_WS_URL', 'wss://sepolia.infura.io/ws/v3/YOUR_PROJECT_ID'),
    'chain_id' => (int) env('ETHEREUM_CHAIN_ID', 11155111),
    'private_key' => env('ETHEREUM_PRIVATE_KEY'),
    'contracts' => [
        'nft' => [
            'address' => env('NFT_CONTRACT_ADDRESS'),
            'abi_path' => storage_path('app/contracts/nft.abi.json'),
        ],
    ],
    'signature_ttl' => (int) env('SIGNATURE_TTL', 3600),
];
```

### 4.3 签名验证核心服务

这是整个系统的核心组件——签名验证服务。它负责验证用户通过 MetaMask 签名的消息，确认用户确实拥有对应的钱包地址：

```php
<?php
// app/Services/SignatureVerificationService.php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Web3\Web3;
use Web3\Utils;
use kornrunner\Keccak;
use RuntimeException;

class SignatureVerificationService
{
    protected Web3 $web3;
    protected int $chainId;
    protected int $signatureTtl;

    public function __construct(Web3 $web3)
    {
        $this->web3 = $web3;
        $this->chainId = config('web3.chain_id');
        $this->signatureTtl = config('web3.signature_ttl', 3600);
    }

    /**
     * 生成随机 nonce（用于签名挑战）
     * 将 nonce 存储在 Redis 中，与钱包地址绑定
     */
    public function generateNonce(string $walletAddress): string
    {
        $walletAddress = strtolower($walletAddress);
        $nonce = sprintf(
            '%s wants you to sign in with your Ethereum account.\n\nNonce: %s\nExpires: %s',
            config('app.name', 'MyDApp'),
            Str::random(32),
            now()->addSeconds($this->signatureTtl)->toIso8601String()
        );

        // 将 nonce 存入 Redis，关联钱包地址
        Cache::put(
            "signature_nonce:{$walletAddress}",
            $nonce,
            $this->signatureTtl
        );

        return $nonce;
    }

    /**
     * 验证 personal_sign 签名
     * @param string $walletAddress 声称的钱包地址
     * @param string $message 原始消息
     * @param string $signature 签名数据
     * @return bool 验证是否通过
     */
    public function verifyPersonalSign(
        string $walletAddress,
        string $message,
        string $signature
    ): bool {
        // 1. 检查 nonce 是否有效（防止重放攻击）
        $cachedNonce = Cache::get("signature_nonce:" . strtolower($walletAddress));
        if (!$cachedNonce || $cachedNonce !== $message) {
            throw new RuntimeException('签名消息无效或已过期');
        }

        // 2. 验证签名
        $recoveredAddress = $this->recoverPersonalSignAddress($message, $signature);

        // 3. 比较地址（不区分大小写）
        $isValid = strtolower($recoveredAddress) === strtolower($walletAddress);

        // 4. 验证通过后删除 nonce（一次性使用）
        if ($isValid) {
            Cache::forget("signature_nonce:" . strtolower($walletAddress));
        }

        return $isValid;
    }

    /**
     * 从 personal_sign 签名中恢复地址
     * Ethereum personal_sign 签名格式: "\x19Ethereum Signed Message:\n" + message.length + message
     */
    public function recoverPersonalSignAddress(
        string $message,
        string $signature
    ): string {
        // 添加 Ethereum 签名前缀
        $prefix = "\x19Ethereum Signed Message:\n" . strlen($message);
        $prefixedMessage = $prefix . $message;

        // 计算 Keccak-256 哈希
        $messageHash = Keccak::hash($prefixedMessage, 256);

        // 解析签名的 v, r, s 分量
        $signature = preg_replace('/^0x/', '', $signature);
        $r = hex2bin(substr($signature, 0, 64));
        $s = hex2bin(substr($signature, 64, 64));
        $v = hexdec(substr($signature, 128, 2));

        // 处理 EIP-155 的 v 值
        if ($v < 27) {
            $v += 27;
        }

        // 使用 web3.php 的 ECRecover 功能
        // 由于 PHP 生态的限制，这里展示手动恢复地址的逻辑
        // 生产环境中推荐使用 web3.php 内置的方法或专门的签名验证库
        $publicKey = $this->ecRecover($messageHash, $r, $s, $v);

        // 从公钥计算地址
        $address = $this->publicKeyToAddress($publicKey);

        return $address;
    }

    /**
     * 验证 EIP-712 结构化签名
     * 更安全的签名验证方式，防止钓鱼攻击
     */
    public function verifyEIP712Signature(
        string $walletAddress,
        array $typedData,
        string $signature
    ): bool {
        // 验证 domain separator
        $expectedDomain = [
            'name' => 'MyDApp',
            'version' => '1',
            'chainId' => $this->chainId,
            'verifyingContract' => '0x0000000000000000000000000000000000000000',
        ];

        if ($typedData['domain'] !== $expectedDomain) {
            throw new RuntimeException('签名域信息不匹配');
        }

        // 验证 deadline
        $deadline = $typedData['message']['deadline'] ?? 0;
        if ($deadline < time()) {
            throw new RuntimeException('签名已过期');
        }

        // 验证 nonce
        $nonce = $typedData['message']['nonce'] ?? '';
        $cachedNonce = Cache::get("signature_nonce:" . strtolower($walletAddress));
        if (!$cachedNonce || $cachedNonce !== $nonce) {
            throw new RuntimeException('签名 nonce 无效');
        }

        // 计算 EIP-712 结构化哈希
        $hash = $this->computeEIP712Hash($typedData);

        // 恢复签名者地址并验证
        $recoveredAddress = $this->recoverFromHash($hash, $signature);

        $isValid = strtolower($recoveredAddress) === strtolower($walletAddress);

        if ($isValid) {
            Cache::forget("signature_nonce:" . strtolower($walletAddress));
        }

        return $isValid;
    }

    /**
     * 计算 EIP-712 结构化数据哈希
     * hashStruct = keccak256(typeHash ++ encodeData(data))
     */
    protected function computeEIP712Hash(array $typedData): string
    {
        // 1. 计算 domain separator hash
        $domainHash = $this->hashDomain($typedData['domain']);

        // 2. 计算数据结构哈希
        $dataHash = $this->hashStruct($typedData);

        // 3. 组合最终哈希
        // EIP-712: keccak256("\x19\x01" ++ domainSeparator ++ hashStruct(message))
        return Keccak::hash(
            "\x19\x01" . $domainHash . $dataHash,
            256
        );
    }

    /**
     * 计算 domain separator 的哈希
     */
    protected function hashDomain(array $domain): string
    {
        $typeHash = Keccak::hash(
            'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
            256
        );

        $nameHash = Keccak::hash($domain['name'], 256);
        $versionHash = Keccak::hash($domain['version'], 256);
        $chainId = $this->encodeUint256($domain['chainId']);
        $contract = $this->encodeAddress($domain['verifyingContract']);

        return Keccak::hash(
            $typeHash . $nameHash . $versionHash . $chainId . $contract,
            256
        );
    }

    /**
     * 编码 uint256 类型
     */
    protected function encodeUint256(int|string $value): string
    {
        $hex = gmp_strval(gmp_init($value), 16);
        return str_pad(hex2bin($hex), 32, "\0", STR_PAD_LEFT);
    }

    /**
     * 编码 address 类型
     */
    protected function encodeAddress(string $address): string
    {
        $address = preg_replace('/^0x/', '', $address);
        return str_pad(hex2bin($address), 32, "\0", STR_PAD_LEFT);
    }
}
```

### 4.4 签名验证中间件

将签名验证逻辑封装为 Laravel 中间件，保护需要钱包认证的 API 路由：

```php
<?php
// app/Http/Middleware/WalletAuth.php

namespace App\Http\Middleware;

use App\Services\SignatureVerificationService;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Support\Facades\Auth;

class WalletAuth
{
    public function __construct(
        protected SignatureVerificationService $signatureService
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        // 获取认证头
        $walletAddress = $request->header('X-Wallet-Address');
        $signature = $request->header('X-Wallet-Signature');
        $message = $request->header('X-Sign-Message');

        if (!$walletAddress || !$signature || !$message) {
            return response()->json([
                'error' => '缺少钱包认证信息',
                'required' => [
                    'X-Wallet-Address' => '钱包地址',
                    'X-Wallet-Signature' => '签名数据',
                    'X-Sign-Message' => '签名消息',
                ],
            ], 401);
        }

        // 验证钱包地址格式
        if (!preg_match('/^0x[a-fA-F0-9]{40}$/', $walletAddress)) {
            return response()->json([
                'error' => '无效的钱包地址格式',
            ], 400);
        }

        // 验证签名
        try {
            $isValid = $this->signatureService->verifyPersonalSign(
                $walletAddress,
                $message,
                $signature
            );
        } catch (\RuntimeException $e) {
            return response()->json([
                'error' => '签名验证失败',
                'message' => $e->getMessage(),
            ], 401);
        }

        if (!$isValid) {
            return response()->json([
                'error' => '签名验证失败：地址不匹配',
            ], 401);
        }

        // 查找或创建用户
        $user = User::firstOrCreate(
            ['wallet_address' => strtolower($walletAddress)],
            [
                'wallet_address' => strtolower($walletAddress),
                'name' => 'User_' . substr($walletAddress, 2, 8),
            ]
        );

        // 设置当前认证用户
        Auth::login($user);

        // 将钱包信息注入请求
        $request->merge([
            'authenticated_wallet' => $walletAddress,
        ]);

        return $next($request);
    }
}
```

注册中间件：

```php
<?php
// bootstrap/app.php (Laravel 11)

use App\Http\Middleware\WalletAuth;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        api: __DIR__ . '/../routes/api.php',
        commands: __DIR__ . '/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'wallet.auth' => WalletAuth::class,
        ]);
    })
    ->create();
```

### 4.5 认证 API 控制器

```php
<?php
// app/Http/Controllers/API/AuthController.php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Services\SignatureVerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller
{
    public function __construct(
        protected SignatureVerificationService $signatureService
    ) {}

    /**
     * 获取签名挑战 nonce
     * 前端调用此接口获取需要签名的消息
     */
    public function getNonce(Request $request): JsonResponse
    $request->validate([
        'wallet_address' => 'required|string|regex:/^0x[a-fA-F0-9]{40}$/',
    ]);

    $nonce = $this->signatureService->generateNonce(
        $request->input('wallet_address')
    );

    return response()->json([
        'nonce' => $nonce,
        'expires_in' => config('web3.signature_ttl'),
    ]);
}

    /**
     * 验证签名并登录
     * 前端使用钱包签名后，将签名发送到此接口验证
     */
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'wallet_address' => 'required|string|regex:/^0x[a-fA-F0-9]{40}$/',
            'signature' => 'required|string',
            'message' => 'required|string',
        ]);

        $isValid = $this->signatureService->verifyPersonalSign(
            $request->input('wallet_address'),
            $request->input('message'),
            $request->input('signature')
        );

        if (!$isValid) {
            return response()->json(['error' => '签名验证失败'], 401);
        }

        // 创建或获取用户，生成 Sanctum Token
        $user = \App\Models\User::firstOrCreate(
            ['wallet_address' => strtolower($request->input('wallet_address'))],
            [
                'wallet_address' => strtolower($request->input('wallet_address')),
                'name' => 'User_' . substr($request->input('wallet_address'), 2, 8),
            ]
        );

        $token = $user->createToken('wallet-auth')->plainTextToken;

        return response()->json([
            'user' => [
                'id' => $user->id,
                'wallet_address' => $user->wallet_address,
                'name' => $user->name,
            ],
            'token' => $token,
        ]);
    }

    /**
     * 获取当前用户信息
     */
    public function me(Request $request): JsonResponse
    {
        $user = Auth::user();

        return response()->json([
            'user' => [
                'id' => $user->id,
                'wallet_address' => $user->wallet_address,
                'name' => $user->name,
                'created_at' => $user->created_at,
            ],
        ]);
    }

    /**
     * 退出登录
     */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => '已退出登录']);
    }
}
```

### 4.6 智能合约交互服务（后端）

当后端需要直接与链上合约交互时（如批量铸造、发放奖励等），使用 web3.php 来构造和发送交易：

```php
<?php
// app/Services/SmartContractService.php

namespace App\Services;

use Web3\Web3;
use Web3\Contract as Web3Contract;
use Web3\Utils;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use RuntimeException;

class SmartContractService
{
    protected Web3 $web3;
    protected Web3Contract $nftContract;
    protected string $operatorPrivateKey;

    public function __construct(Web3 $web3)
    {
        $this->web3 = $web3;
        $this->operatorPrivateKey = config('web3.private_key');

        // 加载合约 ABI
        $abiPath = config('web3.contracts.nft.abi_path');
        $abi = file_get_contents($abiPath);

        $this->nftContract = new Web3Contract(
            config('web3.rpc_url'),
            $abi
        );
    }

    /**
     * 查询 NFT 余额
     */
    public function getNFTBalance(string $walletAddress): int
    {
        $result = null;
        $this->nftContract->at(config('web3.contracts.nft.address'))
            ->call('balanceOf', $walletAddress, function ($err, $balance) {
                if ($err) {
                    throw new RuntimeException("查询余额失败: " . $err->getMessage());
                }
                $result = $balance[0]->toString();
            });

        return (int) ($result ?? 0);
    }

    /**
     * 查询 NFT 元数据 URI
     */
    public function getTokenURI(int $tokenId): string
    {
        $result = null;
        $this->nftContract->at(config('web3.contracts.nft.address'))
            ->call('tokenURI', $tokenId, function ($err, $uri) {
                if ($err) {
                    throw new RuntimeException("查询 tokenURI 失败: " . $err->getMessage());
                }
                $result = $uri[0];
            });

        return $result ?? '';
    }

    /**
     * 后端签名铸造 NFT
     * 使用后端私钥构造并发送铸造交易
     */
    public function mintNFT(string $toAddress): array
    {
        // 1. 获取当前 nonce
        $fromAddress = $this->getOperatorAddress();
        $nonce = $this->getNonce($fromAddress);

        // 2. 估算 Gas
        $contractAddress = config('web3.contracts.nft.address');
        $gasEstimate = $this->estimateGas($contractAddress, 'mint', [$toAddress]);

        // 3. 获取 Gas 价格
        $gasPrice = $this->getGasPrice();

        // 4. 构造交易数据
        $functionData = $this->nftContract->getData(
            'mint',
            $toAddress
        );

        // 5. 签名并发送交易
        $tx = [
            'from' => $fromAddress,
            'to' => $contractAddress,
            'nonce' => '0x' . dechex($nonce),
            'gas' => '0x' . dechex((int) ($gasEstimate * 1.2)), // 增加 20% buffer
            'gasPrice' => '0x' . dechex($gasPrice),
            'data' => $functionData,
            'chainId' => config('web3.chain_id'),
        ];

        $signedTx = $this->signTransaction($tx);
        $txHash = $this->sendRawTransaction($signedTx);

        Log::info('NFT 铸造交易已发送', [
            'to' => $toAddress,
            'txHash' => $txHash,
            'nonce' => $nonce,
        ]);

        // 6. 等待交易确认（可选）
        $receipt = $this->waitForTransactionReceipt($txHash);

        return [
            'tx_hash' => $txHash,
            'block_number' => hexdec($receipt['blockNumber']),
            'gas_used' => hexdec($receipt['gasUsed']),
            'status' => $receipt['status'] === '0x1' ? 'success' : 'failed',
        ];
    }

    /**
     * 获取操作者地址
     */
    protected function getOperatorAddress(): string
    {
        // 从私钥计算地址
        // 这里简化处理，实际应使用椭圆曲线运算
        $cacheKey = 'operator_address';
        $address = Cache::get($cacheKey);

        if (!$address) {
            // 使用 web3.php 从私钥导出地址
            $this->web3->personal->importRawKey(
                $this->operatorPrivateKey,
                '',
                function ($err, $result) use (&$address) {
                    if ($err) {
                        throw new RuntimeException("导入私钥失败: " . $err->getMessage());
                    }
                    $address = $result;
                }
            );
            Cache::put($cacheKey, $address, 86400);
        }

        return $address;
    }

    /**
     * 获取账户 nonce
     */
    protected function getNonce(string $address): int
    {
        $nonce = null;
        $this->web3->eth->getTransactionCount($address, 'pending', function ($err, $count) use (&$nonce) {
            if ($err) {
                throw new RuntimeException("获取 nonce 失败: " . $err->getMessage());
            }
            $nonce = Utils::toDecimal($count);
        });

        return (int) ($nonce ?? 0);
    }

    /**
     * 估算 Gas 消耗
     */
    protected function estimateGas(string $to, string $method, array $params): int
    {
        $functionData = $this->nftContract->getData($method, ...$params);

        $gas = null;
        $this->web3->eth->estimateGas([
            'to' => $to,
            'data' => $functionData,
        ], function ($err, $estimate) use (&$gas) {
            if ($err) {
                Log::warning('Gas 估算失败，使用默认值', ['error' => $err->getMessage()]);
                $gas = 300000; // 默认 Gas 限制
                return;
            }
            $gas = Utils::toDecimal($estimate);
        });

        return (int) ($gas ?? 300000);
    }

    /**
     * 获取当前 Gas 价格
     */
    protected function getGasPrice(): int
    {
        $gasPrice = null;
        $this->web3->eth->gasPrice(function ($err, $price) use (&$gasPrice) {
            if ($err) {
                throw new RuntimeException("获取 Gas 价格失败: " . $err->getMessage());
            }
            $gasPrice = Utils::toDecimal($price);
        });

        return (int) ($gasPrice ?? 20000000000); // 默认 20 Gwei
    }

    /**
     * 签名交易
     */
    protected function signTransaction(array $tx): string
    {
        $signed = null;
        $this->web3->eth->accounts->signTransaction(
            $tx,
            $this->operatorPrivateKey,
            function ($err, $result) use (&$signed) {
                if ($err) {
                    throw new RuntimeException("签名交易失败: " . $err->getMessage());
                }
                $signed = $result['raw'];
            }
        );

        if (!$signed) {
            throw new RuntimeException('签名交易返回为空');
        }

        return $signed;
    }

    /**
     * 发送已签名的原始交易
     */
    protected function sendRawTransaction(string $signedTx): string
    {
        $txHash = null;
        $this->web3->eth->sendRawTransaction($signedTx, function ($err, $hash) use (&$txHash) {
            if ($err) {
                throw new RuntimeException("发送交易失败: " . $err->getMessage());
            }
            $txHash = $hash;
        });

        if (!$txHash) {
            throw new RuntimeException('发送交易返回为空');
        }

        return $txHash;
    }

    /**
     * 等待交易回执
     */
    protected function waitForTransactionReceipt(
        string $txHash,
        int $maxAttempts = 30,
        int $interval = 2
    ): array {
        for ($i = 0; $i < $maxAttempts; $i++) {
            $receipt = null;
            $this->web3->eth->getTransactionReceipt($txHash, function ($err, $result) use (&$receipt) {
                if (!$err && $result) {
                    $receipt = $result;
                }
            });

            if ($receipt) {
                return $receipt;
            }

            sleep($interval);
        }

        throw new RuntimeException("交易确认超时: {$txHash}");
    }
}
```

---

## 五、事件监听系统：实时捕获链上事件

### 5.1 事件监听的重要性

在 DApp 中，事件监听是连接链上和链下世界的关键桥梁。当智能合约中发生关键操作（如转账、铸造、状态变更等）时，合约会发出事件日志。Laravel 后端需要实时监听这些事件，并根据事件内容更新本地数据库或触发业务逻辑。

### 5.2 WebSocket 事件监听服务

```php
<?php
// app/Services/EventListenerService.php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Web3\Web3;
use Web3\Contract as Web3Contract;

class EventListenerService
{
    protected Web3 $web3;
    protected Web3Contract $nftContract;
    protected bool $isRunning = false;

    public function __construct()
    {
        // 使用 WebSocket 连接
        $this->web3 = app('web3.ws');

        $abiPath = config('web3.contracts.nft.abi_path');
        $abi = file_get_contents($abiPath);

        $this->nftContract = new Web3Contract(
            config('web3.ws_url'),
            $abi
        );
    }

    /**
     * 启动 NFT Transfer 事件监听
     */
    public function startTransferListener(): void
    {
        $contractAddress = config('web3.contracts.nft.address');
        $this->isRunning = true;

        Log::info('开始监听 NFT Transfer 事件', [
            'contract' => $contractAddress,
        ]);

        $this->nftContract->at($contractAddress)
            ->event('Transfer')
            ->fromBlock('latest')
            ->watch(function ($err, $event) {
                if ($err) {
                    Log::error('事件监听错误', ['error' => $err->getMessage()]);
                    $this->reconnect();
                    return;
                }

                $this->handleTransferEvent($event);
            });
    }

    /**
     * 处理 Transfer 事件
     */
    protected function handleTransferEvent(array $event): void
    {
        $from = $event['args'][0];    // 发送方地址
        $to = $event['args'][1];      // 接收方地址
        $tokenId = $event['args'][2]; // Token ID

        $blockNumber = $event['blockNumber'];
        $txHash = $event['transactionHash'];

        Log::info('NFT Transfer 事件', [
            'from' => $from,
            'to' => $to,
            'tokenId' => $tokenId,
            'txHash' => $txHash,
        ]);

        // 判断是铸造（from 为零地址）还是转移
        $zeroAddress = '0x0000000000000000000000000000000000000000';
        if (strtolower($from) === $zeroAddress) {
            $this->handleMintEvent($to, $tokenId, $txHash, $blockNumber);
        } else {
            $this->handleTransferRecord($from, $to, $tokenId, $txHash, $blockNumber);
        }
    }

    /**
     * 处理铸造事件
     */
    protected function handleMintEvent(
        string $to,
        int $tokenId,
        string $txHash,
        int $blockNumber
    ): void {
        DB::table('nft_tokens')->updateOrInsert(
            ['token_id' => $tokenId],
            [
                'owner_address' => strtolower($to),
                'mint_tx_hash' => $txHash,
                'mint_block_number' => $blockNumber,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        Log::info('NFT 铸造记录已保存', [
            'tokenId' => $tokenId,
            'owner' => $to,
        ]);
    }

    /**
     * 处理转移记录
     */
    protected function handleTransferRecord(
        string $from,
        string $to,
        int $tokenId,
        string $txHash,
        int $blockNumber
    ): void {
        // 更新 NFT 所有者
        DB::table('nft_tokens')
            ->where('token_id', $tokenId)
            ->update([
                'owner_address' => strtolower($to),
                'updated_at' => now(),
            ]);

        // 记录转移历史
        DB::table('nft_transfers')->insert([
            'token_id' => $tokenId,
            'from_address' => strtolower($from),
            'to_address' => strtolower($to),
            'tx_hash' => $txHash,
            'block_number' => $blockNumber,
            'created_at' => now(),
        ]);
    }

    /**
     * 重新连接 WebSocket
     */
    protected function reconnect(): void
    {
        Log::warning('尝试重新连接 WebSocket...');

        // 等待一段时间后重连
        sleep(5);

        try {
            // 重新初始化 WebSocket 连接
            $this->web3 = app('web3.ws');
            $this->startTransferListener();
        } catch (\Exception $e) {
            Log::error('重新连接失败', ['error' => $e->getMessage()]);
            // 使用 Laravel 的任务调度来延迟重试
            static::dispatch()->delay(now()->addSeconds(30));
        }
    }

    /**
     * 停止事件监听
     */
    public function stop(): void
    {
        $this->isRunning = false;
        Log::info('事件监听已停止');
    }
}
```

### 5.3 使用 Artisan 命令管理事件监听

```php
<?php
// app/Console/Commands/ListenBlockchainEvents.php

namespace App\Console\Commands;

use App\Services\EventListenerService;
use Illuminate\Console\Command;

class ListenBlockchainEvents extends Command
{
    protected $signature = 'web3:listen
                            {--contract=nft : 要监听的合约类型}
                            {--event=Transfer : 要监听的事件名}';

    protected $description = '监听区块链智能合约事件';

    public function handle(EventListenerService $listener): int
    {
        $contract = $this->option('contract');
        $event = $this->option('event');

        $this->info("开始监听 {$contract} 合约的 {$event} 事件...");
        $this->info('按 Ctrl+C 停止监听');

        // 注册信号处理器，优雅退出
        pcntl_signal(SIGINT, function () use ($listener) {
            $this->info('正在停止事件监听...');
            $listener->stop();
            exit(0);
        });

        try {
            $listener->startTransferListener();
        } catch (\Exception $e) {
            $this->error('事件监听异常: ' . $e->getMessage());
            return Command::FAILURE;
        }

        return Command::SUCCESS;
    }
}
```

### 5.4 使用 Laravel Queue 进行可靠的事件处理

在生产环境中，建议将事件处理逻辑放入 Laravel 队列中，以确保可靠性和可重试性：

```php
<?php
// app/Jobs/ProcessBlockchainEvent.php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class ProcessBlockchainEvent implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 5;
    public int $timeout = 60;
    public int $backoff = 10;

    public function __construct(
        public array $eventData,
        public string $eventType
    ) {
        $this->onQueue('blockchain-events');
    }

    public function handle(): void
    {
        // 使用 Redis 分布式锁防止重复处理
        $lockKey = "event_lock:{$this->eventData['txHash']}:{$this->eventData['tokenId']}";
        $lock = Cache::lock($lockKey, 300);

        if (!$lock->get()) {
            Log::info('事件已在处理中，跳过', ['txHash' => $this->eventData['txHash']]);
            return;
        }

        try {
            match ($this->eventType) {
                'Transfer' => $this->processTransfer(),
                'Approval' => $this->processApproval(),
                'ApprovalForAll' => $this->processApprovalForAll(),
                default => Log::warning('未知事件类型', ['type' => $this->eventType]),
            };
        } finally {
            $lock->release();
        }
    }

    protected function processTransfer(): void
    {
        $data = $this->eventData;

        DB::transaction(function () use ($data) {
            // 更新 NFT 所有者
            DB::table('nft_tokens')
                ->updateOrInsert(
                    ['token_id' => $data['tokenId']],
                    [
                        'owner_address' => strtolower($data['to']),
                        'updated_at' => now(),
                    ]
                );

            // 记录转移历史
            DB::table('nft_transfers')->insert([
                'token_id' => $data['tokenId'],
                'from_address' => strtolower($data['from']),
                'to_address' => strtolower($data['to']),
                'tx_hash' => $data['txHash'],
                'block_number' => $data['blockNumber'],
                'created_at' => now(),
            ]);

            // 更新用户 NFT 计数缓存
            Cache::forget("nft_count:" . strtolower($data['from']));
            Cache::forget("nft_count:" . strtolower($data['to']));
        });

        Log::info('Transfer 事件处理完成', $data);
    }

    protected function processApproval(): void
    {
        $data = $this->eventData;

        DB::table('nft_approvals')->updateOrInsert(
            ['token_id' => $data['tokenId']],
            [
                'owner' => strtolower($data['owner']),
                'approved' => strtolower($data['approved']),
                'updated_at' => now(),
            ]
        );
    }

    protected function processApprovalForAll(): void
    {
        $data = $this->eventData;

        DB::table('nft_operator_approvals')->updateOrInsert(
            [
                'owner' => strtolower($data['owner']),
                'operator' => strtolower($data['operator']),
            ],
            [
                'approved' => $data['approved'],
                'updated_at' => now(),
            ]
        );
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('区块链事件处理失败', [
            'event_type' => $this->eventType,
            'event_data' => $this->eventData,
            'error' => $exception->getMessage(),
        ]);

        // 将失败的事件记录到死信表
        DB::table('failed_blockchain_events')->insert([
            'event_type' => $this->eventType,
            'event_data' => json_encode($this->eventData),
            'error_message' => $exception->getMessage(),
            'failed_at' => now(),
        ]);
    }
}
```

### 5.5 历史事件回溯与同步

除了实时监听，有时还需要回溯历史事件（如系统停机期间遗漏的事件）：

```php
<?php
// app/Services/EventSyncService.php

namespace App\Services;

use App\Jobs\ProcessBlockchainEvent;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Web3\Web3;
use Web3\Contract as Web3Contract;

class EventSyncService
{
    protected Web3 $web3;
    protected Web3Contract $nftContract;

    public function __construct()
    {
        $this->web3 = app(Web3::class);

        $abiPath = config('web3.contracts.nft.abi_path');
        $abi = file_get_contents($abiPath);
        $this->nftContract = new Web3Contract(
            config('web3.rpc_url'),
            $abi
        );
    }

    /**
     * 同步指定区块范围内的事件
     * @param int $fromBlock 起始区块
     * @param int|null $toBlock 结束区块（null 表示最新区块）
     */
    public function syncTransferEvents(int $fromBlock, ?int $toBlock = null): int
    {
        $contractAddress = config('web3.contracts.nft.address');

        // 分批查询，避免单次查询范围过大
        $batchSize = 2000; // 每批查询的区块数
        $currentBlock = $fromBlock;
        $processedCount = 0;

        if ($toBlock === null) {
            $toBlock = $this->getLatestBlockNumber();
        }

        while ($currentBlock <= $toBlock) {
            $endBlock = min($currentBlock + $batchSize - 1, $toBlock);

            Log::info("同步事件: 区块 {$currentBlock} 到 {$endBlock}");

            try {
                $events = $this->queryEvents(
                    'Transfer',
                    $contractAddress,
                    $currentBlock,
                    $endBlock
                );

                foreach ($events as $event) {
                    ProcessBlockchainEvent::dispatch(
                        [
                            'from' => $event['args'][0],
                            'to' => $event['args'][1],
                            'tokenId' => $event['args'][2]->toString(),
                            'txHash' => $event['transactionHash'],
                            'blockNumber' => $event['blockNumber'],
                        ],
                        'Transfer'
                    )->onQueue('blockchain-sync');

                    $processedCount++;
                }

                // 更新同步进度
                $this->updateSyncProgress('Transfer', $endBlock);

            } catch (\Exception $e) {
                Log::error('事件同步失败', [
                    'from' => $currentBlock,
                    'to' => $endBlock,
                    'error' => $e->getMessage(),
                ]);

                // 等待后重试
                sleep(5);
                continue;
            }

            $currentBlock = $endBlock + 1;
        }

        Log::info("事件同步完成，共处理 {$processedCount} 个事件");

        return $processedCount;
    }

    /**
     * 查询链上事件
     */
    protected function queryEvents(
        string $eventName,
        string $contractAddress,
        int $fromBlock,
        int $toBlock
    ): array {
        $events = [];

        $this->nftContract->at($contractAddress)
            ->event($eventName)
            ->fromBlock($fromBlock)
            ->toBlock($toBlock)
            ->get(function ($err, $result) use (&$events) {
                if ($err) {
                    throw new \RuntimeException("查询事件失败: " . $err->getMessage());
                }
                $events = $result;
            });

        return $events;
    }

    /**
     * 获取最新区块号
     */
    protected function getLatestBlockNumber(): int
    {
        $blockNumber = null;
        $this->web3->eth->blockNumber(function ($err, $number) use (&$blockNumber) {
            if ($err) {
                throw new \RuntimeException("获取最新区块号失败: " . $err->getMessage());
            }
            $blockNumber = $number;
        });

        return (int) $blockNumber;
    }

    /**
     * 更新同步进度
     */
    protected function updateSyncProgress(string $eventName, int $lastBlock): void
    {
        DB::table('event_sync_progress')->updateOrInsert(
            ['event_name' => $eventName],
            [
                'last_synced_block' => $lastBlock,
                'updated_at' => now(),
            ]
        );
    }

    /**
     * 获取上次同步的区块号
     */
    public function getLastSyncedBlock(string $eventName): int
    {
        $progress = DB::table('event_sync_progress')
            ->where('event_name', $eventName)
            ->first();

        return $progress ? (int) $progress->last_synced_block : 0;
    }
}
```

---

## 六、API 路由设计与控制器

### 6.1 路由定义

```php
<?php
// routes/api.php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\API\AuthController;
use App\Http\Controllers\API\NFTController;
use App\Http\Controllers\API\ContractController;

// 公开路由：签名认证
Route::prefix('auth')->group(function () {
    Route::post('/nonce', [AuthController::class, 'getNonce']);
    Route::post('/login', [AuthController::class, 'login']);
});

// 需要钱包认证的路由
Route::middleware('wallet.auth')->group(function () {
    // 用户信息
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);

    // NFT 相关
    Route::prefix('nft')->group(function () {
        Route::get('/balance', [NFTController::class, 'getBalance']);
        Route::get('/tokens', [NFTController::class, 'getUserTokens']);
        Route::get('/token/{tokenId}', [NFTController::class, 'getTokenDetail']);
        Route::post('/mint', [NFTController::class, 'mintNFT']);
        Route::post('/transfer', [NFTController::class, 'transferNFT']);
        Route::post('/approve', [NFTController::class, 'approveNFT']);
    });

    // 合约交互
    Route::prefix('contract')->group(function () {
        Route::get('/info', [ContractController::class, 'getContractInfo']);
        Route::post('/call', [ContractController::class, 'callContractMethod']);
        Route::get('/events', [ContractController::class, 'getEvents']);
    });
});
```

### 6.2 NFT 控制器

```php
<?php
// app/Http/Controllers/API/NFTController.php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Services\SmartContractService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class NFTController extends Controller
{
    public function __construct(
        protected SmartContractService $contractService
    ) {}

    /**
     * 查询用户 NFT 余额
     */
    public function getBalance(Request $request): JsonResponse
    {
        $wallet = $request->input('authenticated_wallet');

        // 优先从缓存读取
        $cacheKey = "nft_count:" . strtolower($wallet);
        $balance = Cache::get($cacheKey);

        if ($balance === null) {
            $balance = $this->contractService->getNFTBalance($wallet);
            Cache::put($cacheKey, $balance, 300); // 缓存 5 分钟
        }

        return response()->json([
            'wallet' => $wallet,
            'balance' => $balance,
        ]);
    }

    /**
     * 获取用户持有的所有 NFT
     */
    public function getUserTokens(Request $request): JsonResponse
    {
        $wallet = strtolower($request->input('authenticated_wallet'));

        $tokens = DB::table('nft_tokens')
            ->where('owner_address', $wallet)
            ->orderBy('token_id')
            ->paginate(20);

        return response()->json($tokens);
    }

    /**
     * 获取单个 NFT 详情
     */
    public function getTokenDetail(int $tokenId): JsonResponse
    {
        // 从数据库获取基本信息
        $token = DB::table('nft_tokens')
            ->where('token_id', $tokenId)
            ->first();

        if (!$token) {
            return response()->json(['error' => 'Token 不存在'], 404);
        }

        // 从链上获取元数据
        try {
            $tokenURI = $this->contractService->getTokenURI($tokenId);
            // 如果是 IPFS URI，可以解析元数据
            $metadata = null;
            if ($tokenURI) {
                $metadataUrl = str_replace('ipfs://', 'https://ipfs.io/ipfs/', $tokenURI);
                $response = \Http::timeout(10)->get($metadataUrl);
                if ($response->successful()) {
                    $metadata = $response->json();
                }
            }
        } catch (\Exception $e) {
            $metadata = null;
        }

        // 获取转移历史
        $transfers = DB::table('nft_transfers')
            ->where('token_id', $tokenId)
            ->orderBy('block_number', 'desc')
            ->limit(10)
            ->get();

        return response()->json([
            'token' => [
                'id' => $tokenId,
                'owner' => $token->owner_address,
                'mint_tx_hash' => $token->mint_tx_hash,
                'mint_block_number' => $token->mint_block_number,
            ],
            'metadata' => $metadata,
            'transfers' => $transfers,
        ]);
    }

    /**
     * 后端铸造 NFT
     */
    public function mintNFT(Request $request): JsonResponse
    {
        $wallet = $request->input('authenticated_wallet');

        // 检查铸造条件（如白名单、每日限制等）
        $todayMintCount = DB::table('nft_tokens')
            ->where('owner_address', strtolower($wallet))
            ->whereDate('created_at', today())
            ->count();

        if ($todayMintCount >= 3) {
            return response()->json([
                'error' => '今日铸造次数已达上限（3次/天）',
            ], 429);
        }

        try {
            $result = $this->contractService->mintNFT($wallet);

            return response()->json([
                'message' => 'NFT 铸造成功',
                'tx_hash' => $result['tx_hash'],
                'token_id' => $result['token_id'] ?? null,
                'gas_used' => $result['gas_used'],
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'error' => '铸造失败',
                'message' => $e->getMessage(),
            ], 500);
        }
    }
}
```

---

## 七、数据库迁移与模型

### 7.1 数据库迁移

```php
<?php
// database/migrations/2026_06_01_000001_create_users_table.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('wallet_address', 42)->unique()->index();
            $table->string('name')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
```

```php
<?php
// database/migrations/2026_06_01_000002_create_nft_tables.php

return new class extends Migration
{
    public function up(): void
    {
        // NFT Token 记录表
        Schema::create('nft_tokens', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('token_id')->unique()->index();
            $table->string('owner_address', 42)->index();
            $table->string('mint_tx_hash', 66);
            $table->unsignedBigInteger('mint_block_number');
            $table->timestamps();

            $table->index('owner_address');
        });

        // NFT 转移历史表
        Schema::create('nft_transfers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('token_id')->index();
            $table->string('from_address', 42);
            $table->string('to_address', 42);
            $table->string('tx_hash', 66);
            $table->unsignedBigInteger('block_number');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['token_id', 'block_number']);
        });

        // 事件同步进度表
        Schema::create('event_sync_progress', function (Blueprint $table) {
            $table->id();
            $table->string('event_name')->unique();
            $table->unsignedBigInteger('last_synced_block');
            $table->timestamps();
        });

        // 失败的事件记录表
        Schema::create('failed_blockchain_events', function (Blueprint $table) {
            $table->id();
            $table->string('event_type');
            $table->json('event_data');
            $table->text('error_message')->nullable();
            $table->timestamp('failed_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('failed_blockchain_events');
        Schema::dropIfExists('event_sync_progress');
        Schema::dropIfExists('nft_transfers');
        Schema::dropIfExists('nft_tokens');
    }
};
```

---

## 八、安全最佳实践与常见陷阱

### 8.1 安全清单

在构建 DApp 后端时，安全是重中之重。以下是一份关键的安全检查清单：

**签名验证安全。** 永远不要信任前端传来的钱包地址，必须通过签名验证来确认用户身份。使用 nonce 机制防止重放攻击，每个 nonce 只能使用一次，且应设置合理的过期时间（建议 5-15 分钟）。优先使用 EIP-712 结构化签名而非简单的 personal_sign，因为 EIP-712 会在 MetaMask 中显示可读的签名内容，防止钓鱼攻击。

**私钥管理。** 后端私钥绝不应硬编码在代码中或提交到版本控制系统。应使用环境变量、密钥管理服务（如 AWS KMS、HashiCorp Vault）或硬件安全模块（HSM）来存储。定期轮换密钥，并确保有完整的密钥恢复方案。

**重入攻击防护。** 在与智能合约交互时，特别是涉及 DeFi 协议时，需要注意重入攻击。后端在处理链上操作结果时，应使用乐观锁或分布式锁来防止并发导致的状态不一致。

**API 限流。** 对关键 API（如铸造、转账）实施严格的限流策略，防止恶意调用消耗 Gas 或造成经济损失。

### 8.2 常见陷阱与解决方案

**陷阱一：Gas 估算不准确。** Gas 估算可能因为链上状态变化而变得不准确。解决方案是在估算的 Gas 基础上增加 20-30% 的 buffer，并设置合理的 Gas 上限。

```php
// 不推荐：直接使用估算值
$gasLimit = $gasEstimate;

// 推荐：增加 buffer
$gasLimit = (int) ($gasEstimate * 1.3);
```

**陷阱二：Nonce 管理不当。** 后端并发发送多笔交易时，如果 Nonce 管理不当，会导致交易失败或卡住。建议使用 Redis 维护一个自增的 Nonce 计数器：

```php
protected function getNextNonce(string $address): int
{
    $cacheKey = "tx_nonce:{$address}";

    return Cache::lock("nonce_lock:{$address}", 10, function () use ($address, $cacheKey) {
        $cachedNonce = Cache::get($cacheKey);

        if ($cachedNonce === null) {
            // 从链上获取当前 nonce
            $cachedNonce = $this->getNonce($address);
        }

        $nextNonce = $cachedNonce;
        Cache::put($cacheKey, $nextNonce + 1, 3600);

        return $nextNonce;
    });
}
```

**陷阱三：事件监听断连。** WebSocket 连接可能因为网络问题而断开。务必实现自动重连机制，并在重连后从上次处理的区块开始重新同步，避免遗漏事件。

**陷阱四：ABI 不匹配。** 如果前端和后端使用的合约 ABI 版本不一致，可能导致调用参数编码错误。建议将 ABI 文件存储在一个公共位置（如 CDN 或 Git 子模块），前后端共用同一份 ABI。

**陷阱五：链 ID 未验证。** 未验证签名中的链 ID 可能导致跨链重放攻击。在验证签名时，确保 domain separator 中的 chainId 与当前网络一致。

**陷阱六：数字精度问题。** 涉及代币金额的计算时，应始终使用最小单位（Wei）进行计算，只在最终展示时才转换为人类可读的格式（如 ETH）。避免使用浮点数：

```php
// 不推荐：使用浮点数计算
$amount = 1.5; // 1.5 ETH
$wei = $amount * 1e18; // 可能有精度丢失

// 推荐：使用字符串或 BigInt
$wei = '1500000000000000000'; // 直接使用 Wei
// 或使用库进行转换
$wei = Utils::toWei('1.5', 'ether');
```

**陷阱七：ethers.js v5 → v6 迁移的破坏性变更。** ethers.js v6 相比 v5 有大量 API 变更，迁移时最容易踩坑的几个点：

```javascript
// ❌ v5 写法（不再可用）
const provider = new ethers.providers.Web3Provider(window.ethereum);
const balance = ethers.utils.formatEther(wei);
const tx = await contract.functions.mint(to);

// ✅ v6 正确写法
const provider = new ethers.BrowserProvider(window.ethereum);
const balance = ethers.formatEther(wei);
const tx = await contract.mint(to);  // 不再需要 .functions
```

另外，v6 中 `BigNumber` 被原生 `BigInt` 取代，`utils` 命名空间被移除，所有工具函数直接从 `ethers` 导入。迁移时建议全局搜索 `ethers.utils.`、`ethers.BigNumber`、`.providers.Web3Provider` 进行替换。

**陷阱八：MetaMask 签名弹窗被浏览器拦截。** 在某些浏览器中，如果签名请求不是由用户直接交互（如点击按钮）触发的，MetaMask 的弹窗可能被浏览器拦截。解决方案是确保所有签名请求都在用户点击事件的同步调用栈中发起，不要在 `setTimeout` 或异步回调中调用 `signer.signMessage()`：

```javascript
// ❌ 可能被拦截
async function onLoginClick() {
  await fetchNonce(); // 先获取 nonce
  setTimeout(async () => {
    await signer.signMessage(nonce); // 异步后再签名，可能被拦截
  }, 100);
}

// ✅ 推荐做法
async function onLoginClick() {
  const nonce = await fetchNonce(); // 先获取 nonce
  // 在同一个 async 函数中连续调用，用户感知是同一个交互
  const signature = await signer.signMessage(nonce);
}
```

**陷阱九：web3.php 回调模式的异常处理。** web3.php 使用回调模式处理异步结果，但回调中的异常不会自动冒泡到外层。务必在每个回调中检查 `$err` 参数：

```php
// ❌ 错误写法：忽略错误检查
$this->web3->eth->getBalance($address, function ($err, $balance) use (&$result) {
    $result = $balance->toString(); // 如果 $err 不为 null，$balance 可能为 null
});

// ✅ 正确写法：始终检查错误
$this->web3->eth->getBalance($address, function ($err, $balance) use (&$result) {
    if ($err) {
        throw new RuntimeException('查询余额失败: ' . $err->getMessage());
    }
    $result = $balance->toString();
});
```

### 8.3 生产环境部署清单

```
┌──────────────────────────────────────────────────────────────┐
│                    生产环境部署检查清单                         │
├──────────────────────────────────────────────────────────────┤
│ □ 使用 HTTPS 和 WSS（不是 WS）                               │
│ □ 配置多个 RPC 节点作为备选                                    │
│ □ 实现 RPC 节点健康检查和自动切换                               │
│ □ 配置 Laravel Queue Worker（Supervisor）                     │
│ □ 设置 Redis 持久化（AOF 模式）                                │
│ □ 配置日志收集（ELK / Loki）                                  │
│ □ 设置 Gas 价格告警阈值                                       │
│ □ 配置合约事件监控告警                                         │
│ □ 定期备份事件同步进度表                                       │
│ □ 实现私钥的热/冷分离存储                                      │
│ □ 配置 API 限流和 DDoS 防护                                   │
│ □ 进行安全审计（特别是签名验证逻辑）                            │
│ □ 准备紧急暂停（Circuit Breaker）机制                          │
│ □ 编写并测试灾难恢复流程                                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 九、高级话题：多链适配与 Gas 优化

### 9.1 多链适配架构

现代 DApp 通常需要支持多条区块链（以太坊主网、Polygon、BSC、Arbitrum 等）。以下是多链适配的设计方案：

```php
<?php
// app/Services/MultiChainService.php

namespace App\Services;

use Web3\Web3;
use Web3\Contract as Web3Contract;

class MultiChainService
{
    protected array $chains = [];

    public function __construct()
    {
        $this->chains = config('web3.chains', []);
    }

    /**
     * 获取指定链的 Web3 实例
     */
    public function getWeb3(string $chain): Web3
    {
        $config = $this->getChainConfig($chain);
        return new Web3($config['rpc_url']);
    }

    /**
     * 获取指定链上的合约实例
     */
    public function getContract(string $chain, string $contractName): Web3Contract
    {
        $config = $this->getChainConfig($chain);
        $contractConfig = $config['contracts'][$contractName];

        $abi = file_get_contents($contractConfig['abi_path']);
        return new Web3Contract($config['rpc_url'], $abi);
    }

    /**
     * 获取链配置
     */
    protected function getChainConfig(string $chain): array
    {
        if (!isset($this->chains[$chain])) {
            throw new \InvalidArgumentException("不支持的链: {$chain}");
        }
        return $this->chains[$chain];
    }

    /**
     * 获取支持的链列表
     */
    public function getSupportedChains(): array
    {
        return array_keys($this->chains);
    }
}
```

对应配置：

```php
<?php
// config/web3.php (多链配置)

return [
    'chains' => [
        'ethereum' => [
            'name' => 'Ethereum Mainnet',
            'chain_id' => 1,
            'rpc_url' => env('ETH_RPC_URL', 'https://mainnet.infura.io/v3/xxx'),
            'ws_url' => env('ETH_WS_URL', 'wss://mainnet.infura.io/ws/v3/xxx'),
            'contracts' => [
                'nft' => [
                    'address' => env('ETH_NFT_ADDRESS'),
                    'abi_path' => storage_path('app/contracts/nft.abi.json'),
                ],
            ],
        ],
        'polygon' => [
            'name' => 'Polygon Mainnet',
            'chain_id' => 137,
            'rpc_url' => env('POLYGON_RPC_URL', 'https://polygon-rpc.com/'),
            'ws_url' => env('POLYGON_WS_URL'),
            'contracts' => [
                'nft' => [
                    'address' => env('POLYGON_NFT_ADDRESS'),
                    'abi_path' => storage_path('app/contracts/nft.abi.json'),
                ],
            ],
        ],
        'sepolia' => [
            'name' => 'Sepolia Testnet',
            'chain_id' => 11155111,
            'rpc_url' => env('SEPOLIA_RPC_URL'),
            'ws_url' => env('SEPOLIA_WS_URL'),
            'contracts' => [
                'nft' => [
                    'address' => env('SEPOLIA_NFT_ADDRESS'),
                    'abi_path' => storage_path('app/contracts/nft.abi.json'),
                ],
            ],
        ],
    ],
];
```

### 9.2 Gas 优化策略

Gas 费用是 DApp 运营的重要成本。以下是几种有效的 Gas 优化策略：

**批量操作。** 将多个操作合并为一笔交易，减少交易基础成本（21000 Gas）的重复消耗：

```solidity
// Solidity 合约中的批量铸造方法
function batchMint(address[] calldata recipients) external payable {
    require(recipients.length > 0, "No recipients");
    require(recipients.length <= 20, "Too many recipients");

    for (uint256 i = 0; i < recipients.length; i++) {
        _mint(recipients[i], _nextTokenId++);
    }
}
```

**交易时机选择。** Gas 价格在一天中会波动较大。可以通过监控 Gas 价格预言机，在 Gas 价格较低的时段（通常是 UTC 凌晨）批量执行非紧急操作：

```php
<?php
// app/Services/GasOptimizer.php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class GasOptimizer
{
    /**
     * 获取当前 Gas 价格并判断是否适合发送交易
     */
    public function shouldSendTransaction(float $maxGwei = 30): array
    {
        $response = Http::get('https://api.etherscan.io/api', [
            'module' => 'gastracker',
            'action' => 'gasoracle',
            'apikey' => config('services.etherscan.key'),
        ]);

        $data = $response->json('result');
        $currentGwei = (float) $data['SafeGasPrice'];

        return [
            'current_gwei' => $currentGwei,
            'should_send' => $currentGwei <= $maxGwei,
            'recommendation' => $currentGwei <= $maxGwei
                ? '当前 Gas 价格较低，建议立即发送'
                : "当前 Gas 价格 {$currentGwei} Gwei，建议等待",
        ];
    }
}
```

---

## 十、完整示例：一个 NFT 市场的后端实现

### 10.1 架构概览

以下是一个简化版 NFT 市场的后端架构示例，展示了前述所有技术的实际整合应用：

```
NFT 市场功能模块：
├── 用户认证模块
│   ├── 钱包连接 (ethers.js)
│   ├── 签名验证 (EIP-712)
│   └── JWT Token 管理 (Sanctum)
├── NFT 管理模块
│   ├── NFT 列表查询
│   ├── NFT 详情与元数据
│   ├── NFT 铸造（后端签名）
│   └── NFT 转移（前端签名）
├── 市场交易模块
│   ├── 挂单（上架）
│   ├── 购买（下架）
│   ├── 报价
│   └── 交易历史
└── 事件监听模块
    ├── Transfer 事件监听
    ├── Approval 事件监听
    ├── Sale 事件监听
    └── 历史事件同步
```

### 10.2 市场控制器核心代码

```php
<?php
// app/Http/Controllers/API/MarketplaceController.php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Services\SmartContractService;
use App\Jobs\ProcessBlockchainEvent;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

class MarketplaceController extends Controller
{
    public function __construct(
        protected SmartContractService $contractService
    ) {}

    /**
     * NFT 挂单（上架）
     * 注意：实际的挂单逻辑在链上合约中完成
     * 这里只是将链上挂单信息同步到本地数据库
     */
    public function createListing(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'token_id' => 'required|integer',
            'price' => 'required|string', // Wei 单位
            'tx_hash' => 'required|string|size:66',
        ]);

        $wallet = strtolower($request->input('authenticated_wallet'));

        // 验证用户是该 NFT 的所有者
        $token = DB::table('nft_tokens')
            ->where('token_id', $validated['token_id'])
            ->where('owner_address', $wallet)
            ->first();

        if (!$token) {
            return response()->json(['error' => '您不是该 NFT 的所有者'], 403);
        }

        // 保存挂单信息
        $listing = DB::table('nft_listings')->insertGetId([
            'token_id' => $validated['token_id'],
            'seller_address' => $wallet,
            'price_wei' => $validated['price'],
            'tx_hash' => $validated['tx_hash'],
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json([
            'listing_id' => $listing,
            'message' => '挂单成功',
        ]);
    }

    /**
     * 获取活跃挂单列表
     */
    public function getListings(Request $request): JsonResponse
    {
        $query = DB::table('nft_listings')
            ->join('nft_tokens', 'nft_listings.token_id', '=', 'nft_tokens.token_id')
            ->where('nft_listings.status', 'active');

        // 按价格筛选
        if ($request->has('min_price')) {
            $query->where('nft_listings.price_wei', '>=', $request->input('min_price'));
        }
        if ($request->has('max_price')) {
            $query->where('nft_listings.price_wei', '<=', $request->input('max_price'));
        }

        // 排序
        $sortBy = $request->input('sort', 'created_at');
        $sortDir = $request->input('order', 'desc');
        $query->orderBy("nft_listings.{$sortBy}", $sortDir);

        $listings = $query->select(
            'nft_listings.*',
            'nft_tokens.owner_address'
        )->paginate(20);

        return response()->json($listings);
    }

    /**
     * 购买 NFT
     * 前端通过智能合约完成实际购买
     * 此接口用于记录购买记录和更新状态
     */
    public function confirmPurchase(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'listing_id' => 'required|integer',
            'tx_hash' => 'required|string|size:66',
        ]);

        $buyer = strtolower($request->input('authenticated_wallet'));

        // 更新挂单状态
        $listing = DB::table('nft_listings')
            ->where('id', $validated['listing_id'])
            ->where('status', 'active')
            ->first();

        if (!$listing) {
            return response()->json(['error' => '该挂单不存在或已失效'], 404);
        }

        DB::transaction(function () use ($listing, $buyer, $validated) {
            // 更新挂单状态
            DB::table('nft_listings')
                ->where('id', $listing->id)
                ->update([
                    'status' => 'sold',
                    'buyer_address' => $buyer,
                    'sold_tx_hash' => $validated['tx_hash'],
                    'sold_at' => now(),
                    'updated_at' => now(),
                ]);

            // 记录交易历史
            DB::table('nft_sales')->insert([
                'token_id' => $listing->token_id,
                'seller_address' => $listing->seller_address,
                'buyer_address' => $buyer,
                'price_wei' => $listing->price_wei,
                'tx_hash' => $validated['tx_hash'],
                'created_at' => now(),
            ]);

            // 更新 NFT 所有者
            DB::table('nft_tokens')
                ->where('token_id', $listing->token_id)
                ->update([
                    'owner_address' => $buyer,
                    'updated_at' => now(),
                ]);

            // 清除缓存
            Cache::forget("nft_count:" . $listing->seller_address);
            Cache::forget("nft_count:" . $buyer);
        });

        return response()->json(['message' => '购买确认成功']);
    }

    /**
     * 获取用户的交易历史
     */
    public function getTradeHistory(Request $request): JsonResponse
    {
        $wallet = strtolower($request->input('authenticated_wallet'));

        $purchases = DB::table('nft_sales')
            ->where('buyer_address', $wallet)
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get();

        $sales = DB::table('nft_sales')
            ->where('seller_address', $wallet)
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get();

        return response()->json([
            'purchases' => $purchases,
            'sales' => $sales,
        ]);
    }
}
```

---

## 十一、测试策略

### 11.1 单元测试示例

```php
<?php
// tests/Unit/Services/SignatureVerificationServiceTest.php

namespace Tests\Unit\Services;

use App\Services\SignatureVerificationService;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class SignatureVerificationServiceTest extends TestCase
{
    protected SignatureVerificationService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(SignatureVerificationService::class);
    }

    public function test_generate_nonce_stores_in_cache(): void
    {
        $walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';

        $nonce = $this->service->generateNonce($walletAddress);

        $this->assertNotEmpty($nonce);
        $this->assertStringContainsString($walletAddress, $nonce);

        // 验证 nonce 已存入缓存
        $cached = Cache::get("signature_nonce:" . strtolower($walletAddress));
        $this->assertEquals($nonce, $cached);
    }

    public function test_verify_personal_sign_rejects_expired_nonce(): void
    {
        $walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';
        $message = 'expired nonce message';

        $this->expectException(\RuntimeException::class);
        $this->service->verifyPersonalSign($walletAddress, $message, '0xfake');
    }

    public function test_verify_personal_sign_rejects_mismatched_address(): void
    {
        $walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';

        // 先生成 nonce
        $nonce = $this->service->generateNonce($walletAddress);

        // 使用一个不匹配的签名（实际测试中需要真实签名）
        $fakeSignature = '0x' . str_repeat('ab', 65);

        // 这里因为签名恢复的地址与 walletAddress 不同，应该返回 false
        $result = $this->service->verifyPersonalSign($walletAddress, $nonce, $fakeSignature);

        $this->assertFalse($result);
    }
}
```

### 11.2 集成测试

```php
<?php
// tests/Feature/API/WalletAuthTest.php

namespace Tests\Feature\API;

use Tests\TestCase;
use Illuminate\Support\Facades\Cache;

class WalletAuthTest extends TestCase
{
    public function test_get_nonce_returns_valid_nonce(): void
    {
        $response = $this->postJson('/api/auth/nonce', [
            'wallet_address' => '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        ]);

        $response->assertOk()
            ->assertJsonStructure(['nonce', 'expires_in']);
    }

    public function test_protected_route_requires_wallet_auth(): void
    {
        $response = $this->getJson('/api/me');

        $response->assertUnauthorized();
    }

    public function test_protected_route_accepts_valid_signature(): void
    {
        // 这里需要使用真实的签名进行测试
        // 可以使用 Hardhat/Anvil 的测试账户来生成签名
        $response = $this->getJson('/api/me', [
            'X-Wallet-Address' => '0x...',
            'X-Wallet-Signature' => '0x...',
            'X-Sign-Message' => '...',
        ]);

        $response->assertOk();
    }
}
```

---

## 十二、总结与展望

本文从零开始，完整地展示了如何使用 Laravel 后端配合 ethers.js（前端）和 web3.php（后端）构建一个生产级的 DApp 后端系统。我们涵盖了以下几个核心主题：

**前端钱包连接。** 使用 ethers.js v6 实现了与 MetaMask 的无缝连接，包括钱包连接、账户切换、网络切换等完整的生命周期管理。通过 EIP-712 结构化签名，为用户提供了安全且可读的签名体验。

**后端签名验证。** 实现了基于 Laravel 中间件的签名验证机制，支持 personal_sign 和 EIP-712 两种签名格式。通过 nonce 机制和一次性使用策略，有效防止了重放攻击。

**智能合约交互。** 使用 web3.php 实现了后端与以太坊智能合约的完整交互，包括只读查询、交易签名与发送、Gas 估算等。特别是后端私钥签名铸造的场景，展示了服务端如何安全地管理私钥并执行链上操作。

**事件监听系统。** 构建了基于 WebSocket 的实时事件监听系统，配合 Laravel Queue 实现了可靠的异步事件处理。同时提供了历史事件回溯和同步功能，确保系统的数据完整性。

**安全最佳实践。** 详细讨论了 DApp 后端开发中的安全要点和常见陷阱，提供了生产环境部署的完整检查清单。

Web3 集成技术正在快速演进。未来的发展方向包括账户抽象（ERC-4337）、链下签名的更多应用场景（如 EIP-712 的扩展使用）、Layer 2 解决方案的深度集成，以及跨链互操作协议的支持。作为 PHP/Laravel 开发者，现在正是深入 Web3 领域的最佳时机——扎实的后端工程能力与 Web3 技术的结合，将创造出真正有价值的新一代去中心化应用。

希望本文能够为你开启 Laravel DApp 开发之旅提供全面且实用的指导。如有疑问或建议，欢迎在评论区讨论交流。

---

## 相关阅读

- [API 安全加固实战：JWT 黑名单、请求签名、IP 白名单、防重放攻击——Laravel B2C API 多层防御深度踩坑记录](/categories/架构/API-安全加固实战-JWT-黑名单-请求签名-IP白名单-防重放攻击-Laravel-B2C-API踩坑记录/)
- [Laravel B2C API - JWT/OAuth/Session 多协议认证踩坑记录](/categories/架构/jwt-oauth-session/)
- [分布式缓存一致性实战：Cache-Aside/Write-Through/Write-Behind 在 Laravel 中的工程化落地](/categories/架构/分布式缓存一致性实战-Cache-Aside-Write-Through-Write-Behind在Laravel中的工程化落地/)
