import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import AccountAccessSettings from "./settings/AccountAccessSettings";
import ApiDocsSettings from "./settings/ApiDocsSettings";
import BarkPushSettings from "./settings/BarkPushSettings";
import CustomFieldsSettings from "./settings/CustomFieldsSettings";
import DataTransferSettings from "./settings/DataTransferSettings";
import EnvironmentConfigSettings from "./settings/EnvironmentConfigSettings";
import ExportTemplateSettings from "./settings/ExportTemplateSettings";
import OwnerAccountMappingSettings from "./settings/OwnerAccountMappingSettings";
import { defaultSettingsTab, isSettingsTab, settingsTabs, type SettingsTabKey } from "./settings/tabs";

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: SettingsTabKey = isSettingsTab(rawTab) ? rawTab : defaultSettingsTab;

  useEffect(() => {
    if (!isSettingsTab(rawTab)) setSearchParams({ tab: defaultSettingsTab }, { replace: true });
  }, [rawTab, setSearchParams]);

  // Panels mount on first visit and stay mounted afterwards so unsaved drafts,
  // validation previews, dialogs and one-time tokens survive switching tabs.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SettingsTabKey>>(() => new Set([activeTab]));
  if (!visitedTabs.has(activeTab)) setVisitedTabs((current) => new Set(current).add(activeTab));

  const tabRefs = useRef(new Map<SettingsTabKey, HTMLButtonElement | null>());

  useEffect(() => {
    tabRefs.current.get(activeTab)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  function activateTab(tab: SettingsTabKey) {
    tabRefs.current.get(tab)?.focus();
    if (tab !== activeTab) setSearchParams({ tab });
  }

  function handleTablistKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const focusedTab = event.target instanceof HTMLElement ? event.target.dataset.tab ?? null : null;
    if (!isSettingsTab(focusedTab)) return;
    const currentIndex = settingsTabs.findIndex((tab) => tab.key === focusedTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % settingsTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + settingsTabs.length) % settingsTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = settingsTabs.length - 1;
    const nextTab = nextIndex == null ? undefined : settingsTabs[nextIndex];
    if (!nextTab) return;
    event.preventDefault();
    tabRefs.current.get(nextTab.key)?.focus();
  }

  function renderPanel(tab: SettingsTabKey) {
    switch (tab) {
      case "environment":
        return <><EnvironmentConfigSettings /><OwnerAccountMappingSettings /><CustomFieldsSettings /></>;
      case "transfer":
        return <><DataTransferSettings /><ExportTemplateSettings /></>;
      case "accounts":
        return <AccountAccessSettings />;
      case "push":
        return <BarkPushSettings />;
      case "api-docs":
        return <ApiDocsSettings />;
    }
  }

  return (
    <section className="content-page narrow-page">
      <header className="page-header"><div><h1>设置</h1><p>集中管理环境配置、数据导入导出、账户与访问、推送和接口文档。</p></div></header>
      <div className="settings-tabbar">
        <div className="settings-tablist" role="tablist" aria-label="设置分区" onKeyDown={handleTablistKeyDown}>
          {settingsTabs.map((tab) => (
            <button
              key={tab.key}
              ref={(node) => {
                tabRefs.current.set(tab.key, node);
              }}
              id={`settings-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={tab.key === activeTab}
              aria-controls={visitedTabs.has(tab.key) ? `settings-panel-${tab.key}` : undefined}
              data-tab={tab.key}
              tabIndex={tab.key === activeTab ? 0 : -1}
              className={`settings-tab${tab.key === activeTab ? " active" : ""}`}
              onClick={() => activateTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {settingsTabs.map((tab) => visitedTabs.has(tab.key) ? (
        <div
          key={tab.key}
          id={`settings-panel-${tab.key}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab.key}`}
          hidden={tab.key !== activeTab}
          className="settings-tabpanel"
        >
          <div className="settings-stack">{renderPanel(tab.key)}</div>
        </div>
      ) : null)}
    </section>
  );
}
