# 微信小程序开发指南 - 与 Web 开发的关键差异

## 📌 什么是微信小程序Mini Program？

微信小程序是运行在微信 App 内部的轻量级应用程序。虽然技术模型与网页相似（使用 JavaScript 和样式语言），但它有自己独特的标签语言和 API 体系。

> **核心理解**：小程序可以视为只能用微信打开和浏览的网站，但底层已被修改，不支持浏览器 API。

---

## 🔄 主要技术差异对比

| 方面 | Web 开发 | 微信小程序 |
|------|----------|------------|
| **结构语言** | HTML | WXML (WeiXin Markup Language) |
| **样式语言** | CSS | WXSS (WeiXin Style Sheets) |
| **脚本语言** | JavaScript | JavaScript (小程序 API) |
| **配置文件** | 无标准 | JSON (`app.json`, `page.json`) |
| **运行环境** | 浏览器 | 微信客户端 |
| **标签名称** | `<div>`, `<span>`, `<p>` | `<view>`, `<text>`, `<button>` |
| **DOM 操作** | 直接操作 DOM | 不支持，使用 `setData()` |

---

## 📁 项目结构

### 基本项目结构

```
project/
├── app.js              # 应用入口，初始化小程序实例
├── app.json            # 全局配置（页面路由、窗口样式）
├── app.wxss            # 全局样式
├── project.config.json # 开发工具配置
└── pages/              # 页面目录
    └── home/           # 单个页面目录
        ├── home.js     # 页面逻辑
        ├── home.wxml   # 页面结构
        ├── home.wxss   # 页面样式
        └── home.json   # 页面配置
```

### 文件类型说明

| 文件后缀 | 作用 | 对应 Web 技术 |
|----------|------|---------------|
| `.wxml` | 页面结构模板 | HTML |
| `.wxss` | 样式表 | CSS |
| `.js` | 逻辑脚本 | JavaScript |
| `.json` | 配置文件 | 无直接对应 |

---

## 🏷️ WXML 标签语言

### 常用标签对照

| HTML 标签 | WXML 标签 | 用途 |
|-----------|-----------|------|
| `<div>` | `<view>` | 容器块元素 |
| `<span>` | `<text>` | 行内文本 |
| `<img>` | `<image>` | 图片 |
| `<a>` | `<navigator>` | 链接/导航 |
| `<input>` | `<input>` | 输入框 |
| `<button>` | `<button>` | 按钮 |

### 数据绑定

使用 `{{ }}` 语法进行数据绑定（类似 Vue.js 或 React）：

```xml
<!-- wxml -->
<view>{{message}}</view>
```

```javascript
// page.js
Page({
  data: {
    message: 'Hello World'
  }
})
```

### 列表渲染

使用 `wx:for` 进行循环渲染：

```xml
<view wx:for="{{array}}" wx:key="index">
  {{index}}: {{item}}
</view>
```

### 条件渲染

使用 `wx:if`, `wx:elif`, `wx:else`：

```xml
<view wx:if="{{type === 'A'}}">A</view>
<view wx:elif="{{type === 'B'}}">B</view>
<view wx:else>C</view>
```

### 模板定义和使用

```xml
<!-- 定义模板 -->
<template name="userCard">
  <view>{{name}} - {{age}}岁</view>
</template>

<!-- 使用模板 -->
<template is="userCard" data="{{...userData}}"></template>
```

---

## 🎨 WXSS 样式

### 与 CSS 的主要差异

1. **响应式单位 `rpx`**
   - 规定屏幕宽度为 750rpx
   - iPhone 6 上：`750rpx = 375px`
   - 自动适配不同屏幕尺寸

   ```css
   .container {
     width: 750rpx;  /* 全屏宽度 */
     padding: 20rpx;
   }
   ```

2. **样式导入**
   ```css
   @import "common.wxss";
   ```

3. **支持的选择器有限**
   - `.class` - 类选择器 ✅
   - `#id` - ID选择器 ✅
   - `element` - 元素选择器 ✅
   - `element, element` - 群组选择器 ✅
   - `::after`, `::before` - 伪元素 ✅
   - 子选择器、后代选择器等部分支持

4. **全局与局部样式**
   - `app.wxss` - 全局样式，所有页面生效
   - `page.wxss` - 局部样式，仅当前页面生效

---

## ⚡ JavaScript 逻辑

### 应用入口 - `app.js`

```javascript
App({
  onLaunch: function() {
    // 小程序启动时执行
  },
  onShow: function() {
    // 小程序显示时执行
  },
  globalData: {
    userInfo: null
  }
})
```

### 页面脚本 - `page.js`

```javascript
Page({
  data: {
    msg: 'Hello'
  },
  
  onLoad: function(options) {
    // 页面加载时执行
  },
  
  onShow: function() {
    // 页面显示时执行
  },
  
  // 事件处理函数
  handleClick: function() {
    this.setData({
      msg: 'World'
    })
  }
})
```

### 事件绑定

使用 `bind` 或 `catch` 前缀绑定事件：

```xml
<button bindtap="handleClick">点击我</button>
<view catchtap="handleTap">阻止冒泡</view>
```

### 核心概念：`setData()`

> ⚠️ **重要**：小程序不支持直接操作 DOM，必须通过 `setData()` 更新页面数据。

```javascript
// ✅ 正确方式
this.setData({
  message: '新内容'
})

// ❌ 错误方式（不会更新页面）
this.data.message = '新内容'
```

---

## ⚙️ 配置文件

### `app.json` - 全局配置

```json
{
  "pages": [
    "pages/index/index",
    "pages/logs/logs"
  ],
  "window": {
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "我的小程序",
    "backgroundColor": "#eeeeee"
  },
  "tabBar": {
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页",
        "iconPath": "icons/home.png",
        "selectedIconPath": "icons/home-active.png"
      }
    ]
  }
}
```

### 页面配置 `page.json`

```json
{
  "navigationBarTitleText": "页面标题",
  "enablePullDownRefresh": true
}
```

### `project.config.json` - 项目配置

```json
{
  "setting": {
    "es6": true,        // ES6 转 ES5
    "postcss": true,    // 样式补全
    "minified": true    // 代码压缩
  },
  "appid": "你的AppID"
}
```

---

## 📱 微信 API

小程序提供了丰富的微信原生能力 API：

### 常用 API 示例

```javascript
// 获取用户信息
wx.getUserProfile({
  desc: '用于展示用户信息',
  success: (res) => {
    console.log(res.userInfo)
  }
})

// 发起网络请求
wx.request({
  url: 'https://api.example.com/data',
  method: 'GET',
  success: (res) => {
    console.log(res.data)
  }
})

// 本地存储
wx.setStorageSync('key', 'value')
const value = wx.getStorageSync('key')

// 扫码
wx.scanCode({
  success: (res) => {
    console.log(res.result)
  }
})

// 支付
wx.requestPayment({
  // 支付参数
})

// 路由导航
wx.navigateTo({ url: '/pages/detail/detail?id=1' })
wx.redirectTo({ url: '/pages/index/index' })
wx.navigateBack()
```

---

## 🚀 开发流程

1. **注册账号**：在[微信公众平台](https://mp.weixin.qq.com/)注册并获取 AppID
2. **下载工具**：安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
3. **创建项目**：使用开发者工具新建或导入项目
4. **开发调试**：在开发者工具中实时预览和调试
5. **真机预览**：使用"预览"或"真机调试"功能
6. **提交审核**：完成开发后提交微信审核
7. **正式发布**：审核通过后发布上线

---

## 💡 开发建议

1. **设计稿标准**：使用 iPhone 6 (375px / 750rpx) 作为设计基准
2. **避免 DOM 思维**：习惯使用 `setData()` 进行数据驱动更新
3. **利用组件库**：微信提供了丰富的[基础组件](https://developers.weixin.qq.com/miniprogram/dev/component/)
4. **合理使用缓存**：利用 `wx.setStorage` 缓存数据减少请求
5. **注意包大小**：小程序主包限制 2MB，分包加载可突破限制

---

## 📚 参考资源

- [微信小程序官方文档](https://developers.weixin.qq.com/miniprogram/dev/framework/)
- [小程序框架参考](https://developers.weixin.qq.com/miniprogram/dev/reference)
- [小程序组件文档](https://developers.weixin.qq.com/miniprogram/dev/component/)
- [小程序 API 文档](https://developers.weixin.qq.com/miniprogram/dev/api/)
- [阮一峰小程序教程](https://www.ruanyifeng.com/blog/2020/10/wechat-miniprogram-tutorial-part-one.html)
