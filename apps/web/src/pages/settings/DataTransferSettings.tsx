import { useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Download, Upload } from "lucide-react";
import { useToast } from "../../components/ToastProvider";
import { api, downloadExport, jsonBody } from "../../lib/api";

export default function DataTransferSettings() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const [importMessage, setImportMessage] = useState("");

  async function exportFile() {
    setImportMessage("");
    try {
      await downloadExport();
      showSuccess("JSON 已导出");
    } catch (caught) {
      setImportMessage(caught instanceof Error ? caught.message : "导出失败");
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportMessage("正在校验…");
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      await api("/import/validate", { method: "POST", ...jsonBody(payload) });
      if (!window.confirm("导入会替换全部业务数据，管理员账户和令牌不受影响。继续吗？")) {
        setImportMessage("已取消导入");
        return;
      }
      await api("/import", { method: "POST", ...jsonBody(payload) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["work-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["custom-fields"] }),
        queryClient.invalidateQueries({ queryKey: ["owner-account-mappings"] }),
      ]);
      setImportMessage("导入完成");
      showSuccess("数据导入成功");
    } catch (caught) {
      setImportMessage(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <section className="settings-section">
      <header><div><DatabaseBackup /><span><strong>数据导入导出</strong><small>版本化 JSON 包含全部工作计划、自定义字段、负责人账号映射和重复规则。</small></span></div></header>
      <div className="settings-actions"><button className="secondary-button" type="button" onClick={() => void exportFile()}><Download />导出 JSON</button><label className="secondary-button file-button"><Upload />导入 JSON<input type="file" accept="application/json,.json" onChange={(event) => void importFile(event)} /></label>{importMessage ? <span>{importMessage}</span> : null}</div>
    </section>
  );
}
