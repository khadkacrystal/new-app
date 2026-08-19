import { createAppBridge } from '@flashmandu/app-bridge';

export function navigateTo(url: string) {
  if (typeof window !== 'undefined') {
    window.location.href = url;
  } else {
    const bridge = createAppBridge();
    bridge.navigate(url);
  }
}
