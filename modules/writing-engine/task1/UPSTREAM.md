# Task 1 算法交接 v1.0

先读 README.md、docs/TASK1算法与契约.md 和 validation/RESULTS.md。

1. Node.js 24，无第三方依赖，运行 `node verify-package.mjs`、`npm test`、`npm run verify`。
2. 配置自己的服务端 DeepSeek Key，模型默认 deepseek-flash。包内不含 Key 或站点配置。
3. 本包包含199题索引及3题参考事实，不包含原图。真实读图需另行取得用户原始图库（items.json、题目清单.csv、图片/）。
4. 函数入口 src/task1.mjs；请求和评分源数据契约在 schemas/。报告样例由真实调用生成。
5. 分数是未校准的练习估分；三份参考事实由 Agent 对照原图整理，非人类考官审核。自动读图仍可能误读。
6. 宿主负责可信题库、账号权限、首稿身份、数据保存、幂等及限流。不要由浏览器自报首稿或提供参考事实。

这是独立 Task 1 算法快照，不含 Task 2、前端、云部署或原个人／团队作品包。
