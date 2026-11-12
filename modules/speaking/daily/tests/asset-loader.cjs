/* 测试用资产加载器
 * dist/ 内的前端脚本按「浏览器全局脚本」编写：挂在 window.SL 上，顺带兼容 CommonJS。
 * 这里用 vm 建一个带 window 的独立上下文，同一进程内共享，模拟浏览器多个 <script> 共用一个全局。
 * 返回各脚本自己导出的对象（数据层 / 引擎层），同时暴露共享的 SL 供契约断言使用。
 */
const fs = require('fs');
const vm = require('vm');

let sandbox = null;

function shared() {
  if (sandbox) return sandbox;
  sandbox = { module: { exports: {} }, exports: {}, console };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function loadAsset(file) {
  const box = shared();
  box.module = { exports: {} };
  box.exports = box.module.exports;
  vm.runInContext(fs.readFileSync(file, 'utf8'), box, { filename: file });
  return box.module.exports;
}

loadAsset.SL = () => shared().SL;
module.exports = loadAsset;
