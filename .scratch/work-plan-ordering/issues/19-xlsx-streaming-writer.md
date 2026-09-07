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
- 读取侧不变：仍为单读事务（手动 BEGIN…COMMIT，引擎内层事务自动降级 SAVEPOINT）内按键集游标 1000 行/页从头推进，行顺序 = 查询顺序，不受页面 limit 与游标限制，不接受 cursor/offset（422 语义保持）。
- 内存模型：任一时刻仅持有当前页行文本 + 压缩输出（背压 await drain），deflate 写入经 `once(deflate,"drain")` 背压；不再以 SheetJS 每单元格对象存储整表。导入路径不动（仍 SheetJS `XLSX.read`，接受 .xls/.xlsx）。
- 单元格语义与旧输出逐列一致：日期列为 Excel 序列数 + numFmt 164，文本 inlineStr，空值省略单元格（读回等价空串）；`export-query-order` 对账测试、app.test 导入导出回环、viewer 授权与 env-config 相关用例全绿。

**基准证据**（2026-09-07T13:42Z，darwin/arm64，与票据 20 同一轮完整基准，报告 `../perf-report.md`）：

| 指标 | SheetJS 旧路径 | 流式写路径 | 预算 |
| --- | --- | --- | --- |
| 全路径耗时 | 20–38s | **30.2s** | ≤60s ✅ |
| RSS 增量 | ~750MiB–1348MiB ❌ | **108MiB** | ≤512MiB ✅ |
| 产物体积 | 97.2MiB | **9.6MiB**（deflate） | — |

**回归**：server 套件 206/206、web 套件 301/301 全绿；typecheck 通过；.xls/.xlsx 导入测试无回归。ZIP 产物经 `unzip -t`、python zipfile、SheetJS 三方交叉验证无错误。
