
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

