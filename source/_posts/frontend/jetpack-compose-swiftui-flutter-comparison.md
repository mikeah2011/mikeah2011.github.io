---

title: Jetpack Compose 实战：Android 声明式 UI 开发——与 SwiftUI/Flutter 的三端对比
keywords: [Jetpack Compose, Android, UI, SwiftUI, Flutter, 声明式, 的三端对比, 前端]
date: 2026-06-09 19:40:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Jetpack Compose
- SwiftUI
- Flutter
- 声明式
- Android
- 跨平台
- UI 框架对比
description: 深入实战 Jetpack Compose 声明式 UI 开发，从核心概念到完整项目构建，并与 SwiftUI、Flutter 进行横向对比，帮你选择最适合的跨平台方案。
---



## 前言

2025 年，声明式 UI 已经成为移动端开发的绝对主流。Jetpack Compose 作为 Android 官方推荐的声明式 UI 框架，已经从最初的实验阶段进化为成熟稳定的生产工具。与此同时，Apple 的 SwiftUI 和 Google 的 Flutter 也各自迭代到了新的大版本。

三者都在解决同一个问题：**如何用更少的代码、更直观的方式构建高质量的 UI**，但它们的设计哲学、实现机制和适用场景却有显著差异。

本文将从 Jetpack Compose 实战出发，手把手构建一个完整的 Android 应用，然后与 SwiftUI 和 Flutter 进行深度横向对比，帮助你做出技术选型决策。

---

## 一、声明式 UI 的核心思想

在进入实战之前，先理解声明式 UI 的本质：

**命令式 UI（传统 Android View）：**
```kotlin
// 手动操作 UI 节点
textView.text = "Hello"
textView.visibility = View.VISIBLE
button.isEnabled = false
```

**声明式 UI（Compose）：**
```kotlin
@Composable
fun Greeting(name: String) {
    var enabled by remember { mutableStateOf(true) }

    Column {
        Text(text = "Hello $name")
        Button(
            onClick = { enabled = !enabled },
            enabled = enabled
        ) {
            Text("Toggle")
        }
    }
}
```

声明式的核心是：**你描述 UI 应该是什么样子，框架负责如何更新**。状态变化时，框架自动计算差异并高效更新界面。

---

## 二、Jetpack Compose 核心概念

### 2.1 Composable 函数

`@Composable` 是 Compose 的基石注解，标记一个函数为 UI 组件：

```kotlin
@Composable
fun UserCard(
    user: User,
    onFollowClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(16.dp)
        ) {
            AsyncImage(
                model = user.avatarUrl,
                contentDescription = "Avatar",
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
            )

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = user.name,
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = "@${user.username}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            FollowButton(onClick = onFollowClick)
        }
    }
}
```

**关键点：**
- `@Composable` 函数没有返回值，它"发出"UI 元素而不是返回 View 对象
- `modifier` 参数是 Compose 的惯用模式，允许调用方自定义布局行为
- 参数使用不可变类型（`val`），便于 Compose 编译器优化重组

### 2.2 State 管理

Compose 的状态管理是整个框架的心脏：

```kotlin
@Composable
fun TodoListScreen(viewModel: TodoViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(title = { Text("Todo List") })
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { viewModel.showAddDialog() }) {
                Icon(Icons.Default.Add, "Add")
            }
        }
    ) { padding ->
        when (val state = uiState) {
            is TodoUiState.Loading -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
            is TodoUiState.Success -> {
                LazyColumn(
                    contentPadding = padding,
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(
                        items = state.todos,
                        key = { it.id }
                    ) { todo ->
                        TodoItem(
                            todo = todo,
                            onToggle = { viewModel.toggleTodo(todo.id) },
                            onDelete = { viewModel.deleteTodo(todo.id) }
                        )
                    }
                }
            }
            is TodoUiState.Error -> {
                ErrorContent(
                    message = state.message,
                    onRetry = { viewModel.retry() }
                )
            }
        }
    }
}
```

**状态层次：**
- `remember` / `mutableStateOf` — 局部 UI 状态（滚动位置、动画值等）
- `StateFlow` / `collectAsStateWithLifecycle` — ViewModel 持有的业务状态
- `SavedStateHandle` — 进程死亡后可恢复的状态

### 2.3 副作用 API

Compose 提供了专门的副作用 API 来处理生命周期相关操作：

```kotlin
@Composable
fun LocationScreen(viewModel: LocationViewModel = hiltViewModel()) {
    val context = LocalContext.current

    // LaunchedEffect: 在 Composable 进入组合时启动协程
    LaunchedEffect(Unit) {
        viewModel.loadInitialLocation()
    }

    // DisposableEffect: 需要清理资源时使用
    DisposableEffect(Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                viewModel.onNetworkChanged()
            }
        }
        context.registerReceiver(
            receiver,
            IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION)
        )
        onDispose {
            context.unregisterReceiver(receiver)
        }
    }

    // derivedStateOf: 从其他状态派生计算
    val sortedLocations by remember {
        derivedStateOf {
            viewModel.locations.sortedByDescending { it.timestamp }
        }
    }

    // snapshotFlow: 将 Compose State 转为 Flow
    LaunchedEffect(Unit) {
        snapshotFlow { sortedLocations }
            .distinctUntilChanged()
            .collect { locations ->
                analytics.track("locations_updated", locations.size)
            }
    }

    LocationList(locations = sortedLocations)
}
```

### 2.4 Navigation

Compose Navigation 是官方推荐的页面导航方案：

```kotlin
// 定义路由
sealed class Screen(val route: String) {
    object Home : Screen("home")
    object Profile : Screen("profile/{userId}") {
        fun createRoute(userId: String) = "profile/$userId"
    }
    object Settings : Screen("settings")
}

@Composable
fun AppNavGraph(navController: NavHostController = rememberNavController()) {
    NavHost(
        navController = navController,
        startDestination = Screen.Home.route
    ) {
        composable(Screen.Home.route) {
            HomeScreen(
                onUserClick = { userId ->
                    navController.navigate(Screen.Profile.createRoute(userId))
                },
                onSettingsClick = {
                    navController.navigate(Screen.Settings.route)
                }
            )
        }

        composable(
            route = Screen.Profile.route,
            arguments = listOf(
                navArgument("userId") { type = NavType.StringType }
            ),
            enterTransition = {
                slideIntoContainer(
                    AnimatedContentTransitionScope.SlideDirection.Left,
                    animationSpec = tween(300)
                )
            },
            exitTransition = {
                slideOutOfContainer(
                    AnimatedContentTransitionScope.SlideDirection.Left,
                    animationSpec = tween(300)
                )
            }
        ) { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: return@composable
            ProfileScreen(
                userId = userId,
                onBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onBack = { navController.popBackStack() }
            )
        }
    }
}
```

---

## 三、实战项目：构建一个完整的新闻阅读器

### 3.1 项目架构

采用 MVVM + Repository 模式，使用 Hilt 依赖注入：

```
app/
├── data/
│   ├── remote/
│   │   ├── NewsApi.kt
│   │   └── NewsRemoteDataSource.kt
│   ├── local/
│   │   ├── NewsDatabase.kt
│   │   ├── ArticleDao.kt
│   │   └── NewsLocalDataSource.kt
│   ├── repository/
│   │   └── NewsRepositoryImpl.kt
│   └── model/
│       └── Article.kt
├── domain/
│   ├── repository/
│   │   └── NewsRepository.kt
│   └── usecase/
│       ├── GetTopHeadlinesUseCase.kt
│       └── BookmarkArticleUseCase.kt
├── ui/
│   ├── home/
│   │   ├── HomeScreen.kt
│   │   └── HomeViewModel.kt
│   ├── detail/
│   │   ├── DetailScreen.kt
│   │   └── DetailViewModel.kt
│   ├── bookmark/
│   │   ├── BookmarkScreen.kt
│   │   └── BookmarkViewModel.kt
│   ├── components/
│   │   ├── ArticleCard.kt
│   │   ├── SearchBar.kt
│   │   └── CategoryChip.kt
│   └── theme/
│       ├── Theme.kt
│       ├── Color.kt
│       └── Type.kt
└── di/
    ├── AppModule.kt
    └── DatabaseModule.kt
```

### 3.2 数据层

**Retrofit API 定义：**

```kotlin
interface NewsApi {
    @GET("top-headlines")
    suspend fun getTopHeadlines(
        @Query("country") country: String = "us",
        @Query("category") category: String? = null,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 20,
        @Query("apiKey") apiKey: String = BuildConfig.NEWS_API_KEY
    ): NewsResponse

    @GET("everything")
    suspend fun searchNews(
        @Query("q") query: String,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 20,
        @Query("apiKey") apiKey: String = BuildConfig.NEWS_API_KEY
    ): NewsResponse
}

data class NewsResponse(
    val status: String,
    val totalResults: Int,
    val articles: List<ArticleDto>
)

data class ArticleDto(
    val source: SourceDto?,
    val author: String?,
    val title: String?,
    val description: String?,
    val url: String?,
    val urlToImage: String?,
    val publishedAt: String?,
    val content: String?
)
```

**Room 数据库：**

```kotlin
@Entity(tableName = "articles")
data class ArticleEntity(
    @PrimaryKey val url: String,
    val title: String,
    val description: String?,
    val imageUrl: String?,
    val author: String?,
    val sourceName: String?,
    val publishedAt: Long,
    val content: String?,
    val isBookmarked: Boolean = false,
    val cachedAt: Long = System.currentTimeMillis()
)

@Dao
interface ArticleDao {
    @Query("SELECT * FROM articles ORDER BY publishedAt DESC")
    fun getArticles(): PagingSource<Int, ArticleEntity>

    @Query("SELECT * FROM articles WHERE isBookmarked = 1 ORDER BY publishedAt DESC")
    fun getBookmarkedArticles(): Flow<List<ArticleEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(articles: List<ArticleEntity>)

    @Query("UPDATE articles SET isBookmarked = :bookmarked WHERE url = :url")
    suspend fun setBookmarked(url: String, bookmarked: Boolean)

    @Query("DELETE FROM articles WHERE cachedAt < :timestamp AND isBookmarked = 0")
    suspend fun deleteOldCache(timestamp: Long)
}
```

**Repository 实现：**

```kotlin
class NewsRepositoryImpl @Inject constructor(
    private val remoteDataSource: NewsRemoteDataSource,
    private val localDataSource: NewsLocalDataSource,
    @IoDispatcher private val dispatcher: CoroutineDispatcher
) : NewsRepository {

    override fun getTopHeadlines(category: String?): Flow<PagingData<Article>> {
        return Pager(
            config = PagingConfig(
                pageSize = 20,
                enablePlaceholders = false,
                prefetchDistance = 5
            ),
            remoteMediator = NewsRemoteMediator(
                remoteDataSource = remoteDataSource,
                localDataSource = localDataSource,
                category = category
            ),
            pagingSourceFactory = { localDataSource.getArticles() }
        ).flow
            .map { pagingData ->
                pagingData.map { it.toDomainModel() }
            }
            .flowOn(dispatcher)
    }

    override suspend fun toggleBookmark(article: Article) {
        withContext(dispatcher) {
            localDataSource.setBookmarked(article.url, !article.isBookmarked)
        }
    }

    override fun getBookmarkedArticles(): Flow<List<Article>> {
        return localDataSource.getBookmarkedArticles()
            .map { entities -> entities.map { it.toDomainModel() } }
            .flowOn(dispatcher)
    }
}
```

### 3.3 UI 层——核心页面

**文章列表页：**

```kotlin
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onArticleClick: (String) -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val headlines by viewModel.headlines.collectAsLazyPagingItems()
    val selectedCategory by viewModel.selectedCategory.collectAsStateWithLifecycle()
    val searchQuery by viewModel.searchQuery.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = { Text("News") },
                    actions = {
                        IconButton(onClick = { viewModel.toggleSearch() }) {
                            Icon(Icons.Default.Search, "Search")
                        }
                    }
                )

                // 搜索栏
                AnimatedVisibility(visible = viewModel.isSearchVisible) {
                    SearchBar(
                        query = searchQuery,
                        onQueryChange = viewModel::updateSearchQuery,
                        onSearch = { viewModel.search() },
                        active = false,
                        onActiveChange = {},
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        placeholder = { Text("Search articles...") },
                        leadingIcon = {
                            Icon(Icons.Default.Search, null)
                        }
                    ) {}
                }

                // 分类标签
                CategoryChips(
                    categories = viewModel.categories,
                    selected = selectedCategory,
                    onSelect = viewModel::selectCategory
                )
            }
        }
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding() + 16.dp,
                start = 16.dp,
                end = 16.dp
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(
                count = headlines.itemCount,
                key = headlines.itemKey { it.url }
            ) { index ->
                val article = headlines[index]
                article?.let {
                    ArticleCard(
                        article = it,
                        onClick = { onArticleClick(it.url) },
                        onBookmark = { viewModel.toggleBookmark(it) }
                    )
                }
            }

            // 加载状态
            when (val loadState = headlines.loadState.append) {
                is LoadState.Loading -> {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                }
                is LoadState.Error -> {
                    item {
                        RetryItem(
                            message = loadState.error.localizedMessage ?: "Load failed",
                            onRetry = { headlines.retry() }
                        )
                    }
                }
                is LoadState.NotLoading -> Unit
            }
        }
    }
}
```

**文章卡片组件：**

```kotlin
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleCard(
    article: Article,
    onClick: () -> Unit,
    onBookmark: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column {
            // 图片
            article.imageUrl?.let { url ->
                AsyncImage(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(url)
                        .crossfade(true)
                        .build(),
                    contentDescription = article.title,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp),
                    contentScale = ContentScale.Crop,
                    placeholder = ColorPainter(MaterialTheme.colorScheme.surfaceVariant)
                )
            }

            Column(modifier = Modifier.padding(16.dp)) {
                // 来源和时间
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    article.sourceName?.let { name ->
                        Text(
                            text = name,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    Text(
                        text = article.publishedAt.toRelativeTime(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // 标题
                Text(
                    text = article.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                // 描述
                article.description?.let { desc ->
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = desc,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // 底部操作栏
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    IconButton(
                        onClick = onBookmark,
                        modifier = Modifier.size(36.dp)
                    ) {
                        Icon(
                            imageVector = if (article.isBookmarked) {
                                Icons.Filled.Bookmark
                            } else {
                                Icons.Outlined.BookmarkBorder
                            },
                            contentDescription = "Bookmark",
                            tint = if (article.isBookmarked) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                    }
                }
            }
        }
    }
}
```

### 3.4 ViewModel

```kotlin
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val getTopHeadlines: GetTopHeadlinesUseCase,
    private val bookmarkArticle: BookmarkArticleUseCase
) : ViewModel() {

    private val _selectedCategory = MutableStateFlow<String?>(null)
    val selectedCategory = _selectedCategory.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery = _searchQuery.asStateFlow()

    private val _isSearchVisible = MutableStateFlow(false)
    val isSearchVisible = _isSearchVisible.asStateFlow()

    val categories = listOf(
        "general", "business", "technology",
        "science", "health", "sports", "entertainment"
    )

    val headlines: Flow<PagingData<Article>> = _selectedCategory
        .flatMapLatest { category ->
            getTopHeadlines(category)
        }
        .cachedIn(viewModelScope)

    fun selectCategory(category: String?) {
        _selectedCategory.value = if (_selectedCategory.value == category) null else category
    }

    fun toggleSearch() {
        _isSearchVisible.value = !_isSearchVisible.value
    }

    fun updateSearchQuery(query: String) {
        _searchQuery.value = query
    }

    fun search() {
        // 触发搜索逻辑
    }

    fun toggleBookmark(article: Article) {
        viewModelScope.launch {
            bookmarkArticle(article)
        }
    }
}
```

### 3.5 主题和 Material 3

```kotlin
// Color.kt
val Purple80 = Color(0xFFD0BCFF)
val PurpleGrey80 = Color(0xFFCCC2DC)
val Pink80 = Color(0xFFEFB8C8)

val Purple40 = Color(0xFF6650a4)
val PurpleGrey40 = Color(0xFF625b71)
val Pink40 = Color(0xFF7D5260)

// Theme.kt
@Composable
fun NewsAppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context)
            else dynamicLightColorScheme(context)
        }
        darkTheme -> darkColorScheme(
            primary = Purple80,
            secondary = PurpleGrey80,
            tertiary = Pink80
        )
        else -> lightColorScheme(
            primary = Purple40,
            secondary = PurpleGrey40,
            tertiary = Pink40
        )
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
```

---

## 四、Compose 进阶技巧

### 4.1 自定义 Layout

当标准布局满足不了需求时，可以自定义 Layout：

```kotlin
@Composable
fun StaggeredGrid(
    modifier: Modifier = Modifier,
    columns: Int = 2,
    content: @Composable () -> Unit
) {
    Layout(
        modifier = modifier,
        content = content
    ) { measurables, constraints ->
        val columnWidth = constraints.maxWidth / columns
        val columnHeights = IntArray(columns) { 0 }

        val placeables = measurables.map { measurable ->
            val placeable = measurable.measure(
                constraints.copy(maxWidth = columnWidth)
            )
            placeable
        }

        val totalHeight = constraints.maxHeight

        layout(constraints.maxWidth, totalHeight) {
            placeables.forEach { placeable ->
                val shortestColumn = columnHeights.indices.minByOrNull {
                    columnHeights[it]
                } ?: 0

                placeable.placeRelative(
                    x = shortestColumn * columnWidth,
                    y = columnHeights[shortestColumn]
                )
                columnHeights[shortestColumn] += placeable.height
            }
        }
    }
}
```

### 4.2 动画系统

Compose 提供了强大的动画 API：

```kotlin
@Composable
fun AnimatedFavoriteButton(
    isFavorite: Boolean,
    onClick: () -> Unit
) {
    val scale by animateFloatAsState(
        targetValue = if (isFavorite) 1.2f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        ),
        label = "scale"
    )

    val color by animateColorAsState(
        targetValue = if (isFavorite) Color.Red else Color.Gray,
        animationSpec = tween(durationMillis = 300),
        label = "color"
    )

    IconButton(
        onClick = onClick,
        modifier = Modifier.scale(scale)
    ) {
        Icon(
            imageVector = if (isFavorite) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
            contentDescription = "Favorite",
            tint = color
        )
    }
}

// AnimatedVisibility 用于显示/隐藏动画
@Composable
fun ExpandableCard(title: String, content: String) {
    var expanded by remember { mutableStateOf(false) }

    Card(
        onClick = { expanded = !expanded },
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)

            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Text(
                    text = content,
                    modifier = Modifier.padding(top = 8.dp),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}
```

---

## 五、Compose vs SwiftUI vs Flutter 三端深度对比

### 5.1 设计哲学

| 维度 | Jetpack Compose | SwiftUI | Flutter |
|------|----------------|---------|---------|
| 语言 | Kotlin | Swift | Dart |
| 渲染引擎 | Android Canvas/Skia | UIKit/Core Animation | Skia (自绘) |
| 平台策略 | Android 专属 | Apple 生态专属 | 跨平台自绘 |
| 学习曲线 | 中等 | 低（Swift 生态内） | 中等 |
| 发布时间 | 2021 (1.0) | 2019 | 2018 |

### 5.2 代码对比：同一个列表页

**Jetpack Compose：**
```kotlin
@Composable
fun ArticleList(articles: List<Article>) {
    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(16.dp)
    ) {
        items(articles, key = { it.id }) { article ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(article.title, style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(article.summary, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
```

**SwiftUI：**
```swift
struct ArticleList: View {
    let articles: [Article]

    var body: some View {
        List(articles) { article in
            VStack(alignment: .leading, spacing: 4) {
                Text(article.title)
                    .font(.headline)
                Text(article.summary)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.vertical, 8)
        }
        .listStyle(.plain)
    }
}
```

**Flutter：**
```dart
class ArticleList extends StatelessWidget {
  final List<Article> articles;

  const ArticleList({super.key, required this.articles});

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: articles.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final article = articles[index];
        return Card(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  article.title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 4),
                Text(
                  article.summary,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
```

### 5.3 状态管理对比

**Compose (ViewModel + StateFlow)：**
```kotlin
class CounterViewModel : ViewModel() {
    private val _count = MutableStateFlow(0)
    val count = _count.asStateFlow()

    fun increment() { _count.value++ }
}

@Composable
fun CounterScreen(viewModel: CounterViewModel = viewModel()) {
    val count by viewModel.count.collectAsStateWithLifecycle()
    Button(onClick = { viewModel.increment() }) {
        Text("Count: $count")
    }
}
```

**SwiftUI (ObservableObject)：**
```swift
@Observable
class CounterViewModel {
    var count = 0
    func increment() { count += 1 }
}

struct CounterScreen: View {
    @State private var viewModel = CounterViewModel()

    var body: some View {
        Button("Count: \(viewModel.count)") {
            viewModel.increment()
        }
    }
}
```

**Flutter (Riverpod)：**
```dart
final counterProvider = StateNotifierProvider<CounterNotifier, int>((ref) {
  return CounterNotifier();
});

class CounterNotifier extends StateNotifier<int> {
  CounterNotifier() : super(0);
  void increment() => state++;
}

class CounterScreen extends ConsumerWidget {
  const CounterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(counterProvider);
    return ElevatedButton(
      onPressed: () => ref.read(counterProvider.notifier).increment(),
      child: Text('Count: $count'),
    );
  }
}
```

### 5.4 性能对比

| 场景 | Compose | SwiftUI | Flutter |
|------|---------|---------|---------|
| 列表滚动（万级） | 优秀 (LazyColumn) | 良好 (List) | 优秀 (ListView.builder) |
| 首帧渲染 | 中等（首次重组开销） | 快 | 中等（JIT/编译） |
| 内存占用 | 中等 | 低 | 较高（Dart VM） |
| 动画流畅度 | 60fps 稳定 | 60fps 稳定 | 120fps 支持 |
| 包体积增量 | ~1-2 MB | 0 (系统内置) | ~4-5 MB |

### 5.5 生态和工具链

| 维度 | Compose | SwiftUI | Flutter |
|------|---------|---------|---------|
| IDE 支持 | Android Studio (优秀) | Xcode (优秀) | VS Code / Android Studio |
| 预览 | @Preview 实时 | Canvas 预览 | Hot Reload (秒级) |
| 状态管理 | 官方无强制方案 | 原生支持 | Provider/Riverpod/Bloc |
| 网络层 | Retrofit + OkHttp (Kotlin) | URLSession / Alamofire | Dio / http |
| DI | Hilt (官方推荐) | 手动 / Resolver | get_it / Riverpod |
| 测试 | JUnit + Compose Testing | XCTest | Flutter Test |
| 社区包量 | 中等（增长快） | 中等 | 丰富（pub.dev） |
| 稳定性评级 | 生产就绪 | 生产就绪 | 生产就绪 |

### 5.6 如何选择？

**选 Jetpack Compose 当：**
- 目标是纯 Android 应用
- 团队已有 Kotlin/JVM 经验
- 需要深度集成 Android 生态（WorkManager、Media3、CameraX）
- 已有 Android View 代码需要渐进迁移

**选 SwiftUI 当：**
- 目标是纯 Apple 生态（iOS + macOS + watchOS）
- 团队是 Swift 原生开发
- App 相对简单或中等复杂度
- 利用 Apple 原生能力（HealthKit、Core ML、WidgetKit）

**选 Flutter 当：**
- 需要一套代码覆盖 iOS + Android + Web + Desktop
- UI 一致性要求高（品牌定制化界面）
- 团队愿意接受 Dart 语言
- 追求快速原型和迭代

**混合方案（实际最常见的选择）：**
- 核心业务逻辑用 Kotlin Multiplatform (KMP) 共享
- Android UI 用 Compose，iOS UI 用 SwiftUI
- 共享网络层、数据模型、业务规则

---

## 六、踩坑记录

### 坑 1：重组性能问题

```kotlin
// ❌ 错误：每次重组都会创建新的 lambda 实例
@Composable
fun BadExample(viewModel: MyViewModel) {
    viewModel.items.forEach { item ->
        Button(onClick = { viewModel.doSomething(item) }) {
            Text(item.name)
        }
    }
}

// ✅ 正确：使用 remember 缓存 lambda
@Composable
fun GoodExample(viewModel: MyViewModel) {
    viewModel.items.forEach { item ->
        val onClick = remember(item.id) { { viewModel.doSomething(item) } }
        Button(onClick = onClick) {
            Text(item.name)
        }
    }
}
```

### 坑 2：LazyColumn 的 key 问题

```kotlin
// ❌ 错误：用 index 作为 key，数据变化时动画错乱
itemsIndexed(items) { index, item ->
    ItemRow(item) // key 隐式使用 index
}

// ✅ 正确：使用稳定的唯一标识
items(items, key = { it.id }) { item ->
    ItemRow(item)
}
```

### 坑 3：SideEffect 中的生命周期

```kotlin
// ❌ 错误：在 composable 函数体中直接发起网络请求
@Composable
fun Bad() {
    val data = api.fetchData() // 每次重组都会执行！
    Text(data)
}

// ✅ 正确：使用 LaunchedEffect
@Composable
fun Good() {
    var data by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        data = api.fetchData() // 只执行一次
    }
    Text(data)
}
```

### 坑 4：Navigation 参数丢失

```kotlin
// ❌ 错误：传递复杂对象会导致序列化失败
navController.navigate(Screen.Detail(article))

// ✅ 正确：只传 ID，目标页面自己加载数据
navController.navigate(Screen.Detail.createRoute(article.id))
```

---

## 七、从传统 View 迁移到 Compose

迁移不需要一步到位，可以渐进进行：

```kotlin
// 1. 在 XML 中嵌入 Compose
class ArticleFragment : Fragment() {
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return ComposeView(requireContext()).apply {
            setContent {
                NewsAppTheme {
                    ArticleScreen(viewModel = viewModel)
                }
            }
        }
    }
}

// 2. 在 Compose 中嵌入传统 View
@Composable
fun LegacyMap(latLng: LatLng) {
    AndroidView(
        factory = { context ->
            MapView(context).apply {
                onCreate(Bundle())
                getMapAsync { map ->
                    map.addMarker(
                        MarkerOptions().position(latLng)
                    )
                }
            }
        },
        update = { mapView ->
            // 处理状态更新
        }
    )
}
```

---

## 总结

Jetpack Compose 经过几年的迭代，已经成为 Android 开发的首选 UI 框架。它的核心优势在于：

1. **与 Android 生态深度集成** — 无需桥接层，直接使用所有 Android API
2. **Kotlin 语言优势** — 协程、扩展函数、DSL 让代码更简洁
3. **强大的预览和工具链** — Android Studio 的实时预览体验一流
4. **渐进迁移友好** — 可以和传统 View 系统共存

与 SwiftUI 相比，Compose 的跨平台野心更大（Compose Multiplatform 已支持 iOS/Desktop/Web），与 Flutter 相比，Compose 在原生性能和系统集成方面更有优势。

技术选型没有银弹，关键是根据团队背景、项目需求和长期维护成本来决策。但如果你在做 Android 开发，Compose 毫无疑问是当前最值得投入的方向。

---

**参考资料：**
- [Jetpack Compose 官方文档](https://developer.android.com/jetpack/compose)
- [Compose Multiplatform](https://www.jetbrains.com/lp/compose-multiplatform/)
- [SwiftUI 官方文档](https://developer.apple.com/xcode/swiftui/)
- [Flutter 官方文档](https://flutter.dev/docs)
