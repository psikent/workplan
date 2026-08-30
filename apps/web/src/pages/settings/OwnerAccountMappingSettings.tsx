import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomFieldDefinition, OwnerAccountMapping } from "@workplan/contracts";
import { Pencil, Plus, Save, Trash2, UsersRound, X } from "lucide-react";
import { useToast } from "../../components/ToastProvider";
import { api, jsonBody } from "../../lib/api";

type MappingUpdate = {
  currentOwnerName: string;
  mapping: OwnerAccountMapping;
};

export default function OwnerAccountMappingSettings() {
  const queryClient = useQueryClient();
  const { showSuccess } = useToast();
  const mappingsQuery = useQuery({
    queryKey: ["owner-account-mappings"],
    queryFn: () => api<OwnerAccountMapping[]>("/owner-account-mappings"),
  });
  const fieldsQuery = useQuery({
    queryKey: ["custom-fields"],
    queryFn: () => api<CustomFieldDefinition[]>("/custom-fields"),
  });
  const [ownerName, setOwnerName] = useState("");
  const [account, setAccount] = useState("");
  const [editingOwnerName, setEditingOwnerName] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<OwnerAccountMapping | null>(null);

  const mappings = mappingsQuery.data ?? [];
  const ownerField = fieldsQuery.data?.find((field) => field.key === "owner" && !field.archivedAt);
  const ownerOptionNames = (ownerField?.options ?? [])
    .filter((option) => !option.archivedAt)
    .map((option) => option.label);
  const ownerOptionNameSet = new Set(ownerOptionNames);
  const mappingByOwnerName = new Map(mappings.map((mapping) => [mapping.ownerName, mapping]));
  const unmappedOwnerNames = ownerOptionNames.filter((name) => !mappingByOwnerName.has(name));

  async function invalidateDerivedAccounts() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["owner-account-mappings"] }),
      queryClient.invalidateQueries({ queryKey: ["work-plans"] }),
    ]);
  }

  const createMapping = useMutation({
    mutationFn: (mapping: OwnerAccountMapping) => api<OwnerAccountMapping>("/owner-account-mappings", {
      method: "POST",
      ...jsonBody(mapping),
    }),
    onSuccess: async () => {
      setOwnerName("");
      setAccount("");
      await invalidateDerivedAccounts();
      showSuccess("负责人账号映射已创建");
    },
  });
  const updateMapping = useMutation({
    mutationFn: ({ currentOwnerName, mapping }: MappingUpdate) => api<OwnerAccountMapping>(
      `/owner-account-mappings/${encodeURIComponent(currentOwnerName)}`,
      { method: "PUT", ...jsonBody(mapping) },
    ),
    onSuccess: async () => {
      setEditingOwnerName(null);
      setEditDraft(null);
      await invalidateDerivedAccounts();
      showSuccess("负责人账号映射已保存");
    },
  });
  const deleteMapping = useMutation({
    mutationFn: (name: string) => api<void>(`/owner-account-mappings/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: async (_data, deletedOwnerName) => {
      if (editingOwnerName === deletedOwnerName) {
        setEditingOwnerName(null);
        setEditDraft(null);
      }
      await invalidateDerivedAccounts();
      showSuccess("负责人账号映射已删除");
    },
  });

  function submitNewMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateMapping.reset();
    deleteMapping.reset();
    createMapping.mutate({ ownerName: ownerName.trim(), account: account.trim() });
  }

  function beginEdit(mapping: OwnerAccountMapping) {
    createMapping.reset();
    updateMapping.reset();
    deleteMapping.reset();
    setEditingOwnerName(mapping.ownerName);
    setEditDraft({ ...mapping });
  }

  function cancelEdit() {
    updateMapping.reset();
    setEditingOwnerName(null);
    setEditDraft(null);
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingOwnerName || !editDraft) return;
    createMapping.reset();
    deleteMapping.reset();
    updateMapping.mutate({
      currentOwnerName: editingOwnerName,
      mapping: { ownerName: editDraft.ownerName.trim(), account: editDraft.account.trim() },
    });
  }

  function confirmDelete(name: string) {
    if (!window.confirm(`删除“${name}”的账号映射后，相关工作计划将立即显示为未配置。继续吗？`)) return;
    createMapping.reset();
    updateMapping.reset();
    deleteMapping.mutate(name);
  }

  const mutationError = createMapping.error ?? updateMapping.error ?? deleteMapping.error;

  return (
    <section className="settings-section owner-account-mapping-section">
      <header>
        <div><UsersRound /><span><strong>工作负责人账号映射</strong><small>维护负责人姓名与 4A 账号的对应关系；工作计划会实时派生，只读且不单独保存。</small></span></div>
        <span className="mapping-count">{mappings.length} 条映射</span>
      </header>

      {fieldsQuery.isError ? (
        <div className="mapping-coverage mapping-coverage-error">负责人选项加载失败，暂时无法核对映射覆盖情况。</div>
      ) : fieldsQuery.isLoading ? (
        <div className="mapping-coverage">正在核对负责人选项…</div>
      ) : unmappedOwnerNames.length > 0 ? (
        <div className="mapping-coverage">
          <strong>待配置负责人</strong>
          <span>{unmappedOwnerNames.map((name) => (
            <button key={name} type="button" onClick={() => setOwnerName(name)}>为 {name} 配置</button>
          ))}</span>
        </div>
      ) : (
        <div className="mapping-coverage mapping-coverage-complete">当前负责人选项均已配置账号。</div>
      )}

      <form className="owner-mapping-create" onSubmit={submitNewMapping}>
        <label>工作负责人<input aria-label="新增映射工作负责人" list="owner-account-owner-options" maxLength={80} required value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="输入姓名" /></label>
        <datalist id="owner-account-owner-options">{ownerOptionNames.map((name) => <option key={name} value={name} />)}</datalist>
        <label>工作负责人账号<input aria-label="新增映射工作负责人账号" type="email" maxLength={254} required value={account} onChange={(event) => setAccount(event.target.value)} placeholder="name@zh.gd.csg.cn" /></label>
        <button className="primary-button" type="submit" disabled={createMapping.isPending || !ownerName.trim() || !account.trim()}><Plus />新增映射</button>
      </form>

      {mutationError ? <div className="form-error owner-mapping-error">{mutationError.message}</div> : null}

      {mappingsQuery.isError ? (
        <div className="empty-state"><p>映射表加载失败，请稍后重试。</p></div>
      ) : mappingsQuery.isLoading ? (
        <div className="empty-state"><p>正在载入映射表…</p></div>
      ) : mappings.length === 0 ? (
        <div className="empty-state"><p>尚未配置任何负责人账号映射。</p></div>
      ) : (
        <div className="owner-mapping-table-wrap">
          <table className="owner-mapping-table">
            <thead><tr><th>工作负责人</th><th>工作负责人账号</th><th>负责人选项状态</th><th>操作</th></tr></thead>
            <tbody>{mappings.map((mapping) => {
              const editing = editingOwnerName === mapping.ownerName && editDraft;
              return editing ? (
                <tr key={mapping.ownerName}>
                  <td colSpan={4}>
                    <form className="owner-mapping-edit" onSubmit={submitEdit}>
                      <input aria-label={`编辑 ${mapping.ownerName} 的工作负责人`} list="owner-account-owner-options" maxLength={80} required value={editing.ownerName} onChange={(event) => setEditDraft({ ...editing, ownerName: event.target.value })} />
                      <input aria-label={`编辑 ${mapping.ownerName} 的工作负责人账号`} type="email" maxLength={254} required value={editing.account} onChange={(event) => setEditDraft({ ...editing, account: event.target.value })} />
                      <span className="owner-mapping-row-actions">
                        <button className="primary-button compact-button" type="submit" disabled={updateMapping.isPending || !editing.ownerName.trim() || !editing.account.trim()}><Save />保存</button>
                        <button className="secondary-button compact-button" type="button" aria-label={`取消编辑 ${mapping.ownerName}`} onClick={cancelEdit}><X />取消</button>
                      </span>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={mapping.ownerName}>
                  <td><strong>{mapping.ownerName}</strong></td>
                  <td><span className="mapping-account">{mapping.account}</span></td>
                  <td><span className={ownerOptionNameSet.has(mapping.ownerName) ? "mapping-status linked" : "mapping-status detached"}>{ownerOptionNameSet.has(mapping.ownerName) ? "已关联" : "当前无对应选项"}</span></td>
                  <td><span className="owner-mapping-row-actions"><button className="icon-button" type="button" aria-label={`编辑 ${mapping.ownerName}`} onClick={() => beginEdit(mapping)}><Pencil /></button><button className="icon-button danger-icon-button" type="button" aria-label={`删除 ${mapping.ownerName}`} onClick={() => confirmDelete(mapping.ownerName)}><Trash2 /></button></span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <footer className="owner-mapping-note">初始数据来源于 Notion“班组人员4A账户”；修改映射后，详情抽屉与后续 XLS 导出会立即使用新账号。</footer>
    </section>
  );
}
