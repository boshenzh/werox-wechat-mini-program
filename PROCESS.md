
## 数据库迁移记录 (2026-02-05)

### 从 NoSQL 迁移到 SQL (MySQL)

**环境信息:**
- CloudBase 环境 ID: `werox-mini-program-8die4bd982524`
- 数据库类型: MySQL 关系型数据库

**新的数据库表结构 (5 张表):**

1. **users** - 用户信息表
   - `id` (主键), `openid` (唯一), `_openid`, `nickname`, `avatar_file_id`, `sex`, `birth_year`, `role` (runner/organizer/admin), `hyrox_level`, `best_hyrox_time`, `races_completed`, `preferred_division`, `training_focus`, `max_heart_rate`, `weekly_training_hours`, `seeking_partner`, `preferred_partner_role`, `partner_note`, `mbti`, `tags` (JSON), `bio`, `wechat_id`, `phone`, `created_at`, `updated_at`
   - 安全规则: PRIVATE

2. **events** - 赛事信息表
   - `id` (主键), `_openid`, `title`, `slug`, `description`, `event_type`, `event_date`, `event_time`, `location`, `latitude` (DECIMAL 10,7), `longitude` (DECIMAL 10,7), `venue_name`, `organizer_id`, `organizer_name`, `format_mode` (for_time/time_cap/amrap/emom/rounds), `time_cap_minutes`, `total_rounds`, `use_standard_hyrox`, `available_divisions` (JSON), `status`, `registration_start`, `registration_end`, `max_participants`, `price_open`, `price_doubles`, `price_relay`, `cover_url`, `poster_url`, `base_strength`, `base_endurance`, `created_at`, `updated_at`
   - 安全规则: READONLY

3. **event_stations** - 赛事站点配置表
   - `id` (主键), `_openid`, `event_id` (外键), `station_order`, `station_name`, `station_description`, `target_type` (distance/reps/time/calories), `target_value`, `target_unit`, `weight_male_kg`, `weight_female_kg`, `weight_note`, `equipment_note`, `rest_after_seconds`, `created_at`, `updated_at`
   - 安全规则: READONLY

4. **event_participants** - 报名记录表
   - `id` (主键), `_openid`, `event_id` (外键), `user_openid`, `division`, `age_group`, `team_name`, `partner_openids` (JSON), `partner_names` (JSON), `event_title`, `event_date`, `event_location`, `user_nickname`, `user_wechat_id`, `user_sex`, `user_avatar_file_id`, `wave_number`, `start_time`, `bib_number`, `payment_status`, `payment_amount`, `paid_at`, `finish_time`, `total_rounds_completed`, `total_reps_completed`, `finish_rank_overall`, `finish_rank_division`, `finish_rank_age_group`, `dnf`, `base_strength`, `base_endurance`, `coach_adjust_strength`, `coach_adjust_endurance`, `final_strength`, `final_endurance`, `note`, `created_at`, `updated_at`
   - 安全规则: PRIVATE

5. **participant_splits** - 分段成绩表
   - `id` (主键), `_openid`, `participant_id` (外键), `station_id` (外键), `round_number`, `split_time`, `cumulative_time`, `reps_completed`, `created_at`
   - 安全规则: PRIVATE

**管理员用户:**
- openid: `ozE5v3Two0JZBRbEMq22vgcgz-Es`
- role: `admin`

**代码变更:**

1. **app.js** - 添加了 `@cloudbase/wx-cloud-client-sdk` 初始化，提供 `getApp().globalData.getDB()` 方法
2. **utils/user.js** - 重写为 SQL 版本，使用 Supabase 风格 API
3. **utils/roles.js** - 已删除（角色现在从数据库读取）
4. **pages/profile/profile.js** - 改用 SQL 查询
5. **pages/events/events.js** - 改用 SQL 查询
6. **pages/event-detail/event-detail.js** - 改用 SQL 查询，新增站点列表加载
7. **pages/event-signup/event-signup.js** - 改用 SQL 查询，支持组别选择
8. **pages/admin-events/admin-events.js** - 改用 SQL 查询，新增站点配置管理

**使用 SQL 数据库的方式:**
```javascript
const db = await getApp().globalData.getDB();

// 查询
const { data, error } = await db
  .from('table_name')
  .select('*')
  .eq('column', value)
  .order('column', { ascending: true });

// 插入
await db.from('table_name').insert({ ... });

// 更新
await db.from('table_name').update({ ... }).eq('id', id);

// 删除
await db.from('table_name').delete().eq('id', id);
```

**注意事项:**
- 所有表都有 `_openid` 字段用于 CloudBase 权限控制
- JSON 字段（如 tags, available_divisions）需要用 `JSON.stringify()` 存储
- 价格单位为「分」（避免浮点数精度问题）
- 图片存储在云存储，数据库只存 fileID

---

## 地图功能 (2026-02-05)

### 赛事地点选择与展示

**功能说明:**
1. **管理员创建赛事时**: 点击「地点」字段会调用 `wx.chooseLocation()` 打开微信地图选择器
2. **选手查看赛事详情时**: 显示「集合地点」卡片，包含小地图预览，点击可调用 `wx.openLocation()` 打开导航

**数据库字段:**
- `events.latitude` - 纬度 (DECIMAL 10,7)
- `events.longitude` - 经度 (DECIMAL 10,7)

**权限配置 (app.json):**
```json
{
  "permission": {
    "scope.userLocation": {
      "desc": "用于选择赛事集合地点"
    }
  },
  "requiredPrivateInfos": [
    "chooseLocation",
    "getLocation"
  ]
}
```

**相关文件:**
- `pages/admin-events/admin-events.js` - `chooseLocation()` 方法
- `pages/event-detail/event-detail.js` - `openLocation()` 方法
- `assets/icons/location.png` - 地点图标

---

## 小程序性能优化记录 (2026-02-06)

### 背景问题

- 开发者工具编译和热更新偏慢
- 赛事列表页每次 `onShow` 都全量加载，首屏等待长

### 已完成优化

1. **编译配置优化（开发态提速）**
   - `project.config.json`:
     - `setting.minified: false`
     - `setting.minifyWXML: false`
   - `packOptions.ignore` 新增忽略项：
     - `node_modules/`
     - `scripts/`
     - `prefill_users.json`
     - `prefill_users.jsonl`
     - `prefill_users_clean.jsonl`

2. **页面代码拆包加载**
   - `app.json` 增加：`"lazyCodeLoading": "requiredComponents"`

3. **赛事页数据请求优化** (`pages/events/events.js`)
   - 事件查询从 `select('*')` 改为只取列表页必需字段
   - 参赛者查询增加按 `event_id` 的定向查询（支持 `.in` 时）
   - 封面图与头像 URL 解析合并为一次 `getTempFileURL` 批量调用
   - 新增位置缓存（3 分钟 TTL），避免重复请求定位权限
   - 新增页面数据缓存窗口（30 秒），避免频繁 `onShow` 重拉
   - 增加并发保护，避免重复触发 `loadEvents` 并行请求

### 预期效果

- 开发态编译速度明显提升
- 切换 tab 返回赛事页时卡顿减少
- 云数据库与云存储请求次数下降

---

## MCP 基础设施配置记录 (2026-02-06)

### 目标

- 为 CloudBase 知识库与平台工具启用统一 MCP Server：`cloudbase_com_cn`
- 解决会话内 `unknown MCP server 'cloudbase_com_cn'` 问题

### 已完成

1. **项目级 MCP 配置升级**
   - 文件：`.mcp.json`
   - Server 名称：`cloudbase_com_cn`
   - 启动命令调整为：
     - `npx -y @cloudbase/cloudbase-mcp@latest`

2. **全局 Codex 配置方案确定**
   - 需要在 `~/.codex/config.toml` 增加 `[mcp_servers.cloudbase_com_cn]`
   - 需要将项目信任级别设为 `trusted`，避免 MCP 进程加载受限

### 验证与注意事项

- MCP 配置变更后，需要**重启 Codex 会话**再验证 `list_mcp_resources`。
- 若网络导致 `npx` 拉包失败，可改为预装后再指向全局可执行路径。

---

## 跨端后端方案复盘（知识库调研，2026-02-06）

### 调研方式

- 通过 CloudBase MCP `searchKnowledgeBase` 调研：
  - `cloudbase-platform`
  - `miniprogram-development`
  - `cloudrun-development`
  - `auth-wechat`
  - `auth-tool`
  - `relational-database-tool`
  - OpenAPI：`auth`、`cloudrun`、`mysqldb`

### 关键结论

1. **小程序与 iOS 可共后端，但调用链路不同**
   - 小程序：`wx.cloud.callContainer`（可携带可信用户头）
   - iOS：CloudBase HTTP API + Bearer Token

2. **小程序调用 CloudRun 可直接拿可信身份**
   - 后端可从请求头读取 `x-wx-openid`、`x-wx-unionid`、`x-cloudbase-context`
   - 可减少重复鉴权逻辑

3. **iOS 统一接入 Auth v2**
   - 重点接口：
     - `/auth/v1/provider/token`
     - `/auth/v1/signin/with/provider`
     - `/auth/v1/token`、`/auth/v1/token/introspect`
     - `/auth/v1/user/me`

4. **CloudRun 统一网关入口**
   - OpenAPI 主路径：`/v1/cloudrun/{name}/{anyPath}`
   - 适合作为单一 BFF 对外暴露业务 API

5. **数据库统一策略**
   - MySQL REST 主路径：`/v1/rdb/rest/{table}`
   - 业务侧坚持 `user_id` 作为主关联键，`openid/unionid` 仅做身份映射字段

### 对原方案的修正

- 保留“统一 CloudRun BFF”方向；
- 增加“小程序内网 `callContainer` 直接携带身份”的实现路线，减少前端 token 分发复杂度；
- iOS 端明确走 Auth v2 + HTTP API，不复用小程序端直连模型。

---

## 页面重构记录（2026-02-06）

### 目标

- 按 UI/UX 设计思路重做：
  - 赛事创建页（创建与编辑流程）
  - 个人资料页（创建与编辑流程）

### 已完成

1. **赛事创建页重构**（`pages/admin-events/admin-events.wxml`, `pages/admin-events/admin-events.wxss`）
   - 新增“赛事创建工作台”顶部摘要和进度条（核心必填项完成度）。
   - 表单重组为 5 个步骤分区，强化任务流和信息分层。
   - 站点配置、图文详情、报名强度等保留原业务字段与交互能力。
   - 赛事列表卡片样式重构，状态展示更清晰。

2. **个人资料页重构**（`pages/profile/profile.wxml`, `pages/profile/profile.wxss`）
   - 新增“浏览态 + 编辑态”双态结构，编辑态独立为资料工作台。
   - 顶部强化个人信息识别（角色、资料完成度、标签）。
   - 编辑表单按“基础信息 / 训练偏好 / 联系方式简介”分组。
   - 保留头像上传、昵称更新、微信号匹配与保存逻辑。

### 验证

- 本次为页面结构与样式重构，未改动数据库表结构与核心保存接口。
- 已做静态检查：
  - 关键 `bind*` 事件与现有 JS 方法对应。
  - WXSS 花括号与基础语法完整。
- 待你在微信开发者工具中做最终视觉与交互回归（含真机）。

---

## 统一后端实现记录（2026-02-06）

### 本次交付

1. **CloudRun BFF 服务落地**
   - 新目录：`cloudrun/werox-bff/`
   - 新文件：
     - `index.js`（身份解析 + 用户/赛事/报名核心 API）
     - `package.json`
     - `Dockerfile`
     - `.env.example`
     - `README.md`

2. **小程序后端调用封装**
   - 新增 `utils/backend.js`：统一 `callContainer` 封装
   - 新增 `utils/api.js`：业务 API 封装（me/events/registration/user）
   - `app.js` 新增全局配置：
     - `cloudEnv`
     - `backendServiceName`

3. **核心页面切换到 BFF API**
   - `pages/events/events.js`：赛事列表改走 `/v1/events`
   - `pages/event-detail/event-detail.js`：详情改走 `/v1/events/:id`
   - `pages/event-signup/event-signup.js`：报名改走 `/v1/events/:id/registrations`
   - `pages/profile/profile.js`：个人资料读写改走 `/v1/me` 与 `/v1/me/profile`

4. **身份统一迁移脚本**
   - 新增 `scripts/sql/20260206_identity_unification.sql`
   - 包含：
     - `app_users`、`identity_links` 建表
     - `users.user_id`、`event_participants.user_id` 补列与回填
     - 旧 `openid` 映射到新 `user_id`

### BFF API（第一版）

- `GET /health`
- `POST /v1/auth/mini/resolve`
- `POST /v1/auth/ios/wechat/signin`
- `GET /v1/me`
- `PATCH /v1/me/profile`
- `GET /v1/events`
- `GET /v1/events/:id`
- `GET /v1/events/:id/registration/me`
- `POST /v1/events/:id/registrations`
- `GET /v1/users/by-openid/:openid`

### 验证

- 已完成语法检查：
  - `node --check cloudrun/werox-bff/index.js`
  - `node --check utils/backend.js`
  - `node --check utils/api.js`
  - `node --check utils/user.js`
  - `node --check pages/events/events.js`
  - `node --check pages/event-detail/event-detail.js`
  - `node --check pages/event-signup/event-signup.js`
  - `node --check pages/profile/profile.js`

### 注意事项

- 当前代码已完成“核心链路 API 化”，但正式可用依赖以下条件：
  1. 部署 `cloudrun/werox-bff` 到云托管（服务名与 `backendServiceName` 一致）
  2. 配置 BFF 环境变量（`TCB_ENV_ID` / `TCB_API_KEY` 等）
  3. 执行 `scripts/sql/20260206_identity_unification.sql`
  4. 在云托管访问策略中允许小程序 `callContainer`

---

## Profile 标签单选 + 编辑页重组（2026-02-06）

### 目标

- 将个人标签从自由输入改为预设可选，提升资料一致性。
- 解决编辑页面信息拥挤问题，提升填写效率。

### 已完成

1. **标签能力重构**（`pages/profile/profile.js`）
   - 新增预设标签列表：
     - `#PACER（心肺担当）`
     - `Ranger（六边形）`
     - `Support（战术辅助）`
     - `TANK（力量担当）`
   - 新增 `selectedTag` 状态与 `handleTagSelect` 单选逻辑。
   - 保存时将 `tags` 统一归一为 `[]` 或 `[selectedTag]`。
   - 兼容读取历史 tags（数组/字符串），并自动映射到预设标签。

2. **编辑页结构优化**（`pages/profile/profile.wxml`）
   - 将编辑区重组为三段：基础信息、训练与参赛偏好、联系方式与简介。
   - 替换原标签输入框为标签芯片单选区。
   - 编辑态增加独立操作区（保存资料 / 取消编辑）。
   - 编辑时隐藏训练评分、参赛记录、管理员卡片，减少干扰。

3. **样式整理**（`pages/profile/profile.wxss`）
   - 新增标签芯片样式与激活态样式。
   - 新增基础信息双列区与编辑操作区样式。
   - 调整编辑提示区布局，减少视觉噪音。

### 验证

- 语法检查通过：`node --check pages/profile/profile.js`
- 关键事件绑定已对应现有方法（标签选择、保存、取消、picker/input）。

---

## 核心 4 页视觉升级（2026-02-06）

### 目标

- 提升核心路径页面的整体质感与信息清晰度，统一视觉语言。
- 保持业务逻辑不变，仅做结构与样式层优化。

### 本次范围

1. `pages/events/events.wxml` + `pages/events/events.wxss`
2. `pages/event-detail/event-detail.wxml` + `pages/event-detail/event-detail.wxss`
3. `pages/event-signup/event-signup.wxml` + `pages/event-signup/event-signup.wxss`
4. `pages/profile/profile.wxss`
5. `app.wxss`（全局视觉基元优化）

### 已完成

1. **全局设计基元优化**
   - 优化字体回退栈（HarmonyOS Sans SC + PingFang SC）。
   - 调整卡片层次、边框对比、主次按钮质感。
   - 统一空状态视觉组件表现。

2. **赛事列表页优化**
   - Hero 区新增主题文案层，品牌信息更完整。
   - 卡片封面与状态徽章、报名胶囊、元信息层级更清晰。
   - 强度/耐力条对比度与可读性提升。

3. **赛事详情页优化**
   - 封面区增加活动类型角标与状态视觉强化。
   - 报名信息区新增“已报名”实时数量展示。
   - 站点、亮点、选手弹层、底部操作条统一升级。

4. **报名页优化**
   - 卡片层次重排（赛事摘要 / 用户资料 / 报名表单）。
   - 表单增加引导头与当前选择提示，提交反馈更明确。

5. **个人页视觉精修**
   - 保持既有编辑逻辑，统一到同一套高级感视觉风格。
   - 优化英雄区、编辑区、统计区、认证弹窗视觉一致性。

### 验证

- JS 语法检查通过：
  - `node --check pages/events/events.js`
  - `node --check pages/event-detail/event-detail.js`
  - `node --check pages/event-signup/event-signup.js`
  - `node --check pages/profile/profile.js`
- 业务接口/数据结构未改动，属 UI-only 更新。

---

## 统一身份迁移执行记录（2026-02-06）

### 已实际执行（线上 MySQL）

1. 建表
   - `app_users`
   - `identity_links`

2. 旧表补列与索引
   - `users.user_id` + `uk_users_user_id` + `idx_users_openid`
   - `event_participants.user_id` + `idx_participants_user_id` + `idx_participants_event_user`

3. 数据回填
   - `app_users` 从 `users.openid` 初始化
   - `users.user_id` 根据 `app_users._openid` 回填
   - `identity_links` 写入 `provider=wechat_mini`
   - `event_participants.user_id` 由 `users.openid -> users.user_id` 回填

4. 校验结果（当前环境）
   - `app_users_count = 1`
   - `identity_links_count = 1`
   - `users.id=1` 已关联 `user_id=1`
   - `event_participants.id=1` 已关联 `user_id=1`

5. 新表安全规则
   - `app_users`：已写入 `ADMINONLY`
   - `identity_links`：已写入 `ADMINONLY`

### 云托管部署状态

- 使用 `manageCloudRun deploy` 部署 `werox-bff` 时，返回：
  - `CreateCloudRunServer: 云托管资源未开通`
- 结论：当前环境 `werox-mini-program-8die4bd982524` 尚未开通 CloudRun，BFF 线上部署被阻塞。

### 待完成项（阻塞解除后）

1. 开通云托管资源后重新部署 `cloudrun/werox-bff`
2. 补充服务环境变量：
   - `TCB_ENV_ID`
   - `TCB_API_KEY`
   - （可选）`TCB_AUTH_CLIENT_ID` / `TCB_AUTH_CLIENT_SECRET` / `TCB_AUTH_PROVIDER_ID`
3. 部署后验证：
   - `GET /health`
   - 小程序赛事列表、赛事详情、报名、我的资料链路
   - iOS 登录换 token + `/v1/me` 数据一致性

---

## INVALID_HOST 热修复记录（2026-02-06）

### 问题现象

- 小程序进入 `profile/events` 页报错：
  - `Invalid host (INVALID_HOST)`
- 报错点来自 `utils/backend.js` 的 `callContainer` 返回 4xx。

### 根因

- 当前环境 `werox-mini-program-8die4bd982524` 尚未开通 CloudRun。
- 页面已改为统一走 `werox-bff`，但服务不存在时会触发 `INVALID_HOST`。

### 修复方案

- 在 `utils/api.js` 增加“BFF 优先 + 自动降级”机制：
  1. 先请求 BFF；
  2. 若命中 `INVALID_HOST/SERVICE_NOT_FOUND/SERVICE_ENDPOINT_NOT_FOUND`，自动回退本地数据通道。
- 回退通道实现：
  - 身份：`wx.cloud.callFunction({ name: 'getOpenId' })`
  - 数据：`getApp().globalData.getDB().from(...)` 直连 SQL
- 回退覆盖接口：
  - `resolveMiniIdentity`
  - `getMe`
  - `updateMyProfile`
  - `listEvents`
  - `getEventDetail`
  - `getMyRegistration`
  - `createRegistration`
  - `getUserByOpenid`

### 验证

- 语法检查通过：
  - `node --check utils/api.js`
  - `node --check utils/user.js`
  - `node --check pages/profile/profile.js`
  - `node --check pages/events/events.js`
  - `node --check pages/event-detail/event-detail.js`
  - `node --check pages/event-signup/event-signup.js`
- 云函数检查：
  - `getOpenId` 在线且状态 `Active`。

### 结果

- 不开通 CloudRun 的情况下，小程序核心链路可继续运行。
- 后续 CloudRun 开通并部署 `werox-bff` 后，自动恢复统一后端路径，无需改页面。

---

## Profile 交互修复记录（2026-02-06）

### 目标

- 删除个人页浏览态中的「训练评分」区块。
- 让「参赛记录」支持点击跳转到对应赛事详情页。

### 实施

1. 页面结构调整（`pages/profile/profile.wxml`）
   - 移除 `训练评分` 卡片（强度/耐力展示）。
   - 为每条参赛记录增加点击事件与 `eventId` 数据绑定。

2. 交互逻辑调整（`pages/profile/profile.js`）
   - 参赛记录映射时显式提取 `event_id -> eventId`。
   - 新增 `handleAttendanceTap`：
     - 有 `eventId` 时跳转 `/pages/event-detail/event-detail?id=...`。
     - 无 `eventId` 时提示「该记录缺少赛事信息」。
   - 清理训练评分相关前端状态与计算逻辑（不再展示该区块）。

3. 样式微调（`pages/profile/profile.wxss`）
   - 删除训练评分相关样式。
   - 为参赛记录点击态增加 `attendance-item-hover` 反馈。

### 验证

- 通过静态检查确保：
  - 页面无 `训练评分` 文案残留；
  - `参赛记录` 行具备点击绑定；
  - JS 中无已删除评分状态的遗留引用。

---

## Profile 参赛记录跳转兜底修复（2026-02-06）

### 问题

- 用户点击参赛记录时提示「该记录缺少赛事信息」。
- 原因：部分历史记录缺少 `event_id`（或字段形态不一致），仅靠 `event_id` 无法跳转。

### 修复

1. 记录映射增强（`pages/profile/profile.js`）
   - `eventId` 兼容读取：`event_id / eventId / eventID`。
   - 增加元信息字段：`eventDate`、`eventLocation`，用于后续匹配。

2. 缺失 ID 自动补全
   - 新增赛事索引构建逻辑（基于 `listEvents`）：
     - `title + date + location` 精确匹配；
     - `title + date` 次级匹配；
     - `title` 最后匹配。
   - 在 `loadAttendance` 阶段对缺失 `eventId` 的记录尝试自动回填。

3. 点击时二次兜底
   - `handleAttendanceTap` 先用 `eventId` 直接跳转；
   - 若缺失，再用当前行元信息进行实时匹配并跳转；
   - 仍匹配不到才提示「该记录缺少赛事信息」。

4. WXML 透传匹配元信息
   - 参赛记录项增加：
     - `data-event-name`
     - `data-event-date`
     - `data-event-location`

### 验证

- `node --check pages/profile/profile.js` 通过。
- 代码检索确认：
  - 已存在缺失 ID 的补全逻辑；
  - 点击事件包含 metadata 兜底参数。

---

## Profile 底部操作区对齐修复（2026-02-06）

### 需求

- coach/admin 用户希望「新增赛事」与「编辑主页」在同一行并列展示（底部固定操作区）。

### 实施

1. 页面结构（`pages/profile/profile.wxml`）
   - 移除中部独立「赛事管理」卡片按钮入口。
   - 新增底部固定操作区 `float-actions`：
     - 所有本人主页：展示「编辑主页」；
     - coach/admin（含 organizer）：并列展示「新增赛事」。

2. 权限逻辑（`pages/profile/profile.js`）
   - 新增 `canManageEvents` 状态。
   - 新增 `hasEventManageAccess(role)`，角色白名单：
     - `admin`
     - `coach`
     - `organizer`
   - 保留 `goAdminEvents` 跳转逻辑不变。

3. 样式（`pages/profile/profile.wxss`）
   - 新增 `float-actions / float-actions-single / float-action-*` 样式。
   - 支持单按钮居中与双按钮并列两种布局。

### 验证

- `node --check pages/profile/profile.js` 通过。
- 手动检查点：
  - 普通用户：仅「编辑主页」底部居中；
  - coach/admin：底部并列显示「编辑主页」「新增赛事」。

---

## 赛事创建默认日期与导出兜底（2026-02-06）

### 需求

- 赛事创建页：开始/结束日期默认预填为当天。
- 底部「发布赛事/取消编辑」按钮不遮挡表单内容（需要更靠底，且内容可滚动到按钮上方）。
- Windows 开发者工具导出 CSV 报错：`openDocument:fail filetype not supported`。

### 修复

1. 默认日期（`pages/admin-events/admin-events.js`）
   - 新建赛事与 `resetForm()` 时：
     - `start_date`、`end_date` 默认设置为 `今天(YYYY-MM-DD)`。

2. 底部按钮不遮挡（`pages/admin-events/admin-events.wxss`）
   - 增加页面底部 padding 与表单 `padding-bottom` 预留空间。
   - `sticky-actions` 使用 `safe-area-inset-bottom`，按钮更贴近底部且不压内容。

3. 导出 CSV 兜底（`utils/export.js` + `pages/admin-events/admin-events.js`）
   - 仍生成 `.csv` 文件写入用户目录。
   - 若 `openDocument` 不支持 CSV：
     - 自动把 CSV 内容复制到剪贴板（含表头）。
     - 前端提示「已复制 xxx 人CSV」而不是报导出失败。

### 验证

- `node --check pages/admin-events/admin-events.js` 通过。
- `node --check utils/export.js` 通过。


---

## 赛事相册功能落地（2026-02-06）

### 需求

- 新增“赛事相册”能力：
  - 参赛者/摄影可上传高清照片；
  - 参赛者可查看并下载照片；
  - 上传后自动可见。

### 本次实现范围

1. BFF API（CloudRun）
   - 新增：
     - `GET /v1/events/:id/album/summary`
     - `GET /v1/events/:id/album`
     - `POST /v1/events/:id/album/photos`
     - `GET /v1/events/:id/album/photos/:photoId/download`
     - `DELETE /v1/events/:id/album/photos/:photoId`
   - 新增鉴权逻辑：参赛者或 `admin/organizer` 才可查看/上传/下载。
   - 删除权限：上传者本人或管理员/组织者。

2. 小程序端
   - 新增页面：`pages/event-album/event-album`（列表、上传、预览、下载、删除）。
   - `app.json` 注册页面路由。
   - `pages/event-detail/event-detail` 接入相册：
     - 展示相册摘要（总数、权限状态）；
     - 上传按钮与“进入相册”入口。

3. API 封装
   - `utils/api.js` 新增：
     - `getEventAlbumSummary`
     - `getEventAlbum`
     - `createEventAlbumPhoto`
     - `getEventAlbumPhotoDownloadUrl`
     - `deleteEventAlbumPhoto`
   - 统一保持“BFF 优先 + 后端不可用 fallback”。

4. 数据迁移脚本
   - 新增：`scripts/sql/20260206_event_album.sql`
   - 定义 `event_album_photos` 表及索引，并给出分步迁移与回滚说明。

### 关键实现细节

- 上传采用“原图 + 缩略图”双文件策略：
  - 原图用于下载与预览；
  - 缩略图用于列表，降低流量与首屏等待。
- 相册列表分页默认 `20`，最大 `50`。
- `onShow` 增加 30 秒缓存刷新阈值，避免重复请求。
- 下载接口优先返回后端下载直链；若不可用，返回 `file_id` 供前端在授权后临时解析。

### 验证与检查

- 已完成本地静态语法检查（见下文命令）。
- 未执行真实云端部署/联调（需 CloudRun 与数据库迁移在目标环境执行后验证）。


### 云端迁移执行结果（2026-02-06，env: werox-mini-program-8die4bd982524）

- 已执行 `SHOW TABLES LIKE 'event_album_photos'`：执行前不存在。
- 已执行建表 SQL：`event_album_photos` 创建成功。
- 已执行 `SHOW COLUMNS FROM event_album_photos`：列与索引生效。
- 已写入安全规则：`writeSecurityRule(sqlDatabase, event_album_photos, ADMINWRITE)`。
- 已复核读取：当前表规则表现为 `allUser` 可读策略（写入由服务端链路控制）。

### 相册 fallback 热修复（2026-02-06）

- 修复 1：本地 fallback 查询使用了不支持的 `.offset()`，导致列表报错。
  - 方案：改为 `limit(offset + limit + 1)` 后在前端内存切片分页。
- 修复 2：CloudRun 不可用时，相册上传/删除 fallback 触发表权限拒绝。
  - 方案：上传/删除改为“仅后端可用”路径，不再本地写入 fallback；
  - `getEventAlbumSummary` 在后端不可用时返回 `can_upload=false` 与 `backend_unavailable=true`，前端自动隐藏上传入口并提示“当前可浏览与下载”。


### CloudRun 部署执行记录（2026-02-06）

- 已通过 MCP `manageCloudRun deploy` 成功部署服务：`werox-bff`
- 部署路径：`/mnt/c/Users/80969/projects/werox/cloudrun/werox-bff`
- 服务详情：
  - 状态：`normal`
  - 访问类型：`MINIAPP`
  - 默认域名：`https://werox-bff-224371-8-1398111856.sh.run.tcloudbase.com`
  - 资源：`Cpu=0.25`, `Mem=0.5`, `MinNum=0`, `MaxNum=3`
- 当前已注入环境变量：
  - `TCB_ENV_ID=werox-mini-program-8die4bd982524`
  - `TCB_AUTH_PROVIDER_ID=wechat`
- 待补充关键变量：`TCB_API_KEY`（缺失时 BFF 访问数据库会失败）。


### CloudRun 版本未就绪容错补丁（2026-02-06）

- 问题：小程序 `callContainer` 返回 `SERVICE_VERSION_NOT_FOUND` 时，事件列表等 API 未降级，页面报错。
- 修复：`utils/api.js` 的后端不可用模式增加以下匹配：
  - `SERVICE_VERSION_NOT_FOUND`
  - `SERVICE_NOT_READY`
  - `SERVICE_LB_STATUS_ABNORMAL`
- 结果：当云托管版本未发布/未就绪时，页面自动回退本地数据通道，避免白屏与主流程中断。


### CloudRun build_failed 修复与上线版本恢复（2026-02-06）

- 根因：`cloudrun/werox-bff/Dockerfile` 使用 `npm ci --omit=dev`，但项目未提交 `package-lock.json`，导致云端构建直接失败，版本均为 `build_failed`，从而 `OnlineVersionInfos` 为空，小程序 `callContainer` 报 `SERVICE_VERSION_NOT_FOUND`。
- 修复：将构建命令改为 `npm install --omit=dev`（见 `cloudrun/werox-bff/Dockerfile`），重新部署生成新版本。
- 结果：`werox-bff-005` 构建成功并上线，`queryCloudRun.detail` 可看到：
  - `TrafficType=FLOW`
  - `OnlineVersionInfos=[{ VersionName: werox-bff-005, FlowRatio: 100 }]`

注意：
- 仍需配置 `TCB_API_KEY`（服务端 API Key）到 CloudRun 环境变量，否则 BFF 的数据库读写接口会失败。
- 服务访问类型在控制台/接口层面出现 `OA/PUBLIC/MINIAPP` 同时开启的现象，后续需收敛到仅 `MINIAPP` 以降低暴露面。


### BFF 缺少 TCB_API_KEY 的自动兜底（2026-02-06）

- 现象：CloudRun 在线但未配置 `TCB_API_KEY` 时，BFF 会在身份/数据库链路失败，前端表现为“Load events failed: 身份解析失败”。
- 修复：
  - BFF 中间件对 `missing_tcb_api_key` 返回明确错误码 `MISSING_TCB_API_KEY`（见 `cloudrun/werox-bff/index.js`）。
  - 小程序端将该错误视为“后端不可用”并自动回退本地 DB 通道（见 `utils/api.js`）。
- 结果：即使云托管未配置 API Key，赛事列表等核心页不会白屏；但相册上传/删除仍要求后端可用。


### 相册瀑布流与预览内下载（2026-02-06）

- 目标：相册列表改为两列“瀑布流”视觉；“下载原图”按钮仅在点击照片进入预览后出现，减少列表干扰。
- 实施：
  - 列表渲染改为双列布局（`waterfallLeft`/`waterfallRight`），使用 `image mode="widthFix"` 实现自适应高度。
  - 点击照片打开自定义全屏预览（`swiper`），底部操作条提供：
    - `下载原图`
    - `关闭`
    - `删除`（仅当 `can_delete=true`）
  - 列表图片开启 `lazy-load`，优先使用缩略图 URL。


### 修复赛事列表被身份解析阻断（2026-02-06）

- 问题：`GET /v1/events` 与 `GET /v1/events/:id` 实际不依赖用户身份，但此前挂了 `attachIdentity`，当身份解析链路异常时会直接导致首页“赛事列表”加载失败并报“身份解析失败”。
- 修复：上述两个接口改为公开访问，不再强制身份解析（见 `cloudrun/werox-bff/index.js`）。
- 兼容：若后端 `TCB_API_KEY` 配置错误，接口将返回 `503` + `TCB_API_KEY_INVALID`，小程序侧按“后端不可用”回退本地 DB 通道。

---

## 赛事强度/耐力条移除（2026-02-06）

### 需求

- 赛事列表卡片与赛事详情页不再展示「强度/耐力」进度条。

### 修改

- `pages/events/events.wxml`：移除卡片内 `强度/耐力` bar 区块。
- `pages/event-detail/event-detail.wxml`：移除详情页 `强度/耐力` bar 区块。
- `pages/events/events.wxss`、`pages/event-detail/event-detail.wxss`：删除对应 `.intensity-*` 样式，避免冗余。

### 验证

- `node --check pages/events/events.js` 通过。
- `node --check pages/event-detail/event-detail.js` 通过。

---

## Bugfix: CSV 导出兜底 + 后端不可用识别（2026-02-06）

### 问题

- 管理端导出参赛名单时，部分平台 `wx.openDocument` 无法预览 `.csv/.txt`，导致导出流程报错。
- CloudRun BFF 缺少 `TCB_API_KEY` 时，部分接口会返回不同业务错误码（但 `detail` 仍包含 `missing_tcb_api_key`），前端未识别为“后端不可用”，无法自动回退本地只读通道。

### 修复

- `utils/export.js`：CSV/TXT 打开失败时直接回退“复制 CSV 到剪贴板”（同时兼容不同平台的错误文案）。
- `utils/api.js`：后端不可用判定增加对 `payload.detail` 中 `missing_tcb_api_key` 的识别，确保 fallback 生效。

---

## 赛事详情报名状态提示（2026-02-06）

### 需求

- 用户若已报名，赛事详情页底部按钮需显示「已报名」。

### 实施

- `pages/event-detail/event-detail.js`
  - 新增 `isSigned` 状态。
  - 加载赛事后调用 `getMyRegistration(eventId)` 获取 `is_signed` 并更新按钮状态。
- `pages/event-detail/event-detail.wxml`
  - 报名按钮文案：`报名已满 / 已报名 / 立即报名`。

### 验证

- `node --check pages/event-detail/event-detail.js` 通过。

---

## 赛事详情移除相册上传入口（2026-02-06）

### 需求

- 赛事详情页不展示「上传」按钮入口（上传统一在相册页进行）。

### 修改

- `pages/event-detail/event-detail.wxml`
  - 移除「赛事相册」卡片右侧 `上传` 按钮。
  - 空状态文案不再提示“点击上传第一张”。
- `pages/event-detail/event-detail.js`
  - 删除未使用的 `handleUpload`。
- `pages/event-detail/event-detail.wxss`
  - 删除 `upload-btn` / `btn-icon` 样式。

### 验证

- `node --check pages/event-detail/event-detail.js` 通过。

---

## 赛事详情 UI 整理（2026-02-06）

### 修改

- 相册列表移除图片时间水印（metadata overlay）：
  - `pages/event-album/event-album.wxml` 删除 `wf-meta`。
  - `pages/event-album/event-album.wxss` 删除对应样式。
- 赛事详情页海报并入顶部赛事卡片：
  - `pages/event-detail/event-detail.wxml` 在赛事介绍后以内嵌海报展示，移除独立海报卡片。
- 赛事详情页渲染组织者图文模块：
  - `pages/event-detail/event-detail.js` 使用 `normalizeDetailBlocks(event.detail_blocks)` 生成 `detailBlocks`，并解析云文件临时链接。
  - `pages/event-detail/event-detail.wxml` 新增「活动详情」卡片渲染标题/图片/正文。

### 验证

- `node --check pages/event-detail/event-detail.js` 通过。
- `node --check pages/event-album/event-album.js` 通过。

---

## 小程序数据分析埋点（微信内置 + We分析）（2026-02-06）

### 目标

- 仅使用微信生态的分析能力：
  - 小程序后台「数据分析」
  - We分析 / WeData
- 关键路径可被量化：赛事浏览 -> 报名 -> 相册浏览/上传/下载 -> 个人资料编辑

### 实施

1. 新增轻量埋点封装
   - `utils/analytics.js`
   - 优先 `wx.reportEvent`，若不可用则 fallback 到 `wx.reportAnalytics`
   - 参数做了长度与类型裁剪，且保证埋点失败不影响主流程

2. 已埋点页面
   - `pages/events/events.js`
   - `pages/event-detail/event-detail.js`
   - `pages/event-signup/event-signup.js`
   - `pages/event-album/event-album.js`
   - `pages/profile/profile.js`

### 事件 ID（需要在微信后台「自定义分析」配置同名事件与字段）

- `events_list_loaded`: `count`
- `event_card_click`: `event_id`, `status`, `type`
- `event_detail_open`: `event_id`
- `event_view`: `event_id`, `status`, `type`
- `signup_blocked_full`: `event_id`
- `signup_start`: `event_id`, `is_signed`
- `signup_page_open`: `event_id`
- `signup_submit`: `event_id`, `division`
- `signup_success`: `event_id`, `division`
- `signup_fail`: `event_id`, `reason`
- `album_open`: `event_id`
- `album_page_open`: `event_id`
- `album_view`: `event_id`, `total_photos`, `can_upload`
- `album_upload_start`: `event_id`, `count`
- `album_upload_result`: `event_id`, `success`, `failed`
- `album_download`: `event_id`, `photo_id`
- `album_delete`: `event_id`, `photo_id`
- `open_location`: `event_id`
- `profile_edit_start`: `is_self`
- `profile_save_submit`: `has_nickname`, `has_avatar`, `has_tag`
- `profile_save_success`
- `profile_save_fail`: `reason`

### 验证

- `node --check`：
  - `utils/analytics.js`
  - `pages/events/events.js`
  - `pages/event-detail/event-detail.js`
  - `pages/event-signup/event-signup.js`
  - `pages/event-album/event-album.js`
- `pages/profile/profile.js`

---

## UI/UX 修复与增强（2026-02-06）

- 我的页「参赛记录」移除强度/耐力展示，改为日期/场馆信息，并增加箭头提示可点击。
- 参赛记录跳转赛事详情增强兜底：当记录缺少 `eventId` 时，赛事详情页可通过 `title/date/location` 解析并自动跳转到对应赛事。
- 赛事「活动详情」图文模块支持多图上传与前台 2 列网格展示（`detail_blocks.image_urls[]`，兼容 `image_url`）。
- 创建/编辑赛事权限口径调整：`admin/coach/organizer` 均可进入赛事工作台。

---

## 技术债清理 + 管理员角色分配功能（2026-02-07）

### Phase 1: P0 安全与正确性修复

1. **删除无用云函数**：移除 `adminEventOperation`、`exportEventParticipants`、`importEventsStub`、`importUsersStub`（含硬编码 openid、不兼容 MySQL 后端）。仅保留 `getOpenId`。
2. **消除 BFF select('*')**：所有 hot path 改为显式列选择：
   - `EVENT_LIST_COLUMNS`、`EVENT_DETAIL_COLUMNS`、`PARTICIPANT_DETAIL_COLUMNS`
   - `USER_SELECT_COLUMNS`（身份解析 + 用户查询）
   - `participantColumns`（参赛记录查询）
3. **报名去重约束**：新增 SQL 迁移 `scripts/sql/20260207_registration_unique.sql`，在 `event_participants(event_id, user_openid)` 上添加 UNIQUE KEY；BFF 注册路由捕获 duplicate key 错误返回 `ALREADY_SIGNED`。
4. **下载计数非原子操作**：添加 `KNOWN_LIMITATION` 注释说明当前 read-then-write 的竞态风险。
5. **输入校验**：BFF 新增 `sanitizeRegistrationInput` 和 `sanitizeProfileInput`，对 `division`（64）、`team_name`（128）、`note`（512）、`nickname`（64）、`bio`（1000）、`wechat_id`（64）等字段做长度截断。

### Phase 2: P1 架构修复

1. **BFF 模块拆分**：将 1433 行 `index.js` 拆分为 10+ 模块：
   - `lib/config.js` — 环境变量、常量、VALID_ROLES、LIMITS
   - `lib/cloudbase.js` — CloudBase API 客户端（rdbSelect/Insert/Update 等）
   - `lib/helpers.js` — 所有 helper 函数 + 新增 isAdminUser、truncateField、sanitize*
   - `lib/identity.js` — 身份解析（resolveIdentityFromRequest、ensureLegacyUser 等）
   - `middleware/auth.js` — attachIdentity 中间件
   - `routes/auth.js` — 认证路由
   - `routes/events.js` — 赛事路由（含分页、event_id IN-clause 优化）
   - `routes/registration.js` — 报名路由（含去重 + 校验）
   - `routes/album.js` — 相册 CRUD 路由
   - `routes/me.js` — 个人资料路由 + 新增 `GET /v1/me/role` 轻量端点
   - `routes/users.js` — 用户管理路由（管理员专属）
   - `index.js` — 缩减至 ~108 行（Express 启动 + 中间件 + 路由挂载）

2. **消除前后端逻辑重复**：创建 `utils/normalizers.js` 作为规范化函数的唯一来源：
   - 导出：`parseTags`、`normalizeProfile`、`computeScores`、`normalizeAlbumPhoto`、`isPrivilegedRole`
   - `utils/api.js` 改为从 `normalizers.js` 导入，移除内联重复定义

3. **packOptions.ignore 修复**：`project.config.json` 新增忽略 `node_modules`、`cloudrun`、`scripts`、`prefill_users.*`、`PROCESS.md`、`PLAN.md`、`AGENTS.md`、`CLAUDE.md`、`.mcp.json`。

### Phase 3: P2 设计异味修复

1. **请求日志**：BFF 添加 `morgan('combined')` 中间件。
2. **速率限制**：BFF 添加 `express-rate-limit`（报名 10/min、相册上传 20/min、资料更新 10/min）。
3. **赛事列表性能**：participant 查询从全量拉取改为 `event_id IN (...)` 条件过滤，上限 500。
4. **赛事列表分页**：`GET /v1/events` 支持 `limit`/`offset` 查询参数。
5. **getUserRole 效率**：新增 `GET /v1/me/role` 轻量端点 + 客户端 `app.globalData._cachedRole` 缓存，避免每次拉取完整资料。
6. **Profile tags 双发修复**：`pages/profile/profile.js` 移除 `JSON.stringify(tags)` 的冗余转换，tags 统一以数组发送。
7. **package-lock.json**：生成 `cloudrun/werox-bff/package-lock.json`，Dockerfile 改用 `npm ci --omit=dev`。
8. **CORS**：BFF 添加 `cors` 中间件。
9. **本地 fallback 分页修复**：`localGetEventAlbum` 从 `.limit(offset+limit+1).slice(offset)` 改为 `.range(offset, offset+limit)`，避免大 offset 时拉取冗余数据。

### Phase 4: 管理员角色分配功能

1. **BFF 端点**：
   - `GET /v1/users` — 管理员专属，支持分页 + 昵称模糊搜索
   - `PATCH /v1/users/:id/role` — 管理员专属，验证角色值合法性
2. **API 客户端**：`utils/api.js` 新增 `listUsers()`、`updateUserRole()`、`getMyRole()`。
3. **管理用户页面**：新增 `pages/admin-users/admin-users`：
   - 搜索栏 + 用户列表（头像、昵称、角色徽章）
   - 点击角色触发 ActionSheet + Modal 确认
   - 分页加载更多
   - 仅 admin 角色可访问
4. **入口集成**：
   - `pages/profile/profile.wxml` 底部浮动操作区新增「管理用户」按钮（蓝色调，仅 admin 可见）
   - `pages/profile/profile.js` 新增 `isAdmin` 状态和 `goAdminUsers()` 导航
   - `app.json` 注册 `pages/admin-users/admin-users`

### Phase 5: SQL 迁移

- `scripts/sql/20260207_registration_unique.sql`：`ALTER TABLE event_participants ADD UNIQUE KEY uk_event_user_openid (event_id, user_openid)`
- 部署顺序：执行 SQL 迁移 → 部署 BFF → 更新小程序代码

### 新增/修改文件清单

| 操作 | 路径 |
|------|------|
| DELETE | `cloudfunctions/adminEventOperation/` |
| DELETE | `cloudfunctions/exportEventParticipants/` |
| DELETE | `cloudfunctions/importEventsStub/` |
| DELETE | `cloudfunctions/importUsersStub/` |
| NEW | `utils/normalizers.js` |
| NEW | `scripts/sql/20260207_registration_unique.sql` |
| NEW | `cloudrun/werox-bff/lib/config.js` |
| NEW | `cloudrun/werox-bff/lib/cloudbase.js` |
| NEW | `cloudrun/werox-bff/lib/helpers.js` |
| NEW | `cloudrun/werox-bff/lib/identity.js` |
| NEW | `cloudrun/werox-bff/middleware/auth.js` |
| NEW | `cloudrun/werox-bff/routes/auth.js` |
| NEW | `cloudrun/werox-bff/routes/events.js` |
| NEW | `cloudrun/werox-bff/routes/registration.js` |
| NEW | `cloudrun/werox-bff/routes/album.js` |
| NEW | `cloudrun/werox-bff/routes/me.js` |
| NEW | `cloudrun/werox-bff/routes/users.js` |
| NEW | `cloudrun/werox-bff/package-lock.json` |
| NEW | `pages/admin-users/admin-users.js` |
| NEW | `pages/admin-users/admin-users.wxml` |
| NEW | `pages/admin-users/admin-users.wxss` |
| NEW | `pages/admin-users/admin-users.json` |
| REWRITE | `cloudrun/werox-bff/index.js` (1433 → ~108 行) |
| EDIT | `cloudrun/werox-bff/package.json` (v0.2.0 + cors/morgan/rate-limit) |
| EDIT | `cloudrun/werox-bff/Dockerfile` (npm ci) |
| EDIT | `project.config.json` (packOptions.ignore) |
| EDIT | `utils/api.js` (导入 normalizers + 新增 admin API + 分页修复) |
| EDIT | `utils/user.js` (轻量 getUserRole + 缓存) |
| EDIT | `pages/profile/profile.js` (tags 修复 + isAdmin + goAdminUsers) |
| EDIT | `pages/profile/profile.wxml` (管理用户按钮) |
| EDIT | `pages/profile/profile.wxss` (admin-users 按钮样式) |
| EDIT | `app.json` (注册 admin-users 页面) |

### 验证

- `node --check` 全部通过：`utils/api.js`、`utils/normalizers.js`、`utils/user.js`、`pages/profile/profile.js`、`pages/admin-users/admin-users.js`、BFF 全部 10+ 模块
- BFF 健康检查端点 `GET /health` 正常响应

---

## UI/UX 审计修复（2026-02-07）

### 目标

- 修复 7 页面的 UI/UX 问题：broken rendering、UX 逻辑错误、潜在 runtime crash、CSS 重复。

### P0 — 修复 Bugs / Broken Behavior

1. **封面图改用 `<image>` 组件**
   - `pages/events/events.wxml`：用 `<image class="cover-img">` 替换 `background-image: url()` 内联样式。
   - `pages/event-detail/event-detail.wxml`：同上。
   - WXSS 中新增 `.cover-img` 绝对定位样式，`.cover-overlay` 添加 `z-index: 2`，确保渐变遮罩覆盖图片。
   - 原因：小程序 `background-image` 对网络/云临时 URL 加载不可靠。

2. **修复 highlights 空值 crash**
   - `pages/event-detail/event-detail.js`：event 映射新增 `highlights: eventData.highlights || []`。
   - `pages/event-detail/event-detail.wxml`：高亮卡片条件改为 `wx:if="{{event && event.highlights && event.highlights.length > 0}}"`。

3. **报名表单加载保护**
   - `pages/event-signup/event-signup.wxml`：表单卡片增加 `wx:if="{{event && !loading}}"` 防护。

### P1 — 修复 UX 逻辑错误

4. **相册入口按权限控制**
   - `pages/event-detail/event-detail.wxml`：「进入相册」按钮添加 `wx:if="{{albumSummary.canView}}"`。

5. **相册加载态改用骨架屏**
   - `pages/event-album/event-album.wxml`：原 `empty-state-box` 加载态替换为 `.loading-skeleton` 骨架网格。
   - `pages/event-album/event-album.wxss`：新增 `.loading-skeleton`、`.skeleton-grid`、`.skeleton-thumb` 样式。

### P2 — 移除死代码

6. **移除 events 列表死代码图标**
   - `pages/events/events.wxml`：删除 `wx:if="{{false}}"` 的 `<image>` 元素。

### P3 — CSS 去重与合并

7. **状态徽章样式统一到 app.wxss**
   - 新增 `.status-badge-draft` 至 `.status-badge-ended` 到 `app.wxss`。
   - 移除 `pages/events/events.wxss`、`pages/event-detail/event-detail.wxss` 中的重复定义。
   - 移除 `pages/admin-events/admin-events.wxss` 中 `.status-draft` 至 `.status-ended` 的重复定义。

8. **空状态样式去重**
   - 移除 `pages/event-detail/event-detail.wxss`、`pages/event-signup/event-signup.wxss` 中重复的 `.empty-state-box/.empty-state-icon/.empty-state-title/.empty-state-desc`（已存在于 app.wxss）。

9. **表单样式统一到 app.wxss**
   - 新增 `.form-row`、`.form-label`、`.form-input`、`.form-textarea`、`.picker-field`、`.picker-placeholder` 到 `app.wxss`。
   - 移除 `pages/event-signup/event-signup.wxss` 中完全相同的定义。
   - 保留 `pages/profile/profile.wxss` 和 `pages/admin-events/admin-events.wxss` 中有意覆盖的变体。

### P4 — 细节打磨

10. **Profile 编辑操作安全区**
    - `pages/profile/profile.wxss`：`.edit-actions` 的 `bottom` 改为 `calc(12rpx + env(safe-area-inset-bottom))`，兼容刘海屏。

### 修改文件

| 文件 | 变更 |
|------|------|
| `app.wxss` | 新增 status-badge + form 共享样式 |
| `pages/events/events.wxml` | 封面改 `<image>`，删除死代码图标 |
| `pages/events/events.wxss` | 新增 `.cover-img`，移除 status-badge 重复 |
| `pages/event-detail/event-detail.wxml` | 封面改 `<image>`，highlights 安全守卫，相册按钮权限 |
| `pages/event-detail/event-detail.wxss` | 新增 `.cover-img`，移除 status-badge + empty-state 重复 |
| `pages/event-detail/event-detail.js` | 事件映射新增 `highlights` |
| `pages/event-signup/event-signup.wxml` | 表单卡片加 `wx:if` 防护 |
| `pages/event-signup/event-signup.wxss` | 移除 empty-state + form 重复 |
| `pages/event-album/event-album.wxml` | 加载态改骨架屏 |
| `pages/event-album/event-album.wxss` | 新增骨架屏样式 |
| `pages/admin-events/admin-events.wxss` | 移除 status 文字色重复 |
| `pages/profile/profile.wxss` | 编辑操作区 safe-area 修复 |

---

## Backend Error 修复（2026-02-07）

### 问题

- 多页面出现 "赛事不存在"、"角色更新失败" 等后端报错。
- Events 列表页和 Profile 页因 BFF 身份解析失败时未回退本地通道导致白屏/加载失败。

### 根因分析

1. **DB ENUM 缺失 `coach`**：`users.role` 列 ENUM 仅有 `('runner','organizer','admin')`，缺少 `'coach'`。BFF 校验通过但 DB 写入失败。
2. **`isBackendUnavailableError()` 不识别身份类错误**：BFF 返回 `IDENTITY_RESOLVE_FAILED`（401）、`MINI_IDENTITY_FAILED` 等错误码不在前端 fallback 模式列表中，导致页面直接报错而非回退本地 DB。
3. **`event_participants` 安全规则过严**：仅 `me: rw`（无 `all: r`），本地 fallback 查询参赛人数/头像时只能看到自己的记录，导致数据不完整。

### 修复

1. **DB ENUM 修复**：`ALTER TABLE users MODIFY COLUMN role ENUM('runner','coach','organizer','admin') DEFAULT 'runner'` — 已执行成功。
2. **前端 fallback 扩展**（`utils/api.js`）：
   - `BACKEND_UNAVAILABLE_PATTERNS` 新增 5 个错误码：`IDENTITY_RESOLVE_FAILED`、`MINI_IDENTITY_FAILED`、`UNAUTHORIZED`、`ME_QUERY_FAILED`、`ME_ROLE_FAILED`。
   - `isBackendUnavailableError()` 新增 HTTP 401/503 状态码检测。
3. **安全规则修复**：`event_participants` 从 `me: rw` 改为 `READONLY`（`all: r, me: rw`）— 已通过 MCP 执行。

### 验证

- `SHOW COLUMNS FROM users WHERE Field = 'role'` → 确认 ENUM 含 `'coach'`
- `readSecurityRule(event_participants)` → 确认含 `all: r`
- 角色修改重试应不再报 `角色更新失败`
