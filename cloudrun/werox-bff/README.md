# WeRox BFF (CloudRun)

统一后端服务，供小程序与 iOS 共用。

## 环境变量

- `TCB_ENV_ID`：CloudBase 环境 ID
- `TCB_API_KEY`：用于 MySQL REST API 的服务端密钥
- `TCB_AUTH_CLIENT_ID`：Auth v2 client id（可选）
- `TCB_AUTH_CLIENT_SECRET`：Auth v2 client secret（可选）
- `TCB_AUTH_PROVIDER_ID`：默认 `wechat`
- `PORT`：默认 `3000`

## API

- `GET /health`
- `POST /v1/auth/mini/resolve`
- `POST /v1/auth/ios/wechat/signin`
- `GET /v1/me`
- `PATCH /v1/me/profile`
- `GET /v1/events`
- `GET /v1/events/:id`
- `GET /v1/events/:id/registration/me`
- `POST /v1/events/:id/registrations`
- `GET /v1/events/:id/album/summary`
- `GET /v1/events/:id/album`
- `POST /v1/events/:id/album/photos`
- `GET /v1/events/:id/album/photos/:photoId/download`
- `DELETE /v1/events/:id/album/photos/:photoId`
- `GET /v1/users/by-openid/:openid`

## 本地运行

```bash
npm install
npm start
```
