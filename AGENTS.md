Use english to communicate. 
you are creating a miniprogram in wechat.think systematically. After finishing each coding session or when you think there is critical information need to be noted (infrastructure spec, backend design spec, design spec, etc ), add that to the AGENTS.md.

this is a chinese mini prgram, always use easy to understand chinese in UI. utilize skills for cloudbase and wechat mini program development. Use their best practice. there is also a mcp for search development knowledge base. 


app Purpose: HYROX 活动报名和管理，社交，找hyrox 搭子队友, 管理生理数据，活动照片分享平台，面向Hyrox运动爱好者.


after each major feature/fix/etc, update PROCESS.md

## 性能优化注意事项（2026-02-06）

- 开发态优先关闭 `project.config.json` 中的压缩项（`minified`、`minifyWXML`）以提升编译速度。
- `packOptions.ignore` 必须忽略与小程序运行无关的大文件/目录（如 `node_modules`、导入脚本、prefill 数据文件）。
- 列表页禁止使用 `select('*')`，只取必要字段，减少 SQL 返回体积。
- `onShow` 场景应加短时缓存（如 30 秒）和并发保护，避免重复请求。
- 地理位置等高成本能力使用缓存（如 3 分钟 TTL），减少权限弹窗与等待。
- 云文件临时链接尽量批量解析，避免多次 `wx.cloud.getTempFileURL`。

---

## UI 设计规范 

### 设计规范

```
DESIGN SPECIFICATION - WeRox Mini Program
==========================================
1. Purpose: HYROX 赛事管理与照片分享平台，面向运动爱好者
2. Aesthetic Direction: Industrial/Utilitarian + Luxury/Refined
   - 工业风的功能性与高端运动品牌的精致感结合
3. Color Palette:
   - Primary: #f59e0b (活力橙金)
   - Primary Light: #fde68a (暖金色文字)
   - Background: #0b0b0f (深邃黑)
   - Card BG: rgba(17, 17, 17, 0.95) (卡片深灰)
   - Text Primary: #f5f5f0 (温暖白)
   - Text Secondary: #a3a3a3 (中灰)
   - Accent Green: #34d399 (成功状态/报名中)
   - Accent Blue: #60a5fa (信息状态/即将开始)
4. Typography: HarmonyOS Sans SC + PingFang SC
5. Layout Strategy: 卡片式布局 + 渐变光晕装饰 + 非对称高光条
```

### 图标资源

使用 **Icons8** 提供的专业图标，存放在：
- `assets/tabbar/` - TabBar 图标
- `assets/icons/` - 页面内图标

**TabBar 图标:**
- `events.png` / `events-active.png` - 赛事
- `profile.png` / `profile-active.png` - 我的

**页面内图标:**
- `running.png` - 跑步/空状态
- `camera.png` - 相机/照片
- `users.png` - 用户组/参赛选手
- `search.png` - 搜索/未找到
- `medal.png` - 奖牌/成绩记录
- `upload.png` - 上传
- `user-placeholder.png` - 用户头像占位
- `location.png` - 地点/位置

### 禁止使用

1. **禁止 Emoji 图标**: 不要用 🏃 📷 👥 🔍 🏅 等 emoji
2. **禁止紫色系**: purple, violet, indigo, fuchsia
3. **禁止通用字体**: Inter, Roboto, Arial, Helvetica

### 关键样式

**卡片样式:**
```css
.card {
  background: linear-gradient(145deg, rgba(23, 23, 26, 0.98), rgba(11, 11, 15, 0.98));
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 32rpx;
  box-shadow: 0 20rpx 40rpx rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(20rpx);
}
```

**主按钮:**
```css
.primary-btn {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: #0b0b0f;
  box-shadow: 0 8rpx 24rpx rgba(245, 158, 11, 0.35);
}
```

**状态徽章颜色:**
- draft: #9ca3af (灰)
- upcoming: #60a5fa (蓝)
- open: #34d399 (绿)
- closed: #fbbf24 (黄)
- ongoing: #f59e0b (橙)
- ended: #a78bfa (紫)

### 页面背景

每个页面都使用渐变光晕装饰：
```css
.page {
  background-image:
    radial-gradient(circle at 0% 0%, rgba(245, 158, 11, 0.18), transparent 50%),
    radial-gradient(circle at 100% 80%, rgba(245, 158, 11, 0.08), transparent 40%);
}
```

---

## MCP 接入规范（2026-02-06）

- CloudBase MCP Server 统一使用名称：`cloudbase_com_cn`。
- 项目级配置文件：`.mcp.json`。
- 推荐启动参数：
  - `command: npx`
  - `args: ["-y", "@cloudbase/cloudbase-mcp@latest"]`
- 若出现 `unknown MCP server 'cloudbase_com_cn'`：
  1. 检查 `~/.codex/config.toml` 是否注册了 `[mcp_servers.cloudbase_com_cn]`
  2. 检查项目 trust level 是否为 `trusted`
  3. 重启 Codex 会话后再执行 MCP 资源查询

---

## 跨端共后端约束（知识库校准，2026-02-06）

- 目标：小程序与 iOS 共用同一套 CloudRun 后端（BFF），避免双套业务逻辑。
- 小程序侧优先使用 `wx.cloud.callContainer`（微信体系内调用）访问 CloudRun：
  - 请求头可带可信身份信息，如 `x-wx-openid`、`x-wx-unionid`、`x-cloudbase-context`（base64）。
  - 后端可直接解析用户身份，不需要前端自行拼接不可信用户ID。
- iOS/Android 原生端不依赖小程序 SDK 链路，统一走 CloudBase HTTP API + Token。
- CloudBase Auth v2 关键接口（OpenAPI）：
  - `/auth/v1/provider/token`
  - `/auth/v1/signin/with/provider`
  - `/auth/v1/signin/custom`
  - `/auth/v1/token`、`/auth/v1/token/introspect`
  - `/auth/v1/user/me`
- CloudRun OpenAPI 网关调用路径：`/v1/cloudrun/{name}/{anyPath}`。
- MySQL REST OpenAPI 主路径：`/v1/rdb/rest/{table}`（系统库推荐）。
- 身份统一建议：
  - 优先以 `unionid`（可用时）做跨端同人识别；
  - `openid` 作为渠道身份保留；
  - 业务表使用内部 `user_id` 关联，不再用 `openid` 作为业务主键。

---

## UI/UX 重构记录（2026-02-06）

### 范围

- `pages/admin-events/admin-events`：重构“赛事创建/编辑”流程。
- `pages/profile/profile`：重构“个人主页创建与编辑”流程。

### 设计与交互决策

- 赛事页改为“工作台式”步骤体验：
  - 顶部增加核心信息完成度与摘要（时间、地点、组别）。
  - 表单按 5 个步骤分区：基本信息、赛制组别、媒体图文、报名难度、站点配置。
  - 保留原有数据字段与保存逻辑，仅优化信息架构和操作路径。
- 个人页改为“双态结构”：
  - 浏览态突出关键信息与训练画像。
  - 编辑态使用独立“资料编辑工作台”，按分组填写，降低一次性认知负担。
  - 保留头像上传、昵称同步、微信号匹配等既有业务逻辑。

### 实施约束

- UI 文案使用易懂中文，不引入 emoji 图标。
- 保持工业风 + 精致运动品牌风格（橙金 + 深色底）。
- 优先复用现有事件/用户字段，避免引入新后端依赖。

---

## 后端实现规范（2026-02-06）

- 新增统一后端服务目录：`cloudrun/werox-bff/`（CloudRun BFF）。
- 小程序端统一通过 `wx.cloud.callContainer` 调用后端，调用封装在：
  - `utils/backend.js`
  - `utils/api.js`
- 小程序核心页面已切换 API 化：
  - `pages/events/events.js`
  - `pages/event-detail/event-detail.js`
  - `pages/event-signup/event-signup.js`
  - `pages/profile/profile.js`
- 身份解析优先级：
  1. 小程序可信头（`x-wx-openid` / `x-wx-unionid` / `x-cloudbase-context`）
  2. Bearer Token（Auth v2）
- BFF 环境变量约定：
  - `TCB_ENV_ID`
  - `TCB_API_KEY`
  - `TCB_AUTH_CLIENT_ID`
  - `TCB_AUTH_CLIENT_SECRET`
  - `TCB_AUTH_PROVIDER_ID`
- 数据迁移 SQL 脚本位置：
  - `scripts/sql/20260206_identity_unification.sql`

---

## Profile 标签与编辑体验规范（2026-02-06）

- 个人页编辑态标签改为**预设单选**，不再使用自由文本输入。
- 预设标签固定为：
  - `#PACER（心肺担当）`
  - `Ranger（六边形）`
  - `Support（战术辅助）`
  - `TANK（力量担当）`
- 交互规则：
  - 一次仅可选 1 个标签；
  - 点击已选标签可取消选择（允许空标签）。
- 存储规则：
  - `tags` 字段统一保存为 `[]` 或 `[selectedTag]`；
  - 历史多标签/自定义标签可读取，但用户下次保存后归一为单选结果。
- 编辑页结构优化：
  - 分组为「基础信息 / 训练与参赛偏好 / 联系方式与简介」；
  - 编辑时隐藏非编辑信息卡片，减少视觉干扰；
  - 使用独立底部操作区（保存资料 / 取消编辑）。

---

## 核心页面视觉风格统一（2026-02-06）

- 核心 4 页（赛事列表/赛事详情/赛事报名/个人主页）执行统一视觉升级。
- 方向：高级感 + 清晰信息，不改后端逻辑。
- 统一策略：
  - 全局卡片深度、按钮层次、空状态语言统一。
  - 元信息和关键操作优先级更明确。
  - 编辑/报名等高任务场景减少视觉干扰，提升完成效率。


- 在 CloudBase 上做“可回滚、低风险”的数据库迁移流程：先只读探测结构，再分步 DDL/DML 执行（建表
  →补列→回填→校验→安全规则），而不是一次性跑整段 SQL。

- 小程序和 iOS 共用后端时，核心不是 openid，而是统一 user_id。
  openid/unionid/provider_uid 应该放在 identity_links 做身份映射，业务表全部逐步转向 user_id
  关联。

---

## Profile 参赛记录跳转规范（2026-02-06）

- 个人页浏览态不再展示「训练评分」区块（强度/耐力汇总）。
- 「参赛记录」每一项都应支持点击跳转赛事详情页：
  - 目标路径：`/pages/event-detail/event-detail?id={eventId}`。
  - `eventId` 取值来源：报名记录 `event_participants.event_id`。
- 异常兜底：
  - 当记录缺少 `event_id` 时，不跳转，提示「该记录缺少赛事信息」。

### 历史数据兼容补充（2026-02-06）

- `eventId` 解析需兼容历史字段：`event_id`、`eventId`、`eventID`。
- 若记录仍缺少事件 ID，前端需基于赛事元信息做兜底匹配后再跳转：
  - 一优先：`title + date + location`
  - 二优先：`title + date`
  - 三优先：`title`
- 仅在匹配失败时才提示「该记录缺少赛事信息」。

---

## Profile 底部操作区规范（2026-02-06）

- 个人页浏览态使用统一底部固定操作区：
  - 默认：仅显示「编辑主页」；
  - 赛事管理角色（`admin`/`coach`/`organizer`）：并列显示「编辑主页」与「新增赛事」。
- 「新增赛事」入口不再放在页面中部卡片，统一收口到底部并列操作，减少操作路径跳转。

---

## 赛事相册功能规范（2026-02-06）

### 功能目标

- 新增赛事级共享相册：参赛者赛后可上传高清照片，参赛者可查看并下载。
- 上传者范围：参赛者 + 管理员/组织者。
- 查看与下载范围：参赛者 + 管理员/组织者。
- 发布策略：上传后自动发布（无需审核流）。

### 后端与接口约束

- BFF 新增接口（`cloudrun/werox-bff/index.js`）：
  - `GET /v1/events/:id/album/summary`
  - `GET /v1/events/:id/album`
  - `POST /v1/events/:id/album/photos`
  - `GET /v1/events/:id/album/photos/:photoId/download`
  - `DELETE /v1/events/:id/album/photos/:photoId`
- 权限判定统一：优先 `user_id` 匹配参赛关系，失败回退 `user_openid`。
- 管理权限角色：`admin` / `organizer`。
- 删除权限：上传者本人或管理员/组织者。

### 数据与迁移约束

- 新增表：`event_album_photos`（见 `scripts/sql/20260206_event_album.sql`）。
- 迁移流程必须遵循低风险步骤：只读探测 -> 建表 -> 列校验 -> 安全规则 -> 验证。
- 安全规则建议：`ADMINWRITE`（业务写入走 BFF，不走前端直写）。
- 已在环境 `werox-mini-program-8die4bd982524` 执行建表与规则写入（2026-02-06）。

### 小程序实现约束

- 新页面：`pages/event-album/event-album`。
- 赛事详情页相册入口：`pages/event-detail/event-detail`。
- API 封装统一在 `utils/api.js`，优先 BFF，后端不可用时本地 fallback。
- 上传策略：
  - 原图上传（高清）作为 `file_id`；
  - 列表使用压缩缩略图 `thumb_file_id` 降低加载成本。
- 下载策略：
  - 先走 BFF 下载接口获取受控地址；
  - 若后端未返回直链，前端对授权后的 `file_id` 做临时链接兜底解析。

### 相册 fallback 约束补充（2026-02-06）

- 当 CloudRun BFF 不可用（`INVALID_HOST`）时：
  - 相册列表与摘要允许走本地只读 fallback；
  - 相册上传与删除禁止本地写入 fallback（避免权限拒绝和越权风险）；
  - 前端应将 `can_upload` 视为 `false` 并提示“上传服务暂不可用”。

