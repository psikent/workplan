import { BookOpen } from "lucide-react";

export default function ApiDocsSettings() {
  return (
    <section className="settings-section">
      <header><div><BookOpen /><span><strong>接口文档</strong><small>使用个人访问令牌从外部脚本调用 REST API。</small></span></div><a className="secondary-button" href="/api/docs" target="_blank" rel="noreferrer">打开 OpenAPI</a></header>
    </section>
  );
}
