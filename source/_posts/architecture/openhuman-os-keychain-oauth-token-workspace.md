---

title: OpenHuman 安全模型深度剖析：OS keychain 密钥管理、OAuth token 代理、workspace 沙箱
keywords: [OpenHuman, OS keychain, OAuth token, workspace, 安全模型深度剖析, 密钥管理, 代理, 沙箱]
date: 2026-06-02 12:00:00
description: 深度剖析 OpenHuman AI Agent 三层安全架构：OS Keychain 密钥管理、OAuth Token 代理、Workspace 沙箱隔离。涵盖 macOS/Linux/Windows 跨平台 Keychain 实现、密钥生命周期管理、OAuth 授权码流程、Prompt Injection 防护策略与企业级安全合规实践指南。
tags:
- OpenHuman
- AI安全
- Keychain
- OAuth
- 沙箱
- 密钥管理
- Token
categories:
- architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
---



## 前言：AI Agent 的安全挑战

随着 AI Agent 从简单的问答工具演变为能够操作系统、访问网络、管理文件的自主执行体，安全问题变得前所未有的重要。一个拥有文件读写、网络访问、API 调用能力的 Agent，如果安全模型设计不当，可能导致：

- **密钥泄露**：API token、OAuth 凭证被 LLM 上下文泄露给第三方
- **权限越界**：Agent 访问了不该访问的文件或服务
- **数据外泄**：敏感数据被上传到云端 LLM 服务
- **供应链攻击**：恶意插件通过 Agent 执行任意代码

OpenHuman 从设计之初就将安全作为核心架构原则，构建了三层安全防御体系：**OS Keychain 密钥管理**、**OAuth Token 代理**和 **Workspace 沙箱**。本文将深入剖析每一层的实现细节、设计决策和安全考量。

---

## 一、三层安全架构总览

OpenHuman 的安全模型采用纵深防御（Defense in Depth）策略：

```
┌─────────────────────────────────────────┐
│           Workspace 沙箱（最外层）        │
│  ┌─────────────────────────────────┐    │
│  │      OAuth Token 代理（中间层）   │    │
│  │  ┌─────────────────────────┐    │    │
│  │  │  OS Keychain（最内层）   │    │    │
│  │  │  密钥存储 & 访问控制     │    │    │
│  │  └─────────────────────────┘    │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

每一层都有独立的安全边界和访问控制策略，即使某一层被突破，其他层仍然提供保护。

安全原则：
1. **最小权限**：每个组件只获得完成任务所需的最小权限
2. **密钥不入上下文**：任何密钥都不会出现在 LLM 的上下文窗口中
3. **审计可追溯**：所有安全相关操作都有完整的审计日志
4. **用户可控**：用户始终拥有对权限和数据的最终控制权

---

## 二、OS Keychain 密钥管理

### 2.1 为什么不用配置文件存储密钥

传统做法是将 API 密钥存储在 `.env` 文件或配置文件中。这种方法存在严重安全隐患：

- 明文存储在磁盘上，任何有文件读取权限的程序都能获取
- 容易被意外提交到版本控制系统
- 无法设置过期时间或访问控制
- 在多用户环境中不安全

### 2.2 操作系统级密钥存储

OpenHuman 利用操作系统的原生密钥管理服务：

**macOS Keychain：**

```swift
// macOS Keychain 访问封装
import Security

class KeychainManager {
    static let shared = KeychainManager()
    
    func store(key: String, value: String, service: String = "com.openhuman.secrets") throws {
        let data = value.data(using: .utf8)!
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        
        // 先删除已有的
        SecItemDelete(query as CFDictionary)
        // 再添加新的
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.storeFailed(status)
        }
    }
    
    func retrieve(key: String, service: String = "com.openhuman.secrets") throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}
```

**Linux Secret Service（GNOME Keyring / KWallet）：**

```python
import secretstorage

class LinuxSecretManager:
    def __init__(self):
        self.bus = secretstorage.dbus_init()
        self.collection = secretstorage.get_default_collection(self.bus)
        # 确保 collection 已解锁
        if self.collection.is_locked():
            self.collection.unlock()
    
    def store(self, key: str, value: str, label: str = "OpenHuman Secret"):
        self.collection.create_item(
            label,
            {"application": "openhuman", "key": key},
            value.encode('utf-8')
        )
    
    def retrieve(self, key: str) -> str | None:
        items = self.collection.search_items({"application": "openhuman", "key": key})
        for item in items:
            return item.get_secret().decode('utf-8')
        return None
```

### 2.2.4 Windows Credential Manager

```python
import ctypes
from ctypes import wintypes

class WindowsCredentialManager:
    """
    Windows 凭据管理器访问封装
    使用 Windows Credential Manager API 存储敏感信息
    """

    CRED_TYPE_GENERIC = 1
    CRED_PERSIST_LOCAL_MACHINE = 2

    def __init__(self):
        self.advapi32 = ctypes.windll.advapi32

    def store(self, target: str, username: str, password: str):
        """存储凭据到 Windows Credential Manager"""
        class CREDENTIAL(ctypes.Structure):
            _fields_ = [
                ("Flags", wintypes.DWORD),
                ("Type", wintypes.DWORD),
                ("TargetName", wintypes.LPWSTR),
                ("Comment", wintypes.LPWSTR),
                ("LastWritten", wintypes.FILETIME),
                ("CredentialBlobSize", wintypes.DWORD),
                ("CredentialBlob", ctypes.c_char_p),
                ("Persist", wintypes.DWORD),
                ("AttributeCount", wintypes.DWORD),
                ("Attributes", ctypes.c_void_p),
                ("TargetAlias", wintypes.LPWSTR),
                ("UserName", wintypes.LPWSTR),
            ]

        cred = CREDENTIAL()
        cred.Type = self.CRED_TYPE_GENERIC
        cred.TargetName = f"OpenHuman_{target}"
        cred.UserName = username
        cred.CredentialBlob = password.encode('utf-8')
        cred.CredentialBlobSize = len(password.encode('utf-8'))
        cred.Persist = self.CRED_PERSIST_LOCAL_MACHINE

        result = self.advapi32.CredWriteW(ctypes.byref(cred), 0)
        if not result:
            raise OSError(f"CredWrite failed: {ctypes.GetLastError()}")
```

### 2.3 密钥访问控制

OpenHuman 对密钥访问实施严格的控制策略：

```python
class SecretAccessPolicy:
    """定义密钥访问策略"""
    
    # 密钥分级
    class Level:
        PUBLIC = "public"       # 可以出现在日志中
        INTERNAL = "internal"   # 仅内部使用，不出现在日志
        SENSITIVE = "sensitive" # 永不出现在任何输出中
        CRITICAL = "critical"  # 需要用户确认才能使用
    
    def __init__(self):
        self.policies: dict[str, str] = {}
    
    def register(self, key: str, level: str, allowed_components: list[str]):
        self.policies[key] = {
            "level": level,
            "allowed_components": allowed_components
        }
    
    def check_access(self, key: str, component: str) -> bool:
        policy = self.policies.get(key)
        if not policy:
            return False
        if policy["level"] == self.Level.CRITICAL:
            return self._prompt_user_confirmation(key, component)
        return component in policy["allowed_components"]
```

### 2.4 密钥生命周期管理

```
创建 → 存储 → 使用 → 轮换 → 撤销 → 删除
         ↑           ↓
    Keychain    定期检查过期
```

密钥生命周期的关键节点：

1. **创建**：首次配置时，通过安全输入（不回显的终端输入或系统对话框）获取密钥
2. **存储**：立即写入 OS Keychain，不在内存中长期持有
3. **使用**：按需从 Keychain 读取，使用后立即从内存清除
4. **轮换**：定期检查密钥有效期，自动提示用户更新
5. **撤销**：当检测到异常使用模式时，自动撤销密钥

```python
class KeyRotationManager:
    def __init__(self, keychain: KeychainManager):
        self.keychain = keychain
    
    def check_and_rotate(self, key: str, max_age_days: int = 90):
        metadata = self.keychain.get_metadata(key)
        if metadata and metadata.created_at:
            age = (datetime.now() - metadata.created_at).days
            if age > max_age_days:
                self._notify_rotation_needed(key, age)
    
    def _notify_rotation_needed(self, key: str, age: int):
        # 通知用户密钥已过期，需要更新
        # 不自动轮换，确保用户知情
        pass
```

### 2.5 密钥管理的常见陷阱

在实际部署中，密钥管理有几个容易忽视的坑：

**陷阱 1：环境变量泄露到子进程**

```python
# ❌ 错误做法：将密钥放在环境变量中
os.environ["API_KEY"] = "sk-xxxx"
subprocess.run(["node", "script.js"])  # 子进程可以读取所有环境变量

# ✅ 正确做法：只传递必要的环境变量
subprocess.run(
    ["node", "script.js"],
    env={"PATH": os.environ["PATH"], "NODE_ENV": "production"}
)
```

**陷阱 2：日志中意外输出密钥**

```python
# ❌ 错误做法：直接打印请求
print(f"Sending request to {url} with token {token}")

# ✅ 正确做法：使用脱敏日志
import hashlib
token_hash = hashlib.sha256(token.encode()).hexdigest()[:8]
print(f"Sending request to {url} with token_hash={token_hash}")
```

**陷阱 3：Keychain 解锁弹窗轰炸**

macOS Keychain 在首次访问或长时间未使用时会弹出系统对话框请求用户授权。如果 Agent 短时间内频繁访问不同 Keychain item，会触发大量弹窗。OpenHuman 的解决方案是批量读取 + 内存缓存：

```python
class KeychainBatchReader:
    """批量预读 Keychain 减少弹窗"""
    def __init__(self, service: str):
        self.service = service
        self._cache: dict[str, str] = {}

    def warmup(self, keys: list[str]):
        """启动时批量预读所有需要的密钥"""
        for key in keys:
            try:
                self._cache[key] = self._read_from_keychain(key)
            except KeychainLockedError:
                # 用户拒绝解锁，记录但不阻塞
                pass

    def get(self, key: str) -> str:
        if key in self._cache:
            return self._cache[key]
        return self._read_from_keychain(key)
```

---

## 三、OAuth Token 代理

### 3.1 OAuth 在 AI Agent 中的挑战

当 OpenHuman 需要访问第三方服务（Gmail、GitHub、Slack 等）时，通常使用 OAuth 2.0 授权流程。但在 AI Agent 场景下，OAuth 面临特殊挑战：

1. **Token 泄露风险**：access_token 如果进入 LLM 上下文，可能被模型"记住"并在不恰当的场景输出
2. **刷新时机**：Agent 可能在长时间空闲后突然需要使用 token，此时 refresh_token 可能已过期
3. **多 provider 管理**：同时使用多个 OAuth provider 时，token 存储和隔离变得复杂
4. **最小权限**：需要确保 Agent 只请求完成任务所需的最小 scope

### 3.2 Token 代理架构

OpenHuman 采用 Token 代理模式，LLM 永远不直接接触原始 token：

```
┌──────────┐     "请帮我读取 Gmail"     ┌──────────────┐
│  LLM     │ ──────────────────────────→ │  Token Proxy │
│  Agent   │                             │              │
│          │ ←────────────────────────── │  1. 查找 token│
│          │     返回处理结果（非token）    │  2. 刷新     │
└──────────┘                             │  3. 注入请求  │
                                         │  4. 返回结果  │
                                         └──────┬───────┘
                                                │
                                         ┌──────┴───────┐
                                         │  OS Keychain │
                                         │  (token存储)  │
                                         └──────────────┘
```

### 3.3 Token 代理实现

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
import httpx

@dataclass
class OAuthProvider:
    name: str
    client_id: str
    client_secret_key: str  # 在 Keychain 中的键名
    auth_url: str
    token_url: str
    scopes: list[str]
    redirect_uri: str

class TokenProxy:
    """
    OAuth Token 代理：管理 token 生命周期，LLM 不直接接触 token
    """
    
    def __init__(self, keychain: KeychainManager):
        self.keychain = keychain
        self.providers: dict[str, OAuthProvider] = {}
        self.token_cache: dict[str, CachedToken] = {}
    
    def register_provider(self, provider: OAuthProvider):
        """注册 OAuth provider"""
        self.providers[provider.name] = provider
    
    async def execute_request(
        self, provider_name: str, method: str, url: str, 
        **kwargs
    ) -> httpx.Response:
        """
        代理执行 API 请求：注入 token，处理刷新，返回结果
        LLM 调用此方法而非直接使用 token
        """
        token = await self._get_valid_token(provider_name)
        
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {token}"
        
        async with httpx.AsyncClient() as client:
            response = await client.request(method, url, headers=headers, **kwargs)
            
            # 如果返回 401，尝试刷新 token
            if response.status_code == 401:
                token = await self._refresh_token(provider_name)
                headers["Authorization"] = f"Bearer {token}"
                response = await client.request(method, url, headers=headers, **kwargs)
            
            return response
    
    async def _get_valid_token(self, provider_name: str) -> str:
        """获取有效的 access_token，必要时自动刷新"""
        cached = self.token_cache.get(provider_name)
        
        if cached and not cached.is_expired():
            return cached.access_token
        
        # 尝试从 Keychain 获取 refresh_token 并刷新
        return await self._refresh_token(provider_name)
    
    async def _refresh_token(self, provider_name: str) -> str:
        """使用 refresh_token 获取新的 access_token"""
        provider = self.providers[provider_name]
        refresh_token = self.keychain.retrieve(
            f"oauth_{provider_name}_refresh_token"
        )
        
        if not refresh_token:
            raise OAuthError(f"No refresh token for {provider_name}")
        
        client_secret = self.keychain.retrieve(provider.client_secret_key)
        
        async with httpx.AsyncClient() as client:
            response = await client.post(provider.token_url, data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": provider.client_id,
                "client_secret": client_secret,
            })
            
            data = response.json()
            
            # 更新缓存
            self.token_cache[provider_name] = CachedToken(
                access_token=data["access_token"],
                expires_at=datetime.now() + timedelta(seconds=data.get("expires_in", 3600))
            )
            
            # 如果返回了新的 refresh_token，更新 Keychain
            if "refresh_token" in data:
                self.keychain.store(
                    f"oauth_{provider_name}_refresh_token",
                    data["refresh_token"]
                )
            
            return data["access_token"]

@dataclass
class CachedToken:
    access_token: str
    expires_at: datetime
    
    def is_expired(self, buffer_seconds: int = 300) -> bool:
        """提前 5 分钟视为过期，避免边界情况"""
        return datetime.now() >= (self.expires_at - timedelta(seconds=buffer_seconds))
```

### 3.4 OAuth Scope 最小化

OpenHuman 在发起 OAuth 授权请求时，严格遵循最小权限原则：

```yaml
# OAuth scope 配置
oauth:
  providers:
    gmail:
      scopes:
        - https://www.googleapis.com/auth/gmail.readonly    # 只读
      # 不请求: gmail.compose, gmail.modify, gmail.full
    github:
      scopes:
        - read:user                                         # 读取用户信息
        - repo:status                                       # 读取仓库状态
      # 不请求: repo (完整仓库访问), admin:org
    slack:
      scopes:
        - channels:read                                     # 读取频道列表
        - chat:write                                        # 发送消息
      # 不请求: admin, channels:manage
```

### 3.5 Token 代理的安全优势

1. **LLM 零接触**：token 从不进入 LLM 上下文窗口，消除了泄露风险
2. **自动刷新**：透明处理 token 过期，Agent 无需关心
3. **统一管理**：所有 provider 的 token 集中管理，便于审计和撤销
4. **请求审计**：所有通过代理的 API 请求都有完整日志

### 3.6 OAuth 授权码流程完整实现

上面展示了 Token 代理的刷新逻辑，下面补充完整的 OAuth 2.0 Authorization Code Flow 实现：

```python
import secrets
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

class OAuthAuthorizationFlow:
    """
    完整的 OAuth 2.0 授权码流程
    本地起一个临时 HTTP 服务器接收回调
    """

    def __init__(self, provider: OAuthProvider, keychain: KeychainManager):
        self.provider = provider
        self.keychain = keychain
        self.state = secrets.token_urlsafe(32)  # CSRF 防护
        self._auth_code: str | None = None

    def get_authorization_url(self) -> str:
        """生成授权 URL，引导用户在浏览器中打开"""
        params = {
            "client_id": self.provider.client_id,
            "redirect_uri": self.provider.redirect_uri,
            "scope": " ".join(self.provider.scopes),
            "response_type": "code",
            "state": self.state,
            "access_type": "offline",        # 请求 refresh_token
            "prompt": "consent",             # 强制显示同意页面
        }
        return f"{self.provider.auth_url}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str) -> dict:
        """用授权码换取 access_token 和 refresh_token"""
        async with httpx.AsyncClient() as client:
            response = await client.post(self.provider.token_url, data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.provider.redirect_uri,
                "client_id": self.provider.client_id,
                "client_secret": self.keychain.retrieve(
                    self.provider.client_secret_key
                ),
            })
            data = response.json()

            # 立即将 refresh_token 存入 Keychain
            if "refresh_token" in data:
                self.keychain.store(
                    f"oauth_{self.provider.name}_refresh_token",
                    data["refresh_token"]
                )

            return data

    def start_callback_server(self, port: int = 8765):
        """启动本地 HTTP 服务器接收 OAuth 回调"""
        flow = self

        class CallbackHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                params = urllib.parse.parse_qs(
                    urllib.parse.urlparse(self.path).query
                )
                # 验证 state 防止 CSRF
                if params.get("state", [None])[0] != flow.state:
                    self.send_error(403, "State mismatch")
                    return
                flow._auth_code = params.get("code", [None])[0]
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Authorization successful. Close this window.")

            def log_message(self, *args):
                pass  # 静默日志

        server = HTTPServer(("127.0.0.1", port), CallbackHandler)
        thread = threading.Thread(target=server.handle_request, daemon=True)
        thread.start()
        return server
```

**关键安全设计要点：**

1. `state` 参数使用 `secrets.token_urlsafe(32)` 生成，防止 CSRF 攻击
2. 回调服务器只监听 `127.0.0.1`，不接受外部连接
3. `refresh_token` 在获取后立即写入 Keychain，不在内存中久留
4. `access_type=offline` 确保获取 `refresh_token`（Google OAuth 特有参数）

---

## 四、Workspace 沙箱

### 4.1 沙箱的必要性

当 Agent 执行代码、读写文件时，需要严格限制其访问范围。一个不受约束的 Agent 可能：

- 读取 `~/.ssh/id_rsa` 等敏感文件
- 修改系统配置文件
- 访问其他用户的文件
- 执行破坏性命令（如 `rm -rf /`）

### 4.2 文件系统隔离

OpenHuman 的 Workspace 沙箱将 Agent 的文件访问限制在指定目录内：

```python
import os
from pathlib import Path

class WorkspaceSandbox:
    """
    文件系统沙箱：限制 Agent 只能访问 workspace 目录内的文件
    """
    
    def __init__(self, workspace_root: str):
        self.root = Path(workspace_root).resolve()
        self.blocked_paths: set[Path] = set()
        self._init_blocked_paths()
    
    def _init_blocked_paths(self):
        """初始化默认阻止路径"""
        home = Path.home()
        self.blocked_paths = {
            home / ".ssh",
            home / ".gnupg",
            home / ".aws",
            home / ".config/gcloud",
            home / ".kube",
            Path("/etc"),
            Path("/var"),
            Path("/usr"),
            Path("/System"),
        }
    
    def validate_path(self, requested_path: str) -> Path:
        """
        验证并规范化路径，确保在沙箱内
        路径遍历攻击防护
        """
        resolved = (self.root / requested_path).resolve()
        
        # 检查是否在 workspace 内
        if not str(resolved).startswith(str(self.root)):
            raise SandboxViolation(
                f"Path '{requested_path}' escapes workspace boundary"
            )
        
        # 检查是否在阻止列表中
        for blocked in self.blocked_paths:
            if str(resolved).startswith(str(blocked)):
                raise SandboxViolation(
                    f"Path '{requested_path}' accesses blocked system directory"
                )
        
        # 检查符号链接是否指向外部
        if resolved.is_symlink():
            link_target = resolved.readlink().resolve()
            if not str(link_target).startswith(str(self.root)):
                raise SandboxViolation(
                    f"Symlink '{requested_path}' points outside workspace"
                )
        
        return resolved
    
    def read_file(self, path: str) -> str:
        """安全读取文件"""
        validated = self.validate_path(path)
        with open(validated, 'r', encoding='utf-8') as f:
            return f.read()
    
    def write_file(self, path: str, content: str) -> None:
        """安全写入文件"""
        validated = self.validate_path(path)
        validated.parent.mkdir(parents=True, exist_ok=True)
        with open(validated, 'w', encoding='utf-8') as f:
            f.write(content)
    
    def list_dir(self, path: str = ".") -> list[str]:
        """安全列出目录"""
        validated = self.validate_path(path)
        entries = []
        for entry in validated.iterdir():
            # 过滤隐藏文件和敏感文件
            if entry.name.startswith('.'):
                continue
            entries.append(entry.name)
        return entries


class SandboxViolation(Exception):
    """沙箱违规异常"""
    pass
```

### 4.3 网络访问控制

沙箱不仅限制文件访问，还控制网络行为：

```python
class NetworkPolicy:
    """
    网络访问策略：控制 Agent 可以访问哪些网络资源
    """
    
    def __init__(self):
        self.allowed_domains: set[str] = set()
        self.blocked_domains: set[str] = set()
        self.allowed_ports: set[int] = {80, 443}
        self.rate_limits: dict[str, RateLimit] = {}
    
    def check_request(self, url: str) -> bool:
        """检查网络请求是否被允许"""
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        
        # 检查域名黑名单
        if domain in self.blocked_domains:
            raise NetworkViolation(f"Domain '{domain}' is blocked")
        
        # 检查端口
        if port not in self.allowed_ports:
            raise NetworkViolation(f"Port {port} is not allowed")
        
        # 检查速率限制
        if domain in self.rate_limits:
            limit = self.rate_limits[domain]
            if not limit.check():
                raise RateLimitExceeded(f"Rate limit exceeded for '{domain}'")
        
        return True

@dataclass
class RateLimit:
    max_requests: int
    window_seconds: int
    requests: list[datetime] = field(default_factory=list)
    
    def check(self) -> bool:
        now = datetime.now()
        cutoff = now - timedelta(seconds=self.window_seconds)
        self.requests = [r for r in self.requests if r > cutoff]
        if len(self.requests) >= self.max_requests:
            return False
        self.requests.append(now)
        return True
```

### 4.4 进程权限限制

当 Agent 需要执行系统命令时，沙箱进一步限制进程权限：

```python
import subprocess
import resource

class SandboxedProcessRunner:
    """
    沙箱化的进程执行器
    """
    
    FORBIDDEN_COMMANDS = {
        'rm -rf /', 'mkfs', 'dd', 'fdisk',
        'sudo', 'su', 'chmod 777',
        'curl | bash', 'wget | sh',
    }
    
    def __init__(self, sandbox: WorkspaceSandbox):
        self.sandbox = sandbox
    
    def run(self, command: str, timeout: int = 30) -> subprocess.CompletedProcess:
        """在沙箱中执行命令"""
        
        # 安全检查
        self._validate_command(command)
        
        # 设置资源限制
        def set_limits():
            # CPU 时间限制：30 秒
            resource.setrlimit(resource.RLIMIT_CPU, (timeout, timeout))
            # 内存限制：512MB
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
            # 文件大小限制：100MB
            resource.setrlimit(resource.RLIMIT_FSIZE, (100 * 1024 * 1024, 100 * 1024 * 1024))
            # 进程数限制：50
            resource.setrlimit(resource.RLIMIT_NPROC, (50, 50))
        
        return subprocess.run(
            command,
            shell=True,
            cwd=str(self.sandbox.root),
            capture_output=True,
            text=True,
            timeout=timeout,
            preexec_fn=set_limits,
        )
    
    def _validate_command(self, command: str):
        """验证命令安全性"""
        command_lower = command.lower().strip()
        
        for forbidden in self.FORBIDDEN_COMMANDS:
            if forbidden in command_lower:
                raise SandboxViolation(f"Forbidden command pattern: '{forbidden}'")
        
        # 检查是否试图访问沙箱外的文件
        import re
        paths_in_command = re.findall(r'(?:^|\s)(/[^\s]+)', command)
        for path in paths_in_command:
            try:
                self.sandbox.validate_path(path)
            except SandboxViolation:
                raise SandboxViolation(f"Command accesses blocked path: '{path}'")
```

---

## 五、三大框架安全模型对比

### 5.1 核心安全特性对比

| 特性 | OpenHuman | Hermes Agent | OpenClaw |
|------|-----------|-------------|----------|
| **密钥存储** | OS Keychain（系统级加密） | Keychain + env 变量回退 | 配置文件 + 环境变量 |
| **Token 管理** | 代理模式，LLM 零接触 | 插件内封装，skill 隔离 | 直接传入工具函数 |
| **文件沙箱** | 完整路径隔离 + 符号链接检查 | 工作目录限制 + 跨 profile guard | 基于 .gitignore 的软限制 |
| **网络控制** | 域名白名单 + 端口限制 + 速率限制 | 无内置网络策略 | 无内置网络控制 |
| **进程隔离** | 资源限制 + 命令过滤 + cgroup | 子代理工具屏蔽 + 审批策略 | 依赖操作系统权限 |
| **插件/技能安全** | 插件签名 + 沙箱隔离 | quarantine 审计 + lock-file 溯源 | 社区审核（无签名验证） |
| **Prompt Injection 防护** | 输出过滤 + 上下文隔离 | MCP prompt-injection 检测 | 无内置防护 |
| **审计日志** | 完整操作审计（append-only） | 会话级日志 + cron 执行记录 | 会话日志 |
| **数据主权** | 本地优先，数据不出境 | 本地运行，provider 路由可选云端 | 云端优先，本地可选 |
| **多用户隔离** | workspace 级隔离 | profile 级隔离 | workspace 隔离 |

### 5.2 设计哲学差异

三个框架在安全设计上有截然不同的取舍：

**OpenHuman** 采用"安全优先"策略，每一层都假设上一层可能被突破。Keychain 存储 → Token 代理 → 沙箱隔离，形成三层纵深防御。代价是配置复杂度高，适合处理敏感数据的企业场景。

**Hermes Agent** 采用"实用优先"策略，通过 profile 隔离和子代理审批机制在安全和灵活性之间取得平衡。安全机制集中在插件生态（quarantine 审计、lock-file 溯源）而非运行时强制。适合开发者个人使用和团队协作。

**OpenClaw** 采用"轻量优先"策略，安全依赖社区共识和用户自觉。配置文件存储密钥、无内置网络控制，降低了入门门槛但也增加了误配置风险。适合个人实验和非敏感场景。

### 5.3 各框架安全评分（满分 10）

| 维度 | OpenHuman | Hermes Agent | OpenClaw |
|------|-----------|-------------|----------|
| 密钥保护 | 9 | 7 | 4 |
| 运行时隔离 | 9 | 6 | 3 |
| 审计能力 | 8 | 6 | 4 |
| Prompt Injection 防护 | 8 | 7 | 2 |
| 配置易用性 | 5 | 7 | 9 |
| **综合** | **7.8** | **6.6** | **4.4** |

---

## 六、威胁模型与防护策略

### 6.1 攻击面分析

| 威胁 | 攻击路径 | OpenHuman 防护 |
|------|---------|---------------|
| 密钥泄露 | LLM 输出包含密钥 | Keychain 存储，密钥不入上下文 |
| 路径遍历 | `../../etc/passwd` | 路径规范化 + 沙箱边界检查 |
| 命令注入 | `; rm -rf /` | 命令过滤 + 资源限制 |
| SSRF 攻击 | 访问内部服务 | 网络策略 + 域名白名单 |
| Token 盗取 | 通过 prompt injection | Token 代理，LLM 不接触 token |
| 数据外泄 | 上传敏感文件 | 文件分类 + 上传白名单 |
| 供应链攻击 | 恶意插件 | 插件签名 + 沙箱隔离 |

### 6.2 Prompt Injection 防护

Prompt injection 是 AI Agent 面临的独特威胁。攻击者可能在网页、邮件中嵌入恶意指令，试图让 Agent 泄露密钥或执行危险操作。

OpenHuman 的防护策略：

1. **上下文隔离**：外部数据标记为不可信，与系统指令严格分离
2. **操作确认**：敏感操作（如密钥访问、文件删除）需要用户确认
3. **输出过滤**：检测 LLM 输出是否包含密钥模式，自动拦截

```python
class OutputFilter:
    """检测并过滤 LLM 输出中的敏感信息"""
    
    PATTERNS = [
        r'(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S+',
        r'sk-[a-zA-Z0-9]{20,}',      # OpenAI API key
        r'ghp_[a-zA-Z0-9]{36}',       # GitHub token
        r'xoxb-[0-9]+-[a-zA-Z0-9]+',  # Slack token
    ]
    
    def filter(self, output: str) -> str:
        for pattern in self.PATTERNS:
            output = re.sub(pattern, '[REDACTED]', output, flags=re.IGNORECASE)
        return output
```

---

## 七、安全审计与合规性

### 7.1 审计日志

OpenHuman 记录所有安全相关事件：

```python
@dataclass
class AuditEvent:
    timestamp: datetime
    event_type: str     # secret_access, file_read, file_write, network_request, command_exec
    component: str      # 发起操作的组件
    target: str         # 操作目标
    result: str         # success, denied, error
    details: dict       # 附加信息

class AuditLogger:
    def log(self, event: AuditEvent):
        # 写入审计日志文件（append-only）
        # 审计日志本身存储在受保护的位置
        pass
```

### 7.2 合规性考量

- **GDPR**：用户数据处理遵循数据最小化原则，支持数据导出和删除
- **SOC 2**：审计日志保留策略、访问控制、加密存储符合 SOC 2 要求
- **数据驻留**：本地优先架构天然满足数据不出境要求

---

## 八、总结

OpenHuman 的三层安全模型——OS Keychain 密钥管理、OAuth Token 代理、Workspace 沙箱——构成了一个完整的纵深防御体系：

| 层级 | 保护对象 | 核心机制 |
|------|---------|---------|
| OS Keychain | 密钥和凭证 | 系统级加密存储，密钥不入上下文 |
| OAuth Token 代理 | 第三方服务访问 | LLM 零接触 token，自动刷新 |
| Workspace 沙箱 | 文件和进程 | 路径隔离，网络控制，资源限制 |

安全不是事后添加的功能，而是从架构设计之初就融入的基因。OpenHuman 通过这种设计，让用户可以放心地赋予 Agent 更多能力，而不必担心安全隐患。

在 AI Agent 时代，安全模型的质量直接决定了用户信任的上限。OpenHuman 的安全实践为开源 AI Agent 框架树立了值得参考的标杆。

---

## 相关阅读

- [三大框架安全模型对比：工具隔离、记忆分区、隐私边界、数据主权](/post/go-wasi/) — 从工具隔离、记忆分区、隐私边界三个维度系统对比 OpenHuman、Hermes、OpenClaw 的安全设计
- [OpenHuman 安全实战：本地加密、数据主权、隐私合规](/post/openhuman/) — 聚焦 OpenHuman 的本地加密方案与 GDPR/SOC 2 合规实践
- [AI Coding Agent 安全实战：沙箱隔离、权限边界、代码审计](/post/ai-coding-agent/) — AI 编码助手的沙箱隔离方案与防止"越狱"风险的工程实践
- [OpenHuman vs Hermes vs OpenClaw：三大开源 AI Agent 框架深度对比](/post/prompt-cache-hermes-ephemeral-injection-openclaw-volatile-tier-openhuman-local-core/) — 架构、能力、适用场景的全方位对比，帮助你选择合适的框架
