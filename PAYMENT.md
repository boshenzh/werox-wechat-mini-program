# WeRox Payment Integration — Implementation Spec

> **This document is self-contained.** An agent with zero context should be able to implement the full payment feature by reading only this file plus the referenced source files.

---

## 0. Project Context

- **App**: WeRox — a WeChat Mini Program for HYROX event management, registration, social, and photo sharing.
- **AppID**: `wxdaa369fb49c7af17`
- **CloudBase env**: `werox-mini-program-8die4bd982524`
- **Backend**: Express BFF running on CloudRun at `cloudrun/werox-bff/`
- **Mini program calls BFF** via `wx.cloud.callContainer` (wrapper: `utils/backend.js`)
- **Database**: CloudBase MySQL (relational), accessed from BFF via REST API (`/v1/rdb/rest/{table}`)
- **Design system**: Industrial dark theme — primary `#f59e0b`, background `#0b0b0f`, text `#f5f5f0`. See `AGENTS.md` for full spec.
- **Language**: All UI text in Chinese. Code in English.

---

## 1. Current State (What Already Exists)

### 1.1 Database Fields Already Present

**`events` table** has price columns:
- `price_open` — Open division price (in 分, i.e. cents)
- `price_doubles` — Doubles division price
- `price_relay` — Relay division price

**`event_participants` table** has:
- `payment_amount` — Calculated price based on division (populated during registration)
- `payment_status` — Currently hardcoded to `'pending'` for every registration

### 1.2 Price Calculation Logic (Already Implemented)

Both BFF (`cloudrun/werox-bff/routes/registration.js:104-110`) and local fallback (`utils/api.js:388-393`) compute:
```javascript
let paymentAmount = priceOpen;
if (/Doubles/i.test(division)) paymentAmount = priceDoubles;
if (/Relay/i.test(division)) paymentAmount = priceRelay;
```

### 1.3 Registration Flow (Current)

**Frontend** (`pages/event-signup/event-signup.js`):
1. User picks division, optionally fills team name + note
2. `handleSubmit()` calls `createRegistration(eventId, payload)` via `utils/api.js`
3. On success: toast "报名成功", navigate back after 600ms

**BFF** (`cloudrun/werox-bff/routes/registration.js`):
- `POST /v1/events/:id/registrations` → validates input → checks capacity → inserts `event_participants` row with `payment_status: 'pending'`
- Returns `{ registration }` object

**Local fallback** (`utils/api.js:localCreateRegistration`):
- Same logic as BFF but runs client-side when BFF is unavailable

### 1.4 Signup Page UI (`pages/event-signup/event-signup.wxml`)

- Shows event info card with price: `费用 {{event.priceOpen > 0 ? (event.priceOpen / 100) + '元/人' : '免费'}}`
- Submit button text: `确认报名`
- Already-signed state: disabled `已报名` button

---

## 2. Architecture: Key File Map

```
├── utils/
│   ├── api.js               — All API methods (BFF-first, local fallback)
│   ├── backend.js            — wx.cloud.callContainer wrapper (callBackend)
│   ├── normalizers.js        — Data normalization helpers
│   └── analytics.js          — Event tracking (track())
│
├── pages/event-signup/
│   ├── event-signup.js       — Registration page logic
│   ├── event-signup.wxml     — Registration page template
│   └── event-signup.wxss     — Registration page styles
│
├── pages/event-detail/
│   ├── event-detail.js       — Event detail (has "立即报名" CTA)
│   └── event-detail.wxml
│
├── cloudrun/werox-bff/
│   ├── index.js              — Express app, route mounting
│   ├── Dockerfile            — node:20-alpine, npm ci --omit=dev
│   ├── package.json          — express, cors, morgan, express-rate-limit
│   ├── lib/
│   │   ├── config.js         — Env vars: TCB_ENV_ID, TCB_API_KEY, etc.
│   │   ├── cloudbase.js      — cloudbaseFetch, rdbSelect/rdbInsert/rdbUpdate, systemAuthHeader
│   │   ├── helpers.js        — jsonOk/jsonFail, toEq, randomId, sanitizers
│   │   └── identity.js       — resolveIdentityFromRequest, user lookup
│   ├── middleware/
│   │   └── auth.js           — attachIdentity middleware
│   └── routes/
│       ├── registration.js   — GET /v1/events/:id/registration/me, POST /v1/events/:id/registrations
│       ├── events.js         — GET /v1/events, GET /v1/events/:id
│       ├── album.js          — Album CRUD
│       ├── me.js             — GET /v1/me, PATCH /v1/me/profile
│       └── users.js          — Admin user management
│
├── scripts/sql/              — Migration SQL scripts
├── app.json                  — Pages list, tabBar config
└── AGENTS.md                 — Project instructions & design spec
```

### 2.1 BFF Coding Patterns (MUST follow)

**Response format**:
```javascript
// Success:
jsonOk(res, { someData });  // → { success: true, data: { someData } }
// Error:
jsonFail(res, 400, 'ERROR_CODE', '中文消息', { detail: '...' });
```

**DB operations** (from `lib/cloudbase.js`):
```javascript
const authHeader = systemAuthHeader(); // Bearer {TCB_API_KEY}

// SELECT
const rows = await rdbSelect('table_name', {
  select: 'col1,col2',
  col1: toEq(value),  // filter: col1 = value
  limit: 1,
  order: 'created_at.desc',
}, authHeader);

// INSERT
const inserted = await rdbInsert('table_name', { ...payload }, authHeader);

// UPDATE
await rdbUpdate('table_name', { id: toEq(id) }, { ...changes }, authHeader);
```

**Identity** (`req.identity` after `attachIdentity` middleware):
```javascript
req.identity.userId    // BIGINT from app_users
req.identity.openid    // WeChat openid
req.identity.row       // Full users table row
req.identity.row.role  // 'runner' | 'coach' | 'organizer' | 'admin'
```

**Mini program → BFF call** (`utils/backend.js`):
```javascript
const result = await callBackend({
  path: '/v1/some/path',
  method: 'POST',
  data: { key: 'value' },
});
// result = response.data.data (unwrapped from { success, data })
```

**API layer pattern** (`utils/api.js`):
```javascript
// Remote-first with local fallback:
async function someAction(args) {
  return withFallback(
    () => callBackend({ path: '...', method: 'POST', data: args }),
    () => localSomeAction(args),
    'someAction'
  );
}
// IMPORTANT: Payment must NOT have a local fallback. Paid registration MUST go through BFF.
```

---

## 3. Payment Flow Design

### 3.1 Prerequisite: WeChat Pay Merchant Account (Manual Work)

A **商户号 (merchant account)** is required. Without it, `wx.requestPayment` cannot function.

**CloudRun acts as a WeChat Pay service provider** — this is the recommended integration path. It means:
- No certificate management needed
- No signature computation needed
- JSON in/out (not XML)
- Private secure link
- `sub_mch_id` = your merchant ID; CloudRun fills `mch_id`, `appid`, `sign` automatically

### 3.2 End-to-End Flow

```
User → Mini Program → BFF → CloudRun WeChat Pay API → WeChat Pay
                                                           |
User ← wx.requestPayment ← BFF (payment params) ←--------+
   |
   | (user confirms in WeChat Pay UI)
   |
   +----→ WeChat Pay ----→ BFF callback (/v1/payment/callback)
                                  |
                                  +→ Update DB: payment_status = 'paid'
```

**Step-by-step:**

1. User fills signup form, taps "报名并支付 ¥X"
2. Frontend calls `createRegistration(eventId, payload)` — same as today
3. BFF creates `event_participants` row with `payment_status = 'pending'` + creates `payment_orders` row
4. BFF calls CloudRun's wrapped **Unified Order (统一下单)** API
5. Unified Order returns a `payment` object containing `{ timeStamp, nonceStr, package, signType, paySign }`
6. BFF returns `{ registration, payment }` to frontend
7. Frontend calls `wx.requestPayment(payment)` — WeChat Pay UI appears
8. User confirms payment
9. WeChat Pay asynchronously POSTs result to BFF callback endpoint
10. BFF callback updates `payment_orders.status = 'paid'` and `event_participants.payment_status = 'paid'`
11. Frontend receives `wx.requestPayment` success callback, shows confirmation

**Free events** (`payment_amount == 0`): skip steps 3d-10, set `payment_status = 'free'`, return `{ registration }` without `payment`. Frontend flow identical to today.

---

## 4. Database Migration

Create file: `scripts/sql/20260208_payment_orders.sql`

```sql
-- Payment orders table
CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  _openid VARCHAR(64) DEFAULT '' NOT NULL,
  registration_id BIGINT NOT NULL,
  event_id BIGINT NOT NULL,
  user_id BIGINT NULL,
  user_openid VARCHAR(64) NOT NULL DEFAULT '',

  out_trade_no VARCHAR(64) NOT NULL,
  amount_total INT NOT NULL,                  -- in 分 (cents)
  currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
  description VARCHAR(256) NOT NULL DEFAULT '',

  prepay_id VARCHAR(128) NULL,
  transaction_id VARCHAR(64) NULL,

  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  -- pending → paying → paid → refund_requested → refunded → failed → cancelled
  paid_at TIMESTAMP NULL,
  callback_raw TEXT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_out_trade_no (out_trade_no),
  INDEX idx_po_registration (registration_id),
  INDEX idx_po_event (event_id),
  INDEX idx_po_user (user_id),
  INDEX idx_po_status (status)
);

-- Add payment tracking columns to event_participants
ALTER TABLE event_participants
  ADD COLUMN IF NOT EXISTS payment_order_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS payment_transaction_id VARCHAR(64) NULL,
  ADD INDEX IF NOT EXISTS idx_ep_payment (payment_order_id);
```

**Run via MCP** `executeWriteSQL` or CloudBase console. Follow the low-risk migration pattern described in `AGENTS.md`: read structure first → create table → verify → add columns → verify.

---

## 5. Backend Implementation

### 5.1 New Config Vars (`cloudrun/werox-bff/lib/config.js`)

Add:
```javascript
const WX_PAY_MCH_ID = process.env.WX_PAY_MCH_ID || '';
const WX_PAY_API_V3_KEY = process.env.WX_PAY_API_V3_KEY || '';
const WX_PAY_NOTIFY_PATH = process.env.WX_PAY_NOTIFY_PATH || '/v1/payment/callback';
```

Export them. Add warning if empty.

### 5.2 New File: `cloudrun/werox-bff/lib/wxpay.js`

WeChat Pay helper that calls the **CloudRun-wrapped unified order API**.

The CloudRun WeChat Pay internal endpoint:
```
POST http://{env}.internal.ap-shanghai.tcb-api.tencentcloudapi.com/wxa/pay/unifiedorder
```

Or use the **CloudRun container-internal path** (simpler — since BFF runs inside CloudRun):
```
POST /wxa/pay/unifiedorder
```

Key fields for unified order request:
```json
{
  "sub_mch_id": "<your merchant id>",
  "sub_appid": "wxdaa369fb49c7af17",
  "body": "WeRox赛事报名 - {event_title}",
  "out_trade_no": "WEROX_{eventId}_{timestamp}_{random}",
  "total_fee": 9900,        // in 分
  "spbill_create_ip": "127.0.0.1",
  "trade_type": "JSAPI",
  "openid": "<user openid>",
  "callback_url": "/v1/payment/callback",
  "env_id": "werox-mini-program-8die4bd982524",
  "container": {
    "service": "werox-bff",
    "path": "/v1/payment/callback"
  }
}
```

The response will contain a `payment` field ready for `wx.requestPayment`.

### 5.3 New File: `cloudrun/werox-bff/routes/payment.js`

**Route 1: Payment callback** (no auth — called by WeChat Pay system)
```
POST /v1/payment/callback
```
- Parse body: check `event_type === 'TRANSACTION.SUCCESS'`
- If using APIv3 encryption: decrypt `resource` using `WX_PAY_API_V3_KEY`
- Extract `out_trade_no`, `transaction_id`
- Update `payment_orders`: `status = 'paid'`, `transaction_id`, `paid_at = NOW()`, `callback_raw = JSON.stringify(body)`
- Update `event_participants`: `payment_status = 'paid'`, `payment_transaction_id`
- **Return `{ errcode: 0 }`** (CRITICAL — or WeChat retries for 48hrs)
- Handle idempotency: if already `paid`, return `{ errcode: 0 }` without error

**Route 2: Query payment status**
```
GET /v1/payment/orders/:outTradeNo  (attachIdentity)
```
- Select from `payment_orders` where `out_trade_no = :outTradeNo`
- Verify requester owns the order (by user_id or openid)
- Return `{ order: { status, amount_total, transaction_id, paid_at } }`

### 5.4 Modify: `cloudrun/werox-bff/routes/registration.js`

In `POST /v1/events/:id/registrations`:

After calculating `paymentAmount` (line ~108):

```javascript
if (paymentAmount > 0) {
  // 1. Insert event_participants with payment_status='pending'
  // 2. Generate out_trade_no
  // 3. Insert payment_orders row
  // 4. Call unified order API
  // 5. Return { registration, payment: unifiedOrderResult.payment }
} else {
  // Free event: insert with payment_status='free', return { registration }
}
```

### 5.5 Mount New Routes (`cloudrun/werox-bff/index.js`)

```javascript
const paymentRoutes = require('./routes/payment');

// Payment callback (NO rate limit, NO auth — WeChat Pay system calls this)
app.use(paymentRoutes);
```

### 5.6 New Dependency

If using CloudRun's built-in wrapper, no new npm dependencies are needed.

If using direct V3 API: `npm install wechatpay-node-v3` (add to `cloudrun/werox-bff/package.json`).

---

## 6. Frontend Implementation

### 6.1 Modify: `utils/api.js`

**Change `createRegistration`** — payment MUST NOT have local fallback:

```javascript
async function createRegistration(eventId, payload) {
  // For paid events, always go through BFF (no local fallback)
  try {
    return await callBackend({
      path: `/v1/events/${eventId}/registrations`,
      method: 'POST',
      data: payload,
    });
  } catch (err) {
    // Only fall back to local for FREE events when backend is unavailable
    if (isBackendUnavailableError(err)) {
      // Check if this is likely a free event
      // If we can't determine, throw — don't risk free registration for paid events
      throw new Error('报名服务暂不可用，请稍后重试');
    }
    throw err;
  }
}
```

**Add new method**:
```javascript
async function queryPaymentStatus(outTradeNo) {
  return callBackend({
    path: `/v1/payment/orders/${outTradeNo}`,
    method: 'GET',
  });
}
```

Export it.

### 6.2 Modify: `pages/event-signup/event-signup.js`

Change `handleSubmit()`:

```javascript
async handleSubmit() {
  // ... existing validation ...

  this.setData({ submitting: true });
  track('signup_submit', { event_id: String(this.data.eventId), division: this.data.form.division });

  try {
    const result = await createRegistration(this.data.eventId, {
      division: this.data.form.division,
      team_name: this.data.form.teamName || '',
      note: this.data.form.note || '',
    });

    // Check if payment is required
    if (result && result.payment) {
      // Paid event — invoke WeChat Pay
      track('payment_start', { event_id: String(this.data.eventId) });
      try {
        await wx.requestPayment({
          timeStamp: result.payment.timeStamp,
          nonceStr: result.payment.nonceStr,
          package: result.payment.package,
          signType: result.payment.signType || 'RSA',
          paySign: result.payment.paySign,
        });
        // Payment success (user confirmed)
        wx.showToast({ title: '报名成功', icon: 'success' });
        this.setData({ isSigned: true });
        track('signup_success', { event_id: String(this.data.eventId), paid: true });
        setTimeout(() => wx.navigateBack(), 600);
      } catch (payErr) {
        // User cancelled or payment failed
        const msg = payErr && payErr.errMsg || '';
        if (msg.includes('cancel')) {
          wx.showToast({ title: '支付已取消，报名未完成', icon: 'none', duration: 2500 });
          track('payment_cancel', { event_id: String(this.data.eventId) });
        } else {
          wx.showToast({ title: '支付失败，请重试', icon: 'none' });
          track('payment_fail', { event_id: String(this.data.eventId), reason: msg });
        }
        // Registration exists with payment_status='pending' — user can retry later
      }
    } else {
      // Free event — same as current flow
      wx.showToast({ title: '报名成功', icon: 'success' });
      this.setData({ isSigned: true });
      track('signup_success', { event_id: String(this.data.eventId), paid: false });
      setTimeout(() => wx.navigateBack(), 600);
    }
  } catch (err) {
    // ... existing error handling ...
  } finally {
    this.setData({ submitting: false });
  }
},
```

### 6.3 Modify: `pages/event-signup/event-signup.wxml`

Change the submit button to show price:

```xml
<!-- Replace the existing action-row -->
<view class="action-row">
  <button class="primary-btn submit-btn" loading="{{submitting}}" bindtap="handleSubmit"
          wx:if="{{!isSigned}}">
    {{computedPrice > 0 ? '报名并支付 ¥' + computedPriceYuan : '免费报名'}}
  </button>
  <button class="ghost-btn signed-btn" wx:else disabled>已报名</button>
</view>
```

Add computed price data in JS (update on division change):
```javascript
// In data:
computedPrice: 0,       // in 分
computedPriceYuan: '0',  // formatted for display

// In handleDivisionChange, after setting division:
updateComputedPrice() {
  const event = this.data.event;
  if (!event) return;
  const division = this.data.form.division;
  let price = event.priceOpen || 0;
  if (/Doubles/i.test(division)) price = event.priceDoubles || 0;
  if (/Relay/i.test(division)) price = event.priceRelay || 0;
  this.setData({
    computedPrice: price,
    computedPriceYuan: (price / 100).toFixed(price % 100 === 0 ? 0 : 2),
  });
},
```

### 6.4 Modify: `pages/event-signup/event-signup.wxss`

Add a payment summary style (optional, near `.confirm-tip`):
```css
.payment-summary {
  padding: 16rpx 18rpx;
  border-radius: 16rpx;
  border: 1px solid rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.08);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.payment-amount {
  font-size: 36rpx;
  font-weight: 700;
  color: #f59e0b;
}
```

---

## 7. Security Rules

- `payment_orders` table: set security rule to `ADMINWRITE` (all writes go through BFF, not client SDK)
- Run via MCP: `writeSecurityRule({ resourceType: 'sqlDatabase', resourceId: 'payment_orders', aclTag: 'ADMINWRITE' })`

---

## 8. Manual Setup Checklist (Required Before Coding Works End-to-End)

| # | Task | Who | Where |
|---|------|-----|-------|
| 1 | Register WeChat Pay merchant account | Business owner | https://pay.weixin.qq.com |
| 2 | Complete identity verification (营业执照 + bank account) | Business owner | WeChat Pay platform |
| 3 | Bind merchant to AppID `wxdaa369fb49c7af17` | Business owner | 商户平台 → 产品中心 → AppID账号管理 |
| 4 | Accept binding in MP admin console | Mini program admin | https://mp.weixin.qq.com |
| 5 | Set APIv3 key | Business owner | 商户平台 → 账户中心 → API安全 |
| 6 | Configure CloudRun WeChat Pay | Developer | 云托管控制台 → 微信支付 → 填入 sub_mch_id |
| 7 | Accept CloudRun service provider auth | Business owner | 商户平台 (authorization invite) |
| 8 | Set callback service = `werox-bff`, path = `/v1/payment/callback` | Developer | 云托管控制台 → 微信支付 |
| 9 | Add BFF env vars | Developer | CloudRun env config |
| 10 | Run DB migration | Developer | MCP `executeWriteSQL` or CloudBase console |
| 11 | Set security rule for `payment_orders` | Developer | MCP `writeSecurityRule` |
| 12 | Deploy updated BFF | Developer | MCP `manageCloudRun` deploy |

**Env vars to add to CloudRun `werox-bff`:**
```
WX_PAY_MCH_ID=<merchant_id>
WX_PAY_API_V3_KEY=<apiv3_key>
WX_PAY_NOTIFY_PATH=/v1/payment/callback
```

---

## 9. Testing Plan

1. **Unit**: BFF payment route logic with mocked CloudRun pay API
2. **Free event**: Verify no payment flow triggers when `price == 0`
3. **Sandbox**: Use WeChat Pay sandbox (¥0.01 amounts) for real integration test
4. **Edge cases**:
   - User closes app mid-payment → registration exists with `pending`, callback still fires
   - Duplicate callback → idempotent (already `paid` → return `errcode: 0`)
   - Network timeout after `wx.requestPayment` success → callback updates DB regardless
   - Event capacity full during payment window → registration was already created, valid
   - BFF down → frontend shows "报名服务暂不可用" (no local fallback for paid events)

---

## 10. Future Phases (Not in Initial Scope)

| Phase | Feature |
|-------|---------|
| Refund | Admin-initiated refund via WeChat Pay Refund API |
| Auto-cancel | Cron: cancel unpaid orders after 30 minutes, release registration slot |
| Payment status page | Dedicated page showing payment details + retry for pending orders |
| Profit sharing | 分账 API for multi-organizer settlement |
| Payment history | User profile shows payment history |

---

## 11. Key References

- [CloudRun WeChat Pay Guide](https://developers.weixin.qq.com/miniprogram/dev/wxcloudrun/src/guide/weixin/pay.html)
- [CloudRun Unified Order API](https://developers.weixin.qq.com/miniprogram/dev/wxcloudrun/src/development/pay/order/unified.html)
- [CloudRun Payment Callback](https://developers.weixin.qq.com/miniprogram/dev/wxcloudrun/src/development/pay/callback/)
- [wx.requestPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html)
- [WeChat Pay Merchant Registration](https://pay.weixin.qq.com/index.php/apply/applyment_home/guide_normal)
- [CloudBase MCP Knowledge Base](Use `searchKnowledgeBase` tool with mode=vector, id=cloudbase)

---

## 12. FAQ

**Q: Can we build without a 商户号?**
A: You can build all the code (DB, BFF routes, frontend UI), but `wx.requestPayment` will fail without a real merchant account. Free events work without it.

**Q: Does the organizer receive the money directly?**
A: The entity behind the merchant account receives WeChat Pay settlements (T+1). If WeRox platform holds the merchant account, use 分账 (profit sharing) to forward to organizers.

**Q: Should payment have a local fallback like other features?**
A: **No.** Paid registration MUST go through BFF to ensure payment integrity. Only free event registration may fall back to local.

**Q: What if callback never arrives?**
A: WeChat Pay retries for 48 hours. Add a manual "query order status" button as a safety net (BFF calls WeChat Pay query order API directly).
