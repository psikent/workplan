# 19 — XLSX 导出流式写路径（内存回预算）

Type: task
Status: ready-for-agent
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

- [ ] 十万行 × 25 列导出：进程内存峰值 ≤512MiB 且时间 ≤60s，perf-benchmark 证据记录在本票 Comments。
- [ ] 导出文件与现有 xlsx 输出逐列逐行一致（导出对账测试保持绿）。
- [ ] 模板导出与自定义列选择行为无回归（server/web 套件全绿，typecheck 通过）。
- [ ] 不引入新的导入兼容性回归（.xls/.xlsx 导入测试保持绿）。

## Comments
