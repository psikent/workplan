import { RefreshCw, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

const updateCheckIntervalMs = 60 * 60 * 1000;

export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      window.setInterval(() => void registration.update(), updateCheckIntervalMs);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="update-prompt" role="status" aria-live="polite">
      <RefreshCw aria-hidden="true" />
      <span>新版本可用</span>
      <button type="button" className="update-prompt-reload" onClick={() => void updateServiceWorker(true)}>
        刷新
      </button>
      <button type="button" className="update-prompt-close" aria-label="暂不更新" onClick={() => setNeedRefresh(false)}>
        <X />
      </button>
    </div>
  );
}
