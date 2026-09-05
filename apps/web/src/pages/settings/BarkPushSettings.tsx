import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BarkConfig, BarkTestPushResponse } from "@workplan/contracts";
import { BellRing, Save, Send } from "lucide-react";
import { useToast } from "../../components/ToastProvider";
import { api, jsonBody } from "../../lib/api";

export default function BarkPushSettings() {
  const { showSuccess } = useToast();
  const barkQuery = useQuery({
    queryKey: ["bark-config"],
    queryFn: () => api<BarkConfig>("/settings/bark"),
  });
  const [serverUrl, setServerUrl] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [testResult, setTestResult] = useState<BarkTestPushResponse | null>(null);

  useEffect(() => {
    if (!barkQuery.data) return;
    setServerUrl(barkQuery.data.serverUrl);
    setDeviceKey(barkQuery.data.deviceKey ?? "");
  }, [barkQuery.data?.serverUrl, barkQuery.data?.deviceKey]);

  const saveMutation = useMutation({
    mutationFn: () => api<BarkConfig>("/settings/bark", {
      method: "PUT",
      ...jsonBody({ serverUrl: serverUrl.trim(), deviceKey: deviceKey.trim() }),
    }),
    onSuccess: (saved) => {
      setServerUrl(saved.serverUrl);
      setDeviceKey(saved.deviceKey ?? "");
      setTestResult(null);
      showSuccess("Bark 配置已保存");
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api<BarkTestPushResponse>("/settings/bark/test", { method: "POST" }),
    onSuccess: setTestResult,
    onError: (caught) => setTestResult({ success: false, message: caught instanceof Error ? caught.message : "测试推送失败" }),
  });

  // 测试端点验证的是已保存配置：表单有未保存修改时先保存再测试，
  // 避免用户改完 URL 未保存就点测试、结果与所见配置不符。
  const formDirty = barkQuery.data !== undefined
    && (serverUrl.trim() !== barkQuery.data.serverUrl || deviceKey.trim() !== (barkQuery.data.deviceKey ?? ""));

  async function runTestPush() {
    saveMutation.reset();
    setTestResult(null);
    try {
      if (formDirty) await saveMutation.mutateAsync();
      setTestResult(await testMutation.mutateAsync());
    } catch {
      // 失败反馈已由 saveMutation.error / testMutation.onError 呈现
    }
  }

  function submitSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveMutation.reset();
    setTestResult(null);
    saveMutation.mutate();
  }

  const busy = barkQuery.isLoading || saveMutation.isPending || testMutation.isPending;

  return (
    <section className="settings-section bark-settings-section">
      <header>
        <div><BellRing /><span><strong>Bark 推送</strong><small>每日 09:30 向配置的 Bark 设备推送检修单提醒；设备 Key 留空则关闭推送。</small></span></div>
      </header>
      <form className="bark-settings-form" onSubmit={submitSave}>
        <label>服务器 URL<input aria-label="Bark 服务器 URL" maxLength={2000} required disabled={busy} value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://api.day.app" /></label>
        <label>设备 Key<input aria-label="Bark 设备 Key" maxLength={200} disabled={busy} value={deviceKey} onChange={(event) => setDeviceKey(event.target.value)} placeholder="留空则关闭推送" /></label>
        <div className="bark-settings-actions">
          <button className="primary-button" type="submit" disabled={saveMutation.isPending || !serverUrl.trim() || barkQuery.isLoading}><Save />{saveMutation.isPending ? "保存中…" : "保存配置"}</button>
          <button className="secondary-button" type="button" disabled={busy || barkQuery.isLoading} title={formDirty ? "将先保存当前修改再发送测试" : "按已保存的配置发送测试"} onClick={() => void runTestPush()}><Send />{testMutation.isPending ? "发送中…" : "发送测试推送"}</button>
        </div>
      </form>
      {saveMutation.error ? <div className="form-error bark-settings-error">{saveMutation.error.message}</div> : null}
      {testResult ? (
        <div className={`bark-test-result ${testResult.success ? "ok" : "error"}`} role="status">{testResult.message}</div>
      ) : null}
    </section>
  );
}
