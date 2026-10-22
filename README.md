# TablePeace

中文小组决策网站。成员分别填写时间、预算、环境要求；系统只展示匿名冲突数。组织者可以组合已有地点和时间，发布新方案，再请每位成员确认。

## 两个入口

- `docs/`：GitHub Pages 的中文产品演示。使用明确标注的虚构样例，不保存多人数据。
- 根目录真实应用：Cloudflare Worker 托管页面与 API，D1 保存房间和成员输入。`/new` 建房，邀请链接 `/r/:id` 跨设备加入。

AI 解析暂不在真实应用中开放。成员自行填写条件；兼容性使用确定性规则计算。

## 本地运行 Worker

需要 Node.js 20 或更新版本。首次运行：

```bash
npm install
npm run db:local
npm run dev
```

打开 <http://localhost:8787/>。另开终端运行 `npm run test:worker`，验证独立会话、隐私、冲突重组、确认和版本失效。`npm run dev` 和 `npm run deploy` 会把根目录前端文件同步到 `public/`。

## Cloudflare 部署

1. 在 Cloudflare 登录后执行 `npx wrangler login`。
2. 执行 `npx wrangler d1 create tablepeace-live`，将返回的 `database_id` 写入 `wrangler.jsonc`。
3. 执行 `npm run db:remote` 创建表。
4. 执行 `npm run deploy`。部署返回的 `workers.dev` 地址就是多人应用入口。
5. 用不同设备或浏览器会话分别加入同一邀请链接，验证真实流程。

不要在仓库保存 API Key。D1 记录房间、方案、匿名会话标识和私人条件。浏览器只保存随机会话 Cookie；数据库只保存其 SHA-256 摘要。成员只能读取自己的完整条件；组织者和成员可以读取汇总；访客不能读取汇总。丢失浏览器会话后，昵称无法恢复权限。

## 演示路径

1. 在 GitHub Pages 看预设的四人示例，明确说明它是虚构样例。
2. 在真实应用建房，三位成员从不同浏览器加入。
3. 让三个原方案分别产生 3／1／2 人冲突。
4. 将图书馆地点与 18:00 时间组合，得到 0 个已记录冲突。
5. 组织者核实场地并写备注，再发起确认。三位成员分别点击确认，才会显示全员确认。

“兼容”表示已提交的硬性条件没有冲突；“核实”表示组织者记录了场地检查；“确认”表示每位成员对同一版本方案明确回应。这三种状态分开显示。

仓库还保留 `server.py` 和 SQLite 实现，供无 Cloudflare 账号时在本机运行。`render.yaml` 和 `Dockerfile` 是此前的 Render 配置，不参与 Worker 部署。
