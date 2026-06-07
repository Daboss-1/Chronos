import { useEffect, useState } from 'react';
import { useNt4 } from '@frc-web-components/react/networktables';

// Matches /ChronosDashboard/<section>/<tab>/
const TAB_REGEX = /^\/ChronosDashboard\/(?:commands|numbers|strings|booleans|tunableNumbers|tunableStrings|tunableBooleans|cameraStreams|fields|robots)\/([^/]+)\//;
// Matches /ChronosDashboard/systems/<system>/<section>/<tab>/
const SYSTEM_TAB_REGEX = /^\/ChronosDashboard\/systems\/[^/]+\/(?:commands|numbers|strings|booleans|tunableNumbers|tunableStrings|tunableBooleans)\/([^/]+)\//;

// These always appear in the tab bar regardless of NT; exclude from dynamic discovery
const BUILTIN_TABS = new Set(['Match']);

export function useDiscoveredTabs() {
  const { nt4Provider } = useNt4();
  const [tabs, setTabs] = useState([]);

  useEffect(() => {
    if (!nt4Provider) return;

    const discover = () => {
      const tabSet = new Set();
      const topics = nt4Provider.topics || {};
      const keys = topics instanceof Map
        ? Array.from(topics.keys())
        : Object.keys(topics);

      for (const topic of keys) {
        let m = TAB_REGEX.exec(topic);
        if (m && !BUILTIN_TABS.has(m[1])) tabSet.add(m[1]);
        m = SYSTEM_TAB_REGEX.exec(topic);
        if (m && !BUILTIN_TABS.has(m[1])) tabSet.add(m[1]);
      }

      const next = Array.from(tabSet).sort();
      setTabs(prev =>
        prev.length === next.length && prev.every((t, i) => t === next[i]) ? prev : next
      );
    };

    discover();
    const id = setInterval(discover, 1000);
    return () => clearInterval(id);
  }, [nt4Provider]);

  return tabs;
}
