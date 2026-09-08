// 风险四档配色（可接受=灰、低=绿、中=琥珀、高=珊瑚红，沿用状态徽章色板）；
// 词汇表四档之外的自定义 label 回退中性灰，保留文字。
const riskClassNames: Record<string, string> = {
  可接受: "risk-acceptable",
  低: "risk-low",
  中: "risk-medium",
  高: "risk-high",
};

export function RiskBadge({ label }: { label: string }) {
  return <span className={`risk-badge ${riskClassNames[label] ?? "risk-unknown"}`}><i />{label}</span>;
}

// 负责人中性药丸：未指定（null）用更弱的虚线中性样式提示待补。
export function OwnerBadge({ label }: { label: string | null }) {
  if (!label) return <span className="owner-badge owner-badge-unassigned">未指定</span>;
  return <span className="owner-badge"><i />{label}</span>;
}
