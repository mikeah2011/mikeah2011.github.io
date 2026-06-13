---
title: 'Web3 集成实战：ethers.js/web3.php 钱包连接与智能合约交互——Laravel DApp 后端的签名验证与事件监听'
date: 2026-06-03 10:00:00
tags: [Web3, ethers.js, web3.php, Laravel, 智能合约, DApp, Solidity]
keywords: [Web3, ethers.js, web3.php, Laravel DApp, 集成实战, 钱包连接与智能合约交互, 后端的签名验证与事件监听, PHP]
categories:
  - php
cover: https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&h=630&fit=crop
description: 从零构建 Laravel DApp 后端的完整 Web3 集成方案：使用 ethers.js 实现前端钱包连接与签名、web3.php 完成链上智能合约调用与事件监听、EIP-712 结构化签名验证防重放攻击。涵盖 ERC-20/721 合约交互、交易状态追踪、Gas 估算优化、多链适配等生产级实战代码，帮助 PHP/Laravel 开发者全面掌握去中心化应用后端开发技术栈。
---


## 一、引言：为什么传统 Web 应用需要 Web3 集成？

在区块链技术飞速发展的今天，Web3 不再仅仅是加密货币爱好者的专属领域。越来越多的传统 Web 应用开始探索与区块链的深度集成——从数字资产确权、去中心化身份认证，到 NFT 市场、DeFi 协议对接，Web3 正在重塑互联网应用的底层信任架构。

对于广大的 PHP/Laravel 开发者而言，理解并掌握 Web3 集成技术，意味着能够构建真正具有去中心化特性的 DApp（Decentralized Application）后端。本文将以实战为导向，深入讲解如何使用 ethers.js（前端）与 web3.php（后端）实现钱包连接、智能合约交互、签名验证与事件监听的完整技术栈，帮助 Laravel 开发者全面拥抱 Web3 生态。

**传统 Web2 应用面临的核心痛点包括以下几个方面。** 首先是身份中心化风险。在传统的用户认证体系中，用户的用户名、密码、邮箱等敏感信息全部存储在中心化数据库中。一旦数据库遭到入侵或泄露，后果将不堪设想。近年来频繁发生的大型平台数据泄露事件已经充分证明了这一点。而去中心化身份认证让用户通过自己的加密钱包来证明身份，私钥永远不会离开用户设备，从根本上消除了中心化存储带来的安全隐患。

其次是数字资产确权困难。在传统互联网中，用户在平台上购买的数字商品（如游戏道具、会员权益、数字艺术品等）实际上并不真正属于用户。平台可以随时修改规则、删除内容甚至关闭服务。而在区块链上，一旦资产被铸造并记录在链上，其所有权就由智能合约自动维护，任何人都无法篡改，真正实现了"代码即法律"的数字所有权。

第三是信任依赖第三方的问题。无论是在线支付、跨境转账还是数字版权交易，传统模式都需要依赖银行、支付平台、版权机构等中心化中介。这不仅增加了交易成本和时间，还引入了单点故障风险。智能合约的出现使得交易双方可以直接在链上完成价值交换，无需任何中介参与，极大地降低了信任成本。

第四是数据透明度不足。在中心化系统中，用户无法验证平台的运营数据是否真实、交易记录是否被篡改、分红规则是否被公平执行。而区块链的公开透明特性使得所有交易记录和合约逻辑都可以被任何人验证，为系统提供了天然的审计能力。

**Web3 集成能够为传统应用带来以下核心价值。** 用户可以通过加密钱包自主控制自己的身份和数据，实现真正的自主身份（Self-Sovereign Identity）。链上资产具有可验证、可追溯、不可篡改的特性，使得数字资产的所有权得到真正的保障。智能合约能够自动执行预设的业务逻辑，减少人为干预和操作风险。事件日志天然具备审计属性，每一笔链上操作都有据可查。

接下来，我们将从 Web3 的基础概念开始讲起，逐步深入到生产级别的实战代码，帮助读者全面掌握 Laravel 应用与以太坊区块链的集成技术。

---

## 二、Web3 基础概念：以太坊、EVM 与智能合约

### 2.1 以太坊（Ethereum）平台概述

以太坊是目前最主流的智能合约区块链平台，由 Vitalik Buterin 于 2013 年提出，2015 年正式上线。与比特币主要作为去中心化数字货币的设计目标不同，以太坊的核心创新在于引入了图灵完备的编程环境，允许开发者在其上构建任意复杂的去中心化应用程序。

以太坊的技术架构包含多个核心组件。**EVM（以太坊虚拟机）** 是整个平台的计算引擎，负责执行智能合约的字节码。它是一个完全隔离的沙箱环境，合约代码无法直接访问外部网络或本地文件系统，这保证了执行的安全性和确定性。每个操作码都有对应的 Gas 消耗，防止恶意代码无限循环消耗网络资源。

**账户模型** 是以太坊的另一个重要概念。以太坊采用账户模型而非比特币的 UTXO 模型。账户分为两种类型：外部账户（EOA，Externally Owned Account）由私钥控制，可以主动发起交易；合约账户（Contract Account）由部署在链上的代码控制，只能在接收到交易时被动执行。

**Gas 机制** 是以太坊经济模型的核心。每一次链上操作（无论是转账还是合约调用）都需要消耗 Gas，Gas 的价格由市场供需决定。这种机制既防止了网络资源被滥用，也为验证者提供了经济激励。在 EIP-1559 升级之后，Gas 费用分为基础费用（Base Fee，会被销毁）和优先费用（Priority Fee，支付给验证者）两部分。

**共识机制** 方面，以太坊在 2022 年 9 月完成了从工作量证明（PoW）到权益证明（PoS）的重大升级，即"The Merge"。PoS 机制下，验证者需要质押至少 32 个 ETH 才能参与区块验证，这大大降低了能源消耗，同时也提升了网络的安全性和去中心化程度。

### 2.2 智能合约详解

智能合约是部署在以太坊区块链上的程序，由 Solidity 语言编写，编译后部署到 EVM 上运行。智能合约一旦部署便不可修改（除非使用代理升级模式），其代码和状态数据永久存储在链上。

以下是本文将要使用的 ERC-721 NFT 合约的完整实现：

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MyNFT
 * @dev 一个简单的 ERC-721 NFT 合约，支持元数据 URI 和铸造功能
 */
contract MyNFT is ERC721, ERC721URIStorage, Ownable {
    uint256 private _tokenIdCounter;

    // 铸造事件，前端和后端都可以监听
    event NFTMinted(address indexed to, uint256 indexed tokenId, string tokenURI);

    constructor() ERC721("MyNFT", "MNFT") Ownable(msg.sender) {}

    /**
     * @dev 铸造新的 NFT
     * @param to 接收者的地址
     * @param uri 元数据 URI（指向 JSON 格式的元数据）
     * @return tokenId 新铸造的代币 ID
     */
    function mint(address to, string memory uri) public onlyOwner returns (uint256) {
        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        emit NFTMinted(to, tokenId, uri);
        return tokenId;
    }

    /**
     * @dev 获取当前已铸造的 NFT 总数
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    // 以下两个函数是 ERC721URIStorage 抽象函数的实现
    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

这个合约继承了 OpenZeppelin 的 ERC721 和 ERC721URIStorage 标准实现。OpenZeppelin 是业界最权威的智能合约标准库，其代码经过了大量审计和实战验证，强烈建议在生产环境中使用。合约中的 `onlyOwner` 修饰符确保只有合约所有者才能铸造 NFT，这是常见的安全控制措施。

### 2.3 ABI（应用程序二进制接口）

ABI 是与智能合约进行交互的接口描述文件，它类似于传统 Web 开发中的 Swagger/OpenAPI 规范。ABI 定义了合约中每个函数的名称、输入参数类型、输出参数类型、状态修改属性等关键信息。

Solidity 编译器在编译合约时会自动生成 ABI 的 JSON 格式文件。前端的 ethers.js 和后端的 web3.php 都需要使用 ABI 来编码函数调用参数和解码返回结果。以下是一个典型的 ABI 条目示例：

```json
{
  "inputs": [
    { "name": "to", "type": "address" },
    { "name": "uri", "type": "string" }
  ],
  "name": "mint",
  "outputs": [
    { "name": "", "type": "uint256" }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

ABI 中的 `stateMutability` 字段有三个可能的值：`view` 表示只读函数，不消耗 Gas；`pure` 表示纯计算函数，不读取也不修改链上状态；`nonpayable` 和 `payable` 表示会修改链上状态的函数，其中 `payable` 允许附带 ETH 转账。理解这些区别对于优化 Gas 消耗和设计交互流程非常重要。

---

## 三、ethers.js 前端集成：钱包连接与消息签名

### 3.1 ethers.js 概述与安装

ethers.js 是以太坊生态中最流行的 JavaScript 交互库之一，由 Richard Moore 开发维护。与 web3.js 相比，ethers.js 具有体积更小、API 设计更现代、TypeScript 支持更好、License 更宽松（MIT）等优势。目前推荐使用 v6 版本，它在 API 设计上做了大量改进，采用 Promise 优先的异步模式，支持 Tree Shaking 来减小打包体积。

```bash
# 使用 npm 安装
npm install ethers@^6

# 或使用 yarn
yarn add ethers@^6

# 或使用 pnpm
pnpm add ethers@^6
```

ethers.js 的核心模块包括：`providers` 模块负责与以太坊节点的通信；`signers` 模块负责交易签名；`contract` 模块负责智能合约交互；`utils` 模块提供各种工具函数（如地址校验、单位转换、ABI 编码解码等）。

### 3.2 MetaMask 钱包连接的完整流程

MetaMask 是目前用户量最大的浏览器钱包扩展，支持 Chrome、Firefox、Brave 等主流浏览器。连接 MetaMask 是几乎所有 DApp 的第一步，也是用户进入 Web3 世界的入口。

以下是完整的钱包连接模块实现，包含了错误处理、状态管理和事件监听：

```javascript
// wallet.js - 钱包连接管理模块
import { BrowserProvider, formatEther, parseEther } from 'ethers';

class WalletConnector {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.address = null;
        this.chainId = null;
        this.balance = null;
        this._listeners = new Map();
    }

    /**
     * 检查 MetaMask 是否已安装
     * 在引导用户连接之前，应该先检查浏览器是否安装了 MetaMask
     */
    isMetaMaskInstalled() {
        return typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask;
    }

    /**
     * 检查钱包是否已连接（无需再次请求授权）
     * 如果用户之前已经授权过，可以直接获取当前选中的账户
     */
    async checkConnection() {
        if (!this.isMetaMaskInstalled()) {
            return { connected: false, reason: 'NOT_INSTALLED' };
        }

        try {
            const accounts = await window.ethereum.request({
                method: 'eth_accounts'
            });

            if (accounts.length > 0) {
                await this._initializeWithAccount(accounts[0]);
                return { connected: true, address: this.address };
            }

            return { connected: false, reason: 'NOT_CONNECTED' };
        } catch (error) {
            console.error('检查连接状态失败:', error);
            return { connected: false, reason: 'ERROR', error: error.message };
        }
    }

    /**
     * 请求连接钱包
     * 调用此方法时，MetaMask 会弹出授权弹窗，要求用户确认
     */
    async connect() {
        if (!this.isMetaMaskInstalled()) {
            throw new Error('请先安装 MetaMask 钱包扩展。访问 https://metamask.io 下载安装。');
        }

        try {
            // eth_requestAccounts 会触发 MetaMask 弹窗
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });

            if (accounts.length === 0) {
                throw new Error('用户拒绝了连接请求');
            }

            await this._initializeWithAccount(accounts[0]);

            // 设置事件监听器，捕获账户和网络切换
            this._setupEventListeners();

            console.log('钱包连接成功:', this.address);
            console.log('当前网络 Chain ID:', this.chainId);
            console.log('账户余额:', this.balance, 'ETH');

            return {
                address: this.address,
                chainId: this.chainId,
                balance: this.balance,
            };
        } catch (error) {
            // 用户拒绝连接时，MetaMask 会抛出特定错误
            if (error.code === 4001) {
                throw new Error('用户拒绝了钱包连接请求');
            }
            console.error('连接钱包时发生错误:', error);
            throw error;
        }
    }

    /**
     * 使用指定账户初始化 provider 和 signer
     */
    async _initializeWithAccount(account) {
        this.address = account;
        // BrowserProvider 将 MetaMask 的内部 provider 封装为 ethers.js 标准接口
        this.provider = new BrowserProvider(window.ethereum);
        // getSigner 返回代表当前选中账户的签名者对象
        this.signer = await this.provider.getSigner();

        const network = await this.provider.getNetwork();
        this.chainId = Number(network.chainId);

        const balanceWei = await this.provider.getBalance(this.address);
        this.balance = formatEther(balanceWei);
    }

    /**
     * 设置 MetaMask 事件监听器
     * MetaMask 会在用户切换账户、切换网络、锁定钱包时触发事件
     */
    _setupEventListeners() {
        // 监听账户切换事件
        window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts.length === 0) {
                // 用户断开了所有账户的连接
                console.log('钱包已断开连接');
                this.address = null;
                this.signer = null;
                this.balance = null;
                this._emit('disconnected');
            } else {
                // 用户切换到了另一个账户
                this.address = accounts[0];
                console.log('账户已切换:', this.address);
                this._emit('accountChanged', { address: accounts[0] });
                // 重新获取余额
                this.provider.getBalance(this.address).then(bal => {
                    this.balance = formatEther(bal);
                });
            }
        });

        // 监听网络切换事件
        window.ethereum.on('chainChanged', (chainId) => {
            const newChainId = parseInt(chainId, 16);
            console.log('网络已切换，新 Chain ID:', newChainId);
            this.chainId = newChainId;
            this._emit('chainChanged', { chainId: newChainId });
            // 网络切换后建议刷新页面，避免状态不一致
            window.location.reload();
        });

        // 监听连接事件
        window.ethereum.on('connect', (connectInfo) => {
            console.log('MetaMask 已连接:', connectInfo);
            this._emit('connected', { chainId: parseInt(connectInfo.chainId, 16) });
        });

        // 监听断开连接事件
        window.ethereum.on('disconnect', (error) => {
            console.log('MetaMask 已断开:', error);
            this._emit('disconnected', { error });
        });
    }

    /**
     * 切换到指定的以太坊网络
     * 如果目标网络未在 MetaMask 中添加，会提示用户添加
     */
    async switchToNetwork(chainId, networkConfig = null) {
        const hexChainId = '0x' + chainId.toString(16);

        try {
            // 尝试切换到目标网络
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: hexChainId }]
            });
        } catch (error) {
            // 错误码 4902 表示该网络尚未添加到 MetaMask
            if (error.code === 4902 && networkConfig) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: hexChainId,
                        chainName: networkConfig.name,
                        nativeCurrency: networkConfig.currency,
                        rpcUrls: networkConfig.rpcUrls,
                        blockExplorerUrls: networkConfig.explorerUrls,
                    }]
                });
            } else {
                throw error;
            }
        }
    }

    /**
     * 简单的事件发布方法
     */
    _emit(event, data) {
        const handlers = this._listeners.get(event) || [];
        handlers.forEach(handler => handler(data));
    }

    on(event, handler) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(handler);
    }
}

export default new WalletConnector();
```

上面的代码实现了一个完整的钱包连接管理器。值得注意的是，我们在连接成功后设置了四个关键的事件监听器：`accountsChanged` 用于检测用户切换账户或断开连接；`chainChanged` 用于检测用户切换网络；`connect` 和 `disconnect` 则分别处理连接和断开事件。这些事件监听器确保了前端状态与钱包实际状态的同步，是 DApp 开发中非常重要的模式。

### 3.3 消息签名：证明钱包所有权

签名是 Web3 身份验证的核心机制。其基本原理是：用户使用自己的私钥对一条指定的消息进行签名，后端收到签名后通过密码学方法恢复出签名者的地址，如果恢复的地址与用户声称的地址一致，则证明该用户确实拥有对应钱包的私钥。整个过程中，私钥永远不会离开用户的设备或浏览器，这是签名认证最核心的安全优势。

```javascript
// signature.js - 签名认证服务模块
import { BrowserProvider } from 'ethers';

class SignatureService {
    /**
     * 对消息进行签名
     * 调用此方法时 MetaMask 会弹出签名确认窗口
     * 用户可以在确认窗口中看到要签名的完整内容
     */
    async signMessage(message) {
        if (!window.ethereum) {
            throw new Error('MetaMask 未安装');
        }

        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        console.log('请求签名，钱包地址:', address);
        console.log('签名消息内容:', message);

        // signMessage 会触发 MetaMask 的签名确认弹窗
        // 签名使用 EIP-191 个人消息标准
        const signature = await signer.signMessage(message);

        console.log('签名完成，签名值:', signature);

        return {
            address,
            signature,
            message
        };
    }

    /**
     * 构建 EIP-4361 (Sign-In with Ethereum) 标准消息
     * SIWE 是目前社区推荐的钱包登录标准格式
     * 使用标准化格式可以提高可读性和安全性
     */
    buildSIWEMessage(domain, address, uri, nonce, chainId = 1) {
        const issuedAt = new Date().toISOString();
        const expirationTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

        return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to ${domain}

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`;
    }

    /**
     * 完整的 Sign-In with Ethereum (SIWE) 登录流程
     * 这是一个四步流程：获取 nonce -> 构建消息 -> 签名 -> 后端验证
     */
    async signInWithEthereum(domain, apiBaseUrl) {
        // 第一步：从后端获取一次性 nonce
        // nonce 的作用是确保每次签名都是唯一的，防止重放攻击
        const nonceResponse = await fetch(`${apiBaseUrl}/auth/nonce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const { nonce } = await nonceResponse.json();

        // 第二步：使用 SIWE 标准格式构建签名消息
        const address = await this._getCurrentAddress();
        const message = this.buildSIWEMessage(
            domain,
            address,
            `https://${domain}`,
            nonce
        );

        // 第三步：请求用户签名
        const signatureData = await this.signMessage(message);

        // 第四步：将签名数据发送到后端进行验证
        const verifyResponse = await fetch(`${apiBaseUrl}/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(signatureData)
        });

        const result = await verifyResponse.json();

        if (result.token) {
            // 验证成功，保存 JWT Token 用于后续 API 调用
            localStorage.setItem('auth_token', result.token);
            console.log('登录成功，Token 已保存');
        } else {
            console.error('登录失败:', result.error);
        }

        return result;
    }

    /**
     * 获取当前连接的钱包地址
     */
    async _getCurrentAddress() {
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        return await signer.getAddress();
    }

    /**
     * 检查用户是否已登录（Token 是否存在且有效）
     */
    isAuthenticated() {
        const token = localStorage.getItem('auth_token');
        return token !== null && token !== '';
    }

    /**
     * 获取存储的认证 Token
     */
    getAuthToken() {
        return localStorage.getItem('auth_token');
    }

    /**
     * 登出
     */
    logout() {
        localStorage.removeItem('auth_token');
        console.log('已登出');
    }
}

export default new SignatureService();
```

### 3.4 前端智能合约交互

在前端与智能合约交互时，我们需要区分"只读操作"和"写入操作"。只读操作（如查询余额、获取代币信息）不需要用户签名，也不会消耗 Gas。写入操作（如铸造 NFT、转让代币）则需要用户通过钱包确认并签名交易，同时需要消耗 Gas。

```javascript
// contract.js - 智能合约交互服务模块
import { BrowserProvider, Contract, parseEther, formatEther } from 'ethers';

// 合约 ABI 定义
// 在实际项目中，ABI 通常从编译产物中导入，这里为了演示方便直接内联
const NFT_ABI = [
    // 只读函数
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function getApproved(uint256 tokenId) view returns (address)",
    "function isApprovedForAll(address owner, address operator) view returns (bool)",

    // 写入函数
    "function mint(address to, string uri) public returns (uint256)",
    "function approve(address to, uint256 tokenId) public",
    "function setApprovalForAll(address operator, bool approved) public",
    "function transferFrom(address from, address to, uint256 tokenId) public",

    // 事件
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
    "event NFTMinted(address indexed to, uint256 indexed tokenId, string tokenURI)",
];

class ContractService {
    constructor(contractAddress, chainId = 1) {
        this.contractAddress = contractAddress;
        this.chainId = chainId;
    }

    /**
     * 获取只读合约实例
     * 使用 BrowserProvider 创建的合约实例只能调用 view/pure 函数
     * 不需要用户签名，也不会消耗 Gas
     */
    async getReadOnlyContract() {
        const provider = new BrowserProvider(window.ethereum);
        return new Contract(this.contractAddress, NFT_ABI, provider);
    }

    /**
     * 获取可写合约实例
     * 使用 Signer 创建的合约实例可以调用任何函数
     * 写入操作需要用户在 MetaMask 中确认并签名
     */
    async getWritableContract() {
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        return new Contract(this.contractAddress, NFT_ABI, signer);
    }

    /**
     * 铸造 NFT
     * 这是一个写入操作，会触发 MetaMask 确认弹窗
     */
    async mintNFT(toAddress, metadataURI) {
        const contract = await this.getWritableContract();

        // 发送交易
        const tx = await contract.mint(toAddress, metadataURI);
        console.log('铸造交易已发送，交易哈希:', tx.hash);

        // 等待交易被矿工确认（通常需要 1-3 个区块确认）
        const receipt = await tx.wait();
        console.log('铸造交易已确认:', {
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
        });

        // 从事件日志中解析铸造的 Token ID
        const mintEvent = receipt.logs.find(log => {
            try {
                const parsed = contract.interface.parseLog(log);
                return parsed.name === 'NFTMinted';
            } catch {
                return false;
            }
        });

        let tokenId = null;
        if (mintEvent) {
            const parsed = contract.interface.parseLog(mintEvent);
            tokenId = Number(parsed.args.tokenId);
        }

        return {
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            tokenId,
        };
    }

    /**
     * 查询指定地址持有的 NFT 数量
     */
    async getBalance(address) {
        const contract = await this.getReadOnlyContract();
        const balance = await contract.balanceOf(address);
        return Number(balance);
    }

    /**
     * 查询 NFT 的元数据 URI
     * 返回的 URI 可能是 IPFS 链接、HTTP 链接或 base64 编码的 JSON
     */
    async getTokenURI(tokenId) {
        const contract = await this.getReadOnlyContract();
        return await contract.tokenURI(tokenId);
    }

    /**
     * 查询 NFT 的当前所有者
     */
    async getOwnerOf(tokenId) {
        const contract = await this.getReadOnlyContract();
        return await contract.ownerOf(tokenId);
    }

    /**
     * 授权 NFT 给指定地址（用于市场上架）
     * 在将 NFT 转入市场合约之前，需要先授权市场合约操作该 NFT
     */
    async approveNFT(spenderAddress, tokenId) {
        const contract = await this.getWritableContract();
        const tx = await contract.approve(spenderAddress, tokenId);
        const receipt = await tx.wait();
        return {
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
        };
    }

    /**
     * 监听合约事件
     * ethers.js 提供了实时事件监听能力
     * 注意：这需要 WebSocket RPC 节点支持
     */
    async listenToTransferEvents(callback) {
        const contract = await this.getReadOnlyContract();

        // 监听所有 Transfer 事件
        contract.on('Transfer', (from, to, tokenId, event) => {
            const eventData = {
                from,
                to,
                tokenId: Number(tokenId),
                txHash: event.log.transactionHash,
                blockNumber: event.log.blockNumber,
                logIndex: event.log.index,
            };
            console.log('检测到 Transfer 事件:', eventData);
            callback(eventData);
        });

        // 监听铸造事件
        contract.on('NFTMinted', (to, tokenId, tokenURI, event) => {
            console.log('检测到铸造事件:', {
                to,
                tokenId: Number(tokenId),
                tokenURI,
            });
        });

        console.log('合约事件监听已启动，合约地址:', this.contractAddress);
    }

    /**
     * 查询历史事件
     * 用于获取指定区块范围内的历史事件记录
     */
    async queryTransferEvents(fromBlock = 0, toBlock = 'latest', filterAddress = null) {
        const contract = await this.getReadOnlyContract();

        let filter = contract.filters.Transfer();
        if (filterAddress) {
            filter = contract.filters.Transfer(null, filterAddress);
        }

        const events = await contract.queryFilter(filter, fromBlock, toBlock);

        return events.map(event => ({
            from: event.args.from,
            to: event.args.to,
            tokenId: Number(event.args.tokenId),
            txHash: event.transactionHash,
            blockNumber: event.blockNumber,
        }));
    }
}

export default ContractService;
```

以上前端代码展示了 ethers.js 的核心使用模式。在实际项目中，我们通常会将这些服务封装成 Vue/React 组件的组合式函数（Composable）或自定义 Hook，方便在多个页面中复用。

---

## 四、web3.php 后端集成：Laravel 中的区块链交互

### 4.1 为什么选择 web3.php

对于 PHP/Laravel 开发者来说，web3.php 是与以太坊区块链交互的首选库。它由 Sc0Vu 开发并维护，功能覆盖了 JSON-RPC 调用、合约交互、ABI 编码解码等核心功能。虽然 PHP 生态在 Web3 工具链的丰富程度上不如 JavaScript 生态，但 web3.php 足以满足绝大多数 DApp 后端的开发需求。

web3.php 的主要优势包括：支持完整的以太坊 JSON-RPC API；提供合约调用的高层封装；支持事件日志的查询和解析；与 Composer 生态无缝集成。当然，它的不足之处也很明显：由于 PHP 的同步执行特性，实时事件监听不如 Node.js 灵活，需要通过轮询或消息队列来弥补。

### 4.2 安装与基础配置

首先通过 Composer 安装必要的依赖包：

```bash
# 安装核心 Web3 库
composer require web3/web3

# 安装以太坊离线签名库（用于后端签名验证）
composer require kornrunner/ethereum-offline-signatures

# 安装 Keccak 哈希库（以太坊地址推导需要）
composer require simplito/elliptic-php
```

接下来创建 Laravel 配置文件，集中管理所有 Web3 相关的配置项：

```php
<?php
// config/web3.php

return [
    /*
    |--------------------------------------------------------------------------
    | 以太坊 RPC 节点配置
    |--------------------------------------------------------------------------
    | 推荐使用 Infura 或 Alchemy 等专业节点服务商
    | 不建议使用公共节点，它们通常有严格的速率限制
    |--------------------------------------------------------------------------
    */
    'rpc_url' => env('WEB3_RPC_URL', 'https://mainnet.infura.io/v3/YOUR_PROJECT_ID'),

    'chain_id' => (int) env('WEB3_CHAIN_ID', 1),

    /*
    |--------------------------------------------------------------------------
    | 智能合约地址配置
    |--------------------------------------------------------------------------
    | 每个合约需要配置部署地址和 ABI 文件路径
    | ABI 文件在编译合约时自动生成
    |--------------------------------------------------------------------------
    */
    'contracts' => [
        'nft' => [
            'address' => env('NFT_CONTRACT_ADDRESS', ''),
            'abi' => storage_path('app/contracts/nft_abi.json'),
        ],
        'marketplace' => [
            'address' => env('MARKETPLACE_CONTRACT_ADDRESS', ''),
            'abi' => storage_path('app/contracts/marketplace_abi.json'),
        ],
        'erc20_token' => [
            'address' => env('ERC20_TOKEN_ADDRESS', ''),
            'abi' => storage_path('app/contracts/erc20_abi.json'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | 服务器管理钱包配置
    |--------------------------------------------------------------------------
    | 用于后端主动发起交易的热钱包
    | 私钥安全至关重要，务必使用环境变量存储
    | 生产环境建议使用 AWS KMS 或 HashiCorp Vault
    |--------------------------------------------------------------------------
    */
    'server_wallet' => [
        'address' => env('SERVER_WALLET_ADDRESS', ''),
        'private_key' => env('SERVER_WALLET_PRIVATE_KEY', ''),
    ],

    /*
    |--------------------------------------------------------------------------
    | 事件监听配置
    |--------------------------------------------------------------------------
    | 控制合约事件的同步行为
    |--------------------------------------------------------------------------
    */
    'event_listener' => [
        // 轮询间隔（秒）
        'polling_interval' => (int) env('WEB3_POLLING_INTERVAL', 15),
        // 起始同步区块号（0 表示从合约部署区块开始）
        'start_block' => (int) env('WEB3_START_BLOCK', 0),
        // 每批次查询的区块范围
        'batch_size' => (int) env('WEB3_EVENT_BATCH_SIZE', 1000),
    ],
];
```

### 4.3 创建 Web3 服务提供者

Laravel 的服务提供者是管理依赖注入的最佳方式。我们将 Web3 相关的核心对象注册为单例，确保整个应用生命周期中只创建一次连接：

```php
<?php
// app/Providers/Web3ServiceProvider.php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Web3\Web3;
use Web3\Contract;
use Web3\Providers\HttpProvider;
use Web3\RequestManagers\HttpRequestManager;

class Web3ServiceProvider extends ServiceProvider
{
    /**
     * 注册 Web3 相关的服务到 Laravel 容器
     * 所有服务都注册为单例，避免重复创建连接
     */
    public function register(): void
    {
        // 注册 Web3 主实例
        // 这是与以太坊节点通信的核心对象
        $this->app->singleton(Web3::class, function () {
            $rpcUrl = config('web3.rpc_url');
            return new Web3(new HttpProvider(
                new HttpRequestManager($rpcUrl, 10)  // 10 秒超时
            ));
        });

        // 注册 NFT 合约实例
        $this->app->singleton('web3.contract.nft', function () {
            $abiPath = config('web3.contracts.nft.abi');
            if (!file_exists($abiPath)) {
                throw new \RuntimeException("NFT 合约 ABI 文件不存在: {$abiPath}");
            }
            $abi = file_get_contents($abiPath);
            return new Contract(config('web3.rpc_url'), $abi);
        });

        // 注册市场合约实例
        $this->app->singleton('web3.contract.marketplace', function () {
            $abiPath = config('web3.contracts.marketplace.abi');
            $abi = file_exists($abiPath) ? file_get_contents($abiPath) : '[]';
            return new Contract(config('web3.rpc_url'), $abi);
        });

        // 注册 ERC20 代币合约实例
        $this->app->singleton('web3.contract.erc20', function () {
            $abiPath = config('web3.contracts.erc20.abi');
            $abi = file_exists($abiPath) ? file_get_contents($abiPath) : '[]';
            return new Contract(config('web3.rpc_url'), $abi);
        });
    }

    /**
     * 引导服务提供者
     * 在这里可以发布配置文件、注册中间件等
     */
    public function boot(): void
    {
        // 发布配置文件
        $this->publishes([
            __DIR__ . '/../../config/web3.php' => config_path('web3.php'),
        ], 'web3-config');
    }
}
```

在 `config/app.php` 的 providers 数组中注册此服务提供者，Laravel 就会在启动时自动执行注册逻辑。之后，在应用的任何位置都可以通过依赖注入或 `app()` 辅助函数来获取 Web3 实例。

### 4.4 核心 Web3 服务类实现

这个服务类封装了所有与区块链交互的核心逻辑，包括余额查询、交易查询、合约调用等功能：

```php
<?php
// app/Services/Web3Service.php

namespace App\Services;

use Web3\Web3;
use Web3\Contract;
use Web3\Utils;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class Web3Service
{
    protected Web3 $web3;
    protected Contract $nftContract;
    protected string $nftAddress;

    public function __construct(
        Web3 $web3,
        Contract $nftContract
    ) {
        $this->web3 = $web3;
        $this->nftContract = $nftContract;
        $this->nftAddress = config('web3.contracts.nft.address');
    }

    /**
     * 获取指定地址的 ETH 余额
     * 余额以 ETH 为单位返回（非 Wei）
     *
     * @param string $address 以太坊地址
     * @return string ETH 余额（字符串形式，保留精度）
     */
    public function getBalance(string $address): string
    {
        $balance = '0x0';

        // web3.php 使用回调模式处理异步结果
        // 在 PHP 的同步上下文中，回调会在调用后立即执行
        $this->web3->eth->getBalance($address, function ($err, $result) use (&$balance) {
            if ($err !== null) {
                Log::error('获取余额失败', [
                    'address' => $address,
                    'error' => $err->getMessage(),
                ]);
                throw new \RuntimeException('获取余额失败: ' . $err->getMessage());
            }
            $balance = $result->toString();
        });

        // 将 Wei 转换为 ETH（1 ETH = 10^18 Wei）
        return Utils::fromWei($balance, 'ether');
    }

    /**
     * 获取当前最新的区块号
     * 区块号是同步合约事件的重要参考点
     */
    public function getLatestBlockNumber(): int
    {
        $blockNumber = 0;

        $this->web3->eth->blockNumber(function ($err, $result) use (&$blockNumber) {
            if ($err !== null) {
                throw new \RuntimeException('获取区块号失败: ' . $err->getMessage());
            }
            $blockNumber = (int) $result->toString();
        });

        return $blockNumber;
    }

    /**
     * 根据交易哈希获取交易详情
     * 包括发送者、接收者、金额、Gas 信息等
     */
    public function getTransaction(string $txHash): ?array
    {
        $transaction = null;

        $this->web3->eth->getTransaction($txHash, function ($err, $result) use (&$transaction) {
            if ($err !== null) {
                Log::error('获取交易详情失败', [
                    'txHash' => $txHash,
                    'error' => $err->getMessage(),
                ]);
                return;
            }

            if ($result !== null) {
                $transaction = [
                    'hash'        => $result->hash,
                    'from'        => $result->from,          // 发送者地址
                    'to'          => $result->to,            // 接收者地址（合约创建时为 null）
                    'value'       => Utils::fromWei($result->value->toString(), 'ether'),
                    'gas'         => $result->gas->toString(),
                    'gasPrice'    => $result->gasPrice->toString(),
                    'blockNumber' => $result->blockNumber ? $result->blockNumber->toString() : null,
                    'input'       => $result->input,         // 合约调用的编码数据
                ];
            }
        });

        return $transaction;
    }

    /**
     * 获取交易回执
     * 交易回执包含了交易执行的结果，如状态、Gas 消耗、事件日志等
     */
    public function getTransactionReceipt(string $txHash): ?array
    {
        $receipt = null;

        $this->web3->eth->getTransactionReceipt($txHash, function ($err, $result) use (&$receipt) {
            if ($err !== null) {
                Log::error('获取交易回执失败', ['txHash' => $txHash]);
                return;
            }

            if ($result !== null) {
                $receipt = [
                    'status'      => $result->status->toString() === '0x1',  // true=成功, false=失败
                    'blockNumber' => $result->blockNumber->toString(),
                    'gasUsed'     => $result->gasUsed->toString(),
                    'logs'        => $result->logs,            // 事件日志数组
                    'contractAddress' => $result->contractAddress, // 合约创建时的新合约地址
                ];
            }
        });

        return $receipt;
    }

    /**
     * 查询指定地址持有的 NFT 数量
     * 这是一个只读的合约调用，不消耗 Gas
     */
    public function getNFTBalance(string $ownerAddress): int
    {
        $balance = 0;

        $this->nftContract->at($this->nftAddress)
            ->call('balanceOf', $ownerAddress, function ($err, $result) use (&$balance) {
                if ($err !== null) {
                    throw new \RuntimeException('查询 NFT 余额失败: ' . $err->getMessage());
                }
                // 返回值是一个数组，第一个元素是结果
                $balance = (int) $result[0]->toString();
            });

        return $balance;
    }

    /**
     * 获取 NFT 的元数据 URI
     * URI 通常指向 IPFS 或 HTTP 上的 JSON 元数据文件
     */
    public function getTokenURI(int $tokenId): string
    {
        $uri = '';

        $this->nftContract->at($this->nftAddress)
            ->call('tokenURI', $tokenId, function ($err, $result) use (&$uri) {
                if ($err !== null) {
                    throw new \RuntimeException('获取 Token URI 失败: ' . $err->getMessage());
                }
                $uri = $result[0];
            });

        return $uri;
    }

    /**
     * 获取 NFT 合约的总铸造量
     */
    public function getTotalSupply(): int
    {
        $supply = 0;

        $this->nftContract->at($this->nftAddress)
            ->call('totalSupply', function ($err, $result) use (&$supply) {
                if ($err !== null) {
                    throw new \RuntimeException('获取总供应量失败: ' . $err->getMessage());
                }
                $supply = (int) $result[0]->toString();
            });

        return $supply;
    }

    /**
     * 查询指定 NFT Token 的当前所有者
     * 用于验证用户是否真的拥有某个 NFT
     */
    public function getNFTOwner(int $tokenId): string
    {
        $owner = '';

        $this->nftContract->at($this->nftAddress)
            ->call('ownerOf', $tokenId, function ($err, $result) use (&$owner) {
                if ($err !== null) {
                    throw new \RuntimeException('获取 NFT 所有者失败: ' . $err->getMessage());
                }
                $owner = $result[0];
            });

        return $owner;
    }
}
```

这个服务类采用了 web3.php 的回调模式来处理链上查询结果。虽然在 PHP 的同步执行环境中，这种回调模式看起来有些奇怪（不同于 JavaScript 的异步模式），但 web3.php 内部实际上会在调用时同步执行回调。通过引用传递的变量模式（`use (&$balance)`），我们可以方便地获取回调中的结果。

---

## 五、签名验证：在 Laravel API 中验证钱包所有权

### 5.1 签名验证的核心原理

签名验证是 Web3 DApp 后端最关键的安全机制。整个流程可以概括为：前端用户使用私钥对消息签名，将签名结果发送到后端，后端通过密码学计算从签名中恢复出签名者的公钥地址，然后与用户声称的地址进行比对。

以太坊签名遵循 EIP-191 个人消息标准。在签名之前，消息会被自动添加一个特殊的前缀：`\x19Ethereum Signed Message:\n` 加上消息的长度。这个前缀的作用是防止签名被用于其他目的（例如被当作交易来提交）。后端在验证签名时，也需要对原始消息添加相同的前缀，然后进行哈希和地址恢复操作。

### 5.2 签名验证服务的完整实现

```php
<?php
// app/Services/SignatureVerificationService.php

namespace App\Services;

use kornrunner\Ethereum\Signature;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class SignatureVerificationService
{
    /**
     * 为指定地址生成一次性 nonce
     * nonce 是一个随机字符串，用于确保每次签名请求都是唯一的
     * 生成后会存入缓存，有效期为 5 分钟
     *
     * @param string $address 用户的以太坊地址
     * @return string 生成的 nonce 值
     */
    public function generateNonce(string $address): string
    {
        // 生成 32 字节的随机 nonce
        $nonce = Str::random(32);

        // 将 nonce 与地址关联存储，设置 5 分钟过期
        Cache::put(
            "web3:nonce:" . strtolower($address),
            $nonce,
            now()->addMinutes(5)
        );

        Log::info('已生成签名 nonce', [
            'address' => $address,
            'nonce' => $nonce,
            'expires_at' => now()->addMinutes(5)->toIso8601String(),
        ]);

        return $nonce;
    }

    /**
     * 验证以太坊签名
     * 从签名中恢复出签名者的地址，然后与期望的地址进行比对
     *
     * @param string $message   原始签名消息
     * @param string $signature 签名值（十六进制格式）
     * @param string $address   期望的签名者地址
     * @return bool 签名是否有效
     */
    public function verifySignature(
        string $message,
        string $signature,
        string $address
    ): bool {
        try {
            // 统一转为小写地址进行比较，以太坊地址大小写不敏感
            $address = strtolower($address);

            // 确保签名格式正确（必须以 0x 开头）
            if (!str_starts_with($signature, '0x')) {
                $signature = '0x' . $signature;
            }

            // 从签名中恢复签名者的以太坊地址
            $recoveredAddress = $this->recoverAddress($message, $signature);

            if ($recoveredAddress === null) {
                Log::warning('签名验证失败：无法从签名中恢复地址', [
                    'expected_address' => $address,
                    'message_preview' => Str::limit($message, 100),
                ]);
                return false;
            }

            $recoveredAddress = strtolower($recoveredAddress);

            Log::info('签名验证结果', [
                'expected_address'  => $address,
                'recovered_address' => $recoveredAddress,
                'is_match'          => $recoveredAddress === $address,
            ]);

            return $recoveredAddress === $address;
        } catch (\Exception $e) {
            Log::error('签名验证过程中发生异常', [
                'error'   => $e->getMessage(),
                'address' => $address,
                'trace'   => $e->getTraceAsString(),
            ]);
            return false;
        }
    }

    /**
     * 验证带有 nonce 的签名消息
     * 结合 nonce 验证来防止重放攻击
     *
     * @param string $message   签名消息（必须包含 nonce）
     * @param string $signature 签名值
     * @param string $address   签名者地址
     * @return bool 验证是否通过
     */
    public function verifySignedNonce(
        string $message,
        string $signature,
        string $address
    ): bool {
        $normalizedAddress = strtolower($address);

        // 第一步：检查 nonce 是否存在且未过期
        $storedNonce = Cache::get("web3:nonce:{$normalizedAddress}");

        if ($storedNonce === null) {
            Log::warning('签名验证失败：nonce 已过期或不存在', [
                'address' => $normalizedAddress,
            ]);
            return false;
        }

        // 第二步：验证消息中包含正确的 nonce
        if (!str_contains($message, $storedNonce)) {
            Log::warning('签名验证失败：消息中的 nonce 不匹配', [
                'address'       => $normalizedAddress,
                'stored_nonce'  => $storedNonce,
                'message_nonce' => 'not found',
            ]);
            return false;
        }

        // 第三步：验证消息是否包含过期时间
        if ($this->isMessageExpired($message)) {
            Log::warning('签名验证失败：签名消息已过期', [
                'address' => $normalizedAddress,
            ]);
            return false;
        }

        // 第四步：执行密码学签名验证
        $isValid = $this->verifySignature($message, $signature, $address);

        if ($isValid) {
            // 验证成功后立即删除 nonce，防止重放
            Cache::forget("web3:nonce:{$normalizedAddress}");
            Log::info('签名验证成功，nonce 已消费', [
                'address' => $normalizedAddress,
            ]);
        }

        return $isValid;
    }

    /**
     * 检查签名消息是否已过期
     * 消息中应包含 "Expiration Time:" 字段
     */
    protected function isMessageExpired(string $message): bool
    {
        if (preg_match('/Expiration Time:\s*(.+)/', $message, $matches)) {
            $expirationTime = strtotime(trim($matches[1]));
            return $expirationTime === false || $expirationTime < time();
        }
        // 如果没有过期时间字段，视为不安全，视为已过期
        return true;
    }

    /**
     * 从以太坊签名中恢复签名者地址
     *
     * 原理：
     * 1. 对原始消息添加 EIP-191 前缀
     * 2. 计算前缀消息的 Keccak-256 哈希
     * 3. 使用椭圆曲线签名算法从签名和哈希恢复公钥
     * 4. 从公钥推导出以太坊地址
     *
     * @param string $message   原始消息
     * @param string $signature 签名值
     * @return string|null 恢复的地址，失败返回 null
     */
    protected function recoverAddress(string $message, string $signature): ?string
    {
        try {
            // 添加 EIP-191 个人消息前缀
            $prefixedMessage = "\x19Ethereum Signed Message:\n" . strlen($message) . $message;

            // 计算 Keccak-256 哈希（以太坊使用的哈希算法）
            $messageHash = hash('sha3-256', $prefixedMessage, true);

            // 使用椭圆曲线库从签名中恢复公钥
            $publicKey = Signature::recover($messageHash, $signature);

            if ($publicKey === null || strlen($publicKey) < 65) {
                return null;
            }

            // 从公钥推导以太坊地址
            // 以太坊地址 = Keccak256(未压缩公钥)[12..32]（取最后 20 字节）
            $publicKeyWithoutPrefix = substr($publicKey, 1); // 去掉 0x04 前缀
            $hash = hash('sha3-256', $publicKeyWithoutPrefix);
            $address = '0x' . substr($hash, 24); // 取后 40 个十六进制字符

            return $address;
        } catch (\Exception $e) {
            Log::error('从签名恢复地址失败', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            return null;
        }
    }

    /**
     * 验证 EIP-712 类型化数据签名
     * EIP-712 提供了更结构化和可读的签名格式
     * 常用于 DeFi 协议中的订单签名、授权签名等场景
     *
     * @param array  $typedData EIP-712 格式的结构化数据
     * @param string $signature 签名值
     * @param string $address   签名者地址
     * @return bool
     */
    public function verifyTypedDataSignature(
        array $typedData,
        string $signature,
        string $address
    ): bool {
        try {
            // 计算域分隔符（Domain Separator）
            $domainSeparator = $this->hashDomain($typedData['domain']);

            // 计算消息结构体的哈希
            $primaryType = $typedData['primaryType'];
            $messageHash = $this->hashStruct(
                $typedData['message'],
                $typedData['types'][$primaryType]
            );

            // 组合最终哈希："\x19\x01" + domainSeparator + messageHash
            $finalHash = "\x19\x01" . $domainSeparator . $messageHash;
            $finalHashKeccak = hash('sha3-256', $finalHash, true);

            // 恢复地址并验证
            $recoveredAddress = $this->recoverAddress($finalHashKeccak, $signature);

            return $recoveredAddress !== null
                && strtolower($recoveredAddress) === strtolower($address);
        } catch (\Exception $e) {
            Log::error('EIP-712 类型化数据签名验证失败', [
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * 计算 EIP-712 域分隔符的哈希
     */
    protected function hashDomain(array $domain): string
    {
        // 简化实现，生产环境应使用完整的 EIP-712 编码
        $encoded = json_encode($domain, JSON_SORT_KEYS);
        return hash('sha3-256', $encoded, true);
    }

    /**
     * 计算 EIP-712 结构体的哈希
     */
    protected function hashStruct(array $data, array $types): string
    {
        $encoded = '';
        foreach ($types as $type) {
            $value = $data[$type['name']] ?? '';
            $encoded .= is_string($value) ? $value : (string) $value;
        }
        return hash('sha3-256', $encoded, true);
    }
}
```

上面的签名验证服务实现了三层安全防护：首先通过 nonce 机制确保每次签名请求都是唯一的，防止重放攻击；其次通过过期时间检查确保签名消息在有效期内；最后通过密码学验证确认签名的合法性。这种多层防护模式是生产环境中的最佳实践。

---

## 六、事件监听：使用 Laravel Queue 监控智能合约事件

### 6.1 事件监听的重要性

智能合约事件（Events）是链上系统与链下系统通信的核心桥梁。当合约中发生重要操作（如代币转移、NFT 铸造、订单成交等）时，合约会发出相应的事件日志。这些日志存储在以太坊的交易回执中，可以通过 JSON-RPC API 查询。

对于 DApp 后端来说，事件监听的价值在于：它可以让我们实时感知链上发生的所有重要活动，从而触发相应的业务逻辑。例如，当用户在合约中完成 NFT 的购买操作后，后端需要更新数据库中的订单状态、通知卖家、更新搜索索引等。如果没有事件监听机制，这些业务逻辑就无法自动触发。

### 6.2 事件监听服务的实现

由于 PHP 是同步执行的语言，无法像 Node.js 那样轻松实现 WebSocket 实时监听，因此我们采用轮询（Polling）的方式来监听事件。Laravel 的任务调度器（Scheduler）非常适合作为轮询的驱动：

```php
<?php
// app/Services/ContractEventService.php

namespace App\Services;

use Web3\Web3;
use Web3\Contract;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use App\Models\NFTTransfer;
use App\Models\MarketplaceListing;

class ContractEventService
{
    protected Web3 $web3;
    protected Contract $nftContract;
    protected string $nftAddress;
    protected int $chainId;

    // Transfer 事件的签名哈希
    // 这是 keccak256("Transfer(address,address,uint256)") 的结果
    const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    public function __construct(Web3 $web3, Contract $nftContract)
    {
        $this->web3 = $web3;
        $this->nftContract = $nftContract;
        $this->nftAddress = config('web3.contracts.nft.address');
        $this->chainId = config('web3.chain_id');
    }

    /**
     * 获取指定区块范围内的 Transfer 事件
     * 使用 eth_getLogs RPC 方法查询事件日志
     *
     * @param int $fromBlock 起始区块号
     * @param int $toBlock   结束区块号（0 表示最新区块）
     * @return array 解析后的事件数组
     */
    public function getTransferEvents(int $fromBlock, int $toBlock = 0): array
    {
        $events = [];

        // 构建事件过滤器
        $filter = [
            'fromBlock' => '0x' . dechex($fromBlock),
            'toBlock'   => $toBlock > 0 ? '0x' . dechex($toBlock) : 'latest',
            'address'   => $this->nftAddress,  // 合约地址
            'topics'    => [
                self::TRANSFER_EVENT_TOPIC,  // 事件签名
            ],
        ];

        $this->web3->eth->getLogs($filter, function ($err, $result) use (&$events) {
            if ($err !== null) {
                Log::error('获取合约事件日志失败', [
                    'error' => $err->getMessage(),
                ]);
                throw new \RuntimeException('获取事件日志失败: ' . $err->getMessage());
            }

            foreach ($result as $log) {
                $events[] = $this->parseTransferLog($log);
            }
        });

        return $events;
    }

    /**
     * 解析 Transfer 事件日志条目
     * Transfer 事件包含 3 个 indexed 参数：from, to, tokenId
     * indexed 参数存储在 topics 数组中，需要去除填充的零
     */
    protected function parseTransferLog($log): array
    {
        // topics[0] = 事件签名哈希
        // topics[1] = from 地址（32 字节，需要截取后 20 字节）
        // topics[2] = to 地址
        // topics[3] = tokenId（uint256，需要转换为十进制）
        $from = '0x' . substr($log->topics[1], 26);    // 去掉前面的 24 个零
        $to = '0x' . substr($log->topics[2], 26);
        $tokenId = hexdec($log->topics[3]);

        return [
            'from'        => strtolower($from),
            'to'          => strtolower($to),
            'tokenId'     => $tokenId,
            'txHash'      => $log->transactionHash,
            'blockNumber' => hexdec($log->blockNumber),
            'logIndex'    => hexdec($log->logIndex),
        ];
    }

    /**
     * 同步新产生的合约事件到数据库
     * 此方法由 Laravel 调度器定期调用
     *
     * @return int 处理的事件数量
     */
    public function syncNewEvents(): int
    {
        // 获取上次同步到的区块号
        $lastSyncedBlock = Cache::get(
            'web3:last_synced_block',
            config('web3.event_listener.start_block')
        );

        // 获取当前最新区块号
        $currentBlock = $this->getLatestBlockNumber();

        if ($lastSyncedBlock >= $currentBlock) {
            Log::debug('没有新的区块需要同步', [
                'lastSyncedBlock' => $lastSyncedBlock,
                'currentBlock'    => $currentBlock,
            ]);
            return 0;
        }

        Log::info('开始同步合约事件', [
            'fromBlock' => $lastSyncedBlock + 1,
            'toBlock'   => $currentBlock,
        ]);

        $totalProcessed = 0;
        $batchSize = config('web3.event_listener.batch_size', 1000);

        // 分批处理，避免单次请求数据量过大导致超时
        $cursor = $lastSyncedBlock;
        while ($cursor < $currentBlock) {
            $toBlock = min($cursor + $batchSize, $currentBlock);

            Log::info('同步事件批次', [
                'fromBlock' => $cursor + 1,
                'toBlock'   => $toBlock,
            ]);

            try {
                $events = $this->getTransferEvents($cursor + 1, $toBlock);

                foreach ($events as $event) {
                    $this->processTransferEvent($event);
                    $totalProcessed++;
                }

                // 更新同步进度
                Cache::put('web3:last_synced_block', $toBlock, now()->addDays(30));

                Log::info('批次同步完成', [
                    'toBlock'      => $toBlock,
                    'eventsFound'  => count($events),
                ]);
            } catch (\Exception $e) {
                Log::error('事件同步批次处理失败', [
                    'fromBlock' => $cursor + 1,
                    'toBlock'   => $toBlock,
                    'error'     => $e->getMessage(),
                ]);
                // 遇到错误时停止同步，等待下次调度重试
                break;
            }

            $cursor = $toBlock;
        }

        Log::info('事件同步任务完成', [
            'totalProcessed' => $totalProcessed,
            'lastSyncedBlock' => $cursor,
        ]);

        return $totalProcessed;
    }

    /**
     * 处理单个 Transfer 事件
     * 根据事件内容触发不同的业务逻辑
     */
    protected function processTransferEvent(array $event): void
    {
        // 记录到数据库（使用 updateOrCreate 防止重复）
        NFTTransfer::updateOrCreate(
            [
                'tx_hash'    => $event['txHash'],
                'log_index'  => $event['logIndex'],
            ],
            [
                'from_address'  => $event['from'],
                'to_address'    => $event['to'],
                'token_id'      => $event['tokenId'],
                'block_number'  => $event['blockNumber'],
                'chain_id'      => $this->chainId,
                'processed_at'  => now(),
            ]
        );

        // 检查是否涉及市场合约地址
        $marketplaceAddress = strtolower(config('web3.contracts.marketplace.address'));

        if (strtolower($event['to']) === $marketplaceAddress) {
            // NFT 被转入市场合约 = 上架操作
            $this->handleNFTDepositedToMarketplace($event);
        }

        if (strtolower($event['from']) === $marketplaceAddress) {
            // NFT 从市场合约转出 = 购买或取消操作
            $this->handleNFTWithdrawnFromMarketplace($event);
        }
    }

    /**
     * 处理 NFT 存入市场合约的事件
     * 这意味着卖家已经将 NFT 转入托管，上架请求应该变为活跃状态
     */
    protected function handleNFTDepositedToMarketplace(array $event): void
    {
        $listing = MarketplaceListing::where('token_id', $event['tokenId'])
            ->where('status', 'pending_deposit')
            ->first();

        if ($listing) {
            $listing->update([
                'status'          => 'active',
                'deposit_tx_hash' => $event['txHash'],
                'listed_at'       => now(),
            ]);

            Log::info('NFT 已成功上架', [
                'listing_id' => $listing->id,
                'token_id'   => $event['tokenId'],
                'tx_hash'    => $event['txHash'],
            ]);
        }
    }

    /**
     * 处理 NFT 从市场合约转出的事件
     * 这可能意味着购买成功（转给买家）或卖家取消了上架
     */
    protected function handleNFTWithdrawnFromMarketplace(array $event): void
    {
        $listing = MarketplaceListing::where('token_id', $event['tokenId'])
            ->where('status', 'active')
            ->first();

        if ($listing) {
            // 判断转出方向来区分是购买还是取消
            $sellerAddress = strtolower($listing->seller->wallet_address);

            if (strtolower($event['to']) === $sellerAddress) {
                // NFT 转回卖家 = 取消上架
                $listing->update([
                    'status' => 'cancelled',
                    'cancelled_at' => now(),
                ]);
            } else {
                // NFT 转给其他人 = 购买成功
                $listing->update([
                    'status'        => 'sold',
                    'sold_at'       => now(),
                    'sold_tx_hash'  => $event['txHash'],
                    'buyer_address' => $event['to'],
                ]);

                // 触发卖家支付流程
                \App\Jobs\ProcessSellerPayment::dispatch($listing->id)->onQueue('payments');
            }
        }
    }

    /**
     * 获取最新的区块号
     */
    protected function getLatestBlockNumber(): int
    {
        $blockNumber = 0;
        $this->web3->eth->blockNumber(function ($err, $result) use (&$blockNumber) {
            if ($err !== null) {
                throw new \RuntimeException('获取区块号失败: ' . $err->getMessage());
            }
            $blockNumber = (int) $result->toString();
        });
        return $blockNumber;
    }
}
```

### 6.3 事件同步的 Artisan 命令与调度配置

```php
<?php
// app/Console/Commands/SyncContractEvents.php

namespace App\Console\Commands;

use App\Services\ContractEventService;
use Illuminate\Console\Command;

class SyncContractEvents extends Command
{
    protected $signature = 'web3:sync-events
                            {--fresh : 从头开始同步（清除同步进度）}';

    protected $description = '同步以太坊智能合约事件到本地数据库';

    public function handle(ContractEventService $eventService): int
    {
        // 如果指定了 --fresh 参数，清除同步进度
        if ($this->option('fresh')) {
            \Illuminate\Support\Facades\Cache::forget('web3:last_synced_block');
            $this->warn('已清除同步进度，将从配置的起始区块开始同步');
        }

        $this->info('开始同步智能合约事件...');
        $startTime = microtime(true);

        try {
            $processed = $eventService->syncNewEvents();

            $elapsed = round(microtime(true) - $startTime, 2);
            $this->info("同步完成！共处理 {$processed} 个事件，耗时 {$elapsed} 秒");

            return Command::SUCCESS;
        } catch (\Exception $e) {
            $this->error("同步过程中发生错误: {$e->getMessage()}");
            $this->error($e->getTraceAsString());
            return Command::FAILURE;
        }
    }
}
```

在 Laravel 的调度器中配置定时任务：

```php
<?php
// app/Console/Kernel.php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        // 每 15 秒同步一次合约事件
        // withoutOverlapping 确保上一次任务未完成时不会重复执行
        // runInBackground 确保不会阻塞其他调度任务
        $schedule->command('web3:sync-events')
            ->everyFifteenSeconds()
            ->withoutOverlapping()
            ->runInBackground()
            ->appendOutputTo(storage_path('logs/web3-events.log'));

        // 每小时检查一次同步是否正常
        $schedule->call(function () {
            $lastBlock = \Illuminate\Support\Facades\Cache::get('web3:last_synced_block', 0);
            $currentBlock = app(\App\Services\Web3Service::class)->getLatestBlockNumber();
            $gap = $currentBlock - $lastBlock;

            if ($gap > 100) {
                \Illuminate\Support\Facades\Log::warning('合约事件同步落后较多', [
                    'lastSyncedBlock' => $lastBlock,
                    'currentBlock'    => $currentBlock,
                    'gap'             => $gap,
                ]);
            }
        })->hourly();
    }
}
```

### 6.4 使用 Laravel Queue 进行异步事件处理

对于高吞吐量的应用场景，建议将事件处理逻辑放入 Laravel Queue 中异步执行。这样可以将事件同步（数据量大但轻量）和业务逻辑处理（可能涉及数据库写入、通知、第三方调用等重操作）解耦：

```php
<?php
// app/Jobs/ProcessContractEvent.php

namespace App\Jobs;

use App\Models\NFTTransfer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessContractEvent implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    // 最多重试 3 次
    public int $tries = 3;

    // 每次执行超时 60 秒
    public int $timeout = 60;

    public function __construct(
        public array $eventData
    ) {}

    public function handle(): void
    {
        $event = $this->eventData;

        // 1. 保存到数据库
        NFTTransfer::updateOrCreate(
            [
                'tx_hash'   => $event['txHash'],
                'log_index' => $event['logIndex'],
            ],
            [
                'from_address' => $event['from'],
                'to_address'   => $event['to'],
                'token_id'     => $event['tokenId'],
                'block_number' => $event['blockNumber'],
                'chain_id'     => $event['chainId'] ?? 1,
                'processed_at' => now(),
            ]
        );

        // 2. 触发 Webhook 通知（通知第三方应用）
        $this->notifyWebhooks($event);

        // 3. 更新搜索索引
        $this->updateSearchIndex($event);

        // 4. 发送实时通知给相关用户
        $this->notifyUsers($event);

        Log::info('合约事件处理完成', [
            'txHash'  => $event['txHash'],
            'tokenId' => $event['tokenId'],
        ]);
    }

    /**
     * 任务失败时的处理
     */
    public function failed(\Throwable $exception): void
    {
        Log::error('合约事件处理任务失败', [
            'event_data' => $this->eventData,
            'error'      => $exception->getMessage(),
        ]);

        // 可以在这里发送管理员告警通知
    }

    /**
     * 通知配置了 Webhook 的外部应用
     */
    protected function notifyWebhooks(array $event): void
    {
        $webhooks = \App\Models\Webhook::where('event_type', 'transfer')
            ->where('is_active', true)
            ->get();

        foreach ($webhooks as $webhook) {
            SendWebhookNotification::dispatch($webhook->toArray(), $event)
                ->onQueue('webhooks');
        }
    }

    /**
     * 更新 NFT 搜索索引
     */
    protected function updateSearchIndex(array $event): void
    {
        \App\Models\NFT::where('token_id', $event['tokenId'])
            ->update(['current_owner' => $event['to']]);
    }

    /**
     * 向相关用户发送实时通知
     */
    protected function notifyUsers(array $event): void
    {
        // 通知 NFT 的前所有者
        $prevOwner = \App\Models\User::where('wallet_address', $event['from'])->first();
        if ($prevOwner) {
            $prevOwner->notifications()->create([
                'type'    => 'nft_transferred_out',
                'data'    => $event,
                'message' => "您的 NFT #{$event['tokenId']} 已被转让",
            ]);
        }
    }
}
```

---

## 七、代币标准集成模式：ERC-20、ERC-721、ERC-1155

### 7.1 ERC-20 同质化代币

ERC-20 是以太坊上最基础的代币标准，定义了同质化代币（Fungible Token）的通用接口。每个 ERC-20 代币都具有相同的属性和价值，可以互换。常见的 ERC-20 代币包括 USDT、USDC、DAI 等稳定币，以及 UNI、AAVE 等治理代币。

```php
<?php
// app/Services/ERC20Service.php

namespace App\Services;

use Web3\Contract;
use Web3\Utils;

class ERC20Service
{
    protected Contract $contract;
    protected string $tokenAddress;

    // ERC-20 标准 ABI 定义
    protected const ERC20_ABI = [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function totalSupply() view returns (uint256)',
        'function balanceOf(address account) view returns (uint256)',
        'function transfer(address to, uint256 amount) returns (bool)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'event Transfer(address indexed from, address indexed to, uint256 value)',
        'event Approval(address indexed owner, address indexed spender, uint256 value)',
    ];

    public function __construct(string $tokenAddress, string $rpcUrl)
    {
        $this->tokenAddress = $tokenAddress;
        $this->contract = new Contract($rpcUrl, json_encode(self::ERC20_ABI));
    }

    /**
     * 获取代币的完整信息（名称、符号、精度）
     */
    public function getTokenInfo(): array
    {
        $info = ['name' => '', 'symbol' => '', 'decimals' => 18];

        $this->contract->at($this->tokenAddress)
            ->call('name', function ($err, $result) use (&$info) {
                $info['name'] = $err ? 'Unknown Token' : $result[0];
            });

        $this->contract->at($this->tokenAddress)
            ->call('symbol', function ($err, $result) use (&$info) {
                $info['symbol'] = $err ? '???' : $result[0];
            });

        $this->contract->at($this->tokenAddress)
            ->call('decimals', function ($err, $result) use (&$info) {
                $info['decimals'] = $err ? 18 : (int) $result[0]->toString();
            });

        return $info;
    }

    /**
     * 获取代币余额（自动转换精度）
     * 返回人类可读的代币数量（如 "1000.50"）
     */
    public function getFormattedBalance(string $address): string
    {
        $decimals = $this->getDecimals();
        $rawBalance = '0';

        $this->contract->at($this->tokenAddress)
            ->call('balanceOf', $address, function ($err, $result) use (&$rawBalance) {
                if ($err !== null) {
                    throw new \RuntimeException('查询代币余额失败');
                }
                $rawBalance = $result[0]->toString();
            });

        // 将原始余额除以 10^decimals 得到实际数量
        return bcdiv($rawBalance, bcpow('10', (string) $decimals), $decimals);
    }

    /**
     * 获取用户授权额度
     * 在 DeFi 中，用户需要先授权合约使用其代币，才能进行后续操作
     */
    public function getAllowance(string $owner, string $spender): string
    {
        $allowance = '0';

        $this->contract->at($this->tokenAddress)
            ->call('allowance', $owner, $spender, function ($err, $result) use (&$allowance) {
                if ($err !== null) {
                    throw new \RuntimeException('查询授权额度失败');
                }
                $allowance = $result[0]->toString();
            });

        return $allowance;
    }

    /**
     * 获取代币精度
     */
    protected function getDecimals(): int
    {
        $decimals = 18;
        $this->contract->at($this->tokenAddress)
            ->call('decimals', function ($err, $result) use (&$decimals) {
                if (!$err) {
                    $decimals = (int) $result[0]->toString();
                }
            });
        return $decimals;
    }
}
```

### 7.2 ERC-721 非同质化代币（NFT）

ERC-721 是非同质化代币标准，每个代币都有唯一的 ID，具有独特的属性和价值。它被广泛应用于数字收藏品、游戏道具、域名、身份证明等领域。

除了前面已经展示的合约调用代码外，ERC-721 集成中最重要的是元数据管理。NFT 的元数据（名称、描述、图片、属性等）通常以 JSON 格式存储在 IPFS 或 HTTP 服务器上，合约中只存储元数据的 URI。

```php
<?php
// app/Services/NFTMetadataService.php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class NFTMetadataService
{
    // IPFS 公共网关列表（按优先级排序）
    protected array $ipfsGateways = [
        'https://ipfs.io/ipfs/',
        'https://gateway.pinata.cloud/ipfs/',
        'https://cloudflare-ipfs.com/ipfs/',
    ];

    /**
     * 获取 NFT 的完整元数据（带缓存和多网关容错）
     * 元数据格式遵循 OpenSea Metadata Standard
     */
    public function getMetadata(int $tokenId, string $tokenURI): array
    {
        $cacheKey = "nft:metadata:{$tokenId}";

        // 缓存 1 小时，IPFS 内容不会改变
        return Cache::remember($cacheKey, now()->addHours(1), function () use ($tokenURI, $tokenId) {
            // 处理 data:application/json;base64,... 格式的内联元数据
            if (str_starts_with($tokenURI, 'data:application/json;base64,')) {
                $base64Data = substr($tokenURI, 29);
                $json = base64_decode($base64Data);
                return json_decode($json, true) ?? $this->getDefaultMetadata($tokenId);
            }

            // 解析 IPFS URI
            $url = $this->resolveIPFSUrl($tokenURI);

            // 尝试多个网关获取数据
            foreach ((array) $url as $gatewayUrl) {
                try {
                    $response = Http::timeout(10)
                        ->withHeaders(['Accept' => 'application/json'])
                        ->get($gatewayUrl);

                    if ($response->successful()) {
                        $metadata = $response->json();
                        // 处理元数据中的图片 URL（也可能是 IPFS 链接）
                        if (isset($metadata['image'])) {
                            $metadata['image_url'] = $this->resolveIPFSUrl($metadata['image']);
                        }
                        return $metadata;
                    }
                } catch (\Exception $e) {
                    Log::warning('获取 NFT 元数据失败', [
                        'tokenId' => $tokenId,
                        'url'     => $gatewayUrl,
                        'error'   => $e->getMessage(),
                    ]);
                    continue;
                }
            }

            // 所有网关都失败时返回默认元数据
            return $this->getDefaultMetadata($tokenId);
        });
    }

    /**
     * 解析 IPFS URI，返回 HTTP 网关地址
     * 支持多种 IPFS URI 格式：
     * - ipfs://QmXxx... -> https://ipfs.io/ipfs/QmXxx...
     * - ipfs://bafyXxx... -> https://ipfs.io/ipfs/bafyXxx...
     * - /ipfs/QmXxx... -> https://ipfs.io/ipfs/QmXxx...
     */
    protected function resolveIPFSUrl(string $uri): string|array
    {
        // 处理 ipfs:// 协议
        if (str_starts_with($uri, 'ipfs://')) {
            $cid = substr($uri, 7);
            // 返回多个网关地址作为容错
            return array_map(fn($gateway) => $gateway . $cid, $this->ipfsGateways);
        }

        // 处理 /ipfs/ 路径格式
        if (str_starts_with($uri, '/ipfs/')) {
            $cid = substr($uri, 6);
            return array_map(fn($gateway) => $gateway . $cid, $this->ipfsGateways);
        }

        // 已经是 HTTP URL 或其他格式，直接返回
        return $uri;
    }

    /**
     * 返回默认的元数据（当无法获取真实数据时）
     */
    protected function getDefaultMetadata(int $tokenId): array
    {
        return [
            'name'        => "Token #{$tokenId}",
            'description' => '元数据暂时不可用',
            'image'       => '',
            'attributes'  => [],
        ];
    }
}
```

### 7.3 ERC-1155 多代币标准

ERC-1155 是一种混合代币标准，可以在同一个合约中同时管理同质化代币和非同质化代币。它特别适合游戏场景——一个合约可以同时管理金币（同质化）、装备（非同质化）、材料（半同质化）等多种类型的游戏资产。

```php
<?php
// app/Services/ERC1155Service.php

namespace App\Services;

use Web3\Contract;

class ERC1155Service
{
    protected Contract $contract;
    protected string $tokenAddress;

    protected const ERC1155_ABI = [
        // 查询单种代币余额
        'function balanceOf(address account, uint256 id) view returns (uint256)',
        // 批量查询多种代币余额（ERC-1155 的核心优势）
        'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
        // 获取代币元数据 URI
        'function uri(uint256 id) view returns (string)',
        // 安全转账（单个代币类型）
        'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
        // 安全批量转账（多个代币类型，一次交易完成）
        'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
        // 事件
        'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
        'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
    ];

    public function __construct(string $tokenAddress, string $rpcUrl)
    {
        $this->tokenAddress = $tokenAddress;
        $this->contract = new Contract($rpcUrl, json_encode(self::ERC1155_ABI));
    }

    /**
     * 批量查询多种代币的余额
     * 这是 ERC-1155 相比 ERC-721 的核心优势之一
     * 一次合约调用即可查询用户持有的所有代币类型及其数量
     *
     * @param string $owner    持有者地址
     * @param array  $tokenIds 要查询的代币 ID 列表
     * @return array 代币 ID => 余额 的映射
     */
    public function getBatchBalance(string $owner, array $tokenIds): array
    {
        // 构建参数：每个代币 ID 对应相同的持有者地址
        $addresses = array_fill(0, count($tokenIds), $owner);
        $balances = [];

        $this->contract->at($this->tokenAddress)
            ->call('balanceOfBatch', $addresses, $tokenIds, function ($err, $result) use (&$balances) {
                if ($err !== null) {
                    throw new \RuntimeException('批量查询代币余额失败: ' . $err->getMessage());
                }
                foreach ($result[0] as $index => $balance) {
                    $balances[] = (int) $balance->toString();
                }
            });

        return array_combine($tokenIds, $balances);
    }

    /**
     * 获取代币元数据 URI
     * ERC-1155 的 URI 中通常包含 {id} 占位符
     * 需要将 {id} 替换为实际的代币 ID（十六进制格式）
     */
    public function getURI(int $tokenId): string
    {
        $uri = '';

        $this->contract->at($this->tokenAddress)
            ->call('uri', $tokenId, function ($err, $result) use (&$uri) {
                if ($err !== null) {
                    throw new \RuntimeException('获取代币 URI 失败');
                }
                $uri = $result[0];
            });

        // 替换 URI 中的 {id} 占位符为代币 ID 的十六进制表示
        return str_replace('{id}', dechex($tokenId), $uri);
    }

    /**
     * 查询用户持有的所有代币类型
     * 注意：这需要解析事件日志来构建完整的持有列表
     * 因为 ERC-1155 标准没有提供枚举函数
     */
    public function getHeldTokenTypes(string $owner, int $fromBlock = 0): array
    {
        // 通过解析 TransferSingle 和 TransferBatch 事件来构建
        // 用户的代币持有列表
        $heldTokens = [];

        // 实际实现需要查询合约事件并汇总余额
        // 这里简化为框架代码

        return $heldTokens;
    }
}
```

---

## 八、安全考量：重放攻击防护与 Nonce 管理

### 8.1 重放攻击详解

重放攻击（Replay Attack）是 Web3 应用中最常见也最危险的安全威胁之一。其基本原理是：攻击者截获一个用户的有效签名消息后，在用户不知情的情况下重新提交该签名，从而冒充合法用户执行操作。

例如，用户 A 签名了一条"购买 NFT #123"的消息。如果后端没有做好防护，攻击者可以截获这个签名并再次提交，可能导致用户 A 重复购买同一个 NFT。更严重的是，如果用户在多个 DApp 中使用同一个钱包，攻击者甚至可能将一个 DApp 中的签名拿到另一个 DApp 中使用。

### 8.2 多层防护方案实现

```php
<?php
// app/Services/ReplayProtectionService.php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ReplayProtectionService
{
    /**
     * 第一层防护：基于 Nonce 的一次性令牌
     *
     * 每次签名请求都生成一个随机的 nonce，签名消息中必须包含该 nonce。
     * 后端验证签名成功后立即消费该 nonce，使其无法被再次使用。
     */
    public function generateNonce(string $address): string
    {
        $nonce = bin2hex(random_bytes(16)); // 32 个十六进制字符
        $normalizedAddress = strtolower($address);

        // 存入缓存（快速验证）
        Cache::put(
            "web3:nonce:{$normalizedAddress}",
            $nonce,
            now()->addMinutes(5)
        );

        // 同时记录到数据库（审计追踪）
        DB::table('web3_nonces')->insert([
            'address'    => $normalizedAddress,
            'nonce'      => $nonce,
            'created_at' => now(),
            'expires_at' => now()->addMinutes(5),
            'used'       => false,
        ]);

        return $nonce;
    }

    /**
     * 验证并消费 nonce
     * 验证成功后 nonce 立即失效，无法再次使用
     */
    public function consumeNonce(string $address, string $nonce): bool
    {
        $normalizedAddress = strtolower($address);
        $storedNonce = Cache::get("web3:nonce:{$normalizedAddress}");

        // nonce 不存在或不匹配
        if ($storedNonce === null || $storedNonce !== $nonce) {
            Log::warning('Nonce 验证失败', [
                'address'       => $normalizedAddress,
                'providedNonce' => $nonce,
                'storedNonce'   => $storedNonce,
                'reason'        => $storedNonce === null ? 'expired_or_missing' : 'mismatch',
            ]);
            return false;
        }

        // 消费 nonce（从缓存中删除）
        Cache::forget("web3:nonce:{$normalizedAddress}");

        // 标记数据库记录为已使用
        DB::table('web3_nonces')
            ->where('address', $normalizedAddress)
            ->where('nonce', $nonce)
            ->update([
                'used'     => true,
                'used_at'  => now(),
            ]);

        return true;
    }

    /**
     * 第二层防护：消息过期时间检查
     *
     * 在签名消息中嵌入过期时间，确保签名只在有限的时间窗口内有效。
     * 即使签名被截获，超过有效期后也无法使用。
     */
    public function isMessageExpired(string $message): bool
    {
        if (preg_match('/Expiration Time:\s*(.+)/', $message, $matches)) {
            $expirationTime = strtotime(trim($matches[1]));
            if ($expirationTime === false) {
                return true; // 无法解析时间，视为过期
            }
            return $expirationTime < time();
        }

        // 没有过期时间字段的消息视为不安全
        return true;
    }

    /**
     * 第三层防护：基于序列号的单调递增验证
     *
     * 为每个维护一个序列号，每次成功签名后序列号递增。
     * 后续签名的序列号必须大于已记录的序列号，防止历史签名被重用。
     * 适用于同一地址需要频繁签名的场景。
     */
    public function validateSequenceNumber(string $address, int $seqNumber): bool
    {
        $normalizedAddress = strtolower($address);
        $lastSeq = Cache::get("web3:seq:{$normalizedAddress}", 0);

        if ($seqNumber <= $lastSeq) {
            Log::warning('序列号验证失败', [
                'address'    => $normalizedAddress,
                'provided'   => $seqNumber,
                'lastUsed'   => $lastSeq,
            ]);
            return false;
        }

        // 更新序列号
        Cache::put("web3:seq:{$normalizedAddress}", $seqNumber, now()->addDays(30));

        return true;
    }

    /**
     * 第四层防护：Chain ID 绑定
     *
     * 在签名消息中包含 Chain ID，防止签名在不同网络之间被重用。
     * 例如，以太坊主网上的签名不应该在测试网上被接受。
     */
    public function validateChainId(string $message, int $expectedChainId): bool
    {
        if (preg_match('/Chain ID:\s*(\d+)/', $message, $matches)) {
            $messageChainId = (int) $matches[1];
            return $messageChainId === $expectedChainId;
        }

        return false; // 没有 Chain ID 的消息不安全
    }

    /**
     * 综合验证：执行所有防护层的检查
     */
    public function comprehensiveValidation(
        string $address,
        string $message,
        string $signature,
        int $expectedChainId
    ): array {
        $errors = [];

        // 检查过期时间
        if ($this->isMessageExpired($message)) {
            $errors[] = '签名消息已过期';
        }

        // 检查 Chain ID
        if (!$this->validateChainId($message, $expectedChainId)) {
            $errors[] = 'Chain ID 不匹配';
        }

        // 从消息中提取并验证 nonce
        if (preg_match('/Nonce:\s*(\S+)/', $message, $matches)) {
            $nonce = $matches[1];
            if (!$this->consumeNonce($address, $nonce)) {
                $errors[] = 'Nonce 验证失败（已过期、不匹配或已使用）';
            }
        } else {
            $errors[] = '消息中缺少 Nonce';
        }

        return [
            'valid'  => empty($errors),
            'errors' => $errors,
        ];
    }
}
```

### 8.3 安全中间件

```php
<?php
// app/Http/Middleware/Web3SecurityMiddleware.php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class Web3SecurityMiddleware
{
    /**
     * 对所有包含以太坊地址参数的请求进行安全验证
     * 确保地址格式正确，防止注入攻击
     */
    public function handle(Request $request, Closure $next): Response
    {
        // 验证所有包含 "address" 关键字的参数
        foreach ($request->all() as $key => $value) {
            if (is_string($value) && (str_contains($key, 'address') || str_contains($key, 'Address'))) {
                if (!$this->isValidEthereumAddress($value)) {
                    return response()->json([
                        'error' => "参数 {$key} 不是有效的以太坊地址",
                        'code'  => 'INVALID_ADDRESS',
                    ], 422);
                }
            }
        }

        // 验证交易哈希格式
        $txHash = $request->input('tx_hash') ?? $request->input('txHash');
        if ($txHash !== null) {
            if (!preg_match('/^0x[a-fA-F0-9]{64}$/', $txHash)) {
                return response()->json([
                    'error' => '无效的交易哈希格式',
                    'code'  => 'INVALID_TX_HASH',
                ], 422);
            }
        }

        // 验证签名格式
        $signature = $request->input('signature');
        if ($signature !== null) {
            if (!preg_match('/^0x[a-fA-F0-9]{130}$/', $signature)) {
                return response()->json([
                    'error' => '无效的签名格式',
                    'code'  => 'INVALID_SIGNATURE_FORMAT',
                ], 422);
            }
        }

        return $next($request);
    }

    /**
     * 验证以太坊地址格式
     * 基本格式：0x 开头 + 40 个十六进制字符
     * 可选：EIP-55 混合大小写校验
     */
    private function isValidEthereumAddress(string $address): bool
    {
        return preg_match('/^0x[a-fA-F0-9]{40}$/', $address) === 1;
    }
}
```

---

## 九、生产部署：Infura/Alchemy RPC 与 Gas 优化

### 9.1 选择合适的 RPC 节点服务

在生产环境中，使用可靠的 RPC 节点服务至关重要。目前最主流的两个服务商是 **Infura**（由 ConsenSys 运营）和 **Alchemy**（独立公司）。它们都提供高可用的节点集群、丰富的 API 端点和详细的数据分析。

选择 RPC 服务时需要考虑以下几个因素：请求速率限制（Rate Limit）、支持的链和网络、数据归档能力（Archive Node）、WebSocket 支持、价格方案、API 附加功能（如增强型 API、Webhook 通知等）。

```php
<?php
// app/Services/ResilientWeb3Service.php

namespace App\Services;

use Web3\Web3;
use Web3\Providers\HttpProvider;
use Web3\RequestManagers\HttpRequestManager;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class ResilientWeb3Service
{
    protected array $providers = [];
    protected int $currentProviderIndex = 0;

    public function __construct()
    {
        // 初始化主节点
        $primaryUrl = config('web3.rpc_url');
        if ($primaryUrl) {
            $this->providers[] = [
                'name'     => 'primary',
                'provider' => $this->createProvider($primaryUrl),
            ];
        }

        // 初始化备用节点
        $fallbackUrl = config('web3.rpc_fallback_url');
        if ($fallbackUrl) {
            $this->providers[] = [
                'name'     => 'fallback',
                'provider' => $this->createProvider($fallbackUrl),
            ];
        }
    }

    /**
     * 执行带自动故障转移的 RPC 调用
     * 当主节点不可用时自动切换到备用节点
     */
    public function call(string $method, array $params = []): mixed
    {
        $lastError = null;

        foreach ($this->providers as $index => $config) {
            try {
                $web3 = new Web3($config['provider']);
                $result = null;

                // 动态调用 eth_* 方法
                $web3->eth->{$method}(...array_merge($params, [
                    function ($err, $res) use (&$result, &$lastError, $config, $method) {
                        if ($err !== null) {
                            Log::warning("RPC 节点 [{$config['name']}] 调用 {$method} 失败", [
                                'error' => $err->getMessage(),
                            ]);
                            $lastError = $err;
                            throw $err;
                        }
                        $result = $res;
                    }
                ]));

                if ($result !== null) {
                    return $result;
                }
            } catch (\Exception $e) {
                $lastError = $e;
                Log::warning("切换到下一个 RPC 节点", [
                    'failed_node' => $config['name'],
                    'error'       => $e->getMessage(),
                ]);
                continue;
            }
        }

        throw new \RuntimeException(
            '所有 RPC 节点均不可用: ' . ($lastError?->getMessage() ?? '未知错误')
        );
    }

    protected function createProvider(string $url): HttpProvider
    {
        return new HttpProvider(new HttpRequestManager($url, 15));
    }
}
```

### 9.2 Gas 费用优化策略

Gas 费用是以太坊交易的主要成本。在 EIP-1559 机制下，Gas 费用由基础费用（Base Fee）和优先费用（Priority Fee）组成。优化 Gas 费用的策略包括：选择合适的交易时机（网络拥堵程度低时 Gas 费用较低）、使用 EIP-1559 格式的交易参数、优化合约代码减少计算量、批量处理交易等。

```php
<?php
// app/Services/GasOptimizationService.php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GasOptimizationService
{
    /**
     * 获取当前最优的 Gas 价格建议
     * 综合多个数据源得出推荐值
     */
    public function getOptimalGasPrice(): array
    {
        return Cache::remember('web3:gas_price_optimal', now()->addSeconds(15), function () {
            // 从以太坊节点获取当前 Gas 价格
            $nodeGasPrice = $this->getNodeGasPrice();

            // 从 Etherscan Gas Tracker API 获取参考数据
            $gasOracle = $this->fetchEtherscanGasOracle();

            // 综合计算推荐值
            return [
                'from_node'    => $nodeGasPrice,
                'from_oracle'  => $gasOracle,
                'recommended'  => $this->calculateRecommended($nodeGasPrice, $gasOracle),
            ];
        });
    }

    /**
     * 根据交易紧急程度获取 Gas 设置
     * 低优先级适合不着急的交易，可以节省 20-30% 的费用
     * 高优先级适合需要快速确认的交易，费用会高出 50%
     */
    public function getGasForUrgency(string $urgency = 'normal'): array
    {
        $prices = $this->getOptimalGasPrice();
        $base = $prices['recommended']['maxFeePerGas'];
        $priority = $prices['recommended']['maxPriorityFeePerGas'];

        return match ($urgency) {
            'low' => [
                'maxFeePerGas'         => bcmul($base, '0.8'),
                'maxPriorityFeePerGas' => bcmul($priority, '0.7'),
                'estimatedConfirmation' => '5-10 分钟',
                'description'           => '低优先级，适合不着急的交易',
            ],
            'normal' => [
                'maxFeePerGas'         => $base,
                'maxPriorityFeePerGas' => $priority,
                'estimatedConfirmation' => '1-3 分钟',
                'description'           => '标准优先级',
            ],
            'high' => [
                'maxFeePerGas'         => bcmul($base, '1.5'),
                'maxPriorityFeePerGas' => bcmul($priority, '1.5'),
                'estimatedConfirmation' => '< 30 秒',
                'description'           => '高优先级，适合时间敏感的交易',
            ],
            default => throw new \InvalidArgumentException("未知的紧急程度: {$urgency}"),
        };
    }

    /**
     * 预估合约调用的 Gas 消耗
     * 使用 eth_estimateGas 提前了解交易需要多少 Gas
     */
    public function estimateContractCallGas(
        string $contractAddress,
        string $encodedData
    ): int {
        $estimatedGas = 0;

        app(\Web3\Web3::class)->eth->estimateGas(
            ['to' => $contractAddress, 'data' => $encodedData],
            function ($err, $result) use (&$estimatedGas) {
                if ($err !== null) {
                    Log::warning('Gas 预估失败', ['error' => $err->getMessage()]);
                    $estimatedGas = 300000; // 使用默认上限
                    return;
                }
                $estimatedGas = (int) $result->toString();
            }
        );

        // 添加 20% 的安全缓冲，防止因链上状态变化导致 Gas 不足
        return (int) ($estimatedGas * 1.2);
    }

    /**
     * 从以太坊节点获取当前 Gas 价格
     */
    private function getNodeGasPrice(): string
    {
        $gasPrice = '0';
        app(\Web3\Web3::class)->eth->gasPrice(function ($err, $result) use (&$gasPrice) {
            if (!$err) {
                $gasPrice = \Web3\Utils::fromWei($result->toString(), 'gwei');
            }
        });
        return $gasPrice;
    }

    /**
     * 从 Etherscan API 获取 Gas 价格预言机数据
     */
    private function fetchEtherscanGasOracle(): array
    {
        try {
            $apiKey = env('ETHERSCAN_API_KEY', '');
            $response = Http::timeout(5)->get('https://api.etherscan.io/api', [
                'module' => 'gastracker',
                'action' => 'gasoracle',
                'apikey' => $apiKey,
            ]);

            if ($response->successful() && $response->json('status') === '1') {
                $data = $response->json('result');
                return [
                    'safe'     => $data['SafeGasPrice']     ?? '10',  // 低优先级
                    'propose'  => $data['ProposeGasPrice']  ?? '20',  // 标准
                    'fast'     => $data['FastGasPrice']      ?? '30',  // 高优先级
                    'baseFee'  => $data['suggestBaseFee']    ?? '15',  // 基础费用
                ];
            }
        } catch (\Exception $e) {
            Log::warning('Etherscan Gas Oracle 请求失败', ['error' => $e->getMessage()]);
        }

        return ['safe' => '10', 'propose' => '20', 'fast' => '30', 'baseFee' => '15'];
    }

    /**
     * 综合多个数据源计算推荐的 Gas 参数
     */
    private function calculateRecommended(string $nodeGasPrice, array $oracle): array
    {
        return [
            'maxFeePerGas'         => $oracle['baseFee'] ?? $nodeGasPrice,
            'maxPriorityFeePerGas' => $oracle['propose'] ?? '2',
        ];
    }
}
```

---

## 十、实战案例：构建完整的 NFT 市场后端

现在让我们将前面学到的所有知识整合起来，构建一个功能完整的 NFT 市场后端系统。这个系统支持用户签名登录、NFT 上架、购买、取消、事件同步等核心功能。

### 10.1 数据库迁移文件

```php
<?php
// database/migrations/2026_06_03_000001_create_web3_tables.php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 用户表：扩展 Laravel 默认 users 表，增加钱包地址字段
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('wallet_address', 42)->unique()->index();
            $table->string('username')->nullable();
            $table->string('email')->nullable();
            $table->string('avatar_url')->nullable();
            $table->timestamp('last_login_at')->nullable();
            $table->string('login_nonce')->nullable();
            $table->timestamps();
        });

        // NFT 资产表：存储链上 NFT 的元数据缓存
        Schema::create('nfts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('token_id')->index();
            $table->string('contract_address', 42)->index();
            $table->unsignedBigInteger('chain_id')->default(1);
            $table->string('current_owner', 42)->index();
            $table->string('token_uri')->nullable();
            $table->json('metadata')->nullable();
            $table->string('name')->nullable();
            $table->string('image_url')->nullable();
            $table->json('attributes')->nullable();
            $table->timestamps();

            $table->unique(['token_id', 'contract_address', 'chain_id']);
        });

        // 市场上架表：记录 NFT 的上架、成交、取消等状态
        Schema::create('marketplace_listings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('nft_id')->constrained();
            $table->foreignId('seller_id')->constrained('users');
            $table->string('buyer_address', 42)->nullable();
            $table->string('price', 100); // 使用字符串存储 Wei 值，避免精度丢失
            $table->string('currency', 42)->default('0x0000000000000000000000000000000000000000');
            $table->enum('status', [
                'pending_deposit', // 等待卖家将 NFT 转入市场合约
                'active',          // 上架中，可购买
                'sold',            // 已售出
                'cancelled',       // 已取消
                'expired',         // 已过期
            ])->default('pending_deposit')->index();
            $table->string('deposit_tx_hash', 66)->nullable();
            $table->string('sold_tx_hash', 66)->nullable();
            $table->timestamp('listed_at')->nullable();
            $table->timestamp('sold_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index(['seller_id', 'status']);
        });

        // 交易记录表：存储所有链上 Transfer 事件
        Schema::create('nft_transfers', function (Blueprint $table) {
            $table->id();
            $table->string('from_address', 42)->index();
            $table->string('to_address', 42)->index();
            $table->unsignedBigInteger('token_id')->index();
            $table->string('tx_hash', 66)->index();
            $table->unsignedBigInteger('block_number')->index();
            $table->unsignedInteger('log_index');
            $table->unsignedBigInteger('chain_id')->default(1);
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();

            $table->unique(['tx_hash', 'log_index']);
        });

        // Nonce 管理表：用于签名验证的审计追踪
        Schema::create('web3_nonces', function (Blueprint $table) {
            $table->id();
            $table->string('address', 42)->index();
            $table->string('nonce', 64);
            $table->boolean('used')->default(false);
            $table->timestamp('used_at')->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->index(['address', 'nonce']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('web3_nonces');
        Schema::dropIfExists('nft_transfers');
        Schema::dropIfExists('marketplace_listings');
        Schema::dropIfExists('nfts');
        Schema::dropIfExists('users');
    }
};
```

### 10.2 市场控制器实现

```php
<?php
// app/Http/Controllers/MarketplaceController.php

namespace App\Http\Controllers;

use App\Services\Web3Service;
use App\Services\SignatureVerificationService;
use App\Services\GasOptimizationService;
use App\Models\MarketplaceListing;
use App\Models\NFT;
use App\Jobs\ProcessContractEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class MarketplaceController extends Controller
{
    public function __construct(
        protected Web3Service $web3Service,
        protected SignatureVerificationService $signatureService,
        protected GasOptimizationService $gasService,
    ) {}

    /**
     * 获取市场上架列表
     * 支持按价格范围、卖家地址、排序方式等条件筛选
     */
    public function getListings(Request $request): JsonResponse
    {
        $query = MarketplaceListing::with(['nft', 'seller'])
            ->where('status', 'active');

        // 价格范围筛选
        if ($request->filled('min_price')) {
            $query->where('price', '>=', $request->input('min_price'));
        }
        if ($request->filled('max_price')) {
            $query->where('price', '<=', $request->input('max_price'));
        }

        // 按卖家筛选
        if ($request->filled('seller')) {
            $query->whereHas('seller', function ($q) use ($request) {
                $q->where('wallet_address', strtolower($request->input('seller')));
            });
        }

        // 排序
        $sortBy = $request->input('sort', 'created_at');
        $sortDir = $request->input('dir', 'desc');
        $allowedSorts = ['created_at', 'price'];

        if (in_array($sortBy, $allowedSorts)) {
            $query->orderBy($sortBy, $sortDir === 'asc' ? 'asc' : 'desc');
        }

        $listings = $query->paginate($request->input('per_page', 20));

        return response()->json([
            'data'        => $listings->items(),
            'total'       => $listings->total(),
            'page'        => $listings->currentPage(),
            'per_page'    => $listings->perPage(),
            'total_pages' => $listings->lastPage(),
        ]);
    }

    /**
     * 创建上架请求
     * 卖家签名确认上架意图后，后端创建上架记录
     * 实际的 NFT 托管在链上市场合约中完成
     */
    public function createListing(Request $request): JsonResponse
    {
        $request->validate([
            'token_id'  => 'required|integer|min:1',
            'price'     => 'required|string|regex:/^\d+$/',
            'signature' => 'required|string',
            'message'   => 'required|string|max:2000',
            'currency'  => 'nullable|string|regex:/^0x[a-fA-F0-9]{40}$/',
        ]);

        $user = $request->user();
        $address = strtolower($user->wallet_address);

        // 验证签名
        if (!$this->signatureService->verifySignature(
            $request->input('message'),
            $request->input('signature'),
            $address
        )) {
            return response()->json([
                'error' => '签名验证失败，请确保使用正确的钱包签名',
                'code'  => 'SIGNATURE_INVALID',
            ], 401);
        }

        // 验证 NFT 所有权（链上查询）
        try {
            $owner = $this->web3Service->getNFTOwner($request->input('token_id'));
            if (strtolower($owner) !== $address) {
                return response()->json([
                    'error' => '您不是该 NFT 的当前所有者',
                    'code'  => 'NOT_OWNER',
                ], 403);
            }
        } catch (\Exception $e) {
            Log::error('验证 NFT 所有权失败', ['error' => $e->getMessage()]);
            return response()->json([
                'error' => '无法验证 NFT 所有权，请稍后重试',
                'code'  => 'VERIFICATION_FAILED',
            ], 503);
        }

        // 在数据库事务中创建上架记录
        $listing = DB::transaction(function () use ($request, $user, $address) {
            $nft = NFT::firstOrCreate(
                [
                    'token_id'         => $request->input('token_id'),
                    'contract_address' => config('web3.contracts.nft.address'),
                ],
                [
                    'current_owner' => $address,
                    'chain_id'      => config('web3.chain_id'),
                ]
            );

            return MarketplaceListing::create([
                'nft_id'     => $nft->id,
                'seller_id'  => $user->id,
                'price'      => $request->input('price'),
                'currency'   => $request->input('currency', '0x0000000000000000000000000000000000000000'),
                'status'     => 'pending_deposit',
                'expires_at' => now()->addDays(30),
            ]);
        });

        return response()->json([
            'listing'           => $listing,
            'message'           => '上架请求已创建。请将 NFT 转入市场合约以完成上架。',
            'deposit_address'   => config('web3.contracts.marketplace.address'),
            'gas_estimate'      => $this->gasService->getGasForUrgency('normal'),
        ], 201);
    }

    /**
     * 购买 NFT
     * 买家签名确认购买意图，并提交链上交易哈希
     * 后端异步验证交易的有效性
     */
    public function buyNFT(Request $request): JsonResponse
    {
        $request->validate([
            'listing_id' => 'required|integer|exists:marketplace_listings,id',
            'tx_hash'    => 'required|string|regex:/^0x[a-fA-F0-9]{64}$/',
            'signature'  => 'required|string',
            'message'    => 'required|string|max:2000',
        ]);

        $buyer = $request->user();
        $buyerAddress = strtolower($buyer->wallet_address);

        // 验证签名
        if (!$this->signatureService->verifySignature(
            $request->input('message'),
            $request->input('signature'),
            $buyerAddress
        )) {
            return response()->json(['error' => '签名验证失败'], 401);
        }

        // 获取上架记录
        $listing = MarketplaceListing::with(['nft', 'seller'])
            ->where('id', $request->input('listing_id'))
            ->where('status', 'active')
            ->firstOrFail();

        // 派发异步任务验证链上交易
        ProcessContractEvent::dispatch([
            'type'           => 'purchase_verification',
            'listing_id'     => $listing->id,
            'tx_hash'        => $request->input('tx_hash'),
            'buyer_address'  => $buyerAddress,
            'expected_price' => $listing->price,
        ])->onQueue('blockchain');

        // 乐观更新状态（链上验证结果确认后再最终更新）
        $listing->update([
            'buyer_address' => $buyerAddress,
            'sold_tx_hash'  => $request->input('tx_hash'),
        ]);

        return response()->json([
            'message' => '购买请求已提交，正在验证链上交易...',
            'tx_hash' => $request->input('tx_hash'),
            'status'  => 'pending_verification',
        ]);
    }
}
```

---

## 十一、总结与最佳实践

### 核心架构总览

通过本文的完整讲解，我们构建了一个从前端到后端、从链上到链下的完整 Web3 集成架构：

- **前端层（ethers.js）**：负责钱包连接、消息签名、只读合约调用、事件监听
- **后端层（Laravel + web3.php）**：负责签名验证、业务逻辑、数据持久化、事件同步
- **链上层（智能合约）**：负责资产托管、所有权管理、交易执行

这三层之间的通信协议是明确的：前端通过 HTTP API 与后端通信（携带签名认证），后端通过 JSON-RPC 与以太坊节点通信，前端也可以直接通过 MetaMask 与链上合约交互。

### 最佳实践清单

**前端最佳实践：**
1. 始终使用 ethers.js v6+ 版本，享受更好的 TypeScript 支持和安全特性
2. 监听 `accountsChanged` 和 `chainChanged` 事件，确保前端状态与钱包同步
3. 使用 EIP-4361 (SIWE) 标准消息格式，提高安全性和可读性
4. 永远不要在前端代码中存储私钥，所有签名操作通过 MetaMask 完成
5. 在发送交易前预估 Gas，让用户了解交易成本

**后端最佳实践：**
1. 使用 nonce + 过期时间双重防护重放攻击
2. 将 RPC 节点配置为多节点故障转移模式，提高可用性
3. 使用 Laravel Queue 异步处理重操作，避免阻塞 API 响应
4. 对所有链上数据（元数据、余额等）实施缓存策略，减少 RPC 调用
5. 建立完善的日志和监控体系，及时发现和排查问题

**安全最佳实践：**
1. 服务器管理私钥使用环境变量或 AWS KMS 等密钥管理服务存储
2. 对所有 API 端点实施速率限制，防止被恶意刷请求
3. 在签名消息中绑定 Chain ID，防止跨链重放攻击
4. 合约代码使用 ReentrancyGuard 防护重入攻击
5. 使用经过审计的 OpenZeppelin 标准合约库，避免自行实现安全敏感逻辑
6. 定期对合约和后端代码进行安全审计

**性能最佳实践：**
1. 事件同步采用增量 + 分批模式，避免一次性查询大量区块
2. 对地址、交易哈希等高频查询字段建立数据库索引
3. NFT 元数据使用 Redis 缓存，IPFS 内容使用 CDN 加速
4. Gas 操作参考多个预言机数据，在最佳时机提交交易

### 进阶方向展望

掌握了本文介绍的技术栈后，你可以进一步探索更多高级主题：Layer 2 扩展方案（Optimism、Arbitrum、Base、zkSync 等）的集成可以大幅降低交易费用；跨链桥接技术可以实现多链资产的无缝管理；DeFi 协议集成（DEX、借贷、流动性挖矿）可以为应用增加金融功能；DAO 治理机制可以让社区参与应用的决策；ERC-4337 账户抽象可以实现无 Gas 交易和智能钱包，大幅降低新用户的使用门槛。

Web3 技术栈正在快速成熟，但其核心原理——密码学签名验证、智能合约交互、事件驱动架构——是长期稳定的技术基础。希望本文能为你在 Laravel + Web3 的技术道路上提供扎实的知识基础和实战参考。

## 相关阅读

- [AI Agent 多租户实战：SaaS 场景下的 Agent 隔离、用量计量与按租户路由](/post/ai-agent-saas-laravel-llm/)
- [Coze 实战：字节跳动 AI Bot 平台与插件生态集成](/post/coze-ai-bot/)
- [API Composition Pattern 实战：跨服务查询聚合——Laravel BFF](/post/api-composition-pattern-laravel-bff-scatter-gather/)
