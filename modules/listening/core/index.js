/**
 * 判题内核统一出口。
 * 这一层不含任何 DOM / fetch / 存储，可被：
 *   - 浏览器直接 import（本地模式）
 *   - Node 服务端 import（http 模式，判题在服务端）
 *   - React / Vue 组件 import（迁移到应用端时原样复用）
 *   - node:test 直接单测
 */
export * from "./normalize.js";
export * from "./text.js";
export * from "./grade.js";
export * from "./score.js";
export * from "./wrongbook.js";

export const CORE_VERSION = "1.0.0";
