---
title: FastAPI 实战：高性能 Python API 框架——Pydantic 校验、依赖注入与 OpenAPI 自动生成
date: 2026-06-02 10:00:00
tags: [FastAPI, Python, Pydantic, OpenAPI, REST API, 依赖注入]
keywords: [FastAPI, Python API, Pydantic, OpenAPI, 高性能, 校验, 依赖注入与, 自动生成, 架构]
categories:
  - architecture
cover: https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=630&fit=crop
description: "FastAPI以类型提示驱动设计，成为Python生态最受欢迎的API框架。本文从Laravel开发者视角全面解析FastAPI核心特性：Pydantic数据模型（嵌套验证/泛型响应/自定义校验）、Depends依赖注入系统、SQLAlchemy数据库集成、Repository模式、中间件、异步编程与后台任务、自动OpenAPI文档生成，含vs Flask/Django REST对比和完整CRUD实战与测试示例，适合后端工程师技术栈拓展。"
---


# FastAPI 实战：高性能 Python API 框架——Pydantic 校验、依赖注入与 OpenAPI 自动生成

## 前言

作为一个长期使用 Laravel 构建 B2C API 的后端工程师，当我第一次接触 FastAPI 时，最直观的感受是：**这不就是 Python 版的 Laravel 吗？** 路由定义、请求验证、依赖注入、自动文档生成——这些在 Laravel 中需要多个包组合才能实现的功能，FastAPI 开箱即用。

但深入使用后，我发现了两者的核心差异：Laravel 是一个「全家桶」式的全栈框架，而 FastAPI 专注于 API 开发。FastAPI 的设计理念是：**只做 API，但做到极致**。它基于 Python 的类型提示（Type Hints）系统，结合 Pydantic 数据验证和 Starlette 异步框架，在开发体验和运行性能之间找到了绝佳的平衡点。

这篇文章将从 Laravel 开发者的视角出发，全面介绍 FastAPI 的核心特性。我们会从最基础的路由定义开始，深入 Pydantic 数据模型、依赖注入系统、中间件、数据库集成，最后对比 FastAPI 与 Laravel 在 API 开发中的优劣。

---

## 第一章：FastAPI 快速入门

### 1.1 安装与第一个 API

```bash
# 安装 FastAPI 和 ASGI 服务器
pip install fastapi uvicorn

# 或者使用 uv（推荐）
uv pip install fastapi uvicorn
```

```python
# main.py
from fastapi import FastAPI

app = FastAPI(
    title="B2C API",
    description="电商后端 API 服务",
    version="1.0.0",
)

@app.get("/")
async def root():
    return {"message": "Hello, World!"}

@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str = None):
    return {"item_id": item_id, "q": q}
```

```bash
# 启动服务
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 访问 API 文档
# Swagger UI: http://localhost:8000/docs
# ReDoc: http://localhost:8000/redoc
```

对比 Laravel 的路由定义：

```php
// Laravel routes/api.php
Route::get('/', function () {
    return ['message' => 'Hello, World!'];
});

Route::get('/items/{item_id}', function (int $item_id, ?string $q = null) {
    return ['item_id' => $item_id, 'q' => $q];
});
```

### 1.2 路由与请求方法

```python
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

# 定义数据模型
class User(BaseModel):
    id: Optional[int] = None
    name: str
    email: str
    age: int = 0

# 模拟数据库
users_db: dict[int, User] = {}

# GET - 获取所有用户
@app.get("/users", response_model=list[User])
async def list_users(skip: int = 0, limit: int = 100):
    return list(users_db.values())[skip:skip + limit]

# GET - 获取单个用户
@app.get("/users/{user_id}", response_model=User)
async def get_user(user_id: int):
    if user_id not in users_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found"
        )
    return users_db[user_id]

# POST - 创建用户
@app.post("/users", response_model=User, status_code=status.HTTP_201_CREATED)
async def create_user(user: User):
    user.id = len(users_db) + 1
    users_db[user.id] = user
    return user

# PUT - 更新用户
@app.put("/users/{user_id}", response_model=User)
async def update_user(user_id: int, user: User):
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    user.id = user_id
    users_db[user_id] = user
    return user

# DELETE - 删除用户
@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int):
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    del users_db[user_id]

# PATCH - 部分更新
@app.patch("/users/{user_id}", response_model=User)
async def partial_update_user(user_id: int, user_update: UserUpdate):
    if user_id not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
    
    stored_user = users_db[user_id]
    update_data = user_update.dict(exclude_unset=True)
    updated_user = stored_user.copy(update=update_data)
    users_db[user_id] = updated_user
    return updated_user
```

---

## 第二章：Pydantic 数据模型深度实战

### 2.1 Pydantic 是什么？

Pydantic 是 FastAPI 的核心依赖之一，它利用 Python 的类型提示实现运行时数据验证。这与 Laravel 的 Form Request 有异曲同工之妙，但更加强大：

```python
from pydantic import BaseModel, Field, validator, root_validator
from typing import Optional
from datetime import datetime
from enum import Enum

# 枚举类型
class OrderStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

# 基础模型
class UserBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="用户名")
    email: str = Field(..., regex=r'^[\w\.-]+@[\w\.-]+\.\w+$', description="邮箱地址")
    age: int = Field(0, ge=0, le=150, description="年龄")
    phone: Optional[str] = Field(None, regex=r'^\+?1?\d{9,15}$', description="手机号")

# 创建请求模型
class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128, description="密码")
    
    @validator('password')
    def password_strength(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError('密码必须包含至少一个大写字母')
        if not any(c.islower() for c in v):
            raise ValueError('密码必须包含至少一个小写字母')
        if not any(c.isdigit() for c in v):
            raise ValueError('密码必须包含至少一个数字')
        return v

# 更新请求模型
class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = None
    age: Optional[int] = Field(None, ge=0, le=150)
    phone: Optional[str] = None

# 响应模型
class UserResponse(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True  # 支持 ORM 模型转换

# 订单模型
class OrderItem(BaseModel):
    product_id: int
    quantity: int = Field(..., ge=1)
    price: float = Field(..., gt=0)

class OrderCreate(BaseModel):
    items: list[OrderItem] = Field(..., min_items=1)
    shipping_address: str
    note: Optional[str] = None
    
    @root_validator
    def calculate_total(cls, values):
        items = values.get('items', [])
        if not items:
            raise ValueError('订单至少需要一个商品')
        return values

class OrderResponse(BaseModel):
    id: int
    user_id: int
    items: list[OrderItem]
    total: float
    status: OrderStatus
    created_at: datetime
```

### 2.2 对比 Laravel Form Request

```php
// Laravel Form Request
class CreateUserRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => 'required|string|max:100',
            'email' => 'required|email|unique:users',
            'age' => 'integer|min:0|max:150',
            'password' => 'required|min:8|regex:/[A-Z]/|regex:/[a-z]/|regex:/[0-9]/',
        ];
    }
    
    public function messages(): array
    {
        return [
            'password.regex' => '密码必须包含大小写字母和数字',
        ];
    }
}
```

| 维度 | Pydantic | Laravel Form Request |
|------|----------|---------------------|
| 验证时机 | 运行时，基于类型提示 | 请求进入时 |
| 类型转换 | 自动转换（str→int 等） | 需手动 cast |
| 嵌套模型 | 原生支持 | 需要 `.*` 语法 |
| 自定义验证 | `@validator` 装饰器 | `withValidator` 方法 |
| 错误消息 | 自动生成，可自定义 | 手动定义 messages |
| OpenAPI 集成 | 自动生成 Schema | 需要额外工具 |
| IDE 支持 | 完美（类型提示） | 依赖 PHPDoc |

### 2.3 高级 Pydantic 特性

```python
from pydantic import BaseModel, Field, validator, constr, conint
from typing import Generic, TypeVar

# 自定义类型
class Address(BaseModel):
    street: str
    city: str
    state: Optional[str] = None
    zip_code: constr(regex=r'^\d{5}(-\d{4})?$')
    country: str = "CN"

# 泛型响应
DataT = TypeVar('DataT')

class ApiResponse(BaseModel, Generic[DataT]):
    code: int = 200
    message: str = "success"
    data: Optional[DataT] = None

class PaginatedResponse(BaseModel, Generic[DataT]):
    items: list[DataT]
    total: int
    page: int
    page_size: int
    total_pages: int

# 使用示例
@app.get("/users", response_model=ApiResponse[PaginatedResponse[UserResponse]])
async def list_users(page: int = 1, page_size: int = 20):
    # ...
    return ApiResponse(
        data=PaginatedResponse(
            items=users,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=(total + page_size - 1) // page_size,
        )
    )
```

---

## 第三章：依赖注入系统

### 3.1 FastAPI 的依赖注入

FastAPI 的依赖注入系统是其最强大的特性之一，类似于 Laravel 的容器，但更加轻量：

```python
from fastapi import Depends, FastAPI, HTTPException, Header
from typing import Optional

app = FastAPI()

# 基础依赖函数
async def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 认证依赖
async def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    if not authorization:
        raise HTTPException(status_code=401, detail="未提供认证信息")
    
    token = authorization.replace("Bearer ", "")
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="无效的 token")
    
    user = db.query(User).filter(User.id == payload["user_id"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    
    return user

# 权限依赖
def require_role(role: str):
    async def check_role(current_user: User = Depends(get_current_user)):
        if current_user.role != role:
            raise HTTPException(status_code=403, detail="权限不足")
        return current_user
    return check_role

# 使用依赖
@app.get("/users/me")
async def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user

@app.get("/admin/users")
async def list_all_users(
    admin: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return db.query(User).all()

# 分页依赖
class Pagination:
    def __init__(self, page: int = 1, page_size: int = 20):
        self.page = max(1, page)
        self.page_size = min(max(1, page_size), 100)
        self.offset = (self.page - 1) * self.page_size

@app.get("/items")
async def list_items(pagination: Pagination = Depends()):
    # pagination.page, pagination.page_size, pagination.offset 自动解析
    pass
```

### 3.2 类依赖注入

```python
from fastapi import Depends

class UserService:
    def __init__(self, db: Session = Depends(get_db)):
        self.db = db
    
    def get_user(self, user_id: int) -> User:
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    
    def create_user(self, user_data: UserCreate) -> User:
        user = User(**user_data.dict())
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

class OrderService:
    def __init__(
        self,
        db: Session = Depends(get_db),
        user_service: UserService = Depends(UserService),
    ):
        self.db = db
        self.user_service = user_service
    
    def create_order(self, user_id: int, order_data: OrderCreate) -> Order:
        user = self.user_service.get_user(user_id)
        # 创建订单逻辑...
        pass

# 在路由中使用
@app.post("/users/{user_id}/orders")
async def create_order(
    user_id: int,
    order_data: OrderCreate,
    order_service: OrderService = Depends(),
):
    return order_service.create_order(user_id, order_data)
```

### 3.3 对比 Laravel 依赖注入

```php
// Laravel 依赖注入
class UserController extends Controller
{
    public function __construct(
        private UserService $userService,
        private OrderService $orderService,
    ) {}
    
    public function show(int $id)
    {
        return $this->userService->getUser($id);
    }
    
    public function store(CreateUserRequest $request)
    {
        return $this->userService->createUser($request->validated());
    }
}

// Laravel 服务容器绑定
$this->app->bind(UserService::class, function ($app) {
    return new UserService($app->make(DB::class));
});
```

| 维度 | FastAPI Depends | Laravel Container |
|------|----------------|-------------------|
| 声明方式 | 函数参数 `Depends(fn)` | 构造函数注入 |
| 作用域 | 每次请求（可缓存） | 可配置（singleton/bind） |
| 依赖链 | 自动解析嵌套依赖 | 自动解析 |
| 条件依赖 | 函数返回类型决定 | 需要手动 Contextual Binding |
| 生命周期 | yield 自动管理 | 需要手动 afterResolving |

---

## 第四章：中间件与请求处理

### 4.1 中间件定义

```python
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
import time

app = FastAPI()

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 自定义中间件
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response

# 请求日志中间件
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"Request: {request.method} {request.url}")
    response = await call_next(request)
    print(f"Response: {response.status_code}")
    return response
```

### 4.2 对比 Laravel 中间件

```php
// Laravel 中间件
class ProcessTimeMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        $start = microtime(true);
        $response = $next($request);
        $processTime = microtime(true) - $start;
        $response->headers->set('X-Process-Time', $processTime);
        return $response;
    }
}

// 注册中间件
// app/Http/Kernel.php
protected $middleware = [
    \App\Http\Middleware\ProcessTimeMiddleware::class,
];
```

---

## 第五章：数据库集成

### 5.1 SQLAlchemy + FastAPI

```python
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime

DATABASE_URL = "mysql+pymysql://user:password@localhost:3306/mydb"

engine = create_engine(DATABASE_URL, pool_size=20, max_overflow=10)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ORM 模型
class UserDB(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    age = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# 依赖注入数据库会话
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Repository 模式
class UserRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def get_by_id(self, user_id: int) -> Optional[UserDB]:
        return self.db.query(UserDB).filter(UserDB.id == user_id).first()
    
    def get_by_email(self, email: str) -> Optional[UserDB]:
        return self.db.query(UserDB).filter(UserDB.email == email).first()
    
    def list(self, skip: int = 0, limit: int = 100) -> list[UserDB]:
        return self.db.query(UserDB).offset(skip).limit(limit).all()
    
    def create(self, user_data: UserCreate) -> UserDB:
        db_user = UserDB(**user_data.dict())
        self.db.add(db_user)
        self.db.commit()
        self.db.refresh(db_user)
        return db_user
    
    def update(self, user_id: int, user_data: UserUpdate) -> Optional[UserDB]:
        db_user = self.get_by_id(user_id)
        if not db_user:
            return None
        update_data = user_data.dict(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_user, key, value)
        self.db.commit()
        self.db.refresh(db_user)
        return db_user
    
    def delete(self, user_id: int) -> bool:
        db_user = self.get_by_id(user_id)
        if not db_user:
            return False
        self.db.delete(db_user)
        self.db.commit()
        return True

# 使用 Repository
@app.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
):
    repo = UserRepository(db)
    
    # 检查邮箱是否已存在
    existing = repo.get_by_email(user_data.email)
    if existing:
        raise HTTPException(status_code=400, detail="邮箱已存在")
    
    return repo.create(user_data)
```

### 5.2 对比 Laravel Eloquent

```php
// Laravel Eloquent 模型
class User extends Model
{
    protected $fillable = ['name', 'email', 'age'];
    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];
}

// 使用
$users = User::where('age', '>', 18)->paginate(20);
$user = User::create($validatedData);
```

| 操作 | FastAPI + SQLAlchemy | Laravel Eloquent |
|------|---------------------|-----------------|
| 查询单条 | `repo.get_by_id(id)` | `User::find(id)` |
| 条件查询 | `db.query(User).filter(...)` | `User::where(...)->get()` |
| 分页 | 手动 offset/limit | `->paginate()` |
| 创建 | `db.add(user); db.commit()` | `User::create($data)` |
| 关系 | `relationship()` + 显式 join | `->with('orders')` |
| 软删除 | 需手动实现 | 内置支持 |

---

## 第六章：OpenAPI 自动文档生成

### 6.1 文档配置

FastAPI 最大的卖点之一是自动生成 OpenAPI（Swagger）文档：

```python
from fastapi import FastAPI
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html

app = FastAPI(
    title="B2C 电商 API",
    description="""
    ## 功能概述
    
    * **用户管理** - 注册、登录、个人信息管理
    * **商品管理** - 商品 CRUD、分类、搜索
    * **订单管理** - 下单、支付、物流追踪
    * **支付系统** - 支付宝、微信支付集成
    
    ## 认证方式
    
    使用 Bearer Token 认证，在请求头中添加：
    ```
    Authorization: Bearer <your-token>
    ```
    """,
    version="2.0.0",
    contact={
        "name": "API 支持",
        "email": "api@example.com",
    },
    license_info={
        "name": "MIT",
    },
    docs_url=None,  # 禁用默认文档
    redoc_url=None,
)

# 自定义文档路径
@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=app.title + " - Swagger UI",
        swagger_js_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js",
        swagger_css_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
    )
```

### 6.2 路由文档增强

```python
from fastapi import FastAPI, Query, Path

@app.get(
    "/users/{user_id}",
    response_model=UserResponse,
    summary="获取用户详情",
    description="根据用户 ID 获取用户的详细信息，包括基本资料和统计数据。",
    response_description="返回用户详细信息",
    responses={
        404: {"description": "用户不存在", "model": ErrorResponse},
        401: {"description": "未授权"},
    },
    tags=["用户管理"],
)
async def get_user(
    user_id: int = Path(..., title="用户 ID", ge=1, description="用户的唯一标识"),
    include_stats: bool = Query(False, description="是否包含统计数据"),
):
    """
    获取用户详情
    
    - **user_id**: 用户的唯一 ID
    - **include_stats**: 是否返回用户的统计数据（订单数、消费金额等）
    """
    pass
```

### 6.3 与 Laravel API 文档对比

| 特性 | FastAPI (内置) | Laravel (Scribe/SwaggerPHP) |
|------|---------------|---------------------------|
| 自动生成 | 基于类型提示自动生成 | 需要注释或属性注解 |
| 交互式文档 | Swagger UI + ReDoc | 需配置 |
| 请求验证 | 自动生成 Schema | 需手动定义 |
| 响应模型 | `response_model` 自动推断 | 需要 `@response` 注解 |
| 维护成本 | 低（代码即文档） | 中（需要维护注解） |

---

## 第七章：异步编程与性能

### 7.1 异步端点

```python
import asyncio
import httpx

# 同步端点
@app.get("/sync/users/{user_id}")
def get_user_sync(user_id: int):
    # 同步数据库查询
    user = db.query(User).filter(User.id == user_id).first()
    return user

# 异步端点
@app.get("/async/users/{user_id}")
async def get_user_async(user_id: int):
    # 异步数据库查询（需要 async SQLAlchemy 或 asyncpg）
    async with async_session() as session:
        result = await session.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

# 并发请求示例
@app.get("/dashboard")
async def get_dashboard():
    async with httpx.AsyncClient() as client:
        # 并发请求多个服务
        users_task = client.get("http://user-service/users")
        orders_task = client.get("http://order-service/orders")
        products_task = client.get("http://product-service/products")
        
        users_resp, orders_resp, products_resp = await asyncio.gather(
            users_task, orders_task, products_task
        )
    
    return {
        "users": users_resp.json(),
        "orders": orders_resp.json(),
        "products": products_resp.json(),
    }
```

### 7.2 后台任务

```python
from fastapi import BackgroundTasks

def send_email(email_to: str, subject: str, body: str):
    # 发送邮件的耗时操作
    print(f"Sending email to {email_to}")

def process_order(order_id: int):
    # 处理订单的耗时操作
    print(f"Processing order {order_id}")

@app.post("/orders", response_model=OrderResponse)
async def create_order(
    order_data: OrderCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 创建订单
    order = create_order_in_db(db, current_user.id, order_data)
    
    # 添加后台任务
    background_tasks.add_task(send_email, current_user.email, "订单创建成功", f"订单号: {order.id}")
    background_tasks.add_task(process_order, order.id)
    
    return order
```

### 7.3 性能对比

| 场景 | FastAPI (async) | Laravel (PHP-FPM) |
|------|----------------|-------------------|
| 简单 JSON 响应 | ~50,000 req/s | ~5,000 req/s |
| 数据库查询 | ~15,000 req/s | ~3,000 req/s |
| 并发外部请求 | 异步非阻塞 | 需要 curl_multi |
| 内存占用 | 低（单进程） | 高（每进程独立） |

---

## 第八章：测试

### 8.1 使用 TestClient 测试

```python
from fastapi.testclient import TestClient
import pytest

client = TestClient(app)

def test_read_user():
    response = client.get("/users/1")
    assert response.status_code == 200
    assert response.json()["name"] == "张三"

def test_create_user():
    response = client.post("/users", json={
        "name": "新用户",
        "email": "new@example.com",
        "age": 25,
        "password": "StrongPass123",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "新用户"
    assert "id" in data

def test_create_user_invalid():
    response = client.post("/users", json={
        "name": "",
        "email": "invalid-email",
    })
    assert response.status_code == 422  # Pydantic 验证失败

# pytest fixtures
@pytest.fixture
def test_user():
    return UserCreate(
        name="测试用户",
        email="test@example.com",
        age=25,
        password="StrongPass123",
    )

@pytest.fixture
def authenticated_headers():
    token = create_test_token(user_id=1)
    return {"Authorization": f"Bearer {token}"}

def test_protected_endpoint(authenticated_headers):
    response = client.get("/users/me", headers=authenticated_headers)
    assert response.status_code == 200
```

### 8.2 对比 Laravel 测试

```php
// Laravel 测试
public function test_read_user()
{
    $user = User::factory()->create();
    $response = $this->getJson("/api/users/{$user->id}");
    $response->assertOk()->assertJsonFragment(['name' => $user->name]);
}

public function test_create_user()
{
    $response = $this->postJson('/api/users', [
        'name' => '新用户',
        'email' => 'new@example.com',
        'password' => 'StrongPass123',
    ]);
    $response->assertCreated();
}
```

---

## 第九章：FastAPI vs Laravel 完整对比

### 9.1 架构对比

| 维度 | FastAPI | Laravel |
|------|---------|---------|
| 语言 | Python | PHP |
| 异步支持 | 原生 async/await | Octane/Swoole（需要额外配置） |
| 数据验证 | Pydantic（类型提示） | Form Request + Validator |
| ORM | SQLAlchemy（可选） | Eloquent（内置） |
| 依赖注入 | Depends 函数 | 服务容器 |
| API 文档 | 自动生成 OpenAPI | Scribe/SwaggerPHP |
| 测试 | TestClient + pytest | PHPUnit/Pest |
| 队列 | Celery/ARQ | Laravel Queue |
| 缓存 | 手动集成 Redis | Cache Facade |
| 认证 | 手动实现/JWT | Sanctum/Passport |
| WebSocket | 原生支持 | Reverb/Pusher |

### 9.2 选型建议

**选择 FastAPI 的场景：**
- 纯 API 服务，不需要模板渲染
- 高并发场景，需要异步处理
- 微服务架构中的单个服务
- 数据科学/机器学习 API
- 团队熟悉 Python

**选择 Laravel 的场景：**
- 全栈 Web 应用（API + 前端）
- 需要快速迭代的 MVP
- 团队熟悉 PHP/Laravel 生态
- 需要丰富的内置功能（队列、缓存、邮件等）
- 企业级应用，需要长期维护

---

## 总结

FastAPI 以其优雅的类型提示驱动设计、强大的依赖注入系统和自动 API 文档生成，成为 Python 生态中最受欢迎的 API 框架。对于 Laravel 开发者来说，FastAPI 提供了一种熟悉但又不同的 API 开发体验：

1. **Pydantic 替代 Form Request**：类型提示驱动的数据验证，编译时检查
2. **Depends 替代服务容器**：更轻量的依赖注入，函数级别粒度
3. **自动文档替代手动注解**：代码即文档，维护成本更低
4. **原生 async 替代 Octane**：更自然的异步编程模型
5. **更灵活但更底层**：没有 Eloquent 那样的全家桶，需要自己组装

如果你正在考虑从 Laravel 迁移到 FastAPI，建议从以下步骤开始：
1. 先用 FastAPI 重写一个简单的 API 服务
2. 熟悉 Pydantic 的数据验证模式
3. 学习 SQLAlchemy 的 ORM 使用
4. 掌握依赖注入的最佳实践
5. 逐步将微服务中的 API 层迁移到 FastAPI

---

## 参考资料

- [FastAPI 官方文档](https://fastapi.tiangolo.com/)
- [Pydantic 官方文档](https://docs.pydantic.dev/)
- [SQLAlchemy 官方文档](https://docs.sqlalchemy.org/)
- [Uvicorn 官方文档](https://www.uvicorn.org/)
- [Laravel 官方文档](https://laravel.com/docs)

## 相关阅读

- [Go + gRPC 实战：高性能微服务间通信——Proto 定义、流式调用与 Laravel 集成](/post/go-grpc-proto-laravel/)
- [Python asyncio 深度实战：事件循环、协程调度与 aiohttp——PHP Fibers 开发者的异步编程对比](/post/python-asyncio-aiohttp-php-fibers/)
- [Swift Vapor 实战：用 Swift 写后端 API——与 Laravel 的架构对比与性能基准](/post/swift-vapor-api-laravel/)
