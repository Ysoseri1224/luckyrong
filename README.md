# luckyrong

`luckyrong.ysoseri.us` 的首页使用 Bridgetown 2.x 生成，保留现有 Cloudflare Worker 对 `/together/`、`/cet6/` 和 `/timeline/` 的转发。

## 本地开发

需要 Ruby 3.3 及 Bundler：

```sh
bundle install
bundle exec bridgetown start
```

打开 `http://localhost:4000/` 查看首页。

Bridgetown 的开发服务器依赖 `fork()`，Windows 原生环境请改为先构建，再用任意静态服务器预览 `output/`：

```powershell
bundle exec bridgetown build
python -m http.server 4000 --directory output
```

## 构建

```sh
bundle exec bridgetown build
```

Bridgetown 将静态文件写入 `output/`。首页的数据位于 `src/_data/`，页面模板位于 `src/index.html.erb`，实时钟表与日期弹窗仍由 `src/assets/ruby.js` 在浏览器中运行。

## 部署

`.github/workflows/deploy.yml` 使用 Ruby 3.3 构建 Bridgetown，再把 `output/` 发布到 Cloudflare Pages 项目 `luckyrong`。工作流需要仓库 Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
