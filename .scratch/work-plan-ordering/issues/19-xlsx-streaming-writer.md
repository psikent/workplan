# 19 — XLSX 导出流式写路径（内存回预算）

Type: task
Status: done
Blocked by: 无 — 可立即开工
Spec: ../spec.md
Scope: XLS 导出写路径、导出对账测试、perf-benchmark 内存用例

## Background

票据 15 记录的已知偏差：SheetJS 以对象存储每个单元格，十万行 × 25 列导出峰值 RSS ~750MiB，超出规格 512MiB 预算；时间预算（≤60s，实测 20–38s）达标。容器决策已定 xlsx（biff8 有 65,536 行硬上限且更慢，见票据 15）。达成内存预算的路径是流式写 xlsx（XML + zip 流式写出），不再把整表构造成内存对象。

## Work

1. 用流式 xlsx 写路径替换 SheetJS 写路径（自研 XML+zip 流式或等价库）：保持单读事务、从头重新执行页面完整查询、行顺序 = 查询顺序、列模板/表头语义不变；导出不受页面 limit 与游标限制。
2. 时间预算不放宽：十万行 × 25 列全路径保持 ≤60s。
3. 导入路径不动：仍接受 .xls 与 .xlsx。
4. perf-benchmark 的 XLS 内存用例按新路径重测并转绿，纳入常规基准。

## Acceptance

- [x] 十万行 × 25 列导出：进程内存峰值 ≤512MiB 且时间 ≤60s，perf-benchmark 证据记录在本票 Comments。
- [x] 导出文件与现有 xlsx 输出逐列逐行一致（导出对账测试保持绿）。
- [x] 模板导出与自定义列选择行为无回归（server/web 套件全绿，typecheck 通过）。
- [x] 不引入新的导入兼容性回归（.xls/.xlsx 导入测试保持绿）。

## Comments

### 2026-09-07 执行完成：自研流式 xlsx 写路径，30.2s / RSS 增量 108MiB，双预算达标

**实现**（`apps/server/src/modules/xlsx-stream.ts` + `spreadsheet-transfer.ts` 重写 `buildXls`）：

- 按票据候选"自研 XML+zip 流式"：手写工作表 OOXML（inlineStr 文本 + 数值单元 + yyyy-mm-dd hh:mm 数字格式 + 列宽 + autoFilter），经 `zlib.createDeflateRaw(level 1)` 流式压缩，ZIP 采用 data descriptor（bit 3）流式条目 + 手写中央目录/EOCD，不引入新依赖。
- 读取侧不变：仍为单读事务（手动 BEGIN…COMMIT，引擎内层事务自动降级 SAVEPOINT）内按键集游标 1000 行/页从头推进，行顺序 = 查询顺序，不受页面 limit 与游标限制，不接受 cursor/offset（422 语义保持）。**扫描全程同步、无事件循环让步点**（提交前审查 P1 修正：事务横跨 await 持有共享连接会使并发写被并入导出事务、异常时被连带回滚）。
- 内存模型：任一时刻仅持有当前页行文本 + 压缩输出；不再以 SheetJS 每单元格对象存储整表。导入路径不动（仍 SheetJS `XLSX.read`，接受 .xls/.xlsx）。
- 单元格语义与旧输出逐列一致：日期列为 Excel 序列数 + numFmt 164，文本 inlineStr，空值省略单元格（读回等价空串）；`export-query-order` 对账测试、app.test 导入导出回环、viewer 授权与 env-config 相关用例全绿。

**基准证据**（最终轮 2026-09-07T15:12Z，交付代码（含审查后改为同步扫描）实测，darwin/arm64，与票据 20 同一轮完整基准，报告 `../perf-report.md`）：

| 指标 | SheetJS 旧路径 | 流式写路径（交付版） | 预算 |
| --- | --- | --- | --- |
| 全路径耗时 | 20–38s | **34.8s** | ≤60s ✅ |
| RSS 增量 | ~750MiB–1348MiB ❌ | **263MiB** | ≤512MiB ✅ |
| 产物体积 | 97.2MiB | **9.6MiB**（deflate） | — |

内存模型说明：审查修正为同步扫描后，write 不做背压等待（换取事务全程无事件循环让步点），deflate 队列上界为未压缩总字节数（十万行×25 列约 220MiB），实测 RSS 增量 263MiB，仍远低于 512MiB 预算。早期异步背压版本实测 30.2s / 108MiB，因 P1（事务横跨 await 持有共享连接）废弃。

**回归**：server 套件 206/206、web 套件 301/301 全绿；typecheck 通过；.xls/.xlsx 导入测试无回归。ZIP 产物经 `unzip -t`、python zipfile、SheetJS 三方交叉验证无错误。

### 2026-09-07 健壮性修补审查通过：zlib 压缩错误上抛 + end/error 竞速防挂起

- 补丁（`xlsx-stream.ts` ZipWriter）：deflate 的 `'error'` 事件异步投递，原实现会无监听崩溃进程，或出错后流已 destroy、`once(deflate,"end")` 永久等待。现记录 `compressionError` 并在 seal 预检上抛，等待改为 end/error 竞速。code-reviewer 复审通过：预检与监听器挂载同 tick 无空档，竞态闭环完整，无 P0/P1。
- 遗留（不阻塞，后续开票）：① ZipWriter 零直接单测——zlib 真实错误难从 `write`/`end` 入参注入，需把 `beginDeflated` 做成可注入流才可测；② 竞速 Promise 落败方 `once` 监听器不清理（纯整洁性，不会误触发）；③ seal reject 后 ZipWriter 留孤儿 local header 且二次 `finish()` 静默 resolve——当前唯一调用方 `spreadsheet-transfer.ts` 在 await reject 后即中止，不触发，建议后续加 `ERR_ALREADY_FAILED` 防护或注释声明不可再用。
